import { describe, it, expect } from 'vitest';
import { ReconciliationEngine } from '../services/reconciliationEngine.js';
import { ScraperService, ScrapeResult } from '../services/scraperService.js';

describe('Motor de Reconciliação Deontológica (CFM 2.336/2023)', () => {
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
});

