import Firecrawl from '@mendable/firecrawl-js';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { CircuitBreaker } from '../../shared/circuitBreaker.js';
import { Bulkhead } from '../../shared/bulkhead.js';
import { validateSafeUrlAsync } from '../../shared/security.js';
import { isNavigationLabel } from '../../shared/navigationLabels.js';

export interface FirecrawlScrapeConfig {
  onlyMainContent?: boolean;
  waitFor?: number;
  timeout?: number;
  includeHtml?: boolean;
  includeRawHtml?: boolean;
}

export interface FirecrawlMarkdownResult {
  markdown: string;
  html: string;
  rawHtml: string;
  links: string[];
  preservedStrikeTags: boolean;
  metadata?: Record<string, any>;
}

export interface FirecrawlJsonResult<T> extends FirecrawlMarkdownResult {
  data: T | null;
  validationError?: string;
}

export interface FirecrawlSearchWebItem {
  url: string;
  title?: string;
  description?: string;
  markdown?: string;
  html?: string;
  rawHtml?: string;
  json?: any;
  links?: string[];
  metadata?: Record<string, any>;
}

/**
 * FirecrawlClient (Camada Única de Integração com @mendable/firecrawl-js v4.52.0 — API v2)
 *
 * Responsabilidades e Garantias (ADR-001):
 * - P1: Usa estritamente o contrato v2 (`/v2/scrape`, `/v2/map`, `/v2/search`), nunca o formato legado `'extract'`.
 * - P2: Lê o retorno v2 direto no topo do `Document` (`doc.markdown`, `doc.html`, `doc.rawHtml`, `doc.links`, `doc.json`)
 *       e em `SearchData` lê exclusivamente `res.web` (jamais acessa o getter `res.data`, que lança erro na v2).
 * - P3: Nunca envia `limit` em chamadas `scrape` de página única (apenas em `map` e `search`).
 * - PONTO 2 (ADR-001):
 *   - No fluxo de normas (`scrapeMarkdownAndLinks`), solicita apenas `['markdown', 'html', 'rawHtml', 'links']` (SEM `json`).
 *   - O formato `json` (`scrapeJson`) fica restrito exclusivamente à auditoria do website do cliente (`ClientWebsiteExtractionSchema`).
 * - AJUSTE 1 (Preservação de `<strike>`/`<s>`/`<del>` em normas):
 *   - Verifica automaticamente se `doc.html` preservou tags de revogação (`<strike>`, `<s>`, `<del>`, `line-through`).
 *   - Caso `onlyMainContent: true` ou a limpeza do `html` tenha removido tags tachadas presentes em `doc.rawHtml`,
 *     seleciona automaticamente `doc.rawHtml` para nunca perder marcação de artigos revogados (ex.: páginas do Planalto).
 * - P8 / Regra 2: TODAS as chamadas (`scrape`, `map`, `search`) passam obrigatoriamente por `Bulkhead` + `CircuitBreaker`.
 * - Regra 5 / Estágio 3: Validação Anti-SSRF (`validateSafeUrlAsync`) obrigatória antes de qualquer requisição.
 */
export class FirecrawlClient {
  private static sdkInstance: any = null;

  public static readonly circuitBreaker = new CircuitBreaker({
    name: 'Firecrawl-SDK-v2',
    failureThreshold: 3,
    resetTimeoutMs: 25000,
    successThreshold: 2,
  });

  public static readonly bulkhead = new Bulkhead({
    name: 'FirecrawlPool-v2',
    maxConcurrent: 6,
    maxQueue: 30,
    timeoutMs: 35000,
  });

  private static readonly STRIKE_TAG_REGEX = /<(?:strike|s|del)\b|text-decoration\s*:\s*line-through/i;

