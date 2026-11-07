import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { auditQueue } from '../config/redis.js';
import { Role, ExtractionMode } from '@prisma/client';
import { ScraperService } from '../services/scraperService.js';
import { FirecrawlService } from '../services/firecrawlService.js';
import { ReconciliationEngine } from '../services/reconciliationEngine.js';
import { AuditExecutionService } from '../services/auditExecutionService.js';

const createAgentSchema = z.object({
  name: z.string().min(2, 'Nome do Módulo é obrigatório'),
  targetUrl: z.string().min(3, 'URL Alvo é obrigatória').optional().nullable(),
  description: z.string().min(2, 'Descrição e Escopo (Skill da IA) é obrigatório').optional().default('Auditor Deontológico de Saúde'),
  tags: z.array(z.string()).optional().default(['cfm']),
  code: z.string().optional().nullable().or(z.literal('')),
  category: z.string().optional().default('DEONTOLOGIA_MEDICA'),
  extractionMode: z.enum(['PUPPETEER', 'CHEERIO', 'FALLBACK_AI', 'MCP', 'FIRECRAWL', 'DATALINK']).optional().default('FIRECRAWL'),
  targetNorms: z.array(z.string()).optional().default([]),
  systemPrompt: z.string().optional(),
  clientId: z.string().optional().nullable(),
  regulatoryFramework: z.string().optional().default('CFM (Resolução 2.336/2023)'),
  cronSchedule: z.string().optional().default('0 */6 * * *'),
  enabled: z.boolean().optional().default(true),
});

