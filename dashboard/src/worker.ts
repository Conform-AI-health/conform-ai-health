import { Worker, Job } from 'bullmq';
import { getRedisConnection } from './config/redis.js';
import { prisma } from './config/prisma.js';
import { ScraperService } from './services/scraperService.js';
import { ReconciliationEngine } from './services/reconciliationEngine.js';
import { ExtractionMode } from '@prisma/client';

export interface AuditJobData {
  auditReportId: string;
  clientId: string;
  targetUrl: string;
  extractionMode?: ExtractionMode;
  agentModuleId?: string;
}

export function startAuditWorker() {
  console.log('👷 [AuditWorker] Inicializando worker assíncrono BullMQ...');

  const worker = new Worker<AuditJobData>(
    'auditQueue',
    async (job: Job<AuditJobData>) => {
      const { auditReportId, clientId, targetUrl, extractionMode } = job.data;
      const startTime = Date.now();

      console.log(`[Job ${job.id}] Iniciando processamento de auditoria para Report: ${auditReportId} (${targetUrl})`);

      try {
        // Atualiza status do laudo para RUNNING
        await prisma.auditReport.update({
          where: { id: auditReportId },
          data: { status: 'RUNNING' },
        });

        // 1. Extração da página web
        const scrape = await ScraperService.scrape(targetUrl, extractionMode);

        // 2. Reconciliação Deontológica com IA
        const reconciliation = await ReconciliationEngine.reconcile(scrape);
        const executionTimeMs = Date.now() - startTime;

        // 3. Persistência Imutável dos Resultados
        await prisma.$transaction(async (tx) => {
          // Salva o relatório principal
          const updatedReport = await tx.auditReport.update({
            where: { id: auditReportId },
            data: {
              status: 'COMPLETED',
              verdict: reconciliation.verdict,
              score: reconciliation.score,
              summary: reconciliation.summary,
              rawContent: scrape.rawHtmlLength.toString(),
              cleanMarkdown: scrape.cleanMarkdown,
              tokensSaved: Math.max(0, scrape.tokensEstimatedRaw - scrape.tokensEstimatedClean),
              executionTimeMs,
            },
          });

          // Cria as violações associadas
          if (reconciliation.violations.length > 0) {
            await tx.violation.createMany({
              data: reconciliation.violations.map((v) => ({
                auditReportId: updatedReport.id,
                normArticle: v.normArticle,
                normCode: v.normCode,
                severity: v.severity,
                detectedText: v.detectedText,
                correctiveAdvice: v.correctiveAdvice,
                resolved: false,
              })),
            });
          }
        });

        // Log de sucesso
        await prisma.systemLog.create({
          data: {
            level: 'INFO',
            message: `Auditoria concluída com sucesso para cliente ${clientId}. Veredito: ${reconciliation.verdict}`,
            module: 'AUDIT_WORKER',
            correlationId: job.id,
            details: JSON.stringify({
              auditReportId,
              score: reconciliation.score,
              executionTimeMs,
              violationsCount: reconciliation.violations.length,
            }),
          },
        });

        console.log(`✅ [Job ${job.id}] Concluído com sucesso em ${executionTimeMs}ms! Veredito: ${reconciliation.verdict}`);
        return { success: true, auditReportId };
      } catch (error: any) {
        console.error(`❌ [Job ${job.id}] Erro durante a auditoria:`, error);

        // Marca relatório como falha
        await prisma.auditReport.update({
          where: { id: auditReportId },
          data: {
            status: 'FAILED',
            summary: `Falha técnica durante a execução da auditoria: ${error.message}`,
          },
        });

        // Grava log do erro
        await prisma.systemLog.create({
          data: {
            level: 'ERROR',
            message: `Falha no processamento de auditoria: ${error.message}`,
            module: 'AUDIT_WORKER',
            correlationId: job.id,
            details: error.stack,
          },
        });

        throw error;
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

  return worker;
}

// Executar isoladamente se chamado via CLI
if (process.argv[1]?.includes('worker.ts')) {
  startAuditWorker();
  console.log('🚀 Worker de auditoria rodando em background...');
}