  /**
   * Sanitiza mensagens de erro garantindo que a chave FIRECRAWL_API_KEY ou tokens Bearer nunca vazem em logs
   */
  public static redactSensitiveError(rawMessage: string): string {
    if (!rawMessage) return 'Erro desconhecido na comunicação com Firecrawl';
    let sanitized = String(rawMessage);
    const activeKey = env.FIRECRAWL_API_KEY || process.env.FIRECRAWL_API_KEY || '';
    if (activeKey && activeKey.length >= 4) {
      sanitized = sanitized.split(activeKey).join('[REDACTED_FIRECRAWL_KEY]');
    }
    sanitized = sanitized
      .replace(/Bearer\s+[A-Za-z0-9\-_]+/gi, 'Bearer [REDACTED]')
      .replace(/fc-[A-Za-z0-9\-_]{6,}/gi, 'fc-[REDACTED]');
    return sanitized;
  }

  /**
   * Verifica se há chave configurada ou instância SDK ativa
   */
  public static isConfigured(): boolean {
    if (this.sdkInstance) return true;
    const key = env.FIRECRAWL_API_KEY || process.env.FIRECRAWL_API_KEY || '';
    return key.trim().length > 0;
  }

  /**
   * Obtém ou instancia o SDK oficial `@mendable/firecrawl-js` (v2)
   * Configura `maxRetries: 1` no HttpClient interno para que o CircuitBreaker governe as falhas determinísticamente.
   */
  public static getSdk(): any {
    if (this.sdkInstance) {
      return this.sdkInstance;
    }
    const apiKey = (env.FIRECRAWL_API_KEY || process.env.FIRECRAWL_API_KEY || '').trim();
    if (!apiKey) {
      throw new Error('FIRECRAWL_API_KEY não configurada em env.ts.');
    }
    this.sdkInstance = new (Firecrawl as any)({
      apiKey,
      maxRetries: 1,
    });
    return this.sdkInstance;
  }

  /**
   * Permite redefinir a instância SDK (ex.: quando a API key ou o adapter HTTP mudam em testes de contrato)
   */
  public static resetSdk(): void {
    this.sdkInstance = null;
  }

  /**
   * Permite injetar uma instância real pré-configurada do SDK `Firecrawl` (ex.: apontando para servidor HTTP de teste)
   */
  public static setSdk(customSdk: any): void {
    this.sdkInstance = customSdk;
  }

  /**
   * Executa uma operação do SDK dentro do Bulkhead + CircuitBreaker garantindo que qualquer erro
   * tenha chaves/tokens mascarados ANTES de ser registrado pelo CircuitBreaker no console/logs.
   */
  private static async executeProtected<R>(fn: () => Promise<R>): Promise<R> {
    return await this.bulkhead.execute(() =>
      this.circuitBreaker.execute(async () => {
        try {
          return await fn();
        } catch (err: any) {
          const safeMsg = this.redactSensitiveError(err?.message || String(err));
          throw new Error(safeMsg);
        }
      })
    );
  }

  /**
   * Verifica se o HTML retornado preserva tags `<strike>`, `<s>`, `<del>` ou `line-through`.
   * Se `html` perdeu as tags que existiam em `rawHtml`, retorna `rawHtml` como fonte segura para o parser jurídico.
   */
  public static selectStrikeSafeHtml(html: string, rawHtml: string): {
    effectiveHtml: string;
    preservedInCleanHtml: boolean;
  } {
    const cleanHasStrike = this.STRIKE_TAG_REGEX.test(html || '');
    const rawHasStrike = this.STRIKE_TAG_REGEX.test(rawHtml || '');

    if (rawHasStrike && !cleanHasStrike) {
      return {
        effectiveHtml: rawHtml,
        preservedInCleanHtml: false,
      };
    }

    return {
      effectiveHtml: html || rawHtml || '',
      preservedInCleanHtml: cleanHasStrike || !rawHasStrike,
    };
  }

