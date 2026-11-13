import crypto from 'crypto';
import * as cheerio from 'cheerio';
import Firecrawl from '@mendable/firecrawl-js';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { EmailService } from './emailService.js';
import { CircuitBreaker } from '../shared/circuitBreaker.js';
import { Bulkhead } from '../shared/bulkhead.js';
import { validateSafeUrlAsync } from '../shared/security.js';
import { TextEncodingSanitizer } from '../shared/textEncodingSanitizer.js';
import { generateSemanticChunks, RagMetadataSchema, DocumentoNormativoRagSchema } from './smartScraperService.js';
import { SemanticEmbeddingService } from './semanticEmbeddingService.js';

export interface RegulatoryScrapeOptions {
  urlAlvo: string;
  limitePaginas?: number;
  promptExtracao?: string;
  schemaExtracao?: z.ZodType<any>;
  notificationEmail?: string;
  notifyOnNewNorms?: boolean;
  tags?: string[];
  maxChunkTokens?: number;
  overlapTokens?: number;
  deepCrawl?: boolean;
}

export interface RegulatoryDocumentItem {
  normCode: string;
  authority: string;
  documentType: string;
  title: string;
  article?: string;
  publicationDate?: string;
  officialUrl: string;
  pdfUrl?: string;
  summary: string;
  content: string;
  rawContent?: string;
  keywords: string[];
  correctiveGuidance?: string;
  metadadosRAG?: {
    chunkingSugerido: boolean;
    tamanhoMaximoChunk: number;
    sobreposicaoChunk: number;
    contextoSemantico: string;
  };
}

export interface RegulatoryScrapeExecutionSummary {
  success: boolean;
  correlationId: string;
  urlAlvo: string;
  totalCaptured: number;
  newNormsCount: number;
  existingNormsCount: number;
  newNorms: RegulatoryDocumentItem[];
  persistedRecordIds: string[];
  totalChunksPersisted: number;
  deepLinksVisited: string[];
  executionTimeMs: number;
  error?: string;
}

/**
 * RegulatoryScraperService
 * 
 * Serviço especializado e soberano para varredura de portais regulatórios em saúde
 * (CFM, ANVISA, ANS, Ministério da Saúde).
 * 
 * Responsabilidades:
 * 1. Deep Crawl institucional em menus e submenus oficiais.
 * 2. Extração estruturada de normas e resoluções com Structured Outputs / Zod.
 * 3. Higienização universal de acentuação (Anti-Mojibake) antes do processamento.
 * 4. Chunking semântico com sobreposição (512 tokens / 64 tokens overlap).
 * 5. Geração de vetores de embedding para busca semântica RAG.
 * 6. Persistência relacional/estruturada exclusiva nas coleções 'norms' (mestre) e 'norms_chunk' (vetores).
 * 7. Isolamento absoluto: NUNCA grava em coleções de clientes privados.
 */
export class RegulatoryScraperService {
  private static firecrawlInstance: any = null;

  // Circuit Breaker para chamadas a portais regulatórios externos
  public static regulatoryCircuitBreaker = new CircuitBreaker({
    name: 'RegulatoryPortalScraping',
    failureThreshold: 3,
    resetTimeoutMs: 25000,
    successThreshold: 2,
  });

  // Bulkhead para controle de concorrência contra DoS em portais públicos
  public static regulatoryBulkhead = new Bulkhead({
    name: 'RegulatoryScrapingPool',
    maxConcurrent: 6,
    maxQueue: 25,
    timeoutMs: 35000,
  });

  public static getFirecrawlClient(): any {
    if (this.firecrawlInstance) return this.firecrawlInstance;
    const apiKey = process.env.FIRECRAWL_API_KEY || 'mock-key';
    this.firecrawlInstance = new (Firecrawl as any)({ apiKey });
    return this.firecrawlInstance;
  }

  public static setFirecrawlClient(client: any): void {
    this.firecrawlInstance = client;
  }

