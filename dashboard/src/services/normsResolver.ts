import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { NORMS_CATALOG, NormChunk } from '../data/normsCatalog.js';
import { cosineSimilarity, SemanticEmbeddingService } from './semanticEmbeddingService.js';

const DEFAULT_MAX_RAG_CANDIDATE_CHUNKS = 10000;
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
  source?:
    | 'MongoDB (norms/norms_chunk)'
    | 'NORMS_CATALOG'
    | 'MongoDB (norms/norms_chunk) [Fallback Léxico/Tags]'
    | 'NORMS_CATALOG [Fallback Léxico/Tags]';
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
  normalizedSearchText?: string;
  lowerTags?: string[];
}

const LEXICAL_STOP_WORDS = new Set([
  'para', 'com', 'uma', 'uns', 'umas', 'dos', 'das', 'que', 'por', 'como', 'sobre',
  'entre', 'sem', 'sua', 'seu', 'nas', 'nos', 'mais', 'pelo', 'pela', 'esta', 'este',
  'the', 'and', 'for', 'with', 'from', 'this', 'that',
]);

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

function extractQueryTerms(query: string): string[] {
  return Array.from(new Set(normalizeText(query).match(/[a-z0-9]{4,}/g) || []))
    .filter((term) => !LEXICAL_STOP_WORDS.has(term))
    .slice(0, 100);
}

function lexicalScoreFromTerms(queryTerms: string[], normalizedContent: string): number {
  if (queryTerms.length === 0 || !normalizedContent) {
    return 0;
  }
  let matched = 0;
  for (let i = 0; i < queryTerms.length; i++) {
    if (normalizedContent.includes(queryTerms[i])) {
      matched++;
    }
  }
  return matched / queryTerms.length;
}

function rankCandidates(
  candidates: RankedNormCandidate[],
  queryText: string,
  queryEmbedding: number[],
  topK: number,
  targetTags: string[] = []
): ResolvedNorm[] {
  const normalizedTargetTags = new Set(targetTags.map((t) => t.toLowerCase().trim()));
  const queryTerms = extractQueryTerms(queryText);
  const hasSemantic = queryEmbedding.length > 0;
  return candidates
    .map(({ norm, embedding, normalizedSearchText, lowerTags }) => {
      const semanticScore = hasSemantic ? Math.max(0, cosineSimilarity(queryEmbedding, embedding)) : 0;
      const contentNorm = normalizedSearchText ?? normalizeText(`${norm.title}\n${norm.content}`);
      const lexical = lexicalScoreFromTerms(queryTerms, contentNorm);
      const normTagsLower = lowerTags ?? norm.tags.map((t) => t.toLowerCase().trim());
      let tagMatches = 0;
      for (let i = 0; i < normTagsLower.length; i++) {
        if (normalizedTargetTags.has(normTagsLower[i])) {
          tagMatches++;
        }
      }
      const tagBonus = tagMatches > 0 ? Math.min(0.20, tagMatches * 0.05) : 0;
      const combinedScore = hasSemantic
        ? semanticScore * 0.70 + lexical * 0.20 + tagBonus
        : lexical * 0.70 + tagBonus + (tagMatches > 0 ? 0.10 : 0.01);
      return {
        ...norm,
        relevanceScore: Number(combinedScore.toFixed(4)),
      };
    })
    .sort((left, right) => (right.relevanceScore || 0) - (left.relevanceScore || 0))
    .slice(0, topK);
}

interface CandidateChunkRow {
  id: string;
  normId: string;
  normCode: string;
  chunkIndex: number;
  conteudoChunk: string;
  contextoSemantico: string | null;
  embedding: number[];
  tags: string[];
}

const VECTOR_SEARCH_RETRY_AFTER_MS = 10 * 60 * 1000;
let vectorSearchUnavailableUntil = 0;

function ejsonId(value: unknown): string {
  if (value && typeof value === 'object' && '$oid' in (value as Record<string, unknown>)) {
    return String((value as Record<string, unknown>).$oid);
  }
  return String(value ?? '');
}

function ejsonNumber(value: unknown): number {
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return Number(obj.$numberDouble ?? obj.$numberInt ?? obj.$numberLong ?? obj.$numberDecimal ?? NaN);
  }
  return Number(value);
}