  /**
   * 1. Scrape de página única para o fluxo de normas (ADR-001 / PONTO 2):
   * Solicita APENAS `markdown`, `html`, `rawHtml` e `links` (SEM formato `json` e SEM `limit`).
   * Garante preservação de `<strike>`/`<s>`/`<del>` via `rawHtml` quando necessário (AJUSTE 1).
   */
  public static async scrapeMarkdownAndLinks(
    url: string,
    config: FirecrawlScrapeConfig = {}
  ): Promise<FirecrawlMarkdownResult> {
    const ssrfCheck = await validateSafeUrlAsync(url);
    if (!ssrfCheck.safe) {
      throw new Error(`[SSRF Bloqueado] URL rejeitada antes de chamar Firecrawl: ${ssrfCheck.reason}`);
    }

    const sdk = this.getSdk();
    const isPlanaltoOrOfficial = /planalto\.gov\.br|in\.gov\.br|senado\.leg\.br|camara\.leg\.br/i.test(url);

    const formats: string[] = ['markdown', 'links'];
    if (config.includeHtml !== false) {
      formats.push('html');
    }
    if (config.includeRawHtml !== false || isPlanaltoOrOfficial) {
      formats.push('rawHtml');
    }

    // Contrato estrito v2: sem `limit`, sem `extract`, sem `json` no fluxo de normas
    const scrapeOptions: Record<string, any> = {
      formats,
      onlyMainContent: isPlanaltoOrOfficial ? false : (config.onlyMainContent ?? false),
      waitFor: config.waitFor ?? env.FIRECRAWL_WAIT_FOR_MS,
      timeout: config.timeout ?? env.FIRECRAWL_TIMEOUT_MS,
      autoResume: false,
    };

    try {
      const doc: any = await this.executeProtected(() => sdk.scrape(url, scrapeOptions));

      // Na v2 do SDK, `scrape` retorna `Document` direto na raiz (sem `.data`)
      const rootDoc =
        doc?.markdown !== undefined ||
        doc?.html !== undefined ||
        doc?.rawHtml !== undefined ||
        doc?.links !== undefined
          ? doc
          : doc?.data || doc || {};

      const markdown = typeof rootDoc.markdown === 'string' ? rootDoc.markdown : '';
      const rawHtml = typeof rootDoc.rawHtml === 'string' ? rootDoc.rawHtml : '';
      const rawCleanHtml = typeof rootDoc.html === 'string' ? rootDoc.html : '';

      const { effectiveHtml, preservedInCleanHtml } = this.selectStrikeSafeHtml(rawCleanHtml, rawHtml);

      const links = Array.isArray(rootDoc.links)
        ? rootDoc.links
            .map((l: any) => (typeof l === 'string' ? l : l?.url || ''))
            .filter((u: string) => u.startsWith('http'))
        : [];

      return {
        markdown,
        html: effectiveHtml,
        rawHtml: rawHtml || effectiveHtml,
        links,
        preservedStrikeTags: preservedInCleanHtml,
        metadata: rootDoc.metadata,
      };
    } catch (err: any) {
      const safeMsg = this.redactSensitiveError(err?.message || String(err));
      await prisma.systemLog.create({
        data: {
          level: 'ERROR',
          module: 'FIRECRAWL_CLIENT_V2',
          correlationId: url,
          message: `[FIRECRAWL_SCRAPE_ERROR] Falha em scrapeMarkdownAndLinks para "${url}": ${safeMsg}`,
          details: JSON.stringify({ url, operation: 'scrapeMarkdownAndLinks', error: safeMsg }),
        },
      }).catch(() => {});
      throw new Error(safeMsg);
    }
  }

