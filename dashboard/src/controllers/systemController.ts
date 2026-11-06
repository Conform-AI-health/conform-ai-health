import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { ReconciliationEngine } from '../services/reconciliationEngine.js';
import { getRedisConnection, auditQueue } from '../config/redis.js';

const toggleProviderSchema = z.object({
  provider: z.enum(['gemini', 'ollama', 'heuristic']),
});

export class SystemController {
  public static async status(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      let dbStatus = 'CONNECTED';
      try {
        await prisma.$runCommandRaw({ ping: 1 });
      } catch (err: any) {
        dbStatus = `DISCONNECTED (${err.message})`;
      }

      let redisStatus = 'CONNECTED';
      let queueCount = 0;
      try {
        const redis = getRedisConnection();
        await redis.ping();
        queueCount = await auditQueue.count();
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