/**
 * Busca vetorial nativa no MongoDB Atlas ($vectorSearch) restrita às normas vigentes do escopo.
 * Retorna null quando desabilitada, indisponível (ex: Mongo não-Atlas, índice ausente) ou sem resultados,
 * para que o chamador use a busca por força bruta em memória.
 */
export async function searchChunksWithAtlasVector(
  queryEmbedding: number[],
  normIds: string[],
  topK: number
): Promise<CandidateChunkRow[] | null> {
  if (env.RAG_VECTOR_SEARCH_ENABLED !== 'true' || queryEmbedding.length === 0 || normIds.length === 0) {
    return null;
  }
  if (Date.now() < vectorSearchUnavailableUntil) {
    return null;
  }
  try {
    const limit = Math.min(200, topK * 8);
    const docs = (await prisma.normChunk.aggregateRaw({
      pipeline: [
        {
          $vectorSearch: {
            index: env.RAG_VECTOR_INDEX_NAME,
            path: 'embedding',
            queryVector: queryEmbedding,
            numCandidates: Math.min(10000, limit * 20),
            limit,
            filter: { normId: { $in: normIds.map((id) => ({ $oid: id })) } },
          },
        },
        {
          $project: {
            normId: 1,
            normCode: 1,
            chunkIndex: 1,
            conteudoChunk: 1,
            contextoSemantico: 1,
            embedding: 1,
            tags: 1,
          },
        },
      ],
    })) as unknown as Array<Record<string, unknown>>;

    if (!Array.isArray(docs) || docs.length === 0) {
      return null;
    }
    return docs.map((doc) => ({
      id: ejsonId(doc._id),
      normId: ejsonId(doc.normId),
      normCode: String(doc.normCode ?? ''),
      chunkIndex: ejsonNumber(doc.chunkIndex),
      conteudoChunk: String(doc.conteudoChunk ?? ''),
      contextoSemantico: typeof doc.contextoSemantico === 'string' ? doc.contextoSemantico : null,
      embedding: Array.isArray(doc.embedding) ? doc.embedding.map(ejsonNumber) : [],
      tags: Array.isArray(doc.tags) ? doc.tags.map(String) : [],
    }));
  } catch (error) {
    vectorSearchUnavailableUntil = Date.now() + VECTOR_SEARCH_RETRY_AFTER_MS;
    console.warn(
      `⚠️ [NormsResolver] Atlas $vectorSearch indisponível (${
        error instanceof Error ? error.message : String(error)
      }). Usando busca vetorial em memória por ${VECTOR_SEARCH_RETRY_AFTER_MS / 60000} min.`
    );
    return null;
  }
}

interface CachedNormMeta {
  id: string;
  normId: string;
  orgao: string;
  status: string;
  ementaHigienizada: string | null;
  tags: string[];
  lowerAndUpperTags: Set<string>;
  totalChunks: number;
}

interface IndexedNormCorpusCache {
  signature: string;
  expectedEmbeddingModel: string;
  normsById: Map<string, CachedNormMeta>;
  normsList: CachedNormMeta[];
  indexedCandidatesByNormId: Map<string, RankedNormCandidate[]>;
  invalidStatsByNormId: Map<
    string,
    {
      invalidDimension: number;
      modelMismatch: number;
      missingModelMetadata: number;
    }
  >;
  totalChunksCount: number;
  indexedChunksCount: number;
}

let cachedNormCorpus: IndexedNormCorpusCache | null = null;
let corpusLoadPromise: Promise<IndexedNormCorpusCache | null> | null = null;

