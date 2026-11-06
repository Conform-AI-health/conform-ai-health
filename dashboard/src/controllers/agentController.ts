import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { auditQueue } from '../config/redis.js';
import { Role, ExtractionMode } from '@prisma/client';
import { ScraperService } from '../services/scraperService.js';
import { ReconciliationEngine } from '../services/reconciliationEngine.js';

const runAuditSchema = z.object({
  clientId: z.string().min(1, 'clientId é obrigatório'),
  targetUrl: z.string().url('targetUrl deve ser uma URL válida'),
  extractionMode: z.enum(['PUPPETEER', 'CHEERIO', 'FALLBACK_AI', 'MCP', 'FIRECRAWL']).optional(),
});

export class AgentController {
  public static async listModules(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const modules = await prisma.agentModule.findMany({
        orderBy: { createdAt: 'asc' },
      });
      res.status(200).json(modules);
    } catch (error) {
      next(error);
    }
  }

  public static async getModuleById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const mod = await prisma.agentModule.findUnique({
        where: { id },
      });

      if (!mod) {
        res.status(404).json({ error: 'Módulo de agente não encontrado.' });
        return;
      }

      res.status(200).json(mod);
    } catch (error) {
      next(error);
    }
  }

  public static async runAudit(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id: agentModuleId } = req.params;
      const { clientId, targetUrl, extractionMode } = runAuditSchema.parse(req.body);

      // Isolamento multi-tenant: CLIENT só pode disparar auditoria para si mesmo
      if (req.user?.role === Role.CLIENT && req.user.clientId !== clientId) {
        res.status(403).json({
          error: 'Acesso negado. Você só pode disparar auditorias para a sua própria clínica.',
          code: 'TENANT_FORBIDDEN',
        });
        return;
      }

      const client = await prisma.client.findUnique({
        where: { id: clientId },
      });

      if (!client) {
        res.status(404).json({ error: 'Clínica solicitada não foi encontrada.' });
        return;
      }

      const mod = await prisma.agentModule.findUnique({
        where: { id: agentModuleId },
      });

      const effectiveMode: ExtractionMode = extractionMode || mod?.extractionMode || 'CHEERIO';

      // Criação inicial do laudo em estado QUEUED
      const report = await prisma.auditReport.create({
        data: {
          clientId,
          targetUrl,
          extractionMode: effectiveMode,
          status: 'QUEUED',
          summary: 'Auditoria enfileirada para processamento assíncrono.',
          score: 0,
        },
      });

      // Tenta enfileirar no BullMQ
      let queuedViaRedis = false;
      try {
        await auditQueue.add(
          'execute-audit',
          {
            auditReportId: report.id,
            clientId,
            targetUrl,
            extractionMode: effectiveMode,
            agentModuleId,
          },
          {
            jobId: `audit-${report.id}`,
          }
        );
        queuedViaRedis = true;
      } catch (queueErr: any) {
        console.warn(`[AgentController] Redis indisponível ou em fallback (${queueErr.message}). Processando job sincronicamente...`);
      }

      // Se o Redis não estiver ativo, processa diretamente para garantir fluidez
      if (!queuedViaRedis) {
        setImmediate(async () => {
          try {
            await prisma.auditReport.update({
              where: { id: report.id },
              data: { status: 'RUNNING' },
            });

            const startTime = Date.now();
            const scrape = await ScraperService.scrape(targetUrl, effectiveMode);
            const recon = await ReconciliationEngine.reconcile(scrape);
            const executionTimeMs = Date.now() - startTime;

            await prisma.$transaction(async (tx) => {
              await tx.auditReport.update({
                where: { id: report.id },
                data: {
                  status: 'COMPLETED',
                  verdict: recon.verdict,
                  score: recon.score,
                  summary: recon.summary,
                  rawContent: scrape.rawHtmlLength.toString(),
                  cleanMarkdown: scrape.cleanMarkdown,
                  tokensSaved: Math.max(0, scrape.tokensEstimatedRaw - scrape.tokensEstimatedClean),
                  executionTimeMs,
                },
              });

              if (recon.violations.length > 0) {
                await tx.violation.createMany({
                  data: recon.violations.map((v) => ({
                    auditReportId: report.id,
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

            console.log(`✅ [Direct Worker Fallback] Auditoria ${report.id} concluída com sucesso!`);
          } catch (execErr: any) {
            console.error(`❌ [Direct Worker Fallback] Falha na auditoria ${report.id}:`, execErr);
            await prisma.auditReport.update({
              where: { id: report.id },
              data: {
                status: 'FAILED',
                summary: `Falha técnica durante auditoria: ${execErr.message}`,
              },
            });
          }
        });
      }

      res.status(202).json({
        message: 'Auditoria agendada com sucesso.',
        reportId: report.id,
        status: report.status,
        queuedViaRedis,
      });
    } catch (error) {
      next(error);
    }
  }
}