const updateAgentSchema = z.object({
  name: z.string().min(2).optional(),
  targetUrl: z.string().optional().nullable(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  code: z.string().optional().nullable(),
  category: z.string().optional(),
  extractionMode: z.enum(['PUPPETEER', 'CHEERIO', 'FALLBACK_AI', 'MCP', 'FIRECRAWL', 'DATALINK']).optional(),
  targetNorms: z.array(z.string()).optional(),
  systemPrompt: z.string().optional(),
  clientId: z.string().optional().nullable(),
  regulatoryFramework: z.string().optional(),
  cronSchedule: z.string().optional(),
  enabled: z.boolean().optional(),
});

const runAuditSchema = z.object({
  clientId: z.string().optional(),
  targetUrl: z.string().optional(),
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

      // Normalização das tags informadas manualmente pelo operador
      const tagsNormalized = Array.isArray(data.tags)
        ? data.tags.map((t: string) => t.trim().toLowerCase()).filter(Boolean)
        : ['cfm'];

      const agent = await prisma.agentModule.create({
        data: {
          name: data.name,
          code: resolvedCode,
          description: data.description, // Atua como a Skill comportamental e persona da IA
          targetUrl: data.targetUrl || null,
          tags: tagsNormalized, // Isolamento: Vínculo com resoluções ocorre exclusivamente via Tags
          category: data.category || 'DEONTOLOGIA_MEDICA',
          extractionMode: (data.extractionMode as any) || 'FIRECRAWL',
          rulesCount: tagsNormalized.length * 4,
          targetNorms: [], // Nenhuma norma ou arquivo físico .md é vinculado diretamente no cadastro
          systemPrompt: data.systemPrompt || null,
          clientId: data.clientId || null,
          regulatoryFramework: data.regulatoryFramework || 'Conformidade Deontológica em Saúde',
          cronSchedule: data.cronSchedule || '0 */6 * * *',
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

      const tagsNormalized =
        data.tags && Array.isArray(data.tags)
          ? data.tags.map((t: string) => t.trim().toLowerCase()).filter(Boolean)
          : undefined;

      const updated = await prisma.agentModule.update({
        where: { id },
        data: {
          ...(data.name && { name: data.name }),
          ...(data.targetUrl !== undefined && { targetUrl: data.targetUrl }),
          ...(data.description !== undefined && { description: data.description }),
          ...(tagsNormalized && { tags: tagsNormalized, rulesCount: tagsNormalized.length * 4 }),
          ...(data.code && { code: data.code.toUpperCase() }),
          ...(data.enabled !== undefined && { enabled: data.enabled }),
          ...(data.category && { category: data.category }),
          ...(data.extractionMode && { extractionMode: data.extractionMode as any }),
          ...(data.clientId !== undefined && { clientId: data.clientId }),
        },
      });

      res.status(200).json({
        message: 'Módulo de agente atualizado com sucesso.',
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
      const parsedBody = runAuditSchema.parse(req.body);

      const mod = await prisma.agentModule.findUnique({
        where: { id: agentModuleId },
      });

      if (!mod) {
        res.status(404).json({ error: 'Módulo de agente não encontrado.' });
        return;
      }

      // A URL Alvo vem do cadastro do módulo ou do corpo da requisição
      const effectiveTargetUrl = parsedBody.targetUrl || mod.targetUrl;
      if (!effectiveTargetUrl) {
        res.status(400).json({ error: 'Nenhuma URL Alvo informada no módulo ou no disparo da auditoria.' });
        return;
      }

      // Resolução da clínica vinculada ou clínica ativa padrão
      let effectiveClientId = parsedBody.clientId || mod.clientId;
      if (!effectiveClientId) {
        const firstClient = await prisma.client.findFirst({ where: { status: 'ATIVO' } });
        if (firstClient) {
          effectiveClientId = firstClient.id;
        } else {
          const defaultClient = await prisma.client.create({
            data: {
              name: 'Clínica Principal Auditada',
              websiteUrl: effectiveTargetUrl,
              status: 'ATIVO',
            },
          });
          effectiveClientId = defaultClient.id;
        }
      }

      // Isolamento multi-tenant: CLIENT só pode disparar auditoria para si mesmo
      if (req.user?.role === Role.CLIENT && req.user.clientId !== effectiveClientId) {
        res.status(403).json({
          error: 'Acesso negado. Você só pode disparar auditorias para a sua própria clínica.',
          code: 'TENANT_FORBIDDEN',
        });
        return;
      }

      const client = await prisma.client.findUnique({
        where: { id: effectiveClientId },
      });

      const clientName = client?.name || 'Clínica Auditada';
      const effectiveSkill = parsedBody.skill || mod.description || 'compliance-specialist';
      const effectiveMode: ExtractionMode = 'FIRECRAWL' as any;

      // Criação inicial do laudo em estado QUEUED
      const report = await prisma.auditReport.create({
        data: {
          clientId: effectiveClientId,
          targetUrl: effectiveTargetUrl,
          extractionMode: effectiveMode,
          status: 'QUEUED',
          summary: `Auditoria disparada no Cockpit para módulo ${mod.name} (Tags: ${mod.tags.join(', ')}).`,
          score: 0,
        },
      });

      // Registro do momento de disparo no Terminal de Logs Operacionais
      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          module: 'COCKPIT',
          correlationId: report.id,
          message: `[COCKPIT] Disparo de Auditoria iniciado para "${clientName}" | Módulo: "${mod.name}" | URL: ${effectiveTargetUrl} | Tags: [${mod.tags.join(', ')}] | Modo: FIRECRAWL`,
          details: JSON.stringify({
            auditReportId: report.id,
            moduleId: mod.id,
            moduleName: mod.name,
            targetUrl: effectiveTargetUrl,
            tags: mod.tags,
            skill: effectiveSkill,
            extractionMode: 'FIRECRAWL',
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
            clientId: effectiveClientId,
            targetUrl: effectiveTargetUrl,
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
        console.warn(`[AgentController] Redis em fallback (${queueErr.message}). Processando job sincronicamente...`);
      }

      // Processamento assíncrono direto se Redis estiver ausente/fallback
      if (!queuedViaRedis) {
        setImmediate(async () => {
          try {
            await AuditExecutionService.execute({
              auditReportId: report.id,
              clientId: effectiveClientId,
              targetUrl: effectiveTargetUrl,
              agentModuleId,
              skill: effectiveSkill,
              extractionMode: effectiveMode,
            });
          } catch (execErr: any) {
            console.error(`[AgentController] Erro no pipeline de auditoria do módulo ${agentModuleId}:`, execErr);
          }
        });
      }

      res.status(202).json({
        message: 'Auditoria de governança de módulo iniciada com sucesso.',
        reportId: report.id,
        targetUrl: effectiveTargetUrl,
        extractionMode: 'FIRECRAWL',
        tags: mod.tags,
      });
    } catch (error) {
      next(error);
    }
  }
}

