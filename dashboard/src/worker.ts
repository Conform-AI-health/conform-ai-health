import http from 'http';
import crypto from 'crypto';
import { Worker, Job } from 'bullmq';
import { getRedisConnection } from './config/redis.js';
import { prisma } from './config/prisma.js';
import { env } from './config/env.js';
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

export function getActiveWorkerInstance(): Worker<AuditJobData> | null {
  return activeWorkerInstance;
}

export function setActiveWorkerInstance(instance: Worker<AuditJobData> | null): void {
  activeWorkerInstance = instance;
}

/**
 * Comparação segura em tempo constante contra timing attacks (T02)
 */
export function timingSafeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

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

  // UP: Redis conectado e Worker rodando ativamente sem pausa
  // DEGRADED: Redis conectado, mas Worker parado ou pausado (incapaz de processar jobs)
  // DOWN: Redis inacessível ou falha crítica de conexão
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
 * Servidor HTTP dedicado para Health Check (liveness/readiness) e Métricas do Worker (T01 / T02)
 */
export function startWorkerHealthServer(port: number = Number(process.env.WORKER_HEALTH_PORT) || 3001): http.Server {
  if (healthServerInstance) {
    return healthServerInstance;
  }

  const server = http.createServer(async (req, res) => {
    const url = req.url || '/';

    // T01: Liveness Probe (/live, /health/liveness)
    // Avalia exclusivamente se o processo HTTP do worker está responsivo
    if (url === '/live' || url === '/health/liveness') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'UP', check: 'liveness', timestamp: new Date().toISOString() }));
      return;
    }

    // T01: Readiness Probe (/ready, /health/readiness) e Health Check Padrão (/health, /healthz, /)
    // UP retorna HTTP 200; DEGRADED e DOWN retornam HTTP 503 (não apto para receber carga)
    if (url === '/health' || url === '/healthz' || url === '/' || url === '/ready' || url === '/health/readiness') {
      try {
        const health = await getWorkerHealth();
        const statusCode = health.status === 'UP' ? 200 : 503;
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(health, null, 2));
      } catch (err: any) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'DOWN', error: err.message }));
      }
      return;
    }

    // T02: Proteção estrita do endpoint /metrics
    if (url === '/metrics' || url.startsWith('/metrics?')) {
      const parsedUrl = new URL(url, `http://${req.headers.host || 'localhost'}`);

      // 1. Proibição expressa de credenciais por query string (?key= ou ?apiKey=)
      if (parsedUrl.searchParams.has('key') || parsedUrl.searchParams.has('apiKey')) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'Autenticação via query string não é permitida por razões de segurança. Utilize o header Authorization: Bearer ou X-API-Key.',
            code: 'INSECURE_QUERY_AUTH_REJECTED',
          })
        );
        return;
      }

      // 2. Validação da Chave de Monitoramento configurada
      const expectedKey = process.env.MONITORING_API_KEY || env.MONITORING_API_KEY || (process.env.NODE_ENV === 'test' ? 'test-monitoring-key-2026' : '');
      if (!expectedKey) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'Acesso negado. Chave de monitoramento não configurada.',
            code: 'METRICS_DISABLED',
          })
        );
        return;
      }

      // 3. Extração estrita via headers HTTP (Authorization: Bearer ou X-API-Key)
      const authHeader = req.headers.authorization;
      const apiKeyHeader = req.headers['x-api-key'] as string | undefined;
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;
      const providedKey = apiKeyHeader || bearerToken;

      if (!providedKey) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'Não autorizado. Credencial de monitoramento ausente.',
            code: 'UNAUTHORIZED_METRICS_ACCESS',
          })
        );
        return;
      }

      // 4. Comparação em tempo constante (Timing-Safe)
      if (!timingSafeCompare(providedKey, expectedKey)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'Acesso negado. Credencial de monitoramento inválida.',
            code: 'FORBIDDEN_METRICS_ACCESS',
          })
        );
        return;
      }

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

/**
 * Encerramento gracioso (Graceful Shutdown) do Worker BullMQ e recursos de rede (INF-03)
 */
export async function shutdownWorker(signal: string = 'SIGTERM'): Promise<void> {
  console.log(`[AuditWorker] Sinal ${signal} detectado. Iniciando shutdown gracioso...`);

  // Timeout de segurança para evitar deadlocks caso conexões travem
  const forceExitTimeout = setTimeout(() => {
    console.error('[AuditWorker] Timeout de segurança de shutdown excedido (10s). Forçando encerramento.');
    process.exit(1);
  }, 10000);
  forceExitTimeout.unref();

  try {
    if (activeWorkerInstance) {
      await activeWorkerInstance.close();
      console.log('[AuditWorker] Fila BullMQ finalizada sem interrupção abrupta de jobs.');
      activeWorkerInstance = null;
    }
    if (healthServerInstance) {
      await new Promise<void>((resolve) => {
        healthServerInstance!.close(() => {
          console.log('[AuditWorker] Servidor de métricas/health encerrado.');
          resolve();
        });
      });
      healthServerInstance = null;
    }
    if (typeof (prisma as any).$disconnect === 'function') {
      await prisma.$disconnect();
      console.log('[AuditWorker] Conexão Prisma finalizada.');
    }
    clearTimeout(forceExitTimeout);
    console.log('[AuditWorker] Shutdown gracioso finalizado com sucesso.');
  } catch (err: any) {
    clearTimeout(forceExitTimeout);
    console.error(`[AuditWorker] Erro durante shutdown gracioso: ${err.message}`);
  }
}

// Listeners de encerramento do processo quando executado isoladamente
if (
  process.argv[1]?.includes('worker') ||
  process.env.RUN_WORKER === 'true' ||
  process.env.npm_lifecycle_event === 'worker'
) {
  process.on('SIGTERM', async () => {
    await shutdownWorker('SIGTERM');
    process.exit(0);
  });
  process.on('SIGINT', async () => {
    await shutdownWorker('SIGINT');
    process.exit(0);
  });

  startAuditWorker();
  console.log('🚀 Worker de auditoria rodando em background com probe de saúde e métricas...');
}