async function fetchIndexedChunksFast(): Promise<CandidateChunkRow[]> {
  const rows: CandidateChunkRow[] = [];
  const pageSize = 250;
  let lastId: string | null = null;
  const maxChunks = env.RAG_MAX_CANDIDATE_CHUNKS || DEFAULT_MAX_RAG_CANDIDATE_CHUNKS;

  while (rows.length < maxChunks) {
    const filter: Record<string, any> = {
      'embedding.0': { $exists: true },
      ...(lastId ? { _id: { $gt: { $oid: lastId } } } : {}),
    };

    const batchRes = (await prisma.$runCommandRaw({
      find: 'norms_chunk',
      filter,
      sort: { _id: 1 },
      limit: pageSize,
      batchSize: pageSize,
      singleBatch: true,
      projection: {
        _id: 1,
        normId: 1,
        normCode: 1,
        chunkIndex: 1,
        conteudoChunk: 1,
        contextoSemantico: 1,
        embedding: 1,
        tags: 1,
      },
    })) as any;

    const docs: any[] = batchRes?.cursor?.firstBatch || [];
    if (!Array.isArray(docs) || docs.length === 0) {
      break;
    }

    for (const doc of docs) {
      const id = ejsonId(doc._id);
      lastId = id;
      rows.push({
        id,
        normId: ejsonId(doc.normId),
        normCode: String(doc.normCode ?? ''),
        chunkIndex: ejsonNumber(doc.chunkIndex),
        conteudoChunk: String(doc.conteudoChunk ?? ''),
        contextoSemantico: typeof doc.contextoSemantico === 'string' ? doc.contextoSemantico : null,
        embedding: Array.isArray(doc.embedding) ? doc.embedding.map(ejsonNumber) : [],
        tags: Array.isArray(doc.tags) ? doc.tags.map(String) : [],
      });
    }
  }

  return rows;
}

