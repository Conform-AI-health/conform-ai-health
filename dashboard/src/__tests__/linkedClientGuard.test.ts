import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

vi.mock('../config/prisma.js', () => ({
  prisma: {
    $runCommandRaw: vi.fn().mockResolvedValue({ ok: 1 }),
    systemLog: { create: vi.fn().mockResolvedValue({}) },
    user: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
    client: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock('../config/redis.js', () => ({
  getRedisConnection: vi.fn().mockReturnValue({ ping: vi.fn().mockResolvedValue('PONG') }),
  auditQueue: { count: vi.fn().mockResolvedValue(0) },
}));

import { createApp } from '../app.js';
import { env } from '../config/env.js';
import { requireLinkedClient } from '../middlewares/auth.js';

const signToken = (payload: Record<string, unknown>) => jwt.sign(payload, env.JWT_SECRET, { expiresIn: '5m' });

const mockRes = () =>
  ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  }) as unknown as Response;

describe('Guarda de vínculo obrigatório para usuários CLIENT (requireLinkedClient)', () => {
  const app = createApp();
  const unlinkedClientToken = signToken({
    userId: 'user-sem-clinica',
    email: 'cadastro.publico@exemplo.com',
    role: 'CLIENT',
    clientId: null,
  });

  it.each([
    ['POST', '/api/v1/norms/search'],
    ['GET', '/api/v1/norms/catalog'],
    ['GET', '/api/v1/norms'],
    ['GET', '/api/v1/reports'],
    ['GET', '/api/v1/agents'],
    ['POST', '/api/v1/agents/abc/run'],
    ['GET', '/api/v1/scraped-pages'],
    ['GET', '/api/v1/clients/portal/me'],
  ])('%s %s deve retornar 403 CLIENT_NOT_LINKED para CLIENT sem clínica', async (method, path) => {
    const req = method === 'POST' ? request(app).post(path).send({ query: 'teste' }) : request(app).get(path);
    const res = await req.set('Authorization', `Bearer ${unlinkedClientToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CLIENT_NOT_LINKED');
  });

  it('não deve bloquear /auth/me para CLIENT sem clínica (necessário para exibir o estado da conta)', async () => {
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${unlinkedClientToken}`);

    expect(res.body.code).not.toBe('CLIENT_NOT_LINKED');
  });

  it('deve permitir CLIENT com clínica vinculada', () => {
    const next = vi.fn() as NextFunction;
    const res = mockRes();
    const req = { user: { userId: 'u1', email: 'a@b.com', role: 'CLIENT', clientId: 'client-aaa' } } as unknown as Request;

    requireLinkedClient(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it.each(['ADMIN', 'AUDITOR'])('deve permitir %s sem clientId', (role) => {
    const next = vi.fn() as NextFunction;
    const res = mockRes();
    const req = { user: { userId: 'u1', email: 'a@b.com', role, clientId: null } } as unknown as Request;

    requireLinkedClient(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

describe('Formato de erro de validação Zod (v4)', () => {
  const app = createApp();

  it('deve retornar VALIDATION_ERROR com details por campo', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      name: 'Teste',
      email: 'email-invalido',
      password: 'SenhaForte123!',
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.details).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'email' })]));
  });
});
