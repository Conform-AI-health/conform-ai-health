import dns from 'dns';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../shared/tracing.js', () => ({
  runWithContext: (_ctx: any, fn: () => any) => fn(),
  withSpan: (_name: string, _attrs: any, fn: (span: any) => any) =>
    fn({ setAttribute: vi.fn() }),
  getActiveTraceIds: () => ({ traceId: 'trace-cache-1', spanId: 'span-cache-1' }),
  injectTraceCarrier: () => ({}),
}));

import {
  extractAwsEc2PublicIpFromHostname,
  isTrustedSplitHorizonResolution,
  validateSafeUrlAsync,
} from '../shared/security.js';
import { AIInvocationCacheService } from '../services/ai/aiInvocationCache.js';
import { AIProviderFactory } from '../services/ai/aiProviderFactory.js';
import { ReconciliationEngine } from '../services/reconciliationEngine.js';
import { ScraperService } from '../services/scraperService.js';
import { AgentContext } from '../shared/reconciliationTypes.js';

describe('🛡️ SSRF Split-Horizon AWS EC2 & ⚡ Cache Inteligente de [AI_INVOCATION]', () => {
  const originalAllowedHosts = process.env.SSRF_ALLOWED_HOSTS;

  beforeEach(() => {
    vi.restoreAllMocks();
    AIInvocationCacheService.clearMemoryCache();
    delete process.env.SSRF_ALLOWED_HOSTS;
  });

  afterEach(() => {
    if (originalAllowedHosts !== undefined) {
      process.env.SSRF_ALLOWED_HOSTS = originalAllowedHosts;
    } else {
      delete process.env.SSRF_ALLOWED_HOSTS;
    }
  });

  describe('1. Resolução DNS Split-Horizon AWS EC2 e SSRF_ALLOWED_HOSTS sem abrir brecha de Metadata/Loopback', () => {
    it('deve extrair IP público válido de hostname oficial EC2 e rejeitar IPs privados codificados', () => {
      expect(
        extractAwsEc2PublicIpFromHostname('ec2-3-150-139-15.us-east-2.compute.amazonaws.com')
      ).toBe('3.150.139.15');
      expect(
        extractAwsEc2PublicIpFromHostname('ec2-54-233-10-20.sa-east-1.compute.amazonaws.com')
      ).toBe('54.233.10.20');
      expect(
        extractAwsEc2PublicIpFromHostname('ec2-127-0-0-1.us-east-2.compute.amazonaws.com')
      ).toBeNull();
      expect(
        extractAwsEc2PublicIpFromHostname('ec2-10-0-0-5.us-east-2.compute.amazonaws.com')
      ).toBeNull();
      expect(
        extractAwsEc2PublicIpFromHostname('ec2-169-254-169-254.us-east-2.compute.amazonaws.com')
      ).toBeNull();
    });

    it('deve permitir URL pública EC2 quando o DNS da VPC resolver para IP interno RFC 1918 (172.31.x.x)', async () => {
      vi.spyOn(dns.promises, 'lookup').mockResolvedValueOnce([
        { address: '172.31.40.61', family: 4 },
      ] as any);

      const check = await validateSafeUrlAsync(
        'http://ec2-3-150-139-15.us-east-2.compute.amazonaws.com:5000/login'
      );

      expect(check.safe).toBe(true);
      expect(check.resolvedIps).toContain('172.31.40.61');
    });

    it('deve continuar bloqueando DNS Rebinding de domínios arbitrários para 172.31.x.x e bloquear metadata/loopback sempre', async () => {
      vi.spyOn(dns.promises, 'lookup').mockResolvedValueOnce([
        { address: '172.31.40.61', family: 4 },
      ] as any);

      const attackerCheck = await validateSafeUrlAsync('https://attacker-rebinding.example.com/login');
      expect(attackerCheck.safe).toBe(false);
      expect(attackerCheck.reason).toContain('DNS Rebinding');

      // Mesmo em hostname EC2 ou SSRF_ALLOWED_HOSTS, loopback e AWS Metadata (169.254.169.254) continuam bloqueados
      process.env.SSRF_ALLOWED_HOSTS = 'portal.clinica.internal';
      expect(isTrustedSplitHorizonResolution('portal.clinica.internal', '10.20.30.40')).toBe(true);
      expect(isTrustedSplitHorizonResolution('portal.clinica.internal', '169.254.169.254')).toBe(false);
      expect(isTrustedSplitHorizonResolution('portal.clinica.internal', '127.0.0.1')).toBe(false);
    });
  });

  describe('2. Cache de [AI_INVOCATION] com retirada imediata quando houver alteração', () => {
    const buildAgentContext = (skillOverride?: string): AgentContext => ({
      id: 'mod-cardio-1',
      code: 'cardio-pulse',
      name: 'Cardio Pulse',
      skill: skillOverride || 'Auditor Deontológico Sênior CFM',
      systemPrompt: `Skill: ${skillOverride || 'Auditor Deontológico Sênior CFM'}`,
      targetNorms: ['cfm'],
      tags: ['cfm', 'publicidade'],
      activeNorms: [
        {
          id: 'norm-chunk-9',
          normCode: 'CFM-RES-2336-2023',
          source: 'CFM',
          title: 'Publicidade Médica',
          article: 'Art. 9º',
          severityDefault: 'GRAVE',
          keywords: ['CFM', 'PROMOÇÃO'],
          content: 'É vedado oferecer promoções de Black Friday ou descontos.',
          correctiveGuidance: 'Remover oferta promocional.',
          validity: {
            publishedAt: '2023-09-13',
            effectiveDate: '2024-03-11',
            revokedAt: null,
            isRevoked: false,
            officialGazette: 'DOU',
          },
        },
      ],
      retrievalStatus: 'READY',
    });

    it('deve reutilizar o cache quando Skill, página e normas não mudarem, e retirar do cache assim que houver alteração', async () => {
      vi.spyOn(ReconciliationEngine, 'getActiveModelConfig').mockResolvedValue({
        id: 'model-gemini-1',
        name: 'Google Gemini 3.5 Flash',
        provider: 'gemini',
        modelId: 'gemini-3.5-flash',
        temperature: 0.2,
        maxTokens: 2048,
      });

      const providerSpy = vi.spyOn(AIProviderFactory, 'reconcile').mockResolvedValue({
        verdict: 'NAO_CONFORME',
        score: 50,
        summary: 'Promoção detectada na página.',
        violations: [
          {
            normCode: 'CFM-RES-2336-2023',
            normArticle: 'Art. 9º',
            severity: 'GRAVE',
            detectedText: 'Promoção de Black Friday com 50% de desconto',
            correctiveAdvice: 'Retirar menção promocional.',
          },
        ],
        promptTokens: 1200,
        completionTokens: 200,
        totalTokens: 1400,
        sourcesUsed: ['CFM-RES-2336-2023 (Art. 9º): Publicidade Médica'],
        aiModelUsed: 'gemini:gemini-3.5-flash',
      });

      const scrapeV1 = ScraperService.processHtml(
        'https://cardiopulse.example.com/',
        '<html><body><h1>CardioPulse</h1><p>Promoção de Black Friday com 50% de desconto em consulta.</p></body></html>',
        'CHEERIO'
      );
      const contextV1 = buildAgentContext();

      // 1ª execução: Cache MISS -> chama provedor de IA
      const firstRun = await ReconciliationEngine.reconcileWithCacheMeta(
        scrapeV1,
        'mod-cardio-1',
        contextV1
      );
      expect(firstRun.cacheHit).toBe(false);
      expect(providerSpy).toHaveBeenCalledTimes(1);
      expect(firstRun.output.totalTokens).toBe(1400);

      // 2ª execução idêntica: Cache HIT -> NÃO chama provedor de IA e economiza 1400 tokens
      const secondRun = await ReconciliationEngine.reconcileWithCacheMeta(
        scrapeV1,
        'mod-cardio-1',
        contextV1
      );
      expect(secondRun.cacheHit).toBe(true);
      expect(secondRun.tokensSavedByCache).toBe(1400);
      expect(secondRun.output.totalTokens).toBe(0);
      expect(providerSpy).toHaveBeenCalledTimes(1);

      // 3ª execução: Alteração na Skill do agente -> retira entrada anterior do cache e invoca IA novamente
      const contextSkillUpdated = buildAgentContext('Auditor Deontológico CFM + LGPD Sensível v2');
      const thirdRun = await ReconciliationEngine.reconcileWithCacheMeta(
        scrapeV1,
        'mod-cardio-1',
        contextSkillUpdated
      );
      expect(thirdRun.cacheHit).toBe(false);
      expect(thirdRun.evictedPreviousKey).toBe(firstRun.cacheKey);
      expect(thirdRun.evictionReason).toBe('skill_ou_prompt_alterado');
      expect(providerSpy).toHaveBeenCalledTimes(2);

      // 4ª execução: Invalidação explícita ao atualizar o agente no Cockpit -> remove do cache
      const removedCount = await ReconciliationEngine.invalidateInvocationCacheByAgent(
        'mod-cardio-1',
        'agent_config_updated'
      );
      expect(removedCount).toBeGreaterThan(0);

      const fourthRun = await ReconciliationEngine.reconcileWithCacheMeta(
        scrapeV1,
        'mod-cardio-1',
        contextSkillUpdated
      );
      expect(fourthRun.cacheHit).toBe(false);
      expect(providerSpy).toHaveBeenCalledTimes(3);
    });
  });
});
