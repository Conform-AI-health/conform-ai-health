import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { getPaginationParams, buildPaginatedResponse } from '../shared/pagination.js';
import { ReconciliationEngine } from '../services/reconciliationEngine.js';

// Mocks defensivos para isolamento de I/O
vi.mock('../config/prisma.js', () => ({
  prisma: {
    $runCommandRaw: vi.fn().mockResolvedValue({ ok: 1 }),
    systemLog: { create: vi.fn().mockResolvedValue({}) },
    agentModule: {
      count: vi.fn().mockResolvedValue(2),
      findMany: vi.fn().mockResolvedValue([
        { id: '1', name: 'Agente CFM', code: 'CFM-01', enabled: true },
        { id: '2', name: 'Agente LGPD', code: 'LGPD-01', enabled: true },
      ]),
    },
  },
}));

vi.mock('../config/redis.js', () => ({
  getRedisConnection: vi.fn().mockReturnValue({ ping: vi.fn().mockResolvedValue('PONG') }),
  auditQueue: { count: vi.fn().mockResolvedValue(0) },
}));

import { createApp } from '../app.js';

describe('Testes de Paginação e Endpoint de Teste do Modelo de IA', () => {
  const app = createApp();
  const adminToken = jwt.sign(
    { userId: 'admin-1', email: 'admin@conformia.med.br', role: 'ADMIN' },
    env.JWT_SECRET
  );

  describe('Helper getPaginationParams e buildPaginatedResponse', () => {
    it('deve extrair valores padrão quando query params não forem fornecidos', () => {
      const mockReq = { query: {} } as any;
      const params = getPaginationParams(mockReq, 10, 100);

      expect(params.page).toBe(1);
      expect(params.limit).toBe(10);
      expect(params.skip).toBe(0);
    });

    it('deve limitar o valor máximo de limit para evitar ataques de exaustão de memória (OWASP DoS)', () => {
      const mockReq = { query: { page: '2', limit: '9999' } } as any;
      const params = getPaginationParams(mockReq, 10, 100);

      expect(params.page).toBe(2);
      expect(params.limit).toBe(100);
      expect(params.skip).toBe(100);
    });

    it('deve construir resposta paginada estruturada corretamente', () => {
      const items = [{ id: 'a' }, { id: 'b' }];
      const paginated = buildPaginatedResponse(items, 25, { page: 2, limit: 10, skip: 10 });

      expect(paginated.data).toHaveLength(2);
      expect(paginated.pagination.total).toBe(25);
      expect(paginated.pagination.page).toBe(2);
      expect(paginated.pagination.limit).toBe(10);
      expect(paginated.pagination.totalPages).toBe(3);
    });
  });

  describe('ReconciliationEngine.testModelResponse', () => {
    it('deve responder com status, latência e diagnóstico no modo heurístico', async () => {
      ReconciliationEngine.setActiveProvider('heuristic');
      const result = await ReconciliationEngine.testModelResponse();

      expect(result.provider).toBe('heuristic');
      expect(result.model).toBe('regex-heuristic-v1');
      expect(result.status).toBe('ONLINE');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.response).toContain('Motor Heurístico Deontológico Operacional');
    });
  });

  describe('POST /api/v1/system/test-ai', () => {
    it('deve bloquear requisição sem autenticação com HTTP 401', async () => {
      const res = await request(app).post('/api/v1/system/test-ai');
      expect(res.status).toBe(401);
    });

    it('deve executar teste de integridade com token ADMIN e responder HTTP 200', async () => {
      const res = await request(app)
        .post('/api/v1/system/test-ai')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ prompt: 'Ping de teste' });

      expect(res.status).toBe(200);
      expect(res.body.provider).toBeDefined();
      expect(res.body.status).toBeDefined();
      expect(res.body.latencyMs).toBeDefined();
      expect(res.body.response).toBeDefined();
    });
  });
});
