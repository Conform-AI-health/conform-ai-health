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
  detectedTags: string[];
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
   * Verifica se a URL informada aponta para uma árvore de diretório do GitHub
   */
  public static isGitHubTreeUrl(url: string): {
    isTree: boolean;
    owner?: string;
    repo?: string;
    branch?: string;
    path?: string;
  } {
    const match = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/?(.*)$/i);
    if (match) {
      return {
        isTree: true,
        owner: match[1],
        repo: match[2],
        branch: match[3],
        path: match[4] || '',
      };
    }
    return { isTree: false };
  }

  /**
   * Verifica se a URL informada é um arquivo individual (blob) no GitHub
   */
  public static isGitHubBlobUrl(url: string): {
    isBlob: boolean;
    owner?: string;
    repo?: string;
    branch?: string;
    path?: string;
  } {
    const match = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i);
    if (match) {
      return {
        isBlob: true,
        owner: match[1],
        repo: match[2],
        branch: match[3],
        path: match[4],
      };
    }
    return { isBlob: false };
  }

  /**
   * Executa varredura em lote de um diretório do GitHub, baixando todos os arquivos da pasta
   */
  public static async scrapeGitHubTree(treeUrl: string, customTags?: string[]): Promise<ScrapeResult[]> {
    const treeInfo = this.isGitHubTreeUrl(treeUrl);
    if (!treeInfo.isTree || !treeInfo.owner || !treeInfo.repo) {
      throw new Error('A URL fornecida não é uma árvore de diretório válida do GitHub.');
    }

    const { owner, repo, branch = 'main', path = '' } = treeInfo;
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;

    console.log(`📂 [Scraper] Varrendo diretório GitHub via API: ${apiUrl}`);

    const ghHeaders: Record<string, string> = {
      'User-Agent': 'ConformIA-Regulatory-Auditor (Health Deontology)',
      Accept: 'application/vnd.github.v3+json',
    };

    if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) {
      ghHeaders['Authorization'] = `token ${process.env.GITHUB_TOKEN || process.env.GH_TOKEN}`;
    }

    const contentsResponse = await axios.get(apiUrl, {
      headers: ghHeaders,
      timeout: 20000,
    });

    if (!Array.isArray(contentsResponse.data)) {
      throw new Error('O caminho fornecido no GitHub não aponta para um diretório com múltiplos arquivos.');
    }

    // Filtra apenas arquivos suportados (.md, .txt, .json, .html)
    const files = contentsResponse.data
      .filter((item: any) => item.type === 'file')
      .slice(0, 50); // Trava de segurança: máximo 50 arquivos por lote

    if (files.length === 0) {
      throw new Error('Nenhum arquivo de documento elegível foi encontrado neste diretório.');
    }

    console.log(`📄 [Scraper] Encontrados ${files.length} arquivos no diretório GitHub. Baixando e processando...`);

    const results: ScrapeResult[] = [];

    // Processamento com concorrência controlada (lotes de 5)
    const chunkSize = 5;
    for (let i = 0; i < files.length; i += chunkSize) {
      const chunk = files.slice(i, i + chunkSize);
      const chunkPromises = chunk.map(async (fileItem: any) => {
        try {
          const rawUrl =
            fileItem.download_url ||
            `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${fileItem.path}`;

          const fileResp = await axios.get(rawUrl, {
            timeout: 15000,
            headers: {
              'User-Agent': 'ConformIA-Regulatory-Auditor',
            },
          });

          const rawContent = typeof fileResp.data === 'string' ? fileResp.data : JSON.stringify(fileResp.data, null, 2);

          // Extrai título amigável (tenta pegar o primeiro # H1 do markdown ou usa o nome do arquivo)
          let title = fileItem.name.replace(/\.[^/.]+$/, '');
          const h1Match = rawContent.match(/^#\s+(.+)$/m);
          if (h1Match && h1Match[1].trim()) {
            title = h1Match[1].trim();
          }

          const cleanMarkdown = rawContent.trim();
          const tokensEstimatedRaw = Math.ceil(rawContent.length / 4);
          const tokensEstimatedClean = Math.ceil(cleanMarkdown.length / 4);

          // Detecção de tags e entidades
          const detectedTags = this.detectRegulatoryTags(cleanMarkdown, rawContent);
          const effectiveTags = Array.from(new Set([...(customTags || []), ...detectedTags]));

          // Extração de entidades
          const crmRegex = /crm[-/\s]?([a-z]{2})?[:\s]*(\d{4,8})([-/\s]?([a-z]{2}))?/gi;
          const crms: string[] = [];
          let m;
          while ((m = crmRegex.exec(cleanMarkdown)) !== null) {
            crms.push(m[0].trim());
          }

          const rqeRegex = /rqe[:\s]*(\d{3,6})/gi;
          const rqes: string[] = [];
          while ((m = rqeRegex.exec(cleanMarkdown)) !== null) {
            rqes.push(m[0].trim());
          }

          const ufs = ['SP', 'RJ', 'MG', 'RS', 'PR', 'SC', 'BA', 'PE', 'CE', 'GO', 'DF', 'ES'];
          const detectedStates = ufs.filter((uf) =>
            new RegExp(`\\b${uf}\\b`, 'i').test(cleanMarkdown)
          );

          const fullText = cleanMarkdown.toLowerCase();

          return {
            url: fileItem.html_url || fileItem.url || rawUrl,
            mode: 'CHEERIO' as ExtractionMode,
            title,
            rawHtmlLength: rawContent.length,
            cleanMarkdown,
            tokensEstimatedRaw,
            tokensEstimatedClean,
            tokensSavedPercentage: 0,
            detectedTags: effectiveTags,
            extractedEntities: {
              crms: Array.from(new Set(crms)),
              rqes: Array.from(new Set(rqes)),
              states: detectedStates,
              hasBeforeAfterMention: fullText.includes('antes e depois') || fullText.includes('antes/depois'),
              hasPromotionalPricing: fullText.includes('promoção') || fullText.includes('desconto'),
              hasGuaranteedResultMention: fullText.includes('100% garantido') || fullText.includes('resultado garantido'),
            },
          } as ScrapeResult;
        } catch (err: any) {
          console.warn(`[Scraper] Erro ao baixar arquivo ${fileItem.name}: ${err.message}`);
          return null;
        }
      });

      const chunkResults = await Promise.all(chunkPromises);
      for (const res of chunkResults) {
        if (res) results.push(res);
      }
    }

    return results;
  }

  /**
   * Executa extração polimórfica com base no modo solicitado ou configurado
   */
  public static async scrape(url: string, mode?: ExtractionMode): Promise<ScrapeResult> {
    // Se for um arquivo blob único do GitHub, baixa o raw diretamente
    const blobInfo = this.isGitHubBlobUrl(url);
    if (blobInfo.isBlob && blobInfo.owner && blobInfo.repo && blobInfo.branch && blobInfo.path) {
      const rawUrl = `https://raw.githubusercontent.com/${blobInfo.owner}/${blobInfo.repo}/${blobInfo.branch}/${blobInfo.path}`;
      const resp = await axios.get(rawUrl, { timeout: 15000 });
      const rawText = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
      return this.processHtml(url, `<html><head><title>${blobInfo.path}</title></head><body><pre>${rawText}</pre></body></html>`, 'CHEERIO');
    }
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

    // 6. Detecção e Auto-Tagging Regulatória (CFM, LGPD, ANVISA, ANS)
    const detectedTags = this.detectRegulatoryTags(cleanMarkdown, rawHtml);

    return {
      url,
      mode,
      title,
      rawHtmlLength: rawHtml.length,
      cleanMarkdown,
      tokensEstimatedRaw,
      tokensEstimatedClean,
      tokensSavedPercentage,
      detectedTags,
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

  /**
   * Classificador Deontológico Heurístico de Tags:
   * CFM (Médico), LGPD (Dados), ANVISA (Sanitário), ANS (Saúde Suplementar)
   */
  public static detectRegulatoryTags(cleanMarkdown: string, rawHtml: string): string[] {
    const textLower = (cleanMarkdown + ' ' + rawHtml).toLowerCase();
    const tags: string[] = [];

    // Tag CFM (Médico)
    const cfmSignals = [
      'crm',
      'rqe',
      'médic',
      'dermatolog',
      'cirurgi',
      'cardiolog',
      'ortoped',
      'pediatr',
      'consulta',
      'antes e depois',
      'antes/depois',
      'paciente',
      'tratamento',
      'prescrição',
    ];
    if (cfmSignals.some((sig) => textLower.includes(sig))) {
      tags.push('CFM');
    }

    // Tag LGPD (Dados e Privacidade)
    const lgpdSignals = [
      'privacidade',
      'lgpd',
      'dados pessoais',
      'consentimento',
      'termo de uso',
      'cookies',
      'agendar online',
      'agendamento',
      'formulário',
      'input',
      'fale conosco',
      'cadastre-se',
    ];
    if (lgpdSignals.some((sig) => textLower.includes(sig))) {
      tags.push('LGPD');
    }

    // Tag ANVISA (Vigilância Sanitária e Produtos)
    const anvisSignals = [
      'anvisa',
      'medicamento',
      'remédio',
      'tarja vermelha',
      'tarja preta',
      'toxina botulínica',
      'botox',
      'fármaco',
      'ácido hialurônico',
      'efeito terapêutico',
      'substância',
      'cosmético',
    ];
    if (anvisSignals.some((sig) => textLower.includes(sig))) {
      tags.push('ANVISA');
    }

    // Tag ANS (Saúde Suplementar e Planos)
    const ansSignals = [
      'ans',
      'plano de saúde',
      'convênio',
      'operadora',
      'unimed',
      'bradesco saúde',
      'sulamérica',
      'amil',
      'rede credenciada',
      'carência',
      'reembolso',
      'rol de procedimentos',
    ];
    if (ansSignals.some((sig) => textLower.includes(sig))) {
      tags.push('ANS');
    }

    // Padrão mínimo: se nenhuma específica bater, assume CFM por ser plataforma deontológica de saúde
    if (tags.length === 0) {
      tags.push('CFM');
    }

    return tags;
  }
}

