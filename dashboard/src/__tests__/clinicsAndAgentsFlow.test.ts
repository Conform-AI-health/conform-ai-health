import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

// Mocks com vi.hoisted
const { mockClients, mockAgents, mockModels } = vi.hoisted(() => ({
  mockClients: [
    {
      id: 'client-1',
      name: 'ProntoMed Digital Saúde Ltda',
      tradeName: 'ProntoMed Digital',
      cnpj: '00.000.000/0001-00',
      status: 'ATIVO',
      email: 'compliance@prontomed.com.br',
      phone: '(11) 98765-4321',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
  mockAgents: [
    {
      id: 'agent-1',
      name: 'Auditor Deontológico CFM',
      code: 'cfm-publicidade-prontomed',
      description: 'Varredura e auditoria deontológica de canais digitais',
      clientId: 'client-1',
      regulatoryFramework: 'CFM (Resolução 2.336/2023)',
      cronSchedule: '0 */6 * * *',
      enabled: true,
      extractionMode: 'CHEERIO',
      targetUrl: 'https://prontomed.com.br',
      rulesCount: 12,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
  mockModels: [
    {
      id: 'model-gemini',
      name: 'Google Gemini 2.0 Flash',
      provider: 'gemini',
      modelId: 'gemini-2.0-flash',
      apiKey: 'AIzaSySecret123',
      isActive: true,
      isDefault: true,
      temperature: 0.2,
      maxTokens: 2048,
    },
    {
      id: 'model-heuristic',
      name: 'Motor Heurístico Deontológico',
      provider: 'heuristic',
      modelId: 'heuristic-rules-v1',
      apiKey: null,
      isActive: false,
      isDefault: false,
      temperature: 0.0,
      maxTokens: 1024,
    },
  ],
}));

vi.mock('../config/prisma.js', () => ({
  prisma: {
    $runCommandRaw: vi.fn().mockResolvedValue({ ok: 1 }),
    systemLog: { create: vi.fn().mockResolvedValue({}) },
    client: {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue(mockClients),
      findUnique: vi.fn().mockImplementation(({ where }) => {
        const found = mockClients.find((c) => c.id === where.id);
        return Promise.resolve(found || null);
      }),
      create: vi.fn().mockImplementation(({ data }) => {
        return Promise.resolve({ id: 'client-new', ...data, createdAt: new Date(), updatedAt: new Date() });
      }),
    },
    agentModule: {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue(mockAgents),
      findUnique: vi.fn().mockImplementation(({ where }) => {
        const found = mockAgents.find((a) => a.id === where.id || a.code === where.code);
        return Promise.resolve(found || null);
      }),
      create: vi.fn().mockImplementation(({ data }) => {
        return Promise.resolve({ id: 'agent-new', ...data, createdAt: new Date(), updatedAt: new Date() });
      }),
    },
    aiModelConfig: {
      count: vi.fn().mockResolvedValue(2),
      findMany: vi.fn().mockResolvedValue(mockModels),
      findUnique: vi.fn().mockImplementation(({ where }) => {
        const found = mockModels.find((m) => m.id === where.id);
        return Promise.resolve(found || null);
      }),
      update: vi.fn().mockImplementation(({ where, data }) => {
        return Promise.resolve({ id: where.id, ...data });
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: vi.fn().mockImplementation((promises) => Promise.all(promises)),
  },
}));

vi.mock('../config/redis.js', () => ({
  redis: {
    ping: vi.fn().mockResolvedValue('PONG'),
    on: vi.fn(),
  },
  auditQueue: {
    add: vi.fn().mockResolvedValue({ id: 'job-123' }),
    getJobCounts: vi.fn().mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0 }),
  },
}));

import { createApp } from '../app.js';

describe('Fluxos de Cadastro e Gestão de Modelos de IA', () => {
  const app = createApp();

  const adminToken = jwt.sign(
    { userId: 'admin-id', role: 'ADMIN', email: 'admin@conform.ai' },
    env.JWT_SECRET || 'conform-secret-key-123',
    { expiresIn: '1h' }
  );

  describe('1. Cadastro de Cliente Regulado (Clínica Médica)', () => {
    it('deve cadastrar uma clínica médica com os campos essenciais do onboarding', async () => {
      const payload = {
        name: 'Clínica CardioVida Digital Ltda',
        tradeName: 'CardioVida',
        cnpj: '12.345.678/0001-90',
        status: 'ATIVO',
        email: 'compliance@cardiovida.med.br',
        phone: '(11) 97654-3210',
      };

      const res = await request(app)
        .post('/api/v1/clients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.message).toContain('Clínica cadastrada com sucesso');
      expect(res.body.client.name).toBe(payload.name);
      expect(res.body.client.email).toBe(payload.email);
    });
  });

  describe('2. Cadastro de Módulo de Agente Regulatório', () => {
    it('deve cadastrar um agente com marco regulatório, slug, cron e modo de extração polimórfico', async () => {
      const payload = {
        name: 'Auditor de Publicidade Médica',
        code: 'cfm-pub-cardiovida',
        description: 'Auditoria contínua de website e redes sob a Res. CFM 2.336/2023',
        clientId: 'client-1',
        regulatoryFramework: 'CFM (Resolução 2.336/2023)',
        cronSchedule: '0 */6 * * *',
        enabled: true,
        extractionMode: 'CHEERIO',
        targetUrl: 'https://cardiovida.med.br/servicos',
      };

      const res = await request(app)
        .post('/api/v1/agents')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.message).toContain('Agente regulatório cadastrado com sucesso');
      expect(res.body.agent.code).toBe(payload.code);
      expect(res.body.agent.regulatoryFramework).toBe(payload.regulatoryFramework);
      expect(res.body.agent.cronSchedule).toBe(payload.cronSchedule);
    });
  });

  describe('3. Diagnóstico e Ativação de Modelos de IA', () => {
    it('deve testar o modelo através da rota dedicada POST /api/v1/models/:id/test', async () => {
      const res = await request(app)
        .post('/api/v1/models/model-heuristic/test')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ prompt: 'Teste de integridade regulatória' });

      expect(res.status).toBe(200);
      expect(res.body.provider).toBe('heuristic');
      expect(res.body.status).toBe('ONLINE');
      expect(typeof res.body.latencyMs).toBe('number');
    });

    it('deve ativar um modelo de IA em tempo de execução via POST /api/v1/models/:id/activate', async () => {
      const res = await request(app)
        .post('/api/v1/models/model-heuristic/activate')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('ativado com sucesso como motor ativo');
      expect(res.body.activeModel.isActive).toBe(true);
    });
  });
});
