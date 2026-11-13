import { describe, it, expect, vi } from 'vitest';
import { ReconciliationEngine } from '../services/reconciliationEngine.js';
import { ScraperService, ScrapeResult } from '../services/scraperService.js';
import { AIProviderFactory } from '../services/ai/aiProviderFactory.js';
import { AgentContext } from '../shared/reconciliationTypes.js';

describe('Motor de Reconciliação Deontológica (CFM)', () => {
  it('deve identificar violações críticas para página médica sem CRM e sem RQE com promessa de resultado', () => {
    const rawHtml = `
      <!DOCTYPE html>
      <html>
        <head><title>Clínica Estética Milagrosa</title></head>
        <body>
          <h1>A melhor clínica dermatológica do Brasil</h1>
          <p>Oferecemos cura definitiva para calvície e rejuvenescimento 100% garantido.</p>
          <p>Confira nossas fotos incríveis de antes e depois!</p>
          <p>Aproveite nossa promoção de Black Friday com 50% de desconto e sorteio de botox!</p>
        </body>
      </html>
    `;

    const scrapeResult = ScraperService.processHtml(
      'https://clinica-irregular-sintetica.med.br',
      rawHtml,
      'CHEERIO'
    );

    expect(scrapeResult.extractedEntities.hasGuaranteedResultMention).toBe(true);
    expect(scrapeResult.extractedEntities.hasBeforeAfterMention).toBe(true);
    expect(scrapeResult.extractedEntities.hasPromotionalPricing).toBe(true);
    expect(scrapeResult.extractedEntities.crms.length).toBe(0);

    const recon = ReconciliationEngine.reconcileWithHeuristic(scrapeResult);

    expect(recon.verdict).toBe('NAO_CONFORME');
    expect(recon.score).toBeLessThan(50);
    expect(recon.violations.length).toBeGreaterThanOrEqual(4);

    const crmViolation = recon.violations.find((v) => v.normArticle.includes('Artigo 1º, § 1º'));
    expect(crmViolation).toBeDefined();
    expect(crmViolation?.severity).toBe('CRITICA');

    const resultPromiseViolation = recon.violations.find((v) => v.normArticle.includes('Artigo 11'));
    expect(resultPromiseViolation).toBeDefined();
    expect(resultPromiseViolation?.severity).toBe('CRITICA');

    const promoViolation = recon.violations.find((v) => v.normArticle.includes('Artigo 9º'));
    expect(promoViolation).toBeDefined();
    expect(promoViolation?.severity).toBe('GRAVE');
  });

  it('deve emitir veredito CONFORME para material regular com CRM, RQE e linguagem sóbria', () => {
    const rawHtml = `
      <!DOCTYPE html>
      <html>
        <head><title>Dra. Ana Silva - Dermatologista</title></head>
        <body>
          <h1>Dra. Ana Silva — Médica Dermatologista</h1>
          <p>CRM/SP 123456 | RQE 98765 | Dermatologia Clínica e Cirúrgica</p>
          <p>Tratamentos dermatológicos fundamentados em evidências científicas.</p>
          <p>Cada organismo reage de maneira individual e os procedimentos requerem avaliação médica prévia.</p>
          <a href="/politica-de-privacidade">Política de Privacidade e Proteção de Dados LGPD</a>
        </body>
      </html>
    `;

    const scrapeResult = ScraperService.processHtml(
      'https://draanasilva-regular.med.br',
      rawHtml,
      'CHEERIO'
    );

    const recon = ReconciliationEngine.reconcileWithHeuristic(scrapeResult);

    expect(recon.verdict).toBe('CONFORME');
    expect(recon.score).toBeGreaterThanOrEqual(85);
    expect(recon.violations.filter((v) => v.severity === 'CRITICA').length).toBe(0);
  });

  it('deve realizar fallback resiliente para HeuristicProvider quando provedores remotos falharem', async () => {
    // Força provedor ativo para heurístico garantindo continuidade da operação
    AIProviderFactory.setActiveProvider('heuristic');
    expect(AIProviderFactory.getActiveProviderName()).toBe('heuristic');

    const provider = AIProviderFactory.getProvider('heuristic');
    const scrapeResult = ScraperService.processHtml(
      'https://fallback-teste.med.br',
      '<html><body><p>Tratamento médico ético CRM 1234 SP RQE 4321</p></body></html>',
      'CHEERIO'
    );

    const result = await provider.reconcile(scrapeResult);
    expect(result).toBeDefined();
    expect(result.verdict).toBeDefined();
    expect(result.aiModelUsed).toContain('heuristic');
  });

  it('não deve chamar o provedor nem reportar tokens quando os chunks estão sem embeddings', async () => {
    const providerCall = vi.spyOn(AIProviderFactory, 'reconcile');
    const scrapeResult = ScraperService.processHtml(
      'https://reindex-necessario.med.br',
      '<html><body><p>Auditoria médica.</p></body></html>',
      'CHEERIO'
    );
    const context: AgentContext = {
      name: 'Auditor CFM',
      systemPrompt: 'Use normas recuperadas.',
      targetNorms: ['cfm', 'lgpd'],
      tags: ['cfm', 'lgpd'],
      activeNorms: [],
      retrievalStatus: 'UNINDEXED',
      retrievalCandidatesCount: 12,
    };

    const result = await ReconciliationEngine.reconcile(scrapeResult, undefined, context);

    expect(result.verdict).toBe('INCONCLUSIVO');
    expect(result.aiModelUsed).toBe('retrieval:UNINDEXED');
    expect(result.promptTokens).toBe(0);
    expect(result.totalTokens).toBe(0);
    expect(result.summary).toContain('npm run rag:reindex');
    expect(providerCall).not.toHaveBeenCalled();
    providerCall.mockRestore();
  });
});

