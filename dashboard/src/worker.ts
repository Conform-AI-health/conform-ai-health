import { Worker, Job } from 'bullmq';
import { getRedisConnection } from './config/redis.js';
import { prisma } from './config/prisma.js';
import { AuditExecutionService } from './services/auditExecutionService.js';
import { ExtractionMode } from '@prisma/client';

export interface AuditJobData {
  auditReportId: string;
  clientId: string;
  targetUrl: string;
  extractionMode?: ExtractionMode;
  agentModuleId?: string;
  skill?: string;
}

export function startAuditWorker() {
  console.log('👷 [AuditWorker] Inicializando worker assíncrono BullMQ...');

  const worker = new Worker<AuditJobData>(
    'auditQueue',
    async (job: Job<AuditJobData>) => {
      const { auditReportId, clientId, targetUrl, extractionMode, agentModuleId, skill } = job.data;
      console.log(`[Job ${job.id}] Iniciando processamento de auditoria para Report: ${auditReportId} (${targetUrl})`);

      return await AuditExecutionService.execute({
        auditReportId,
        clientId,
        targetUrl,
        extractionMode,
        agentModuleId,
        skill,
        jobId: job.id,
      });
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

  return worker;
}

// Executar isoladamente se chamado via CLI ou Docker
if (
  process.argv[1]?.includes('worker') ||
  process.env.RUN_WORKER === 'true' ||
  process.env.npm_lifecycle_event === 'worker'
) {
  startAuditWorker();
  console.log('🚀 Worker de auditoria rodando em background...');
}