async function getOrRefreshIndexedCorpus(): Promise<IndexedNormCorpusCache | null> {
  if (
    env.NODE_ENV === 'test' ||
    typeof (prisma as any).$runCommandRaw !== 'function' ||
    typeof (prisma.norm as any)?.count !== 'function' ||
    typeof (prisma.norm as any)?.findFirst !== 'function' ||
    typeof (prisma.normChunk as any)?.count !== 'function'
  ) {
    return null;
  }

  const expectedModel = SemanticEmbeddingService.embeddingModelId;
  const [vigenteCount, latestNorm, totalChunksCount, indexedCountRes] = await Promise.all([
    prisma.norm.count({ where: { status: 'VIGENTE' } }),
    prisma.norm.findFirst({
      where: { status: 'VIGENTE' },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, updatedAt: true },
    }),
    prisma.normChunk.count(),
    prisma
      .$runCommandRaw({
        count: 'norms_chunk',
        query: { 'embedding.0': { $exists: true } },
      })
      .catch(() => null),
  ]);

  const rawIndexedCount =
    indexedCountRes && typeof indexedCountRes === 'object' && 'n' in (indexedCountRes as any)
      ? ejsonNumber((indexedCountRes as any).n)
      : -1;
  const signature = `${expectedModel}|${vigenteCount}|${latestNorm?.id || 'none'}|${latestNorm?.updatedAt?.toISOString() || '0'}|${totalChunksCount}|${rawIndexedCount}`;

  if (cachedNormCorpus && cachedNormCorpus.signature === signature) {
    return cachedNormCorpus;
  }

  if (corpusLoadPromise) {
    return corpusLoadPromise;
  }

  corpusLoadPromise = (async () => {
    try {
      const [allVigenteNorms, indexedChunks] = await Promise.all([
        prisma.norm.findMany({
          where: { status: 'VIGENTE' },
          select: {
            id: true,
            normId: true,
            orgao: true,
            status: true,
            ementaHigienizada: true,
            tags: true,
            totalChunks: true,
          },
        }),
        fetchIndexedChunksFast(),
      ]);

      const normsById = new Map<string, CachedNormMeta>();
      const normsList: CachedNormMeta[] = [];
      for (const n of allVigenteNorms) {
        const tagSet = new Set<string>();
        for (const t of n.tags || []) {
          const clean = t.trim();
          if (clean) {
            tagSet.add(clean);
            tagSet.add(clean.toLowerCase());
            tagSet.add(clean.toUpperCase());
          }
        }
        const meta: CachedNormMeta = {
          id: n.id,
          normId: n.normId,
          orgao: n.orgao || 'REGULATORIO',
          status: n.status,
          ementaHigienizada: n.ementaHigienizada,
          tags: n.tags || [],
          lowerAndUpperTags: tagSet,
          totalChunks: Math.max(0, n.totalChunks || 0),
        };
        normsById.set(n.id, meta);
        normsList.push(meta);
      }

      const indexedCandidatesByNormId = new Map<string, RankedNormCandidate[]>();
      const invalidStatsByNormId = new Map<
        string,
        { invalidDimension: number; modelMismatch: number; missingModelMetadata: number }
      >();

      let validIndexedTotal = 0;
      for (const chunk of indexedChunks) {
        if (
          !chunk.conteudoChunk.trim() ||
          (chunk.tags || []).some((tag) => tag.toUpperCase().includes('REVOGAD'))
        ) {
          continue;
        }
        const parent = normsById.get(chunk.normId);
        if (!parent) continue;

        const metadata = parseChunkMetadata(chunk.contextoSemantico);
        const embedding = chunk.embedding;
        if (embedding.length === 0 || metadata.embedding_model === 'PENDING_REINDEX') {
          continue;
        }

        const getOrCreateInvalid = () => {
          let st = invalidStatsByNormId.get(parent.id);
          if (!st) {
            st = { invalidDimension: 0, modelMismatch: 0, missingModelMetadata: 0 };
            invalidStatsByNormId.set(parent.id, st);
          }
          return st;
        };

        if (embedding.length !== SemanticEmbeddingService.vectorDimensions) {
          getOrCreateInvalid().invalidDimension += 1;
          continue;
        }
        if (typeof metadata.embedding_model !== 'string' || !metadata.embedding_model) {
          getOrCreateInvalid().missingModelMetadata += 1;
          continue;
        }
        if (metadata.embedding_model !== expectedModel) {
          getOrCreateInvalid().modelMismatch += 1;
          continue;
        }

        const heading =
          typeof metadata.heading_context === 'string'
            ? metadata.heading_context
            : parent.ementaHigienizada || parent.normId;
        const article =
          typeof metadata.article === 'string' ? metadata.article : `Chunk ${chunk.chunkIndex}`;
        const title =
          typeof metadata.norm_title === 'string'
            ? metadata.norm_title
            : parent.ementaHigienizada || parent.normId;
        const fullTitle = `${title} — ${heading}`;
        const resolvedTags = chunk.tags.length > 0 ? chunk.tags : parent.tags;

        const candidate: RankedNormCandidate = {
          embedding,
          normalizedSearchText: normalizeText(`${fullTitle}\n${chunk.conteudoChunk}`),
          lowerTags: resolvedTags.map((t) => t.toLowerCase().trim()),
          norm: {
            id: chunk.id,
            normCode: parent.normId,
            source: parent.orgao,
            title: fullTitle,
            article,
            content: chunk.conteudoChunk,
            tags: resolvedTags,
            canonical: parseCanonicalIdentifier(parent.normId, parent.tags),
          },
        };

        let list = indexedCandidatesByNormId.get(parent.id);
        if (!list) {
          list = [];
          indexedCandidatesByNormId.set(parent.id, list);
        }
        list.push(candidate);
        validIndexedTotal++;
      }

      cachedNormCorpus = {
        signature,
        expectedEmbeddingModel: expectedModel,
        normsById,
        normsList,
        indexedCandidatesByNormId,
        invalidStatsByNormId,
        totalChunksCount,
        indexedChunksCount: validIndexedTotal,
      };
      return cachedNormCorpus;
    } finally {
      corpusLoadPromise = null;
    }
  })();

  return corpusLoadPromise;
}

export function resetVectorSearchAvailability(): void {
  vectorSearchUnavailableUntil = 0;
}

export class NormsResolver {
  public static invalidateCache(): void {
    cachedNormCorpus = null;
    corpusLoadPromise = null;
  }

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

