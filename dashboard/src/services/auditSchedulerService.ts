import parser from 'cron-parser';
import { prisma } from '../config/prisma.js';
import { auditQueue, getRedisConnection } from '../config/redis.js';
import { AuditExecutionService } from './auditExecutionService.js';
import { decryptSecret } from '../shared/encryption.js';

interface ScheduledAgentState {
  agentId: string;
  agentName: string;
  targetUrl: string;
  cronSchedule: string;
  clientId?: string | null;
  lastRunAt?: Date;
  nextRunAt?: Date;
}

export class AuditSchedulerService {
  private static activeSchedules: Map<string, ScheduledAgentState> = new Map();
  private static runningAudits: Set<string> = new Set();
  private static isInitialized = false;

  /**
   * Valida sintaticamente uma expressão cron de 5 campos (minuto hora dia mês dia-da-semana)
   */
  public static isValidCron(cron: string): boolean {
    if (!cron || typeof cron !== 'string') return false;
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5 && parts.length !== 6) return false;
    try {
      parser.parseExpression(cron.trim());
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Retorna a próxima data de execução prevista para uma expressão cron
   */
  public static getNextRunDate(cron: string): Date | null {
    try {
      const interval = parser.parseExpression(cron.trim());
      return interval.next().toDate();
    } catch {
      return null;
    }
  }

  /**
   * Inicializa o motor de agendamento contínuo baseado exclusivamente no BullMQ
   * (sem polling em memória/setInterval, garantindo fonte única de verdade no Redis)
   */
  public static async init(): Promise<void> {
    if (this.isInitialized) {
      console.log('⏱️ [AuditSchedulerService] Scheduler já inicializado.');
      return;
    }

    console.log('⏱️ [AuditSchedulerService] Inicializando agendador BullMQ (event-driven, sem setInterval)...');
    this.isInitialized = true;

    // Sincroniza todos os agentes ativos cadastrados no MongoDB com a fila de jobs repetíveis do BullMQ
    await this.syncAllAgents();

    console.log(`✅ [AuditSchedulerService] Agendamentos BullMQ sincronizados para ${this.activeSchedules.size} agente(s).`);
  }

  /**
   * Sincroniza todos os agentes ativos com cron configurado no banco de dados
   */
  public static async syncAllAgents(): Promise<void> {
    try {
      const agents = await prisma.agentModule.findMany({
        where: {
          enabled: true,
          targetUrl: { not: null },
        },
      });

      for (const agent of agents) {
        if (agent.targetUrl && agent.targetUrl.trim().length > 0) {
          const cron = agent.cronSchedule?.trim() || '0 */6 * * *';
          if (this.isValidCron(cron)) {
            const nextRun = this.getNextRunDate(cron) || undefined;
            this.activeSchedules.set(agent.id, {
              agentId: agent.id,
              agentName: agent.name,
              targetUrl: agent.targetUrl.trim(),
              cronSchedule: cron,
              clientId: agent.clientId,
              nextRunAt: nextRun,
            });

            // Tenta registrar job repetível no BullMQ se suportado
            await this.registerBullMQRepeatable(agent.id, cron, agent.targetUrl, agent.clientId);
          }
        }
      }
    } catch (err: any) {
      console.warn(`[AuditSchedulerService] Aviso ao sincronizar agentes: ${err.message}`);
    }
  }

  /**
   * Sincroniza um agente específico após criação ou atualização no Cockpit
   */
  public static async syncAgentSchedule(agentOrId: string | any): Promise<void> {
    try {
      let agent: any = null;
      let targetId = '';

      if (typeof agentOrId === 'string') {
        targetId = agentOrId;
        agent = await prisma.agentModule.findUnique({
          where: { id: agentOrId },
        });
      } else if (agentOrId && typeof agentOrId === 'object') {
        agent = agentOrId;
        targetId = agentOrId.id;
      }

      if (!agent || !agent.enabled || !agent.targetUrl || agent.targetUrl.trim().length === 0) {
        if (targetId) {
          await this.removeAgentSchedule(targetId);
        }
        return;
      }

      const cron = agent.cronSchedule?.trim() || '0 */6 * * *';
      if (!this.isValidCron(cron)) {
        console.warn(`[AuditSchedulerService] Expressão cron inválida para o agente "${agent.name}": "${cron}"`);
        if (targetId) {
          await this.removeAgentSchedule(targetId);
        }
        return;
      }

      const nextRun = this.getNextRunDate(cron) || undefined;
      this.activeSchedules.set(agent.id, {
        agentId: agent.id,
        agentName: agent.name,
        targetUrl: agent.targetUrl.trim(),
        cronSchedule: cron,
        clientId: agent.clientId,
        nextRunAt: nextRun,
      });

      await this.registerBullMQRepeatable(agent.id, cron, agent.targetUrl.trim(), agent.clientId);
      console.log(`⏱️ [AuditSchedulerService] Agendamento atualizado para "${agent.name}" (${cron}). Próxima execução: ${nextRun?.toISOString()}`);
    } catch (err: any) {
      console.warn(`[AuditSchedulerService] Falha ao sincronizar agente ${typeof agentOrId === 'string' ? agentOrId : agentOrId?.id}: ${err.message}`);
    }
  }

  /**
   * Remove o agendamento de um agente
   */
  public static async removeAgentSchedule(agentId: string): Promise<void> {
    this.activeSchedules.delete(agentId);
    try {
      // Remove do BullMQ se houver
      const repeatableJobs = await auditQueue.getRepeatableJobs();
      const existing = repeatableJobs.find((j) => j.id === `sched-${agentId}` || j.key.includes(agentId));
      if (existing) {
        await auditQueue.removeRepeatableByKey(existing.key);
      }
    } catch {}
    console.log(`⏱️ [AuditSchedulerService] Agendamento removido para o agente ${agentId}.`);
  }

  /**
   * Dispara a auditoria contínua programada para um agente específico
   */
  public static async triggerScheduledAudit(agentId: string): Promise<any> {
    // Evita concorrência e execuções sobrepostas do mesmo agente
    if (this.runningAudits.has(agentId)) {
      console.log(`⏳ [AuditSchedulerService] Auditoria já em andamento para o agente ${agentId}. Aguardando conclusão.`);
      return null;
    }

    const agent = await prisma.agentModule.findUnique({
      where: { id: agentId },
    });

    if (!agent || !agent.enabled || !agent.targetUrl) {
      return null;
    }

    let clientName = 'Geral';
    if (agent.clientId) {
      try {
        const client = await prisma.client.findUnique({
          where: { id: agent.clientId },
          select: { tradeName: true, name: true },
        });
        if (client) {
          clientName = client.tradeName || client.name || 'Geral';
        }
      } catch {
        // Ignora falhas de busca de cliente
      }
    }

    // 1. Mutex distribuído via Redis (primeira linha de defesa, sub-milissegundo)
    let redisAcquired = false;
    try {
      const redis = getRedisConnection();
      const lockKey = `lock:sched:${agentId}`;
      const acquired = await redis.set(lockKey, '1', 'EX', 120, 'NX');
      if (acquired !== 'OK') {
        console.log(`⏳ [AuditSchedulerService] Disparo bloqueado por Mutex distribuído para o agente ${agentId}.`);
        return null;
      }
      redisAcquired = true;
    } catch {
      // Redis offline: fallback para a trava atômica no MongoDB abaixo
    }

    // 2. Trava atômica no MongoDB Atlas (segunda linha de defesa caso o Redis reinicie ou falhe)
    // Atualiza atômico garantindo que nenhum outro processo assuma o mesmo agente nos próximos 120s
    const twoMinutesAgo = new Date(Date.now() - 120 * 1000);
    try {
      const claim = await prisma.agentModule.updateMany({
        where: {
          id: agentId,
          enabled: true,
          OR: [
            { updatedAt: null },
            { updatedAt: { lt: twoMinutesAgo } },
          ],
        },
        data: {
          updatedAt: new Date(),
        },
      });

      if (claim.count === 0 && !redisAcquired) {
        console.log(`⏳ [AuditSchedulerService] Disparo bloqueado por trava atômica no banco (MongoDB) para o agente ${agentId}.`);
        return null;
      }
    } catch {
      // Ignora erro de schema em mocks de teste sem updatedAt
    }

    // 3. Verifica se já existe um laudo PENDING ou RUNNING recente (ou criado nos últimos 5 minutos)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const existingRunning = await prisma.auditReport.findFirst({
      where: {
        targetUrl: agent.targetUrl,
        OR: [
          { status: { in: ['PENDING', 'RUNNING'] } },
          { createdAt: { gte: fiveMinutesAgo } },
        ],
      },
    });