  /**
   * 2. Scrape com Extração Estruturada JSON validada via Zod (`{ type: "json", prompt, schema }` na API v2).
   * RESTRITO à auditoria de websites de clientes (`ClientWebsiteExtractionSchema`) conforme ADR-001 (PONTO 2).
   */
  public static async scrapeJson<T>(
    url: string,
    schema: z.ZodType<T>,
    prompt: string,
    config: FirecrawlScrapeConfig = {}
  ): Promise<FirecrawlJsonResult<T>> {
    const ssrfCheck = await validateSafeUrlAsync(url);
    if (!ssrfCheck.safe) {
      throw new Error(`[SSRF Bloqueado] URL rejeitada antes de chamar Firecrawl: ${ssrfCheck.reason}`);
    }

    const sdk = this.getSdk();
    const formats: any[] = [
      'markdown',
      'links',
      ...(config.includeHtml ? ['html'] : []),
      {
        type: 'json',
        prompt,
        schema,
      },
    ];

    // Contrato estrito v2: sem `limit` e sem propriedade top-level `extract`
    const scrapeOptions: Record<string, any> = {
      formats,
      onlyMainContent: config.onlyMainContent ?? true,
      waitFor: config.waitFor ?? env.FIRECRAWL_WAIT_FOR_MS,
      timeout: config.timeout ?? env.FIRECRAWL_TIMEOUT_MS,
      autoResume: false,
    };

    try {
      const doc: any = await this.executeProtected(() => sdk.scrape(url, scrapeOptions));

      const rootDoc =
        doc?.json !== undefined ||
        doc?.markdown !== undefined ||
        doc?.html !== undefined ||
        doc?.links !== undefined
          ? doc
          : doc?.data || doc || {};

      const markdown = typeof rootDoc.markdown === 'string' ? rootDoc.markdown : '';
      const html = typeof rootDoc.html === 'string' ? rootDoc.html : '';
      const rawHtml = typeof rootDoc.rawHtml === 'string' ? rootDoc.rawHtml : html;
      const links = Array.isArray(rootDoc.links)
        ? rootDoc.links
            .map((l: any) => (typeof l === 'string' ? l : l?.url || ''))
            .filter((u: string) => u.startsWith('http'))
        : [];

      const rawJsonPayload = rootDoc.json !== undefined ? rootDoc.json : null;
      if (rawJsonPayload === null || rawJsonPayload === undefined) {
        return {
          data: null,
          markdown,
          html,
          rawHtml,
          links,
          preservedStrikeTags: true,
          metadata: rootDoc.metadata,
          validationError: 'Firecrawl v2 não retornou campo estruturado doc.json.',
        };
      }

      const parsed = schema.safeParse(rawJsonPayload);
      if (!parsed.success) {
        return {
          data: null,
          markdown,
          html,
          rawHtml,
          links,
          preservedStrikeTags: true,
          metadata: rootDoc.metadata,
          validationError: parsed.error.message,
        };
      }

      return {
        data: parsed.data,
        markdown,
        html,
        rawHtml,
        links,
        preservedStrikeTags: true,
        metadata: rootDoc.metadata,
      };
    } catch (err: any) {
      const safeMsg = this.redactSensitiveError(err?.message || String(err));
      await prisma.systemLog.create({
        data: {
          level: 'ERROR',
          module: 'FIRECRAWL_CLIENT_V2',
          correlationId: url,
          message: `[FIRECRAWL_JSON_ERROR] Falha em scrapeJson para "${url}": ${safeMsg}`,
          details: JSON.stringify({ url, operation: 'scrapeJson', error: safeMsg }),
        },
      }).catch(() => {});
      throw new Error(safeMsg);
    }
  }

  /**
   * 3. Descoberta determinística de URLs do domínio via `/v2/map` (`sdk.map(url, { limit, search })`)
   */
  public static async mapUrl(
    url: string,
    options: { limit?: number; search?: string; includeSubdomains?: boolean } = {}
  ): Promise<string[]> {
    const ssrfCheck = await validateSafeUrlAsync(url);
    if (!ssrfCheck.safe) {
      throw new Error(`[SSRF Bloqueado] URL rejeitada em mapUrl: ${ssrfCheck.reason}`);
    }

    if (!this.isConfigured()) {
      return [];
    }

    const sdk = this.getSdk();
    const mapOptions: Record<string, any> = {
      limit: options.limit ?? env.CRAWL_MAX_LINKS_PER_PAGE,
      includeSubdomains: options.includeSubdomains ?? false,
    };
    if (options.search) {
      mapOptions.search = options.search;
    }

    try {
      const mapData: any = await this.executeProtected(() => sdk.map(url, mapOptions));

      // Na v2, MapData = { links: SearchResultWeb[] } onde cada item é { url, title?, description? }
      const rawLinks: any[] = Array.isArray(mapData?.links)
        ? mapData.links
        : Array.isArray(mapData)
        ? mapData
        : [];

      const validUrls: string[] = [];
      for (const item of rawLinks) {
        const candidateUrl = typeof item === 'string' ? item.trim() : String(item?.url || '').trim();
        if (candidateUrl.startsWith('http')) {
          const label =
            typeof item === 'string' ? '' : String(item?.title || item?.metadata?.title || '').trim();
          if (isNavigationLabel(label)) continue;

          const safeCandidate = await validateSafeUrlAsync(candidateUrl);
          if (safeCandidate.safe) {
            validUrls.push(candidateUrl);
          }
        }
      }

      return Array.from(new Set(validUrls));
    } catch (err: any) {
      const safeMsg = this.redactSensitiveError(err?.message || String(err));
      await prisma.systemLog.create({
        data: {
          level: 'WARN',
          module: 'FIRECRAWL_CLIENT_V2',
          correlationId: url,
          message: `[FIRECRAWL_MAP_WARN] Aviso ao mapear "${url}": ${safeMsg}`,
          details: JSON.stringify({ url, operation: 'mapUrl', error: safeMsg }),
        },
      }).catch(() => {});
      return [];
    }
  }

