import { prisma } from '../config/prisma.js';

const SHARED_PLATFORM_HOSTS = new Set([
  'instagram.com',
  'facebook.com',
  'linkedin.com',
  'linktr.ee',
  'youtube.com',
  'youtu.be',
  'wa.me',
  'whatsapp.com',
  'tiktok.com',
  'twitter.com',
  'x.com',
  'google.com',
  'gov.br',
  'planalto.gov.br',
  'cfm.org.br',
]);

const GENERIC_MODULE_NAMES = new Set([
  'módulo geral',
  'modulo geral',
  'clínica auditada',
  'clinica auditada',
  'clínica médica',
  'clinica medica',
  'geral',
]);

const GENERIC_PAGE_TITLES = new Set([
  'home',
  'início',
  'inicio',
  'bem-vindo',
  'bem vindo',
  'seja bem-vindo',
  'sobre',
  'sobre nós',
  'sobre nos',
  'quem somos',
  'contato',
  'fale conosco',
  'login',
  'entrar',
  'página inicial',
  'pagina inicial',
  'just a moment...',
  'access denied',
  '403 forbidden',
  '404 not found',
]);

function isSharedHostingOrPlatformHost(host: string): boolean {
  if (SHARED_PLATFORM_HOSTS.has(host)) return true;
  return /\.(github\.io|vercel\.app|netlify\.app|pages\.dev|web\.app|firebaseapp\.com|onrender\.com)$/i.test(host);
}

function normalizeComparableName(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw
    .trim()
    .replace(/^Auditor\s+Digital\s*[-—–:]\s*/i, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
  if (!cleaned || GENERIC_MODULE_NAMES.has(cleaned)) return null;
  return cleaned;
}

export function normalizeUrlForComparison(rawUrl?: string | null): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(withProto);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const path = parsed.pathname.replace(/\/+$/, '').toLowerCase();
    return `${host}${path}`;
  } catch {
    return null;
  }
}

export function normalizeDomainHost(rawUrl?: string | null): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const host = new URL(withProto).hostname.toLowerCase().replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

