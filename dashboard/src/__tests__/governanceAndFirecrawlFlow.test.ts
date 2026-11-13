import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import axios from 'axios';

// Mock do Prisma usando vi.hoisted
const { mockModuleScrapeData, mockNorms, mockAgentModules } = vi.hoisted(() => ({
  mockModuleScrapeData: [] as any[],
  mockNorms: [
    {
      id: 'norm-1',
      normId: 'CFM-RES-2336-2023',
      orgao: 'CFM',
      status: 'VIGENTE',
      ementaHigienizada: '[CFM] Res. CFM 2.336/23 - Identificação Obrigatória do Médico',
      tags: [
        'CFM',
        'cfm',
        'identificação',
        'promoção',
        'desconto',
        'sorteio',
        'black friday',
        'garantido',
        '100%',
      ],
      chunks: [
        {
          id: 'chunk-1',
          normId: 'norm-1',
          normCode: 'CFM-RES-2336-2023',
          chunkIndex: 1,
          conteudoChunk: 'Identificação obrigatória do médico.',
          contextoSemantico: JSON.stringify({
            article: 'Art. 1º',
            heading_context: 'Identificação profissional',
            embedding_model: 'gemini-embedding-001:2',
          }),
          embedding: [1, 0],
          tags: ['CFM'],
        },
        {
          id: 'chunk-2',
          normId: 'norm-1',
          normCode: 'CFM-RES-2336-2023',
          chunkIndex: 2,
          conteudoChunk:
            'É vedada a publicidade de serviços médicos com fins de mercantilização, tais como descontos, black friday, sorteios e cupons promocionais.',
          contextoSemantico: JSON.stringify({
            article: 'Art. 9º',
            heading_context: 'Publicidade promocional',
            embedding_model: 'gemini-embedding-001:2',
          }),
          embedding: [1, 0],
          tags: ['CFM', 'PUBLICIDADE', 'desconto', 'promoção', 'sorteio'],
        },
      ],
    },
    {
      id: 'norm-2',
      normId: 'LGPD-LEI-13709-2018',
      orgao: 'LGPD',
      status: 'VIGENTE',
      ementaHigienizada: '[LGPD] LGPD Art. 11 - Dados Sensíveis em Saúde',
      tags: ['LGPD', 'lgpd', 'privacidade'],
      chunks: [{
        id: 'chunk-lgpd-1',
        normId: 'norm-2',
        normCode: 'LGPD-LEI-13709-2018',
        chunkIndex: 1,
        conteudoChunk: 'Tratamento de dados pessoais sensíveis.',
        contextoSemantico: JSON.stringify({
          article: 'Art. 11',
          heading_context: 'Dados pessoais sensíveis',
          embedding_model: 'gemini-embedding-001:2',
        }),
        embedding: [1, 0],
        tags: ['LGPD'],
      }],
    },
    {
      id: 'norm-revogada',
      normId: 'CFM-RES-1974-2011',
      orgao: 'CFM',
      status: 'REVOGADA',
      ementaHigienizada: '[CFM] Res. CFM 1.974/11 - Manual de Publicidade Médica (Revogado)',
      tags: ['CFM', 'REVOGADO'],
      chunks: [{ conteudoChunk: 'Norma revogada.', tags: ['CFM', 'REVOGADO'] }],
    },
  ],
  mockAgentModules: [
    {
      id: '654321000000000000000001',
      code: 'CFM-AUDITOR',
      name: 'Auditor Deontológico CFM',
      description: 'Auditor especializado em verificar conformidade com a Resolução CFM 2.336/2023',
      targetUrl: 'https://03fred.github.io/dermotologista/',
      tags: ['cfm', 'lgpd'],
      enabled: true,
      rulesCount: 8,
      extractionMode: 'FIRECRAWL',
    },
  ],
}));

