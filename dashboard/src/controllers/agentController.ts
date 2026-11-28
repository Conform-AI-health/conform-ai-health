import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AgentService } from '../services/agentService.js';
import { AuditSchedulerService } from '../services/auditSchedulerService.js';

const agentFieldsSchema = z.object({
  name: z.string().min(2, 'Nome do agente é obrigatório'),
  code: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  category: z.string().optional().default('DEONTOLOGIA_MEDICA'),
  extractionMode: z.enum(['PUPPETEER', 'CHEERIO', 'FALLBACK_AI', 'MCP', 'FIRECRAWL']).default('FIRECRAWL'),
  tags: z.array(z.string()).default(['cfm']),
  targetUrl: z
    .string()
    .url('Formato de URL inválido')
    .refine((val) => val.startsWith('http://') || val.startsWith('https://'), {
      message: 'Apenas os protocolos HTTP e HTTPS são permitidos.',
    })
    .optional()
    .nullable()
    .or(z.literal('')),
  systemPrompt: z.string().optional().nullable(),
  clientId: z.string().optional().nullable(),
  regulatoryFramework: z.string().optional().default('Conformidade Deontológica em Saúde'),
  cronSchedule: z
    .string()
    .optional()
    .nullable()
    .refine((val) => !val || AuditSchedulerService.isValidCron(val), {
      message: 'Expressão cron inválida. Deve seguir o padrão UNIX de 5 campos (ex: "0 */6 * * *").',
    }),
  hasAuth: z.boolean().optional().default(false),
  authUsername: z.string().optional().nullable(),
  authPassword: z.string().optional().nullable(),
  enabled: z.boolean().optional().default(true),
});

const createAgentSchema = agentFieldsSchema;

const updateAgentSchema = agentFieldsSchema.partial().extend({
  cronSchedule: z
    .string()
    .optional()
    .nullable()
    .refine((val) => !val || AuditSchedulerService.isValidCron(val), {
      message: 'Expressão cron inválida. Deve seguir o padrão UNIX de 5 campos (ex: "0 */6 * * *").',
    }),
});

const runAuditSchema = z.object({
  clientId: z.string().optional().nullable(),
  targetUrl: z
    .string()
    .url('Formato de URL inválido')
    .refine((val) => val.startsWith('http://') || val.startsWith('https://'), {
      message: 'Apenas os protocolos HTTP e HTTPS são permitidos.',
    })
    .optional()
    .nullable(),
  extractionMode: z.enum(['PUPPETEER', 'CHEERIO', 'FALLBACK_AI', 'MCP', 'FIRECRAWL']).optional(),
  hasAuth: z.boolean().optional(),
  authUsername: z.string().optional().nullable(),
  authPassword: z.string().optional().nullable(),
});

export class AgentController {
  public static async listModules(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const page = req.query.page ? Math.max(1, parseInt(req.query.page as string, 10) || 1) : null;
      const limit = req.query.limit ? Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 10)) : null;
      const paginate = req.query.paginate === 'true';

      const result = await AgentService.listModules({
        page,
        limit,
        paginate,
        currentUser: req.user,
      });

      if (result.pagination) {
        res.status(200).json(result);
      } else {
        res.status(200).json(result.data);
      }
    } catch (error) {
      next(error);
    }
  }

  public static async getModuleById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const mod = await AgentService.getModuleById(id, req.user);
      res.status(200).json(mod);
    } catch (error: any) {
      if (error.message === 'AGENT_NOT_FOUND') {
        res.status(404).json({ error: 'Módulo de agente não encontrado.' });
        return;
      }
      if (error.message === 'TENANT_FORBIDDEN') {
        res.status(403).json({ error: 'Acesso negado a este módulo.', code: 'TENANT_FORBIDDEN' });
        return;
      }
      next(error);
    }
  }

  public static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = createAgentSchema.parse(req.body);
      const agent = await AgentService.createAgent(data);

      res.status(201).json({
        message: 'Agente regulatório cadastrado com sucesso!',
        agent,
      });
    } catch (error: any) {
      if (error.message === 'AGENT_CODE_EXISTS') {
        res.status(409).json({
          error: 'Já existe um agente cadastrado com este código.',
          code: 'AGENT_CODE_EXISTS',
        });
        return;
      }
      next(error);
    }
  }

  public static async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const data = updateAgentSchema.parse(req.body);
      const updated = await AgentService.updateAgent(id, data);

      res.status(200).json({
        message: 'Módulo de agente atualizado com sucesso.',
        agent: updated,
      });
    } catch (error: any) {
      if (error.message === 'AGENT_NOT_FOUND') {
        res.status(404).json({ error: 'Módulo de agente não encontrado para atualização.' });
        return;
      }
      next(error);
    }
  }

  public static async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      await AgentService.deleteAgent(id);

      res.status(200).json({
        message: 'Módulo de agente removido com sucesso.',
      });
    } catch (error: any) {
      if (error.message === 'AGENT_NOT_FOUND') {
        res.status(404).json({ error: 'Módulo de agente não encontrado.' });
        return;
      }
      next(error);
    }
  }

  public static async runAudit(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id: agentModuleId } = req.params;
      const parsedBody = runAuditSchema.parse(req.body);

      const result = await AgentService.runAudit(agentModuleId, parsedBody, req.user);

      res.status(202).json({
        message: 'Auditoria regulatória sob demanda enfileirada com sucesso!',
        auditReportId: result.report.id,
        jobId: result.jobId,
        status: 'PENDING',
      });
    } catch (error: any) {
      if (error.message === 'AGENT_NOT_FOUND') {
        res.status(404).json({ error: 'Módulo de agente não encontrado.' });
        return;
      }
      if (error.message === 'TENANT_FORBIDDEN') {
        res.status(403).json({
          error: 'Acesso negado. Usuário do tipo cliente sem clínica associada.',
          code: 'TENANT_FORBIDDEN',
        });
        return;
      }
      if (error.message === 'CLIENT_INACTIVE') {
        res.status(403).json({
          error: 'Clínica inativa ou não encontrada.',
          code: 'CLIENT_INACTIVE',
        });
        return;
      }
      if (error.message === 'ARBITRARY_TARGET_URL_FORBIDDEN') {
        res.status(403).json({
          error: 'Acesso negado. Clientes só podem disparar auditorias para a URL oficial cadastrada em sua clínica.',
          code: 'ARBITRARY_TARGET_URL_FORBIDDEN',
        });
        return;
      }
      if (error.message === 'NO_TARGET_URL') {
        res.status(400).json({
          error: 'Nenhuma URL de auditoria configurada para este módulo e nenhuma informada na requisição.',
          code: 'TARGET_URL_REQUIRED',
        });
        return;
      }
      if (error.message?.startsWith('SSRF_VIOLATION:')) {
        res.status(400).json({
          error: error.message,
          code: 'SSRF_SECURITY_VIOLATION',
        });
        return;
      }
      next(error);
    }
  }
}
