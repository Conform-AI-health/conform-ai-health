import axios from 'axios';
import * as cheerio from 'cheerio';
import { ExtractionMode } from '@prisma/client';
import { env } from '../config/env.js';

export interface ScrapeResult {
  url: string;
  mode: ExtractionMode;
  title: string;
  rawHtmlLength: number;
  cleanMarkdown: string;
  tokensEstimatedRaw: number;
  tokensEstimatedClean: number;
  tokensSavedPercentage: number;
  extractedEntities: {
    crms: string[];
    rqes: string[];
    states: string[];
    hasBeforeAfterMention: boolean;
    hasPromotionalPricing: boolean;
    hasGuaranteedResultMention: boolean;
  };
}

export class ScraperService {
  /**
   * Executa extração polimórfica com base no modo solicitado ou configurado
   */
  public static async scrape(url: string, mode?: ExtractionMode): Promise<ScrapeResult> {
    const selectedMode = mode || (env.EXTRACTION_MODE as ExtractionMode) || 'CHEERIO';

    try {
      switch (selectedMode) {
        case 'PUPPETEER':
          return await this.scrapeWithPuppeteer(url);
        case 'FIRECRAWL':
          return await this.scrapeWithFirecrawl(url);
        case 'MCP':
          return await this.scrapeWithMcp(url);
        case 'CHEERIO':
        default:
          return await this.scrapeWithCheerio(url);
      }
    } catch (error: any) {
      console.warn(`[Scraper] Falha no modo ${selectedMode} (${error.message}). Tentando fallback para Cheerio/HTTP...`);
      return await this.scrapeWithCheerio(url);
    }
  }

  /**
   * Extração com Cheerio (Ultra-rápido, páginas estáticas)
   */
  private static async scrapeWithCheerio(url: string): Promise<ScrapeResult> {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 (ConformIA Regulatory Auditor)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    const rawHtml = response.data;
    return this.processHtml(url, rawHtml, 'CHEERIO');
  }

