import { z } from 'zod';
import Firecrawl from '@mendable/firecrawl-js';
import { prisma } from '../config/prisma.js';
import { validateSafeUrlAsync } from '../shared/security.js';
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
});
export type RegulatoryDocument = z.infer<typeof RegulatoryDocumentSchema>;

export const SmartScraperExtractionSchema = z.object({
  sourcePortal: z.string(),
  extractionTimestamp: z.string(),
  documentsFound: z.array(RegulatoryDocumentSchema),
});
export type SmartScraperExtractionResult = z.infer<typeof SmartScraperExtractionSchema>;

/**
 * 2. Prompt Especializado de Auditoria Regulatória (Structured Outputs)
 */
export const REGULATORY_AUDIT_PROMPT = `Você é um auditor regulatório sênior especializado em conformidade em saúde digital. Sua tarefa é varrer o conteúdo extraído desta página institucional e identificar estritamente documentos normativos oficiais recém-publicados, como Resoluções, Pareceres, Portarias e Notas Técnicas.
Regras obrigatórias:
1. Ignore banners de rodapé, notícias genéricas de eventos, artigos de opinião ou links de redes sociais.
2. Capture apenas documentos que estabeleçam regras, obrigações ou diretrizes deontológicas e regulatórias.
3. Certifique-se de que o link fornecido é o link direto para o PDF ou para a página de detalhe oficial da norma. Não invente URLs.`;

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
  executionTimeMs: number;
  error?: string;
}

