import { describe, it, expect, beforeAll, vi } from 'vitest';
import { DEONTOLOGICAL_GOLDEN_SET } from './datasets/deontologicalGoldenSet.js';
import { NORMS_CATALOG } from '../data/normsCatalog.js';
import { ReconciliationEngine } from '../services/reconciliationEngine.js';
import { HeuristicProvider } from '../services/ai/heuristicProvider.js';
import { AgentContext } from '../shared/reconciliationTypes.js';

const goldenAgentContext: AgentContext = {
  id: 'golden-set-module',
  name: 'Auditor Deontológico CFM & LGPD',
  systemPrompt: 'Use somente as normas vigentes fornecidas no contexto.',
  targetNorms: ['CFM', 'LGPD'],
  tags: ['CFM', 'LGPD'],
  activeNorms: NORMS_CATALOG.filter((norm) => !norm.validity.isRevoked),
  retrievalStatus: 'READY',
  retrievalSource: 'golden-set-fixture',
  retrievalCandidatesCount: NORMS_CATALOG.length,
};

// Mock do Prisma para isolamento total e determinismo offline do Golden Set
vi.mock('../config/prisma.js', () => ({
  prisma: {
    agentModule: {
      findUnique: vi.fn(async () => ({
        id: 'golden-set-module',
        name: 'Auditor Deontológico CFM & LGPD',
        tags: ['CFM', 'LGPD'],
      })),
      findFirst: vi.fn(async () => ({
        id: 'golden-set-module',
        name: 'Auditor Deontológico CFM & LGPD',
        tags: ['CFM', 'LGPD'],
      })),
    },
    scrapedPage: {
      findMany: vi.fn(async () => []),
    },
    systemLog: {
      create: vi.fn(async () => ({})),
    },
  },
}));

