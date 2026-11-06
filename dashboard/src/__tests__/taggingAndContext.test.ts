import { describe, it, expect } from 'vitest';
import { ScraperService } from '../services/scraperService.js';
import { validateSafeUrl } from '../shared/security.js';

describe('Auto-Tagging Regulatória & Proteção de Segurança', () => {
  it('deve classificar corretamente tags CFM, LGPD, ANVISA e ANS baseadas no conteúdo', () => {
    // 1. Caso CFM
    const cfmHtml = '<h1>Dr. Ricardo — Médico Dermatologista</h1><p>CRM/SP 123456 RQE 98765. Avaliação clínica.</p>';
    const cfmTags = ScraperService.detectRegulatoryTags(cfmHtml, cfmHtml);
    expect(cfmTags).toContain('CFM');

    // 2. Caso LGPD
    const lgpdHtml = '<form><input name="nome"><p>Agendar consulta online. Leia nossa Política de Privacidade e Consentimento LGPD.</p></form>';
    const lgpdTags = ScraperService.detectRegulatoryTags(lgpdHtml, lgpdHtml);
    expect(lgpdTags).toContain('LGPD');

    // 3. Caso ANVISA
    const anvisaHtml = '<p>Aplicação de toxina botulínica e prescrição de medicamentos sob vigilância sanitária.</p>';
    const anvisaTags = ScraperService.detectRegulatoryTags(anvisaHtml, anvisaHtml);
    expect(anvisaTags).toContain('ANVISA');

    // 4. Caso ANS
    const ansHtml = '<p>Atendimento através de convênio e plano de saúde com carência reduzida na rede credenciada.</p>';
    const ansTags = ScraperService.detectRegulatoryTags(ansHtml, ansHtml);
    expect(ansTags).toContain('ANS');

    // 5. Caso Multidisciplinar
    const multiHtml = `
      <h1>Clínica Médica Integrada</h1>
      <p>Médicos com CRM ativo.</p>
      <p>Formulário de agendamento online com termo de privacidade LGPD.</p>
      <p>Tratamentos com prescrição de medicamentos regulados pela ANVISA.</p>
      <p>Aceitamos plano de saúde e convênios cadastrados na ANS.</p>
    `;
    const multiTags = ScraperService.detectRegulatoryTags(multiHtml, multiHtml);
    expect(multiTags).toEqual(expect.arrayContaining(['CFM', 'LGPD', 'ANVISA', 'ANS']));
  });

  it('deve bloquear URLs maliciosas contra ataques SSRF', () => {
    // Localhost / Loopback
    expect(validateSafeUrl('http://localhost:3000').safe).toBe(false);
    expect(validateSafeUrl('http://127.0.0.1:8080').safe).toBe(false);
    expect(validateSafeUrl('http://0.0.0.0').safe).toBe(false);

    // AWS Cloud Metadata
    expect(validateSafeUrl('http://169.254.169.254/latest/meta-data').safe).toBe(false);

    // Redes privadas RFC 1918
    expect(validateSafeUrl('http://10.0.0.1/admin').safe).toBe(false);
    expect(validateSafeUrl('http://192.168.1.1').safe).toBe(false);

    // URL pública legítima
    expect(validateSafeUrl('https://clinica-saude-digital.med.br').safe).toBe(true);
    expect(validateSafeUrl('https://telemedicina.cfm.org.br').safe).toBe(true);
  });

  it('deve validar corretamente o contexto do agente contra as tags da página', () => {
    const pageTags = ['CFM', 'LGPD'];

    // Agente CFM: compatível
    const agentCfmTags = ['CFM'];
    const isCfmCompatible = agentCfmTags.some((t) => pageTags.includes(t));
    expect(isCfmCompatible).toBe(true);

    // Agente LGPD: compatível
    const agentLgpdTags = ['LGPD'];
    const isLgpdCompatible = agentLgpdTags.some((t) => pageTags.includes(t));
    expect(isLgpdCompatible).toBe(true);

    // Agente ANVISA: incompatível (não deve gastar tokens)
    const agentAnvisaTags = ['ANVISA'];
    const isAnvisaCompatible = agentAnvisaTags.some((t) => pageTags.includes(t));
    expect(isAnvisaCompatible).toBe(false);
  });
});

