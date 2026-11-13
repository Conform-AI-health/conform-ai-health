import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { prisma } from '../config/prisma.js';
import { NORMS_CATALOG, NormChunk } from '../data/normsCatalog.js';
import { cosineSimilarity, SemanticEmbeddingService } from './semanticEmbeddingService.js';

const MAX_RAG_CANDIDATE_CHUNKS = 2000;
const DEFAULT_RAG_TOP_K = 8;

export interface NormRetrievalResult {
  norms: ResolvedNorm[];
  status:
    | 'READY'
    | 'NO_SCOPE'
    | 'NO_MATCH'
    | 'UNINDEXED'
    | 'EMBEDDING_UNAVAILABLE'
    | 'CANDIDATE_LIMIT_EXCEEDED';
  candidatesCount: number;
  source?: 'MongoDB (norms/norms_chunk)' | 'NORMS_CATALOG';
  diagnostics?: NormRetrievalDiagnostics;
}

export interface NormRetrievalDiagnostics {
  expectedEmbeddingModel: string;
  activeChunksCount: number;
  indexedChunksCount: number;
  missingEmbeddingCount: number;
  invalidDimensionCount: number;
  modelMismatchCount: number;
  missingModelMetadataCount: number;
  missingNormParentCount: number;
}

export interface CanonicalNormIdentifier {
  authority: 'CFM' | 'ANS' | 'ANVISA' | 'LGPD' | 'LEI_FEDERAL' | 'OUTRO';
  type: 'RESOLUCAO' | 'LEI' | 'DECRETO' | 'PORTARIA' | 'INSTRUCAO_NORMATIVA';
  number: string;
  year?: number;
  article?: string;
  isRevoked: boolean;
}

export function parseCanonicalIdentifier(codeOrTitle: string, tags: string[] = []): CanonicalNormIdentifier {
  const text = `${codeOrTitle} ${tags.join(' ')}`.toUpperCase();
  let authority: CanonicalNormIdentifier['authority'] = 'OUTRO';
  if (text.includes('CFM')) authority = 'CFM';
  else if (text.includes('ANS')) authority = 'ANS';
  else if (text.includes('ANVISA')) authority = 'ANVISA';
  else if (text.includes('LGPD') || text.includes('13.709') || text.includes('13709')) authority = 'LGPD';
  else if (text.includes('LEI')) authority = 'LEI_FEDERAL';

  let type: CanonicalNormIdentifier['type'] = 'RESOLUCAO';
  if (text.includes('LEI')) type = 'LEI';
  else if (text.includes('DECRETO')) type = 'DECRETO';
  else if (text.includes('PORTARIA')) type = 'PORTARIA';

  const numMatch = codeOrTitle.match(/(?:N[ºo°]?\s*|RES(?:OLUÇÃO)?\.?\s*|LEI\s*)?([0-9]{1,5}(?:\.[0-9]{3})?)(?:\/|-)?([0-9]{2,4})?/i);
  const number = numMatch ? numMatch[1].replace('.', '') : '0';
  const year = numMatch && numMatch[2] ? (numMatch[2].length === 2 ? 2000 + parseInt(numMatch[2], 10) : parseInt(numMatch[2], 10)) : undefined;

  // T31: Vigência canônica fundamentada em identificação formal de normas extintas ou tags explícitas de metadados
  const isExplicitlyRevokedTag = tags.some((t) => {
    const upper = t.trim().toUpperCase();
    return upper === 'REVOGADO' || upper === 'REVOGADA' || upper === 'STATUS:REVOGADA';
  });
  const isKnownRevokedNorm = authority === 'CFM' && number === '1974' && (!year || year === 2011);
  const isRevoked = isExplicitlyRevokedTag || isKnownRevokedNorm;

  return { authority, type, number, year, isRevoked };
}

export interface ResolvedNorm {
  id: string;
  normCode: string;
  source: string;
  title: string;
  content: string;
  tags: string[];
  article?: string;
  severityDefault?: string;
  canonical?: CanonicalNormIdentifier;
  relevanceScore?: number;
}

interface RankedNormCandidate {
  norm: ResolvedNorm;
  embedding: number[];
}

