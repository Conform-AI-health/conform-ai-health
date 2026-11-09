import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// Mock isolado do Prisma para testes de unidade do RAG
const { mockScrapedPages } = vi.hoisted(() => ({
  mockScrapedPages: [
    {
      id: 'page-cfm-1',
      url: 'https://normas.conformia.med.br/cfm-2336-art-01',
      title: '[CFM] Res. CFM 2.336/23 - Identificação Obrigatória do Médico',
      cleanMarkdown: '# Res. CFM 2.336/23 - Identificação Obrigatória do Médico',
      tags: ['CFM', 'cfm', 'identificação'],
      source: 'CFM',
      normCode: 'Res. CFM 2.336/23',
      article: 'Artigo 1º, § 1º',
      severityDefault: 'CRITICA',
      content: 'Identificação médica obrigatória com CRM e UF.',
      createdAt: new Date(),
    },
    {
      id: 'page-lgpd-1',
      url: 'https://normas.conformia.med.br/lgpd-saude-art-11',
      title: '[LGPD] LGPD Art. 11 - Dados Sensíveis em Saúde',
      cleanMarkdown: '# LGPD Art. 11 - Dados Sensíveis em Saúde',
      tags: ['LGPD', 'lgpd', 'privacidade'],
      source: 'LGPD',
      normCode: 'LGPD Art. 11',
      article: 'Artigo 11 e Artigo 14',
      severityDefault: 'CRITICA',
      content: 'Tratamento de dados pessoais sensíveis de saúde exige consentimento.',
      createdAt: new Date(),
    },
    {
      id: 'page-revogada',
      url: 'https://normas.conformia.med.br/cfm-1974-revogada',
      title: '[CFM] Res. CFM 1.974/11 - Manual de Publicidade Médica (Revogado)',
      cleanMarkdown: '# Res. CFM 1.974/11 - Revogado expressamente pela Resolução 2.336/23',
      tags: ['CFM', 'REVOGADO'],
      source: 'CFM',
      normCode: 'Res. CFM 1.974/11',
      article: 'Geral',
      severityDefault: 'MEDIA',
      content: 'Revogado.',
      createdAt: new Date(),
    },
  ],
}));

vi.mock('../config/prisma.js', () => ({
  prisma: {
    scrapedPage: {
      findMany: vi.fn(async ({ where }) => {
        let results = [...mockScrapedPages];
        if (where?.tags?.hasSome) {
          const tagsLower = where.tags.hasSome.map((t: string) => t.toLowerCase());
          results = results.filter((page) =>
            page.tags.some((tag: string) => tagsLower.includes(tag.toLowerCase()))
          );
        }
        return results;
      }),
    },
    agentModule: {
      findFirst: vi.fn(async () => null),
    },
    agentDefinition: {
      findFirst: vi.fn(async () => null),
    },
    aiModelConfig: {
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => null),
    },
    systemLog: {
      create: vi.fn(async () => ({})),
    },
  },
}));

import { NormsResolver } from '../services/normsResolver.js';
import { NORMS_CATALOG } from '../data/normsCatalog.js';
import { AIGuardrails } from '../shared/aiGuardrails.js';
import { AIProviderFactory } from '../services/ai/aiProviderFactory.js';
import { ReconciliationEngine } from '../services/reconciliationEngine.js';
import { ScrapeResult } from '../services/scraperService.js';

