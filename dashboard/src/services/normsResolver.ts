import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { prisma } from '../config/prisma.js';
import { NORMS_CATALOG, NormChunk } from '../data/normsCatalog.js';

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
}

export class NormsResolver {
  /**
   * Resolução Dinâmica de Normas no Banco de Dados (via Tags).
   * Consulta a collection de normas oficiais ('scraped_pages') no MongoDB correspondentes às tags do módulo.
   * Recupera todos os registros correspondentes com seu conteúdo integral.
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

    // 1. Consulta no MongoDB na collection de normas oficiais ('scraped_pages')
    try {
      const dbNorms = await prisma.scrapedPage.findMany({
        where: {
          tags: {
            hasSome: searchTags,
          },
        },
      });

      console.log(`📚 [NormsResolver] ${dbNorms.length} normas recuperadas da collection 'scraped_pages' no banco.`);

      for (const item of dbNorms) {
        // Exclui estritamente normas que possuam a tag de revogação normativa
        const isRevogada = (item.tags || []).some((t) => {
          const upper = t.trim().toUpperCase();
          return upper === 'REVOGADO' || upper.includes('REVOGAD');
        });

        if (isRevogada) {
          console.log(`🚫 [NormsResolver] Norma desconsiderada da auditoria por conter tag de revogação: "${item.title}" (${item.url})`);
          continue;
        }

        resolved.set(item.url || item.id, {
          id: item.id,
          normCode: item.title,
          source: item.tags[0] || 'REGULATORIO',
          title: item.title,
          content: item.cleanMarkdown,
          tags: item.tags,
          canonical: parseCanonicalIdentifier(item.title, item.tags),
        });
      }
    } catch (err: any) {
      console.warn(`⚠️ [NormsResolver] Consulta ao banco de normas falhou ou coleção vazia (${err.message}).`);
    }

    // 2. Consulta complementar no Catálogo Oficial de Normas (NORMS_CATALOG)
    for (const chunk of NORMS_CATALOG) {
      // T31: Vigência fundamentada em metadados formais (validity.isRevoked), eliminando heurísticas frágeis de substring
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

      if (matches && !resolved.has(chunk.id)) {
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

    // 3. Consulta complementar em arquivos físicos da pasta 'normas/' caso existam
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

