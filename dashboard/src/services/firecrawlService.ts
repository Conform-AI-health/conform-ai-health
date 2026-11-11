import crypto from 'crypto';
import axios from 'axios';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { ScraperService } from './scraperService.js';
import { CircuitBreaker } from '../shared/circuitBreaker.js';
import { Bulkhead } from '../shared/bulkhead.js';
import { validateSafeUrlAsync } from '../shared/security.js';

export interface FirecrawlScrapeResult {
  status: 'EXTRACTION_SUCCESS' | 'EXTRACTION_PERSISTED' | 'FAILED' | 'EXTRACTION_INCOMPLETE' | 'SUCCESS';
  markdown: string;
  rawContent: string;
  contentHash: string;
  url: string;
  moduleId?: string;
  source: 'FIRECRAWL_API' | 'FIRECRAWL_FALLBACK_ENGINE';
  createdAt: Date;
  extractedAt: string;
  savedRecordId?: string;
  error?: string;
}

export class FirecrawlService {
  // Padrão de Resiliência: Circuit Breaker para chamadas de scraping externo
  public static firecrawlCircuitBreaker = new CircuitBreaker({
    name: 'FirecrawlScraping',
    failureThreshold: 3,
    resetTimeoutMs: 20000,
    successThreshold: 2,
  });

  // Padrão de Resiliência: Bulkhead para controle de concorrência e isolamento
  public static scrapingBulkhead = new Bulkhead({
    name: 'ScrapingPool',
    maxConcurrent: 8,
    maxQueue: 30,
    timeoutMs: 30000,
  });

  /**
   * Executa a extração exclusiva de URL com validação anti-SSRF rigorosa (T05),
   * conversão para Markdown limpo e integridade SHA-256 (T04).
   * JAMAIS fabrica conteúdo fictício ou sintético se a extração falhar.
   */
  public static async scrape(url: string, moduleId?: string, clientId?: string): Promise<FirecrawlScrapeResult> {
    // 1. T05: Proteção anti-SSRF mandatória antes de qualquer chamada de rede externa
    const ssrfCheck = await validateSafeUrlAsync(url);
    if (!ssrfCheck.safe) {
      throw new Error(`[SSRF Bloqueado] Destino de extração rejeitado por segurança: ${ssrfCheck.reason}`);
    }

    const firecrawlApiKey = process.env.FIRECRAWL_API_KEY || (env as any).FIRECRAWL_API_KEY;
    let markdown = '';
    let source: 'FIRECRAWL_API' | 'FIRECRAWL_FALLBACK_ENGINE' = 'FIRECRAWL_FALLBACK_ENGINE';
    let lastError: string | null = null;

    // 2. Scraping via Firecrawl API com proteção de Circuit Breaker e Bulkhead
    if (firecrawlApiKey && firecrawlApiKey !== 'mock-key' && !firecrawlApiKey.startsWith('mock')) {
      try {
        console.log(`🔥 [FirecrawlService] Disparando scraping via Firecrawl API para: ${url}`);
        const response = await this.scrapingBulkhead.execute(() =>
          this.firecrawlCircuitBreaker.execute(() =>
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
          console.log(`✅ [FirecrawlService] Conteúdo retornado com sucesso via Firecrawl API (${markdown.length} caracteres)`);
        }
      } catch (err: any) {
        lastError = `Firecrawl API: ${err.message}`;
        console.warn(`⚠️ [FirecrawlService] Erro na chamada à API do Firecrawl (${err.message}). Ativando fallback de conversão para Markdown.`);
      }
    }

    // 3. Fallback resiliente de conversão para Markdown caso a chave não esteja ativa ou ocorra falha
    if (!markdown || markdown.trim().length === 0) {
      console.log(`ℹ️ [FirecrawlService] Processando extração limpa para Markdown via motor nativo para: ${url}`);
      try {
        const scrapeResult = await ScraperService.scrape(url, 'CHEERIO');
        if (scrapeResult && scrapeResult.cleanMarkdown && scrapeResult.cleanMarkdown.trim().length > 0) {
          markdown = scrapeResult.cleanMarkdown.trim();
        } else {
          lastError = lastError ? `${lastError} | Cheerio: Conteúdo limpo retornado vazio` : 'Cheerio: Conteúdo limpo retornado vazio';
        }
      } catch (fallbackErr: any) {
        lastError = lastError ? `${lastError} | Cheerio: ${fallbackErr.message}` : `Cheerio: ${fallbackErr.message}`;
      }
    }

    // T04: BLOQUEADOR DE INTEGRIDADE
    // Se todos os mecanismos de extração falharem ou o conteúdo for vazio, NUNCA inventar dados fictícios
    if (!markdown || markdown.trim().length === 0) {
      const errorMsg = `[EXTRACTION_FAILED] Falha irrecuperável na extração de conteúdo da URL (${url}). Motivo: ${lastError || 'Nenhum conteúdo fático obtido'}. É expressamente proibido gerar laudo sobre conteúdo sintético ou inexistente.`;
      console.error(`❌ [FirecrawlService] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    // 4. Geração de Hash Criptográfico SHA-256 de Integridade do Conteúdo Real Obtido
    const contentHash = crypto.createHash('sha256').update(markdown, 'utf8').digest('hex');
    const now = new Date();
    const extractedAt = now.toISOString();
    let savedRecordId: string | undefined;
    let extractionStatus: 'EXTRACTION_SUCCESS' | 'EXTRACTION_PERSISTED' = 'EXTRACTION_SUCCESS';

    // 5. C02: Persistência Obrigatória dos Dados Brutos no MongoDB quando moduleId for informado
    if (moduleId) {
      try {
        const savedData = await prisma.moduleScrapeData.create({
          data: {
            moduleId,
            url,
            contentHash,
            rawContent: markdown,
            createdAt: now,
          },
        });
        savedRecordId = savedData.id;
        extractionStatus = 'EXTRACTION_PERSISTED';
        console.log(`💾 [FirecrawlService] Dados persistidos em 'module_scrape_data' com ID: ${savedData.id} | Hash: ${contentHash}`);
      } catch (dbErr: any) {
        const errorMsg = `[PERSISTENCE_FAILED] Falha ao persistir dados brutos de extração para o módulo (${moduleId}): ${dbErr.message}`;
        console.error(`❌ [FirecrawlService] ${errorMsg}`);
        throw new Error(errorMsg);
      }
    }

    // Se houver clientId, também registrar em client_scraped_data para manter integridade da tela de clientes
    if (clientId) {
      try {
        await prisma.clientScrapedData.create({
          data: {
            clientId,
            moduleId: moduleId || null,
            url,
            contentHash,
            rawContent: markdown,
            title: `Extração Firecrawl (${new Date().toLocaleDateString('pt-BR')})`,
            cleanMarkdown: markdown,
            rawLength: markdown.length,
            tokensCount: Math.ceil(markdown.length / 4),
            extractionMode: 'FIRECRAWL' as any,
            detectedTags: ['FIRECRAWL', 'GOVERNANCA_IA'],
            status: 'COMPLETED',
            createdAt: now,
          },
        });
      } catch (clientErr: any) {
        console.warn(`⚠️ [FirecrawlService] Aviso ao espelhar em 'client_scraped_data': ${clientErr.message}`);
      }
    }

    return {
      status: extractionStatus,
      markdown,
      rawContent: markdown,
      contentHash,
      url,
      moduleId,
      source,
      createdAt: now,
      extractedAt,
      savedRecordId,
    };
  }
}