export function extractInstagramHandle(rawValue?: string | null): string | null {
  if (!rawValue || typeof rawValue !== 'string') return null;
  const trimmed = rawValue.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('@')) {
    return trimmed.slice(1).split(/[/?#\s]/)[0]?.toLowerCase() || null;
  }

  if (/instagram\.com\//i.test(trimmed)) {
    try {
      const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
      const seg = new URL(withProto).pathname.split('/').filter(Boolean)[0];
      if (seg && !['p', 'reel', 'reels', 'stories', 'explore'].includes(seg.toLowerCase())) {
        return seg.replace(/^@/, '').toLowerCase();
      }
    } catch {
      return null;
    }
  }

  if (!trimmed.includes('/') && !trimmed.includes('.')) {
    return trimmed.toLowerCase();
  }

  return null;
}

export function matchClientByModuleName<T extends Record<string, any>>(
  clients: T[],
  moduleName?: string | null
): T | null {
  const targetName = normalizeComparableName(moduleName);
  if (!Array.isArray(clients) || clients.length === 0 || !targetName) return null;

  return (
    clients.find((c) => {
      const trade = normalizeComparableName(c?.tradeName);
      const legal = normalizeComparableName(c?.name);
      return trade === targetName || legal === targetName;
    }) || null
  );
}

export function matchClientFromList<T extends Record<string, any>>(
  clients: T[],
  targetUrl?: string | null,
  moduleName?: string | null
): T | null {
  if (!Array.isArray(clients) || clients.length === 0) return null;

  const targetNormalized = normalizeUrlForComparison(targetUrl);
  const targetHost = normalizeDomainHost(targetUrl);
  const targetInsta = extractInstagramHandle(targetUrl);

  // 1. Correspondência exata de URL normalizada (host + path)
  if (targetNormalized) {
    const exact = clients.find(
      (c) => c?.websiteUrl && normalizeUrlForComparison(c.websiteUrl) === targetNormalized
    );
    if (exact) return exact;
  }

  // 2. Correspondência por @handle do Instagram
  if (targetInsta) {
    const instaMatch = clients.find(
      (c) => c?.instagramHandle && extractInstagramHandle(c.instagramHandle) === targetInsta
    );
    if (instaMatch) return instaMatch;
  }

  // 3. Correspondência por domínio próprio da clínica (excluindo plataformas compartilhadas / *.github.io)
  if (targetHost && !isSharedHostingOrPlatformHost(targetHost)) {
    const domainMatch = clients.find(
      (c) => c?.websiteUrl && normalizeDomainHost(c.websiteUrl) === targetHost
    );
    if (domainMatch) return domainMatch;
  }

  // 4. Correspondência exata pelo nome do módulo/produto com tradeName ou name da clínica
  const byName = matchClientByModuleName(clients, moduleName);
  if (byName) return byName;

  return null;
}

function doesClientMatchUrlOrModule(
  client: Record<string, any>,
  targetUrl?: string | null,
  moduleName?: string | null
): boolean {
  if (!client) return false;
  return matchClientFromList([client], targetUrl, moduleName) !== null;
}

export async function resolveClientByIdOrUrl(params: {
  clientId?: string | null;
  targetUrl?: string | null;
  moduleName?: string | null;
  includeUsers?: boolean;
}): Promise<any | null> {
  const cleanId = params.clientId?.trim();
  const includeClause = params.includeUsers
    ? { users: { select: { email: true, name: true } } }
    : undefined;

  let byId: any | null = null;
  if (cleanId && prisma.client?.findUnique) {
    byId = await prisma.client
      .findUnique({
        where: { id: cleanId },
        ...(includeClause ? { include: includeClause } : {}),
      })
      .catch(() => null);
  }

  // Verifica se existe correspondência explícita por URL ou nome do módulo e reconcilia se clientId estiver defasado
  if ((params.targetUrl || params.moduleName) && prisma.client?.findMany) {
    const candidates = await prisma.client
      .findMany({
        ...(includeClause ? { include: includeClause } : {}),
        take: 500,
      })
      .catch(() => []);

    if (Array.isArray(candidates) && candidates.length > 0) {
      const strongMatch = matchClientFromList(candidates, params.targetUrl, params.moduleName);
      if (strongMatch) {
        if (!byId) {
          return strongMatch;
        }
        if (
          strongMatch.id !== byId.id &&
          !doesClientMatchUrlOrModule(byId, params.targetUrl, params.moduleName)
        ) {
          return strongMatch;
        }
      }
    }
  }

  return byId;
}

export function extractMarkdownHeadingTitle(markdown?: string | null): string | null {
  if (!markdown || typeof markdown !== 'string') return null;
  const lines = markdown.split(/\r?\n/);
  for (const rawLine of lines.slice(0, 25)) {
    const match = rawLine.trim().match(/^#{1,2}\s+(.+)$/);
    if (match && match[1]) {
      const cleaned = match[1]
        .replace(/[*_`[\]()]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (
        cleaned.length >= 3 &&
        cleaned.length <= 90 &&
        !/^https?:\/\//i.test(cleaned) &&
        !GENERIC_PAGE_TITLES.has(cleaned.toLowerCase()) &&
        !GENERIC_MODULE_NAMES.has(cleaned.toLowerCase())
      ) {
        return cleaned;
      }
    }
  }
  return null;
}

function sanitizeModuleLabel(moduleName?: string | null): string | null {
  if (!moduleName || typeof moduleName !== 'string') return null;
  const trimmed = moduleName
    .trim()
    .replace(/^Auditor\s+Digital\s*[-—–:]\s*/i, '')
    .trim();
  if (!trimmed || GENERIC_MODULE_NAMES.has(trimmed.toLowerCase())) {
    return null;
  }
  return trimmed;
}

export function formatResolvedClientName(params: {
  client?: { tradeName?: string | null; name?: string | null } | null;
  moduleName?: string | null;
  scrapedTitle?: string | null;
  targetUrl?: string | null;
  fallback?: string;
}): string {
  const tradeName = params.client?.tradeName?.trim();
  if (tradeName) return tradeName;

  const legalName = params.client?.name?.trim();
  if (legalName) return legalName;

  const fromScrapedTitle = params.scrapedTitle?.trim();
  if (fromScrapedTitle && !GENERIC_MODULE_NAMES.has(fromScrapedTitle.toLowerCase())) {
    return fromScrapedTitle;
  }

  const fromModule = sanitizeModuleLabel(params.moduleName);
  if (fromModule) return fromModule;

  const fromHost = normalizeDomainHost(params.targetUrl);
  if (fromHost) return fromHost;

  return params.fallback || 'Clínica Auditada';
}