  /**
   * 4. Busca Web via `/v2/search` (`sdk.search(query, req)`)
   *
   * IMPORTANTE (P2 & PONTO 2):
   * - Na v2 do SDK, `SearchData` define um getter em `.data` que lança exceção!
   *   Este método NUNCA acessa `searchResp.data`; lê exclusivamente `searchResp.web`.
   * - No fluxo de normas, solicita apenas `formats: ['markdown', 'links']` (sem `json` / sem `extract`).
   */
  public static async searchWeb(
    query: string,
    options: {
      limit?: number;
    } = {}
  ): Promise<FirecrawlSearchWebItem[]> {
    if (!this.isConfigured()) {
      return [];
    }

    const sdk = this.getSdk();
    const limit = Math.min(20, Math.max(1, options.limit ?? 5));

    const searchReq: Record<string, any> = {
      limit,
      scrapeOptions: {
        formats: ['markdown', 'links'],
        onlyMainContent: false,
        timeout: env.FIRECRAWL_TIMEOUT_MS,
      },
    };

    try {
      const searchResp: any = await this.executeProtected(() => sdk.search(query, searchReq));

      // NUNCA acessar `searchResp.data` (getter que lança erro em @mendable/firecrawl-js v4.52.0)!
      let rawWebItems: any[] = [];
      if (Array.isArray(searchResp)) {
        rawWebItems = searchResp;
      } else if (searchResp && typeof searchResp === 'object' && Array.isArray(searchResp.web)) {
        rawWebItems = searchResp.web;
      }

      const safeItems: FirecrawlSearchWebItem[] = [];
      for (const item of rawWebItems) {
        const itemUrl = String(item?.url || item?.link || item?.sourceUrl || '').trim();
        if (!itemUrl.startsWith('http')) continue;
        const label = String(item?.title || item?.metadata?.title || '').trim();
        if (isNavigationLabel(label)) continue;

        const safeCheck = await validateSafeUrlAsync(itemUrl);
        if (!safeCheck.safe) continue;

        safeItems.push({
          url: itemUrl,
          title: item.title || item.metadata?.title,
          description: item.description,
          markdown: item.markdown || item.content || item.description || '',
          html: item.html,
          rawHtml: item.rawHtml,
          links: Array.isArray(item.links) ? item.links : undefined,
          metadata: item.metadata,
        });
      }

      return safeItems;
    } catch (err: any) {
      const safeMsg = this.redactSensitiveError(err?.message || String(err));
      await prisma.systemLog.create({
        data: {
          level: 'ERROR',
          module: 'FIRECRAWL_CLIENT_V2',
          correlationId: query.slice(0, 80),
          message: `[FIRECRAWL_SEARCH_ERROR] Falha em searchWeb para query "${query}": ${safeMsg}`,
          details: JSON.stringify({ query, operation: 'searchWeb', error: safeMsg }),
        },
      }).catch(() => {});
      throw new Error(safeMsg);
    }
  }
}
