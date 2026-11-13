import crypto from 'crypto';
import axios from 'axios';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { ScraperService } from './scraperService.js';
import { CircuitBreaker } from '../shared/circuitBreaker.js';
import { Bulkhead } from '../shared/bulkhead.js';
import { validateSafeUrlAsync } from '../shared/security.js';
import { TextEncodingSanitizer } from '../shared/textEncodingSanitizer.js';

export interface ClientScrapeOptions {
  url: string;
  clientId?: string;
  moduleId?: string;
  tags?: string[];
  title?: string;
}

export interface ClientScrapeResult {
  status: 'EXTRACTION_SUCCESS' | 'EXTRACTION_PERSISTED' | 'FAILED' | 'EXTRACTION_INCOMPLETE' | 'SUCCESS';
  markdown: string;
  rawContent: string;
  contentHash: string;
  url: string;
  clientId?: string;
  moduleId?: string;
  source: 'FIRECRAWL_API' | 'FIRECRAWL_FALLBACK_ENGINE';
  createdAt: Date;
  extractedAt: string;
  savedRecordId?: string;
  clientScrapedDataId?: string;
  tokensCount: number;
  tags: string[];
  error?: string;
}

/**
 * ClientScraperService
 * 
 * Serviço especializado e isolado para raspagem de ativos, websites e sistemas de clientes
 * para subsidiar auditorias de conformidade deontológica e proteção de dados em saúde.
 * 
 * Garantias arquiteturais:
 * - Validação Anti-SSRF mandatória (RFC 1918, Loopback, Cloud Metadata).
 * - Circuit Breaker e Bulkhead independentes para proteção contra DoS.
 * - Isolamento estrito de dados: NUNCA interage ou polui o repositório de normas públicas ('norms').
 * - Higienização com TextEncodingSanitizer antes da persistência.
 */
export class ClientScraperService {
  // Padrão de Resiliência: Circuit Breaker dedicado para portais de clientes
  public static clientCircuitBreaker = new CircuitBreaker({
    name: 'ClientScraping',
    failureThreshold: 3,
    resetTimeoutMs: 20000,
    successThreshold: 2,
  });

  // Padrão de Resiliência: Bulkhead dedicado para concorrência de clientes
  public static clientBulkhead = new Bulkhead({
    name: 'ClientScrapingPool',
    maxConcurrent: 8,
    maxQueue: 30,
    timeoutMs: 30000,
  });