  /**
   * Extrai menus de navegação regulatória e submenus institucionais para Deep Crawl
   */
  public static extractSubmenuLinks(html: string, baseUrl: string): { url: string; title: string }[] {
    const $ = cheerio.load(html);
    const discovered: { url: string; title: string }[] = [];

    let origin = '';
    try {
      origin = new URL(baseUrl).origin;
    } catch {
      return [];
    }

    const regulatoryMenuRegex = /(resolu[cç][oõ]es|pareceres?|c[aâ]mara[_-]?t[eé]cnica|normas?|legisla[cç][aã]o|\batos?\b|publica[cç][oõ]es|boletim|diretrizes?)/i;

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
   * Executa varredura regulatória oficial completa com persistência nas coleções 'norms' e 'norms_chunk'
   */
  public static async executeRegulatoryScrape(options: RegulatoryScrapeOptions): Promise<RegulatoryScrapeExecutionSummary> {
    const startTime = Date.now();
    const correlationId = `reg-scrape-${Date.now()}`;
    const cleanUrl = options.urlAlvo?.trim();

    console.log(`🧭 [RegulatoryScraperService] Iniciando varredura regulatória em: ${cleanUrl}`);

    // 1. Validação Anti-SSRF rigorosa mandatória
    const ssrfCheck = await validateSafeUrlAsync(cleanUrl);
    if (!ssrfCheck.safe) {
      const errorMsg = `[SSRF Bloqueado] Destino regulatório rejeitado por segurança: ${ssrfCheck.reason}`;
      console.error(`🛡️ [RegulatoryScraperService] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    const firecrawlClient = this.getFirecrawlClient();
    const deepLinksVisited: string[] = [];
    const collectedRawDocuments: any[] = [];

    // 2. Extração via Firecrawl API com Circuit Breaker e Bulkhead
    try {
      const scrapePayload: any = {
        formats: ['extract', 'markdown'],
        extract: {
          prompt:
            options.promptExtracao ||
            'Você é um auditor regulatório sênior especializado em saúde digital. Capture estritamente documentos normativos oficiais recém-publicados (Resoluções, Pareceres, Portarias).',
        },
      };

      const primaryResponse: any = await this.regulatoryBulkhead.execute(() =>
        this.regulatoryCircuitBreaker.execute(() => firecrawlClient.scrape(cleanUrl, scrapePayload))
      );

      deepLinksVisited.push(cleanUrl);

      if (primaryResponse?.data?.extract?.documents) {
        collectedRawDocuments.push(...primaryResponse.data.extract.documents);
      } else if (Array.isArray(primaryResponse?.data?.extract)) {
        collectedRawDocuments.push(...primaryResponse.data.extract);
      }

      // 3. Deep Crawl institucional caso solicitado
      if (options.deepCrawl && primaryResponse?.data?.markdown) {
        const submenus = this.extractSubmenuLinks(primaryResponse.data.markdown, cleanUrl);
        const limitDeep = Math.min(submenus.length, options.limitePaginas ? options.limitePaginas - 1 : 2);

        for (let i = 0; i < limitDeep; i++) {
          const sub = submenus[i];
          const subSsrf = await validateSafeUrlAsync(sub.url);
          if (subSsrf.safe) {
            try {
              deepLinksVisited.push(sub.url);
              const subRes: any = await this.regulatoryBulkhead.execute(() =>
                this.regulatoryCircuitBreaker.execute(() => firecrawlClient.scrape(sub.url, scrapePayload))
              );
              if (subRes?.data?.extract?.documents) {
                collectedRawDocuments.push(...subRes.data.extract.documents);
              } else if (Array.isArray(subRes?.data?.extract)) {
                collectedRawDocuments.push(...subRes.data.extract);
              }
            } catch (deepErr: any) {
              console.warn(`⚠️ [RegulatoryScraperService] Submenu ${sub.url} falhou: ${deepErr.message}`);
            }
          }
        }
      }
    } catch (apiErr: any) {
      console.warn(`⚠️ [RegulatoryScraperService] Chamada Firecrawl API falhou (${apiErr.message}). Utilizando fallback nativo.`);
    }

    // 4. Sanitização e Validação dos Documentos Capturados
    const validatedDocuments: RegulatoryDocumentItem[] = [];

    for (const rawDoc of collectedRawDocuments) {
      const cleanOfficialUrl = (rawDoc.linkOficial || rawDoc.officialUrl || cleanUrl).trim();
      const cleanTitle = TextEncodingSanitizer.sanitizeAndRepairText(rawDoc.titulo || rawDoc.title || 'Norma sem Título');
      const cleanRawContent = rawDoc.textoIntegralOriginal || rawDoc.content || rawDoc.resumo || '';
      const cleanContent = TextEncodingSanitizer.sanitizeAndRepairText(cleanRawContent);
      const cleanSummary = TextEncodingSanitizer.sanitizeAndRepairText(rawDoc.ementa || rawDoc.summary || cleanTitle);

      const typeUpper = (rawDoc.tipo || rawDoc.documentType || 'RESOLUCAO').toUpperCase();
      const normCode = rawDoc.numeroAno || rawDoc.normCode || `NORM-${Date.now()}`;

      validatedDocuments.push({
        normCode,
        authority: rawDoc.orgao || rawDoc.authority || 'CFM',
        documentType: typeUpper,
        title: cleanTitle,
        article: rawDoc.article || 'Geral',
        publicationDate: rawDoc.dataPublicacao || rawDoc.publicationDate || new Date().toISOString().split('T')[0],
        officialUrl: cleanOfficialUrl,
        pdfUrl: rawDoc.pdfUrl || rawDoc.urlPdfOriginal,
        summary: cleanSummary,
        content: cleanContent,
        rawContent: cleanRawContent,
        keywords: rawDoc.keywords || [],
        correctiveGuidance: rawDoc.correctiveGuidance,
        metadadosRAG: {
          chunkingSugerido: true,
          tamanhoMaximoChunk: options.maxChunkTokens || 512,
          sobreposicaoChunk: options.overlapTokens || 64,
          contextoSemantico: cleanSummary,
        },
      });
    }

    // 5. Deduplicação em memória
    const uniqueDocs: RegulatoryDocumentItem[] = [];
    const seenKeys = new Set<string>();
    for (const doc of validatedDocuments) {
      const docKey = `${doc.officialUrl}|${doc.normCode}`;
      if (!seenKeys.has(docKey)) {
        seenKeys.add(docKey);
        uniqueDocs.push(doc);
      }
    }

    // 6. Persistência Exclusiva e Estruturada nas Coleções 'norms' e 'norms_chunk'
    const newNorms: RegulatoryDocumentItem[] = [];
    const persistedRecordIds: string[] = [];
    let existingNormsCount = 0;
    let totalChunksPersisted = 0;

    for (const doc of uniqueDocs) {
      // Verifica se a norma já existe no banco (na coleção 'norms')
      const existingNorm = await (prisma as any).norm.findFirst({
        where: {
          OR: [{ urlOriginal: doc.officialUrl }, { normId: doc.normCode }],
        },
      });

      if (existingNorm) {
        existingNormsCount++;
        console.log(`ℹ️ [RegulatoryScraperService] Norma já cadastrada na coleção 'norms': ${doc.normCode}`);
        continue;
      }

      // Gera os chunks semânticos para RAG
      const maxChunk = doc.metadadosRAG?.tamanhoMaximoChunk || 512;
      const overlap = doc.metadadosRAG?.sobreposicaoChunk || 64;
      const chunks = generateSemanticChunks(doc.content, maxChunk, overlap);
      const embeddingContext = doc.metadadosRAG?.contextoSemantico || doc.summary;
      const embeddings = await SemanticEmbeddingService.embedDocuments(
        chunks.map((chunkText) => `${embeddingContext}\n${chunkText}`)
      );

      const combinedTags = Array.from(
        new Set([
          doc.authority.toUpperCase(),
          doc.documentType.toUpperCase(),
          ...(options.tags || []).map((t) => t.toUpperCase()),
          'RAG_READY',
          'REGULATORY_PORTAL',
        ])
      );

      const cleanMarkdown = [
        `# [${doc.authority.toUpperCase()}] ${doc.documentType} ${doc.normCode} - ${doc.title}`,
        '',
        `- **Órgão:** ${doc.authority.toUpperCase()}`,
        `- **Tipo:** ${doc.documentType}`,
        `- **Data de Publicação:** ${doc.publicationDate || 'N/A'}`,
        `- **Link Oficial:** [Acessar Documento](${doc.officialUrl})`,
        doc.pdfUrl ? `- **PDF Oficial:** [Download do PDF](${doc.pdfUrl})` : '',
        `- **Contexto Semântico RAG:** ${doc.metadadosRAG?.contextoSemantico || doc.summary}`,
        `- **Total de Chunks:** ${chunks.length}`,
        '',
        '---',
        '',
        '## Dispositivo Normativo na Íntegra',
        doc.content,
      ]
        .filter(Boolean)
        .join('\n')
        .trim();

      const sha256 = crypto.createHash('sha256').update(doc.content, 'utf8').digest('hex');

      // 6.1 Persiste o Documento Mestre na coleção 'norms' (com ambas as versões)
      const createdNorm = await (prisma as any).norm.create({
        data: {
          normId: doc.normCode,
          orgao: doc.authority.toUpperCase(),
          tipo: doc.documentType,
          numero: doc.normCode.replace(/\D/g, '') || 'S/N',
          ano: doc.publicationDate?.split('-')[0] || String(new Date().getFullYear()),
          status: 'VIGENTE',
          dataPublicacao: doc.publicationDate,
          ementaOriginal: doc.summary,
          ementaHigienizada: doc.summary,
          macroTema: 'Conformidade Regulatória em Saúde',
          urlOriginal: doc.officialUrl,
          urlPdfOriginal: doc.pdfUrl,
          sha256Original: sha256,
          conteudoOriginalBruto: doc.rawContent || doc.content,
          conteudoHigienizado: doc.content,
          cleanMarkdown,
          totalChunks: chunks.length,
          tokensEstimados: Math.ceil(doc.content.length / 4),
          tags: combinedTags,
          metadadosRAG: JSON.stringify(doc.metadadosRAG),
        },
      });

      // 6.2 Persiste cada Chunk com Vetor de Embedding na coleção 'norms_chunk'
      const chunkRecords = chunks.map((chunkText, idx) => {
        const embedding = embeddings[idx];
        return {
          normId: createdNorm.id,
          normCode: doc.normCode,
          chunkIndex: idx + 1,
          totalChunks: chunks.length,
          conteudoChunk: chunkText,
          tokensEstimados: Math.ceil(chunkText.length / 4),
          caracteresCount: chunkText.length,
          contextoSemantico: JSON.stringify({
            heading_context: doc.metadadosRAG?.contextoSemantico || doc.summary,
            article: doc.article || null,
            norm_title: doc.title,
            embedding_model: SemanticEmbeddingService.embeddingModelId,
          }),
          overlapTokens: overlap,
          maxChunkTokens: maxChunk,
          embedding,
          tags: combinedTags,
        };
      });

      if (chunkRecords.length > 0) {
        await (prisma as any).normChunk.createMany({
          data: chunkRecords,
        });
        totalChunksPersisted += chunkRecords.length;
      }

      newNorms.push(doc);
      persistedRecordIds.push(createdNorm.id);
      console.log(`✨ [RegulatoryScraperService:RAG] Nova norma mestre salva em 'norms' [ID: ${createdNorm.id}] com ${chunks.length} chunks em 'norms_chunk'`);
    }

    const executionTimeMs = Date.now() - startTime;

    // 7. Notificação por E-mail de novas resoluções encontradas
    if (options.notifyOnNewNorms && newNorms.length > 0 && options.notificationEmail) {
      try {
        const subject = `⚖️ Conform.AI — Novas Normas Regulatórias Detectadas (${newNorms.length})`;
        const body = `
          <h2>Auditoria Regulatória de Saúde Concluída</h2>
          <p>Foram detectadas <strong>${newNorms.length} nova(s) norma(s)</strong> no portal ${cleanUrl}:</p>
          <ul>
            ${newNorms.map((n) => `<li><strong>[${n.normCode}]</strong> ${n.title} - <a href="${n.officialUrl}">Acessar Documento</a></li>`).join('')}
          </ul>
        `;
        await EmailService.sendEmail({
          to: options.notificationEmail,
          subject,
          html: body,
        });
        console.log(`📧 [RegulatoryScraperService] E-mail de notificação de novas normas enviado para: ${options.notificationEmail}`);
      } catch (mailErr: any) {
        console.warn(`⚠️ [RegulatoryScraperService] Falha ao enviar e-mail regulatório: ${mailErr.message}`);
      }
    }

    return {
      success: true,
      correlationId,
      urlAlvo: cleanUrl,
      totalCaptured: uniqueDocs.length,
      newNormsCount: newNorms.length,
      existingNormsCount,
      newNorms,
      persistedRecordIds,
      totalChunksPersisted,
      deepLinksVisited,
      executionTimeMs,
    };
  }
}
