import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmailService } from '../services/emailService.js';
import { AuditExecutionService } from '../services/auditExecutionService.js';
import { prisma } from '../config/prisma.js';
import { FirecrawlService } from '../services/firecrawlService.js';
import { ReconciliationEngine } from '../services/reconciliationEngine.js';

vi.mock('../config/prisma.js', () => ({
  prisma: {
    auditReport: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    client: {
      findUnique: vi.fn(),
    },
    agentModule: {
      findFirst: vi.fn(),
    },
    systemLog: {
      create: vi.fn().mockResolvedValue({ id: 'log-1' }),
    },
    violation: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi.fn().mockImplementation(async (cb: any) => {
      const mockTx = {
        auditReport: { update: vi.fn().mockResolvedValue({}) },
        violation: {
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          createMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      };
      return await cb(mockTx);
    }),
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
    reconcileStructured: vi.fn(),
  },
}));

describe('Auditoria Concluída & Telemetria de E-mail (@backend-specialist)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('EmailService - Validação da API Resend', () => {
    it('deve retornar success: true no modo test', async () => {
      const res = await EmailService.sendAuditReportCompletedEmail(
        'clinica@exemplo.com.br',
        'Clínica Médica Central',
        {
          id: 'rep-001',
          targetUrl: 'https://clinica.com.br',
          score: 95,
          verdict: 'CONFORME',
          summary: 'Laudo em perfeita conformidade.',
          violationsCount: 0,
        }
      );

      expect(res.success).toBe(true);
      expect(res.mocked).toBe(true);
    });

    it('deve interceptar erro da API do Resend e retornar success: false com a mensagem de erro', async () => {
      const mockResend = {
        emails: {
          send: vi.fn().mockResolvedValue({
            data: null,
            error: {
              name: 'validation_error',
              message: 'You can only send to your own email address while in sandbox.',
            },
          }),
        },
      };

      (EmailService as any).resendClient = mockResend;

      const res = await EmailService.sendAuditReportCompletedEmail(
        'destinatario@outro.com.br',
        'Clínica Teste',
        {
          id: 'rep-002',
          targetUrl: 'https://clinica.com.br',
          score: 80,
          verdict: 'PARCIALMENTE_CONFORME',
        }
      );

      expect(res.success).toBe(false);
      expect(res.error).toContain('You can only send to your own email address');
      (EmailService as any).resendClient = null;
    });

    it('deve retornar messageId quando o Resend confirmar o envio com sucesso', async () => {
      const mockResend = {
        emails: {
          send: vi.fn().mockResolvedValue({
            data: { id: 'msg_resend_999' },
            error: null,
          }),
        },
      };

      (EmailService as any).resendClient = mockResend;

      const res = await EmailService.sendAuditReportCompletedEmail(
        'doutor@clinica.com.br',
        'Clínica Odonto & Médica',
        {
          id: 'rep-003',
          targetUrl: 'https://clinica.com.br',
          score: 100,
          verdict: 'CONFORME',
        }
      );

      expect(res.success).toBe(true);
      expect(res.messageId).toBe('msg_resend_999');
      (EmailService as any).resendClient = null;
    });
  });

  describe('AuditExecutionService - Pipeline de Notificação e Telemetria', () => {
    const baseMockReport = {
      id: 'rep-audit-100',
      targetUrl: 'https://clinica-sp.med.br',
      clientId: 'client-123',
    };

    const baseReconOutput = {
      audit_id: 'rep-audit-100',
      risk_level: 'BAIXO',
      confidence: 0.95,
      verdict: 'CONFORME',
      score: 98,
      summary: 'Auditoria concluída com sucesso.',
      findings: [],
      violations: [],
      sourcesUsed: ['Normas Ativas'],
    };

    beforeEach(() => {
      vi.mocked(prisma.auditReport.update).mockResolvedValue(baseMockReport as any);
      vi.mocked(FirecrawlService.scrape).mockResolvedValue({
        markdown: '# Home da Clínica',
        contentHash: 'hash-123',
        source: 'FIRECRAWL',
        savedRecordId: 'scrape-1',
      } as any);
      vi.mocked(ReconciliationEngine.resolveAgentContext).mockResolvedValue({
        activeNorms: [],
        resolvedDbNorms: [],
      } as any);
      vi.mocked(ReconciliationEngine.reconcile).mockResolvedValue({
        verdict: 'CONFORME',
        score: 98,
        summary: 'Auditoria concluída com sucesso.',
        violations: [],
        sourcesUsed: ['Normas Ativas'],
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        aiModelUsed: 'gemini-3.5-flash',
        groundingScore: 100,
        hallucinationRisk: 'NONE',
        guardrailsApplied: false,
        hallucinationsInterceptedCount: 0,
      } as any);
      vi.mocked(ReconciliationEngine.reconcileStructured).mockResolvedValue(baseReconOutput as any);
    });

    it('deve enviar e-mail para o cliente e registrar [EMAIL_SUCCESS] na telemetria', async () => {
      vi.mocked(prisma.client.findUnique).mockResolvedValue({
        id: 'client-123',
        name: 'Clínica Dermatológica Alpha',
        email: 'contato@alpha.med.br',
        users: [{ email: 'admin@alpha.med.br' }],
      } as any);

      vi.spyOn(EmailService, 'sendAuditReportCompletedEmail').mockResolvedValue({
        success: true,
        messageId: 'resend_email_id_555',
      });

      const res = await AuditExecutionService.execute({
        auditReportId: 'rep-audit-100',
        clientId: 'client-123',
        targetUrl: 'https://clinica-sp.med.br',
      });

      expect(res.success).toBe(true);

      // Deve ter despachado para os e-mails da clínica e usuário
      expect(EmailService.sendAuditReportCompletedEmail).toHaveBeenCalledWith(
        'contato@alpha.med.br',
        'Clínica Dermatológica Alpha',
        expect.anything()
      );

      // Deve ter gravado log de sucesso na telemetria (SystemLog)
      const systemLogCalls = vi.mocked(prisma.systemLog.create).mock.calls;
      const emailSuccessLog = systemLogCalls.find(call =>
        call[0].data.message?.includes('[EMAIL_SUCCESS]') &&
        call[0].data.message?.includes('contato@alpha.med.br')
      );
      expect(emailSuccessLog).toBeDefined();
      expect(emailSuccessLog?.[0].data.level).toBe('INFO');
      expect(emailSuccessLog?.[0].data.module).toBe('EMAIL_NOTIFICATION');
    });

    it('deve registrar [EMAIL_WARN] na telemetria quando o cliente não tiver e-mail cadastrado', async () => {
      vi.mocked(prisma.client.findUnique).mockResolvedValue({
        id: 'client-123',
        name: 'Clínica Sem Email',
        email: null,
        users: [],
      } as any);

      const sendEmailSpy = vi.spyOn(EmailService, 'sendAuditReportCompletedEmail');

      const res = await AuditExecutionService.execute({
        auditReportId: 'rep-audit-100',
        clientId: 'client-123',
        targetUrl: 'https://clinica-sp.med.br',
      });

      expect(res.success).toBe(true);
      expect(sendEmailSpy).not.toHaveBeenCalled();

      // Telemetria deve registrar o aviso [EMAIL_WARN]
      const systemLogCalls = vi.mocked(prisma.systemLog.create).mock.calls;
      const emailWarnLog = systemLogCalls.find(call =>
        call[0].data.message?.includes('[EMAIL_WARN]')
      );
      expect(emailWarnLog).toBeDefined();
      expect(emailWarnLog?.[0].data.level).toBe('WARN');
      expect(emailWarnLog?.[0].data.module).toBe('EMAIL_NOTIFICATION');
    });

    it('deve registrar [EMAIL_WARN] na telemetria quando a API de e-mail falhar, sem quebrar o laudo', async () => {
      vi.mocked(prisma.client.findUnique).mockResolvedValue({
        id: 'client-123',
        name: 'Clínica Beta',
        email: 'beta@clinica.com.br',
        users: [],
      } as any);

      vi.spyOn(EmailService, 'sendAuditReportCompletedEmail').mockResolvedValue({
        success: false,
        error: 'API Key inválida ou cota esgotada no Resend',
      });

      const res = await AuditExecutionService.execute({
        auditReportId: 'rep-audit-100',
        clientId: 'client-123',
        targetUrl: 'https://clinica-sp.med.br',
      });

      // A auditoria em si conclui com sucesso
      expect(res.success).toBe(true);

      // O aviso de e-mail deve ser reportado na telemetria
      const systemLogCalls = vi.mocked(prisma.systemLog.create).mock.calls;
      const emailErrorLog = systemLogCalls.find(call =>
        call[0].data.message?.includes('beta@clinica.com.br') &&
        call[0].data.module === 'EMAIL_NOTIFICATION'
      );
      expect(emailErrorLog).toBeDefined();
      expect(emailErrorLog?.[0].data.level).toBe('WARN');
      expect(emailErrorLog?.[0].data.module).toBe('EMAIL_NOTIFICATION');
      expect(emailErrorLog?.[0].data.message).toContain('API Key inválida');
    });

    it('deve resolver o cliente automaticamente pelo laudo quando clientId for omitido nos parâmetros', async () => {
      vi.mocked(prisma.auditReport.update).mockResolvedValue({
        id: 'rep-audit-200',
        clientId: 'client-auto-resolved',
      } as any);

      vi.mocked(prisma.client.findUnique).mockResolvedValue({
        id: 'client-auto-resolved',
        name: 'Clínica Auto Resolvida',
        email: 'auto@clinica.com.br',
        users: [],
      } as any);

      vi.spyOn(EmailService, 'sendAuditReportCompletedEmail').mockResolvedValue({
        success: true,
        messageId: 'msg-auto',
      });

      const res = await AuditExecutionService.execute({
        auditReportId: 'rep-audit-200',
        clientId: '', // Vazio, para forçar resolução automática
        targetUrl: 'https://auto.med.br',
      });

      expect(res.success).toBe(true);
      expect(EmailService.sendAuditReportCompletedEmail).toHaveBeenCalledWith(
        'auto@clinica.com.br',
        'Clínica Auto Resolvida',
        expect.anything()
      );
    });
  });
});