  /**
   * Executa a extração exclusiva de URL de cliente com validação anti-SSRF,
   * conversão para Markdown limpo e integridade SHA-256.
   */
  public static async scrapeClientAsset(options: ClientScrapeOptions): Promise<ClientScrapeResult> {
    const { url, clientId, moduleId, tags = [], title } = options;

    // 1. Proteção anti-SSRF mandatória antes de qualquer tráfego externo
    const ssrfCheck = await validateSafeUrlAsync(url);
    if (!ssrfCheck.safe) {
      const errorMsg = `[SSRF Bloqueado] Destino de extração de cliente rejeitado por segurança: ${ssrfCheck.reason}`;
      console.error(`🛡️ [ClientScraperService] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    const firecrawlApiKey = process.env.FIRECRAWL_API_KEY || (env as any).FIRECRAWL_API_KEY;
    let markdown = '';
    let source: 'FIRECRAWL_API' | 'FIRECRAWL_FALLBACK_ENGINE' = 'FIRECRAWL_FALLBACK_ENGINE';
    let lastError: string | null = null;

    // 2. Scraping via Firecrawl API com proteção de Circuit Breaker e Bulkhead
    if (firecrawlApiKey && firecrawlApiKey !== 'mock-key' && !firecrawlApiKey.startsWith('mock')) {
      try {
        console.log(`🔥 [ClientScraperService] Raspando ativo do cliente via Firecrawl API: ${url}`);
        const response = await this.clientBulkhead.execute(() =>
          this.clientCircuitBreaker.execute(() =>
            axios.post(
              'https://api.firecrawl.dev/v1/scrape',
              {
                url,
                formats: ['markdown'],
              },
              {
                headers: {
                  Authorization: `Bearer ${firecrawlApiKey}`,
                  'Content-Type': 'application/json',
                },
                timeout: 30000,
              }
            )
          )
        );

        if (response.data?.success && (response.data?.data?.markdown || response.data?.markdown)) {
          markdown = (response.data?.data?.markdown || response.data?.markdown).trim();
          source = 'FIRECRAWL_API';
          console.log(`✅ [ClientScraperService] Conteúdo do cliente extraído com sucesso (${markdown.length} chars)`);
        }
      } catch (err: any) {
        lastError = `Firecrawl API: ${err.message}`;
        console.warn(`⚠️ [ClientScraperService] Falha na Firecrawl API (${err.message}). Ativando fallback de motor nativo.`);
      }
    }

    // 3. Fallback resiliente para motor Cheerio/nativo
    if (!markdown || markdown.trim().length === 0) {
      console.log(`ℹ️ [ClientScraperService] Processando extração limpa via motor nativo para cliente: ${url}`);
      try {
        const scrapeResult = await ScraperService.scrape(url, 'CHEERIO');
        if (scrapeResult && scrapeResult.cleanMarkdown && scrapeResult.cleanMarkdown.trim().length > 0) {
          markdown = scrapeResult.cleanMarkdown.trim();
        } else {
          lastError = lastError ? `${lastError} | Cheerio: Conteúdo vazio` : 'Cheerio: Conteúdo vazio';
        }
      } catch (fallbackErr: any) {
        lastError = lastError ? `${lastError} | Cheerio: ${fallbackErr.message}` : `Cheerio: ${fallbackErr.message}`;
      }
    }

    // 4. Bloqueio de Conteúdo Fictício: se a extração falhar, nunca inventar dados
    if (!markdown || markdown.trim().length === 0) {
      const errorMsg = `[EXTRACTION_FAILED] Falha irrecuperável na extração de conteúdo do cliente (${url}). Motivo: ${lastError || 'Nenhum conteúdo fático obtido'}. É expressamente proibido gerar laudo sobre conteúdo sintético.`;
      console.error(`❌ [ClientScraperService] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    // 5. Higienização universal contra mojibake
    const cleanMarkdown = TextEncodingSanitizer.sanitizeAndRepairText(markdown);
    const contentHash = crypto.createHash('sha256').update(cleanMarkdown, 'utf8').digest('hex');
    const now = new Date();
    const extractedAt = now.toISOString();
    const tokensCount = Math.ceil(cleanMarkdown.length / 4);

    let savedRecordId: string | undefined;
    let clientScrapedDataId: string | undefined;
    let extractionStatus: 'EXTRACTION_SUCCESS' | 'EXTRACTION_PERSISTED' = 'EXTRACTION_SUCCESS';

    // 6. Persistência Isolada em ModuleScrapeData (se vinculado a módulo)
    if (moduleId) {
      try {
        const savedData = await prisma.moduleScrapeData.create({
          data: {
            moduleId,
            url,
            contentHash,
            rawContent: cleanMarkdown,
            createdAt: now,
          },
        });
        savedRecordId = savedData.id;
        extractionStatus = 'EXTRACTION_PERSISTED';
        console.log(`💾 [ClientScraperService] Dados gravados em 'module_scrape_data' [ID: ${savedData.id}]`);
      } catch (dbErr: any) {
        const errorMsg = `[PERSISTENCE_FAILED] Falha ao persistir dados brutos do cliente no módulo (${moduleId}): ${dbErr.message}`;
        console.error(`❌ [ClientScraperService] ${errorMsg}`);
        throw new Error(errorMsg);
      }
    }

    // 7. Persistência Isolada em ClientScrapedData (se vinculado a cliente)
    const combinedTags = Array.from(new Set(['CLIENT_SCRAPE', 'AUDIT_ASSET', ...tags]));

    if (clientId) {
      try {
        const clientRecord = await prisma.clientScrapedData.create({
          data: {
            clientId,
            moduleId: moduleId || null,
            url,
            contentHash,
            rawContent: cleanMarkdown,
            title: title || `Extração de Ativo do Cliente (${new Date().toLocaleDateString('pt-BR')})`,
            cleanMarkdown,
            rawLength: cleanMarkdown.length,
            tokensCount,
            extractionMode: 'FIRECRAWL' as any,
            detectedTags: combinedTags,
            status: 'COMPLETED',
            createdAt: now,
          },
        });
        clientScrapedDataId = clientRecord.id;
        console.log(`💾 [ClientScraperService] Dados gravados em 'client_scraped_data' [ID: ${clientRecord.id}]`);
      } catch (clientErr: any) {
        console.warn(`⚠️ [ClientScraperService] Erro ao gravar em 'client_scraped_data': ${clientErr.message}`);
      }
    }

    return {
      status: extractionStatus,
      markdown: cleanMarkdown,
      rawContent: cleanMarkdown,
      contentHash,
      url,
      clientId,
      moduleId,
      source,
      createdAt: now,
      extractedAt,
      savedRecordId,
      clientScrapedDataId,
      tokensCount,
      tags: combinedTags,
    };
  }
}
