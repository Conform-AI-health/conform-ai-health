import { z } from 'zod';
import Firecrawl from '@mendable/firecrawl-js';
import * as cheerio from 'cheerio';
import { prisma } from '../config/prisma.js';
import { validateSafeUrlAsync, safeHttpGet } from '../shared/security.js';
import { AIGuardrails } from '../shared/aiGuardrails.js';
import { TextEncodingSanitizer } from '../shared/textEncodingSanitizer.js';
import { EmailService } from './emailService.js';

/**
 * 1. Enum e Schemas Zod de Documentos Normativos Oficiais em Saúde
 */
export const RegulatoryDocumentTypeEnum = z.enum([
  'RESOLUCAO',
  'PARECER',
  'PORTARIA',
  'NOTA_TECNICA',
  'OUTRO',
]);
export type RegulatoryDocumentType = z.infer<typeof RegulatoryDocumentTypeEnum>;

/**
 * Metadados específicos para Chunking e Indexação Vetorial em RAG (Retrieval-Augmented Generation)
 */
export const RagMetadataSchema = z.object({
  chunkingSugerido: z.boolean().default(true),
  tamanhoMaximoChunk: z.number().default(512),
  sobreposicaoChunk: z.number().default(64),
  contextoSemantico: z.string().min(10, 'Contexto semântico para âncora de embedding é obrigatório'),
});
export type RagMetadata = z.infer<typeof RagMetadataSchema>;

/**
 * Contrato Estruturado de Documento Normativo para RAG
 */
export const DocumentoNormativoRagSchema = z.object({
  documentoNormativo: z.object({
    titulo: z.string().min(5, 'Título completo e oficial da norma'),
    tipo: RegulatoryDocumentTypeEnum,
    numeroAno: z.string().min(2, 'Ex: 2.336/2023'),
    dataPublicacao: z.string().optional(),
    linkOficial: z.string().url('Link direto e absoluto para o documento oficial'),
    textoIntegralOriginal: z.string().min(10, 'Texto completo extraído da norma, higienizado de erros de acentuação'),
    metadadosRAG: RagMetadataSchema,
  }),
});
export type DocumentoNormativoRag = z.infer<typeof DocumentoNormativoRagSchema>;

export const RegulatoryDocumentSchema = z.object({
  documentType: RegulatoryDocumentTypeEnum,
  normCode: z.string().min(2, 'Código da norma deve conter no mínimo 2 caracteres'),
  title: z.string().min(5, 'Título deve conter no mínimo 5 caracteres'),
  article: z.string().optional().default('Geral'),
  content: z.string().min(10, 'Dispositivo normativo deve conter no mínimo 10 caracteres'),
  publicationDate: z.string().optional(),
  authority: z.string().min(2, 'Autoridade emissora obrigatória (ex: CFM, ANVISA, ANS, CFO)'),
  officialUrl: z.string().url('URL oficial do documento deve ser válida'),
  summary: z.string().min(10, 'Resumo do dispositivo obrigatório'),
  correctiveGuidance: z.string().optional(),
  keywords: z.array(z.string()).default([]),
  metadadosRAG: RagMetadataSchema.optional(),
});
export type RegulatoryDocument = z.infer<typeof RegulatoryDocumentSchema>;

export const SmartScraperExtractionSchema = z.object({
  sourcePortal: z.string(),
  extractionTimestamp: z.string(),
  documentsFound: z.array(RegulatoryDocumentSchema),
});
export type SmartScraperExtractionResult = z.infer<typeof SmartScraperExtractionSchema>;

/**
 * 2. Prompt Especializado de Auditoria Regulatória & Preparação para RAG
 */
