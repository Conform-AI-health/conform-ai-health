import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

// Mocks defensivos de I/O com vi.hoisted para suporte a hoisting
const { mockModels } = vi.hoisted(() => ({
  mockModels: [
    {
      id: 'model-1',
      name: 'Gemini 2.0 Flash',
      provider: 'gemini',
      modelId: 'gemini-2.0-flash',
      apiKey: 'AIzaSySecretApiKey1234',
      isActive: true,
      isDefault: true,
      temperature: 0.2,
      maxTokens: 2048,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'model-2',
      name: 'Ollama Qwen 2.5',
      provider: 'ollama',
      modelId: 'qwen2.5:7b',
      baseUrl: 'http://localhost:11434',
      apiKey: null,
      isActive: false,
      isDefault: false,
      temperature: 0.2,
      maxTokens: 2048,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
}));

vi.mock('../config/prisma.js', () => ({
  prisma: {
    $runCommandRaw: vi.fn().mockResolvedValue({ ok: 1 }),
    systemLog: { create: vi.fn().mockResolvedValue({}) },
    aiModelConfig: {
      count: vi.fn().mockResolvedValue(2),
      findMany: vi.fn().mockResolvedValue(mockModels),
      findUnique: vi.fn().mockImplementation(({ where }) => {
        const found = mockModels.find((m) => m.id === where.id);
        return Promise.resolve(found || null);
      }),
      create: vi.fn().mockImplementation(({ data }) => {
        return Promise.resolve({ id: 'model-new', ...data, createdAt: new Date(), updatedAt: new Date() });
      }),
      update: vi.fn().mockImplementation(({ where, data }) => {
        return Promise.resolve({ id: where.id, ...data });
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      delete: vi.fn().mockResolvedValue({ id: 'model-2' }),
    },
    $transaction: vi.fn().mockImplementation((promises) => Promise.all(promises)),
  },
}));

vi.mock('../config/redis.js', () => ({
  getRedisConnection: vi.fn().mockReturnValue({ ping: vi.fn().mockResolvedValue('PONG') }),
  auditQueue: { count: vi.fn().mockResolvedValue(0) },
}));

import { createApp } from '../app.js';

describe('CRUD de Modelos de Inteligência Artificial no MongoDB', () => {
  const app = createApp();

  const adminToken = jwt.sign(
    { userId: 'admin-1', email: 'admin@conformia.med.br', role: 'ADMIN' },
    env.JWT_SECRET
  );

  const clientToken = jwt.sign(
    { userId: 'client-1', email: 'clinica@med.br', role: 'CLIENT' },
    env.JWT_SECRET
  );

  it('GET /api/v1/models sem token deve retornar HTTP 401 Unauthorized', async () => {
    const res = await request(app).get('/api/v1/models');
    expect(res.status).toBe(401);
  });

  it('GET /api/v1/models com usuário CLIENT deve retornar HTTP 403 Forbidden (RBAC)', async () => {
    const res = await request(app)
      .get('/api/v1/models')
      .set('Authorization', `Bearer ${clientToken}`);
    expect(res.status).toBe(403);
  });

  it('GET /api/v1/models com token ADMIN deve listar modelos e mascarar chaves de API', async () => {
    const res = await request(app)
      .get('/api/v1/models')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0].apiKey).toBe('••••••••1234'); // Mascaramento de segurança
    expect(res.body.pagination).toBeDefined();
  });

  it('POST /api/v1/models deve cadastrar novo modelo com HTTP 201', async () => {
    const res = await request(app)
      .post('/api/v1/models')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Gemini 1.5 Pro',
        provider: 'gemini',
        modelId: 'gemini-1.5-pro',
        temperature: 0.1,
        maxTokens: 4096,
        description: 'Modelo analítico avançado',
      });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Gemini 1.5 Pro');
    expect(res.body.provider).toBe('gemini');
  });

  it('POST /api/v1/models/:id/activate deve ativar modelo em runtime', async () => {
    const res = await request(app)
      .post('/api/v1/models/model-2/activate')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('ativado com sucesso');
  });

  it('DELETE /api/v1/models/:id deve bloquear exclusão do modelo atualmente ativo (HTTP 400)', async () => {
    const res = await request(app)
      .delete('/api/v1/models/model-1') // model-1 está ativo
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ACTIVE_MODEL_CANNOT_BE_DELETED');
  });
});