    // Caminho acelerado com cache em memória validado por assinatura de versão no MongoDB
    if (env.RAG_VECTOR_SEARCH_ENABLED !== 'true') {
      try {
        const corpus = await getOrRefreshIndexedCorpus();
        if (corpus && corpus.normsList.length > 0) {
          const matchedNorms = corpus.normsList.filter((n) =>
            searchTags.some((st) => n.lowerAndUpperTags.has(st))
          );
          if (matchedNorms.length > 0) {
            const fastCandidates: RankedNormCandidate[] = [];
            let estimatedScopeChunks = 0;
            let invalidDim = 0;
            let modelMismatch = 0;
            let missingMeta = 0;

            for (const n of matchedNorms) {
              const normCandidates = corpus.indexedCandidatesByNormId.get(n.id);
              const inv = corpus.invalidStatsByNormId.get(n.id);
              if (inv) {
                invalidDim += inv.invalidDimension;
                modelMismatch += inv.modelMismatch;
                missingMeta += inv.missingModelMetadata;
              }
              const normValidCount = normCandidates?.length || 0;
              estimatedScopeChunks += Math.max(
                n.totalChunks,
                normValidCount + (inv ? inv.invalidDimension + inv.modelMismatch + inv.missingModelMetadata : 0)
              );
              if (normCandidates && normCandidates.length > 0) {
                fastCandidates.push(...normCandidates);
              }
            }

            if (estimatedScopeChunks > 0) {
              const diagnostics: NormRetrievalDiagnostics = {
                expectedEmbeddingModel: corpus.expectedEmbeddingModel,
                activeChunksCount: estimatedScopeChunks,
                indexedChunksCount: fastCandidates.length,
                missingEmbeddingCount: Math.max(
                  0,
                  estimatedScopeChunks - fastCandidates.length - invalidDim - modelMismatch - missingMeta
                ),
                invalidDimensionCount: invalidDim,
                modelMismatchCount: modelMismatch,
                missingModelMetadataCount: missingMeta,
                missingNormParentCount: 0,
              };

              if (diagnostics.indexedChunksCount === 0 || diagnostics.modelMismatchCount > 0) {
                return {
                  norms: [],
                  status: 'UNINDEXED',
                  candidatesCount: estimatedScopeChunks,
                  diagnostics,
                };
              }

              try {
                const queryEmbedding = await SemanticEmbeddingService.embedQuery(queryText.slice(0, 8000));
                const rankedNorms = rankCandidates(fastCandidates, queryText, queryEmbedding, safeTopK, cleanTags);
                return {
                  norms: rankedNorms,
                  status: rankedNorms.length > 0 ? 'READY' : 'NO_MATCH',
                  candidatesCount: fastCandidates.length,
                  source: 'MongoDB (norms/norms_chunk)',
                  diagnostics,
                };
              } catch (embErr) {
                console.warn(
                  `⚠️ [NormsResolver] Recuperação semântica via embedding indisponível (${
                    embErr instanceof Error ? embErr.message : String(embErr)
                  }). Ativando fallback léxico sobre ${fastCandidates.length} chunks.`
                );
                const rankedNorms = rankCandidates(fastCandidates, queryText, [], safeTopK, cleanTags);
                return {
                  norms: rankedNorms,
                  status: rankedNorms.length > 0 ? 'READY' : 'EMBEDDING_UNAVAILABLE',
                  candidatesCount: fastCandidates.length,
                  source: 'MongoDB (norms/norms_chunk) [Fallback Léxico/Tags]',
                  diagnostics,
                };
              }
            }
          }
        }
      } catch (cacheErr) {
        console.warn(
          `⚠️ [NormsResolver] Aviso ao consultar cache de corpus indexado (${
            cacheErr instanceof Error ? cacheErr.message : String(cacheErr)
          }). Prosseguindo com consulta direta.`
        );
      }
    }

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
    let precomputedQueryEmbedding: number[] | null = null;

