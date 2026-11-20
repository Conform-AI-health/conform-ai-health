import { describe, it, expect } from 'vitest';
import { METRIC_GLOSSARY } from '../utils/metricGlossary';

describe('METRIC_GLOSSARY', () => {
  it('deve conter as definições fundamentais de IA, Conformidade e Finanças', () => {
    expect(METRIC_GLOSSARY.contextSavings).toBeDefined();
    expect(METRIC_GLOSSARY.contextSavings.title).toContain('Economia de Contexto');
    expect(METRIC_GLOSSARY.contextSavings.description).toContain('tokens poupados');

    expect(METRIC_GLOSSARY.inferenceLatency).toBeDefined();
    expect(METRIC_GLOSSARY.inferenceLatency.title).toBe('Latência de Inferência');
    expect(METRIC_GLOSSARY.inferenceLatency.description).toContain('Tempo total de resposta');

    expect(METRIC_GLOSSARY.totalTokens).toBeDefined();
    expect(METRIC_GLOSSARY.reconciliationEngine).toBeDefined();
    expect(METRIC_GLOSSARY.evidenceMissingRate).toBeDefined();
    expect(METRIC_GLOSSARY.invalidCitationsRate).toBeDefined();
    expect(METRIC_GLOSSARY.humanAiDivergenceRate).toBeDefined();
    expect(METRIC_GLOSSARY.costPerAudit).toBeDefined();
    expect(METRIC_GLOSSARY.deontologicalScore).toBeDefined();
    expect(METRIC_GLOSSARY.trafficLightVerdict).toBeDefined();
    expect(METRIC_GLOSSARY.auditorReviewHITL).toBeDefined();
  });

  it('todas as métricas devem possuir título, descrição não vazia e categoria válida', () => {
    const validCategories = ['ai', 'compliance', 'system', 'financial'];
    Object.entries(METRIC_GLOSSARY).forEach(([key, metric]) => {
      expect(metric.title.trim().length).toBeGreaterThan(0);
      expect(metric.description.trim().length).toBeGreaterThan(15);
      expect(validCategories).toContain(metric.category);
    });
  });
});
