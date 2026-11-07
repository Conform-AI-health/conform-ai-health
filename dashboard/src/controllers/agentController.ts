import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { auditQueue } from '../config/redis.js';
import { Role, ExtractionMode } from '@prisma/client';
import { ScraperService } from '../services/scraperService.js';
import { ReconciliationEngine } from '../services/reconciliationEngine.js';

const createAgentSchema = z.object({
  name: z.string().min(2, 'Nome é obrigatório'),
  code: z.string().min(2, 'Código identificador é obrigatório'),
  description: z.string().min(5, 'Descrição é obrigatória'),
  category: z.string().default('DEONTOLOGIA_MEDICA'),
  extractionMode: z.enum(['PUPPETEER', 'CHEERIO', 'FALLBACK_AI', 'MCP', 'FIRECRAWL']).default('CHEERIO'),
  targetNorms: z.array(z.string()).default([]),
  systemPrompt: z.string().optional(),
});

const updateAgentSchema = createAgentSchema.partial();

const runAuditSchema = z.object({
  clientId: z.string().min(1, 'clientId é obrigatório'),
  targetUrl: z.string().url('targetUrl deve ser uma URL válida'),
  extractionMode: z.enum(['PUPPETEER', 'CHEERIO', 'FALLBACK_AI', 'MCP', 'FIRECRAWL']).optional(),
});

export class AgentController {
  public static async listModules(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const page = req.query.page ? Math.max(1, parseInt(req.query.page as string, 10) || 1) : null;
      const limit = req.query.limit ? Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 10)) : null;

      if (page || limit || req.query.paginate === 'true') {
        const effectivePage = page || 1;
        const effectiveLimit = limit || 10;
        const [total, modules] = await Promise.all([
          prisma.agentModule.count(),
          prisma.agentModule.findMany({
            skip: (effectivePage - 1) * effectiveLimit,
            take: effectiveLimit,
            orderBy: { createdAt: 'asc' },
          }),
        ]);

        res.status(200).json({
          data: modules,
          pagination: {
            total,
            page: effectivePage,
            limit: effectiveLimit,
            totalPages: Math.ceil(total / effectiveLimit),
          },
        });
        return;
      }

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

  public static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = createAgentSchema.parse(req.body);

      const existing = await prisma.agentModule.findUnique({
        where: { code: data.code },
      });
      if (existing) {
        res.status(409).json({
          error: `Já existe um agente cadastrado com o código ${data.code}.`,
          code: 'AGENT_CODE_EXISTS',
        });
        return;
      }

      const agent = await prisma.agentModule.create({
        data: {
          name: data.name,
          code: data.code.toUpperCase(),
          description: data.description,
          category: data.category,
          extractionMode: data.extractionMode,
          rulesCount: data.targetNorms.length > 0 ? data.targetNorms.length : 12,
          targetNorms: data.targetNorms,
          systemPrompt: data.systemPrompt || null,
        },
      });

      res.status(201).json({
        message: 'Agente regulatório cadastrado com sucesso!',
        agent,
      });
    } catch (error) {
      next(error);
    }
  }

  public static async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const data = updateAgentSchema.parse(req.body);

      const updated = await prisma.agentModule.update({
        where: { id },
        data: {
          ...data,
          ...(data.code && { code: data.code.toUpperCase() }),
          ...(data.targetNorms && { rulesCount: data.targetNorms.length }),
        },
      });

      res.status(200).json({
        message: 'Agente atualizado com sucesso.',
        agent: updated,
      });
    } catch (error) {
      next(error);
    }
  }

  public static async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      await prisma.agentModule.delete({
        where: { id },
      });

      res.status(200).json({
        message: 'Módulo de agente removido com sucesso.',
      });
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

      // Validação de contexto de tags antes de iniciar
      let scrapedPage = await prisma.scrapedPage.findUnique({
        where: { url: targetUrl },
      });

      if (!scrapedPage) {
        // Se ainda não foi indexada no repositório, raspa e tagueia a página
        const initialScrape = await ScraperService.scrape(targetUrl, extractionMode || mod?.extractionMode || 'CHEERIO');
        scrapedPage = await prisma.scrapedPage.upsert({
          where: { url: targetUrl },
          update: {
            title: initialScrape.title,
            cleanMarkdown: initialScrape.cleanMarkdown,
            rawLength: initialScrape.rawHtmlLength,
            tokensCount: initialScrape.tokensEstimatedClean,
            tags: initialScrape.detectedTags,
            extractedEntities: JSON.stringify(initialScrape.extractedEntities),
          },
          create: {
            url: targetUrl,
            title: initialScrape.title,
            cleanMarkdown: initialScrape.cleanMarkdown,
            rawLength: initialScrape.rawHtmlLength,
            tokensCount: initialScrape.tokensEstimatedClean,
            tags: initialScrape.detectedTags,
            extractedEntities: JSON.stringify(initialScrape.extractedEntities),
          },
        });
      }

      // Verificação se a tag da página faz parte do contexto do agente
      const agentTags = mod?.tags || ['CFM'];
      const pageTags = scrapedPage.tags || ['CFM'];
      const isContextCompatible = agentTags.some((tag) => pageTags.includes(tag));

      if (!isContextCompatible) {
        res.status(422).json({
          error: `Incompatibilidade de contexto. As tags da página ([${pageTags.join(', ')}]) não fazem parte do contexto deste agente ([${agentTags.join(', ')}]).`,
          code: 'AGENT_CONTEXT_MISMATCH',
          pageTags,
          agentTags,
        });
        return;
      }

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
                  promptTokens: recon.promptTokens,
                  completionTokens: recon.completionTokens,
                  totalTokens: recon.totalTokens,
                  sourcesUsed: recon.sourcesUsed,
                  aiModelUsed: recon.aiModelUsed,
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