  /**
   * Extração com Puppeteer Headless (Páginas SPA, React/Vue/Angular)
   */
  private static async scrapeWithPuppeteer(url: string): Promise<ScrapeResult> {
    // Importação dinâmica para evitar travar se puppeteer não estiver em ambiente headless restrito
    let browser: any = null;
    try {
      const puppeteerModule = await import('puppeteer');
      const puppeteer = puppeteerModule.default || puppeteerModule;

      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
        ],
      });

      const page = await browser.newPage();
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 (ConformIA)'
      );
      await page.setViewport({ width: 1280, height: 800 });

      // Otimização: bloquear imagens e fontes desnecessárias para acelerar
      await page.setRequestInterception(true);
      page.on('request', (req: any) => {
        const resourceType = req.resourceType();
        if (['font', 'media'].includes(resourceType)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
      const rawHtml = await page.content();
      await browser.close();

      return this.processHtml(url, rawHtml, 'PUPPETEER');
    } catch (err: any) {
      if (browser) await browser.close();
      console.warn('[Puppeteer] Falha na execução headless, recorrendo ao Cheerio:', err.message);
      return await this.scrapeWithCheerio(url);
    }
  }

  /**
   * Extração via Firecrawl API (quando configurada chave) ou fallback
   */
  private static async scrapeWithFirecrawl(url: string): Promise<ScrapeResult> {
    if (!env.FIRECRAWL_API_KEY) {
      console.info('[Firecrawl] Chave não configurada, executando Cheerio otimizado.');
      return await this.scrapeWithCheerio(url);
    }

    try {
      const response = await axios.post(
        'https://api.firecrawl.dev/v1/scrape',
        { url, formats: ['markdown', 'html'] },
        {
          headers: {
            Authorization: `Bearer ${env.FIRECRAWL_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 20000,
        }
      );

      const data = response.data?.data;
      const markdown = data?.markdown || '';
      const html = data?.html || '';

      return this.processHtml(url, html || markdown, 'FIRECRAWL', markdown);
    } catch (err: any) {
      console.warn('[Firecrawl] Falha na chamada da API Firecrawl, fallback para Cheerio:', err.message);
      return await this.scrapeWithCheerio(url);
    }
  }

  /**
   * Extração via Protocolo MCP (Model Context Protocol)
   */
  private static async scrapeWithMcp(url: string): Promise<ScrapeResult> {
    try {
      const response = await axios.post(
        `${env.MCP_SERVER_URL}/tools/fetch_page`,
        { url },
        { timeout: 15000 }
      );
      const content = response.data?.content || '';
      return this.processHtml(url, content, 'MCP');
    } catch (err: any) {
      console.warn('[MCP] Falha na chamada MCP, fallback para Cheerio:', err.message);
      return await this.scrapeWithCheerio(url);
    }
  }

  /**
   * Sanitização rigorosa de HTML e extração estruturada de entidades deontológicas
   */
  public static processHtml(
    url: string,
    rawHtml: string,
    mode: ExtractionMode,
    precomputedMarkdown?: string
  ): ScrapeResult {
    const $ = cheerio.load(rawHtml);

    // 1. Remover elementos indesejados e pesados
    $(
      'script, style, svg, iframe, noscript, header nav, footer ul.social-icons, link[rel="stylesheet"], .advertisement, #cookie-banner, .popup'
    ).remove();

    // 2. Extrair título
    const title = $('title').text().trim() || $('h1').first().text().trim() || 'Página sem título';

    // 3. Montar Markdown Limpo (caso não venha do Firecrawl)
    let cleanMarkdown = precomputedMarkdown || '';
    if (!cleanMarkdown) {
      const parts: string[] = [];

      parts.push(`# ${title}\n`);

      // Títulos e subtítulos
      $('h1, h2, h3, h4').each((_, el) => {
        const tag = (el as any).name;
        const text = $(el).text().trim();
        if (text) {
          const hashes = tag === 'h1' ? '#' : tag === 'h2' ? '##' : tag === 'h3' ? '###' : '####';
          parts.push(`\n${hashes} ${text}\n`);
        }
      });

      // Parágrafos e listas
      $('p, li').each((_, el) => {
        const text = $(el).text().trim().replace(/\s+/g, ' ');
        if (text.length > 10) {
          parts.push(`${text}\n`);
        }
      });

      // Atributos de imagens (relevante para auditoria de Antes e Depois)
      $('img').each((_, el) => {
        const alt = $(el).attr('alt') || '';
        const src = $(el).attr('src') || '';
        if (alt || src.toLowerCase().includes('antes') || src.toLowerCase().includes('depois')) {
          parts.push(`![Imagem Médica: ${alt}](${src})\n`);
        }
      });

      cleanMarkdown = parts.join('\n');
    }

    // 4. Detecção de Entidades Deontológicas via Regex
    const fullText = (cleanMarkdown + ' ' + rawHtml).toLowerCase();

    // CRM Regex: busca CRM/UF 12345 ou CRM 12345-SP ou CRM-SP: 12345
    const crmRegex = /crm[-/\s]?([a-z]{2})?[:\s]*(\d{4,8})([-/\s]?([a-z]{2}))?/gi;
    const crms: string[] = [];
    let match;
    while ((match = crmRegex.exec(cleanMarkdown)) !== null) {
      crms.push(match[0].trim());
    }

    // RQE Regex: busca RQE 12345 ou RQE: 1234
    const rqeRegex = /rqe[:\s]*(\d{3,6})/gi;
    const rqes: string[] = [];
    while ((match = rqeRegex.exec(cleanMarkdown)) !== null) {
      rqes.push(match[0].trim());
    }

    // Estados médicos mencionados
    const ufs = ['SP', 'RJ', 'MG', 'RS', 'PR', 'SC', 'BA', 'PE', 'CE', 'GO', 'DF', 'ES'];
    const detectedStates = ufs.filter((uf) =>
      new RegExp(`\\b${uf}\\b`, 'i').test(cleanMarkdown)
    );

    // Heurísticas de infrações frequentes
    const hasBeforeAfterMention =
      fullText.includes('antes e depois') ||
      fullText.includes('antes/depois') ||
      fullText.includes('before and after') ||
      fullText.includes('transformação');

    const hasPromotionalPricing =
      fullText.includes('promoção') ||
      fullText.includes('desconto') ||
      fullText.includes('black friday') ||
      fullText.includes('sorteio') ||
      fullText.includes('consórcio') ||
      fullText.includes('cupom');

    const hasGuaranteedResultMention =
      fullText.includes('100% garantido') ||
      fullText.includes('resultado garantido') ||
      fullText.includes('cura definitiva') ||
      fullText.includes('o melhor médico') ||
      fullText.includes('a melhor clínica') ||
      fullText.includes('infalível');

    // 5. Métricas de economia de tokens
    const tokensEstimatedRaw = Math.ceil(rawHtml.length / 4);
    const tokensEstimatedClean = Math.ceil(cleanMarkdown.length / 4);
    const tokensSaved = Math.max(0, tokensEstimatedRaw - tokensEstimatedClean);
    const tokensSavedPercentage =
      tokensEstimatedRaw > 0 ? Math.round((tokensSaved / tokensEstimatedRaw) * 100) : 0;

    return {
      url,
      mode,
      title,
      rawHtmlLength: rawHtml.length,
      cleanMarkdown,
      tokensEstimatedRaw,
      tokensEstimatedClean,
      tokensSavedPercentage,
      extractedEntities: {
        crms: Array.from(new Set(crms)),
        rqes: Array.from(new Set(rqes)),
        states: detectedStates,
        hasBeforeAfterMention,
        hasPromotionalPricing,
        hasGuaranteedResultMention,
      },
    };
  }
}

