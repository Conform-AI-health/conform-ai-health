import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/prisma.js', () => ({
  prisma: {
    aiModelConfig: { findFirst: vi.fn().mockResolvedValue(null) },
    scrapedPage: { findUnique: vi.fn(), upsert: vi.fn() },
    agentModule: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import { ScraperService } from '../services/scraperService.js';
import { validateSafeUrl, validateSafeUrlAsync, isPrivateIp } from '../shared/security.js';
import { AIProviderFactory } from '../services/ai/aiProviderFactory.js';
import { ScrapedPageController } from '../controllers/scrapedPageController.js';
import { authorize, Role } from '../middlewares/auth.js';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';

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

  it('deve classificar a tag REVOGADO caso o documento contenha termos de revogação normativa', () => {
    // 1. Resolução expressamente revogada
    const revogadoText =
      'RESOLUÇÃO CFM Nº 1.974/2011\nSituação: Revogada pela Resolução CFM nº 2.336/2023.';
    const tags = ScraperService.detectRegulatoryTags(revogadoText, revogadoText);
    expect(tags).toContain('REVOGADO');
    expect(tags).toContain('CFM');

    // 2. Termo revogada ou revogação
    const revogadaText =
      'RESOLUÇÃO CFM Nº 2.336/2023\nArt. 45. Fica expressamente revogada a resolução normativa anterior sobre telemedicina.';
    const tags2 = ScraperService.detectRegulatoryTags(revogadaText, revogadaText);
    expect(tags2).not.toContain('REVOGADO');

    // 3. Documento vigente não deve conter tag REVOGADO
    const vigenteText = 'Resolução CFM nº 2.336/2023. Dispõe sobre a publicidade médica em pleno vigor.';
    const tags3 = ScraperService.detectRegulatoryTags(vigenteText, vigenteText);
    expect(tags3).not.toContain('REVOGADO');
    expect(tags3).toContain('CFM');
  });

  describe('SEC-02: Hardening SSRF e Resolução DNS Rebinding', () => {
    it('deve classificar corretamente faixas de IPs privados, link-local e loopback com isPrivateIp', () => {
      // Loopback IPv4 e IPv6
      expect(isPrivateIp('127.0.0.1')).toBe(true);
      expect(isPrivateIp('127.10.20.30')).toBe(true);
      expect(isPrivateIp('0.0.0.0')).toBe(true);
      expect(isPrivateIp('::1')).toBe(true);

      // RFC 1918
      expect(isPrivateIp('10.0.0.1')).toBe(true);
      expect(isPrivateIp('10.255.255.254')).toBe(true);
      expect(isPrivateIp('172.16.0.1')).toBe(true);
      expect(isPrivateIp('172.31.255.255')).toBe(true);
      expect(isPrivateIp('192.168.1.1')).toBe(true);

      // Cloud Metadata e Link-Local
      expect(isPrivateIp('169.254.169.254')).toBe(true);
      expect(isPrivateIp('169.254.1.1')).toBe(true);
      expect(isPrivateIp('fe80::1')).toBe(true);

      // CGNAT RFC 6598
      expect(isPrivateIp('100.64.0.1')).toBe(true);
      expect(isPrivateIp('100.127.255.255')).toBe(true);

      // IPv4-mapped IPv6
      expect(isPrivateIp('::ffff:192.168.1.50')).toBe(true);
      expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true);

      // Endereços públicos legítimos
      expect(isPrivateIp('8.8.8.8')).toBe(false);
      expect(isPrivateIp('1.1.1.1')).toBe(false);
      expect(isPrivateIp('142.250.190.46')).toBe(false);
    });

    it('validateSafeUrlAsync deve bloquear tentativa de acesso a loopback via DNS ou IP', async () => {
      const loopbackResult = await validateSafeUrlAsync('http://127.0.0.1/admin');
      expect(loopbackResult.safe).toBe(false);
      expect(loopbackResult.reason).toBeDefined();

      const metadataResult = await validateSafeUrlAsync('http://169.254.169.254/latest/meta-data');
      expect(metadataResult.safe).toBe(false);
      expect(metadataResult.reason).toContain('proibido');
    });
  });

  describe('AI-02: Isolamento de Parâmetros no Fallback Gemini -> Ollama', () => {
    it('deve repassar modelId e baseUrl específicos do Ollama durante o fallback de IA', async () => {
      const mockScrape: any = {
        url: 'https://clinica.med.br',
        cleanMarkdown: 'Conteúdo médico de teste para validação de fallback.',
        rawHtmlLength: 500,
        tokensEstimatedClean: 100,
        detectedTags: ['CFM'],
        extractedEntities: { crms: [], rqes: [] },
      };

      const mockAgentContext: any = {
        agentName: 'Auditor CFM',
        regulatoryContext: 'Resolução CFM 2.336/2023',
        relevantNorms: [],
      };

      // Mock do Gemini falhando
      const geminiProvider = AIProviderFactory.getProvider('gemini');
      vi.spyOn(geminiProvider, 'reconcile').mockRejectedValue(new Error('Gemini API 503 Quota Exceeded'));

      // Espião do Ollama
      const ollamaProvider = AIProviderFactory.getProvider('ollama');
      const ollamaSpy = vi.spyOn(ollamaProvider, 'reconcile').mockResolvedValue({
        verdict: 'CONFORME',
        score: 95,
        summary: 'Avaliação realizada pelo Ollama local.',
        violations: [],
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        sourcesUsed: [],
        aiModelUsed: 'qwen2.5:7b',
      });

      // Força modelo ativo como Gemini
      vi.spyOn(AIProviderFactory, 'getActiveModelConfig').mockResolvedValue({
        name: 'Google Gemini 3.5 Flash',
        provider: 'gemini',
        modelId: 'gemini-3.5-flash',
        baseUrl: null,
        apiKey: 'fake-gemini-key',
        temperature: 0.2,
        maxTokens: 2048,
      });

      const output = await AIProviderFactory.reconcile(mockScrape, mockAgentContext);

      expect(output).toBeDefined();
      expect(ollamaSpy).toHaveBeenCalledTimes(1);

      // O terceiro argumento deve ser o config do Ollama, NUNCA o 'gemini-3.5-flash'
      const passedConfig = ollamaSpy.mock.calls[0][2];
      expect(passedConfig.provider).toBe('ollama');
      expect(passedConfig.modelId).not.toBe('gemini-3.5-flash');
      expect(passedConfig.modelId).toBe(env.OLLAMA_MODEL || 'qwen2.5:7b');
    });
  });

  describe('SEC-03: Higienização de Agentes Regulatórios Compatíveis', () => {
    it('getCompatibleAgents não deve expor systemPrompt nem segredos internos na resposta da API', async () => {
      // Mock da página
      vi.spyOn(prisma.scrapedPage, 'findUnique').mockResolvedValue({
        id: 'page-cfm-01',
        url: 'https://cfm.org.br/resolucoes/2336',
        tags: ['CFM'],
      } as any);

      // Mock dos agentes com dados confidenciais (systemPrompt e rulesJson)
      vi.spyOn(prisma.agentModule, 'findMany').mockResolvedValue([
        {
          id: 'agent-01',
          name: 'Agente Deontológico CFM',
          code: 'CFM_SPECIALIST',
          description: 'Audita normas do CFM',
          tags: ['CFM'],
          enabled: true,
          systemPrompt: 'PROMPT SECRETO DO SISTEMA: INSTRUÇÕES INTERNAS CONFIDENCIAIS',
          rulesJson: '{"internalKey": "superSecretRule"}',
        },
      ] as any);

      const req: any = {
        params: { id: 'page-cfm-01' },
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await ScrapedPageController.getCompatibleAgents(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      const data = res.json.mock.calls[0][0];

      expect(data.compatibleAgents).toBeDefined();
      expect(data.compatibleAgents.length).toBe(1);

      const agent = data.compatibleAgents[0];
      expect(agent.name).toBe('Agente Deontológico CFM');
      expect(agent.code).toBe('CFM_SPECIALIST');

      // Campos sensíveis NÃO devem existir no payload retornado
      expect((agent as any).systemPrompt).toBeUndefined();
      expect((agent as any).rulesJson).toBeUndefined();
    });

    it('authorize deve bloquear Role.CLIENT em rotas de auditor/admin e autorizar Role.ADMIN', () => {
      const authMiddleware = authorize(Role.ADMIN, Role.AUDITOR);

      // 1. Caso Role.CLIENT: bloqueio 403
      const clientReq: any = { user: { role: Role.CLIENT, userId: 'cli-01' } };
      const clientRes: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const clientNext = vi.fn();

      authMiddleware(clientReq, clientRes, clientNext);
      expect(clientRes.status).toHaveBeenCalledWith(403);
      expect(clientRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'FORBIDDEN' })
      );
      expect(clientNext).not.toHaveBeenCalled();

      // 2. Caso Role.ADMIN: sucesso com next()
      const adminReq: any = { user: { role: Role.ADMIN, userId: 'adm-01' } };
      const adminRes: any = { status: vi.fn(), json: vi.fn() };
      const adminNext = vi.fn();

      authMiddleware(adminReq, adminRes, adminNext);
      expect(adminNext).toHaveBeenCalledTimes(1);

      // 3. Caso Role.AUDITOR: sucesso com next()
      const auditorReq: any = { user: { role: Role.AUDITOR, userId: 'aud-01' } };
      const auditorRes: any = { status: vi.fn(), json: vi.fn() };
      const auditorNext = vi.fn();

      authMiddleware(auditorReq, auditorRes, auditorNext);
      expect(auditorNext).toHaveBeenCalledTimes(1);
    });
  });
});