function parseChunkMetadata(value: string | null): Record<string, unknown> {
  if (!value) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function lexicalScore(query: string, content: string): number {
  const stopWords = new Set([
    'para', 'com', 'uma', 'uns', 'umas', 'dos', 'das', 'que', 'por', 'como', 'sobre',
    'entre', 'sem', 'sua', 'seu', 'nas', 'nos', 'mais', 'pelo', 'pela', 'esta', 'este',
    'the', 'and', 'for', 'with', 'from', 'this', 'that',
  ]);
  const terms = Array.from(new Set(normalizeText(query).match(/[a-z0-9]{4,}/g) || []))
    .filter((term) => !stopWords.has(term))
    .slice(0, 100);
  if (terms.length === 0) {
    return 0;
  }
  const normalizedContent = normalizeText(content);
  return terms.filter((term) => normalizedContent.includes(term)).length / terms.length;
}

function rankCandidates(
  candidates: RankedNormCandidate[],
  queryText: string,
  queryEmbedding: number[],
  topK: number
): ResolvedNorm[] {
  return candidates
    .map(({ norm, embedding }) => {
      const semanticScore = Math.max(0, cosineSimilarity(queryEmbedding, embedding));
      const lexical = lexicalScore(queryText, `${norm.title}\n${norm.content}`);
      return {
        ...norm,
        relevanceScore: Number((semanticScore * 0.75 + lexical * 0.25).toFixed(4)),
      };
    })
    .sort((left, right) => (right.relevanceScore || 0) - (left.relevanceScore || 0))
    .slice(0, topK);
}

export class NormsResolver {
  /**
   * Recupera somente chunks vigentes da taxonomia solicitada e os ranqueia pelo conteúdo auditado.
   */
  public static async retrieveRelevantByTags(
    tags: string[],
    queryText: string,
    topK = DEFAULT_RAG_TOP_K
  ): Promise<NormRetrievalResult> {
    const cleanTags = Array.from(new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)));
    if (cleanTags.length === 0) {
      return { norms: [], status: 'NO_SCOPE', candidatesCount: 0 };
    }
    if (!queryText.trim()) {
      return { norms: [], status: 'NO_MATCH', candidatesCount: 0 };
    }

    const safeTopK = Math.min(16, Math.max(1, Math.floor(topK)));
    const searchTags = Array.from(new Set(cleanTags.flatMap((tag) => [tag.toUpperCase(), tag])));
    const dbNorms = await prisma.norm.findMany({
      where: {
        status: 'VIGENTE',
        tags: { hasSome: searchTags },
      },
      select: {
        id: true,
        normId: true,
        orgao: true,
        status: true,
        ementaHigienizada: true,
        tags: true,
      },
    });

    let candidates: RankedNormCandidate[] = [];
    let dbDiagnostics: NormRetrievalDiagnostics | undefined;

    if (dbNorms.length > 0) {
      const normById = new Map(dbNorms.map((norm) => [norm.id, norm]));
      const chunks = await prisma.normChunk.findMany({
        where: { normId: { in: dbNorms.map((norm) => norm.id) } },
        orderBy: [{ normId: 'asc' }, { chunkIndex: 'asc' }],
        take: MAX_RAG_CANDIDATE_CHUNKS + 1,
        select: {
          id: true,
          normId: true,
          normCode: true,
          chunkIndex: true,
          conteudoChunk: true,
          contextoSemantico: true,
          embedding: true,
          tags: true,
        },
      });

      if (chunks.length > MAX_RAG_CANDIDATE_CHUNKS) {
        return {
          norms: [],
          status: 'CANDIDATE_LIMIT_EXCEEDED',
          candidatesCount: chunks.length,
        };
      }

      const activeChunks = chunks.filter(
        (chunk) =>
          chunk.conteudoChunk.trim().length > 0 &&
          !(chunk.tags || []).some((tag) => tag.toUpperCase().includes('REVOGAD'))
      );
      if (activeChunks.length === 0) {
        return { norms: [], status: 'NO_MATCH', candidatesCount: 0 };
      }

      const diagnostics: NormRetrievalDiagnostics = {
        expectedEmbeddingModel: SemanticEmbeddingService.embeddingModelId,
        activeChunksCount: activeChunks.length,
        indexedChunksCount: 0,
        missingEmbeddingCount: 0,
        invalidDimensionCount: 0,
        modelMismatchCount: 0,
        missingModelMetadataCount: 0,
        missingNormParentCount: 0,
      };

      candidates = activeChunks.flatMap((chunk) => {
        const parent = normById.get(chunk.normId);
        const metadata = parseChunkMetadata(chunk.contextoSemantico);
        const embedding = Array.isArray(chunk.embedding) ? chunk.embedding : [];
        let isIndexed = true;
        if (!parent) {
          diagnostics.missingNormParentCount += 1;
          isIndexed = false;
        }
        if (embedding.length === 0) {
          diagnostics.missingEmbeddingCount += 1;
          isIndexed = false;
        } else if (embedding.length !== SemanticEmbeddingService.vectorDimensions) {
          diagnostics.invalidDimensionCount += 1;
          isIndexed = false;
        }
        if (typeof metadata.embedding_model !== 'string' || !metadata.embedding_model) {
          diagnostics.missingModelMetadataCount += 1;
          isIndexed = false;
        } else if (metadata.embedding_model !== SemanticEmbeddingService.embeddingModelId) {
          diagnostics.modelMismatchCount += 1;
          isIndexed = false;
        }
        if (!isIndexed || !parent) {
          return [];
        }
        diagnostics.indexedChunksCount += 1;

        const heading = typeof metadata.heading_context === 'string'
          ? metadata.heading_context
          : parent.ementaHigienizada || parent.normId;
        const article = typeof metadata.article === 'string'
          ? metadata.article
          : `Chunk ${chunk.chunkIndex}`;
        const title = typeof metadata.norm_title === 'string'
          ? metadata.norm_title
          : parent.ementaHigienizada || parent.normId;
        return [{
          embedding,
          norm: {
            id: chunk.id,
            normCode: parent.normId,
            source: parent.orgao || 'REGULATORIO',
            title: `${title} — ${heading}`,
            article,
            content: chunk.conteudoChunk,
            tags: chunk.tags.length > 0 ? chunk.tags : parent.tags,
            canonical: parseCanonicalIdentifier(parent.normId, parent.tags),
          },
        }];
      });

      if (diagnostics.indexedChunksCount !== activeChunks.length) {
        return {
          norms: [],
          status: 'UNINDEXED',
          candidatesCount: activeChunks.length,
          diagnostics,
        };
      }
      dbDiagnostics = diagnostics;
    } else {
      const localNorms = NORMS_CATALOG.filter((norm) => {
        const isRevoked = norm.validity?.isRevoked === true || norm.id.includes('REVOGADA');
        const matchesTag = cleanTags.some(
          (tag) =>
            norm.source.toLowerCase() === tag ||
            norm.normCode.toLowerCase().includes(tag) ||
            norm.keywords.some((keyword) => keyword.toLowerCase().includes(tag))
        );
        return !isRevoked && matchesTag;
      });
      if (localNorms.length === 0) {
        return { norms: [], status: 'NO_MATCH', candidatesCount: 0 };
      }
      try {
        const localTexts = localNorms.map((norm) => `${norm.title}\n${norm.content}`);
        const embeddings = await SemanticEmbeddingService.embedDocuments(localTexts);
        candidates = localNorms.map((norm, index) => ({
          embedding: embeddings[index],
          norm: {
            id: norm.id,
            normCode: norm.normCode,
            source: norm.source,
            title: norm.title,
            article: norm.article,
            content: norm.content,
            tags: [norm.source.toUpperCase(), ...norm.keywords],
            severityDefault: norm.severityDefault,
            canonical: parseCanonicalIdentifier(norm.normCode, [norm.source, ...norm.keywords]),
          },
        }));
      } catch (error) {
        console.warn(
          `[NormsResolver] Embedding local indisponível; contexto normativo não será ampliado: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return {
          norms: [],
          status: 'EMBEDDING_UNAVAILABLE',
          candidatesCount: localNorms.length,
        };
      }
    }

    try {
      const queryEmbedding = await SemanticEmbeddingService.embedQuery(queryText.slice(0, 8000));
      const rankedNorms = rankCandidates(candidates, queryText, queryEmbedding, safeTopK);
      return {
        norms: rankedNorms,
        status: rankedNorms.length > 0 ? 'READY' : 'NO_MATCH',
        candidatesCount: candidates.length,
        source: dbNorms.length > 0 ? 'MongoDB (norms/norms_chunk)' : 'NORMS_CATALOG',
        ...(dbNorms.length > 0 && dbDiagnostics ? { diagnostics: dbDiagnostics } : {}),
      };
    } catch (error) {
      console.warn(
        `[NormsResolver] Recuperação semântica indisponível; contexto normativo não será ampliado: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return {
        norms: [],
        status: 'EMBEDDING_UNAVAILABLE',
        candidatesCount: candidates.length,
      };
    }
  }

  /**
   * Resolução Dinâmica de Normas no Banco de Dados (via Tags).
   * Consulta normas vigentes e seus chunks RAG nas coleções `norms` e `norms_chunk`.
   */
  public static async resolveByTags(tags?: string[]): Promise<ResolvedNorm[]> {
    if (!tags || tags.length === 0) {
      // T31: Sem tags informadas, não assume arbitrariamente CFM; retorna array vazio para integridade do escopo
      console.log('🔍 [NormsResolver] Nenhuma tag informada. Escopo regulatório mantido neutro/vazio.');
      return [];
    }

    const cleanTags = tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
    const searchTags = [
      ...tags.map((t) => t.trim().toUpperCase()),
      ...cleanTags,
    ];

    console.log(`🔍 [NormsResolver] Consultando normas no banco de dados para as tags: ${JSON.stringify(tags)}`);

    const resolved: Map<string, ResolvedNorm> = new Map();

    // 1. Usa os documentos mestres e seus fragmentos semânticos; scraped_pages não compõe o contexto RAG.
    const dbNorms = await prisma.norm.findMany({
      where: {
        status: 'VIGENTE',
        tags: {
          hasSome: searchTags,
        },
      },
      select: {
        id: true,
        normId: true,
        orgao: true,
        status: true,
        ementaHigienizada: true,
        tags: true,
        chunks: {
          orderBy: { chunkIndex: 'asc' },
          select: {
            conteudoChunk: true,
            tags: true,
          },
        },
      },
    });

    console.log(`📚 [NormsResolver] ${dbNorms.length} normas recuperadas das coleções 'norms' e 'norms_chunk'.`);

    for (const item of dbNorms) {
      const itemTags = item.tags || [];
      const isRevogada = item.status !== 'VIGENTE' || itemTags.some((t) => {
        const upper = t.trim().toUpperCase();
        return upper === 'REVOGADO' || upper.includes('REVOGAD');
      });

      if (isRevogada) {
        console.log(`🚫 [NormsResolver] Norma desconsiderada da auditoria por estar revogada: "${item.normId}".`);
        continue;
      }

      const activeChunks = item.chunks.filter(
        (chunk) =>
          chunk.conteudoChunk.trim().length > 0 &&
          !(chunk.tags || []).some((tag) => tag.trim().toUpperCase().includes('REVOGAD'))
      );
      if (activeChunks.length === 0) {
        continue;
      }

      resolved.set(item.id, {
        id: item.id,
        normCode: item.normId,
        source: item.orgao || 'REGULATORIO',
        title: item.ementaHigienizada || item.normId,
        content: activeChunks.map((chunk) => chunk.conteudoChunk).join('\n\n'),
        tags: itemTags,
        canonical: parseCanonicalIdentifier(item.normId, itemTags),
      });
    }

    const hasDatabaseNorms = resolved.size > 0;

    if (!hasDatabaseNorms) {
      // Fallbacks locais são usados somente quando o banco ainda não contém normas/chunks para as tags.
      for (const chunk of NORMS_CATALOG) {
        const isChunkRevogado = chunk.validity?.isRevoked === true || chunk.id.includes('REVOGADA');
        if (isChunkRevogado) {
          continue;
        }

        const matches = cleanTags.some(
          (t) =>
            chunk.source.toLowerCase() === t ||
            chunk.normCode.toLowerCase().includes(t) ||
            chunk.keywords.some((k) => k.toLowerCase().includes(t))
        );

        if (matches) {
          resolved.set(chunk.id, {
            id: chunk.id,
            normCode: chunk.normCode,
            source: chunk.source,
            title: chunk.title,
            article: chunk.article,
            content: `### ${chunk.normCode} - ${chunk.article}: ${chunk.title}\n\n**Dispositivo:** ${chunk.content}\n\n**Orientação Corretiva:** ${chunk.correctiveGuidance}`,
            tags: [chunk.source.toUpperCase(), ...chunk.keywords],
            severityDefault: chunk.severityDefault,
            canonical: parseCanonicalIdentifier(chunk.normCode, [chunk.source, ...chunk.keywords]),
          });
        }
      }

      // Consulta complementar em arquivos físicos da pasta 'normas/' caso existam.
      try {
        const normasDirs = [
          path.resolve(process.cwd(), 'normas'),
          path.resolve(process.cwd(), '..', 'normas'),
          path.resolve(__dirname, '..', '..', '..', 'normas'),
        ];

        for (const dir of normasDirs) {
          if (fs.existsSync(dir)) {
            const files = this.scanMarkdownFiles(dir);
            for (const filePath of files) {
              const fileName = path.basename(filePath).toLowerCase();
              const matchesTag = cleanTags.some(
                (t) => fileName.includes(t) || filePath.toLowerCase().includes(path.sep + t)
              );
              if (matchesTag) {
                const fileContent = fs.readFileSync(filePath, 'utf-8');
                const isFileRevogado =
                  fileName.includes('revogad') ||
                  fileContent.toLowerCase().includes('revogado expressamente') ||
                  fileContent.toLowerCase().includes('revogada expressamente');
                if (isFileRevogado) {
                  console.log(`🚫 [NormsResolver] Arquivo local ignorado por revogação expressa: ${fileName}`);
                  continue;
                }

                const key = `file:${fileName}`;
                if (!resolved.has(key)) {
                  resolved.set(key, {
                    id: key,
                    normCode: fileName.replace('.md', '').toUpperCase(),
                    source: cleanTags[0]?.toUpperCase() || 'NORMAS_MD',
                    title: fileName,
                    content: fileContent,
                    tags: cleanTags,
                    canonical: parseCanonicalIdentifier(fileName, cleanTags),
                  });
                }
              }
            }
          }
        }
      } catch {
        // Ignorar erros na leitura física
      }
    }

    const result = Array.from(resolved.values());
    console.log(`⚖️ [NormsResolver] Total de ${result.length} normas ativas recuperadas dinamicamente para o contexto.`);
    return result;
  }

  /**
   * C05: Gera um snapshot estruturado das normas vigentes aplicadas na auditoria.
   * Preserva rastreabilidade inalterável das versões, publicações e integridade SHA-256.
   */
  public static createNormsSnapshot(norms: ResolvedNorm[]): string {
    const snapshotItems = norms.map((n) => ({
      id: n.id,
      normCode: n.normCode,
      source: n.source,
      article: n.article || null,
      canonical: n.canonical || null,
      contentLength: n.content?.length || 0,
      contentHash: crypto.createHash('sha256').update(n.content || '', 'utf8').digest('hex'),
      tags: n.tags,
    }));

    return JSON.stringify({
      snapshotGeneratedAt: new Date().toISOString(),
      totalNormsCount: snapshotItems.length,
      norms: snapshotItems,
    });
  }

  private static scanMarkdownFiles(dir: string): string[] {
    let results: string[] = [];
    try {
      const list = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of list) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results = results.concat(this.scanMarkdownFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          results.push(fullPath);
        }
      }
    } catch {
      // pasta inacessível
    }
    return results;
  }
}

export const createNormsSnapshot = NormsResolver.createNormsSnapshot.bind(NormsResolver);

