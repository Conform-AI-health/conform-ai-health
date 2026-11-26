import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import dns from 'dns';
import { LegalNormCrawlerService } from '../services/legalNormCrawlerService.js';
import { SemanticEmbeddingService } from '../services/semanticEmbeddingService.js';
import { FirecrawlClient } from '../services/firecrawl/firecrawlClient.js';
import { TextEncodingSanitizer } from '../shared/textEncodingSanitizer.js';
import { safeHttpGet } from '../shared/security.js';
import { LINK_TRACE_MODULE } from '../shared/linkTrace.js';

const { normsStore, chunksStore, scrapedPagesStore, systemLogs, redisStore } = vi.hoisted(() => ({
  normsStore: new Map<string, any>(),
  chunksStore: new Map<string, any[]>(),
  scrapedPagesStore: new Map<string, any>(),
  systemLogs: [] as any[],
  redisStore: new Map<string, string>(),
}));

vi.mock('../config/prisma.js', () => ({
  prisma: {
    norm: {
      findFirst: vi.fn(async ({ where }: any) => {
        for (const norm of normsStore.values()) {
          if (where?.urlOriginal && norm.urlOriginal === where.urlOriginal) return norm;
          if (where?.normId && norm.normId === where.normId) return norm;
          if (Array.isArray(where?.OR)) {
            for (const cond of where.OR) {
              if (cond?.urlOriginal && norm.urlOriginal === cond.urlOriginal) return norm;
              if (cond?.normId && norm.normId === cond.normId) return norm;
            }
          }
        }
        return null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const id = `norm-${normsStore.size + 1}`;
        const record = { id, ...data, createdAt: new Date(), updatedAt: new Date() };
        normsStore.set(id, record);
        return record;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const existing = normsStore.get(where.id);
        const updated = { ...existing, ...data, updatedAt: new Date() };
        normsStore.set(where.id, updated);
        return updated;
      }),
    },
    normChunk: {
      deleteMany: vi.fn(async ({ where }: any) => {
        if (where?.normId) {
          chunksStore.set(where.normId, []);
        }
        return { count: 1 };
      }),
      createMany: vi.fn(async ({ data }: any) => {
        if (Array.isArray(data) && data.length > 0) {
          const normId = data[0].normId;
          const existing = chunksStore.get(normId) || [];
          const withIds = data.map((item: any, i: number) => ({ id: `chunk-${normId}-${i + 1}`, ...item }));
          chunksStore.set(normId, [...existing, ...withIds]);
        }
        return { count: Array.isArray(data) ? data.length : 0 };
      }),
    },
    scrapedPage: {
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const existing = scrapedPagesStore.get(where.url);
        const record = existing
          ? { ...existing, ...update, updatedAt: new Date() }
          : { id: `page-${scrapedPagesStore.size + 1}`, ...create, createdAt: new Date() };
        scrapedPagesStore.set(where.url, record);
        return record;
      }),
    },
    systemLog: {
      create: vi.fn(async ({ data }: any) => {
        systemLogs.push(data);
        return data;
      }),
      createMany: vi.fn(async ({ data }: any) => {
        if (Array.isArray(data)) {
          systemLogs.push(...data);
        }
        return { count: Array.isArray(data) ? data.length : 0 };
      }),
    },
  },
}));

vi.mock('../config/redis.js', () => ({
  getRedisConnection: () => ({
    set: vi.fn(async (key: string, val: string) => {
      redisStore.set(key, val);
      return 'OK';
    }),
    get: vi.fn(async (key: string) => redisStore.get(key) ?? null),
  }),
}));