    if (existingRunning) {
      console.log(`⏳ [AuditSchedulerService] Já existe auditoria recente ou em execução para "${agent.targetUrl}". Ignorando disparo duplicado.`);
      return null;
    }

    this.runningAudits.add(agentId);

    try {
      console.log(`🚀 [AuditSchedulerService] Disparando auditoria contínua programada para: "${agent.name}" (${agent.targetUrl}) [Cron: ${agent.cronSchedule}]`);

      // 1. Cria o laudo formal no MongoDB Atlas
      const report = await prisma.auditReport.create({
        data: {
          clientId: agent.clientId,
          targetUrl: agent.targetUrl,
          extractionMode: agent.extractionMode || 'FIRECRAWL',
          status: 'PENDING',
          summary: `Auditoria contínua executada automaticamente pelo agendador cron (${agent.cronSchedule}).`,
        },
      });

      // 2. Registro de Log de Auditoria Programada
      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          module: 'AUDIT_SCHEDULER',
          correlationId: report.id,
          message: `[AUDIT_SCHEDULER] Disparo contínuo programado executado para o agente "${agent.name}" (Cron: ${agent.cronSchedule}) | URL: ${agent.targetUrl}`,
          details: JSON.stringify({
            agentModuleId: agent.id,
            agentName: agent.name,
            cronSchedule: agent.cronSchedule,
            targetUrl: agent.targetUrl,
            clientId: agent.clientId,
            clientName,
          }),
        },
      }).catch(() => {});

      // 3. Atualiza estado em memória
      const current = this.activeSchedules.get(agentId);
      if (current) {
        current.lastRunAt = new Date();
        current.nextRunAt = this.getNextRunDate(current.cronSchedule) || undefined;
      }

      // 4. Executa a auditoria assíncrona (via BullMQ ou direta com fallback)
      let executionResult = null;
      const authPayload = agent.hasAuth
        ? {
            hasAuth: true,
            username: agent.authUsername || undefined,
            password: agent.authPassword ? (decryptSecret(agent.authPassword) || undefined) : undefined,
          }
        : undefined;

      try {
        await auditQueue.add(
          'auditJob',
          {
            auditReportId: report.id,
            clientId: agent.clientId || '',
            targetUrl: agent.targetUrl,
            extractionMode: agent.extractionMode,
            agentModuleId: agent.id,
            skill: agent.description || undefined,
            auth: authPayload,
          },
          { jobId: `audit-${report.id}` }
        );
        console.log(`📬 [AuditSchedulerService] Job enfileirado na fila Redis/BullMQ: audit-${report.id}`);
      } catch (queueErr: any) {
        console.warn(`[AuditSchedulerService] Redis em fallback (${queueErr.message}). Processando auditoria diretamente...`);
        executionResult = await AuditExecutionService.execute({
          auditReportId: report.id,
          clientId: agent.clientId || '',
          targetUrl: agent.targetUrl,
          extractionMode: agent.extractionMode,
          agentModuleId: agent.id,
          skill: agent.description || undefined,
          auth: authPayload,
          jobId: `direct-cron-${report.id}`,
        });
      }

      return { report, executionResult };
    } finally {
      this.runningAudits.delete(agentId);
    }
  }

  /**
   * Registra job repetível no BullMQ de forma segura
   */
  private static async registerBullMQRepeatable(
    agentId: string,
    cronPattern: string,
    targetUrl: string,
    clientId?: string | null
  ): Promise<void> {
    try {
      // Remove agendamentos repetíveis anteriores com o mesmo ID
      const jobs = await auditQueue.getRepeatableJobs();
      for (const j of jobs) {
        if (j.id === `sched-${agentId}` || j.key.includes(agentId)) {
          await auditQueue.removeRepeatableByKey(j.key);
        }
      }

      // Adiciona o novo agendamento com padrão cron
      await auditQueue.add(
        'cronAuditJob',
        {
          agentModuleId: agentId,
          targetUrl,
          clientId: clientId || '',
        },
        {
          repeat: {
            pattern: cronPattern,
          },
          jobId: `sched-${agentId}`,
        }
      );
    } catch {
      // Falha esperada caso Redis não esteja acessível localmente
    }
  }

  /**
   * Retorna os agendamentos atualmente ativos em memória
   */
  public static getActiveSchedules(): ScheduledAgentState[] {
    return Array.from(this.activeSchedules.values());
  }

  /**
   * Encerra o serviço e limpa agendamentos em memória
   */
  public static shutdown(): void {
    this.activeSchedules.clear();
    this.runningAudits.clear();
    this.isInitialized = false;
  }
}