    if (dbNorms.length > 0) {
      const maxCandidateChunks = env.RAG_MAX_CANDIDATE_CHUNKS || DEFAULT_MAX_RAG_CANDIDATE_CHUNKS;
      const normById = new Map(dbNorms.map((norm) => [norm.id, norm]));
      let vectorChunks: CandidateChunkRow[] | null = null;
      if (env.RAG_VECTOR_SEARCH_ENABLED === 'true') {
        try {
          precomputedQueryEmbedding = await SemanticEmbeddingService.embedQuery(queryText.slice(0, 8000));
          vectorChunks = await searchChunksWithAtlasVector(
            precomputedQueryEmbedding,
            dbNorms.map((norm) => norm.id),
            safeTopK
          );
          if (vectorChunks) {
            // O shortlist do Atlas não enxerga chunks de outro modelo; checa o escopo inteiro sem carregar vetores
            const scopeMetadata = await prisma.normChunk.findMany({
              where: { normId: { in: dbNorms.map((norm) => norm.id) } },
              take: maxCandidateChunks,
              select: { contextoSemantico: true },
            });
            const hasModelMismatch = scopeMetadata.some(({ contextoSemantico }) => {
              const model = parseChunkMetadata(contextoSemantico).embedding_model;
              return typeof model === 'string' && !model.startsWith('PENDING')
                && model !== SemanticEmbeddingService.embeddingModelId;
            });
            if (hasModelMismatch) {
              vectorChunks = null;
            }
          }
        } catch {
          precomputedQueryEmbedding = null;
        }
      }
      const chunks: CandidateChunkRow[] = vectorChunks ?? await prisma.normChunk.findMany({
        where: { normId: { in: dbNorms.map((norm) => norm.id) } },
        take: maxCandidateChunks,
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

      if (chunks.length >= maxCandidateChunks) {
        console.warn(
          `⚠️ [NormsResolver] Grande volume de normas (${chunks.length} chunks). RAG processará os ${maxCandidateChunks} chunks prioritários para manter a auditoria ágil sem interrupção.`
        );
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

        // Chunks pendentes de vetor ou vazios são apenas missingEmbeddingCount (não modelMismatch)
        const isPendingOrEmpty =
          embedding.length === 0 ||
          metadata.embedding_model === 'PENDING_REINDEX';

        if (isPendingOrEmpty) {
          diagnostics.missingEmbeddingCount += 1;
          isIndexed = false;
        } else if (embedding.length !== SemanticEmbeddingService.vectorDimensions) {
          diagnostics.invalidDimensionCount += 1;
          isIndexed = false;
        } else if (typeof metadata.embedding_model !== 'string' || !metadata.embedding_model) {
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

      if (diagnostics.indexedChunksCount === 0 || diagnostics.modelMismatchCount > 0) {
        return {
          norms: [],
          status: 'UNINDEXED',
          candidatesCount: activeChunks.length,
          diagnostics,
        };
      }

      if (diagnostics.missingEmbeddingCount > 0) {
        console.warn(
          `⚠️ [NormsResolver] Recuperação RAG resiliente: ${diagnostics.indexedChunksCount}/${activeChunks.length} chunks indexados. ${diagnostics.missingEmbeddingCount} chunks recém-inseridos estão pendentes de vetor. Prosseguindo auditoria com os ${candidates.length} chunks indexados disponíveis.`
        );
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
      const queryEmbedding = precomputedQueryEmbedding
        ?? await SemanticEmbeddingService.embedQuery(queryText.slice(0, 8000));
      const rankedNorms = rankCandidates(candidates, queryText, queryEmbedding, safeTopK, cleanTags);
      return {
        norms: rankedNorms,
        status: rankedNorms.length > 0 ? 'READY' : 'NO_MATCH',
        candidatesCount: candidates.length,
        source: dbNorms.length > 0 ? 'MongoDB (norms/norms_chunk)' : 'NORMS_CATALOG',
        ...(dbNorms.length > 0 && dbDiagnostics ? { diagnostics: dbDiagnostics } : {}),
      };
    } catch (error) {
      console.warn(
        `⚠️ [NormsResolver] Recuperação semântica via embedding indisponível (${
          error instanceof Error ? error.message : String(error)
        }). Ativando fallback resiliente por relevância léxica e tags sobre os ${candidates.length} chunks disponíveis.`
      );
      if (candidates.length > 0) {
        const rankedNorms = rankCandidates(candidates, queryText, [], safeTopK, cleanTags);
        if (rankedNorms.length > 0) {
          return {
            norms: rankedNorms,
            status: 'READY',
            candidatesCount: candidates.length,
            source: dbNorms.length > 0
              ? 'MongoDB (norms/norms_chunk) [Fallback Léxico/Tags]'
              : 'NORMS_CATALOG [Fallback Léxico/Tags]',
            ...(dbNorms.length > 0 && dbDiagnostics ? { diagnostics: dbDiagnostics } : {}),
          };
        }
      }
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