export const REGULATORY_AUDIT_PROMPT = `Você é um auditor regulatório sênior especializado em conformidade em saúde digital. Sua tarefa é varrer o conteúdo extraído desta página institucional e identificar estritamente documentos normativos oficiais recém-publicados, como Resoluções, Pareceres, Portarias e Notas Técnicas.
Regras obrigatórias:
1. Ignore banners de rodapé, notícias genéricas de eventos, artigos de opinião ou links de redes sociais.
2. Capture apenas documentos que estabeleçam regras, obrigações ou diretrizes deontológicas e regulatórias.
3. Certifique-se de que o link fornecido é o link direto para o PDF ou para a página de detalhe oficial da norma. Não invente URLs.
4. Prepare os metadados de RAG com o contexto semântico do documento (objeto da norma) para busca vetorial de alta precisão.`;

/**
 * Opções de entrada dinâmica para o SmartScraperService
 */
export interface SmartScrapeOptions {
  urlAlvo: string;
  limitePaginas?: number;
  promptExtracao?: string;
  schemaExtracao?: z.ZodTypeAny;
  tags?: string[];
  notifyOnNewNorms?: boolean;
  notificationEmail?: string;
  deepCrawl?: boolean;
  maxDeepLinks?: number;
}

/**
 * Resumo do resultado da execução do scraping inteligente
 */
export interface SmartScrapeExecutionSummary {
  success: boolean;
  urlAlvo: string;
  totalCaptured: number;
  newNormsCount: number;
  existingNormsCount: number;
  newNorms: RegulatoryDocument[];
  persistedRecords: string[];
  deepLinksVisited?: string[];
  executionTimeMs: number;
  error?: string;
}

/**
 * Algoritmo de Chunking Semântico com Overlap para RAG
 * Divide textos longos de leis e resoluções em blocos semanticamente coerentes
 */
export function generateSemanticChunks(
  text: string,
  maxChunkTokens = 512,
  overlapTokens = 64
): string[] {
  if (!text || text.length === 0) return [];

  // Estimativa padrão: 1 token ~= 4 caracteres em português
  const maxChars = maxChunkTokens * 4;
  const overlapChars = overlapTokens * 4;

  if (text.length <= maxChars) {
    return [text.trim()];
  }

  const chunks: string[] = [];
  let startIndex = 0;

  while (startIndex < text.length) {
    let endIndex = startIndex + maxChars;

    if (endIndex < text.length) {
      // Prioriza quebras semânticas naturais: parágrafos duplos, artigos, incisos ou frases
      const paragraphBreak = text.lastIndexOf('\n\n', endIndex);
      const articleBreak = text.lastIndexOf('\nArt', endIndex);
      const sectionBreak = text.lastIndexOf('\n§', endIndex);
      const sentenceBreak = text.lastIndexOf('. ', endIndex);

      const naturalBreak = Math.max(paragraphBreak, articleBreak, sectionBreak, sentenceBreak);
      if (naturalBreak > startIndex + maxChars * 0.4) {
        endIndex = naturalBreak + 1;
      }
    } else {
      endIndex = text.length;
    }

    const chunk = text.slice(startIndex, endIndex).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    if (endIndex >= text.length) break;
    startIndex = Math.max(startIndex + 1, endIndex - overlapChars);
  }

  return chunks;
}

/**
 * 3. Serviço de Ingestão, Deep Crawl e Scraping Inteligente de Normas com Firecrawl
 */
export class SmartScraperService {
  private static firecrawlInstance: any = null;

  /**
   * Obtém ou inicializa cliente Firecrawl de forma singleton / mockável
   */
  public static getFirecrawlClient(): any {
    if (this.firecrawlInstance) {
      return this.firecrawlInstance;
    }
    const apiKey = process.env.FIRECRAWL_API_KEY || 'mock-key';
    this.firecrawlInstance = new (Firecrawl as any)({ apiKey });
    return this.firecrawlInstance;
  }

  /**
   * Permite injeção de mock para testes unitários
   */
  public static setFirecrawlClient(client: any): void {
    this.firecrawlInstance = client;
  }