describe('🔬 Avaliação & Qualidade do Sistema RAG em Saúde (RAG Quality & Evaluation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Retrieval Precision & Recall de Normas Deontológicas', () => {
    it('deve recuperar com alta precisão normas do CFM a partir de tags regulatórias', async () => {
      const resolvedNorms = await NormsResolver.resolveByTags(['CFM']);
      expect(resolvedNorms.length).toBeGreaterThan(0);

      // Toda norma recuperada deve pertencer ao marco do CFM
      for (const norm of resolvedNorms) {
        expect(norm.source.toUpperCase()).toBe('CFM');
      }

      // Deve incluir a Resolução CFM 2.336/2023
      const hasCFM2336 = resolvedNorms.some(
        (n) => n.normCode.includes('2.336') || n.title.includes('2.336')
      );
      expect(hasCFM2336).toBe(true);
    });

    it('deve recuperar com precisão cirúrgica normas da LGPD sem poluir com normas do CFM', async () => {
      const resolvedNorms = await NormsResolver.resolveByTags(['LGPD']);
      expect(resolvedNorms.length).toBeGreaterThan(0);

      for (const norm of resolvedNorms) {
        expect(norm.source.toUpperCase()).toBe('LGPD');
        const matchesLgpdConcept =
          norm.normCode.toUpperCase().includes('LGPD') ||
          norm.title.toUpperCase().includes('DADOS') ||
          norm.title.toUpperCase().includes('PRIVACIDADE');
        expect(matchesLgpdConcept).toBe(true);
      }
    });

    it('deve agregar múltiplas fontes (CFM + LGPD) quando o módulo auditar ambos os marcos regulatórios', async () => {
      const resolvedNorms = await NormsResolver.resolveByTags(['CFM', 'LGPD']);
      const sources = new Set(resolvedNorms.map((n) => n.source.toUpperCase()));

      expect(sources.has('CFM')).toBe(true);
      expect(sources.has('LGPD')).toBe(true);
    });
  });

  describe('2. Filtro Estrito de Revogações Normativas (Revocation Filtering)', () => {
    it('deve descartar incondicionalmente normas que possuam a tag REVOGADO ou título alusivo a revogação', async () => {
      const allNorms = await NormsResolver.resolveByTags(['CFM']);
      
      // Nenhuma norma no conjunto ativo deve ser revogada
      const revokedNorms = allNorms.filter((n) =>
        (n.tags || []).some((t) => t.trim().toUpperCase() === 'REVOGADO' || t.trim().toUpperCase().includes('REVOGAD')) ||
        n.title.toLowerCase().includes('(revogad')
      );

      expect(revokedNorms.length).toBe(0);
    });

    it('no ReconciliationEngine.resolveAgentContext, normas revogadas são expurgadas antes de chegar ao prompt da IA', async () => {
      const context = await ReconciliationEngine.resolveAgentContext();
      
      for (const norm of context.activeNorms) {
        const titleLower = norm.title.toLowerCase();
        const keywordsLower = norm.keywords.map((k) => k.toLowerCase());

        expect(titleLower).not.toContain('revogada');
        expect(titleLower).not.toContain('revogado');
        expect(keywordsLower).not.toContain('revogado');
      }
    });
  });

  describe('3. Ancoragem Fática e Análise de Grounding (Faithfulness Gate)', () => {
    const mockScrape: ScrapeResult = {
      url: 'https://draclara.med.br',
      title: 'Dra. Clara - Dermatologista',
      rawHtmlLength: 2000,
      cleanMarkdown: '# Dra. Clara\nCRM/SP 123456 | RQE 7890\nAtendimento humanizado em dermatologia clínica e estética.',
      tokensEstimatedRaw: 500,
      tokensEstimatedClean: 100,
      extractedEntities: {
        crms: ['123456'],
        rqes: ['7890'],
        states: ['SP'],
        hasBeforeAfterMention: false,
        hasPromotionalPricing: false,
        hasGuaranteedResultMention: false,
      },
    };

    it('deve expurgar alucinações fáticas (trechos inventados que não constam na página)', async () => {
      const fakeOutput = {
        verdict: 'NAO_CONFORME' as const,
        score: 30,
        summary: 'Identificada violação grave de preço promocional.',
        violations: [
          {
            normArticle: 'Artigo 9º',
            normCode: 'Res. CFM 2.336/23',
            severity: 'GRAVE' as const,
            detectedText: 'Texto alucinado: Promoção imperdível com 50% de desconto nesta sexta-feira!',
            correctiveAdvice: 'Remover anúncio de promoção.',
          },
        ],
        promptTokens: 200,
        completionTokens: 80,
        totalTokens: 280,
        sourcesUsed: ['Res. CFM 2.336/23'],
        aiModelUsed: 'gemini-3.5-flash',
        groundingScore: 100,
        hallucinationRisk: 'NONE' as const,
        guardrailsApplied: false,
        hallucinationsInterceptedCount: 0,
      };

      const result = await AIGuardrails.validateAndSanitizeOutput(
        fakeOutput,
        mockScrape,
        NORMS_CATALOG
      );

      // A violação alucinada deve ter sido removida
      expect(result.sanitizedOutput.violations.length).toBe(0);
      // AI-01: Quando todas as violações são alucinações, o veredito torna-se PARCIALMENTE_CONFORME (inconclusivo com revisão humana mandatória)
      expect(result.sanitizedOutput.verdict).toBe('PARCIALMENTE_CONFORME');
      expect(result.sanitizedOutput.score).toBeLessThanOrEqual(60);
      expect(result.sanitizedOutput.guardrailsApplied).toBe(true);
      expect(result.sanitizedOutput.hallucinationsInterceptedCount).toBe(1);
    });

    it('deve validar e aprovar violações fáticas legítimas cujas evidências constam na página', async () => {
      const promoEvidence = 'Botox com 30% de desconto';
      const pageWithViolation: ScrapeResult = {
        ...mockScrape,
        cleanMarkdown: `${mockScrape.cleanMarkdown}\nPromoção especial: ${promoEvidence} até sexta!`,
        extractedEntities: {
          ...mockScrape.extractedEntities,
          hasPromotionalPricing: true,
        },
      };

      const legitOutput = {
        verdict: 'PARCIALMENTE_CONFORME' as const,
        score: 80,
        summary: 'Detectada promoção vedada.',
        violations: [
          {
            normArticle: 'Artigo 9º, Incisos I a V',
            normCode: 'Res. CFM 2.336/23',
            severity: 'MEDIA' as const,
            detectedText: promoEvidence,
            correctiveAdvice: 'Remover menção a descontos.',
          },
        ],
        promptTokens: 200,
        completionTokens: 80,
        totalTokens: 280,
        sourcesUsed: ['Res. CFM 2.336/23'],
        aiModelUsed: 'gemini-3.5-flash',
        groundingScore: 100,
        hallucinationRisk: 'NONE' as const,
        guardrailsApplied: false,
        hallucinationsInterceptedCount: 0,
      };

      const result = await AIGuardrails.validateAndSanitizeOutput(
        legitOutput,
        pageWithViolation,
        NORMS_CATALOG
      );

      expect(result.sanitizedOutput.violations.length).toBe(1);
      expect(result.sanitizedOutput.violations[0].detectedText).toBe(promoEvidence);
      expect(result.sanitizedOutput.hallucinationsInterceptedCount).toBe(0);
    });
  });

  describe('4. Ancoragem Normativa (Normative Grounding)', () => {
    it('deve expurgar citações a leis ou resoluções fictícias inexistentes no catálogo de normas', async () => {
      const mockScrape: ScrapeResult = {
        url: 'https://clinica.com.br',
        title: 'Clinica Teste',
        rawHtmlLength: 500,
        cleanMarkdown: 'Texto médico genérico para auditoria.',
        tokensEstimatedRaw: 100,
        tokensEstimatedClean: 50,
        extractedEntities: {
          crms: ['12345'],
          rqes: [],
          states: ['RJ'],
          hasBeforeAfterMention: false,
          hasPromotionalPricing: false,
          hasGuaranteedResultMention: false,
        },
      };

      const outputWithInventedLaw = {
        verdict: 'NAO_CONFORME' as const,
        score: 40,
        summary: 'Infração de resolução inexistente.',
        violations: [
          {
            normArticle: 'Art. 999',
            normCode: 'Resolução CFM 9.999/2099', // Norma fictícia
            severity: 'GRAVE' as const,
            detectedText: 'Texto médico genérico',
            correctiveAdvice: 'Adequar norma.',
          },
        ],
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        sourcesUsed: [],
        aiModelUsed: 'gemini-3.5-flash',
        groundingScore: 100,
        hallucinationRisk: 'NONE' as const,
        guardrailsApplied: false,
        hallucinationsInterceptedCount: 0,
      };

      const result = await AIGuardrails.validateAndSanitizeOutput(
        outputWithInventedLaw,
        mockScrape,
        NORMS_CATALOG
      );

      expect(result.sanitizedOutput.violations.length).toBe(0);
      expect(result.sanitizedOutput.guardrailsApplied).toBe(true);
      expect(result.sanitizedOutput.hallucinationsInterceptedCount).toBe(1);
    });
  });

  describe('5. Rastreabilidade Criptográfica & Integridade (SHA-256 Content Hash)', () => {
    it('todo conteúdo do RAG deve gerar hash SHA-256 estável e reprodutível para conformidade legal', () => {
      const content = NORMS_CATALOG[0].content;
      const hash1 = crypto.createHash('sha256').update(content).digest('hex');
      const hash2 = crypto.createHash('sha256').update(content).digest('hex');

      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64);
    });
  });

  describe('6. Desacoplamento de Provedores na Execução RAG', () => {
    it('o AIProviderFactory deve listar provedores ativos e permitir execução direta da heurística de contingência', async () => {
      const providers = AIProviderFactory.listProviders();
      expect(providers.length).toBe(3);
      expect(providers.some((p) => p.id === 'gemini')).toBe(true);
      expect(providers.some((p) => p.id === 'ollama')).toBe(true);
      expect(providers.some((p) => p.id === 'heuristic')).toBe(true);

      const heuristic = AIProviderFactory.getProvider('heuristic');
      expect(heuristic.providerId).toBe('heuristic');

      const testResult = await heuristic.testConnection('Teste RAG');
      expect(testResult.status).toBe('ONLINE');
      expect(testResult.provider).toBe('heuristic');
    });
  });
});
