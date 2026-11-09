import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIStructuredContractAdapter, structuredAuditContractSchema } from '../shared/aiStructuredContract.js';
import { ReconciliationOutput, ReconciliationEngine } from '../services/reconciliationEngine.js';
import { TelemetryController } from '../controllers/telemetryController.js';
import { ReportController } from '../controllers/reportController.js';
import { prisma } from '../config/prisma.js';

vi.mock('../config/prisma.js', () => ({
  prisma: {
    auditReport: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    systemLog: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    agentModule: {
      findMany: vi.fn(),
    },
    client: {
      findUnique: vi.fn(),
    },
  },
}));

describe('📋 Contrato Estruturado de IA & Telemetria Avançada', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Atividade 2: Contrato de Saída Estruturado de Alta Confiabilidade', () => {
    it('deve converter ReconciliationOutput em StructuredAuditContract válido conforme o schema Zod', () => {
      const mockOutput: ReconciliationOutput = {
        verdict: 'NAO_CONFORME',
        score: 40,
        summary: 'Identificadas infrações com alto risco ético.',
        violations: [
          {
            normCode: 'Res. CFM 2.336/23',
            normArticle: 'Artigo 1º, § 1º',
            severity: 'CRITICA',
            detectedText: 'Nenhum número de identificação profissional (CRM) identificado no material.',
            correctiveAdvice: 'Incluir CRM e UF no cabeçalho ou rodapé.',
          },
          {
            normCode: 'LGPD Art. 11',
            normArticle: 'Artigo 11, Inciso I',
            severity: 'MEDIA',
            detectedText: 'Formulário coleta dados de saúde sem termo de consentimento explícito.',
            correctiveAdvice: 'Implementar termo de consentimento específico para dados de saúde.',
          },
        ],
        promptTokens: 500,
        completionTokens: 200,
        totalTokens: 700,
        sourcesUsed: ['CFM', 'LGPD'],
        aiModelUsed: 'gemini-3.5-flash',
        groundingScore: 92,
        hallucinationRisk: 'NONE',
        guardrailsApplied: false,
        hallucinationsInterceptedCount: 0,
      };

      const structuredContract = AIStructuredContractAdapter.toStructuredContract(mockOutput, 'AUD-999');

      // Validação estrita do schema Zod
      const parsed = structuredAuditContractSchema.parse(structuredContract);
      expect(parsed.audit_id).toBe('AUD-999');
      expect(parsed.risk_level).toBe('CRITICAL');
      expect(parsed.confidence).toBe(0.92);
      expect(parsed.findings.length).toBe(2);

      // Verificação dos campos individuais do finding
      const firstFinding = parsed.findings[0];
      expect(firstFinding.regulation).toBe('CFM');
      expect(firstFinding.article).toBe('Artigo 1º, § 1º');
      expect(firstFinding.evidence).toContain('CRM');
      expect(firstFinding.source_version).toBe('2023');
      expect(firstFinding.requires_human_review).toBe(true); // Severidade CRÍTICA aciona revisão humana

      const secondFinding = parsed.findings[1];
      expect(secondFinding.regulation).toBe('LGPD');
      expect(secondFinding.source_version).toBe('2018');
    });

    it('deve converter de volta do Contrato Estruturado para o formato ReconciliationOutput', () => {
      const contract = {
        audit_id: 'AUD-888',
        risk_level: 'MEDIUM' as const,
        confidence: 0.88,
        findings: [
          {
            description: 'Divulgação de especialidade sem RQE',
            regulation: 'CFM',
            article: 'Artigo 1º, § 2º',
            evidence: 'Anúncio de dermatologia sem número de RQE',
            source_version: '2023',
            recommendation: 'Registrar e exibir número do RQE',
            requires_human_review: false,
          },
        ],
      };

      const output = AIStructuredContractAdapter.fromStructuredContract(contract);
      expect(output.verdict).toBe('PARCIALMENTE_CONFORME');
      expect(output.score).toBe(75);
      expect(output.violations.length).toBe(1);
      expect(output.groundingScore).toBe(88);
      expect(output.hallucinationRisk).toBe('LOW');
    });
  });

  describe('Atividade 3: Telemetria Avançada & Métricas de Observabilidade', () => {
    it('deve calcular latências (média, min, max, P95), custos USD/BRL e taxas de qualidade', async () => {
      const mockReports: any[] = [
        {
          id: 'rep-01',
          executionTimeMs: 1200,
          promptTokens: 1000,
          completionTokens: 500,
          totalTokens: 1500,
          tokensSaved: 300,
          aiModelUsed: 'gemini-3.5-flash',
          client: { tradeName: 'Clínica A', crmResponsavel: '1234', crmUf: 'SP' },
          violations: [{ id: 'v1', severity: 'MEDIA', resolved: false, normCode: 'CFM' }],
        },
        {
          id: 'rep-02',
          executionTimeMs: 2500,
          promptTokens: 2000,
          completionTokens: 800,
          totalTokens: 2800,
          tokensSaved: 500,
          aiModelUsed: 'gemini-3.5-flash',
          client: { tradeName: 'Clínica B', crmResponsavel: '5678', crmUf: 'RJ' },
          violations: [{ id: 'v2', severity: 'CRITICA', resolved: true, normCode: 'CFM' }], // Resolvido por humano!
        },
      ];

      const mockLogs: any[] = [
        {
          id: 'log-01',
          level: 'WARN',
          module: 'AI_GUARDRAILS',
          message: 'Interceptada alucinação fática',
          details: JSON.stringify({
            incidents: [{ type: 'FABRICATED_EVIDENCE' }, { type: 'UNGROUNDED_NORM' }],
          }),
        },
        {
          id: 'log-02',
          level: 'WARN',
          module: 'CIRCUIT_BREAKER',
          message: 'Falha temporária no Gemini',
        },
      ];

      const mockModules: any[] = [
        {
          id: 'mod-01',
          name: 'Agente Deontológico CFM',
          version: '1.2.0',
          regulatoryFramework: 'CFM (Resolução 2.336/2023)',
          systemPrompt: 'Você é um auditor rigoroso de publicidade médica.',
          tags: ['CFM', 'PUBLICIDADE'],
          updatedAt: new Date(),
        },
      ];

      (prisma.auditReport.findMany as any).mockResolvedValue(mockReports);
      (prisma.systemLog.findMany as any).mockResolvedValue(mockLogs);
      (prisma.agentModule.findMany as any).mockResolvedValue(mockModules);

      const req: any = {};
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await TelemetryController.getTelemetry(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(200);
      const data = res.json.mock.calls[0][0];

      // Verificação das métricas calculadas
      expect(data).toHaveProperty('metrics');
      const metrics = data.metrics;

      // 1. Latências
      expect(metrics.averageLatencyMs).toBe(1850); // (1200 + 2500) / 2
      expect(metrics.minLatencyMs).toBe(1200);
      expect(metrics.maxLatencyMs).toBe(2500);
      expect(metrics.p95LatencyMs).toBe(2500);

      // 2. Tokens
      expect(metrics.totalPromptTokens).toBe(3000);
      expect(metrics.totalCompletionTokens).toBe(1300);
      expect(metrics.totalTokens).toBe(4300);

      // 3. Custos USD e BRL
      expect(metrics.totalCostUsd).toBeGreaterThan(0);
      expect(metrics.totalCostBrl).toBeGreaterThan(0);
      expect(metrics.averageCostPerAuditBrl).toBeGreaterThan(0);

      // 4. Taxas de Guardrails
      expect(metrics.evidenceMissingRate).toBe(50); // 1 incidente / 2 relatórios = 50%
      expect(metrics.invalidCitationsRate).toBe(50);

      // 5. Taxa de Divergência Humano vs IA
      expect(metrics.humanAiDivergenceRate).toBe(50); // 1 resolvido de 2 violações = 50%

      // 6. Taxa de Falhas por Modelo
      expect(data).toHaveProperty('modelFailureRates');
      expect(Array.isArray(data.modelFailureRates)).toBe(true);
      const geminiModel = data.modelFailureRates.find((m: any) => m.model === 'gemini');
      expect(geminiModel).toBeDefined();

      // 7. Histórico de Prompts e Versões
      expect(data).toHaveProperty('promptVersionHistory');
      expect(data.promptVersionHistory.length).toBe(1);
      expect(data.promptVersionHistory[0].version).toBe('1.2.0');
      expect(data.promptVersionHistory[0].agentName).toBe('Agente Deontológico CFM');

      // 8. Custo individual nas auditorias
      expect(data.auditsTelemetry[0]).toHaveProperty('costUsd');
      expect(data.auditsTelemetry[0]).toHaveProperty('costBrl');
    });
  });

  describe('AI-05: Fluxo de Revisão Humana de Laudo Deontológico', () => {
    it('deve registrar parecer do auditor, homologar aprovação e desativar requiresHumanReview', async () => {
      const mockReport = {
        id: 'rep-human-01',
        requiresHumanReview: true,
        verdict: 'PARCIALMENTE_CONFORME',
        score: 60,
        structuredContract: JSON.stringify({
          audit_id: 'AUD-001',
          risk_level: 'MEDIUM',
          confidence: 0.85,
          findings: [],
        }),
      };

      (prisma.auditReport.findUnique as any).mockResolvedValue(mockReport);
      (prisma.auditReport.update as any).mockImplementation(({ data }: any) => ({
        ...mockReport,
        ...data,
      }));

      const req: any = {
        params: { id: 'rep-human-01' },
        user: { userId: 'auditor-007', email: 'auditor@cfm.org.br', role: 'AUDITOR' },
        body: {
          decision: 'APPROVED',
          notes: 'Evidências verificadas manualmente. Adequação formal homologada.',
          adjustedScore: 90,
          adjustedVerdict: 'CONFORME',
        },
      };

      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await ReportController.reviewReport(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      const resBody = res.json.mock.calls[0][0];

      expect(resBody.message).toContain('APPROVED');
      expect(resBody.review).toBeDefined();
      expect(resBody.review.decision).toBe('APPROVED');
      expect(resBody.review.reviewerId).toBe('auditor-007');
      expect(resBody.review.notes).toContain('Evidências verificadas manualmente');

      // Verifica update no Prisma
      expect(prisma.auditReport.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rep-human-01' },
          data: expect.objectContaining({
            requiresHumanReview: false,
            score: 90,
            verdict: 'CONFORME',
          }),
        })
      );

      // Verifica registro de auditoria no systemLog
      expect(prisma.systemLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            module: 'HUMAN_REVIEW',
            level: 'INFO',
          }),
        })
      );
    });

    it('deve rejeitar laudo em caso de discordância grave do auditor humano', async () => {
      const mockReport = {
        id: 'rep-human-02',
        requiresHumanReview: true,
        verdict: 'CONFORME',
        score: 100,
        structuredContract: JSON.stringify({}),
      };

      (prisma.auditReport.findUnique as any).mockResolvedValue(mockReport);
      (prisma.auditReport.update as any).mockImplementation(({ data }: any) => ({
        ...mockReport,
        ...data,
      }));

      const req: any = {
        params: { id: 'rep-human-02' },
        user: { userId: 'auditor-008', email: 'auditor2@cfm.org.br', role: 'AUDITOR' },
        body: {
          decision: 'REJECTED',
          notes: 'Identificada propaganda enganosa explícita ignorada pelo extrator.',
          adjustedScore: 10,
        },
      };

      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await ReportController.reviewReport(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(prisma.auditReport.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rep-human-02' },
          data: expect.objectContaining({
            requiresHumanReview: false,
            verdict: 'NAO_CONFORME',
            score: 10,
          }),
        })
      );
    });
  });
});