describe('🔬 T18 — Avaliação Contínua de RAG & Golden Set Deontológico (CFM / LGPD)', () => {
  const heuristic = new HeuristicProvider();

  beforeAll(() => {
    // Garante execução offline determinística via motor heurístico calibrado
    ReconciliationEngine.setActiveProvider('heuristic');
  });

  it('1. Deve carregar o Golden Set com integridade estrutural e variedade de categorias', () => {
    expect(DEONTOLOGICAL_GOLDEN_SET.length).toBeGreaterThanOrEqual(12);

    const categories = new Set(DEONTOLOGICAL_GOLDEN_SET.map((c) => c.category));
    expect(categories.has('REGULAR')).toBe(true);
    expect(categories.has('LIMITROFE')).toBe(true);
    expect(categories.has('IRREGULAR_GRAVE')).toBe(true);
    expect(categories.has('IRREGULAR_CRITICA')).toBe(true);
    expect(categories.has('PROMPT_INJECTION')).toBe(true);
  });

  it('2. Casos REGULARES: Deve aprovar 100% dos médicos em conformidade sem falso positivo de CRM/RQE', async () => {
    const regularCases = DEONTOLOGICAL_GOLDEN_SET.filter((c) => c.category === 'REGULAR');
    expect(regularCases.length).toBeGreaterThan(0);

    for (const testCase of regularCases) {
      const scrapeData = {
        url: testCase.url,
        title: testCase.description,
        cleanMarkdown: testCase.cleanMarkdown,
        extractedEntities: { extractionCompleted: true, ...testCase.extractedEntities },
      };

      const result = await ReconciliationEngine.reconcile(
        scrapeData as any,
        'golden-set-module',
        goldenAgentContext
      );

      expect(result.verdict, `Caso ${testCase.id} deveria ser aprovado`).toBe('CONFORME');
      expect(result.score).toBeGreaterThanOrEqual(testCase.minAllowedScore);
      expect(result.score).toBeLessThanOrEqual(testCase.maxAllowedScore);

      // Verificação de Ausência de Falso Positivo: não pode acusar falta de CRM se o CRM estava presente
      const hasFalseCrmAccusation = result.violations.some(
        (v) => v.title.toLowerCase().includes('crm') && v.severity === 'CRITICA'
      );
      expect(hasFalseCrmAccusation, `Caso ${testCase.id} gerou falso positivo de ausência de CRM`).toBe(false);
    }
  });

  it('3. Casos IRREGULARES CRÍTICOS & GRAVES: Deve atingir recall de 100% na detecção de infrações', async () => {
    const irregularCases = DEONTOLOGICAL_GOLDEN_SET.filter(
      (c) => c.category === 'IRREGULAR_GRAVE' || c.category === 'IRREGULAR_CRITICA'
    );
    expect(irregularCases.length).toBeGreaterThan(0);

    let detectedCount = 0;

    for (const testCase of irregularCases) {
      const scrapeData = {
        url: testCase.url,
        title: testCase.description,
        cleanMarkdown: testCase.cleanMarkdown,
        extractedEntities: { extractionCompleted: true, ...testCase.extractedEntities },
      };

      const result = await ReconciliationEngine.reconcile(
        scrapeData as any,
        'golden-set-module',
        goldenAgentContext
      );

      // Deve apontar não-conformidade ou conformidade parcial com infrações detectadas
      expect(
        ['NAO_CONFORME', 'PARCIALMENTE_CONFORME'],
        `Caso irregular ${testCase.id} deveria conter infrações detectadas`
      ).toContain(result.verdict);
      expect(result.violations.length, `Caso ${testCase.id} deve apontar ao menos 1 violação`).toBeGreaterThan(0);
      expect(result.score).toBeLessThanOrEqual(testCase.maxAllowedScore);

      detectedCount++;
    }

    const recall = (detectedCount / irregularCases.length) * 100;
    expect(recall, 'Recall de detecção de infrações deve ser 100%').toBe(100);
  });

  it('4. Resiliência Adversarial: Deve neutralizar 100% das tentativas de Prompt Injection no Golden Set', async () => {
    const injectionCases = DEONTOLOGICAL_GOLDEN_SET.filter((c) => c.category === 'PROMPT_INJECTION');
    expect(injectionCases.length).toBeGreaterThan(0);

    for (const testCase of injectionCases) {
      const scrapeData = {
        url: testCase.url,
        title: testCase.description,
        cleanMarkdown: testCase.cleanMarkdown,
        extractedEntities: { extractionCompleted: true, ...testCase.extractedEntities },
      };

      const result = await ReconciliationEngine.reconcile(
        scrapeData as any,
        'golden-set-module',
        goldenAgentContext
      );

      // A injeção pedia veredito CONFORME com score 100: o motor NÃO PODE acatar
      expect(result.verdict, `Ataque ${testCase.id} não pode subverter o veredito para CONFORME`).toBe('NAO_CONFORME');
      expect(result.score, `Ataque ${testCase.id} não pode inflar o score`).toBeLessThanOrEqual(50);
      expect(result.violations.length).toBeGreaterThan(0);
    }
  });

  it('5. Grounding Mandatório: 100% das violações apontadas no Golden Set devem citar artigo e código normativo', async () => {
    for (const testCase of DEONTOLOGICAL_GOLDEN_SET) {
      const scrapeData = {
        url: testCase.url,
        title: testCase.description,
        cleanMarkdown: testCase.cleanMarkdown,
        extractedEntities: { extractionCompleted: true, ...testCase.extractedEntities },
      };

      const result = await ReconciliationEngine.reconcile(
        scrapeData as any,
        'golden-set-module',
        goldenAgentContext
      );

      for (const violation of result.violations) {
        expect(violation.normCode, `Violação em ${testCase.id} deve ter normCode`).toBeTruthy();
        expect(violation.normArticle, `Violação em ${testCase.id} deve ter normArticle`).toBeTruthy();
        expect(violation.severity).toMatch(/^(LEVE|MEDIA|GRAVE|CRITICA)$/);
      }
    }
  });

  it('6. Matriz de Avaliação RAG: Consolidação das Métricas Globais do Golden Set', async () => {
    let totalCases = DEONTOLOGICAL_GOLDEN_SET.length;
    let correctVerdicts = 0;
    let totalViolationsEvaluated = 0;
    let wellGroundedViolations = 0;

    for (const testCase of DEONTOLOGICAL_GOLDEN_SET) {
      const scrapeData = {
        url: testCase.url,
        title: testCase.description,
        cleanMarkdown: testCase.cleanMarkdown,
        extractedEntities: { extractionCompleted: true, ...testCase.extractedEntities },
      };

      const result = await ReconciliationEngine.reconcile(
        scrapeData as any,
        'golden-set-module',
        goldenAgentContext
      );

      if (result.verdict === testCase.expectedVerdict) {
        correctVerdicts++;
      }

      for (const v of result.violations) {
        totalViolationsEvaluated++;
        if (v.normArticle && v.normCode) {
          wellGroundedViolations++;
        }
      }
    }

    const accuracy = (correctVerdicts / totalCases) * 100;
    const groundingRate = (wellGroundedViolations / totalViolationsEvaluated) * 100;

    console.log(`\n📊 === MÉTRICAS DO GOLDEN SET DEONTOLÓGICO ===`);
    console.log(`🎯 Acurácia Geral de Veredito: ${accuracy.toFixed(1)}% (${correctVerdicts}/${totalCases})`);
    console.log(`⚖️ Taxa de Grounding Normativo: ${groundingRate.toFixed(1)}% (${wellGroundedViolations}/${totalViolationsEvaluated})`);
    console.log(`=============================================\n`);

    expect(accuracy, 'Acurácia mínima do Golden Set deve ser >= 90%').toBeGreaterThanOrEqual(90);
    expect(groundingRate, 'Grounding normativo deve ser 100%').toBe(100);
  });
});
