import { AgentRepository } from '../repositories/agentRepository.js';
import { ClientRepository } from '../repositories/clientRepository.js';
import { ReportRepository } from '../repositories/reportRepository.js';
import { AuditSchedulerService } from './auditSchedulerService.js';
import { auditQueue } from '../config/redis.js';
import { encryptSecret, maskSecret, decryptSecret } from '../shared/encryption.js';
import { validateSafeUrlAsync } from '../shared/security.js';
import { injectTraceCarrier } from '../shared/tracing.js';
import { resolveClientByIdOrUrl } from '../shared/clientIdentityResolver.js';
import { AIInvocationCacheService } from './ai/aiInvocationCache.js';
import { Role } from '@prisma/client';

export class AgentService {
  /**
   * Sanitização de visualização do módulo (mascaramento de senhas e ocultação de prompt para CLIENT)
   */
  public static sanitizeModule(m: any, isClient: boolean = false, isVisitor: boolean = false) {
    const item = {
      ...m,
      code: m.code || `agent-${m.id.slice(-6)}`,
      authPassword: m.authPassword ? maskSecret(m.authPassword) : null,
    };
    if (isClient) {
      delete (item as any).systemPrompt;
    }
    if (isVisitor) {
      delete item.authUsername;
      delete item.authPassword;
    }
    return item;
  }

  /**
   * Listagem de módulos de agente com suporte a paginação e filtro por tenant
   */
  public static async listModules(params: {
    page?: number | null;
    limit?: number | null;
    paginate?: boolean;
    currentUser?: { role: string; clientId?: string | null };
  }) {
    const isClient = params.currentUser?.role === Role.CLIENT;
    const isVisitor = params.currentUser?.role === Role.VIEWER;
    const where: any = isClient
      ? {
          OR: [
            { clientId: null },
            ...(params.currentUser?.clientId ? [{ clientId: params.currentUser.clientId }] : []),
          ],
        }
      : {};

    if (params.page || params.limit || params.paginate) {
      const page = params.page || 1;
      const limit = params.limit || 10;
      const [total, modules] = await Promise.all([
        AgentRepository.count(where),
        AgentRepository.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { createdAt: 'asc' },
        }),
      ]);

