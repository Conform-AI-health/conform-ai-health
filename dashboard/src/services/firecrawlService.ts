import { ClientScraperService, ClientScrapeResult } from './clientScraperService.js';
import { CircuitBreaker } from '../shared/circuitBreaker.js';
import { Bulkhead } from '../shared/bulkhead.js';

export type FirecrawlScrapeResult = ClientScrapeResult;

/**
 * FirecrawlService (Façade de Compatibilidade)
 * 
 * Mantido como fachada compatível com o legado para delegar requisições de raspagem de clientes
 * e ativos institucionais diretamente para o ClientScraperService especializado.
 */
export class FirecrawlService {
  // Expõe Circuit Breaker para compatibilidade com testes e telemetria
  public static get firecrawlCircuitBreaker(): CircuitBreaker {
    return ClientScraperService.clientCircuitBreaker;
  }

  // Expõe Bulkhead para compatibilidade com testes e telemetria
  public static get scrapingBulkhead(): Bulkhead {
    return ClientScraperService.clientBulkhead;
  }

  /**
   * Delega a raspagem do cliente diretamente para o ClientScraperService
   */
  public static async scrape(url: string, moduleId?: string, clientId?: string): Promise<FirecrawlScrapeResult> {
    return ClientScraperService.scrapeClientAsset({
      url,
      moduleId,
      clientId,
    });
  }
}
