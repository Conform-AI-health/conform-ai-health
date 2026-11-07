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
   * Verifica se a URL informada pertence ao portal da Imprensa Nacional / Diário Oficial da União (DOU)
   */
  public static isDouUrl(url: string): boolean {
    return /in\.gov\.br\/(leiturajornal|consulta|web\/dou)/i.test(url);
  }

  /**
   * Verifica se a URL informada aponta para um arquivo PDF
   */
  public static isPdfUrl(url: string): boolean {
    return /\.pdf($|\?|#)/i.test(url);
  }

  /**
   * Resolve espelho oficial aberto para normas quando o portal de origem estiver protegido por WAF/desafios
   */
  public static resolveCanonicalMirror(url: string): {
    hasMirror: boolean;
    mirrorUrl?: string;
    canonicalTitle?: string;
    tags?: string[];
  } {
    const lower = url.toLowerCase();

    // LGPD - Lei nº 13.709/2018 (Senado Federal, Câmara ou BDSF)
    if (
      (lower.includes('senado.leg.br') || lower.includes('camara.leg.br')) &&
      (lower.includes('lei_geral_protecao_dados') || lower.includes('lgpd') || lower.includes('658231') || lower.includes('13709'))
    ) {
      return {
        hasMirror: true,
        mirrorUrl: 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm',
        canonicalTitle: 'Lei Geral de Proteção de Dados Pessoais (LGPD - Lei nº 13.709/2018)',
        tags: ['LGPD'],
      };
    }

    // Código de Ética Médica / CFM Resolução 2.336/2023
    if (lower.includes('2336') && (lower.includes('cfm') || lower.includes('resolucao'))) {
      return {
        hasMirror: true,
        mirrorUrl: 'https://sistemas.cfm.org.br/normas/visualizar/resolucoes/BR/2023/2336',
        canonicalTitle: 'Resolução CFM nº 2.336/2023 (Publicidade Médica)',
        tags: ['CFM'],
      };
    }

    return { hasMirror: false };
  }

  /**
   * Extração de entidades deontológicas, números de registro e heurísticas de infração
   */
  public static extractEntities(cleanMarkdown: string, rawHtml: string) {
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

    return {
      crms: Array.from(new Set(crms)),
      rqes: Array.from(new Set(rqes)),
      states: detectedStates,
      hasBeforeAfterMention,
      hasPromotionalPricing,
      hasGuaranteedResultMention,
    };
  }

  /**
   * Converte bloco HTML em Markdown limpo estruturado
   */
  public static htmlToMarkdown(html: string): string {
    if (!html) return '';
    const $ = cheerio.load(`<div>${html}</div>`);
    $('script, style, svg, iframe, noscript, header nav, footer').remove();

    const parts: string[] = [];
    $('h1, h2, h3, h4, p, li, div.dou-paragraph, span.dou-paragraph').each((_, el) => {
      const tag = (el as any).name;
      const text = $(el).text().trim().replace(/\s+/g, ' ');
      if (text.length > 0) {
        if (tag === 'h1') parts.push(`\n# ${text}\n`);
        else if (tag === 'h2') parts.push(`\n## ${text}\n`);
        else if (tag === 'h3') parts.push(`\n### ${text}\n`);
        else if (tag === 'h4') parts.push(`\n#### ${text}\n`);
        else parts.push(`${text}\n`);
      }
    });

    return parts.join('\n').trim();
  }

  /**
   * Baixa e extrai texto de documentos regulatórios em formato PDF (ex: Leis do Senado, Resoluções CFM, ANVISA)
   */
  public static async scrapePdf(url: string, customTags?: string[]): Promise<ScrapeResult> {
    console.log(`📑 [Scraper PDF] Baixando e extraindo documento PDF oficial: ${url}`);

    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 (ConformIA Regulatory Auditor)',
      Accept: 'application/pdf,application/octet-stream,*/*',
    };

    const resp = await axios.get(url, {
      responseType: 'arraybuffer',
      headers,
      timeout: 35000,
      maxContentLength: 50 * 1024 * 1024, // Limite de 50MB
    });

    const buffer = Buffer.from(resp.data);

    // Validação da assinatura binária de arquivos PDF (%PDF-)
    const isRealPdf = buffer.subarray(0, 5).toString('ascii').startsWith('%PDF');
    if (!isRealPdf) {
      const textSnippet = buffer.subarray(0, 2500).toString('utf-8');
      
      // Detecção de Desafio de Segurança / WAF Anti-Bot (ex: Senado Federal, Cloudflare)
      if (
        textSnippet.includes('Verificação de segurança') ||
        textSnippet.includes('challenge') ||
        textSnippet.includes('captcha') ||
        textSnippet.includes('cloudflare') ||
        textSnippet.includes('cf-browser-verification')
      ) {
        // Tenta resolução automática via espelho canônico aberto oficial (ex: Planalto para LGPD)
        const mirror = this.resolveCanonicalMirror(url);
        if (mirror.hasMirror && mirror.mirrorUrl) {
          console.info(`🔄 [Scraper PDF] Portal com WAF/desafio. Redirecionando transparentemente para o repositório oficial aberto: ${mirror.mirrorUrl}`);
          const mirrorRes = await this.scrape(mirror.mirrorUrl, 'CHEERIO');
          if (mirror.canonicalTitle) {
            mirrorRes.title = mirror.canonicalTitle;
          }
          if (mirror.tags) {
            mirrorRes.detectedTags = Array.from(new Set([...mirrorRes.detectedTags, ...mirror.tags]));
          }
          if (customTags && customTags.length > 0) {
            mirrorRes.detectedTags = Array.from(new Set([...customTags, ...mirrorRes.detectedTags]));
          }
          mirrorRes.url = url; // Mantém a URL de referência do usuário
          return mirrorRes;
        }

        let domain = url;
        try {
          domain = new URL(url).hostname;
        } catch (e) {}

        throw new Error(
          `O portal (${domain}) bloqueou a requisição automatizada com um desafio anti-bot/WAF ('Verificação de segurança'). Por políticas estritas de deontologia e segurança, desafios interativos de verificação humana não podem ser contornados programaticamente. Sugestão: faça o upload direto do arquivo PDF ou utilize o repositório oficial aberto da norma (ex: Planalto.gov.br para a LGPD).`
        );
      }

      // Se a URL com .pdf na verdade retornou uma página HTML válida (ex: landing page de download)
      if (textSnippet.includes('<html') || textSnippet.includes('<!DOCTYPE')) {
        console.info(`[Scraper PDF] URL retornou página HTML em vez de binário PDF puro. Processando via Cheerio...`);
        return this.processHtml(url, buffer.toString('utf-8'), 'CHEERIO');
      }

      throw new Error('O arquivo retornado pelo servidor não possui assinatura binária válida de documento PDF.');
    }

    let extractedText = '';
    let pdfTitle = '';
    let totalPages = 1;

    try {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: buffer });
      const textResult = await parser.getText();
      extractedText = textResult.text || '';
      totalPages = textResult.total || 1;

      try {
        const infoResult = await parser.getInfo();
        if (infoResult?.info?.Title && typeof infoResult.info.Title === 'string' && infoResult.info.Title.trim().length > 3) {
          pdfTitle = infoResult.info.Title.trim();
        }
      } catch (e) {}

      await parser.destroy();
    } catch (err: any) {
      console.warn(`[Scraper PDF] Falha na extração de texto via PDFParse: ${err.message}`);
      throw new Error(`Falha ao ler conteúdo textual do PDF: ${err.message}`);
    }

    // Se o título não veio nos metadados do PDF, extrai a partir do nome do arquivo na URL
    if (!pdfTitle) {
      try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        const filename = pathname.split('/').pop()?.replace(/\.pdf$/i, '') || '';
        if (filename) {
          pdfTitle = decodeURIComponent(filename)
            .replace(/[_-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          pdfTitle = pdfTitle
            .split(' ')
            .map((w) => (w.length > 2 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
            .join(' ');
        }
      } catch (e) {}
    }

    // Se ainda não tiver título, usa a primeira linha textual
    if (!pdfTitle || pdfTitle.length < 3) {
      const firstLines = extractedText.split('\n').map((l) => l.trim()).filter((l) => l.length > 5);
      pdfTitle = firstLines[0] ? firstLines[0].substring(0, 120) : 'Documento Regulatório Oficial (PDF)';
    }

    // Formatação de parágrafos do texto extraído
    const cleanLines = extractedText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const formattedBody = cleanLines.join('\n\n');

    const cleanMarkdown = [
      `# ${pdfTitle}`,
      '',
      `- **Fonte Oficial:** [${url}](${url})`,
      `- **Formato:** Arquivo PDF Oficial (${totalPages} página${totalPages > 1 ? 's' : ''})`,
      `- **Tamanho do Arquivo:** ${Math.round(buffer.length / 1024)} KB`,
      '',
      '---',
      '',
      '## Conteúdo Integral do Documento Regulatório',
      formattedBody,
    ].join('\n').trim();

    const detectedTags = this.detectRegulatoryTags(cleanMarkdown, extractedText);
    const effectiveTags = Array.from(new Set([...(customTags || []), ...detectedTags]));
    const extractedEntities = this.extractEntities(cleanMarkdown, extractedText);

    const tokensEstimatedRaw = Math.ceil(buffer.length / 4);
    const tokensEstimatedClean = Math.ceil(cleanMarkdown.length / 4);
    const tokensSaved = Math.max(0, tokensEstimatedRaw - tokensEstimatedClean);
    const tokensSavedPercentage =
      tokensEstimatedRaw > 0 ? Math.round((tokensSaved / tokensEstimatedRaw) * 100) : 0;

    return {
      url,
      mode: 'CHEERIO' as ExtractionMode,
      title: pdfTitle,
      rawHtmlLength: buffer.length,
      cleanMarkdown,
      tokensEstimatedRaw,
      tokensEstimatedClean,
      tokensSavedPercentage,
      detectedTags: effectiveTags,
      extractedEntities,
    };
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
          const extractedEntities = this.extractEntities(cleanMarkdown, rawContent);

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
            extractedEntities,
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
   * Varredura especializada do Diário Oficial da União (in.gov.br):
   * Navega por submenus, paginação e payload jsonArray para indexar cada ato/resolução como um documento independente
   */
  public static async scrapeDouLeituraJornal(
    targetUrl: string,
    customTags?: string[],
    mode?: ExtractionMode
  ): Promise<ScrapeResult[]> {
    console.log(`📰 [Scraper DOU] Varrendo Diário Oficial da União: ${targetUrl}`);

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(targetUrl);
    } catch (e) {
      parsedUrl = new URL(`https://www.in.gov.br${targetUrl.startsWith('/') ? '' : '/'}${targetUrl}`);
    }

    const secao = parsedUrl.searchParams.get('secao') || 'dou1';
    const dataParam = parsedUrl.searchParams.get('data') || '';
    const orgParam = parsedUrl.searchParams.get('org') || '';
    const atoParam = parsedUrl.searchParams.get('ato') || '';

    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 (ConformIA Regulatory Auditor)',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    };

    let rawHtml = '';
    try {
      const resp = await axios.get(targetUrl, { headers, timeout: 25000 });
      rawHtml = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
    } catch (err: any) {
      console.warn(`[Scraper DOU] Falha na requisição HTTP direta (${err.message}).`);
      throw new Error(`Falha ao acessar edição do Diário Oficial da União: ${err.message}`);
    }

    const $ = cheerio.load(rawHtml);
    let items: any[] = [];

    // 1. Extração estruturada do JSON oficial injetado pela Imprensa Nacional
    const paramsTag = $('script#params').html();
    if (paramsTag) {
      try {
        const parsed = JSON.parse(paramsTag.trim());
        if (Array.isArray(parsed.jsonArray)) items = parsed.jsonArray;
        else if (Array.isArray(parsed)) items = parsed;
      } catch (e) {}
    }

    if (items.length === 0) {
      $('script').each((_, el) => {
        const scriptText = $(el).html() || '';
        if (scriptText.includes('jsonArray')) {
          const match =
            scriptText.match(/["']?jsonArray["']?\s*:\s*(\[[\s\S]*?\])\s*[,}\n]/) ||
            scriptText.match(/var\s+jsonArray\s*=\s*(\[[\s\S]*?\]);/) ||
            scriptText.match(/(\{"jsonArray":\s*\[[\s\S]*?\]\})/);
          if (match && match[1]) {
            try {
              const raw = match[1].trim();
              const parsed = JSON.parse(raw.startsWith('{') ? raw : `{"arr":${raw}}`);
              const arr = Array.isArray(parsed) ? parsed : (parsed.arr || parsed.jsonArray);
              if (Array.isArray(arr) && arr.length > 0) {
                items = arr;
              }
            } catch (e) {}
          }
        }
      });
    }

    // 2. Se jsonArray foi localizado, processa cada ato como um documento individual
    if (items.length > 0) {
      console.log(`📄 [Scraper DOU] ${items.length} matérias identificadas no payload jsonArray.`);

      let filtered = items;
      if (orgParam) {
        const lowerOrg = orgParam.toLowerCase();
        const sub = items.filter((it: any) => {
          const o = (it.orgao || it.orgaoSiorgName || (Array.isArray(it.hierarchyList) ? it.hierarchyList.join(' ') : '')).toLowerCase();
          return o.includes(lowerOrg);
        });
        if (sub.length > 0) filtered = sub;
      }

      if (atoParam) {
        const lowerAto = atoParam.toLowerCase();
        const sub = filtered.filter((it: any) => {
          const a = (it.artType || it.art_category || it.title || it.identifica || '').toLowerCase();
          return a.includes(lowerAto);
        });
        if (sub.length > 0) filtered = sub;
      }

      console.log(`🎯 [Scraper DOU] ${filtered.length} matérias selecionadas após filtros de órgão e ato.`);

      const results: ScrapeResult[] = [];
      const toProcess = filtered.slice(0, 50); // Limite de até 50 atos por varredura

      for (const item of toProcess) {
        const title = item.identifica || item.title || item.desTitle || 'Ato Normativo Oficial - DOU';
        const urlTitle = item.urlTitle || '';
        const docUrl = urlTitle.startsWith('http')
          ? urlTitle
          : (urlTitle ? `https://www.in.gov.br/web/dou/-/${urlTitle}` : `${targetUrl}#${item.id || Math.random().toString(36).substring(2, 7)}`);

        const org = item.orgao || item.orgaoSiorgName || (Array.isArray(item.hierarchyList) ? item.hierarchyList.join(' / ') : orgParam || 'Ministério da Saúde');
        const pubDate = item.pubDate || item.publicacao || dataParam || 'DOU';
        const edicao = item.edicao || 'N/A';
        const numberPage = item.numberPage || item.pagina || 'N/A';
        const artType = item.artType || item.art_category || atoParam || 'Resolução';

        let contentHtml = item.texto || item.content || item.corpo || item.desSummary || item.resumo || '';

        // Se o texto vier resumido no JSON e houver urlTitle, busca o artigo completo
        if (contentHtml.length < 150 && urlTitle && !urlTitle.startsWith('javascript:')) {
          try {
            const indResp = await axios.get(docUrl, { headers, timeout: 8000 });
            const ind$ = cheerio.load(indResp.data);
            const fullArticle = ind$('.texto-dou, .dou-paragraph, article, .materia-conteudo').html();
            if (fullArticle && fullArticle.length > 100) {
              contentHtml = fullArticle;
            }
          } catch (e) {}
        }

        const bodyMarkdown = this.htmlToMarkdown(contentHtml || item.desSummary || title);

        const cleanMarkdown = [
          `# ${title}`,
          '',
          `- **Órgão Emissor:** ${org}`,
          `- **Publicação:** Diário Oficial da União (${secao.toUpperCase()}) | Data: ${pubDate} | Edição: ${edicao} | Página: ${numberPage}`,
          `- **Classificação Legal:** ${artType}`,
          '',
          '---',
          '',
          '## Ementa & Identificação',
          item.desSummary || item.resumo || title,
          '',
          '## Texto Integral do Ato',
          bodyMarkdown,
        ].join('\n').trim();

        const detectedTags = this.detectRegulatoryTags(cleanMarkdown, contentHtml);
        const effectiveTags = Array.from(new Set([...(customTags || []), ...detectedTags]));
        const extractedEntities = this.extractEntities(cleanMarkdown, contentHtml);

        const tokensEstimatedRaw = Math.ceil((contentHtml.length || cleanMarkdown.length) / 4);
        const tokensEstimatedClean = Math.ceil(cleanMarkdown.length / 4);

        results.push({
          url: docUrl,
          mode: 'CHEERIO' as ExtractionMode,
          title,
          rawHtmlLength: contentHtml.length,
          cleanMarkdown,
          tokensEstimatedRaw,
          tokensEstimatedClean,
          tokensSavedPercentage: 0,
          detectedTags: effectiveTags,
          extractedEntities,
        });
      }

      if (results.length > 0) return results;
    }

    // 3. Fallback no DOM: Se jsonArray não estiver presente, varre links de matérias no HTML e paginação
    console.log('[Scraper DOU] Varrendo links de matérias no HTML e paginação...');
    const discoveredLinks: { url: string; title: string }[] = [];

    $('a[href*="/web/dou/-/"], a[href*="/en/web/dou/-/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().trim();
      if (href && text && !href.includes('#') && !href.startsWith('javascript:')) {
        const full = href.startsWith('http') ? href : `https://www.in.gov.br${href.startsWith('/') ? '' : '/'}${href}`;
        if (!discoveredLinks.some((d) => d.url === full)) {
          discoveredLinks.push({ url: full, title: text });
        }
      }
    });

    // Detectar páginas adicionais / paginação
    const paginationHrefs: string[] = [];
    $('a[href*="pagina="], a[href*="page="], ul.pagination a, .pagination a').each((_, el) => {
      const h = $(el).attr('href') || '';
      if (h && !h.startsWith('#') && !h.startsWith('javascript:')) {
        const full = h.startsWith('http') ? h : `https://www.in.gov.br${h.startsWith('/') ? '' : '/'}${h}`;
        if (full !== targetUrl && !paginationHrefs.includes(full)) {
          paginationHrefs.push(full);
        }
      }
    });

    // Se encontrou links de matérias, baixa individualmente cada uma
    if (discoveredLinks.length > 0) {
      console.log(`🔗 [Scraper DOU] Encontrados ${discoveredLinks.length} links de matérias individuais.`);
      const results: ScrapeResult[] = [];
      const toFetch = discoveredLinks.slice(0, 30);

      for (const linkItem of toFetch) {
        try {
          const actResp = await axios.get(linkItem.url, { headers, timeout: 10000 });
          const processed = this.processHtml(linkItem.url, actResp.data, 'CHEERIO');
          if (customTags && customTags.length > 0) {
            processed.detectedTags = Array.from(new Set([...customTags, ...processed.detectedTags]));
          }
          if (linkItem.title && (!processed.title || processed.title === 'Página sem título')) {
            processed.title = linkItem.title;
          }
          results.push(processed);
        } catch (e: any) {
          console.warn(`[Scraper DOU] Falha ao baixar matéria ${linkItem.url}: ${e.message}`);
        }
      }

      if (results.length > 0) return results;
    }

    // 4. Se nenhum ato específico foi localizado, processa a página como documento único
    console.log('[Scraper DOU] Nenhuma matéria individual identificada separadamente. Retornando página integral.');
    return [this.processHtml(targetUrl, rawHtml, 'CHEERIO')];
  }

  /**
   * Varredura genérica de portais regulatórios com suporte a paginação e submenus
   */
  public static async scrapeMultiDocListing(
    targetUrl: string,
    customTags?: string[],
    mode?: ExtractionMode
  ): Promise<ScrapeResult[]> {
    console.log(`🌐 [MultiDoc Scraper] Analisando listagem, submenus e paginação: ${targetUrl}`);

    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 (ConformIA Regulatory Auditor)',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };

    let rawHtml = '';
    try {
      const resp = await axios.get(targetUrl, { headers, timeout: 20000 });
      rawHtml = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
    } catch (err: any) {
      throw new Error(`Falha ao acessar portal regulatório: ${err.message}`);
    }

    const $ = cheerio.load(rawHtml);

    // 1. Procurar links para normas, resoluções, portarias, matérias ou atos individuais
    const docLinkRegex = /(\.pdf($|\?|#)|\/(normas?|resolucao|resolucoes|portarias?|materia|visualizar|atos?|legislacao|leis?|decretos?|bitstream)\/)/i;
    const discoveredLinks: { url: string; title: string }[] = [];

    let origin = '';
    try {
      const urlObj = new URL(targetUrl);
      origin = urlObj.origin;
    } catch (e) {}

    $('a').each((_, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().trim();
      if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        const absoluteUrl = href.startsWith('http') ? href : `${origin}${href.startsWith('/') ? '' : '/'}${href}`;
        if (
          docLinkRegex.test(absoluteUrl) &&
          absoluteUrl !== targetUrl &&
          !discoveredLinks.some((d) => d.url === absoluteUrl) &&
          text.length > 2
        ) {
          discoveredLinks.push({ url: absoluteUrl, title: text });
        }
      }
    });

    // 2. Procurar links de paginação e submenus
    const paginationLinks: string[] = [];
    $('a[href*="page="], a[href*="pagina="], a[href*="p="], ul.pagination a, .pagination a, nav.submenu a, .sub-menu a').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        const absoluteUrl = href.startsWith('http') ? href : `${origin}${href.startsWith('/') ? '' : '/'}${href}`;
        if (absoluteUrl !== targetUrl && !paginationLinks.includes(absoluteUrl)) {
          paginationLinks.push(absoluteUrl);
        }
      }
    });

    // Se encontrou múltiplos links de documentos ou paginação
    if (discoveredLinks.length >= 2 || (discoveredLinks.length >= 1 && paginationLinks.length > 0)) {
      // Se houver páginas de paginação, varre até 2 páginas adicionais para capturar mais documentos
      for (const nextPg of paginationLinks.slice(0, 2)) {
        if (discoveredLinks.length >= 40) break;
        try {
          const pgResp = await axios.get(nextPg, { headers, timeout: 10000 });
          const pg$ = cheerio.load(pgResp.data);
          pg$('a').each((_, el) => {
            const h = pg$(el).attr('href') || '';
            const t = pg$(el).text().trim();
            if (h && !h.startsWith('#') && !h.startsWith('javascript:')) {
              const abs = h.startsWith('http') ? h : `${origin}${h.startsWith('/') ? '' : '/'}${h}`;
              if (
                docLinkRegex.test(abs) &&
                abs !== targetUrl &&
                !discoveredLinks.some((d) => d.url === abs) &&
                t.length > 2
              ) {
                discoveredLinks.push({ url: abs, title: t });
              }
            }
          });
        } catch (e) {}
      }

      console.log(`📚 [MultiDoc Scraper] Total de ${discoveredLinks.length} documentos individuais identificados na listagem.`);

      const results: ScrapeResult[] = [];
      const toFetch = discoveredLinks.slice(0, 40);

      for (const item of toFetch) {
        try {
          if (this.isPdfUrl(item.url)) {
            const pdfRes = await this.scrapePdf(item.url, customTags);
            if (item.title && (!pdfRes.title || pdfRes.title.includes('PDF'))) {
              pdfRes.title = item.title;
            }
            results.push(pdfRes);
          } else {
            const docResp = await axios.get(item.url, { headers, timeout: 10000 });
            const docRes = this.processHtml(item.url, docResp.data, 'CHEERIO');
            if (item.title && (!docRes.title || docRes.title === 'Página sem título')) {
              docRes.title = item.title;
            }
            if (customTags && customTags.length > 0) {
              docRes.detectedTags = Array.from(new Set([...customTags, ...docRes.detectedTags]));
            }
            results.push(docRes);
          }
        } catch (err: any) {
          console.warn(`[MultiDoc Scraper] Falha ao extrair documento ${item.url}: ${err.message}`);
        }
      }

      if (results.length > 0) return results;
    }

    // Se não encontrou múltiplos documentos, trata como página única
    return [this.processHtml(targetUrl, rawHtml, 'CHEERIO')];
  }

  /**
   * Ponto de entrada unificado para varredura inteligente:
   * Detecta se a URL é arquivo PDF, árvore do GitHub, Diário Oficial (DOU in.gov.br), portal com paginação/submenus ou página avulsa
   */
  public static async scrapeMultiDocOrSingle(
    url: string,
    customTags?: string[],
    mode?: ExtractionMode
  ): Promise<ScrapeResult[]> {
    // 1. Arquivo PDF direto (ex: Senado, CFM, ANVISA, Diário Oficial em PDF)
    if (this.isPdfUrl(url)) {
      const pdfDoc = await this.scrapePdf(url, customTags);
      return [pdfDoc];
    }

    // 2. Árvore de Diretório do GitHub (arquivos individuais na pasta)
    const treeCheck = this.isGitHubTreeUrl(url);
    if (treeCheck.isTree) {
      return await this.scrapeGitHubTree(url, customTags);
    }

    // 3. Diário Oficial da União (in.gov.br) com leitura de jornal, submenus e atos múltiplos
    if (this.isDouUrl(url)) {
      return await this.scrapeDouLeituraJornal(url, customTags, mode);
    }

    // 4. Portais Regulatórios Gerais (CFM, ANS, ANVISA com paginação e submenus)
    try {
      const multiResults = await this.scrapeMultiDocListing(url, customTags, mode);
      if (multiResults.length > 0) {
        return multiResults;
      }
    } catch (err: any) {
      console.warn(`[Scraper] Falha na análise multi-documento (${err.message}), fallback para scrape simples.`);
    }

    // 5. Página Única Tradicional
    const single = await this.scrape(url, mode);
    return [single];
  }

  /**
   * Executa extração polimórfica com base no modo solicitado ou configurado
   */
  public static async scrape(url: string, mode?: ExtractionMode): Promise<ScrapeResult> {
    // Se for um link de PDF direto
    if (this.isPdfUrl(url)) {
      return await this.scrapePdf(url);
    }

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
   * Extração com Cheerio (Ultra-rápido, páginas estáticas ou PDFs dinâmicos)
   */
  private static async scrapeWithCheerio(url: string): Promise<ScrapeResult> {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 25000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 (ConformIA Regulatory Auditor)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    const contentType = String(response.headers['content-type'] || '').toLowerCase();
    if (contentType.includes('application/pdf')) {
      return await this.scrapePdf(url);
    }

    const buf = Buffer.from(response.data);
    const peek = buf.subarray(0, 1500).toString('ascii').toLowerCase();
    let rawHtml = '';
    if (
      peek.includes('iso-8859-1') ||
      peek.includes('windows-1252') ||
      contentType.includes('iso-8859-1') ||
      contentType.includes('windows-1252')
    ) {
      rawHtml = new TextDecoder('latin1').decode(buf);
    } else {
      rawHtml = new TextDecoder('utf-8').decode(buf);
    }

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
    const extractedEntities = this.extractEntities(cleanMarkdown, rawHtml);

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
      extractedEntities,
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

