import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditSchedulerService } from '../services/auditSchedulerService.js';
import { LegalNormCrawlerService, CrawlJobState } from '../services/legalNormCrawlerService.js';
import { prisma } from '../config/prisma.js';
import * as redisModule from '../config/redis.js';

describe('Resiliência Arquitetural — Scheduler Mutex e Fila de Crawl', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('AuditSchedulerService Mutex Distribuído', () => {
    it('deve descartar disparos concorrentes quando o Redis já possuir o lock ativo', async () => {
      vi.spyOn(prisma.agentModule, 'findUnique').mockResolvedValueOnce({
        id: 'agent-concorrente-123',
        name: 'Agente Concorrente',
        targetUrl: 'https://clinicaexemplo.med.br',
        enabled: true,
        cronSchedule: '0 */6 * * *',
      } as any);

      // Mock do Redis simulando que o lock já foi adquirido por outro processo (retorna null)
      const mockRedis = {
        set: vi.fn().mockResolvedValue(null),
        get: vi.fn(),
      } as any;
      vi.spyOn(redisModule, 'getRedisConnection').mockReturnValue(mockRedis);

      const createSpy = vi.spyOn(prisma.auditReport, 'create');

      const result = await AuditSchedulerService.triggerScheduledAudit('agent-concorrente-123');

      expect(result).toBeNull();
      expect(mockRedis.set).toHaveBeenCalledWith(
        'lock:sched:agent-concorrente-123',
        '1',
        'EX',
        120,
        'NX'
      );
      // Garante que o relatório duplicado NUNCA foi criado no banco
      expect(createSpy).not.toHaveBeenCalled();
    });
  });

  describe('LegalNormCrawlerService Persistência no Redis', () => {
    it('deve salvar e recuperar o estado do job no Redis sobrevivendo à ausência de memória', async () => {
      const mockJobState: CrawlJobState = {
        jobId: 'crawl-teste-redis-777',
        rootUrl: 'https://portal.cfm.org.br',
        status: 'completed',
        maxDepth: 2,
        allowedDomains: ['portal.cfm.org.br'],
        tags: ['CFM', 'PUBLICIDADE'],
        force: false,
        counters: {
          discovered: 10,
          downloaded: 5,
          normsSaved: 2,
          normsSkippedIdempotent: 3,
          normsUpdatedVersion: 0,
          discarded: 5,
          errors: 0,
        },
        savedNormIds: ['norm-1', 'norm-2'],
        discards: [],
        errors: [],
        startedAt: new Date().toISOString(),
      };

      const mockRedis = {
        set: vi.fn().mockResolvedValue('OK'),
        get: vi.fn().mockResolvedValue(JSON.stringify(mockJobState)),
      } as any;
      vi.spyOn(redisModule, 'getRedisConnection').mockReturnValue(mockRedis);

      // Salva o estado
      await LegalNormCrawlerService.saveJobState(mockJobState);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'crawl:job:crawl-teste-redis-777',
        expect.any(String),
        'EX',
        7 * 24 * 3600
      );

      // Recupera o estado
      const retrieved = await LegalNormCrawlerService.getJob('crawl-teste-redis-777');
      expect(retrieved).toBeDefined();
      expect(retrieved?.jobId).toBe('crawl-teste-redis-777');
      expect(retrieved?.counters.normsSaved).toBe(2);
    });

    it('deve priorizar a leitura do Redis em getJob mesmo se a memória do processo possuir estado inicial defasado', async () => {
      // Estado inicial em memória (como o gravado pela API no início)
      const initialMemoryJob: CrawlJobState = {
        jobId: 'crawl-multiprocess-456',
        rootUrl: 'https://normas.saude.gov.br',
        status: 'running',
        maxDepth: 2,
        allowedDomains: [],
        tags: [],
        force: false,
        counters: {
          discovered: 1,
          downloaded: 0,
          normsSaved: 0,
          normsSkippedIdempotent: 0,
          normsUpdatedVersion: 0,
          discarded: 0,
          errors: 0,
        },
        savedNormIds: [],
        discards: [],
        errors: [],
        startedAt: new Date().toISOString(),
      };

      // Estado atualizado pelo Worker no Redis com progresso real
      const updatedWorkerJob: CrawlJobState = {
        ...initialMemoryJob,
        status: 'running',
        counters: {
          discovered: 25,
          downloaded: 12,
          normsSaved: 8,
          normsSkippedIdempotent: 2,
          normsUpdatedVersion: 1,
          discarded: 2,
          errors: 0,
        },
      };

      // Grava o estado antigo na memória local
      (LegalNormCrawlerService as any).jobs.set('crawl-multiprocess-456', initialMemoryJob);

      // Mock do Redis retornando o estado atualizado do worker
      const mockRedis = {
        get: vi.fn().mockResolvedValue(JSON.stringify(updatedWorkerJob)),
        set: vi.fn(),
      } as any;
      vi.spyOn(redisModule, 'getRedisConnection').mockReturnValue(mockRedis);

      const jobFromApi = await LegalNormCrawlerService.getJob('crawl-multiprocess-456');

      expect(mockRedis.get).toHaveBeenCalledWith('crawl:job:crawl-multiprocess-456');
      expect(jobFromApi).toBeDefined();
      expect(jobFromApi?.counters.downloaded).toBe(12);
      expect(jobFromApi?.counters.normsSaved).toBe(8);
      expect(jobFromApi?.counters.discovered).toBe(25);
    });

    it('normCrawlQueue deve possuir política estrita de attempts: 1 para evitar retentativas massivas', () => {
      expect(redisModule.normCrawlQueue.defaultJobOptions?.attempts).toBe(1);
    });
  });

  describe('AuditSchedulerService Atomicidade no MongoDB em Fallback', () => {
    it('deve descartar disparos concorrentes via trava atômica no MongoDB se o Redis falhar ou estiver offline', async () => {
      vi.spyOn(prisma.agentModule, 'findUnique').mockResolvedValueOnce({
        id: 'agent-fallback-offline',
        name: 'Agente Sem Redis',
        targetUrl: 'https://clinicaoffline.med.br',
        enabled: true,
        cronSchedule: '0 */6 * * *',
      } as any);

      // Simula Redis completamente offline (lança erro)
      vi.spyOn(redisModule, 'getRedisConnection').mockImplementation(() => {
        throw new Error('ECONNREFUSED Redis Offline');
      });

      // Simula que a trava atômica no MongoDB já foi capturada por outro processo (count: 0)
      vi.spyOn(prisma.agentModule, 'updateMany').mockResolvedValueOnce({ count: 0 });

      const createSpy = vi.spyOn(prisma.auditReport, 'create');

      const result = await AuditSchedulerService.triggerScheduledAudit('agent-fallback-offline');

      expect(result).toBeNull();
      expect(createSpy).not.toHaveBeenCalled();
    });
  });
});
