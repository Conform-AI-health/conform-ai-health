import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { auditQueue } from '../config/redis.js';
import { Role, ExtractionMode } from '@prisma/client';
import { ScraperService } from '../services/scraperService.js';
import { FirecrawlService } from '../services/firecrawlService.js';
import { ReconciliationEngine } from '../services/reconciliationEngine.js';
import { AuditExecutionService } from '../services/auditExecutionService.js';
import { AuditSchedulerService } from '../services/auditSchedulerService.js';
import { validateSafeUrl, validateSafeUrlAsync } from '../shared/security.js';

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
  cronSchedule: z
    .string()
    .optional()
    .default('0 */6 * * *')
    .refine((val) => !val || AuditSchedulerService.isValidCron(val), {
      message: 'Expressão cron inválida. Use o formato padrão de 5 campos (ex: 0 */6 * * *)',
    }),
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
  cronSchedule: z
    .string()
    .optional()
    .refine((val) => !val || AuditSchedulerService.isValidCron(val), {
      message: 'Expressão cron inválida. Use o formato padrão de 5 campos (ex: 0 */6 * * *)',
    }),
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
      const isClient = req.user?.role === Role.CLIENT;
      const where: any = isClient
        ? {
            OR: [
              { clientId: null },
              ...(req.user?.clientId ? [{ clientId: req.user.clientId }] : []),
            ],
          }
        : {};

      const sanitize = (m: any) => {
        const item = { ...m, code: m.code || `agent-${m.id.slice(-6)}` };
        if (isClient) {
          delete (item as any).systemPrompt;
        }
        return item;
      };

      const page = req.query.page ? Math.max(1, parseInt(req.query.page as string, 10) || 1) : null;
      const limit = req.query.limit ? Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 10)) : null;

      if (page || limit || req.query.paginate === 'true') {
        const effectivePage = page || 1;
        const effectiveLimit = limit || 10;
        const [total, modules] = await Promise.all([
          prisma.agentModule.count({ where }),
          prisma.agentModule.findMany({
            where,
            skip: (effectivePage - 1) * effectiveLimit,
            take: effectiveLimit,
            orderBy: { createdAt: 'asc' },
          }),
        ]);

        res.status(200).json({
          data: modules.map(sanitize),
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
        where,
        orderBy: { createdAt: 'asc' },
      });
      res.status(200).json(modules.map(sanitize));
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

      if (req.user?.role === Role.CLIENT) {
        if (mod.clientId && mod.clientId !== req.user.clientId) {
          res.status(403).json({ error: 'Acesso negado a este módulo.', code: 'TENANT_FORBIDDEN' });
          return;
        }
        const { systemPrompt, ...sanitized } = mod;
        res.status(200).json(sanitized);
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
          name: data.name.trim(),
          code: resolvedCode,
          description: data.description ? data.description.trim() : null, // Atua como a Skill comportamental e persona da IA
          targetUrl: data.targetUrl?.trim() || null,
          tags: tagsNormalized, // Isolamento: Vínculo com resoluções ocorre exclusivamente via Tags
          category: data.category || 'DEONTOLOGIA_MEDICA',
          extractionMode: (data.extractionMode as any) || 'FIRECRAWL',
          rulesCount: tagsNormalized.length * 4,
          targetNorms: [], // Nenhuma norma ou arquivo físico .md é vinculado diretamente no cadastro
          systemPrompt: data.systemPrompt ? data.systemPrompt.trim() : (data.description ? data.description.trim() : null),
          clientId: data.clientId && data.clientId.trim().length > 0 ? data.clientId.trim() : null,
          regulatoryFramework: data.regulatoryFramework || 'Conformidade Deontológica em Saúde',
          cronSchedule: data.cronSchedule || '0 */6 * * *',
          enabled: data.enabled ?? true,
        },
      });

      // Sincroniza o agendador contínuo para o novo módulo
      await AuditSchedulerService.syncAgentSchedule(agent.id);

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

      const resolvedClientId =
        data.clientId !== undefined
          ? data.clientId && data.clientId.trim().length > 0
            ? data.clientId.trim()
            : null
          : undefined;

      const resolvedDescription = data.description !== undefined ? data.description.trim() : undefined;
      const resolvedSystemPrompt =
        data.systemPrompt !== undefined
          ? data.systemPrompt.trim()
          : resolvedDescription !== undefined
          ? resolvedDescription
          : undefined;

      const updated = await prisma.agentModule.update({
        where: { id },
        data: {
          ...(data.name && { name: data.name.trim() }),
          ...(data.targetUrl !== undefined && { targetUrl: data.targetUrl?.trim() || null }),
          ...(resolvedDescription !== undefined && { description: resolvedDescription }),
          ...(resolvedSystemPrompt !== undefined && { systemPrompt: resolvedSystemPrompt }),
          ...(tagsNormalized && { tags: tagsNormalized, rulesCount: tagsNormalized.length * 4 }),
          ...(data.code && { code: data.code.trim().toUpperCase() }),
          ...(data.enabled !== undefined && { enabled: data.enabled }),
          ...(data.category && { category: data.category }),
          ...(data.extractionMode && { extractionMode: data.extractionMode as any }),
          ...(resolvedClientId !== undefined && { clientId: resolvedClientId }),
          ...(data.cronSchedule !== undefined && { cronSchedule: data.cronSchedule?.trim() || '0 */6 * * *' }),
        },
      });

      // Sincroniza a programação contínua do agente atualizado
      await AuditSchedulerService.syncAgentSchedule(updated.id);

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

      // Remove do agendador contínuo
      await AuditSchedulerService.removeAgentSchedule(id);

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

      // Validação de Tenant e Restrição de URL Alvo anti-SSRF (T02 / T05)
      let effectiveClientId: string;
      let effectiveTargetUrl: string;
      let client: any = null;

      if (req.user?.role === Role.CLIENT) {
        if (!req.user.clientId) {
          res.status(403).json({
            error: 'Acesso negado. Usuário do tipo cliente sem clínica associada.',
            code: 'TENANT_FORBIDDEN',
          });
          return;
        }

        effectiveClientId = req.user.clientId;
        client = await prisma.client.findUnique({
          where: { id: effectiveClientId },
        });

        if (!client || client.status !== 'ATIVO') {
          res.status(403).json({
            error: 'Clínica inativa ou não encontrada.',
            code: 'CLIENT_INACTIVE',
          });
          return;
        }

        // Clientes não podem fornecer URLs arbitrárias fora da cadastrada na clínica
        if (parsedBody.targetUrl && parsedBody.targetUrl.trim() !== (client.websiteUrl || '').trim()) {
          res.status(403).json({
            error: 'Acesso negado. Clientes só podem disparar auditorias para a URL oficial cadastrada em sua clínica.',
            code: 'ARBITRARY_TARGET_URL_FORBIDDEN',
          });
          return;
        }

        effectiveTargetUrl = (client.websiteUrl || '').trim();
        if (!effectiveTargetUrl) {
          res.status(400).json({
            error: 'A clínica não possui websiteUrl cadastrado para realização de auditoria.',
            code: 'MISSING_CLIENT_URL',
          });
          return;
        }

        const safeCheck = validateSafeUrl(effectiveTargetUrl);
        if (!safeCheck.safe) {
          res.status(400).json({
            error: `URL cadastrada da clínica é inválida ou insegura: ${safeCheck.reason}`,
            code: 'SSRF_BLOCKED',
          });
          return;
        }
      } else {
        effectiveTargetUrl = parsedBody.targetUrl || mod.targetUrl || '';
        if (!effectiveTargetUrl) {
          res.status(400).json({ error: 'Nenhuma URL Alvo informada no módulo ou no disparo da auditoria.' });
          return;
        }

        // Validação anti-SSRF completa com resolução DNS assíncrona para auditores e admins
        const safeCheck = await validateSafeUrlAsync(effectiveTargetUrl);
        if (!safeCheck.safe) {
          res.status(400).json({
            error: `URL Alvo rejeitada por política de segurança: ${safeCheck.reason}`,
            code: 'SSRF_BLOCKED',
          });
          return;
        }

        effectiveClientId = parsedBody.clientId || mod.clientId || '';
        if (!effectiveClientId) {
          const firstClient = await prisma.client.findFirst({ where: { status: 'ATIVO' } });
          if (firstClient) {
            effectiveClientId = firstClient.id;
            client = firstClient;
          } else {
            const defaultClient = await prisma.client.create({
              data: {
                name: 'Clínica Principal Auditada',
                websiteUrl: effectiveTargetUrl,
                status: 'ATIVO',
              },
            });
            effectiveClientId = defaultClient.id;
            client = defaultClient;
          }
        } else {
          client = await prisma.client.findUnique({
            where: { id: effectiveClientId },
          });
        }
      }

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

