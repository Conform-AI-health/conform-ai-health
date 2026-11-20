import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmailService } from '../services/emailService.js';
import { AuditExecutionService } from '../services/auditExecutionService.js';
import { ReportController } from '../controllers/reportController.js';
import { TelemetryController } from '../controllers/telemetryController.js';
import { FirecrawlService } from '../services/firecrawlService.js';
import { ReconciliationEngine } from '../services/reconciliationEngine.js';
import { prisma } from '../config/prisma.js';

vi.mock('../config/prisma.js', () => ({
  prisma: {
    auditReport: {
      update: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    client: {
      findUnique: vi.fn(),
    },
    agentModule: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
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

describe('📧 Notificações por E-mail & Registro de Falhas na Telemetria (AuditExecutionService & EmailService)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.$transaction as any).mockImplementation(async (callback: any) => {
      return callback(prisma);
    });
  });

  describe('1. EmailService.sendAuditReportCompletedEmail', () => {
    it('deve rejeitar e-mails vazios ou endereços mock proibidos (contato@clinica.com) retornando erro descritivo', async () => {
      const resultEmpty = await EmailService.sendAuditReportCompletedEmail('', 'Clínica Exemplo', {
        id: 'rep-01',
        targetUrl: 'https://exemplo.med.br',
        score: 85,
        verdict: 'CONFORME',
      });

      expect(resultEmpty.success).toBe(false);
      expect(resultEmpty.error).toMatch(/inválido ou mock/i);

      const resultMock = await EmailService.sendAuditReportCompletedEmail('contato@clinica.com', 'Clínica Exemplo', {
        id: 'rep-02',
        targetUrl: 'https://exemplo.med.br',
        score: 85,
        verdict: 'CONFORME',
      });

      expect(resultMock.success).toBe(false);
      expect(resultMock.error).toMatch(/mock genérico proibido/i);
    });

    it('em ambiente de teste deve simular envio com sucesso e retornar messageId gerado', async () => {
      const result = await EmailService.sendAuditReportCompletedEmail('compliance@clinicaboa.med.br', 'Clínica Boa', {
        id: 'rep-03',
        targetUrl: 'https://clinicaboa.med.br',
        score: 95,
        verdict: 'CONFORME',
        summary: 'Site em conformidade total com a Resolução CFM 2.336/2023.',
        violationsCount: 0,
      });

      expect(result.success).toBe(true);
      expect(result.mocked).toBe(true);
      expect(result.messageId).toBeDefined();
    });
  });

  describe('2. Disparo de E-mail no Fluxo de Conclusão do Laudo e Telemetria', () => {
    const mockRecon = {
      verdict: 'CONFORME',
      score: 92,
      summary: 'Auditoria aprovada com excelência deontológica.',
      violations: [],
      promptTokens: 120,
      completionTokens: 80,
      totalTokens: 200,
      sourcesUsed: ['Res. CFM 2.336/23'],
      aiModelUsed: 'gemini-3.5-flash',
      groundingScore: 98,
      hallucinationRisk: 'LOW',
      guardrailsApplied: true,
      hallucinationsInterceptedCount: 0,
    };

    beforeEach(() => {
      (FirecrawlService.scrape as any).mockResolvedValue({
        markdown: '# Clínica Exemplo\nCRM/SP 123456\nRQE 654321',
        contentHash: 'hash-123456',
        source: 'FIRECRAWL',
        rawContent: '<html>...</html>',
      });
      (ReconciliationEngine.resolveAgentContext as any).mockResolvedValue({
        activeNorms: [{ id: 'norm-1', normCode: 'Res. CFM 2.336/23', title: 'Publicidade Médica', keywords: ['CFM'] }],
        resolvedDbNorms: [],
      });
      (ReconciliationEngine.reconcile as any).mockResolvedValue(mockRecon);
      (prisma.auditReport.update as any).mockResolvedValue({ id: 'rep-100', status: 'COMPLETED' });
      (prisma.systemLog.create as any).mockResolvedValue({});
    });

    it('ao concluir a auditoria pela IA, NÃO deve enviar e-mail automaticamente e DEVE encaminhar para a fila de revisão do auditor (AUDIT_AWAITING_REVIEW)', async () => {
      (prisma.client.findUnique as any).mockResolvedValue({
        id: 'client-1',
        name: 'Clínica Oftalmológica Visão',
        email: 'diretoria@clinicavisao.med.br',
        users: [{ email: 'auditor@clinicavisao.med.br' }],
      });

      const sendEmailSpy = vi.spyOn(EmailService, 'sendAuditReportCompletedEmail').mockResolvedValue({
        success: true,
        messageId: 'msg-resend-999',
      });

      const result = await AuditExecutionService.execute({
        auditReportId: 'rep-100',
        clientId: 'client-1',
        targetUrl: 'https://clinicavisao.med.br',
      });

      expect(result.success).toBe(true);
      expect(result.reviewStatus).toBe('PENDING_REVIEW');
      expect(result.auditorReviewed).toBe(false);
      expect(result.emailSent).toBe(false);

      // O e-mail NÃO deve ser enviado pela IA de forma autônoma
      expect(sendEmailSpy).not.toHaveBeenCalled();

      // Valida gravação do log de encaminhamento para revisão na telemetria
      expect(prisma.systemLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            level: 'INFO',
            module: 'AUDIT_WORKFLOW',
            correlationId: 'rep-100',
            message: expect.stringContaining('[AUDIT_AWAITING_REVIEW]'),
          }),
        })
      );
    });

    it('deve registrar que a IA foi pulada quando a recuperação RAG está sem embeddings', async () => {
      (prisma.client.findUnique as any).mockResolvedValue({
        id: 'client-unindexed',
        name: 'Clínica sem índice RAG',
        email: null,
        users: [],
      });
      (ReconciliationEngine.resolveAgentContext as any).mockResolvedValue({
        activeNorms: [],
        resolvedDbNorms: [],
        tags: ['cfm', 'lgpd'],
        retrievalStatus: 'UNINDEXED',
        retrievalCandidatesCount: 12,
      });
      (ReconciliationEngine.reconcile as any).mockResolvedValue({
        ...mockRecon,
        verdict: 'INCONCLUSIVO',
        score: 60,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        sourcesUsed: [],
        aiModelUsed: 'retrieval:UNINDEXED',
      });

      await AuditExecutionService.execute({
        auditReportId: 'rep-unindexed',
        clientId: 'client-unindexed',
        targetUrl: 'https://clinicasemindice.med.br',
      });

      expect(prisma.systemLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            module: 'AI_ENGINE',
            message: expect.stringContaining('[AI_INVOCATION_SKIPPED]'),
            details: expect.stringContaining('"aiInvoked":false'),
          }),
        })
      );
      expect(prisma.systemLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            message: expect.stringContaining('npm run rag:reindex'),
          }),
        })
      );
    });
  });

  describe('3. Novo Menu e Fluxo de Revisão do Auditor (ReportController.getPendingReview & confirmAndSendEmail)', () => {
    it('ReportController.getPendingReview: deve listar laudos pendentes de revisão do auditor humano', async () => {
      (prisma.auditReport.count as any).mockResolvedValue(1);
      (prisma.auditReport.findMany as any).mockResolvedValue([
        {
          id: 'rep-pending-1',
          targetUrl: 'https://clinicapendente.med.br',
          status: 'COMPLETED',
          reviewStatus: 'PENDING_REVIEW',
          auditorReviewed: false,
          score: 85,
          verdict: 'CONFORME',
          violations: [],
          client: {
            name: 'Clínica Pendente',
            tradeName: 'Pendente Saúde',
            email: 'contato@clinicapendente.med.br',
          },
        },
      ]);

      const req: any = { query: { page: '1', limit: '10' } };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await ReportController.getPendingReview(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ id: 'rep-pending-1', reviewStatus: 'PENDING_REVIEW' }),
          ]),
          pagination: expect.objectContaining({ total: 1 }),
        })
      );
    });

    it('ReportController.getProcessedReview: deve listar laudos já processados/homologados pelo auditor humano', async () => {
      (prisma.auditReport.count as any).mockResolvedValue(1);
      (prisma.auditReport.findMany as any).mockResolvedValue([
        {
          id: 'rep-processed-1',
          targetUrl: 'https://clinicaprocessada.med.br',
          status: 'COMPLETED',
          reviewStatus: 'APPROVED',
          auditorReviewed: true,
          reviewedBy: 'auditor.chefe@conformia.med.br',
          reviewedAt: new Date(),
          emailSent: true,
          score: 95,
          verdict: 'CONFORME',
          violations: [],
          client: {
            name: 'Clínica Homologada',
            email: 'contato@clinicahomologada.med.br',
          },
        },
      ]);

      const req: any = { query: { page: '1', limit: '10' } };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await ReportController.getProcessedReview(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ id: 'rep-processed-1', reviewStatus: 'APPROVED', auditorReviewed: true }),
          ]),
          pagination: expect.objectContaining({ total: 1 }),
        })
      );
    });

    it('ReportController.confirmAndSendEmail: deve rejeitar se a checkbox de confirmação do auditor não estiver marcada (confirmed: false)', async () => {
      const req: any = {
        params: { id: 'rep-pending-1' },
        body: { confirmed: false, decision: 'APPROVED' },
        user: { role: 'AUDITOR', email: 'auditor@conformia.med.br' },
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await ReportController.confirmAndSendEmail(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('ReportController.confirmAndSendEmail: com checkbox marcada, deve homologar laudo e enviar e-mail oficial à clínica com logs auditáveis', async () => {
      (prisma.auditReport.findUnique as any).mockResolvedValue({
        id: 'rep-pending-1',
        targetUrl: 'https://clinicapendente.med.br',
        score: 90,
        verdict: 'CONFORME',
        summary: 'Resumo auditado pela IA',
        violations: [],
        structuredContract: JSON.stringify({ summary: 'Resumo inicial' }),
        client: {
          name: 'Clínica Aprovada',
          email: 'diretoria@clinicaaprovada.med.br',
          users: [{ email: 'medico@clinicaaprovada.med.br' }],
        },
      });

      (prisma.auditReport.update as any).mockResolvedValue({
        id: 'rep-pending-1',
        reviewStatus: 'APPROVED',
        auditorReviewed: true,
        emailSent: true,
      });

      const sendEmailSpy = vi.spyOn(EmailService, 'sendAuditReportCompletedEmail').mockResolvedValue({
        success: true,
        messageId: 'msg-auditor-approved-123',
      });

      const req: any = {
        params: { id: 'rep-pending-1' },
        body: {
          confirmed: true,
          decision: 'APPROVED',
          notes: 'Revisão presencial dos apontamentos e conformidade com a Res. CFM 2.336/23.',
        },
        user: { role: 'AUDITOR', email: 'auditor.chefe@conformia.med.br' },
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await ReportController.confirmAndSendEmail(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Laudo confirmado e homologado com sucesso!'),
          emailSent: true,
        })
      );

      // Valida chamada de envio para o e-mail da clínica
      expect(sendEmailSpy).toHaveBeenCalledWith(
        'diretoria@clinicaaprovada.med.br',
        'Clínica Aprovada',
        expect.objectContaining({ id: 'rep-pending-1', score: 90, verdict: 'CONFORME' })
      );

      // Valida registros no SystemLog: confirmação do auditor e envio de email
      expect(prisma.systemLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            module: 'AUDIT_REVIEW',
            message: expect.stringContaining('[AUDITOR_CONFIRMED]'),
          }),
        })
      );
      expect(prisma.systemLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            module: 'EMAIL_NOTIFICATION',
            message: expect.stringContaining('[EMAIL_SUCCESS]'),
          }),
        })
      );
    });

    it('ReportController.confirmAndSendEmail: quando clínica não tem e-mail, deve registrar aviso WARN sem falhar homologação', async () => {
      (prisma.auditReport.findUnique as any).mockResolvedValue({
        id: 'rep-no-email',
        targetUrl: 'https://clinicasememail.med.br',
        score: 75,
        verdict: 'PARCIALMENTE_CONFORME',
        summary: 'Resumo',
        violations: [],
        client: {
          name: 'Clínica Sem Contato',
          email: null,
          users: [],
        },
      });

      (prisma.auditReport.update as any).mockResolvedValue({
        id: 'rep-no-email',
        reviewStatus: 'APPROVED',
        auditorReviewed: true,
      });

      const sendEmailSpy = vi.spyOn(EmailService, 'sendAuditReportCompletedEmail');

      const req: any = {
        params: { id: 'rep-no-email' },
        body: { confirmed: true, decision: 'APPROVED' },
        user: { role: 'AUDITOR', email: 'auditor@conformia.med.br' },
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await ReportController.confirmAndSendEmail(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(sendEmailSpy).not.toHaveBeenCalled();
      expect(prisma.systemLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            level: 'WARN',
            module: 'EMAIL_NOTIFICATION',
            message: expect.stringContaining('[EMAIL_WARN]'),
          }),
        })
      );
    });
  });

  describe('4. Endpoint ReportController.notifyClient (Reenvio Manual & Telemetria)', () => {
    it('deve reenviar notificação com sucesso e gravar na telemetria', async () => {
      (prisma.auditReport.findUnique as any).mockResolvedValue({
        id: 'rep-200',
        targetUrl: 'https://clinica.com.br',
        score: 88,
        verdict: 'CONFORME',
        summary: 'Resumo do laudo',
        violations: [],
        client: {
          name: 'Clínica Cardio',
          email: 'diretoria@cardio.med.br',
        },
      });

      vi.spyOn(EmailService, 'sendAuditReportCompletedEmail').mockResolvedValue({
        success: true,
        messageId: 'manual-msg-123',
      });

      const req: any = {
        params: { id: 'rep-200' },
        user: { role: 'ADMIN', email: 'admin@conformia.med.br' },
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await ReportController.notifyClient(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('enviada com sucesso'),
          recipient: 'diretoria@cardio.med.br',
        })
      );

      expect(prisma.systemLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            level: 'INFO',
            module: 'EMAIL_NOTIFICATION',
            correlationId: 'rep-200',
          }),
        })
      );
    });

    it('deve registrar na telemetria (WARN) e retornar HTTP 502 quando o envio falhar', async () => {
      (prisma.auditReport.findUnique as any).mockResolvedValue({
        id: 'rep-201',
        targetUrl: 'https://clinica.com.br',
        score: 50,
        verdict: 'PARCIALMENTE_CONFORME',
        violations: [],
        client: {
          name: 'Clínica Falha',
          email: 'falha@clinica.med.br',
        },
      });

      vi.spyOn(EmailService, 'sendAuditReportCompletedEmail').mockResolvedValue({
        success: false,
        error: 'Domínio de remetente não autenticado no Resend',
      });

      const req: any = {
        params: { id: 'rep-201' },
        user: { role: 'AUDITOR', email: 'auditor@conformia.med.br' },
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await ReportController.notifyClient(req, res, next);

      expect(res.status).toHaveBeenCalledWith(502);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('Domínio de remetente não autenticado'),
        })
      );

      expect(prisma.systemLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            level: 'WARN',
            module: 'EMAIL_NOTIFICATION',
            correlationId: 'rep-201',
            message: expect.stringContaining('Falha no disparo de notificação'),
          }),
        })
      );
    });
  });

  describe('5. TelemetryController.getTelemetry: Agregação de Métricas de E-mail', () => {
    it('deve computar e expor métricas consolidadas de e-mails enviados e com falha', async () => {
      (prisma.auditReport.findMany as any).mockResolvedValue([
        {
          id: 'rep-1',
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          executionTimeMs: 400,
          violations: [],
        },
      ]);
      (prisma.agentModule.findMany as any).mockResolvedValue([]);

      // Simula logs gravados pelo EmailService e AuditExecutionService
      (prisma.systemLog.findMany as any).mockResolvedValue([
        { module: 'EMAIL_NOTIFICATION', level: 'INFO', message: 'E-mail enviado com sucesso' },
        { module: 'EMAIL_NOTIFICATION', level: 'INFO', message: 'E-mail enviado com sucesso' },
        { module: 'EMAIL_NOTIFICATION', level: 'WARN', message: 'Falha no envio de e-mail' },
        { module: 'AI_GUARDRAILS', level: 'INFO', details: JSON.stringify({ incidents: [] }) },
      ]);

      const req: any = {};
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await TelemetryController.getTelemetry(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      const jsonResponse = res.json.mock.calls[0][0];

      expect(jsonResponse.metrics.emailNotifications).toBeDefined();
      expect(jsonResponse.metrics.emailNotifications).toEqual({
        totalAttempted: 3,
        sentTotal: 2,
        failedTotal: 1,
        deliveryRate: 66.7,
      });
    });
  });
});
