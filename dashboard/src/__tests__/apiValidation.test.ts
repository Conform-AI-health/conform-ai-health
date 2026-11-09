import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// Mocks defensivos para garantir isolamento 100% livre de I/O em testes unitários
vi.mock('../config/prisma.js', () => ({
  prisma: {
    $runCommandRaw: vi.fn().mockResolvedValue({ ok: 1 }),
    systemLog: { create: vi.fn().mockResolvedValue({}) },
    user: { findUnique: vi.fn(), create: vi.fn() },
    client: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock('../config/redis.js', () => ({
  getRedisConnection: vi.fn().mockReturnValue({ ping: vi.fn().mockResolvedValue('PONG') }),
  auditQueue: { count: vi.fn().mockResolvedValue(0) },
}));

import { createApp } from '../app.js';

describe('Validação Zod e Endpoints da API REST', () => {
  const app = createApp();

  it('GET /health deve responder com HTTP 200 e status UP', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('UP');
  });

  it('POST /api/v1/auth/register deve rejeitar payload com e-mail inválido com HTTP 400', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'email-invalido-sem-arroba',
      password: '123',
      name: 'A',
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.details).toBeDefined();
  });

  it('GET /api/v1/clients sem token deve retornar HTTP 401 Unauthorized', async () => {
    const res = await request(app).get('/api/v1/clients');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_TOKEN_MISSING');
  });

  it('GET /api/v1/system/status deve responder com informações do ecossistema', async () => {
    const res = await request(app).get('/api/v1/system/status');
    expect(res.status).toBe(200);
    expect(res.body.service).toContain('ConformIA');
    expect(res.body.aiProvider).toBeDefined();
    expect(res.body.database).toBeDefined();
    expect(res.body.redis).toBeDefined();
  });
});