vi.mock('../config/prisma.js', () => ({
  prisma: {
    moduleScrapeData: {
      create: vi.fn().mockImplementation(async ({ data }) => {
        const item = { id: `scrape-${Date.now()}`, ...data };
        mockModuleScrapeData.push(item);
        return item;
      }),
      findMany: vi.fn().mockResolvedValue(mockModuleScrapeData),
    },
    clientScrapedData: {
      create: vi.fn().mockResolvedValue({ id: 'csd-1' }),
    },
    scrapedPage: {
      findMany: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    norm: {
      findMany: vi.fn().mockImplementation(async ({ where }) => {
        const searchTags = where.tags.hasSome.map((t: string) => t.toLowerCase());
        return mockNorms.filter((norm) =>
          norm.status === 'VIGENTE' &&
          norm.tags.some((tag) => searchTags.includes(tag.toLowerCase()))
        );
      }),
    },
    normChunk: {
      findMany: vi.fn().mockImplementation(async ({ where }) =>
        mockNorms
          .filter((norm) => where.normId.in.includes(norm.id))
          .flatMap((norm) => norm.chunks)
      ),
    },
    agentModule: {
      findFirst: vi.fn().mockImplementation(async ({ where }) => {
        const queryId = where.OR?.[0]?.id || where.id;
        return mockAgentModules.find((m) => m.id === queryId) || mockAgentModules[0];
      }),
      findUnique: vi.fn().mockImplementation(async ({ where }) => {
        return mockAgentModules.find((m) => m.id === where.id || m.code === where.code) || null;
      }),
      create: vi.fn().mockImplementation(async ({ data }) => {
        const item = { id: `mod-${Date.now()}`, ...data };
        mockAgentModules.push(item);
        return item;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }) => {
        const item = mockAgentModules.find((m) => m.id === where.id) || mockAgentModules[0];
        Object.assign(item, data);
        return item;
      }),
    },
    agentDefinition: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    aiModelConfig: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    systemLog: {
      create: vi.fn().mockResolvedValue({ id: 'log-1' }),
    },
    auditReport: {
      create: vi.fn().mockResolvedValue({ id: 'rep-1' }),
      update: vi.fn().mockResolvedValue({ id: 'rep-1' }),
    },
    violation: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: vi.fn().mockImplementation(async (callback) => {
      if (typeof callback === 'function') {
        return callback(prisma);
      }
      return Promise.all(callback);
    }),
  },
}));

vi.mock('../services/semanticEmbeddingService.js', () => ({
  SemanticEmbeddingService: {
    modelName: 'gemini-embedding-001',
    vectorDimensions: 2,
    embeddingModelId: 'gemini-embedding-001:2',
    embedQuery: vi.fn(async () => [1, 0]),
    embedDocuments: vi.fn(async (texts: string[]) => texts.map(() => [1, 0])),
  },
  cosineSimilarity: (left: number[], right: number[]) =>
    left.reduce((sum, value, index) => sum + value * right[index], 0),
}));

import { FirecrawlService } from '../services/firecrawlService.js';
import { NormsResolver } from '../services/normsResolver.js';
import { ReconciliationEngine } from '../services/reconciliationEngine.js';
import { ScraperService } from '../services/scraperService.js';
import { prisma } from '../config/prisma.js';

