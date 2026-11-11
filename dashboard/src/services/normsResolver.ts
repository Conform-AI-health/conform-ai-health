import fs from 'fs';
import path from 'path';
import { prisma } from '../config/prisma.js';
import { NORMS_CATALOG, NormChunk } from '../data/normsCatalog.js';

export interface ResolvedNorm {
  id: string;
  normCode: string;
  source: string;
  title: string;
  content: string;
  tags: string[];
  article?: string;
  severityDefault?: string;
}

export class NormsResolver {
  /**
   * Resolução Dinâmica de Normas no Banco de Dados (via Tags).
   * Consulta a collection de normas oficiais ('scraped_pages') no MongoDB correspondentes às tags do módulo.
   * Recupera todos os registros correspondentes com seu conteúdo integral.
   */
  public static async resolveByTags(tags?: string[]): Promise<ResolvedNorm[]> {
    const hasFilter = Boolean(tags && tags.length > 0);
    const cleanTags = (tags || []).map((t) => t.trim().toLowerCase()).filter(Boolean);
    const searchTags = [
      ...(tags || []).map((t) => t.trim().toUpperCase()),
      ...cleanTags,
    ];

    console.log(`🔍 [NormsResolver] Consultando normas no banco de dados para as tags: ${hasFilter ? JSON.stringify(tags) : 'Todas as normas ativas'}`);

    const resolved: Map<string, ResolvedNorm> = new Map();

    // 1. Consulta no MongoDB na collection de normas oficiais ('scraped_pages')
    try {
      const dbNorms = await prisma.scrapedPage.findMany({
        ...(hasFilter
          ? {
              where: {
                tags: {
                  hasSome: searchTags,
                },
              },
            }
          : {}),
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
        });
      }
    } catch (err: any) {
      console.warn(`⚠️ [NormsResolver] Consulta ao banco de normas falhou ou coleção vazia (${err.message}).`);
    }

    // 2. Consulta complementar no Catálogo Oficial de Normas (NORMS_CATALOG)
    for (const chunk of NORMS_CATALOG) {
      const isChunkRevogado =
        chunk.keywords.some((k) => k.toLowerCase().includes('revogad')) ||
        chunk.title.toLowerCase().includes('revogad');
      if (isChunkRevogado) {
        continue;
      }

      const matches =
        !hasFilter ||
        cleanTags.some(
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
            const matchesTag =
              !hasFilter ||
              cleanTags.some(
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
