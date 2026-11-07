import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { auditQueue } from '../config/redis.js';
import { Role, ExtractionMode } from '@prisma/client';
import { ScraperService } from '../services/scraperService.js';
import { ReconciliationEngine } from '../services/reconciliationEngine.js';

const createAgentSchema = z.object({
  name: z.string().min(2, 'Nome do Agente é obrigatório'),
  code: z.string().optional().nullable().or(z.literal('')),
  description: z.string().optional().default(''),
  category: z.string().default('DEONTOLOGIA_MEDICA'),
  extractionMode: z.enum(['PUPPETEER', 'CHEERIO', 'FALLBACK_AI', 'MCP', 'FIRECRAWL', 'DATALINK']).default('CHEERIO'),
  targetNorms: z.array(z.string()).default([]),
  systemPrompt: z.string().optional(),
  clientId: z.string().optional().nullable(),
  regulatoryFramework: z.string().optional().default('CFM (Resolução 2.336/2023)'),
  cronSchedule: z.string().optional().default('0 */6 * * *'),
  targetUrl: z.string().optional().nullable(),
  enabled: z.boolean().optional().default(true),
});

const updateAgentSchema = createAgentSchema.partial();

const runAuditSchema = z.object({
  clientId: z.string().min(1, 'clientId é obrigatório'),
  targetUrl: z.string().url('targetUrl deve ser uma URL válida'),
  extractionMode: z.enum(['PUPPETEER', 'CHEERIO', 'FALLBACK_AI', 'MCP', 'FIRECRAWL', 'DATALINK']).optional(),
  skill: z.string().optional(),
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
          data: modules.map((m) => ({ ...m, code: m.code || `agent-${m.id.slice(-6)}` })),
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
      res.status(200).json(modules.map((m) => ({ ...m, code: m.code || `agent-${m.id.slice(-6)}` })));
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

      const resolvedCode =
        data.code && data.code.trim().length > 0
          ? data.code.trim()
          : `${data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${Date.now().toString(36)}`;

      const existing = await prisma.agentModule.findUnique({
        where: { code: resolvedCode },
      });
      if (existing) {
        res.status(409).json({
          error: `Já existe um agente cadastrado com o código ${resolvedCode}.`,
          code: 'AGENT_CODE_EXISTS',
        });
        return;
      }

      const agent = await prisma.agentModule.create({
        data: {
          name: data.name,
          code: resolvedCode,
          description: data.description,
          category: data.category,
          extractionMode: data.extractionMode as any,
          rulesCount: data.targetNorms.length > 0 ? data.targetNorms.length : 12,
          targetNorms: data.targetNorms,
          systemPrompt: data.systemPrompt || null,
          clientId: data.clientId || null,
          regulatoryFramework: data.regulatoryFramework,
          cronSchedule: data.cronSchedule,
          targetUrl: data.targetUrl || null,
          enabled: data.enabled ?? true,
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
      const { clientId, targetUrl, extractionMode, skill } = runAuditSchema.parse(req.body);

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
      const effectiveSkill = skill || 'compliance-specialist';

      // Criação inicial do laudo em estado QUEUED
      const report = await prisma.auditReport.create({
        data: {
          clientId,
          targetUrl,
          extractionMode: effectiveMode,
          status: 'QUEUED',
          summary: `Auditoria disparada no Cockpit com agente ${mod?.code || 'CFM'} e skill ${effectiveSkill}.`,
          score: 0,
        },
      });

      // Registro do momento de disparo no Terminal de Logs Operacionais
      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          module: 'COCKPIT',
          correlationId: report.id,
          message: `[COCKPIT] Disparo de Auditoria iniciado para "${client.name}" | URL: ${targetUrl} | Agente: ${mod?.code || 'CFM'} | Skill: ${effectiveSkill} | Modo: ${effectiveMode}`,
          details: JSON.stringify({
            auditReportId: report.id,
            clientId,
            clientName: client.name,
            targetUrl,
            agentCode: mod?.code,
            skill: effectiveSkill,
            extractionMode: effectiveMode,
            timestamp: new Date().toISOString(),
          }),
        },
      }).catch(() => {});

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
            skill: effectiveSkill,
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

            await prisma.systemLog.create({
              data: {
                level: 'INFO',
                module: 'SCRAPER',
                correlationId: report.id,
                message: `[SCRAPER] Iniciando extração web via ${effectiveMode} para ${targetUrl}...`,
              },
            }).catch(() => {});

            const startTime = Date.now();
            const scrape = await ScraperService.scrape(targetUrl, effectiveMode);

            await prisma.systemLog.create({
              data: {
                level: 'INFO',
                module: 'SCRAPER',
                correlationId: report.id,
                message: `[SCRAPER] Extração concluída (${effectiveMode}): "${scrape.title || targetUrl}" | ${scrape.rawHtmlLength} bytes processados | ${scrape.tokensEstimatedClean} tokens limpos (economia de ${Math.max(0, scrape.tokensEstimatedRaw - scrape.tokensEstimatedClean)} tokens).`,
              },
            }).catch(() => {});

            await prisma.systemLog.create({
              data: {
                level: 'INFO',
                module: 'AI_ENGINE',
                correlationId: report.id,
                message: `[AI_INTERACTION] Enviando contexto para o motor de IA | Agente: ${mod?.code || 'CFM'} | Skill: ${effectiveSkill} | Contexto: ${scrape.tokensEstimatedClean} tokens.`,
              },
            }).catch(() => {});

            const recon = await ReconciliationEngine.reconcile(scrape, agentModuleId);
            const executionTimeMs = Date.now() - startTime;

            await prisma.systemLog.create({
              data: {
                level: 'INFO',
                module: 'AI_ENGINE',
                correlationId: report.id,
                message: `[AI_INTERACTION] Resposta recebida do motor ${recon.aiModelUsed || 'gemini'} | Prompt Tokens: ${recon.promptTokens} | Completion Tokens: ${recon.completionTokens} | Total Tokens: ${recon.totalTokens} | Latência: ${executionTimeMs}ms`,
                details: JSON.stringify({
                  aiModelUsed: recon.aiModelUsed,
                  skill: effectiveSkill,
                  promptTokens: recon.promptTokens,
                  completionTokens: recon.completionTokens,
                  totalTokens: recon.totalTokens,
                  executionTimeMs,
                }),
              },
            }).catch(() => {});

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

            await prisma.systemLog.create({
              data: {
                level: 'INFO',
                module: 'RECONCILIATION',
                correlationId: report.id,
                message: `[RECONCILIATION] Reconciliação deontológica concluída | Veredito: ${recon.verdict} | Score: ${recon.score}/100 | ${recon.violations.length} não-conformidade(s) detectada(s) | Laudo ID: ${report.id}`,
              },
            }).catch(() => {});

            console.log(`✅ [Direct Worker Fallback] Auditoria ${report.id} concluída com sucesso!`);
          } catch (execErr: any) {
            console.error(`❌ [Direct Worker Fallback] Falha na auditoria ${report.id}:`, execErr);
            await prisma.systemLog.create({
              data: {
                level: 'ERROR',
                module: 'COCKPIT',
                correlationId: report.id,
                message: `[ERROR] Falha técnica durante execução da auditoria: ${execErr.message}`,
              },
            }).catch(() => {});

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