describe('Governança de IA & Auditoria de Módulos (Firecrawl + Tags + SHA-256)', () => {
  const mockModuleId = '654321000000000000000001';
  const mockUrl = 'https://03fred.github.io/dermotologista/';

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.FIRECRAWL_API_KEY;
  });

  it('1. Deve gerar hash criptográfico SHA-256 consistente para o conteúdo extraído', () => {
    const rawContent = '# Clínica Dermatológica\n\nProcedimentos e tratamentos estéticos avançados.';
    const expectedHash = crypto.createHash('sha256').update(rawContent, 'utf8').digest('hex');

    expect(expectedHash).toHaveLength(64);
    expect(expectedHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('2. FirecrawlService com API ativa deve extrair Markdown limpo e calcular contentHash SHA-256', async () => {
    const mockMarkdown = '# Clínica DermaPerfeita | Estética e Dermatologia\n\nProcedimentos clínicos avançados.';
    process.env.FIRECRAWL_API_KEY = 'fc-test-key-valid';

    vi.spyOn(axios, 'post').mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          markdown: mockMarkdown,
        },
      },
    });

    const result = await FirecrawlService.scrape(mockUrl, mockModuleId);

    expect(result).toBeDefined();
    expect(result.url).toBe(mockUrl);
    expect(result.markdown).toBe(mockMarkdown);
    expect(result.contentHash).toHaveLength(64);
    expect(result.source).toBe('FIRECRAWL_API');

    const expectedHash = crypto.createHash('sha256').update(mockMarkdown, 'utf8').digest('hex');
    expect(result.contentHash).toBe(expectedHash);
  });

  it('3. FirecrawlService com fallback deve converter para Markdown nativo e gerar contentHash', async () => {
    delete process.env.FIRECRAWL_API_KEY;
    const fallbackMarkdown = '# Clínica Fallback\n\nConteúdo obtido via extração nativa.';

    vi.spyOn(axios, 'post').mockRejectedValueOnce(new Error('API quota exceeded'));

    vi.spyOn(ScraperService, 'scrape').mockResolvedValueOnce({
      url: mockUrl,
      title: 'Clínica Fallback',
      rawHtmlLength: 1000,
      cleanMarkdown: fallbackMarkdown,
      tokensEstimatedRaw: 300,
      tokensEstimatedClean: 150,
      extractedEntities: {
        extractionCompleted: true,
        crms: ['12345'],
        rqes: [],
        states: ['SP'],
        hasBeforeAfterMention: false,
        hasPromotionalPricing: false,
        hasGuaranteedResultMention: false,
      },
    });

    const result = await FirecrawlService.scrape(mockUrl, mockModuleId);

    expect(result).toBeDefined();
    expect(result.markdown).toBe(fallbackMarkdown);
    expect(result.contentHash).toHaveLength(64);
    expect(result.source).toBe('FIRECRAWL_FALLBACK_ENGINE');
  });

  it('4. NormsResolver deve resolver dinamicamente normas oficiais no banco de dados via Tags', async () => {
    const norms = await NormsResolver.resolveByTags(['cfm', 'lgpd']);

    expect(prisma.scrapedPage.findMany).not.toHaveBeenCalled();
    expect(prisma.norm.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'VIGENTE',
          tags: { hasSome: expect.arrayContaining(['CFM', 'LGPD']) },
        }),
        select: expect.objectContaining({
          chunks: expect.objectContaining({
            select: expect.objectContaining({ conteudoChunk: true }),
          }),
        }),
      })
    );
    expect(norms.length).toBeGreaterThan(0);
    for (const norm of norms) {
      expect(norm.title).toBeTruthy();
      expect(norm.content).toBeTruthy();
      expect(norm.tags).toBeDefined();
    }

    const hasCfm = norms.some((n) => n.source.toLowerCase().includes('cfm') || n.normCode.toLowerCase().includes('cfm'));
    expect(hasCfm).toBe(true);
  });

  it('4.1. NormsResolver deve desconsiderar estritamente normas que possuam a tag REVOGADO', async () => {
    const norms = await NormsResolver.resolveByTags(['cfm']);

    // Nenhuma norma retornada deve conter a tag REVOGADO
    const hasRevogado = norms.some((n) =>
      n.tags.some((t) => t.toUpperCase() === 'REVOGADO' || t.toUpperCase().includes('REVOGAD'))
    );
    expect(hasRevogado).toBe(false);

    // O título da norma revogada não deve estar presente
    const hasRevogadaTitle = norms.some((n) => n.title.includes('1.974/11'));
    expect(hasRevogadaTitle).toBe(false);

    // A norma vigente (CFM 2.336) deve estar presente
    const hasVigente = norms.some((n) => n.title.includes('2.336/23'));
    expect(hasVigente).toBe(true);
  });

  it('5. ReconciliationEngine deve integrar a Skill comportamental e normas dinâmicas na reconciliação', async () => {
    ReconciliationEngine.setActiveProvider('heuristic');
    const scrapeMock = {
      url: mockUrl,
      title: 'Clínica Dermatológica Teste',
      rawHtmlLength: 2500,
      cleanMarkdown: '# Clínica Dermatológica\n\nVenha fazer aplicação de botox com resultado 100% garantido e desconto de black friday!',
      tokensEstimatedRaw: 800,
      tokensEstimatedClean: 400,
      extractedEntities: {
        extractionCompleted: true,
        crms: ['12345'],
        rqes: [],
        states: ['SP'],
        hasBeforeAfterMention: true,
        hasPromotionalPricing: true,
        hasGuaranteedResultMention: true,
      },
    };

    const recon = await ReconciliationEngine.reconcile(scrapeMock as any, mockModuleId);

    expect(recon).toBeDefined();
    expect(['CONFORME', 'PARCIALMENTE_CONFORME', 'NAO_CONFORME']).toContain(recon.verdict);
    expect(recon.score).toBeGreaterThanOrEqual(0);
    expect(recon.score).toBeLessThanOrEqual(100);
    expect(recon.violations.length).toBeGreaterThan(0);
    expect(recon.summary).toBeTruthy();
  }, 15000);
});
