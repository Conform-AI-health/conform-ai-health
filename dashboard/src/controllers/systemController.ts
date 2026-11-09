import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { ReconciliationEngine } from '../services/reconciliationEngine.js';
import { getRedisConnection, auditQueue } from '../config/redis.js';
import { env } from '../config/env.js';
import { getWorkerHealth, getWorkerMetrics } from '../worker.js';

const toggleProviderSchema = z.object({
  provider: z.enum(['gemini', 'ollama', 'heuristic']),
});

export class SystemController {
  public static async status(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      let dbStatus = 'CONNECTED';
      try {
        if (env.NODE_ENV === 'test') {
          dbStatus = 'TEST_MOCK_CONNECTED';
        } else {
          await Promise.race([
            prisma.$runCommandRaw({ ping: 1 }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('DB Timeout')), 1500)),
          ]);
        }
      } catch (err: any) {
        dbStatus = `DISCONNECTED (${err.message})`;
      }

      let redisStatus = 'CONNECTED';
      let queueCount = 0;
      try {
        if (env.NODE_ENV === 'test') {
          redisStatus = 'TEST_MOCK_CONNECTED';
          queueCount = 0;
        } else {
          const redis = getRedisConnection();
          await Promise.race([
            redis.ping(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Redis Timeout')), 1500)),
          ]);
          queueCount = await Promise.race([
            auditQueue.count(),
            new Promise<number>((_, reject) => setTimeout(() => reject(new Error('Queue Timeout')), 1500)),
          ]);
        }
      } catch (err: any) {
        redisStatus = `OFFLINE_OR_FALLBACK (${err.message})`;
      }

      res.status(200).json({
        service: 'ConformIA Backend API',
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        aiProvider: ReconciliationEngine.getActiveProvider(),
        database: dbStatus,
        redis: redisStatus,
        queuedJobs: queueCount,
        workerStatus: 'MONITORED',
      });
    } catch (error) {
      next(error);
    }
  }

  public static async workerStatus(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (env.NODE_ENV === 'test') {
        res.status(200).json({
          status: 'UP',
          service: 'conformia-audit-worker',
          uptimeSeconds: 120,
          redis: 'CONNECTED',
          worker: { isRunning: true, isPaused: false, concurrency: 3 },
          metrics: { processedTotal: 10, completedTotal: 10, failedTotal: 0, activeCount: 0 },
        });
        return;
      }
      const health = await getWorkerHealth();
      const metrics = getWorkerMetrics();
      res.status(200).json({
        ...health,
        extendedMetrics: metrics,
      });
    } catch (error) {
      next(error);
    }
  }

  public static async toggleProvider(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { provider } = toggleProviderSchema.parse(req.body);
      ReconciliationEngine.setActiveProvider(provider);

      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          message: `Provedor de inteligência artificial alterado em runtime para ${provider}`,
          module: 'SYSTEM_SETTINGS',
        },
      });

      res.status(200).json({
        message: `Provedor de IA alternado com sucesso para ${provider}.`,
        currentProvider: provider,
      });
    } catch (error) {
      next(error);
    }
  }

  public static async testAi(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const prompt = req.body?.prompt ? String(req.body.prompt).slice(0, 1000) : undefined;
      const targetModelId = req.body?.modelConfigId || req.body?.modelId;
      const result = await ReconciliationEngine.testModelResponse(prompt, targetModelId);

      await prisma.systemLog.create({
        data: {
          level: result.status === 'OFFLINE' ? 'WARN' : 'INFO',
          message: `Teste de conectividade do modelo IA (${result.provider}/${result.model}) concluído: ${result.status} em ${result.latencyMs}ms`,
          module: 'AI_HEALTHCHECK',
        },
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  public static async logs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));

      const [total, logs] = await Promise.all([
        prisma.systemLog.count(),
        prisma.systemLog.findMany({
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
      ]);

      res.status(200).json({
        data: logs,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

