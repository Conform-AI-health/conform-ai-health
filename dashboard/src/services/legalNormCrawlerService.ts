import crypto from 'crypto';
import * as cheerio from 'cheerio';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { safeHttpGet, validateSafeUrlAsync } from '../shared/security.js';
import { TextEncodingSanitizer } from '../shared/textEncodingSanitizer.js';
import { ScraperService } from './scraperService.js';
import { cosineSimilarity, SemanticEmbeddingService } from './semanticEmbeddingService.js';
import { AIProviderFactory } from './ai/aiProviderFactory.js';
import { FirecrawlClient } from './firecrawl/firecrawlClient.js';
import { LinkTraceService } from '../shared/linkTrace.js';
import { classifyNormTopics, resolveRequestedTopics, TOPIC_LABELS, NormTopic } from '../shared/normTopics.js';
import { isNavigationLabel } from '../shared/navigationLabels.js';
import {
  AmbiguousNormClassificationSchema,
  buildGenericLegalNormClassificationPrompt,
} from './firecrawl/firecrawlSchemas.js';

export type LinkFileType = 'html' | 'pdf' | 'docx' | 'markdown' | 'download';
export type ExtractionMethod = 'text' | 'ocr' | 'html';
export type NormStatus = 'active' | 'revoked' | 'amended' | 'unknown';

export interface DiscoveredLink {
  url: string;
  anchorText: string;
  surroundingText: string;
  fileType: LinkFileType;
  depth: number;
  discoveredFrom: string;
  originChain: string[];
}

export interface ExtractedDocumentContent {
  url: string;
  title: string;
  contentMd: string;
  activeContentMd: string;
  revokedStrikes: string[];
  rawText: string;
  contentHash: string;
  fileType: 'html' | 'pdf' | 'docx' | 'markdown';
  extractionMethod: ExtractionMethod;
  discoveredLinks: DiscoveredLink[];
  /** Metadados estruturados extraídos de frontmatter YAML (comum em repositórios Markdown de normas) */
  yamlMetadata?: Record<string, any>;
  /** Links encontrados no documento mas ignorados (fora da allowlist, assets, etc.), para telemetria */
  skippedLinks?: { url: string; reason: string }[];
}

export interface NormReference {
  relation: 'altera' | 'revoga' | 'regulamenta' | 'cita';
  target: string;
}

export interface NormClassificationResult {
  isNorm: boolean;
  normType: string | null;
  number: string | null;
  year: number | null;
  issuingBody: string | null;
  publishedAt: string | null;
  summary: string | null;
  status: NormStatus;
  score: number;
  layer: 'heuristic' | 'llm';
  reason: string;
  references: NormReference[];
}

export interface LegalArticleChunk {
  chunkIndex: number;
  text: string;
  tokenCount: number;
  path: string[];
  article: string | null;
  headingContext: string;
  contentHash: string;
}

export interface CrawlDiscardRecord {
  url: string;
  title: string;
  status: 'discarded';
  reason: string;
  score: number;
  layer: 'heuristic' | 'llm';
  discoveredFrom: string;
  timestamp: string;
}

export interface CrawlJobState {
  jobId: string;
  rootUrl: string;
  status: 'running' | 'completed' | 'failed';
  maxDepth: number;
  allowedDomains: string[];
  tags: string[];
  force: boolean;
  counters: {
    discovered: number;
    downloaded: number;
    normsSaved: number;
    normsSkippedIdempotent: number;
    normsUpdatedVersion: number;
    discarded: number;
    errors: number;
  };
  savedNormIds: string[];
  discards: CrawlDiscardRecord[];
  errors: { url: string; message: string }[];
  startedAt: string;
  finishedAt?: string;
}

export const DEFAULT_OFFICIAL_ALLOWED_DOMAINS = [
  'planalto.gov.br',
  'in.gov.br',
  'gov.br',
  'camara.leg.br',
  'senado.leg.br',
  'cfm.org.br',
  'anvisa.gov.br',
  'ans.gov.br',
  '.jus.br',
  '.leg.br',
  'github.com',
  'raw.githubusercontent.com',
  'api.github.com',
];

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  '_ga',
  '_gl',
]);

/**
 * LegalNormCrawlerService
 *
 * Pipeline completo de Crawling Recursivo Controlado, Extração (HTML/Planalto, PDF texto/OCR, DOCX),
 * Classificação em 2 camadas (Heurística + LLM em casos ambíguos), Chunking Jurídico por Artigo
 * com preservação de hierarquia (Capítulo/Seção/Artigo/Parágrafo/Inciso) e Persistência Idempotente
 * nas coleções `norms` e `norms_chunk`.
 */
export class LegalNormCrawlerService {
  private static jobs = new Map<string, CrawlJobState>();

  private static isIgnoredCrawlerUrl(url: string): boolean {
    const pathname = new URL(url).pathname;
    const ignoredAssetExtension =
      /\.(?:apng|avif|bmp|dib|gif|heic|heif|ico|icns|jfif|jpe?g|jxl|png|pjp|pjpeg|psd|raw|svgz?|tiff?|webp|aac|aif|aiff|amr|ape|flac|m4a|mka|mid|midi|mp3|oga|ogg|opus|wav|weba|wma|3gp|avi|flv|m4v|mkv|mov|mp4|mpeg|mpg|ogv|webm|wmv|css|scss|sass|less|js|mjs|cjs|jsx|ts|tsx|map|wasm|woff2?|ttf|otf|eot|zip|rar|7z|gz|tar|exe|dmg|apk|bin)$/i;
    const ignoredFrameworkPath =
      /(?:^|\/)(?:wp-admin|wp-includes|plugins?|frameworks?|node_modules|bower_components|vendor)(?:\/|$)|\/wp-content\/(?:plugins|themes)(?:\/|$)/i;

    return ignoredAssetExtension.test(pathname) || ignoredFrameworkPath.test(pathname);
  }

  public static getJob(jobId: string): CrawlJobState | undefined {
    return this.jobs.get(jobId);
  }

  public static listJobs(): CrawlJobState[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Identifica se uma URL aponta para arquivos de script, estilos ou mapas de código (.js, .css, etc.).
   * Arquivos desse tipo são completamente descartados ANTES de qualquer registro de telemetria ou fila.
   */
  public static isScriptOrStyleUrl(url: string): boolean {
    if (!url || typeof url !== 'string') return false;
    const cleanUrl = url.trim().split('#')[0].split('?')[0].toLowerCase();
    return /\.(?:css|scss|sass|less|js|mjs|cjs|jsx|ts|tsx|map)($|\/)/i.test(cleanUrl) ||
           /\.(?:css|scss|sass|less|js|mjs|cjs|jsx|ts|tsx|map)$/i.test(cleanUrl);
  }

  /**
   * Normaliza URL removendo fragmentos (#) e parâmetros de tracking, garantindo URL canônica
   */
  public static normalizeCanonicalUrl(rawUrl: string, baseUrl?: string): string | null {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    const trimmed = rawUrl.trim();
    if (
      !trimmed ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('javascript:') ||
      trimmed.startsWith('mailto:') ||
      trimmed.startsWith('tel:') ||
      trimmed.startsWith('data:') ||
      trimmed.startsWith('file:')
    ) {
      return null;
    }

    try {
      const parsed = baseUrl ? new URL(trimmed, baseUrl) : new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return null;
      }
      parsed.hash = '';
      for (const key of Array.from(parsed.searchParams.keys())) {
        if (TRACKING_PARAMS.has(key.toLowerCase())) {
          parsed.searchParams.delete(key);
        }
      }
      // Remove barra final redundante exceto na raiz
      let href = parsed.href;
      if (parsed.pathname !== '/' && href.endsWith('/')) {
        href = href.replace(/\/+$/, '');
      }
      return href;
    } catch {
      return null;
    }
  }

  public static isAncestorUrl(candidateUrl: string, currentUrl: string): boolean {
    try {
      const candidate = new URL(candidateUrl);
      const current = new URL(currentUrl);
      const sameSiteBranch =
        current.hostname === candidate.hostname ||
        current.hostname.endsWith(`.${candidate.hostname}`);

      if (
        !sameSiteBranch ||
        candidate.protocol !== current.protocol ||
        candidate.port !== current.port
      ) {
        return false;
      }

      const candidateSegments = candidate.pathname.split('/').filter(Boolean);
      const currentSegments = current.pathname.split('/').filter(Boolean);
      return (
        candidateSegments.length < currentSegments.length &&
        candidateSegments.every((segment, index) => segment === currentSegments[index])
      );
    } catch {
      return false;
    }
  }

