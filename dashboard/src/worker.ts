import http from 'http';
import { Worker, Job } from 'bullmq';
import { getRedisConnection } from './config/redis.js';
import { prisma } from './config/prisma.js';
import { AuditExecutionService } from './services/auditExecutionService.js';
import { AuditSchedulerService } from './services/auditSchedulerService.js';
import { ExtractionMode } from '@prisma/client';

export interface AuditJobData {
  auditReportId?: string;
  clientId: string;
  targetUrl: string;
  extractionMode?: ExtractionMode;
  agentModuleId?: string;
  skill?: string;
}

export interface WorkerTelemetryMetrics {
  startTime: number;
  processedTotal: number;
  completedTotal: number;
  failedTotal: number;
  activeCount: number;
  lastProcessedAt: string | null;
  lastError: string | null;
}

// Estado em memória do monitoramento do worker
const workerMetrics: WorkerTelemetryMetrics = {
  startTime: Date.now(),
  processedTotal: 0,
  completedTotal: 0,
  failedTotal: 0,
  activeCount: 0,
  lastProcessedAt: null,
  lastError: null,
};

let activeWorkerInstance: Worker<AuditJobData> | null = null;
let healthServerInstance: http.Server | null = null;

export function getWorkerMetrics(): WorkerTelemetryMetrics & { uptimeSeconds: number; memory: NodeJS.MemoryUsage } {
  return {
    ...workerMetrics,
    uptimeSeconds: Math.floor((Date.now() - workerMetrics.startTime) / 1000),
    memory: process.memoryUsage(),
  };
}

export async function getWorkerHealth(): Promise<{
  status: 'UP' | 'DEGRADED' | 'DOWN';
  service: string;
  uptimeSeconds: number;
  redis: 'CONNECTED' | 'DISCONNECTED';
  worker: {
    isRunning: boolean;
    isPaused: boolean;
    concurrency: number;
  };
  metrics: WorkerTelemetryMetrics;
  timestamp: string;
}> {
  const redis = getRedisConnection();
  let redisConnected = false;

  try {
    const pong = await redis.ping();
    redisConnected = pong === 'PONG';
  } catch {
    redisConnected = false;
  }

  const isRunning = activeWorkerInstance ? activeWorkerInstance.isRunning() : false;
  const isPaused = activeWorkerInstance ? activeWorkerInstance.isPaused() : false;

  const status = redisConnected && isRunning && !isPaused ? 'UP' : redisConnected ? 'DEGRADED' : 'DOWN';

  return {
    status,
    service: 'conformia-audit-worker',
    uptimeSeconds: Math.floor((Date.now() - workerMetrics.startTime) / 1000),
    redis: redisConnected ? 'CONNECTED' : 'DISCONNECTED',
    worker: {
      isRunning,
      isPaused,
      concurrency: 3,
    },
    metrics: workerMetrics,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Servidor HTTP leve dedicado para Health Check e Observabilidade do Worker (ex: Docker e Prometheus/K8s)
 */
export function startWorkerHealthServer(port: number = Number(process.env.WORKER_HEALTH_PORT) || 3001): http.Server {
  if (healthServerInstance) {
    return healthServerInstance;
  }

  const server = http.createServer(async (req, res) => {
    const url = req.url || '/';

    if (url === '/health' || url === '/healthz' || url === '/') {
      try {
        const health = await getWorkerHealth();
        const statusCode = health.status === 'UP' ? 200 : health.status === 'DEGRADED' ? 200 : 503;
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(health, null, 2));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'DOWN', error: err.message }));
      }
      return;
    }

    if (url === '/metrics') {
      try {
        const metrics = getWorkerMetrics();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(metrics, null, 2));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint não encontrado' }));
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`🩺 [WorkerHealthServer] Probe HTTP ativo na porta ${port} (/health, /metrics)`);
  });

  healthServerInstance = server;
  return server;
}

export function stopWorkerHealthServer(): Promise<void> {
  return new Promise((resolve) => {
    if (healthServerInstance) {
      healthServerInstance.close(() => {
        healthServerInstance = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

export function startAuditWorker() {
  console.log('👷 [AuditWorker] Inicializando worker assíncrono BullMQ...');

  const worker = new Worker<AuditJobData>(
    'auditQueue',
    async (job: Job<AuditJobData>) => {
      workerMetrics.activeCount++;
      workerMetrics.processedTotal++;
      workerMetrics.lastProcessedAt = new Date().toISOString();

      try {
        // Caso seja um job disparado pelo agendador cron
        if (job.name === 'cronAuditJob' && job.data.agentModuleId) {
          console.log(`[Job ${job.id}] Executando auditoria contínua programada via Cron para Agente: ${job.data.agentModuleId}`);
          const res = await AuditSchedulerService.triggerScheduledAudit(job.data.agentModuleId);
          workerMetrics.completedTotal++;
          return res;
        }

        const { auditReportId, clientId, targetUrl, extractionMode, agentModuleId, skill } = job.data;
        if (!auditReportId) {
          console.warn(`[Job ${job.id}] Job de auditoria recebido sem auditReportId. Ignorando.`);
          return;
        }
        console.log(`[Job ${job.id}] Iniciando processamento de auditoria para Report: ${auditReportId} (${targetUrl})`);

        const result = await AuditExecutionService.execute({
          auditReportId,
          clientId,
          targetUrl,
          extractionMode,
          agentModuleId,
          skill,
          jobId: job.id,
        });

        workerMetrics.completedTotal++;
        return result;
      } catch (err: any) {
        workerMetrics.failedTotal++;
        workerMetrics.lastError = err.message;
        throw err;
      } finally {
        workerMetrics.activeCount = Math.max(0, workerMetrics.activeCount - 1);
      }
    },
    {
      connection: getRedisConnection(),
      concurrency: 3,
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`[AuditWorker] Job ${job?.id} falhou definitivamente: ${err.message}`);
  });

  worker.on('error', (err) => {
    console.warn(`[AuditWorker] Evento de erro no worker: ${err.message}`);
  });

  // Inicia o serviço de agendamento contínuo
  AuditSchedulerService.init().catch((err) => {
    console.warn(`[AuditWorker] Falha ao iniciar agendador no worker: ${err.message}`);
  });

  activeWorkerInstance = worker;

  // Inicia o servidor HTTP de health check
  startWorkerHealthServer();

  return worker;
}

// Executar isoladamente se chamado via CLI ou Docker
if (
  process.argv[1]?.includes('worker') ||
  process.env.RUN_WORKER === 'true' ||
  process.env.npm_lifecycle_event === 'worker'
) {
  startAuditWorker();
  console.log('🚀 Worker de auditoria rodando em background com probe de saúde e métricas...');
}