describe('Suporte a Páginas .htm e Resiliência contra ECONNRESET (Planalto / .gov.br)', () => {
  beforeEach(() => {
    normsStore.clear();
    chunksStore.clear();
    scrapedPagesStore.clear();
    systemLogs.length = 0;
    redisStore.clear();
    vi.clearAllMocks();
    vi.spyOn(SemanticEmbeddingService, 'embedDocuments').mockImplementation(
      async (texts: string[]) => texts.map(() => [0.25, 0.75])
    );
    vi.spyOn(FirecrawlClient, 'isConfigured').mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Classificação explícita de extensões .htm, .html e .xhtml', () => {
    it('classifica páginas .htm (inclusive com query de download/arquivo) e MIME text/html como "html"', () => {
      expect(
        LegalNormCrawlerService.classifyLinkFileType(
          'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm'
        )
      ).toBe('html');

      expect(
        LegalNormCrawlerService.classifyLinkFileType(
          'https://www.planalto.gov.br/download/l13709.htm?arquivo=1',
          'Baixar arquivo completo'
        )
      ).toBe('html');

      expect(
        LegalNormCrawlerService.classifyLinkFileType('https://portal.gov.br/norma.xhtml')
      ).toBe('html');

      expect(
        LegalNormCrawlerService.classifyLinkFileType(
          'https://portal.gov.br/arquivo?download=123',
          'Texto integral',
          'text/html; charset=windows-1252'
        )
      ).toBe('html');
    });
  });

  describe('2. Parsing Planalto .htm (Windows-1252 / Latin-1, título formal e remoção de <strike>)', () => {
    it('promove <title>L13709</title> para o título formal da norma, preserva acentos e isola dispositivos tachados', () => {
      const planaltoUrl = 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm';
      const latin1Html = `
        <html>
          <head><title>L13709</title></head>
          <body>
            <div class="cookie-banner">Aceitar cookies</div>
            <p align="center">LEI Nº 13.709, DE 14 DE AGOSTO DE 2018</p>
            <p>Lei Geral de Proteção de Dados Pessoais (LGPD).</p>
            <p><strike>Art. 2º-A Texto antigo tachado que foi inteiramente revogado pela Medida Provisória.</strike></p>
            <p>Art. 1º Esta Lei dispõe sobre o tratamento de dados pessoais, inclusive nos meios digitais.</p>
            <p>§ 1º As normas gerais contidas nesta Lei são de interesse nacional.</p>
          </body>
        </html>
      `;

      const rawBuffer = Buffer.from(latin1Html, 'latin1');
      const decoded = TextEncodingSanitizer.decodeBufferWithAutoEncoding(
        rawBuffer,
        'text/html; charset=windows-1252'
      );
      const extracted = LegalNormCrawlerService.extractCleanMarkdownFromHtml(planaltoUrl, decoded);

      expect(extracted.title).toContain('LEI Nº 13.709, DE 14 DE AGOSTO DE 2018');
      expect(extracted.activeContentMd).toContain('Proteção de Dados Pessoais');
      expect(extracted.activeContentMd).toContain('Art. 1º');
      expect(extracted.activeContentMd).toContain('§ 1º');
      expect(extracted.revokedStrikes.some((s) => s.includes('Texto antigo tachado'))).toBe(true);
      expect(extracted.activeContentMd).not.toContain('Texto antigo tachado');
    });
  });

  describe('3. Retry em safeHttpGet contra read ECONNRESET e proteção SSRF', () => {
    it('retenta automaticamente em read ECONNRESET usando agent TLS legado na tentativa seguinte e sem User-Agent de bot', async () => {
      const lgpdUrl = 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm';
      vi.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '189.9.152.1', family: 4 }] as any);

      const resetError = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
      const axiosSpy = vi
        .spyOn(axios, 'get')
        .mockRejectedValueOnce(resetError)
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'text/html; charset=iso-8859-1' },
          data: Buffer.from('<html><title>L13709</title><body><p>OK</p></body></html>', 'latin1'),
        } as any);

      const resp = await safeHttpGet(lgpdUrl, { responseType: 'arraybuffer', retries: 2 });

      expect(resp.status).toBe(200);
      expect(axiosSpy).toHaveBeenCalledTimes(2);

      const firstCallConfig = axiosSpy.mock.calls[0][1] as any;
      const secondCallConfig = axiosSpy.mock.calls[1][1] as any;

      expect(firstCallConfig.headers['User-Agent']).not.toContain('ConformIA');
      expect(firstCallConfig.headers['Accept-Language']).toContain('pt-BR');
      expect(secondCallConfig.httpsAgent).not.toBe(firstCallConfig.httpsAgent);
    });

    it('nunca retenta URLs bloqueadas por SSRF e realiza zero chamadas HTTP', async () => {
      const axiosSpy = vi.spyOn(axios, 'get');

      await expect(safeHttpGet('http://127.0.0.1/l13709.htm')).rejects.toThrow(/SSRF/i);
      await expect(safeHttpGet('http://169.254.169.254/latest/meta-data')).rejects.toThrow(/SSRF/i);
      expect(axiosSpy).not.toHaveBeenCalled();
    });
  });

  describe('4. Fallback Puppeteer no LegalNormCrawlerService em read ECONNRESET', () => {
    it('aciona fetchHtmlWithPuppeteerFallback para l13709.htm, descarta texto tachado e persiste a norma sem erros', async () => {
      const lgpdUrl = 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm';
      vi.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '189.9.152.1', family: 4 }] as any);

      const resetError = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
      vi.spyOn(axios, 'get').mockRejectedValue(resetError);

      const lgpdHtml = `
        <html>
          <head><title>L13709</title></head>
          <body>
            <p align="center">PRESIDÊNCIA DA REPÚBLICA</p>
            <p align="center">LEI Nº 13.709, DE 14 DE AGOSTO DE 2018</p>
            <p>Lei Geral de Proteção de Dados Pessoais (LGPD).</p>
            <p><strike>Art. 2º-A Regra antiga revogada em definitivo pelo legislador.</strike></p>
            <p>CAPÍTULO I - DISPOSIÇÕES PRELIMINARES</p>
            <p>Art. 1º Esta Lei dispõe sobre o tratamento de dados pessoais, inclusive nos meios digitais.</p>
            <p>Art. 5º Para os fins desta Lei, considera-se dado pessoal informação relacionada a pessoa natural identificada.</p>
            <p>Art. 65. Esta Lei entra em vigor após decorridos 24 meses de sua publicação oficial.</p>
          </body>
        </html>
      `;

      const puppeteerSpy = vi
        .spyOn(LegalNormCrawlerService, 'fetchHtmlWithPuppeteerFallback')
        .mockResolvedValueOnce(lgpdHtml);

      const jobState = await LegalNormCrawlerService.executeCrawlJob({
        url: lgpdUrl,
        maxDepth: 0,
        tags: ['LGPD'],
        preferFirecrawl: false,
      });

      expect(puppeteerSpy).toHaveBeenCalledTimes(1);
      expect(puppeteerSpy).toHaveBeenCalledWith(lgpdUrl);

      expect(jobState.status).toBe('completed');
      expect(jobState.counters.errors).toBe(0);
      expect(jobState.counters.normsSaved).toBe(1);

      const traceEntry = systemLogs.find(
        (log) => log.module === LINK_TRACE_MODULE && log.message.includes('[LINK_TRACE:SAVED]')
      );
      expect(traceEntry).toBeDefined();
      const traceDetails = JSON.parse(traceEntry.details);
      expect(traceDetails.engine).toBe('puppeteer');

      const savedNormId = jobState.savedNormIds[0];
      const savedChunks = chunksStore.get(savedNormId) || [];
      expect(savedChunks.length).toBeGreaterThanOrEqual(2);
      expect(savedChunks.some((c) => c.conteudoChunk.includes('Regra antiga revogada'))).toBe(false);
    });
  });

  describe('5. Blindagem anti-SSRF em fetchHtmlWithPuppeteerFallback', () => {
    it('rejeita destino loopback/privado imediatamente antes de abrir navegador', async () => {
      await expect(
        LegalNormCrawlerService.fetchHtmlWithPuppeteerFallback('http://127.0.0.1/secret.htm')
      ).rejects.toThrow(/SSRF/i);
    });
  });
});
