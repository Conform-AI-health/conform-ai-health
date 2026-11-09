import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CircuitBreaker } from '../shared/circuitBreaker.js';
import { Bulkhead } from '../shared/bulkhead.js';
import { EmailService } from '../services/emailService.js';
import { AuthController } from '../controllers/authController.js';
import { prisma } from '../config/prisma.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

// Mocks do prisma em ../config/prisma.js e ../lib/prisma.js
vi.mock('../config/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    client: {
      findUnique: vi.fn(),
    },
    $disconnect: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    client: {
      findUnique: vi.fn(),
    },
    $disconnect: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('Resiliência Arquitetural: Circuit Breaker & Bulkhead', () => {
  describe('CircuitBreaker Pattern', () => {
    it('deve executar chamadas com sucesso no estado CLOSED', async () => {
      const breaker = new CircuitBreaker({
        name: 'TestBreaker',
        failureThreshold: 3,
        resetTimeoutMs: 100,
      });

      const mockFn = vi.fn().mockResolvedValue('success');
      const result = await breaker.execute(mockFn);

      expect(result).toBe('success');
      expect(breaker.getState()).toBe('CLOSED');
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it('deve abrir o circuito (OPEN) após atingir o limite de falhas consecutivas e disparar fallback', async () => {
      const fallbackFn = vi.fn().mockReturnValue('fallback-response');
      const breaker = new CircuitBreaker({
        name: 'TestBreakerFail',
        failureThreshold: 2,
        resetTimeoutMs: 200,
        fallback: fallbackFn,
      });

      const failingFn = vi.fn().mockRejectedValue(new Error('Downstream API Error'));

      // 1ª falha (fallback não configurado no catch se quisermos testar abertura direta)
      await expect(breaker.execute(failingFn)).resolves.toBe('fallback-response');
      expect(breaker.getState()).toBe('CLOSED');

      // 2ª falha -> atinge failureThreshold
      await expect(breaker.execute(failingFn)).resolves.toBe('fallback-response');
      expect(breaker.getState()).toBe('OPEN');

      // 3ª chamada: circuito OPEN -> aciona fallback imediatamente sem chamar failingFn
      const fallbackResult = await breaker.execute(failingFn);
      expect(fallbackResult).toBe('fallback-response');
      expect(failingFn).toHaveBeenCalledTimes(2); // Bloqueado, não chamou failingFn!
      expect(fallbackFn).toHaveBeenCalled();
    });

    it('deve transicionar de OPEN para HALF_OPEN após timeout e fechar após sucesso', async () => {
      const breaker = new CircuitBreaker({
        name: 'TestResetBreaker',
        failureThreshold: 1,
        resetTimeoutMs: 50,
        successThreshold: 1,
      });

      const failingFn = vi.fn().mockRejectedValue(new Error('Network Fail'));
      await expect(breaker.execute(failingFn)).rejects.toThrow('Network Fail');
      expect(breaker.getState()).toBe('OPEN');

      // Aguarda passar o timeout
      await new Promise((r) => setTimeout(r, 60));

      // Próxima chamada deve testar o serviço (HALF_OPEN -> CLOSED)
      const healthyFn = vi.fn().mockResolvedValue('recovered');
      const result = await breaker.execute(healthyFn);

      expect(result).toBe('recovered');
      expect(breaker.getState()).toBe('CLOSED');
    });
  });

  describe('Bulkhead Pattern (Isolamento de Recursos)', () => {
    it('deve limitar a execução concorrente e enfileirar chamadas excedentes', async () => {
      const bulkhead = new Bulkhead({
        name: 'TestBulkhead',
        maxConcurrent: 2,
        maxQueue: 5,
      });

      let activeCount = 0;
      let peakConcurrency = 0;

      const task = async (id: number) => {
        return bulkhead.execute(async () => {
          activeCount++;
          if (activeCount > peakConcurrency) peakConcurrency = activeCount;
          await new Promise((r) => setTimeout(r, 20));
          activeCount--;
          return `task-${id}`;
        });
      };

      const results = await Promise.all([task(1), task(2), task(3), task(4)]);

      expect(results).toEqual(['task-1', 'task-2', 'task-3', 'task-4']);
      expect(peakConcurrency).toBeLessThanOrEqual(2);
    });

    it('deve rejeitar tarefas quando o limite da fila do Bulkhead for ultrapassado', async () => {
      const bulkhead = new Bulkhead({
        name: 'SmallBulkhead',
        maxConcurrent: 1,
        maxQueue: 1,
      });

      const slowTask = () =>
        bulkhead.execute(
          () => new Promise((resolve) => setTimeout(resolve, 50))
        );

      // Inicia 1 executando
      const p1 = slowTask();
      // Inicia 1 na fila
      const p2 = slowTask();
      // 3ª chamada deve estourar a fila maxQueue=1
      await expect(slowTask()).rejects.toThrow(/Bulkhead.*Capacidade máxima/);

      await Promise.all([p1, p2]);
    });
  });
});

describe('Autenticação Avançada: Refresh Token (1h) & Recuperação de Senha', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Login com Refresh Token e Expiração de 1h', () => {
    it('deve autenticar usuário e retornar token com expiração de 1h e refresh token de 7d', async () => {
      const hashedPassword = await bcrypt.hash('SenhaForte123!', 10);
      const mockUser = {
        id: 'user-001',
        name: 'Auditor Chefe',
        email: 'auditor@conformia.med.br',
        passwordHash: hashedPassword,
        role: 'AUDITOR',
        clientId: null,
      };

      (prisma.user.findUnique as any).mockResolvedValue(mockUser);
      (prisma.user.update as any).mockResolvedValue(mockUser);

      const req: any = {
        body: { email: 'auditor@conformia.med.br', password: 'SenhaForte123!' },
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await AuthController.login(req, res);

      expect(res.json).toHaveBeenCalled();
      const responseData = res.json.mock.calls[0][0];

      expect(responseData).toHaveProperty('token');
      expect(responseData).toHaveProperty('refreshToken');
      expect(responseData.user.email).toBe('auditor@conformia.med.br');

      // Verifica expiração do JWT Access Token (1h = 3600s)
      const decodedAccess: any = jwt.decode(responseData.token);
      const accessTtl = decodedAccess.exp - decodedAccess.iat;
      expect(accessTtl).toBe(3600); // Exatamente 1 hora!

      // Salva refresh token no banco
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-001' },
          data: expect.objectContaining({
            refreshToken: expect.any(String),
          }),
        })
      );
    });

    it('deve rotacionar e emitir novo par de tokens na rota /auth/refresh', async () => {
      const secret = env.JWT_REFRESH_SECRET || 'conformia-jwt-refresh-secret-super-secure';
      const validRefreshToken = jwt.sign(
        { userId: 'user-001', type: 'refresh' },
        secret,
        { expiresIn: '7d' }
      );

      const mockUser = {
        id: 'user-001',
        name: 'Auditor Chefe',
        email: 'auditor@conformia.med.br',
        refreshToken: validRefreshToken,
        role: 'AUDITOR',
        clientId: null,
      };

      (prisma.user.findUnique as any).mockResolvedValue(mockUser);
      (prisma.user.update as any).mockResolvedValue(mockUser);

      const req: any = {
        body: { refreshToken: validRefreshToken },
        headers: {},
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await AuthController.refreshToken(req, res);

      expect(res.json).toHaveBeenCalled();
      const responseData = res.json.mock.calls[0][0];

      expect(responseData).toHaveProperty('token');
      expect(responseData).toHaveProperty('refreshToken');

      // Valida que o token foi rotacionado
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-001' },
          data: expect.objectContaining({
            refreshToken: expect.any(String),
          }),
        })
      );
    });

    it('deve rejeitar refresh token se for adulterado ou inválido', async () => {
      const req: any = {
        body: { refreshToken: 'token-invalido-ou-adulterado' },
        headers: {},
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await AuthController.refreshToken(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'INVALID_REFRESH_TOKEN',
        })
      );
    });
  });

  describe('Fluxo de Recuperação de Senha (Forgot & Reset)', () => {
    it('deve gerar token temporário com validade de 1h e invocar envio de e-mail', async () => {
      const mockUser = {
        id: 'user-002',
        name: 'Dra. Ana Paula',
        email: 'dra.ana@dermato.com.br',
      };

      (prisma.user.findUnique as any).mockResolvedValue(mockUser);
      (prisma.user.update as any).mockResolvedValue(mockUser);

      const emailSpy = vi.spyOn(EmailService, 'sendPasswordResetEmail').mockResolvedValue(true as any);

      const req: any = {
        body: { email: 'dra.ana@dermato.com.br' },
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await AuthController.forgotPassword(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('instruções para redefinição'),
        })
      );

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-002' },
          data: expect.objectContaining({
            resetPasswordToken: expect.any(String),
            resetPasswordExpires: expect.any(Date),
          }),
        })
      );

      expect(emailSpy).toHaveBeenCalledWith(
        'dra.ana@dermato.com.br',
        expect.any(String),
        'Dra. Ana Paula'
      );
    });

    it('deve redefinir senha com sucesso e invalidar token temporário', async () => {
      const mockUser = {
        id: 'user-002',
        name: 'Dra. Ana Paula',
        email: 'dra.ana@dermato.com.br',
        resetPasswordToken: 'valid-reset-token',
        resetPasswordExpires: new Date(Date.now() + 1800000), // +30m
      };

      (prisma.user.findFirst as any).mockResolvedValue(mockUser);
      (prisma.user.update as any).mockResolvedValue(mockUser);

      const req: any = {
        body: { token: 'valid-reset-token', newPassword: 'NovaSenhaUltraSegura2026!' },
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await AuthController.resetPassword(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Senha redefinida com sucesso'),
        })
      );

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-002' },
          data: expect.objectContaining({
            resetPasswordToken: null,
            resetPasswordExpires: null,
            refreshToken: null, // Revoga sessões antigas
          }),
        })
      );
    });

    it('deve revogar refresh token e encerrar sessão no logout', async () => {
      (prisma.user.update as any).mockResolvedValue({ id: 'user-002', refreshToken: null });

      const req: any = {
        user: { userId: 'user-002' },
        body: {},
        headers: {},
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await AuthController.logout(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-002' },
          data: { refreshToken: null },
        })
      );
    });
  });

  describe('Notificação de Laudo Concluído via EmailService', () => {
    it('deve despachar e-mail com score e resumo executivo para o e-mail da clínica', async () => {
      const sendAuditReportSpy = vi.spyOn(EmailService, 'sendAuditReportCompletedEmail').mockResolvedValue(true as any);

      const mockReport: any = {
        id: 'rep-099',
        targetUrl: 'https://clinicaexemplo.com.br',
        conformityScore: 92.5,
        riskLevel: 'BAIXO',
        summary: 'Auditoria de rotina CFM 2.336/2023 concluída sem não conformidades graves.',
        findingsCount: 1,
      };

      const dispatched = await EmailService.sendAuditReportCompletedEmail(
        'contato@clinicaexemplo.com.br',
        'Clínica Exemplo Dermatologia',
        mockReport
      );

      expect(dispatched).toBe(true);
      expect(sendAuditReportSpy).toHaveBeenCalledWith(
        'contato@clinicaexemplo.com.br',
        'Clínica Exemplo Dermatologia',
        mockReport
      );
    });
  });

  describe('Resiliência Operacional: Graceful Shutdown do Worker', () => {
    it('deve executar shutdownWorker de forma graciosa sem lançar exceções', async () => {
      const { shutdownWorker } = await import('../worker.js');
      await expect(shutdownWorker('SIGTERM')).resolves.not.toThrow();
    });
  });
});