      return {
        data: modules.map((m) => this.sanitizeModule(m, isClient, isVisitor)),
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 1,
        },
      };
    }

    const modules = await AgentRepository.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });

    return {
      data: modules.map((m) => this.sanitizeModule(m, isClient, isVisitor)),
    };
  }

  /**
   * Detalhes de um módulo por ID
   */
  public static async getModuleById(id: string, currentUser?: { role: string; clientId?: string | null }) {
    const mod = await AgentRepository.findById(id);
    if (!mod) {
      throw new Error('AGENT_NOT_FOUND');
    }

    const isClient = currentUser?.role === Role.CLIENT;
    const isVisitor = currentUser?.role === Role.VIEWER;
    if (isClient && mod.clientId && mod.clientId !== currentUser?.clientId) {
      throw new Error('TENANT_FORBIDDEN');
    }

    return this.sanitizeModule(mod, isClient, isVisitor);
  }

  /**
   * Criação de novo módulo de agente
   */
  public static async createAgent(data: any) {
    const resolvedCode =
      data.code && data.code.trim().length > 0
        ? data.code.trim()
        : `${data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${Date.now().toString(36)}`;

    const existing = await AgentRepository.findByCode(resolvedCode);
    if (existing) {
      throw new Error('AGENT_CODE_EXISTS');
    }

    const tagsNormalized = Array.isArray(data.tags)
      ? data.tags.map((t: string) => t.trim().toLowerCase()).filter(Boolean)
      : ['cfm'];

    const requestedClientId = data.clientId && data.clientId.trim().length > 0 ? data.clientId.trim() : null;
    const matchedClientOnCreate = await resolveClientByIdOrUrl({
      clientId: requestedClientId,
      targetUrl: data.targetUrl?.trim() || null,
      moduleName: data.name?.trim() || null,
    });

    const agent = await AgentRepository.create({
      name: data.name.trim(),
      code: resolvedCode,
      description: data.description ? data.description.trim() : null,
      targetUrl: data.targetUrl?.trim() || null,
      tags: tagsNormalized,
      category: data.category || 'DEONTOLOGIA_MEDICA',
      extractionMode: (data.extractionMode as any) || 'FIRECRAWL',
      rulesCount: tagsNormalized.length * 4,
      targetNorms: [],
      systemPrompt: data.systemPrompt ? data.systemPrompt.trim() : (data.description ? data.description.trim() : null),
      clientId: matchedClientOnCreate?.id || requestedClientId,
      regulatoryFramework: data.regulatoryFramework || 'Conformidade Deontológica em Saúde',
      cronSchedule: data.cronSchedule || '0 */6 * * *',
      hasAuth: data.hasAuth ?? false,
      authUsername: data.authUsername ? data.authUsername.trim() : null,
      authPassword: data.authPassword ? encryptSecret(data.authPassword.trim()) : null,
      enabled: data.enabled ?? true,
    });

    await AuditSchedulerService.syncAgentSchedule(agent.id);

    return this.sanitizeModule(agent, false);
  }

  /**
   * Atualização de módulo existente
   */
  public static async updateAgent(id: string, data: any) {
    const existing = await AgentRepository.findById(id);
    if (!existing) {
      throw new Error('AGENT_NOT_FOUND');
    }

    const updateData: any = { ...data };

    if (data.tags && Array.isArray(data.tags)) {
      updateData.tags = data.tags.map((t: string) => t.trim().toLowerCase()).filter(Boolean);
      updateData.rulesCount = updateData.tags.length * 4;
    }

    if (data.authPassword !== undefined) {
      if (!data.authPassword || data.authPassword.trim().length === 0 || data.authPassword.includes('****')) {
        delete updateData.authPassword;
      } else {
        updateData.authPassword = encryptSecret(data.authPassword.trim());
      }
    }

    const nextName = typeof data.name === 'string' ? data.name.trim() : existing.name;
    const nextUrl = typeof data.targetUrl === 'string' ? data.targetUrl.trim() : existing.targetUrl;
    if (data.clientId !== undefined || data.name !== undefined || data.targetUrl !== undefined) {
      const candidateClientId =
        data.clientId !== undefined
          ? data.clientId && String(data.clientId).trim().length > 0
            ? String(data.clientId).trim()
            : null
          : existing.clientId;
      const reconciledClient = await resolveClientByIdOrUrl({
        clientId: candidateClientId,
        targetUrl: nextUrl,
        moduleName: nextName,
      });
      if (reconciledClient?.id) {
        updateData.clientId = reconciledClient.id;
      } else if (data.clientId !== undefined) {
        updateData.clientId = candidateClientId;
      }
    }

    const updated = await AgentRepository.update(id, updateData);
    await AIInvocationCacheService.invalidateByAgent(updated.id, 'agent_config_updated');
    if (updated.code) {
      await AIInvocationCacheService.invalidateByAgent(updated.code, 'agent_config_updated');
    }
    await AuditSchedulerService.syncAgentSchedule(updated.id);

    return this.sanitizeModule(updated, false);
  }

  /**
   * Exclusão de módulo de agente
   */
  public static async deleteAgent(id: string) {
    const existing = await AgentRepository.findById(id);
    if (!existing) {
      throw new Error('AGENT_NOT_FOUND');
    }

    await AIInvocationCacheService.invalidateByAgent(existing.id, 'agent_deleted');
    if (existing.code) {
      await AIInvocationCacheService.invalidateByAgent(existing.code, 'agent_deleted');
    }
    await AgentRepository.delete(id);
    await AuditSchedulerService.removeAgentSchedule(id);
  }

  /**
   * Disparo imediato de auditoria para o módulo (Cockpit)
   */
  public static async runAudit(agentModuleId: string, options: { clientId?: string | null; targetUrl?: string | null; extractionMode?: any; authUsername?: string | null; authPassword?: string | null }, currentUser?: { role: string; clientId?: string | null }) {
    const mod = await AgentRepository.findById(agentModuleId);
    if (!mod) {
      throw new Error('AGENT_NOT_FOUND');
    }

    let effectiveClientId: string | undefined;
    let effectiveTargetUrl: string;

    if (currentUser?.role === Role.VIEWER) {
      effectiveTargetUrl = (mod.targetUrl || '').trim();
      effectiveClientId = mod.clientId || undefined;
    } else if (currentUser?.role === Role.CLIENT) {
      if (!currentUser.clientId) {
        throw new Error('TENANT_FORBIDDEN');
      }

      effectiveClientId = currentUser.clientId;
      const client = await ClientRepository.findById(effectiveClientId);

      if (!client || client.status !== 'ATIVO') {
        throw new Error('CLIENT_INACTIVE');
      }

      if (options.targetUrl && options.targetUrl.trim() !== (client.websiteUrl || '').trim()) {
        throw new Error('ARBITRARY_TARGET_URL_FORBIDDEN');
      }

      effectiveTargetUrl = (client.websiteUrl || '').trim();
    } else {
      effectiveTargetUrl = (options.targetUrl || mod.targetUrl || '').trim();
      const explicitClientId =
        options.clientId && options.clientId.trim().length > 0
          ? options.clientId.trim()
          : mod.clientId || null;
      const reconciledClient = await resolveClientByIdOrUrl({
        clientId: explicitClientId,
        targetUrl: effectiveTargetUrl,
        moduleName: mod.name,
      });
      effectiveClientId = reconciledClient?.id || explicitClientId || undefined;
    }

    if (!effectiveTargetUrl) {
      throw new Error('NO_TARGET_URL');
    }

    const safeCheck = await validateSafeUrlAsync(effectiveTargetUrl);
    if (!safeCheck.safe) {
      throw new Error(`SSRF_VIOLATION: ${safeCheck.reason}`);
    }

    const extractionMode = currentUser?.role === Role.VIEWER
      ? mod.extractionMode || 'CHEERIO'
      : options.extractionMode || mod.extractionMode || 'CHEERIO';

    const report = await ReportRepository.create({
      client: effectiveClientId ? { connect: { id: effectiveClientId } } : undefined,
      targetUrl: effectiveTargetUrl,
      extractionMode,
      status: 'PENDING',
      summary: `Auditoria sob demanda iniciada pelo módulo "${mod.name}".`,
    });

    let authPayload: any = undefined;
    if (mod.hasAuth && mod.authUsername && mod.authPassword) {
      authPayload = {
        username: mod.authUsername,
        password: decryptSecret(mod.authPassword) || mod.authPassword,
      };
    }

    const job = await auditQueue.add(
      'auditJob',
      {
        auditReportId: report.id,
        clientId: effectiveClientId || '',
        targetUrl: effectiveTargetUrl,
        extractionMode,
        agentModuleId: mod.id,
        skill: mod.description || undefined,
        auth: authPayload,
        traceContext: injectTraceCarrier(),
      },
      { jobId: `audit-${report.id}` }
    );

    return { report, jobId: job.id };
  }
}