  /**
   * Identifica links de menus de navegação, submenus e abas institucionais (Deep Crawl)
   * em portais como portal.cfm.org.br, anvisa.gov.br, ans.gov.br
   */
  public static extractNavigationSubmenuLinks(html: string, baseUrl: string): { url: string; title: string }[] {
    const $ = cheerio.load(html);
    const discovered: { url: string; title: string }[] = [];

    let origin = '';
    try {
      const u = new URL(baseUrl);
      origin = u.origin;
    } catch {
      return [];
    }

    // Padrão de rotas regulatórias e termos de menus institucionais
    const regulatoryMenuRegex = /(resolu[cç][oõ]es|pareceres?|c[aâ]mara[_-]?t[eé]cnica|normas?|legisla[cç][aã]o|atos?|publica[cç][oõ]es|boletim|diretrizes?)/i;

    $('header a, nav a, ul.menu a, ul.sub-menu a, .dropdown-menu a, .nav-item a, a[href*="resoluc"], a[href*="parecer"], a[href*="norma"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().trim().replace(/\s+/g, ' ');

      if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        const absoluteUrl = href.startsWith('http') ? href : `${origin}${href.startsWith('/') ? '' : '/'}${href}`;
        const isSelf = absoluteUrl === baseUrl || absoluteUrl === `${baseUrl}/`;

        if (!isSelf && (regulatoryMenuRegex.test(absoluteUrl) || regulatoryMenuRegex.test(text))) {
          if (!discovered.some((d) => d.url === absoluteUrl)) {
            discovered.push({
              url: absoluteUrl,
              title: TextEncodingSanitizer.sanitizeAndRepairText(text) || 'Menu Regulatório',
            });
          }
        }
      }
    });

    return discovered;
  }

  /**
   * Executa varredura inteligente em portal regulatório com suporte a Deep Crawl,
   * extração estruturada para RAG e diffing no banco de dados
   */
  public static async executeSmartScrape(options: SmartScrapeOptions): Promise<SmartScrapeExecutionSummary> {
    const startTime = Date.now();
    const correlationId = `smart-scrape-${Date.now()}`;
    const cleanUrl = options.urlAlvo?.trim();

    console.log(`🧭 [SmartScraperService] Iniciando varredura regulatória inteligente em: ${cleanUrl}`);

    try {
      // 1. Estágio 3: Validação Anti-SSRF rigorosa (RFC 1918, Loopback, Cloud Metadata, DNS Rebinding)
      const ssrfCheck = await validateSafeUrlAsync(cleanUrl);
      if (!ssrfCheck.safe) {
        const errorMsg = `[SSRF Bloqueado] Destino de extração rejeitado por segurança: ${ssrfCheck.reason}`;
        console.error(`🛡️ [SmartScraperService] ${errorMsg}`);

        await prisma.systemLog.create({
          data: {
            level: 'WARN',
            module: 'SMART_SCRAPER',
            correlationId,
            message: `[SECURITY_WARN] Requisição de scraping bloqueada por política anti-SSRF para a URL "${cleanUrl}".`,
            details: JSON.stringify({ reason: ssrfCheck.reason, url: cleanUrl }),
          },
        }).catch(() => {});

        throw new Error(errorMsg);
      }

      const client = this.getFirecrawlClient();
      const promptToUse = options.promptExtracao || REGULATORY_AUDIT_PROMPT;
      const urlsToScrape: string[] = [cleanUrl];
      const deepLinksVisited: string[] = [];

      // 2. Deep Crawl: Se ativado ou se for landing page institucional, varre submenus
      if (options.deepCrawl !== false) {
        try {
          const navResp = await safeHttpGet(cleanUrl, { timeout: 15000 });
          const rawNavHtml = typeof navResp.data === 'string' ? navResp.data : JSON.stringify(navResp.data);
          const submenus = this.extractNavigationSubmenuLinks(rawNavHtml, cleanUrl);

          const maxLinks = options.maxDeepLinks || 3;
          for (const sub of submenus.slice(0, maxLinks)) {
            const subSsrf = await validateSafeUrlAsync(sub.url);
            if (subSsrf.safe && !urlsToScrape.includes(sub.url)) {
              urlsToScrape.push(sub.url);
              deepLinksVisited.push(sub.url);
              console.log(`🔗 [SmartScraperService:DeepCrawl] Submenu regulatório descoberto: "${sub.title}" -> ${sub.url}`);
            }
          }
        } catch (crawlErr: any) {
          console.warn(`ℹ️ [SmartScraperService:DeepCrawl] Varredura de submenus prosseguindo em modo direto (${crawlErr.message}).`);
        }
      }

      // 3. Execução da extração estruturada via Firecrawl SDK em todas as URLs do escopo
      let rawDocuments: any[] = [];

      for (const targetUrl of urlsToScrape) {
        const scrapePayload: any = {
          formats: ['extract', 'markdown'],
          extract: {
            prompt: promptToUse,
            schema: options.schemaExtracao || SmartScraperExtractionSchema,
          },
          limit: options.limitePaginas || 5,
        };

        let firecrawlResult: any = null;
        try {
          if (typeof client.scrapeUrl === 'function') {
            firecrawlResult = await client.scrapeUrl(targetUrl, scrapePayload);
          } else if (typeof client.scrape === 'function') {
            firecrawlResult = await client.scrape(targetUrl, scrapePayload);
          } else if (typeof client.extract === 'function') {
            firecrawlResult = await client.extract([targetUrl], { prompt: promptToUse });
          }
        } catch (callErr: any) {
          console.warn(`⚠️ [SmartScraperService] Erro ao extrair de ${targetUrl}:`, callErr.message);
        }

        if (firecrawlResult) {
          if (Array.isArray(firecrawlResult.documentsFound)) {
            rawDocuments.push(...firecrawlResult.documentsFound);
          } else if (firecrawlResult.data?.extract?.documentsFound) {
            rawDocuments.push(...firecrawlResult.data.extract.documentsFound);
          } else if (firecrawlResult.extract?.documentsFound) {
            rawDocuments.push(...firecrawlResult.extract.documentsFound);
          } else if (firecrawlResult.documentoNormativo) {
            rawDocuments.push(firecrawlResult);
          } else if (Array.isArray(firecrawlResult.data?.documentsFound)) {
            rawDocuments.push(...firecrawlResult.data.documentsFound);
          } else if (Array.isArray(firecrawlResult)) {
            rawDocuments.push(...firecrawlResult);
          }
        }
      }

      console.log(`📄 [SmartScraperService] ${rawDocuments.length} documento(s) normativo(s) bruto(s) identificado(s).`);

      // 4. Validação dos documentos com schema Zod, Sanitização de Acentos (Anti-Mojibake) e RAG
      const validatedDocuments: RegulatoryDocument[] = [];
      for (const rawDoc of rawDocuments) {
        try {
          // Suporta tanto o envelope documentoNormativo quanto o modelo padrão
          const itemDoc = rawDoc.documentoNormativo ? {
            documentType: rawDoc.documentoNormativo.tipo,
            normCode: rawDoc.documentoNormativo.numeroAno,
            title: rawDoc.documentoNormativo.titulo,
            content: rawDoc.documentoNormativo.textoIntegralOriginal,
            publicationDate: rawDoc.documentoNormativo.dataPublicacao,
            authority: rawDoc.documentoNormativo.autoridade || 'CFM',
            officialUrl: rawDoc.documentoNormativo.linkOficial,
            summary: rawDoc.documentoNormativo.metadadosRAG?.contextoSemantico || rawDoc.documentoNormativo.titulo,
            keywords: [],
            metadadosRAG: rawDoc.documentoNormativo.metadadosRAG,
          } : rawDoc;

          const parsed = RegulatoryDocumentSchema.parse(itemDoc);

          // Sanitiza acentuação e anti-mojibake em todos os campos textuais
          const sanitizedContent = TextEncodingSanitizer.sanitizeAndRepairText(parsed.content);
          const sanitizedTitle = TextEncodingSanitizer.sanitizeAndRepairText(parsed.title);
          const sanitizedSummary = TextEncodingSanitizer.sanitizeAndRepairText(parsed.summary);
          const sanitizedNormCode = TextEncodingSanitizer.sanitizeAndRepairText(parsed.normCode);

          // Constrói ou preserva metadados de RAG
          const metadadosRAG: RagMetadata = parsed.metadadosRAG || {
            chunkingSugerido: true,
            tamanhoMaximoChunk: 512,
            sobreposicaoChunk: 64,
            contextoSemantico: sanitizedSummary,
          };

          validatedDocuments.push({
            ...parsed,
            normCode: sanitizedNormCode,
            title: sanitizedTitle,
            content: sanitizedContent,
            summary: sanitizedSummary,
            metadadosRAG,
          });
        } catch (zodErr: any) {
          console.warn(`⚠️ [SmartScraperService] Documento ignorado por não atender ao schema Zod:`, zodErr.message);
        }
      }

      // 5. Deduplicação em memória por URL oficial e código da norma
      const uniqueDocs: RegulatoryDocument[] = [];
      const seenDocs = new Set<string>();
      for (const doc of validatedDocuments) {
        const docKey = `${doc.officialUrl}|${doc.normCode}`;
        if (!seenDocs.has(docKey)) {
          seenDocs.add(docKey);
          uniqueDocs.push(doc);
        }
      }

      // 6. Mecanismo de Diffing contra o banco de dados (scraped_pages)
      const newNorms: RegulatoryDocument[] = [];
      const persistedRecordIds: string[] = [];
      let existingCount = 0;

      for (const doc of uniqueDocs) {
        const existingInDb = await prisma.scrapedPage.findFirst({
          where: {
            OR: [
              { url: doc.officialUrl },
              { title: { contains: doc.normCode } },
            ],
          },
        });

        if (existingInDb) {
          existingCount++;
          console.log(`ℹ️ [SmartScraperService] Norma já existente no catálogo: ${doc.normCode} (${doc.officialUrl})`);
          continue;
        }

        // Norma inédita identificada! Prepara chunks e metadados RAG para persistência
        const semanticChunks = generateSemanticChunks(
          doc.content,
          doc.metadadosRAG?.tamanhoMaximoChunk || 512,
          doc.metadadosRAG?.sobreposicaoChunk || 64
        );

        const combinedTags = [
          doc.authority.toUpperCase(),
          doc.authority.toLowerCase(),
          doc.documentType.toLowerCase(),
          ...(options.tags || []).map((t) => t.toLowerCase()),
          ...doc.keywords.map((k) => k.toLowerCase()),
          'RAG_READY',
        ];

        const ragHeader = [
          `# ${doc.normCode} - ${doc.article || 'Geral'}: ${doc.title}`,
          '',
          `- **Autoridade:** ${doc.authority.toUpperCase()}`,
          `- **Tipo:** ${doc.documentType}`,
          `- **Link Oficial:** [Acessar Documento Oficial](${doc.officialUrl})`,
          `- **Contexto Semântico RAG:** ${doc.metadadosRAG?.contextoSemantico || doc.summary}`,
          `- **Chunks Semânticos:** ${semanticChunks.length} bloco(s) gerados`,
          '',
          '---',
          '',
          '## Dispositivo Normativo na Íntegra',
          doc.content,
          '',
          doc.correctiveGuidance ? `## Orientação Deontológica\n${doc.correctiveGuidance}\n` : '',
        ].join('\n').trim();

        const createdPage = await prisma.scrapedPage.create({
          data: {
            url: doc.officialUrl,
            title: `[${doc.authority.toUpperCase()}] ${doc.normCode} - ${doc.title}`,
            cleanMarkdown: ragHeader,
            rawLength: doc.content.length,
            tokensCount: Math.ceil(doc.content.length / 4),
            tags: Array.from(new Set(combinedTags)),
            extractedEntities: JSON.stringify({
              metadadosRAG: doc.metadadosRAG,
              totalChunks: semanticChunks.length,
            }),
          },
        });

        newNorms.push(doc);
        persistedRecordIds.push(createdPage?.id || 'page-persisted');
        console.log(`✨ [SmartScraperService:RAG] Nova norma persistida no MongoDB: [${doc.normCode}] ${doc.title} (${semanticChunks.length} chunks RAG) (ID: ${createdPage?.id || 'N/A'})`);
      }

      const executionTimeMs = Date.now() - startTime;

      // 7. Telemetria Auditável no SystemLog
      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          module: 'SMART_SCRAPER',
          correlationId,
          message: `[SMART_SCRAPER_SUCCESS] Varredura concluída para ${cleanUrl} | Capturados: ${validatedDocuments.length} | Inéditos: ${newNorms.length} | Já cadastrados: ${existingCount} | DeepLinks: ${deepLinksVisited.length} (${executionTimeMs}ms)`,
          details: JSON.stringify({
            urlAlvo: cleanUrl,
            totalCaptured: validatedDocuments.length,
            newNormsCount: newNorms.length,
            existingNormsCount: existingCount,
            deepLinksVisited,
            persistedIds: persistedRecordIds,
            executionTimeMs,
          }),
        },
      }).catch(() => {});

      // 7. Notificação por E-mail caso haja novas normas identificadas
      if (options.notifyOnNewNorms && newNorms.length > 0 && options.notificationEmail) {
        try {
          const emailSubject = `⚖️ Conform.AI — Novas Normas Regulatórias Detectadas (${newNorms.length})`;
          const emailBody = `
            <h2>📢 Alerta de Atualização do Catálogo Normativo</h2>
            <p>O <strong>SmartScraperService</strong> identificou e indexou <strong>${newNorms.length}</strong> nova(s) norma(s) preparadas para RAG no portal <em>${cleanUrl}</em>:</p>
            <ul>
              ${newNorms.map((n) => `<li><strong>[${n.authority}] ${n.normCode}:</strong> ${n.title} (<a href="${n.officialUrl}">Acessar Documento Oficial</a>)</li>`).join('')}
            </ul>
            <p>Estas resoluções já estão com chunking semântico ativo e disponíveis para injeção contextual de conformidade deontológica.</p>
          `;

          await EmailService.sendEmail({
            to: options.notificationEmail,
            subject: emailSubject,
            html: emailBody,
          });
        } catch (mailErr: any) {
          console.warn(`⚠️ [SmartScraperService] Falha ao enviar notificação de novas normas:`, mailErr.message);
        }
      }

      return {
        success: true,
        urlAlvo: cleanUrl,
        totalCaptured: validatedDocuments.length,
        newNormsCount: newNorms.length,
        existingNormsCount: existingCount,
        newNorms,
        persistedRecords: persistedRecordIds,
        deepLinksVisited,
        executionTimeMs,
      };
    } catch (err: any) {
      const executionTimeMs = Date.now() - startTime;
      console.error(`❌ [SmartScraperService] Falha na execução da varredura regulatória para ${cleanUrl}:`, err.message);

      await prisma.systemLog.create({
        data: {
          level: 'ERROR',
          module: 'SMART_SCRAPER',
          correlationId,
          message: `[SMART_SCRAPER_ERROR] Erro na varredura regulatória de "${cleanUrl}": ${err.message}`,
          details: JSON.stringify({ url: cleanUrl, error: err.message, stack: err.stack }),
        },
      }).catch(() => {});

      return {
        success: false,
        urlAlvo: cleanUrl,
        totalCaptured: 0,
        newNormsCount: 0,
        existingNormsCount: 0,
        newNorms: [],
        persistedRecords: [],
        executionTimeMs,
        error: err.message,
      };
    }
  }
}
