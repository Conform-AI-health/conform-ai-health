import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findAgent: vi.fn(),
  createReport: vi.fn(),
  addAuditJob: vi.fn(),
  validateSafeUrl: vi.fn(),
  decryptSecret: vi.fn(),
  resolveClient: vi.fn(),
  injectTraceCarrier: vi.fn(),
}));

vi.mock('../repositories/agentRepository.js', () => ({
  AgentRepository: { findById: mocks.findAgent },
}));
vi.mock('../repositories/clientRepository.js', () => ({
  ClientRepository: { findById: vi.fn() },
}));
vi.mock('../repositories/reportRepository.js', () => ({
  ReportRepository: { create: mocks.createReport },
}));
vi.mock('../services/auditSchedulerService.js', () => ({
  AuditSchedulerService: {},
}));
vi.mock('../config/redis.js', () => ({
  auditQueue: { add: mocks.addAuditJob },
}));
vi.mock('../shared/encryption.js', () => ({
  encryptSecret: vi.fn(),
  maskSecret: vi.fn(),
  decryptSecret: mocks.decryptSecret,
}));
vi.mock('../shared/security.js', () => ({
  validateSafeUrlAsync: mocks.validateSafeUrl,
}));
vi.mock('../shared/clientIdentityResolver.js', () => ({
  resolveClientByIdOrUrl: mocks.resolveClient,
}));
vi.mock('../shared/tracing.js', () => ({
  injectTraceCarrier: mocks.injectTraceCarrier,
}));

import { AgentService } from '../services/agentService.js';

describe('Execução de auditoria pelo perfil VISITANTE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findAgent.mockResolvedValue({
      id: 'agent-1',
      name: 'Agente configurado',
      targetUrl: 'https://clinica.example',
      clientId: 'client-configured',
      extractionMode: 'FIRECRAWL',
      description: 'Persona salva',
      hasAuth: false,
    });
    mocks.createReport.mockResolvedValue({ id: 'report-1' });
    mocks.addAuditJob.mockResolvedValue({ id: 'job-1' });
    mocks.validateSafeUrl.mockResolvedValue({ safe: true });
    mocks.injectTraceCarrier.mockReturnValue({});
  });

  it('executa somente o alvo e o modo salvos no agente, ignorando overrides da requisição', async () => {
    await AgentService.runAudit(
      'agent-1',
      {
        targetUrl: 'https://unconfigured.example',
        clientId: 'client-other',
        extractionMode: 'CHEERIO',
      },
      { role: 'VIEWER' }
    );

    expect(mocks.validateSafeUrl).toHaveBeenCalledWith('https://clinica.example');
    expect(mocks.createReport).toHaveBeenCalledWith(
      expect.objectContaining({
        targetUrl: 'https://clinica.example',
        extractionMode: 'FIRECRAWL',
      })
    );
    expect(mocks.addAuditJob).toHaveBeenCalledWith(
      'auditJob',
      expect.objectContaining({
        targetUrl: 'https://clinica.example',
        clientId: 'client-configured',
        extractionMode: 'FIRECRAWL',
      }),
      expect.any(Object)
    );
  });
});