/**
 * 3. Serviço de Ingestão e Scraping Inteligente de Normas com Firecrawl
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
   * Executa varredura inteligente em portal regulatório com extração estruturada e diff no banco
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

      // 2. Execução da extração estruturada via Firecrawl SDK
      const promptToUse = options.promptExtracao || REGULATORY_AUDIT_PROMPT;
      const client = this.getFirecrawlClient();

      let rawDocuments: any[] = [];

      // Chamada resiliente ao método scrapeUrl ou scrape do SDK
      const scrapePayload: any = {
        formats: ['extract', 'markdown'],
        extract: {
          prompt: promptToUse,
          schema: options.schemaExtracao || SmartScraperExtractionSchema,
        },
        limit: options.limitePaginas || 5,
      };

      let firecrawlResult: any = null;
      if (typeof client.scrapeUrl === 'function') {
        firecrawlResult = await client.scrapeUrl(cleanUrl, scrapePayload);
      } else if (typeof client.scrape === 'function') {
        firecrawlResult = await client.scrape(cleanUrl, scrapePayload);
      } else if (typeof client.extract === 'function') {
        firecrawlResult = await client.extract([cleanUrl], { prompt: promptToUse });
      }

      // Normaliza dados extraídos retornados pelo SDK
      if (firecrawlResult) {
        if (Array.isArray(firecrawlResult.documentsFound)) {
          rawDocuments = firecrawlResult.documentsFound;
        } else if (firecrawlResult.data?.extract?.documentsFound) {
          rawDocuments = firecrawlResult.data.extract.documentsFound;
        } else if (firecrawlResult.extract?.documentsFound) {
          rawDocuments = firecrawlResult.extract.documentsFound;
        } else if (Array.isArray(firecrawlResult.data?.documentsFound)) {
          rawDocuments = firecrawlResult.data.documentsFound;
        } else if (Array.isArray(firecrawlResult)) {
          rawDocuments = firecrawlResult;
        }
      }

      console.log(`📄 [SmartScraperService] ${rawDocuments.length} documento(s) normativo(s) bruto(s) identificado(s) na resposta.`);

      // 3. Validação dos documentos com schema Zod e Sanitização Defensiva
      const validatedDocuments: RegulatoryDocument[] = [];
      for (const rawDoc of rawDocuments) {
        try {
          const parsed = RegulatoryDocumentSchema.parse(rawDoc);

          // Sanitiza strings contra prompt injection / XSS usando Guardrails
          const sanitizedContent = AIGuardrails.sanitizeInputPrompt(parsed.content).sanitized;
          const sanitizedTitle = AIGuardrails.sanitizeInputPrompt(parsed.title).sanitized;
          const sanitizedSummary = AIGuardrails.sanitizeInputPrompt(parsed.summary).sanitized;

          validatedDocuments.push({
            ...parsed,
            title: sanitizedTitle,
            content: sanitizedContent,
            summary: sanitizedSummary,
          });
        } catch (zodErr: any) {
          console.warn(`⚠️ [SmartScraperService] Documento ignorado por não atender ao schema Zod:`, zodErr.message);
        }
      }

      // 4. Mecanismo de Diffing contra o banco de dados (scraped_pages)
      const newNorms: RegulatoryDocument[] = [];
      const persistedRecordIds: string[] = [];
      let existingCount = 0;

      for (const doc of validatedDocuments) {
        // Verifica se a norma já foi persistida anteriormente por URL oficial ou código idêntico
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

        // Norma inédita identificada! Normaliza acentuação e persiste no MongoDB (scraped_pages)
        const sanitizedNormCode = TextEncodingSanitizer.sanitizeAndRepairText(doc.normCode);
        const sanitizedDocTitle = TextEncodingSanitizer.sanitizeAndRepairText(doc.title);
        const sanitizedContent = TextEncodingSanitizer.sanitizeAndRepairText(doc.content);
        const sanitizedGuidance = TextEncodingSanitizer.sanitizeAndRepairText(doc.correctiveGuidance || doc.summary);

        const combinedTags = [
          doc.authority.toUpperCase(),
          doc.authority.toLowerCase(),
          doc.documentType.toLowerCase(),
          ...(options.tags || []).map((t) => t.toLowerCase()),
          ...doc.keywords.map((k) => k.toLowerCase()),
        ];

        const createdPage = await prisma.scrapedPage.create({
          data: {
            url: doc.officialUrl,
            title: `[${doc.authority.toUpperCase()}] ${sanitizedNormCode} - ${sanitizedDocTitle}`,
            cleanMarkdown: `# ${sanitizedNormCode} - ${doc.article || 'Geral'}: ${sanitizedDocTitle}\n\n**Dispositivo Normativo:**\n${sanitizedContent}\n\n**Orientação Deontológica:**\n${sanitizedGuidance}\n\n**Fonte:** ${doc.authority.toUpperCase()} (${doc.officialUrl})`,
            rawLength: sanitizedContent.length,
            tokensCount: Math.ceil(sanitizedContent.length / 4),
            tags: Array.from(new Set(combinedTags)),
          },
        });

        newNorms.push(doc);
        persistedRecordIds.push(createdPage.id);
        console.log(`✨ [SmartScraperService] Nova norma persistida no MongoDB: [${doc.normCode}] ${doc.title} (ID: ${createdPage.id})`);
      }

      const executionTimeMs = Date.now() - startTime;

      // 5. Telemetria Auditável no SystemLog
      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          module: 'SMART_SCRAPER',
          correlationId,
          message: `[SMART_SCRAPER_SUCCESS] Varredura concluída para ${cleanUrl} | Capturados: ${validatedDocuments.length} | Inéditos: ${newNorms.length} | Já cadastrados: ${existingCount} (${executionTimeMs}ms)`,
          details: JSON.stringify({
            urlAlvo: cleanUrl,
            totalCaptured: validatedDocuments.length,
            newNormsCount: newNorms.length,
            existingNormsCount: existingCount,
            persistedIds: persistedRecordIds,
            executionTimeMs,
          }),
        },
      }).catch(() => {});

      // 6. Notificação por E-mail caso haja novas normas identificadas
      if (options.notifyOnNewNorms && newNorms.length > 0 && options.notificationEmail) {
        try {
          const emailSubject = `⚖️ Conform.AI — Novas Normas Regulatórias Detectadas (${newNorms.length})`;
          const emailBody = `
            <h2>📢 Alerta de Atualização do Catálogo Normativo</h2>
            <p>O <strong>SmartScraperService</strong> identificou e cadastrou <strong>${newNorms.length}</strong> nova(s) norma(s) no portal <em>${cleanUrl}</em>:</p>
            <ul>
              ${newNorms.map((n) => `<li><strong>[${n.authority}] ${n.normCode}:</strong> ${n.title} (<a href="${n.officialUrl}">Acessar Norma Oficial</a>)</li>`).join('')}
            </ul>
            <p>Estas resoluções já estão ativas e disponíveis para injeção contextual de conformidade deontológica.</p>
          `;

          await EmailService.sendEmail({
            to: options.notificationEmail,
            subject: emailSubject,
            html: emailBody,
          });

          await prisma.systemLog.create({
            data: {
              level: 'INFO',
              module: 'EMAIL_NOTIFICATION',
              correlationId,
              message: `[EMAIL_SUCCESS] Alerta de ${newNorms.length} novas normas enviado para ${options.notificationEmail}`,
            },
          }).catch(() => {});
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