  /**
   * Identifica se a URL pertence ao ecossistema do GitHub
   */
  public static isGithubUrl(url: string): boolean {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host === 'github.com' || host === 'raw.githubusercontent.com' || host === 'api.github.com';
    } catch {
      return false;
    }
  }

  /**
   * Converte uma URL de visualização web do GitHub (/blob/) para a URL de download direto do conteúdo bruto (raw)
   * Ex: https://github.com/:owner/:repo/blob/:branch/:filepath -> https://raw.githubusercontent.com/:owner/:repo/:branch/:filepath
   */
  public static convertGithubBlobToRawUrl(url: string): string {
    if (!url || typeof url !== 'string') return url;
    const blobMatch = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i);
    if (blobMatch) {
      return `https://raw.githubusercontent.com/${blobMatch[1]}/${blobMatch[2]}/${blobMatch[3]}/${blobMatch[4]}`;
    }
    return url;
  }

  /**
   * Verifica se uma URL pertence ao domínio de origem ou está na allowlist de fontes oficiais
   */
  public static isDomainAllowed(
    candidateUrl: string,
    rootUrl: string,
    customAllowedDomains: string[] = []
  ): boolean {
    try {
      const candidateHost = new URL(candidateUrl).hostname.toLowerCase();
      const rootHost = new URL(rootUrl).hostname.toLowerCase();

      // Suporte cruzado automático para repositórios GitHub (github.com <-> raw.githubusercontent.com)
      if (this.isGithubUrl(candidateUrl) && this.isGithubUrl(rootUrl)) {
        return true;
      }

      if (candidateHost === rootHost || candidateHost.endsWith(`.${rootHost}`)) {
        return true;
      }

      const allowlist = [...DEFAULT_OFFICIAL_ALLOWED_DOMAINS, ...customAllowedDomains].map((d) =>
        d.toLowerCase().trim()
      );

      return allowlist.some((domain) => {
        if (domain.startsWith('*.')) {
          const suffix = domain.slice(1); // .jus.br
          return candidateHost.endsWith(suffix);
        }
        if (domain.startsWith('.')) {
          return candidateHost.endsWith(domain);
        }
        return candidateHost === domain || candidateHost.endsWith(`.${domain}`);
      });
    } catch {
      return false;
    }
  }

  /**
   * Classifica o tipo do link pela URL, extensão, padrões de rota (@@display-file, /download) ou texto âncora
   */
  public static classifyLinkFileType(url: string, anchorText: string = '', contentType: string = ''): LinkFileType {
    const lowerUrl = url.toLowerCase();
    const lowerCt = contentType.toLowerCase();
    const lowerAnchor = anchorText.toLowerCase();

    if (lowerCt.includes('application/pdf') || /\.pdf($|\?|#)/i.test(lowerUrl)) {
      return 'pdf';
    }
    if (
      lowerCt.includes('text/markdown') ||
      lowerCt.includes('text/x-markdown') ||
      /\.(md|markdown)($|\?|#)/i.test(lowerUrl) ||
      /\.(md|markdown)\b/i.test(lowerAnchor)
    ) {
      return 'markdown';
    }
    if (
      lowerCt.includes('officedocument.wordprocessingml') ||
      lowerCt.includes('application/msword') ||
      /\.(docx?|odt)($|\?|#)/i.test(lowerUrl)
    ) {
      return 'docx';
    }
    if (
      /(@@display-file|\/download\/|\/bitstream\/|arquivo=|download=)/i.test(lowerUrl) ||
      /\b(baixar\s+pdf|download\s+pdf|\.pdf)\b/i.test(lowerAnchor)
    ) {
      return lowerAnchor.includes('docx') ? 'docx' : 'pdf';
    }
    return 'html';
  }

  /**
   * 1. Descoberta de Links com Contexto Rico (texto âncora + linha de tabela / célula / item de lista ao redor)
   */
  public static discoverLinksFromHtml(
    html: string,
    baseUrl: string,
    currentDepth: number = 0,
    originChain: string[] = [baseUrl],
    allowedDomains: string[] = [],
    skipped?: { url: string; reason: string }[]
  ): DiscoveredLink[] {
    const $ = cheerio.load(html);
    const discovered: DiscoveredLink[] = [];
    const seenUrls = new Set<string>();

    const canonicalBase = this.normalizeCanonicalUrl(baseUrl) || baseUrl;
    seenUrls.add(canonicalBase);

    const ignoredNavRegex = /\/(login|signin|logout|cadastro|register|wp-json|wp-admin|feed|sharer|share|facebook|instagram|linkedin|twitter|youtube|whatsapp)(\/|$|\?)/i;
    const navigationContainerSelector =
      'nav, header, footer, aside, .menu, .navbar, .sidebar, [class*="breadcrumb"], [id*="breadcrumb"], [aria-label*="breadcrumb"], [aria-label*="Breadcrumb"], [class*="footer"], [id*="footer"], [class*="navbar"], [id*="navbar"], [class*="navigation"], [id*="navigation"], #barra-brasil';

    const isCurrentBaseGithub = this.isGithubUrl(canonicalBase);
    const githubUiNoiseRegex = /\/(commits?|pulls?|issues?|releases?|actions?|tags?|branches?|labels?|milestones?|stargazers?|watchers?|network|forks?|search|settings)(\/|$|\?)/i;
    const githubGlobalNavRegex = /^https?:\/\/github\.com\/(features|pricing|security|enterprise|customer-stories|readme|topics|collections|trending|login|signup|join|explore|about|site|contact|sponsors)(\/|$|\?)/i;

    $('a[href]').each((_, el) => {
      const rawHref = ($(el).attr('href') || '').trim();
      if (!rawHref) return;

      // Descarte imediato e silencioso de scripts e estilos (.css, .js) antes de qualquer telemetria
      if (this.isScriptOrStyleUrl(rawHref)) {
        return;
      }

      let canonical = this.normalizeCanonicalUrl(rawHref, baseUrl);
      if (!canonical || seenUrls.has(canonical)) return;

      // Descarte imediato e silencioso na URL normalizada antes de telemetria
      if (this.isScriptOrStyleUrl(canonical)) {
        seenUrls.add(canonical);
        return;
      }

      // Tratamento especializado para links de repositórios GitHub
      if (isCurrentBaseGithub) {
        if (githubGlobalNavRegex.test(canonical)) {
          skipped?.push({ url: canonical, reason: 'Página institucional/marketing do GitHub' });
          seenUrls.add(canonical);
          return;
        }

        if (githubUiNoiseRegex.test(canonical)) {
          skipped?.push({ url: canonical, reason: 'Link de navegação/UI da plataforma GitHub' });
          seenUrls.add(canonical);
          return;
        }

        // Se for um link de arquivo .md no GitHub (/blob/), converte para a URL de download direto (raw)
        if (canonical.includes('/blob/') && /\.(md|markdown)($|\?|#)/i.test(canonical)) {
          canonical = this.convertGithubBlobToRawUrl(canonical);
          if (seenUrls.has(canonical)) return;
        }
      }

      if ($(el).closest(navigationContainerSelector).length > 0) {
        skipped?.push({ url: canonical, reason: 'Link dentro de navbar, breadcrumb ou footer' });
        seenUrls.add(canonical);
        return;
      }

      const anchorText = TextEncodingSanitizer.sanitizeAndRepairText(
        ($(el).text() || $(el).attr('title') || $(el).attr('aria-label') || '').trim().replace(/\s+/g, ' ')
      );
      if (isNavigationLabel(anchorText)) {
        skipped?.push({ url: canonical, reason: 'Rótulo de menu, navegação ou rodapé' });
        seenUrls.add(canonical);
        return;
      }

      if (this.isAncestorUrl(canonical, canonicalBase)) {
        skipped?.push({ url: canonical, reason: 'URL ancestral da página atual (home ou breadcrumb anterior)' });
        seenUrls.add(canonical);
        return;
      }

      if (this.isIgnoredCrawlerUrl(canonical) || ignoredNavRegex.test(canonical)) {
        skipped?.push({ url: canonical, reason: 'Asset estático ou link de navegação/rede social' });
        seenUrls.add(canonical);
        return;
      }
      if (!this.isDomainAllowed(canonical, baseUrl, allowedDomains)) {
        skipped?.push({ url: canonical, reason: 'Domínio fora da allowlist de fontes oficiais' });
        seenUrls.add(canonical);
        return;
      }

      // Captura o contexto da linha de tabela (<tr>), item de lista (<li>) ou bloco próximo
      const container = $(el).closest('tr, li, article, .callout, p, dd, div');
      let surroundingText = '';
      if (container.length > 0) {
        const tag = (container[0] as any).name;
        if (tag === 'tr') {
          const rowCells: string[] = [];
          container.find('th, td').each((__, cell) => {
            const cellText = $(cell).text().trim().replace(/\s+/g, ' ');
            if (cellText) rowCells.push(cellText);
          });
          surroundingText = rowCells.join(' | ');
        } else {
          surroundingText = container.text().trim().replace(/\s+/g, ' ').slice(0, 400);
        }
      }
      surroundingText = TextEncodingSanitizer.sanitizeAndRepairText(surroundingText || anchorText);

      const fileType = this.classifyLinkFileType(canonical, `${anchorText} ${surroundingText}`);
      seenUrls.add(canonical);

      discovered.push({
        url: canonical,
        anchorText: anchorText || canonical,
        surroundingText,
        fileType,
        depth: currentDepth + 1,
        discoveredFrom: canonicalBase,
        originChain: [...originChain, canonical],
      });
    });

    // Descoberta resiliente em árvore de arquivos do GitHub via dados React embutidos
    if (isCurrentBaseGithub) {
      $('script[type="application/json"]').each((_, el) => {
        const text = $(el).html() || '';
        if (text.includes('tree') && text.includes('items')) {
          try {
            const parsed = JSON.parse(text);
            const items = parsed?.payload?.tree?.items || [];
            const owner = parsed?.payload?.repo?.owner || parsed?.payload?.pathTokens?.[0];
            const repo = parsed?.payload?.repo?.name || parsed?.payload?.pathTokens?.[1];
            const branch = parsed?.payload?.refInfo?.name || 'main';

            if (owner && repo && Array.isArray(items)) {
              for (const item of items) {
                if (item.contentType === 'file' && /\.(md|markdown|pdf|docx?)$/i.test(item.name || '')) {
                  const rawCandidate = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${item.path}`;
                  if (!seenUrls.has(rawCandidate)) {
                    seenUrls.add(rawCandidate);
                    discovered.push({
                      url: rawCandidate,
                      anchorText: item.name,
                      surroundingText: `Arquivo do repositório ${repo}: ${item.path}`,
                      fileType: item.name.endsWith('.pdf') ? 'pdf' : 'markdown',
                      depth: currentDepth + 1,
                      discoveredFrom: canonicalBase,
                      originChain: [...originChain, rawCandidate],
                    });
                  }
                }
              }
            }
          } catch {}
        }
      });
    }

    return discovered;
  }

  /**
   * Extrai links embutidos dentro de arquivos PDF (anotações /URI do PDF e URLs http/https no texto)
   */
  public static extractLinksFromPdfBufferAndText(
    pdfBuffer: Buffer | null,
    extractedText: string,
    baseUrl: string,
    currentDepth: number = 0,
    originChain: string[] = [baseUrl],
    allowedDomains: string[] = [],
    skipped?: { url: string; reason: string }[]
  ): DiscoveredLink[] {
    const rawCandidates: string[] = [];

    // 1. Extrai anotações de link do binário PDF: /URI (https://...)
    if (pdfBuffer && pdfBuffer.length > 0) {
      const latin1Slice = pdfBuffer.toString('latin1');
      const uriAnnotRegex = /\/URI\s*\((https?:\/\/[^)\s]+)\)/gi;
      let match: RegExpExecArray | null;
      while ((match = uriAnnotRegex.exec(latin1Slice)) !== null) {
        if (match[1]) rawCandidates.push(match[1]);
      }
    }

    // 2. Extrai URLs explícitas no texto do PDF
    if (extractedText) {
      const textUrlRegex = /https?:\/\/[^\s)>\]"']+/gi;
      let match: RegExpExecArray | null;
      while ((match = textUrlRegex.exec(extractedText)) !== null) {
        if (match[0]) rawCandidates.push(match[0].replace(/[.,;:]+$/, ''));
      }
    }

    const discovered: DiscoveredLink[] = [];
    const seen = new Set<string>([this.normalizeCanonicalUrl(baseUrl) || baseUrl]);

    for (const raw of rawCandidates) {
      if (!raw || this.isScriptOrStyleUrl(raw)) continue;

      const canonical = this.normalizeCanonicalUrl(raw, baseUrl);
      if (!canonical || seen.has(canonical)) continue;

      // Descarte prévio e silencioso de scripts e estilos antes de telemetria
      if (this.isScriptOrStyleUrl(canonical)) {
        seen.add(canonical);
        continue;
      }
      if (this.isIgnoredCrawlerUrl(canonical)) {
        skipped?.push({ url: canonical, reason: 'Asset estático ou rota de framework/plugin' });
        seen.add(canonical);
        continue;
      }
      if (this.isAncestorUrl(canonical, baseUrl)) {
        skipped?.push({ url: canonical, reason: 'URL ancestral do documento atual' });
        seen.add(canonical);
        continue;
      }
      if (!this.isDomainAllowed(canonical, baseUrl, allowedDomains)) {
        skipped?.push({ url: canonical, reason: 'Domínio fora da allowlist de fontes oficiais' });
        seen.add(canonical);
        continue;
      }
      seen.add(canonical);

      discovered.push({
        url: canonical,
        anchorText: 'Link referenciado no PDF',
        surroundingText: `Extraído do documento PDF ${baseUrl}`,
        fileType: this.classifyLinkFileType(canonical),
        depth: currentDepth + 1,
        discoveredFrom: baseUrl,
        originChain: [...originChain, canonical],
      });
    }

    return discovered;
  }

  /**
   * 3.1 Extração de Conteúdo HTML com Tratamento Especial para Texto Tachado (<strike>, <s>, <del>) do Planalto
   * e remoção de ruído (menus, cabeçalhos, rodapés, botões de compartilhamento)
   */
  public static extractCleanMarkdownFromHtml(
    url: string,
    rawHtml: string,
    depth: number = 0,
    originChain: string[] = [url],
    allowedDomains: string[] = []
  ): ExtractedDocumentContent {
    // 1. Descobre links ANTES de rodar reparo ortográfico no HTML para nunca alterar atributos href de URLs
    const skippedLinks: { url: string; reason: string }[] = [];
    const discoveredLinks = this.discoverLinksFromHtml(
      rawHtml,
      url,
      depth,
      originChain,
      allowedDomains,
      skippedLinks
    );

    const repairedHtml = TextEncodingSanitizer.sanitizeAndRepairText(rawHtml);

    const $ = cheerio.load(repairedHtml);

    // 2. Remove ruído estrutural (sem depender de seletores fixos de um único portal)
    $(
      'script, style, noscript, svg, iframe, nav, header, footer, aside, .menu, .navbar, .sidebar, .breadcrumb, .share, .social-links, .govbr-share, #barra-brasil, #footer-brasil, . cookie-banner'
    ).remove();

    const title = TextEncodingSanitizer.sanitizeAndRepairText(
      $('title').first().text().trim() ||
        $('h1').first().text().trim() ||
        $('p[align="center"]').first().text().trim() ||
        'Documento sem título'
    ).replace(/\s+/g, ' ');

    // 3. Identifica e trata texto tachado (<strike>, <s>, <del>, style="text-decoration: line-through") como revogado
    const revokedStrikes: string[] = [];
    $('strike, s, del, [style*="line-through"]').each((_, el) => {
      const strikeText = TextEncodingSanitizer.sanitizeAndRepairText($(el).text().trim().replace(/\s+/g, ' '));
      if (strikeText.length > 4) {
        revokedStrikes.push(strikeText);
        $(el).replaceWith(` ~~${strikeText}~~ `);
      } else {
        $(el).remove();
      }
    });

    // 4. Converte elementos estruturais em Markdown preservando Capítulos, Seções, Artigos, Parágrafos e Tabelas
    const mdLines: string[] = [`# ${title}`, ''];
    const activeLines: string[] = [`# ${title}`, ''];
    const seenLines = new Set<string>();

    const bodyRoot = $('main, article, #conteudo, #content, .texto-norma, body').first();
    const elements = bodyRoot.find('h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, tr, div');

    elements.each((_, el) => {
      const tag = (el as any).name;
      if (tag === 'div' && $(el).children('p, div, table, ul, ol, h1, h2, h3, h4').length > 0) {
        return;
      }

      let line = '';
      if (tag === 'tr') {
        const cells: string[] = [];
        $(el)
          .find('th, td')
          .each((__, cell) => {
            const cText = $(cell).text().trim().replace(/\s+/g, ' ');
            if (cText) cells.push(cText);
          });
        if (cells.length > 0) {
          line = `| ${cells.join(' | ')} |`;
        }
      } else {
        const text = $(el).text().trim().replace(/\s+/g, ' ');
        if (!text) return;

        if (/^h[1-6]$/.test(tag)) {
          const level = parseInt(tag.slice(1), 10);
          line = `${'#'.repeat(Math.min(level, 4))} ${text}`;
        } else if (/^(TÍTULO|CAPÍTULO|SEÇÃO|SUBSEÇÃO)\s+[IVXLCDM0-9]+/i.test(text)) {
          line = `## ${text}`;
        } else {
          line = text;
        }
      }

      const cleanLine = TextEncodingSanitizer.sanitizeAndRepairText(line).trim();
      if (!cleanLine || cleanLine.length < 2 || seenLines.has(cleanLine)) return;
      seenLines.add(cleanLine);

      mdLines.push(cleanLine);

      // Na versão ativa para chunking RAG, remove trechos inteiramente tachados (~~...~~) para não misturar texto revogado com vigente.
      // Se um artigo inteiro teve seu conteúdo tachado (ex.: "Art. 2º ~~Texto revogado~~" ou "Art. 2º (Revogado pela Lei...)"),
      // descarta a linha de artigo esvaziada para que NUNCA gere chunk em norms_chunk (AJUSTE 1 / Regra 4.3).
      const withoutStrikes = cleanLine.replace(/~~[^~]+~~/g, '').replace(/\s+/g, ' ').trim();
      const isStubRevokedArticle =
        /^(?:#+\s*)?Art\.?\s*\d+[º°o\-]?(?:\s*[-–—.]?\s*)?(?:\(\s*revogad[ao][^)]*\)|\[\s*revogad[ao][^\]]*\])?$/i.test(
          withoutStrikes
        );

      if (withoutStrikes.length > 2 && !isStubRevokedArticle) {
        activeLines.push(withoutStrikes);
      }
    });

    const contentMd = mdLines.join('\n\n').trim();
    const activeContentMd = activeLines.join('\n\n').trim();
    const contentHash = crypto.createHash('sha256').update(activeContentMd, 'utf8').digest('hex');

    return {
      url,
      title,
      contentMd,
      activeContentMd,
      revokedStrikes,
      rawText: activeContentMd,
      contentHash,
      fileType: 'html',
      extractionMethod: 'html',
      discoveredLinks,
      skippedLinks,
    };
  }

  public static extractFromMarkdownText(
    url: string,
    rawMarkdown: string,
    depth: number = 0,
    originChain: string[] = [url],
    allowedDomains: string[] = [],
    fallbackTitle?: string
  ): ExtractedDocumentContent {
    const sanitized = TextEncodingSanitizer.sanitizeAndRepairText(rawMarkdown).trim();

    // 1. Extração estruturada de Frontmatter YAML (metadados ricos de repositórios como cfm-normas)
    let yamlMetadata: Record<string, any> | undefined = undefined;
    let bodyContent = sanitized;

    const frontmatterMatch = sanitized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (frontmatterMatch) {
      yamlMetadata = {};
      const yamlBlock = frontmatterMatch[1];
      bodyContent = frontmatterMatch[2].trim();

      for (const yLine of yamlBlock.split(/\r?\n/)) {
        const kv = yLine.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
        if (kv) {
          const key = kv[1].trim();
          let val = kv[2].trim();
          if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
            val = val.slice(1, -1);
          }
          yamlMetadata[key] = val;
        }
      }
    }

    const heading = bodyContent.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim();
    const fallbackFileName = new URL(url).pathname.split('/').pop()?.replace(/\.(md|markdown)$/i, '') || 'Documento Markdown';
    
    // Título enriquecido a partir dos metadados YAML se disponíveis
    let computedTitle = heading || fallbackTitle || fallbackFileName;
    if (yamlMetadata?.tipo && yamlMetadata?.numero && yamlMetadata?.ano) {
      computedTitle = `${String(yamlMetadata.tipo).toUpperCase()} CFM Nº ${yamlMetadata.numero}/${yamlMetadata.ano}`;
    }

    const title = TextEncodingSanitizer.sanitizeAndRepairText(computedTitle).slice(0, 200);
    const documentContent = sanitized;
    const activeContent = bodyContent || `# ${title}`;
    const contentHash = crypto.createHash('sha256').update(activeContent, 'utf8').digest('hex');
    const skippedLinks: { url: string; reason: string }[] = [];
    const discoveredLinks = this.extractLinksFromPdfBufferAndText(
      null,
      documentContent,
      url,
      depth,
      originChain,
      allowedDomains,
      skippedLinks
    );

    return {
      url,
      title,
      contentMd: documentContent,
      activeContentMd: activeContent,
      revokedStrikes: [],
      rawText: activeContent,
      contentHash,
      fileType: 'markdown',
      extractionMethod: 'text',
      discoveredLinks,
      yamlMetadata,
      skippedLinks,
    };
  }

  /**
   * 3.2 Extração de PDF com limpeza de cabeçalhos/rodapés repetidos, detecção de PDF escaneado (OCR) e extração de links
   */
  public static async extractFromPdfBuffer(
    url: string,
    pdfBuffer: Buffer,
    depth: number = 0,
    originChain: string[] = [url],
    allowedDomains: string[] = [],
    fallbackTitle?: string
  ): Promise<ExtractedDocumentContent> {
    let rawText = '';
    let infoTitle = fallbackTitle || '';

    try {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: pdfBuffer });
      const textResult = await parser.getText();
      rawText = textResult?.text || '';
      try {
        const info = await parser.getInfo();
        if (info?.info?.Title && typeof info.info.Title === 'string' && info.info.Title.trim().length > 3) {
          infoTitle = info.info.Title.trim();
        }
      } catch {}
      await parser.destroy();
    } catch {
      rawText = '';
    }

    const sanitizedRaw = TextEncodingSanitizer.sanitizeAndRepairText(rawText);

    // Remove números de página isolados ("Página 1 de 10", "- 2 -") e cabeçalhos repetidos
    const lines = sanitizedRaw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !/^(p[aá]gina\s+\d+(\s+de\s+\d+)?|-\s*\d+\s*-|\d+\s*\/\s*\d+)$/i.test(l));

    // Conta frequência de linhas curtas para remover cabeçalhos/rodapés que se repetem em >= 3 páginas
    const lineCounts = new Map<string, number>();
    for (const l of lines) {
      if (l.length < 90 && !/^art\.?\s*\d+/i.test(l)) {
        lineCounts.set(l, (lineCounts.get(l) || 0) + 1);
      }
    }

    const cleanedLines = lines.filter((l) => (lineCounts.get(l) || 0) < 3);
    const cleanedBody = cleanedLines.join('\n\n').trim();

    // Se o PDF não tiver camada de texto (< 40 caracteres úteis), classifica como PDF escaneado (OCR)
    const isScannedOcr = cleanedBody.replace(/\s+/g, '').length < 40;
    const extractionMethod: ExtractionMethod = isScannedOcr ? 'ocr' : 'text';

    const title = TextEncodingSanitizer.sanitizeAndRepairText(
      infoTitle ||
        cleanedLines.find((l) => /(lei|decreto|portaria|resolu[cç][aã]o|instru[cç][aã]o|parecer)/i.test(l)) ||
        cleanedLines[0] ||
        'Documento PDF'
    ).slice(0, 200);

    const contentMd = cleanedBody ? `# ${title}\n\n${cleanedBody}` : `# ${title}`;
    const contentHash = crypto.createHash('sha256').update(contentMd, 'utf8').digest('hex');

    const skippedLinks: { url: string; reason: string }[] = [];
    const discoveredLinks = this.extractLinksFromPdfBufferAndText(
      pdfBuffer,
      cleanedBody,
      url,
      depth,
      originChain,
      allowedDomains,
      skippedLinks
    );

    return {
      url,
      title,
      contentMd,
      activeContentMd: contentMd,
      revokedStrikes: [],
      rawText: cleanedBody,
      contentHash,
      fileType: 'pdf',
      extractionMethod,
      discoveredLinks,
      skippedLinks,
    };
  }

  /**
   * 3.3 Extração de DOCX em memória (lendo XML/texto do container DOCX/ZIP e extraindo links internos)
   */
  public static extractFromDocxBuffer(
    url: string,
    docxBuffer: Buffer,
    depth: number = 0,
    originChain: string[] = [url],
    allowedDomains: string[] = [],
    fallbackTitle?: string
  ): ExtractedDocumentContent {
    const rawUtf8 = docxBuffer.toString('utf8');
    const paragraphs: string[] = [];

    // Extrai tags <w:t> dentro de parágrafos <w:p> caso o XML esteja visível ou texto plano
    const wpRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gi;
    let pMatch: RegExpExecArray | null;
    while ((pMatch = wpRegex.exec(rawUtf8)) !== null) {
      const pContent = pMatch[1];
      const wtRegex = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi;
      const parts: string[] = [];
      let tMatch: RegExpExecArray | null;
      while ((tMatch = wtRegex.exec(pContent)) !== null) {
        parts.push(tMatch[1]);
      }
      const line = TextEncodingSanitizer.sanitizeAndRepairText(parts.join('').trim());
      if (line) paragraphs.push(line);
    }

    const bodyText =
      paragraphs.length > 0
        ? paragraphs.join('\n\n')
        : TextEncodingSanitizer.decodeBufferWithAutoEncoding(docxBuffer);

    const title = TextEncodingSanitizer.sanitizeAndRepairText(
      fallbackTitle || paragraphs[0] || 'Documento DOCX'
    ).slice(0, 200);

    const contentMd = `# ${title}\n\n${bodyText.trim()}`.trim();
    const contentHash = crypto.createHash('sha256').update(contentMd, 'utf8').digest('hex');

    const skippedLinks: { url: string; reason: string }[] = [];
    const discoveredLinks = this.extractLinksFromPdfBufferAndText(
      null,
      bodyText,
      url,
      depth,
      originChain,
      allowedDomains,
      skippedLinks
    );

    return {
      url,
      title,
      contentMd,
      activeContentMd: contentMd,
      revokedStrikes: [],
      rawText: bodyText,
      contentHash,
      fileType: 'docx',
      extractionMethod: 'text',
      discoveredLinks,
      skippedLinks,
    };
  }

  /**
   * 4. Classificação "É Norma Legal?" em Duas Camadas (Camada 1: Heurística e Densidade de Artigos; Camada 2: LLM para casos ambíguos)
   */
  public static async classifyLegalNorm(
    doc: ExtractedDocumentContent,
    targetTags: string[] = []
  ): Promise<NormClassificationResult> {
    const nonTableHeadLines = doc.activeContentMd
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('|'))
      .join('\n')
      .slice(0, 1200);
    const titleAndHead = `${doc.title}\n${nonTableHeadLines}`;
    const fullText = doc.activeContentMd;
    const lowerText = `${ doc.title }\n${ fullText }`.toLowerCase();

    let score = 0;
    const reasons: string[] = [];

    // 1. Sinais fortes no título ou cabeçalho
    const headerTypeRegex = /\b(lei\s+(?:complementar\s+|federal\s+|ordin[aá]ria\s+)?n[º°o]?\s*[\d.]+|decreto(?:-lei)?\s+n[º°o]?\s*[\d.]+|portaria\s+(?:conjunta\s+|gm\/ms\s+)?n[º°o]?\s*[\d.]+|resolu[cç][aã]o\s+(?:cfm\s+|rdc\s+|normativa\s+|cne\s+)?n[º°o]?\s*[\d.]+|instru[cç][aã]o\s+normativa\s+n[º°o]?\s*[\d.]+|medida\s+provis[oó]ria\s+n[º°o]?\s*[\d.]+|emenda\s+constitucional\s+n[º°o]?\s*[\d.]+|parecer\s+(?:normativo|cfm|crm|consulta)?\s*n[º°o]?\s*[\d.]+|rdc\s+n[º°o]?\s*[\d.]+|c[oó]digo\s+de\s+[eé]tica)/i;
    if (headerTypeRegex.test(titleAndHead)) {
      score += 0.45;
      reasons.push('Cabeçalho formal de ato normativo identificado');
    }

    // 1.1 Reconhecimento especializado de Pareceres Deontológicos (CFM/CRM)
    const isParecer =
      doc.yamlMetadata?.tipo?.toLowerCase() === 'parecer' ||
      /\bparecer\b/i.test(doc.title) ||
      /\b(parecer\s+(?:cfm|crm|normativo|consulta)?\s*(?:n[º°o]?\s*[\d.]+|\/n[º°o]?\s*[\d.]+|\s+n[º°o]?\s*[\d.]+\/\d{4}))/i.test(titleAndHead) ||
      /\bparecer\s+cfm\b/i.test(titleAndHead);

    if (isParecer) {
      score += 0.55;
      reasons.push('Parecer deontológico/normativo identificado');

      const parecerSectionsRegex = /\b(ementa|relat[oó]rio|voto(?:\s+do\s+relator)?|do\s+parecer|conclus[aã]o|sess[aã]o\s+plen[aá]ria|conselheiro\s+relator)\b/gi;
      const sectionMatches = fullText.match(parecerSectionsRegex) || [];
      if (sectionMatches.length >= 2) {
        score += 0.35;
        reasons.push(`Estrutura formal de parecer detectada (${Array.from(new Set(sectionMatches.map((s) => s.toLowerCase()))).join(', ')})`);
      }
    }

    // 2. Presença e densidade de artigos ("Art. 1º", "Art. 2º", "Parágrafo único")
    const articleMatches = fullText.match(/(?:^|\n)\s*Art\.?\s*\d+[º°o\-]?/gi) || [];
    if (articleMatches.length >= 3) {
      score += 0.4;
      reasons.push(`${articleMatches.length} artigos numerados detectados`);
    } else if (articleMatches.length >= 1) {
      score += 0.25;
      reasons.push(`${articleMatches.length} artigo(s) numerado(s) detectado(s)`);
    }

    // 3. Fórmulas de promulgação, vigência e estrutura legal
    const legalFormulasRegex = /(\bpar[aá]grafo\s+[uú]nico\b|\besta\s+(?:lei|resolu[cç][aã]o|portaria|instru[cç][aã]o)\s+entra\s+em\s+vigor\b|\bo\s+presidente\s+da\s+rep[uú]blica\b|\bresolve\s*:|\bconsiderando\b|\bdi[aá]rio\s+oficial\s+da\s+uni[aã]o\b|\bdou\b|\brevogam-se\s+as\s+disposi[cç][oõ]es\s+em\s+contr[aá]rio\b)/i;
    if (legalFormulasRegex.test(fullText)) {
      score += 0.2;
      reasons.push('Fórmulas jurídicas de promulgação/vigência presentes');
    }

    // 4. Penalidades para páginas de índice/listagem, notícias, comunicados e páginas institucionais
    const isNonNormPageRegex = /\b(not[ií]cia|assessoria\s+de\s+comunica[cç][aã]o|ascom|evento|workshop|cartilha|perguntas\s+frequentes|faq|quem\s+somos|fale\s+conosco|ata\s+de\s+reuni[aã]o)\b/i;
    if (isNonNormPageRegex.test(doc.title) && articleMatches.length === 0 && !isParecer) {
      score -= 0.5;
      reasons.push('Título característico de notícia, comunicado, cartilha ou página institucional');
    }

    if (doc.fileType === 'html' && doc.discoveredLinks.length >= 2 && articleMatches.length === 0 && !isParecer) {
      score -= 0.45;
      reasons.push('Página HTML de índice/listagem de links sem artigos normativos');
    }

    if (doc.extractionMethod === 'ocr' && fullText.length < 80) {
      score -= 0.4;
      reasons.push('PDF escaneado sem camada de texto extraível');
    }

    // 5. Validação de aderência às tags quando especificadas
    if (targetTags && targetTags.length > 0) {
      const isCfmTagRequested = targetTags.some((t) => t.toLowerCase() === 'cfm');
      const isCfmDoc =
        isCfmTagRequested &&
        (isParecer ||
          doc.yamlMetadata?.orgao === 'CFM' ||
          /\bcfm\b/i.test(doc.title) ||
          /\bconselho\s+federal\s+de\s+medicina\b/i.test(fullText));

      if (!isCfmDoc) {
        const tagValidation = ScraperService.validateContentHasTagAndLawData(
          doc.title,
          fullText,
          targetTags,
          doc.url
        );
        if (!tagValidation.hasTagData) {
          score = Math.min(score, 0.2);
          reasons.push(`Conteúdo não possui dados referentes às tags solicitadas [${targetTags.join(', ')}]`);
        }
      }
    }

    score = Math.max(0, Math.min(1, Number(score.toFixed(2))));

    // Extração de metadados jurídicos
    const metadata = this.extractLegalMetadata(doc.title, fullText);
    const references = this.extractLegalReferences(fullText);

    // Enriquecimento prioritário a partir de metadados YAML (cfm-normas)
    if (doc.yamlMetadata) {
      if (doc.yamlMetadata.numero) metadata.number = String(doc.yamlMetadata.numero);
      if (doc.yamlMetadata.ano) metadata.year = parseInt(String(doc.yamlMetadata.ano), 10) || metadata.year;
      if (doc.yamlMetadata.orgao) metadata.issuingBody = String(doc.yamlMetadata.orgao);
      if (doc.yamlMetadata.tipo) metadata.normType = String(doc.yamlMetadata.tipo).toLowerCase();
      if (doc.yamlMetadata.ementa) metadata.summary = String(doc.yamlMetadata.ementa);
      if (doc.yamlMetadata.data_publicacao) metadata.publishedAt = String(doc.yamlMetadata.data_publicacao);
    } else if (isParecer && !metadata.normType) {
      metadata.normType = 'parecer';
    }

    // Camada 2: Aciona AIProviderFactory (Regras 1 e 5) apenas em casos ambíguos (score entre 0.35 e 0.59)
    let layer: 'heuristic' | 'llm' = 'heuristic';
    let isNorm = score >= 0.6;
    let finalReason =
      reasons.join('; ') ||
      (isNorm ? 'Norma legal validada por heurística' : 'Não atingiu pontuação mínima de norma legal');

    if (score >= 0.35 && score < 0.6 && env.GEMINI_API_KEY) {
      try {
        const prompt = buildGenericLegalNormClassificationPrompt(doc.title, fullText, targetTags);
        const aiHealthResp = await AIProviderFactory.testModelResponse(prompt);
        const rawResp = String(aiHealthResp.response || '');
        const jsonMatch = rawResp.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const rawJson = JSON.parse(jsonMatch[0]);
          const parsed = AmbiguousNormClassificationSchema.safeParse(rawJson);
          if (parsed.success) {
            layer = 'llm';
            isNorm = parsed.data.is_norm;
            score = parsed.data.confidence ?? score;
            finalReason = parsed.data.reason || finalReason;
            if (parsed.data.norm_type) {
              metadata.normType = String(parsed.data.norm_type).toLowerCase();
            }
          }
        }
      } catch {
        // Mantém decisão da camada heurística se o provedor de IA não estiver acessível
      }
    }

    return {
      isNorm,
      normType: isNorm ? metadata.normType : null,
      number: metadata.number,
      year: metadata.year,
      issuingBody: metadata.issuingBody,
      publishedAt: metadata.publishedAt,
      summary: metadata.summary,
      status: metadata.status,
      score,
      layer,
      reason: finalReason,
      references,
    };
  }

  /**
   * Extrai metadados estruturados da norma: tipo, número, ano, órgão emissor, ementa e situação (active/revoked/amended)
   */
  public static extractLegalMetadata(title: string, content: string): {
    normType: string;
    number: string | null;
    year: number | null;
    issuingBody: string | null;
    publishedAt: string | null;
    summary: string | null;
    status: NormStatus;
  } {
    const header = `${title}\n${content.slice(0, 1800)}`;

    let normType = 'outro';
    if (/\blei\s+complementar\b/i.test(header)) normType = 'lei_complementar';
    else if (/\blei\b/i.test(header)) normType = 'lei';
    else if (/\bdecreto\b/i.test(header)) normType = 'decreto';
    else if (/\bportaria\b/i.test(header)) normType = 'portaria';
    else if (/\binstru[cç][aã]o\s+normativa\b/i.test(header)) normType = 'instrucao_normativa';
    else if (/\bresolu[cç][aã]o\b|\brdc\b/i.test(header)) normType = 'resolucao';
    else if (/\bmedida\s+provis[oó]ria\b/i.test(header)) normType = 'medida_provisoria';
    else if (/\bparecer\b/i.test(header)) normType = 'parecer';

    const numYearMatch = header.match(
      /(?:lei|decreto|portaria|resolu[cç][aã]o|instru[cç][aã]o\s+normativa|rdc|parecer|medida\s+provis[oó]ria)\s*(?:[a-z/]{2,10}\s*)?(?:n[º°o.]?\s*)?([\d]{1,5}(?:\.[\d]{3})?)(?:\s*(?:\/|-|,?\s+de\s+[^,\n]*?de\s+))((?:19|20)\d{2})/i
    );

    const number = numYearMatch ? numYearMatch[1].replace(/\./g, '') : null;
    const yearMatch = numYearMatch ? numYearMatch[2] : header.match(/\b(19\d{2}|20\d{2})\b/)?.[1];
    const year = yearMatch ? parseInt(yearMatch, 10) : null;

    let issuingBody: string | null = null;
    if (/\bpresid[eê]ncia\s+da\s+rep[uú]blica|planalto|congresso\s+nacional\b/i.test(header)) {
      issuingBody = 'PRESIDENCIA_DA_REPUBLICA';
    } else if (/\banpd|autoridade\s+nacional\s+de\s+prote[cç][aã]o\s+de\s+dados\b/i.test(header)) {
      issuingBody = 'ANPD';
    } else if (/\bcfm|conselho\s+federal\s+de\s+medicina\b/i.test(header)) {
      issuingBody = 'CFM';
    } else if (/\banvisa|ag[eê]ncia\s+nacional\s+de\s+vigil[aâ]ncia\s+sanit[aá]ria\b/i.test(header)) {
      issuingBody = 'ANVISA';
    } else if (/\bans|ag[eê]ncia\s+nacional\s+de\s+sa[uú]de\s+suplementar\b/i.test(header)) {
      issuingBody = 'ANS';
    } else if (/\bminist[eé]rio\s+da\s+sa[uú]de\b/i.test(header)) {
      issuingBody = 'MINISTERIO_DA_SAUDE';
    }

    // Status: evita falso positivo de "Fica revogada a resolução anterior"
    let status: NormStatus = 'active';
    if (ScraperService.isExplicitlyRevokedNorm(title, content)) {
      status = 'revoked';
    } else if (/\b(redac[aã]o\s+dada\s+pel[ao]|inclu[ií]d[ao]\s+pel[ao]|alterad[ao]\s+pel[ao])\b/i.test(content)) {
      status = 'amended';
    }

    // Ementa: procura parágrafo com "Dispõe sobre...", "Altera...", "Regulamenta..."
    const ementaMatch = content.match(
      /((?:Disp[oõ]e\s+sobre|Regulamenta|Institui|Estabelece|Altera\s+a\s+Lei)[^.\n]{15,350}\.)/i
    );
    const summary = ementaMatch ? TextEncodingSanitizer.sanitizeAndRepairText(ementaMatch[1].trim()) : title;

    return {
      normType,
      number,
      year,
      issuingBody,
      publishedAt: year ? `${year}-01-01` : null,
      summary,
      status,
    };
  }

  /**
   * Extrai referências normativas (altera, revoga, regulamenta, cita)
   */
  public static extractLegalReferences(content: string): NormReference[] {
    const refs: NormReference[] = [];
    const seen = new Set<string>();

    const patterns: { relation: NormReference['relation']; regex: RegExp }[] = [
      {
        relation: 'revoga',
        regex: /(?:fica(?:m)?\s+revogad[ao]s?|revoga(?:-se)?)\s+a\s+((?:Lei|Resolu[cç][aã]o|Portaria|Decreto|Instru[cç][aã]o\s+Normativa)\s+[^.;\n]{3,80})/gi,
      },
      {
        relation: 'altera',
        regex: /altera\s+a\s+((?:Lei|Resolu[cç][aã]o|Portaria|Decreto)\s+(?:n[º°o]?\s*)?[\d.\/\-]+[^.;\n]{0,50})/gi,
      },
      {
        relation: 'regulamenta',
        regex: /regulamenta\s+(?:o\s+disposto\s+n[ao]\s+|a\s+)((?:Lei|Decreto|Resolu[cç][aã]o)\s+(?:n[º°o]?\s*)?[\d.\/\-]+[^.;\n]{0,50})/gi,
      },
    ];

    for (const { relation, regex } of patterns) {
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const target = match[1].trim().replace(/\s+/g, ' ');
        const key = `${relation}:${target.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          refs.push({ relation, target });
        }
      }
    }

    return refs;
  }

  /**
   * 5. Estratégia de Chunking Jurídico por Artigo:
   * - Unidade natural = Artigo (Art. 1º, Art. 2º...).
   * - Artigos muito longos (> maxTokens): quebra por parágrafo (§) ou inciso, mantendo o caput do artigo como prefixo!
   * - Cada chunk carrega `path` (ex: ["Capítulo II", "Seção I", "Art. 7º"]) e `headingContext`.
   * - Fallback semântico caso a norma não possua estrutura de artigos.
   */
  public static chunkLegalNormByArticle(
    normTitle: string,
    activeContentMd: string,
    maxTokens = 650
  ): LegalArticleChunk[] {
    const cleanText = TextEncodingSanitizer.sanitizeAndRepairText(activeContentMd);
    const lines = cleanText.split(/\r?\n/);

    let currentCapitulo: string | null = null;
    let currentSecao: string | null = null;
    let currentArticleHeader: string | null = null;
    let currentArticleLines: string[] = [];
    let preambleLines: string[] = [];

    const rawArticleBlocks: {
      path: string[];
      article: string | null;
      lines: string[];
    }[] = [];

    const flushCurrentArticle = () => {
      if (currentArticleHeader && currentArticleLines.length > 0) {
        const path = [currentCapitulo, currentSecao, currentArticleHeader].filter(Boolean) as string[];
        rawArticleBlocks.push({
          path,
          article: currentArticleHeader,
          lines: [...currentArticleLines],
        });
      }
      currentArticleLines = [];
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      const capMatch = line.match(/^(?:#+\s*)?(CAP[IÍ]TULO\s+[IVXLCDM0-9]+(?:\s*[-–—:]?\s*.*)?)$/i);
      if (capMatch) {
        flushCurrentArticle();
        currentCapitulo = capMatch[1].replace(/^#+\s*/, '').trim();
        currentSecao = null;
        continue;
      }

      const secMatch = line.match(/^(?:#+\s*)?(SE[CÇ][AÃ]O\s+[IVXLCDM0-9]+(?:\s*[-–—:]?\s*.*)?)$/i);
      if (secMatch) {
        flushCurrentArticle();
        currentSecao = secMatch[1].replace(/^#+\s*/, '').trim();
        continue;
      }

      const artMatch = line.match(/^(?:#+\s*)?(Art\.?\s*(\d+(?:[º°o]|\.[º°o])?(?:-[A-Z])?))(?=\s|$|\.|[-–—:])/i);
      if (artMatch) {
        flushCurrentArticle();
        const rawNum = artMatch[2];
        currentArticleHeader = `Art. ${rawNum}`;
        currentArticleLines.push(line.replace(/^#+\s*/, ''));
        continue;
      }

      if (currentArticleHeader) {
        currentArticleLines.push(line);
      } else {
        preambleLines.push(line);
      }
    }
    flushCurrentArticle();

    const finalChunks: LegalArticleChunk[] = [];
    const maxChars = maxTokens * 4;

    // Se a norma possui artigos estruturados
    if (rawArticleBlocks.length > 0) {
      for (const block of rawArticleBlocks) {
        const fullArticleText = block.lines.join('\n').trim();
        const caput = block.lines[0] || block.article || '';

        if (fullArticleText.length <= maxChars || block.lines.length <= 1) {
          const headingContext = `${normTitle} | ${block.path.join(' > ')}`;
          const tokenCount = Math.ceil(fullArticleText.length / 4);
          finalChunks.push({
            chunkIndex: finalChunks.length,
            text: fullArticleText,
            tokenCount,
            path: block.path,
            article: block.article,
            headingContext,
            contentHash: crypto.createHash('sha256').update(fullArticleText, 'utf8').digest('hex'),
          });
        } else {
          // Artigo muito longo: quebra por parágrafo (§ / Parágrafo único) ou inciso, mantendo o caput como prefixo
          let subBuffer: string[] = [caput];
          let currentSubLabel: string | null = null;

          const flushSub = () => {
            const subText = subBuffer.join('\n').trim();
            if (subText && subText !== caput) {
              const subPath = currentSubLabel ? [...block.path, currentSubLabel] : [...block.path];
              const headingContext = `${normTitle} | ${subPath.join(' > ')}`;
              finalChunks.push({
                chunkIndex: finalChunks.length,
                text: subText,
                tokenCount: Math.ceil(subText.length / 4),
                path: subPath,
                article: block.article,
                headingContext,
                contentHash: crypto.createHash('sha256').update(subText, 'utf8').digest('hex'),
              });
            }
            subBuffer = [caput];
          };

          for (let i = 1; i < block.lines.length; i++) {
            const subLine = block.lines[i];
            const parMatch = subLine.match(/^(§\s*\d+[º°o]?|Par[aá]grafo\s+[uú]nico)\b/i);
            if (parMatch) {
              if (subBuffer.join('\n').length > maxChars * 0.45) {
                flushSub();
              }
              currentSubLabel = parMatch[1];
            } else if (subBuffer.join('\n').length + subLine.length > maxChars) {
              flushSub();
            }
            subBuffer.push(subLine);
          }
          flushSub();
        }
      }
      return finalChunks;
    }

    // 5.1 Estratégia especializada para Pareceres Deontológicos (CFM/CRM): quebra por seções formais
    const isParecerText =
      /\bparecer\b/i.test(normTitle) ||
      /\b(relat[oó]rio|voto(?:\s+do\s+relator)?|do\s+parecer|conclus[aã]o|sess[aã]o\s+plen[aá]ria)\b/i.test(cleanText);

    const rawParecerSections: { sectionName: string; lines: string[] }[] = [];
    if (isParecerText) {
      let currentSectionName: string | null = null;
      let currentSectionLines: string[] = [];

      const flushSection = () => {
        if (currentSectionName && currentSectionLines.length > 0) {
          rawParecerSections.push({
            sectionName: currentSectionName,
            lines: [...currentSectionLines],
          });
        }
        currentSectionLines = [];
      };

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        const secMatch = line.match(
          /^(?:#+\s*)?(EMENTA|RELAT[OÓ]RIO|DO\s+PARECER|PARECER|DO\s+VOTO|VOTO(?:\s+DO\s+RELATOR)?|DA\s+CONCLUS[AÃ]O|CONCLUS[AÃ]O|SESS[AÃ]O\s+PLEN[AÃ]RIA)\b/i
        );

        if (secMatch) {
          flushSection();
          currentSectionName = secMatch[1].toUpperCase();
          continue;
        }

        if (currentSectionName) {
          currentSectionLines.push(line);
        } else {
          // Preâmbulo do parecer (cabeçalho)
          if (!currentSectionName) {
            currentSectionName = 'Identificação do Parecer';
          }
          currentSectionLines.push(line);
        }
      }
      flushSection();
    }

    if (rawParecerSections.length >= 2) {
      for (const sec of rawParecerSections) {
        const fullSecText = sec.lines.join('\n').trim();
        if (!fullSecText) continue;

        const path = ['Parecer Deontológico', sec.sectionName];
        const headingContext = `${normTitle} | ${sec.sectionName}`;

        if (fullSecText.length <= maxChars) {
          finalChunks.push({
            chunkIndex: finalChunks.length,
            text: fullSecText,
            tokenCount: Math.ceil(fullSecText.length / 4),
            path,
            article: null,
            headingContext,
            contentHash: crypto.createHash('sha256').update(fullSecText, 'utf8').digest('hex'),
          });
        } else {
          // Subdivide seções longas de parecer preservando a contextualização da seção
          const secParagraphs = fullSecText.split(/\n{2,}/).filter((p) => p.trim().length > 0);
          let secBuffer = '';
          for (const p of secParagraphs) {
            if (secBuffer.length + p.length > maxChars && secBuffer.length > 0) {
              const text = secBuffer.trim();
              finalChunks.push({
                chunkIndex: finalChunks.length,
                text,
                tokenCount: Math.ceil(text.length / 4),
                path,
                article: null,
                headingContext,
                contentHash: crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
              });
              const overlapSlice = text.slice(-Math.floor(maxChars * 0.1));
              secBuffer = `${overlapSlice}\n${p}`;
            } else {
              secBuffer = secBuffer ? `${secBuffer}\n\n${p}` : p;
            }
          }
          if (secBuffer.trim().length > 0) {
            const text = secBuffer.trim();
            finalChunks.push({
              chunkIndex: finalChunks.length,
              text,
              tokenCount: Math.ceil(text.length / 4),
              path,
              article: null,
              headingContext,
              contentHash: crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
            });
          }
        }
      }
      return finalChunks;
    }

    // Fallback para normas sem estrutura de "Art. X": quebra por seções/parágrafos semânticos
    const paragraphs = cleanText.split(/\n{2,}/).filter((p) => p.trim().length > 0);
    let buffer = '';
    for (const p of paragraphs) {
      if (buffer.length + p.length > maxChars && buffer.length > 0) {
        const text = buffer.trim();
        const path = ['Texto Normativo'];
        finalChunks.push({
          chunkIndex: finalChunks.length,
          text,
          tokenCount: Math.ceil(text.length / 4),
          path,
          article: null,
          headingContext: `${normTitle} | Texto Normativo`,
          contentHash: crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
        });
        // Sobreposição mínima (~10%) em quebra forçada
        const overlapSlice = text.slice(-Math.floor(maxChars * 0.1));
        buffer = `${overlapSlice}\n${p}`;
      } else {
        buffer = buffer ? `${buffer}\n\n${p}` : p;
      }
    }
    if (buffer.trim().length > 0) {
      const text = buffer.trim();
      finalChunks.push({
        chunkIndex: finalChunks.length,
        text,
        tokenCount: Math.ceil(text.length / 4),
        path: ['Texto Normativo'],
        article: null,
        headingContext: `${normTitle} | Texto Normativo`,
        contentHash: crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
      });
    }

    return finalChunks;
  }

  /**
   * 6. Persistência Idempotente e Versionada em `norms`, `scraped_pages` e `norms_chunk`:
   * - Mesma source_url + mesmo content_hash -> ignora (idempotente).
   * - Persiste o documento raspado em `scraped_pages` e mantém os embeddings em `norms_chunk`.
   * - Mesma source_url + content_hash diferente -> incrementa version e substitui os chunks da norma.
   */
  private static async upsertScrapedPage(
    doc: ExtractedDocumentContent,
    canonicalUrl: string,
    tags: string[]
  ): Promise<void> {
    const pageData = {
      title: doc.title,
      cleanMarkdown: doc.contentMd,
      rawLength: doc.contentMd.length,
      tokensCount: Math.ceil(doc.contentMd.length / 4),
      tags: Array.from(new Set(tags.map((tag) => tag.trim().toUpperCase()).filter(Boolean))),
    };

    await prisma.scrapedPage.upsert({
      where: { url: canonicalUrl },
      update: pageData,
      create: {
        url: canonicalUrl,
        ...pageData,
      },
    });
  }

  public static async persistNormWithIdempotency(params: {
    doc: ExtractedDocumentContent;
    classification: NormClassificationResult;
    discoveredFrom: string;
    originChain: string[];
    tags?: string[];
    force?: boolean;
  }): Promise<{
    action: 'created' | 'updated_version' | 'skipped_idempotent';
    norm: any;
    chunksCount: number;
  }> {
    const { doc, classification, discoveredFrom, originChain, tags = [], force = false } = params;
    const canonicalUrl = this.normalizeCanonicalUrl(doc.url) || doc.url;
    const yaml = doc.yamlMetadata;

    const existing = await prisma.norm.findFirst({
      where: {
        OR: [
          { urlOriginal: canonicalUrl },
          ...(yaml?.url_original ? [{ urlOriginal: yaml.url_original }] : []),
          ...(yaml?.id ? [{ normId: yaml.id }] : []),
        ],
      },
    });

    const orgao = (yaml?.orgao || classification.issuingBody || 'GOV_BR').toUpperCase();
    const tipo = (yaml?.tipo || classification.normType || 'LEI').toUpperCase();
    const numero =
      yaml?.numero ||
      classification.number ||
      `SN-${crypto.createHash('md5').update(canonicalUrl).digest('hex').slice(0, 6).toUpperCase()}`;
    const ano = String(yaml?.ano || classification.year || new Date().getFullYear());
    const statusMap: Record<NormStatus, string> = {
      active: 'VIGENTE',
      revoked: 'REVOGADA',
      amended: 'VIGENTE',
      unknown: 'VIGENTE',
    };

    let dbStatus = statusMap[classification.status] || 'VIGENTE';
    if (yaml?.status) {
      const lowerYStatus = String(yaml.status).toLowerCase();
      if (lowerYStatus.includes('vigente') || lowerYStatus.includes('ativo')) {
        dbStatus = 'VIGENTE';
      } else if (lowerYStatus.includes('revog')) {
        dbStatus = 'REVOGADA';
      }
    }

    const normCode = yaml?.id || `${orgao}-${tipo.slice(0, 3)}-${numero}-${ano}`;
    const existingTags = existing?.tags ?? [];
    const scrapedPageTags = Array.from(new Set(tags));
    const combinedTags = Array.from(
      new Set([
        ...existingTags.filter((tag) => tag !== 'VIGENTE' && tag !== 'REVOGADA'),
        orgao,
        tipo,
        dbStatus,
        ...tags.map((t) => t.toUpperCase()),
        'RAG_READY',
        'NORMAS_OFFICIAL',
      ])
    );

    // Mantém a cópia da página raspada mesmo quando a norma já está sincronizada.
    if (existing && existing.sha256Original === doc.contentHash && !force) {
      const tagsChanged =
        existingTags.length !== combinedTags.length ||
        combinedTags.some((tag) => !existingTags.includes(tag));
      const norm = tagsChanged
        ? await prisma.norm.update({
            where: { id: existing.id },
            data: { tags: combinedTags },
          })
        : existing;
      await this.upsertScrapedPage(doc, canonicalUrl, scrapedPageTags);

      // Commit individual registrado na telemetria por arquivo processado (idempotente)
      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          module: 'LEGAL_NORM_CRAWLER',
          correlationId: norm.id,
          message: `[FILE_COMMIT_SUCCESS] Arquivo normativo processado e sincronizado no banco (idempotente): "${doc.title}" (${norm.normId}) com ${existing.totalChunks || 0} chunks [ação: skipped_idempotent].`,
          details: JSON.stringify({
            normId: norm.id,
            normCode: norm.normId,
            url: canonicalUrl,
            fileType: doc.fileType,
            action: 'skipped_idempotent',
            chunksCount: existing.totalChunks || 0,
          }),
        },
      }).catch(() => {});

      return {
        action: 'skipped_idempotent',
        norm,
        chunksCount: existing.totalChunks || 0,
      };
    }

    const articleChunks = this.chunkLegalNormByArticle(doc.title, doc.activeContentMd);
    let chunkEmbeddings: number[][] = [];
    let embeddingPending = false;
    let embeddingErrorMessage = '';
    if (dbStatus !== 'REVOGADA') {
      try {
        chunkEmbeddings = await SemanticEmbeddingService.embedDocuments(
          articleChunks.map((chunk) => `${chunk.headingContext}\n${chunk.text}`)
        );
      } catch (embErr: any) {
        // O arquivo é commitado mesmo assim (texto + hierarquia), mas os chunks ficam marcados como
        // EMBEDDING_PENDING: não travam o commit por arquivo e o reindex os detecta
        embeddingPending = true;
        embeddingErrorMessage = embErr?.message || String(embErr);
        chunkEmbeddings = articleChunks.map(() => []);
      }
    }

    let previousVersion = 0;
    if (existing?.metadadosRAG) {
      try {
        const parsedMeta = JSON.parse(existing.metadadosRAG);
        previousVersion = typeof parsedMeta.version === 'number' ? parsedMeta.version : 1;
      } catch {
        previousVersion = 1;
      }
    }
    const nextVersion = existing ? previousVersion + 1 : 1;

    const metadadosRAGObj = {
      source_url: canonicalUrl,
      discovered_from: discoveredFrom,
      origin_chain: originChain,
      norm_type: classification.normType,
      number: classification.number,
      year: classification.year,
      issuing_body: classification.issuingBody,
      published_at: classification.publishedAt,
      status: classification.status,
      file_type: doc.fileType,
      extraction_method: doc.extractionMethod,
      classification: {
        score: classification.score,
        layer: classification.layer,
        reason: classification.reason,
      },
      references: classification.references,
      revoked_strikes_count: doc.revokedStrikes.length,
      version: nextVersion,
    };

    let savedNorm: any;
    let action: 'created' | 'updated_version' = 'created';

    try {
      if (existing) {
        action = 'updated_version';
        savedNorm = await prisma.norm.update({
          where: { id: existing.id },
          data: {
            normId: existing.normId || normCode,
            orgao,
            tipo,
            numero,
            ano,
            status: dbStatus,
            dataPublicacao: classification.publishedAt,
            ementaOriginal: yaml?.ementa || classification.summary || doc.title,
            ementaHigienizada: yaml?.ementa || classification.summary || doc.title,
            sha256Original: doc.contentHash,
            conteudoOriginalBruto: doc.contentMd,
            conteudoHigienizado: doc.activeContentMd,
            cleanMarkdown: doc.activeContentMd,
            totalChunks: articleChunks.length,
            tokensEstimados: Math.ceil(doc.activeContentMd.length / 4),
            tags: combinedTags,
            metadadosRAG: JSON.stringify(metadadosRAGObj),
            ...(yaml?.id_norma_cfm ? { idNormaCfm: String(yaml.id_norma_cfm) } : {}),
            ...(yaml?.url_pdf_original ? { urlPdfOriginal: yaml.url_pdf_original } : {}),
            ...(yaml?.macro_tema ? { macroTema: yaml.macro_tema } : {}),
          },
        });
        // Substituição atômica dos chunks: remove os chunks da versão anterior antes de inserir os novos
        await prisma.normChunk.deleteMany({ where: { normId: savedNorm.id } });
      } else {
        savedNorm = await prisma.norm.create({
          data: {
            normId: normCode,
            idNormaCfm: yaml?.id_norma_cfm ? String(yaml.id_norma_cfm) : null,
            orgao,
            tipo,
            numero,
            ano,
            status: dbStatus,
            dataPublicacao: yaml?.data_publicacao || classification.publishedAt,
            ementaOriginal: yaml?.ementa || classification.summary || doc.title,
            ementaHigienizada: yaml?.ementa || classification.summary || doc.title,
            macroTema: yaml?.macro_tema || 'Conformidade Regulatória e Normas Legais',
            urlOriginal: yaml?.url_original || canonicalUrl,
            urlPdfOriginal: yaml?.url_pdf_original || (doc.fileType === 'pdf' ? canonicalUrl : null),
            sha256Original: doc.contentHash,
            conteudoOriginalBruto: doc.contentMd,
            conteudoHigienizado: doc.activeContentMd,
            cleanMarkdown: doc.activeContentMd,
            totalChunks: articleChunks.length,
            tokensEstimados: Math.ceil(doc.activeContentMd.length / 4),
            tags: combinedTags,
            metadadosRAG: JSON.stringify(metadadosRAGObj),
          },
        });
      }

      // Regra 4.3: Normas com status REVOGADA (classification.status === 'revoked') são salvas na coleção 'norms'
      // para rastreabilidade histórica, mas NUNCA geram chunks em 'norms_chunk' para não entrar no contexto da IA!
      const chunkRecords =
        dbStatus === 'REVOGADA'
          ? []
          : articleChunks.map((ch, index) => {
              const embedding = chunkEmbeddings[index];
              return {
                normId: savedNorm.id,
                normCode: savedNorm.normId,
                chunkIndex: ch.chunkIndex + 1,
                totalChunks: articleChunks.length,
                conteudoChunk: ch.text,
                tokensEstimados: ch.tokenCount,
                caracteresCount: ch.text.length,
                contextoSemantico: JSON.stringify({
                  heading_context: ch.headingContext,
                  path: ch.path,
                  article: ch.article,
                  norm_title: doc.title,
                  norm_type: classification.normType,
                  year: classification.year,
                  status: classification.status,
                  source_url: canonicalUrl,
                  // Modelo marcado como pendente => searchNormChunksVector ignora o chunk e o reindex o detecta
                  embedding_model: embeddingPending ? 'PENDING_REINDEX' : SemanticEmbeddingService.embeddingModelId,
                  content_hash: ch.contentHash,
                }),
                overlapTokens: 0,
                maxChunkTokens: 650,
                embedding,
                tags: embeddingPending ? [...combinedTags, 'EMBEDDING_PENDING'] : combinedTags,
              };
            });

      if (chunkRecords.length > 0) {
        await prisma.normChunk.createMany({ data: chunkRecords });
      }

      await this.upsertScrapedPage(doc, canonicalUrl, scrapedPageTags);

      if (embeddingPending) {
        await prisma.systemLog.create({
          data: {
            level: 'WARN',
            module: 'LEGAL_NORM_CRAWLER',
            correlationId: savedNorm.id,
            message: `[EMBEDDING_PENDING] "${doc.title}" (${savedNorm.normId}) commitada com ${chunkRecords.length} chunks SEM vetor (falha no Gemini: ${embeddingErrorMessage}). Execute o reindex para habilitar na busca vetorial.`,
            details: JSON.stringify({
              normId: savedNorm.id,
              normCode: savedNorm.normId,
              url: canonicalUrl,
              chunksCount: chunkRecords.length,
              error: embeddingErrorMessage,
            }),
          },
        }).catch(() => {});
      }

      // Commit individual registrado na telemetria por arquivo processado
      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          module: 'LEGAL_NORM_CRAWLER',
          correlationId: savedNorm.id,
          message: `[FILE_COMMIT_SUCCESS] Arquivo normativo processado e commitado no banco: "${doc.title}" (${savedNorm.normId}) com ${chunkRecords.length} chunks [ação: ${action}, versão: ${nextVersion}, embeddings: ${embeddingPending ? 'PENDENTES' : dbStatus === 'REVOGADA' ? 'N/A (revogada)' : 'OK'}].`,
          details: JSON.stringify({
            normId: savedNorm.id,
            normCode: savedNorm.normId,
            url: canonicalUrl,
            fileType: doc.fileType,
            action,
            version: nextVersion,
            chunksCount: chunkRecords.length,
            embeddingPending,
          }),
        },
      }).catch(() => {});

      return {
        action,
        norm: savedNorm,
        chunksCount: chunkRecords.length,
      };
    } catch (dbErr: any) {
      await prisma.systemLog.create({
        data: {
          level: 'ERROR',
          module: 'LEGAL_NORM_CRAWLER',
          correlationId: normCode,
          message: `[FILE_COMMIT_ERROR] Falha ao commitar arquivo normativo no banco (${canonicalUrl}): ${dbErr.message}`,
          details: JSON.stringify({
            url: canonicalUrl,
            title: doc.title,
            normCode,
            fileType: doc.fileType,
            error: dbErr.message,
            stack: dbErr.stack,
          }),
        },
      }).catch(() => {});
      throw dbErr;
    }
  }

  /**
   * Executa um Job de Crawling Recursivo Controlado a partir de uma URL de entrada
   */
  public static async executeCrawlJob(options: {
    url: string;
    maxDepth?: number;
    allowedDomains?: string[];
    tags?: string[];
    force?: boolean;
    maxPages?: number;
    /** Usa o Firecrawl como primeira opção de captura de páginas HTML (padrão: true) */
    preferFirecrawl?: boolean;
    /** Permite ao chamador definir o jobId (para responder 202 antes do término) */
    jobId?: string;
  }): Promise<CrawlJobState> {
    const canonicalRoot = this.normalizeCanonicalUrl(options.url);
    if (!canonicalRoot) {
      throw new Error('URL inicial inválida para crawling.');
    }
    if (this.isScriptOrStyleUrl(canonicalRoot)) {
      throw new Error('A URL inicial aponta para um script ou folha de estilo (.js, .css) e foi descartada do scraping normativo.');
    }

    const ssrfRoot = await validateSafeUrlAsync(canonicalRoot);
    if (!ssrfRoot.safe) {
      throw new Error(`SSRF bloqueado: ${ssrfRoot.reason}`);
    }

    const jobId = options.jobId || `crawl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const maxDepth = options.maxDepth ?? 2;
    const maxPages = options.maxPages ?? env.CRAWL_MAX_PAGES ?? 1000;
    const allowedDomains = options.allowedDomains || [];
    const tags = options.tags || [];
    const force = options.force === true;

    const jobState: CrawlJobState = {
      jobId,
      rootUrl: canonicalRoot,
      status: 'running',
      maxDepth,
      allowedDomains,
      tags,
      force,
      counters: {
        discovered: 1,
        downloaded: 0,
        normsSaved: 0,
        normsSkippedIdempotent: 0,
        normsUpdatedVersion: 0,
        discarded: 0,
        errors: 0,
      },
      savedNormIds: [],
      discards: [],
      errors: [],
      startedAt: new Date().toISOString(),
    };

    this.jobs.set(jobId, jobState);

    const preferFirecrawl = options.preferFirecrawl !== false;
    const allowedTopics: NormTopic[] = resolveRequestedTopics(tags);

    await LinkTraceService.record({
      jobId,
      url: canonicalRoot,
      status: 'DISCOVERED',
      depth: 0,
      parentUrl: canonicalRoot,
      fileType: this.classifyLinkFileType(canonicalRoot),
      anchorText: 'URL Raiz',
      reason: `Job iniciado. Temas aceitos: ${allowedTopics.join(', ')}`,
    });

    const queue: DiscoveredLink[] = [
      {
        url: canonicalRoot,
        anchorText: 'URL Raiz',
        surroundingText: '',
        fileType: this.classifyLinkFileType(canonicalRoot),
        depth: 0,
        discoveredFrom: canonicalRoot,
        originChain: [canonicalRoot],
      },
    ];

    const visitedUrls = new Set<string>();
    const queuedUrls = new Set<string>([canonicalRoot]);
    const visitedContentHashes = new Set<string>();

    while (queue.length > 0 && jobState.counters.downloaded < maxPages) {
      const current = queue.shift()!;
      let normUrl = this.normalizeCanonicalUrl(current.url) || current.url;
      // Normalização automática de URLs do GitHub para download do conteúdo bruto (raw)
      normUrl = this.convertGithubBlobToRawUrl(normUrl);

      // Descarte prévio e silencioso de arquivos de script e estilos (.css, .js) antes de qualquer telemetria
      if (this.isScriptOrStyleUrl(normUrl) || this.isScriptOrStyleUrl(current.url)) {
        visitedUrls.add(normUrl);
        continue;
      }
      if (visitedUrls.has(normUrl)) {
        await LinkTraceService.record({
          jobId,
          url: normUrl,
          status: 'SKIPPED_DUPLICATE',
          parentUrl: current.discoveredFrom,
          depth: current.depth,
          reason: 'URL já visitada neste job',
        });
        continue;
      }
      visitedUrls.add(normUrl);

      const safeCheck = await validateSafeUrlAsync(normUrl);
      if (!safeCheck.safe) {
        const ssrfMsg = `SSRF bloqueado: ${safeCheck.reason}`;
        await LinkTraceService.record({
          jobId,
          url: normUrl,
          status: 'BLOCKED_SSRF',
          parentUrl: current.discoveredFrom,
          depth: current.depth,
          reason: ssrfMsg,
        });
        jobState.counters.errors++;
        jobState.errors.push({ url: normUrl, message: ssrfMsg });
        await prisma.systemLog.create({
          data: {
            level: 'ERROR',
            module: 'LEGAL_NORM_CRAWLER',
            correlationId: jobId,
            message: `[CRAWLER_FILE_ERROR] Bloqueio de segurança ao processar arquivo "${normUrl}": ${ssrfMsg}`,
            details: JSON.stringify({
              url: normUrl,
              discoveredFrom: current.discoveredFrom,
              depth: current.depth,
              error: ssrfMsg,
            }),
          },
        }).catch(() => {});
        continue;
      }

      let pendingChildEnqueue: (() => Promise<void>) | null = null;
      try {
        let extracted: ExtractedDocumentContent | null = null;
        let engine: 'firecrawl' | 'http' = 'http';
        const guessedType = this.classifyLinkFileType(normUrl, current.anchorText);

        // ADR-001 (PONTO 2): Para páginas HTML, usa FirecrawlClient v2 como PRIMEIRA opção de captura/renderização JS
        // (apenas markdown, html, rawHtml, links — SEM formato `json`), com fallback automático para HTTP nativo + Cheerio.
        if (guessedType === 'html' && preferFirecrawl && FirecrawlClient.isConfigured()) {
          try {
            const fcResult = await FirecrawlClient.scrapeMarkdownAndLinks(normUrl, {
              onlyMainContent: false,
              includeHtml: true,
              includeRawHtml: true,
            });
            if (fcResult.html || fcResult.rawHtml) {
              jobState.counters.downloaded++;
              engine = 'firecrawl';
              extracted = this.extractCleanMarkdownFromHtml(
                normUrl,
                fcResult.html || fcResult.rawHtml,
                current.depth,
                current.originChain,
                allowedDomains
              );
            }
          } catch {
            // Fallback silencioso e resiliente para o fetcher HTTP nativo
          }
        }

        if (!extracted) {
          const resp = await safeHttpGet(normUrl, {
            responseType: 'arraybuffer',
            timeout: 20000,
            headers: {
              'User-Agent': 'ConformIA-LegalNormCrawler/2.0 (+https://conform.ai)',
              Accept: 'text/html,application/xhtml+xml,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,*/*',
            },
          });

          jobState.counters.downloaded++;
          const contentType = String(resp.headers?.['content-type'] || '').toLowerCase();
          const buf = Buffer.isBuffer(resp.data) ? resp.data : Buffer.from(String(resp.data || ''));

          // Limite de segurança de tamanho de arquivo (25 MB)
          if (buf.length > 25 * 1024 * 1024) {
            const sizeMsg = 'Arquivo excede limite máximo de 25MB';
            await LinkTraceService.record({
              jobId,
              url: normUrl,
              status: 'ERROR',
              parentUrl: current.discoveredFrom,
              depth: current.depth,
              engine,
              reason: sizeMsg,
            });
            jobState.counters.errors++;
            jobState.errors.push({ url: normUrl, message: sizeMsg });
            await prisma.systemLog.create({
              data: {
                level: 'ERROR',
                module: 'LEGAL_NORM_CRAWLER',
                correlationId: jobId,
                message: `[CRAWLER_FILE_ERROR] Falha ao processar arquivo "${normUrl}": ${sizeMsg}`,
                details: JSON.stringify({
                  url: normUrl,
                  sizeBytes: buf.length,
                  discoveredFrom: current.discoveredFrom,
                  error: sizeMsg,
                }),
              },
            }).catch(() => {});
            continue;
          }

          const effectiveType = this.classifyLinkFileType(normUrl, current.anchorText, contentType);

          if (effectiveType === 'pdf' || buf.subarray(0, 5).toString('ascii').startsWith('%PDF')) {
            extracted = await this.extractFromPdfBuffer(
              normUrl,
              buf,
              current.depth,
              current.originChain,
              allowedDomains,
              current.anchorText
            );
          } else if (effectiveType === 'docx') {
            extracted = this.extractFromDocxBuffer(
              normUrl,
              buf,
              current.depth,
              current.originChain,
              allowedDomains,
              current.anchorText
            );
          } else if (effectiveType === 'markdown') {
            const decodedMarkdown = TextEncodingSanitizer.decodeBufferWithAutoEncoding(buf, contentType);
            extracted = this.extractFromMarkdownText(
              normUrl,
              decodedMarkdown,
              current.depth,
              current.originChain,
              allowedDomains,
              current.anchorText
            );
          } else {
            const decodedHtml = TextEncodingSanitizer.decodeBufferWithAutoEncoding(buf, contentType);
            extracted = this.extractCleanMarkdownFromHtml(
              normUrl,
              decodedHtml,
              current.depth,
              current.originChain,
              allowedDomains
            );
          }
        }

        // Prepara função para enfileirar links filhos após a conclusão e commit do arquivo atual
        const enqueueChildLinks = async () => {
          const traceBatch: any[] = [];
          for (const skippedLink of extracted.skippedLinks || []) {
            traceBatch.push({
              jobId,
              url: skippedLink.url,
              status: skippedLink.reason.includes('allowlist') ? 'SKIPPED_DOMAIN' : 'SKIPPED_IRRELEVANT',
              parentUrl: normUrl,
              depth: current.depth + 1,
              reason: skippedLink.reason,
            });
          }

          for (const childLink of extracted.discoveredLinks) {
            const childCanonical = this.normalizeCanonicalUrl(childLink.url);
            if (!childCanonical) continue;

            if (visitedUrls.has(childCanonical) || queuedUrls.has(childCanonical)) {
              traceBatch.push({
                jobId,
                url: childCanonical,
                status: 'SKIPPED_DUPLICATE',
                parentUrl: normUrl,
                depth: current.depth + 1,
                anchorText: childLink.anchorText,
                fileType: childLink.fileType,
                reason: 'Link já descoberto/visitado neste job',
              });
              continue;
            }

            if (current.depth >= maxDepth) {
              queuedUrls.add(childCanonical);
              traceBatch.push({
                jobId,
                url: childCanonical,
                status: 'SKIPPED_MAX_DEPTH',
                parentUrl: normUrl,
                depth: current.depth + 1,
                anchorText: childLink.anchorText,
                fileType: childLink.fileType,
                reason: `Profundidade máxima (${maxDepth}) atingida`,
              });
              continue;
            }

            queuedUrls.add(childCanonical);
            queue.push(childLink);
            jobState.counters.discovered++;
            traceBatch.push({
              jobId,
              url: childCanonical,
              status: 'DISCOVERED',
              parentUrl: normUrl,
              depth: current.depth + 1,
              anchorText: childLink.anchorText,
              fileType: childLink.fileType,
            });
          }

          await LinkTraceService.recordMany(traceBatch);
        };
        pendingChildEnqueue = enqueueChildLinks;

        // Deduplicação em memória por content_hash dentro do mesmo job
        if (visitedContentHashes.has(extracted.contentHash) && !force) {
          await LinkTraceService.record({
            jobId,
            url: normUrl,
            status: 'DISCARDED_DUPLICATE_CONTENT',
            parentUrl: current.discoveredFrom,
            depth: current.depth,
            title: extracted.title,
            engine,
            reason: 'Conteúdo idêntico (mesmo SHA-256) já processado neste job',
          });
          await enqueueChildLinks();
          continue;
        }
        visitedContentHashes.add(extracted.contentHash);

        // Classifica "é norma legal?" (estrutura jurídica) e, separadamente, os temas aceitos
        const classification = await this.classifyLegalNorm(extracted, tags);
        const topicMatches = classifyNormTopics(extracted.title, extracted.activeContentMd);
        const detectedTopics = topicMatches.map((m) => m.topic);
        const topicsInScope = detectedTopics.filter((t) => allowedTopics.includes(t));

        if (!classification.isNorm) {
          // Links de entrada, índices e páginas de navegação que não são normas não são salvos em scraped_pages
          jobState.counters.discarded++;
          jobState.discards.push({
            url: normUrl,
            title: extracted.title,
            status: 'discarded',
            reason: classification.reason,
            score: classification.score,
            layer: classification.layer,
            discoveredFrom: current.discoveredFrom,
            timestamp: new Date().toISOString(),
          });
          await LinkTraceService.record({
            jobId,
            url: normUrl,
            status: 'DISCARDED_NOT_NORM',
            parentUrl: current.discoveredFrom,
            depth: current.depth,
            fileType: extracted.fileType,
            title: extracted.title,
            engine,
            topics: detectedTopics,
            score: classification.score,
            reason: classification.reason,
          });
        } else {
          // Arquivo normativo válido identificado: executa imediatamente todo o processo de RAG, chunk e persistência
          const effectiveTopics =
            topicsInScope.length > 0
              ? topicsInScope
              : detectedTopics.length > 0
                ? detectedTopics
                : tags.length > 0
                  ? tags
                  : [classification.issuingBody || 'GERAL'];

          const persisted = await this.persistNormWithIdempotency({
            doc: extracted,
            classification,
            discoveredFrom: current.discoveredFrom,
            originChain: current.originChain,
            tags: Array.from(new Set([...tags, ...effectiveTopics])),
            force,
          });

          let traceStatus: 'SAVED' | 'UPDATED' | 'UNCHANGED' = 'UNCHANGED';
          if (persisted.action === 'created') {
            jobState.counters.normsSaved++;
            jobState.savedNormIds.push(persisted.norm.id);
            traceStatus = 'SAVED';
          } else if (persisted.action === 'updated_version') {
            jobState.counters.normsUpdatedVersion++;
            jobState.savedNormIds.push(persisted.norm.id);
            traceStatus = 'UPDATED';
          } else {
            jobState.counters.normsSkippedIdempotent++;
          }

          await LinkTraceService.record({
            jobId,
            url: normUrl,
            status: traceStatus,
            parentUrl: current.discoveredFrom,
            depth: current.depth,
            fileType: extracted.fileType,
            title: extracted.title,
            engine,
            topics: effectiveTopics.map((t) => (TOPIC_LABELS[t as NormTopic] ? `${t} (${TOPIC_LABELS[t as NormTopic]})` : t)),
            normId: persisted.norm?.id,
            chunksCount: persisted.chunksCount,
            score: classification.score,
            reason:
              traceStatus === 'SAVED'
                ? 'Norma gravada em norms e vetorizada em norms_chunk'
                : traceStatus === 'UPDATED'
                ? 'Nova versão da norma gravada (conteúdo mudou)'
                : 'Norma já existente com mesmo SHA-256 (idempotente)',
          });
        }

        // Arquivo atual já está commitado (ou descartado); só agora segue para os links filhos
        pendingChildEnqueue = null;
        await enqueueChildLinks();
      } catch (err: any) {
        if (pendingChildEnqueue) {
          const enqueueAfterError: () => Promise<void> = pendingChildEnqueue;
          pendingChildEnqueue = null;
          await enqueueAfterError().catch(() => {});
        }
        await LinkTraceService.record({
          jobId,
          url: normUrl,
          status: 'ERROR',
          parentUrl: current.discoveredFrom,
          depth: current.depth,
          fileType: current.fileType,
          reason: err.message,
        });
        jobState.counters.errors++;
        jobState.errors.push({ url: normUrl, message: err.message });
        await prisma.systemLog.create({
          data: {
            level: 'ERROR',
            module: 'LEGAL_NORM_CRAWLER',
            correlationId: jobId,
            message: `[CRAWLER_FILE_ERROR] Erro ao processar arquivo "${normUrl}": ${err.message}`,
            details: JSON.stringify({
              url: normUrl,
              fileType: current.fileType,
              depth: current.depth,
              discoveredFrom: current.discoveredFrom,
              originChain: current.originChain,
              error: err.message,
              stack: err.stack,
            }),
          },
        }).catch(() => {});
      }
    }

    // Links que ficaram na fila quando o limite de páginas do job foi atingido: registrados para auditoria
    for (const pending of queue) {
      const pendingUrl = this.normalizeCanonicalUrl(pending.url) || pending.url;
      if (visitedUrls.has(pendingUrl)) continue;
      await LinkTraceService.record({
        jobId,
        url: pendingUrl,
        status: 'SKIPPED_MAX_PAGES',
        parentUrl: pending.discoveredFrom,
        depth: pending.depth,
        anchorText: pending.anchorText,
        fileType: pending.fileType,
        reason: `Limite de páginas do job (${maxPages}) atingido antes de abrir este link`,
      });
    }

    jobState.status = 'completed';
    jobState.finishedAt = new Date().toISOString();

    await prisma.systemLog.create({
      data: {
        level: 'INFO',
        module: 'LEGAL_NORM_CRAWLER',
        correlationId: jobId,
        message: `Crawl job ${jobId} concluído: ${jobState.counters.normsSaved} normas salvas, ${jobState.counters.discarded} descartados.`,
        details: JSON.stringify({
          counters: jobState.counters,
          discards: jobState.discards.slice(0, 25),
        }),
      },
    }).catch(() => {});

    return jobState;
  }

  /**
   * Busca Vetorial nos Chunks (`POST /norms/search`) retornando texto, path, article, heading_context, source_url e norm_title
   */
  public static async searchNormChunksVector(params: {
    query: string;
    filters?: {
      norm_type?: string;
      year?: number | string;
      status?: string;
      tag?: string;
    };
    topK?: number;
  }): Promise<
    {
      chunk_id: string;
      norm_id: string;
      chunk_index: number;
      text: string;
      path: string[];
      article: string | null;
      heading_context: string;
      norm_title: string;
      norm_type: string;
      year: number | null;
      status: string;
      source_url: string;
      score: number;
    }[]
  > {
    const topK = Math.min(25, Math.max(1, params.topK || 8));
    const queryEmbedding = await SemanticEmbeddingService.embedQuery(params.query);

    const where: any = {};
    if (params.filters?.tag) {
      where.tags = { has: params.filters.tag.toUpperCase() };
    }
    // Regra 4.3 / AJUSTE 1: Busca vetorial SEMPRE filtra status no banco (por padrão exclui normas REVOGADAS)
    const requestedStatusFilter = params.filters?.status?.toLowerCase();
    if (requestedStatusFilter === 'revoked' || requestedStatusFilter === 'revogada') {
      where.norm = { status: 'REVOGADA' };
    } else {
      where.norm = { status: 'VIGENTE' };
    }

    const candidateChunks = await prisma.normChunk.findMany({
      where,
      take: 2001,
      include: {
        norm: {
          select: {
            id: true,
            normId: true,
            tipo: true,
            ano: true,
            status: true,
            ementaHigienizada: true,
            urlOriginal: true,
          },
        },
      },
    });
    if (candidateChunks.length > 2000) {
      throw new Error('O escopo da busca excedeu 2.000 chunks; restrinja as tags ou use o índice vetorial Atlas.');
    }

    const scored = candidateChunks
      .map((ch) => {
        let meta: any = {};
        try {
          if (ch.contextoSemantico && ch.contextoSemantico.startsWith('{')) {
            meta = JSON.parse(ch.contextoSemantico);
          }
        } catch {}
        if (meta.embedding_model !== SemanticEmbeddingService.embeddingModelId) {
          return null;
        }

        const normType = (meta.norm_type || ch.norm?.tipo || 'lei').toLowerCase();
        const year = meta.year || (ch.norm?.ano ? parseInt(ch.norm.ano, 10) : null);
        const rawNormStatus = String(ch.norm?.status || meta.status || 'active').toLowerCase();
        const status =
          rawNormStatus === 'revogada' || rawNormStatus === 'revoked'
            ? 'revoked'
            : rawNormStatus === 'vigente'
            ? 'active'
            : rawNormStatus;
        const sourceUrl = meta.source_url || ch.norm?.urlOriginal || '';
        const normTitle = meta.norm_title || ch.norm?.ementaHigienizada || ch.normCode;
        const path: string[] = Array.isArray(meta.path) ? meta.path : [];
        const article: string | null = meta.article || null;
        const headingContext: string = meta.heading_context || String(ch.contextoSemantico || normTitle);

        // Regra 4.3: Jamais retornar chunk de norma revogada a menos que explicitamente filtrado para auditoria histórica
        if (!requestedStatusFilter && (status === 'revoked' || status === 'revogada')) {
          return null;
        }
        if (params.filters?.norm_type && normType !== params.filters.norm_type.toLowerCase()) {
          return null;
        }
        if (params.filters?.year && String(year) !== String(params.filters.year)) {
          return null;
        }
        if (
          requestedStatusFilter &&
          status !== requestedStatusFilter &&
          String(ch.norm?.status || '').toLowerCase() !== requestedStatusFilter
        ) {
          return null;
        }

        // Similaridade de cosseno + boost lexical para termos exatos da query
        const emb = Array.isArray(ch.embedding) ? ch.embedding : [];
        const similarity = cosineSimilarity(queryEmbedding, emb);

        const queryTerms = params.query
          .toLowerCase()
          .split(/\s+/)
          .filter((t) => t.length > 2);
        const textLower = `${headingContext} ${ch.conteudoChunk}`.toLowerCase();
        const lexicalMatches = queryTerms.filter((t) => textLower.includes(t)).length;
        const lexicalBoost = queryTerms.length > 0 ? (lexicalMatches / queryTerms.length) * 0.45 : 0;

        const score = Number((Math.max(0, similarity) * 0.75 + lexicalBoost * 0.25).toFixed(4));

        return {
          chunk_id: ch.id,
          norm_id: ch.normId,
          chunk_index: ch.chunkIndex,
          text: TextEncodingSanitizer.sanitizeAndRepairText(ch.conteudoChunk),
          path,
          article,
          heading_context: TextEncodingSanitizer.sanitizeAndRepairText(headingContext),
          norm_title: TextEncodingSanitizer.sanitizeAndRepairText(normTitle),
          norm_type: normType,
          year,
          status,
          source_url: sourceUrl,
          score,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }
}
