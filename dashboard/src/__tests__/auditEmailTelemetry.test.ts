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

    it('deve enviar e-mail com sucesso após a conclusão do laudo e registrar na telemetria (INFO)', async () => {
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
      expect(ReconciliationEngine.reconcile).toHaveBeenCalledWith(
        expect.objectContaining({
          extractedEntities: expect.objectContaining({
            extractionCompleted: true,
            crms: expect.arrayContaining([expect.stringContaining('123456')]),
            rqes: expect.arrayContaining([expect.stringContaining('654321')]),
          }),
        }),
        undefined,
        expect.any(Object)
      );
      expect(sendEmailSpy).toHaveBeenCalledWith(
        'diretoria@clinicavisao.med.br',
        'Clínica Oftalmológica Visão',
        expect.objectContaining({ id: 'rep-100', score: 92, verdict: 'CONFORME' })
      );

      // Valida gravação do log de sucesso na telemetria
      expect(prisma.systemLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            level: 'INFO',
            module: 'EMAIL_NOTIFICATION',
            correlationId: 'rep-100',
            message: expect.stringContaining('enviado com sucesso'),
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

    it('quando o envio do e-mail falhar, NÃO deve quebrar o laudo concluído e DEVE registrar na telemetria (WARN)', async () => {
      (prisma.client.findUnique as any).mockResolvedValue({
        id: 'client-2',
        name: 'Clínica Dermatológica Pele',
        email: 'contato@clinica.com', // e-mail mock que é rejeitado
      });

      const sendEmailSpy = vi.spyOn(EmailService, 'sendAuditReportCompletedEmail').mockResolvedValue({
        success: false,
        error: 'E-mail de destino inválido ou mock genérico proibido',
      });

      const result = await AuditExecutionService.execute({
        auditReportId: 'rep-101',
        clientId: 'client-2',
        targetUrl: 'https://clinicapele.med.br',
      });

      // O laudo foi concluído com sucesso apesar da falha no e-mail
      expect(result.success).toBe(true);

      // Valida gravação do log de erro/aviso na telemetria
      expect(prisma.systemLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            level: 'WARN',
            module: 'EMAIL_NOTIFICATION',
            correlationId: 'rep-101',
            message: expect.stringContaining('Falha ao enviar notificação de laudo por e-mail'),
            details: expect.stringContaining('E-mail de destino inválido'),
          }),
        })
      );
    });

    it('quando a clínica não possuir e-mail cadastrado, deve registrar na telemetria aviso de pendência de destinatário', async () => {
      (prisma.client.findUnique as any).mockResolvedValue({
        id: 'client-3',
        name: 'Clínica Sem E-mail',
        email: null,
        users: [],
      });

      const sendEmailSpy = vi.spyOn(EmailService, 'sendAuditReportCompletedEmail');

      const result = await AuditExecutionService.execute({
        auditReportId: 'rep-102',
        clientId: 'client-3',
        targetUrl: 'https://clinicasememail.med.br',
      });

      expect(result.success).toBe(true);
      expect(sendEmailSpy).not.toHaveBeenCalled();

      // Telemetria registra pendência
      expect(prisma.systemLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            level: 'WARN',
            module: 'EMAIL_NOTIFICATION',
            correlationId: 'rep-102',
            message: expect.stringContaining('Nenhum endereço de e-mail válido encontrado'),
          }),
        })
      );
    });

    it('quando o provedor de mensageria lançar exceção não tratada, deve registrar na telemetria como ERROR', async () => {
      (prisma.client.findUnique as any).mockResolvedValue({
        id: 'client-4',
        name: 'Clínica Exceção',
        email: 'adm@clinicaexcecao.med.br',
      });

      vi.spyOn(EmailService, 'sendAuditReportCompletedEmail').mockRejectedValue(
        new Error('Resend 500 Internal Server Error')
      );

      const result = await AuditExecutionService.execute({
        auditReportId: 'rep-103',
        clientId: 'client-4',
        targetUrl: 'https://clinicaexcecao.med.br',
      });

      expect(result.success).toBe(true);

      expect(prisma.systemLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            level: 'ERROR',
            module: 'EMAIL_NOTIFICATION',
            correlationId: 'rep-103',
            message: expect.stringContaining('Erro inesperado durante o disparo de e-mail do laudo'),
            details: expect.stringContaining('Resend 500 Internal Server Error'),
          }),
        })
      );
    });
  });

  describe('3. Endpoint ReportController.notifyClient (Reenvio Manual & Telemetria)', () => {
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

  describe('4. TelemetryController.getTelemetry: Agregação de Métricas de E-mail', () => {
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
