import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../config/redis.js', () => ({
  redis: {
    ping: vi.fn().mockResolvedValue('PONG'),
    on: vi.fn(),
  },
  getRedisConnection: vi.fn().mockReturnValue({
    on: vi.fn(),
    ping: vi.fn().mockResolvedValue('PONG'),
  }),
  auditQueue: {
    add: vi.fn().mockResolvedValue({ id: 'job-mock-repeatable' }),
    getRepeatableJobs: vi.fn().mockResolvedValue([]),
    removeRepeatableByKey: vi.fn().mockResolvedValue(true),
    count: vi.fn().mockResolvedValue(0),
    getJobCounts: vi.fn().mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0 }),
  },
}));

import { AuditSchedulerService } from '../services/auditSchedulerService.js';

describe('AuditSchedulerService — Agendamento Contínuo & Validação Cron', () => {
  beforeEach(() => {
    // Limpa agendamentos em memória antes de cada teste
    AuditSchedulerService.shutdown();
  });

  describe('Validação Sintática de Expressões Cron', () => {
    it('deve aceitar expressões cron UNIX válidas de 5 campos', () => {
      expect(AuditSchedulerService.isValidCron('0 */6 * * *')).toBe(true);
      expect(AuditSchedulerService.isValidCron('0 * * * *')).toBe(true);
      expect(AuditSchedulerService.isValidCron('0 3 * * *')).toBe(true);
      expect(AuditSchedulerService.isValidCron('*/15 * * * *')).toBe(true);
      expect(AuditSchedulerService.isValidCron('30 4 1 * *')).toBe(true);
      expect(AuditSchedulerService.isValidCron('0 0 * * 0')).toBe(true);
    });

    it('deve rejeitar expressões inválidas, vazias ou mal formatadas', () => {
      expect(AuditSchedulerService.isValidCron('')).toBe(false);
      expect(AuditSchedulerService.isValidCron('not-a-cron')).toBe(false);
      expect(AuditSchedulerService.isValidCron('* * *')).toBe(false); // apenas 3 campos
      expect(AuditSchedulerService.isValidCron('60 * * * *')).toBe(false); // minuto 60 é inválido
      expect(AuditSchedulerService.isValidCron('* * 32 * *')).toBe(false); // dia 32 é inválido
    });
  });

  describe('Cálculo da Próxima Execução (getNextRunDate)', () => {
    it('deve calcular uma data futura válida para cron periódico', () => {
      const nextRun = AuditSchedulerService.getNextRunDate('0 */6 * * *');
      expect(nextRun).toBeInstanceOf(Date);
      expect(nextRun!.getTime()).toBeGreaterThan(Date.now());
    });

    it('deve retornar null para expressão inválida', () => {
      const nextRun = AuditSchedulerService.getNextRunDate('expressao-invalida');
      expect(nextRun).toBeNull();
    });
  });

  describe('Gerenciamento de Agendamentos em Memória', () => {
    it('deve registrar e sincronizar agendamento para agente habilitado com URL', () => {
      const mockAgent = {
        id: 'agent_123',
        name: 'Auditor Teste CFM',
        targetUrl: 'https://exemplo.med.br',
        cronSchedule: '0 */6 * * *',
        enabled: true,
      };

      AuditSchedulerService.syncAgentSchedule(mockAgent);

      const active = AuditSchedulerService.getActiveSchedules();
      expect(active.length).toBe(1);
      expect(active[0].agentId).toBe('agent_123');
      expect(active[0].agentName).toBe('Auditor Teste CFM');
      expect(active[0].cronSchedule).toBe('0 */6 * * *');
      expect(active[0].nextRunAt).toBeInstanceOf(Date);
    });

    it('deve remover agendamento quando solicitado ou quando agente desabilitado', () => {
      const mockAgent = {
        id: 'agent_456',
        name: 'Auditor Inativo',
        targetUrl: 'https://exemplo2.med.br',
        cronSchedule: '0 3 * * *',
        enabled: true,
      };

      AuditSchedulerService.syncAgentSchedule(mockAgent);
      expect(AuditSchedulerService.getActiveSchedules().length).toBe(1);

      // Desabilita agente
      AuditSchedulerService.syncAgentSchedule({ ...mockAgent, enabled: false });
      expect(AuditSchedulerService.getActiveSchedules().length).toBe(0);

      // Re-adiciona e remove explicitamente
      AuditSchedulerService.syncAgentSchedule({ ...mockAgent, enabled: true });
      expect(AuditSchedulerService.getActiveSchedules().length).toBe(1);

      AuditSchedulerService.removeAgentSchedule('agent_456');
      expect(AuditSchedulerService.getActiveSchedules().length).toBe(0);
    });

    it('não deve registrar agente sem URL alvo configurada', () => {
      const mockAgent = {
        id: 'agent_no_url',
        name: 'Auditor Sem URL',
        targetUrl: null,
        cronSchedule: '0 */6 * * *',
        enabled: true,
      };

      AuditSchedulerService.syncAgentSchedule(mockAgent);
      expect(AuditSchedulerService.getActiveSchedules().length).toBe(0);
    });
  });
});
