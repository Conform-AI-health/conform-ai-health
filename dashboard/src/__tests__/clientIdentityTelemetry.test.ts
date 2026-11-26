import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditExecutionService } from '../services/auditExecutionService.js';
import { TelemetryController } from '../controllers/telemetryController.js';
import { FirecrawlService } from '../services/firecrawlService.js';
import { ReconciliationEngine } from '../services/reconciliationEngine.js';
import { prisma } from '../config/prisma.js';

vi.mock('../shared/tracing.js', () => ({
  runWithContext: (_ctx: any, fn: () => any) => fn(),
  withSpan: (_name: string, _attrs: any, fn: () => any) => fn(),
  getActiveTraceIds: () => ({ traceId: 'trace-test-123', spanId: 'span-test-456' }),
  injectTraceCarrier: () => ({}),
}));

vi.mock('../config/prisma.js', () => ({
  prisma: {
    auditReport: {
      update: vi.fn(),
      findMany: vi.fn(),
    },
    client: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    agentModule: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    violation: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    systemLog: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../services/firecrawlService.js', () => ({
  FirecrawlService: {
    scrape: vi.fn(),
  },
}));

vi.mock('../services/reconciliationEngine.js', () => ({
  ReconciliationEngine: {
    resolveAgentContext: vi.fn(),
    reconcile: vi.fn(),
    getActiveProvider: vi.fn().mockReturnValue('gemini'),
  },
}));

describe('🏷️ Resolução e Reconciliação de clientName na Execução de Auditoria e Telemetria', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.$transaction as any).mockImplementation(async (cb: any) => cb(prisma));
    (prisma.auditReport.update as any).mockResolvedValue({ id: 'rep-url-1', clientId: null });
    (prisma.agentModule.update as any).mockResolvedValue({});
    (prisma.systemLog.create as any).mockResolvedValue({});
    (ReconciliationEngine.resolveAgentContext as any).mockResolvedValue({
      activeNorms: [{ id: 'n1', normCode: 'Res. CFM 2.336/23', title: 'Publicidade Médica', keywords: ['CFM'] }],
      resolvedDbNorms: [],
    });
    (ReconciliationEngine.reconcile as any).mockResolvedValue({
      verdict: 'NAO_CONFORME',
      score: 40,
      summary: 'Apontamento identificado.',
      violations: [],
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      sourcesUsed: ['Res. CFM 2.336/23'],
      aiModelUsed: 'gemini-3.5-flash',
      groundingScore: 95,
      hallucinationRisk: 'LOW',
      guardrailsApplied: true,
      hallucinationsInterceptedCount: 0,
    });
  });

  it('deve reconciliar automaticamente clientId defasado (ex.: módulo "CardioPulse AI" ainda apontando para "Feegowclinic")', async () => {
    const feegow = {
      id: '6afb374bc2536ed37d134647',
      name: 'Feegowclinic',
      tradeName: 'Feegowclinic',
      websiteUrl: '',
      instagramHandle: null,
    };
    const cardioPulse = {
      id: '6aef27ae061625e410ec3826',
      name: 'CardioPulse AI',
      tradeName: 'CardioPulse AI',
      websiteUrl: '',
      instagramHandle: null,
    };

    (prisma.agentModule.findFirst as any).mockResolvedValue({
      id: '6b0041246d694e4106dd59eb',
      code: 'gest-o-integrada-de-escalas-horas-mwoz3mgx',
      name: 'CardioPulse AI',
      clientId: feegow.id,
      targetUrl: 'https://conform-ai-health.github.io/samd-health-demo/',
      tags: ['cfm'],
    });
    (prisma.client.findUnique as any).mockResolvedValue(feegow);
    (prisma.client.findMany as any).mockResolvedValue([cardioPulse, feegow]);
    (FirecrawlService.scrape as any).mockResolvedValue({
      markdown: '# CardioPulse AI — SaMD Demo\nDiagnóstico assistido',
      rawContent: '<html></html>',
      contentHash: 'h-cardio',
      source: 'FIRECRAWL_API',
      tokensCount: 40,
      tags: [],
    });

    await AuditExecutionService.execute({
      auditReportId: '6b08bae0817835916b847f06',
      clientId: feegow.id,
      targetUrl: 'https://conform-ai-health.github.io/samd-health-demo/',
      agentModuleId: '6b0041246d694e4106dd59eb',
    });

    // Corrige o vínculo tanto no módulo quanto no AuditReport para CardioPulse AI
    expect(prisma.agentModule.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: '6b0041246d694e4106dd59eb' },
        data: { clientId: cardioPulse.id },
      })
    );
    expect(prisma.auditReport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: '6b08bae0817835916b847f06' },
        data: expect.objectContaining({
          clientId: cardioPulse.id,
          status: 'COMPLETED',
        }),
      })
    );

    const logCalls = (prisma.systemLog.create as any).mock.calls.map((c: any) => c[0].data);
    const awaitingLog = logCalls.find((l: any) => l.module === 'AUDIT_WORKFLOW');
    expect(awaitingLog.message).toContain('à clínica "CardioPulse AI"');
    expect(awaitingLog.message).not.toContain('Feegowclinic');
  });

  it('deve resolver clientName e vincular clientId pela URL quando clientId vier vazio no job', async () => {
    (prisma.agentModule.findFirst as any).mockResolvedValue({
      id: 'mod-1',
      name: 'Auditor Geral',
      clientId: null,
      tags: ['cfm'],
    });
    (prisma.client.findMany as any).mockResolvedValue([
      {
        id: 'cli-matched-99',
        name: 'Instituto Médico Santa Clara Ltda',
        tradeName: 'Clínica Santa Clara',
        websiteUrl: 'https://www.clinicasantaclara.med.br/',
      },
    ]);
    (FirecrawlService.scrape as any).mockResolvedValue({
      markdown: '# Bem-vindo\nConteúdo institucional CRM/SP 123456',
      rawContent: '<html></html>',
      contentHash: 'h1',
      source: 'FIRECRAWL_API',
      tokensCount: 40,
      tags: [],
    });

    await AuditExecutionService.execute({
      auditReportId: 'rep-url-1',
      clientId: '',
      targetUrl: 'https://clinicasantaclara.med.br/especialidades',
      agentModuleId: 'mod-1',
    });

    const logCalls = (prisma.systemLog.create as any).mock.calls.map((c: any) => c[0].data);
    const awaitingLog = logCalls.find((l: any) => l.module === 'AUDIT_WORKFLOW');
    expect(awaitingLog.message).toContain('à clínica "Clínica Santa Clara"');
  });

  it('TelemetryController.getTelemetry deve resolver clientName em relatórios e logs históricos', async () => {
    (prisma.auditReport.findMany as any).mockResolvedValue([
      {
        id: 'rep-hist-1',
        targetUrl: 'https://institutocardio.med.br/equipe',
        verdict: 'CONFORME',
        score: 96,
        promptTokens: 200,
        completionTokens: 80,
        totalTokens: 280,
        tokensSaved: 50,
        executionTimeMs: 1200,
        sourcesUsed: ['Res. CFM 2.336/23'],
        violations: [],
        client: null,
        createdAt: new Date(),
      },
    ]);
    (prisma.systemLog.findMany as any).mockResolvedValue([
      {
        id: 'log-hist-1',
        level: 'INFO',
        module: 'AUDIT_WORKFLOW',
        correlationId: 'rep-hist-1',
        message:
          '[AUDIT_AWAITING_REVIEW] Laudo rep-hist-1 gerado pela IA com sucesso. Encaminhado para a fila antes do envio à clínica "Clínica Auditada".',
        details: JSON.stringify({
          auditReportId: 'rep-hist-1',
          clientName: 'Clínica Auditada',
          targetUrl: 'https://institutocardio.med.br/equipe',
        }),
        createdAt: new Date(),
      },
    ]);
    (prisma.agentModule.findMany as any).mockResolvedValue([]);
    (prisma.client.findMany as any).mockResolvedValue([
      {
        id: 'cli-cardio-1',
        name: 'Instituto Cardio Paulista S/A',
        tradeName: 'Instituto Cardio',
        crmResponsavel: '99887',
        crmUf: 'SP',
        websiteUrl: 'https://www.institutocardio.med.br',
        instagramHandle: null,
      },
    ]);

    const req: any = {};
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    await TelemetryController.getTelemetry(req, res, next);

    const body = res.json.mock.calls[0][0];
    expect(body.auditsTelemetry[0].clientName).toBe('Instituto Cardio');
    expect(body.auditsTelemetry[0].crm).toBe('CRM/SP 99887');
    expect(body.systemLogs[0].message).toContain('Instituto Cardio');
  });
});
