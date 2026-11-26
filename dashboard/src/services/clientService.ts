import bcrypt from 'bcryptjs';
import { ClientRepository } from '../repositories/clientRepository.js';
import { UserRepository } from '../repositories/userRepository.js';
import { AgentRepository } from '../repositories/agentRepository.js';
import { ReportRepository } from '../repositories/reportRepository.js';
import { SystemLogRepository } from '../repositories/systemLogRepository.js';
import { ScraperService } from './scraperService.js';
import { Client, ClientStatus, Role, ExtractionMode } from '@prisma/client';

export interface ClientListQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: ClientStatus;
}

export function sanitizeClientSummary(summary?: string | null): string {
  if (!summary) return 'Laudo preliminar de conformidade deontológica.';
  const isTechnicalRagLeak =
    summary.includes('A recuperação encontrou') ||
    summary.includes('chunks indexados') ||
    summary.includes('Modelo esperado') ||
    summary.includes('npm run rag:reindex') ||
    summary.includes('Sem embedding') ||
    summary.includes('dimensão inválida') ||
    summary.includes('modelo diferente') ||
    summary.includes('metadado ausente') ||
    summary.includes('norma-pai ausente') ||
    summary.includes('A IA não foi chamada');

  if (isTechnicalRagLeak) {
    return 'Auditoria preliminar inconclusiva: O canal digital foi submetido à varredura preventiva e encontra-se em fase de validação complementar pela equipe de governança e auditoria regulatória. Revisão humana em andamento.';
  }
  return summary;
}

export class ClientService {
  /**
   * Listagem de clínicas com paginação e busca
   */
  public static async listClients(query: ClientListQuery) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 10));
    const search = query.search?.trim();
    const status = query.status;

    const where: any = {};
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { tradeName: { contains: search, mode: 'insensitive' } },
        { crmResponsavel: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, clients] = await Promise.all([
      ClientRepository.count(where),
      ClientRepository.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        includeUsers: true,
      }),
    ]);

    return { clients, total, page, limit };
  }

  /**
   * Detalhes de uma clínica por ID com verificação de isolamento multi-tenant
   */
  public static async getClientById(id: string, currentUser?: { role: string; clientId?: string | null }) {
    if (currentUser?.role === 'CLIENT' && currentUser.clientId !== id) {
      throw new Error('TENANT_FORBIDDEN');
    }

    const client = await ClientRepository.findById(id, { includeUsers: true, includeScrapeData: true });
    if (!client) {
      throw new Error('CLIENT_NOT_FOUND');
    }

    return client;
  }

  /**
   * Dados consolidados para o Portal da Clínica
   */
  public static async getPortalDashboard(clientId: string) {
    const client = await ClientRepository.findById(clientId);
    if (!client) {
      throw new Error('CLIENT_NOT_FOUND');
    }

    const [totalReports, latestReports, pendingReviewCount] = await Promise.all([
      ReportRepository.count({ clientId }),
      ReportRepository.findMany({
        where: { clientId },
        take: 5,
        orderBy: { createdAt: 'desc' },
        includeViolations: true,
      }),
      ReportRepository.count({ clientId, status: 'PENDING' }),
    ]);

    const sanitizedReports = latestReports.map((r) => ({
      ...r,
      summary: sanitizeClientSummary(r.summary),
    }));

    const latest = latestReports[0];
    const score = latest?.score ?? (latest?.verdict === 'CONFORME' ? 100 : 75);

    return {
      client,
      metrics: {
        totalAudits: totalReports,
        pendingAudits: pendingReviewCount,
        complianceScore: score,
        lastAuditDate: latest?.createdAt || null,
        verdict: latest?.verdict || 'CONFORME',
      },
      latestReports: sanitizedReports,
    };
  }

  /**
   * Cadastro de nova clínica com provisionamento de acesso e módulo de auditoria
   */
  public static async createClient(data: any) {
    if (data.crmResponsavel && data.crmUf) {
      const existing = await ClientRepository.findByCrm(data.crmResponsavel, data.crmUf);
      if (existing) {
        throw new Error('CRM_ALREADY_EXISTS');
      }
    }

    const client = await ClientRepository.create({
      name: data.name,
      tradeName: data.tradeName || null,
      cnpj: data.cnpj || null,
      crmResponsavel: data.crmResponsavel || null,
      crmUf: data.crmUf || null,
      rqeResponsavel: data.rqeResponsavel || null,
      especialidade: data.especialidade || null,
      websiteUrl: data.websiteUrl || null,
      instagramHandle: data.instagramHandle || null,
      status: data.status || 'ATIVO',
      phone: data.phone || null,
      email: data.email || null,
    });

    let createdUser = null;
    const accessEmail = (data.accessEmail || data.email)?.trim();
    if (accessEmail && data.initialPassword) {
      const passwordHash = await bcrypt.hash(data.initialPassword, 12);
      const existingUser = await UserRepository.findByEmail(accessEmail);
      const userSelect = { id: true, email: true, name: true, role: true, mustChangePassword: true };

      if (existingUser) {
        createdUser = await UserRepository.update(
          existingUser.id,
          {
            passwordHash,
            role: Role.CLIENT,
            clientId: client.id,
            mustChangePassword: true,
          },
          userSelect
        );
      } else {
        createdUser = await UserRepository.create(
          {
            name: data.tradeName || data.name,
            email: accessEmail,
            passwordHash,
            role: Role.CLIENT,
            clientId: client.id,
            mustChangePassword: true,
          },
          userSelect
        );
      }

      await SystemLogRepository.create({
        level: 'INFO',
        module: 'CLIENT_MANAGEMENT',
        message: `[CLIENT_ACCESS_CREATED] Usuário institucional ${accessEmail} criado com senha temporária para a clínica "${client.name}". Troca obrigatória no primeiro acesso.`,
        details: JSON.stringify({ clientId: client.id, userEmail: accessEmail }),
      });
    }

    if (data.websiteUrl && data.websiteUrl.trim().length > 0) {
      await AgentRepository.create({
        name: `Auditor Digital — ${data.tradeName || data.name}`,
        targetUrl: data.websiteUrl.trim(),
        clientId: client.id,
        enabled: true,
        cronSchedule: '0 */6 * * *',
        extractionMode: ExtractionMode.CHEERIO,
        tags: ['CFM', 'PUBLICIDADE_MEDICA'],
      });
    }

    return { client, createdUser };
  }

  /**
   * Criação ou atualização de credenciais de acesso do cliente
   */
  public static async createOrUpdateAccess(
    clientId: string,
    accessData: { email: string; password?: string; name?: string },
    requestedBy?: string
  ) {
    const client = await ClientRepository.findById(clientId);
    if (!client) {
      throw new Error('CLIENT_NOT_FOUND');
    }

    const existingUser = await UserRepository.findByEmail(accessData.email);
    if (existingUser && existingUser.clientId && existingUser.clientId !== clientId) {
      throw new Error('EMAIL_ALREADY_IN_USE');
    }

    const targetName = accessData.name || client.tradeName || client.name;
    const userSelect = { id: true, email: true, name: true, role: true, mustChangePassword: true };
    let user: any;

    if (existingUser) {
      const updateData: any = {
        name: targetName,
        clientId: client.id,
        role: Role.CLIENT,
        mustChangePassword: true,
      };
      if (accessData.password) {
        updateData.passwordHash = await bcrypt.hash(accessData.password, 12);
      }
      user = await UserRepository.update(existingUser.id, updateData, userSelect);
    } else {
      if (!accessData.password) {
        throw new Error('PASSWORD_REQUIRED_FOR_NEW_USER');
      }
      const passwordHash = await bcrypt.hash(accessData.password, 12);
      user = await UserRepository.create(
        {
          name: targetName,
          email: accessData.email,
          passwordHash,
          role: Role.CLIENT,
          clientId: client.id,
          mustChangePassword: true,
        },
        userSelect
      );
    }

    await SystemLogRepository.create({
      level: 'INFO',
      module: 'CLIENT_MANAGEMENT',
      message: `[CLIENT_ACCESS_PROVISIONED] Acesso institucional concedido/redefinido para ${accessData.email} (Clínica: ${client.name}). Troca de senha obrigatória no primeiro acesso ativada.`,
      details: JSON.stringify({ clientId: client.id, email: accessData.email, requestedBy }),
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        mustChangePassword: user.mustChangePassword ?? true,
      },
    };
  }

  /**
   * Atualização de dados da clínica com validação de escopo
   */
  public static async updateClient(id: string, data: any, currentUser?: { role: string; clientId?: string | null }) {
    if (currentUser?.role === 'CLIENT' && currentUser.clientId !== id) {
      throw new Error('TENANT_FORBIDDEN');
    }

    const existing = await ClientRepository.findById(id);
    if (!existing) {
      throw new Error('CLIENT_NOT_FOUND');
    }

    return await ClientRepository.update(id, data);
  }

  /**
   * Exclusão da clínica
   */
  public static async deleteClient(id: string) {
    const existing = await ClientRepository.findById(id);
    if (!existing) {
      throw new Error('CLIENT_NOT_FOUND');
    }
    return await ClientRepository.delete(id);
  }

  /**
   * Extração preliminar de informações via ScraperService e persistência
   */
  public static async extractAndSaveInfo(id: string, targetUrl?: string, extractionMode: ExtractionMode = 'CHEERIO' as ExtractionMode) {
    const client = await ClientRepository.findById(id);
    if (!client) {
      throw new Error('CLIENT_NOT_FOUND');
    }

    const effectiveUrl = (targetUrl || client.websiteUrl || '').trim();
    if (!effectiveUrl) {
      throw new Error('EMPTY_URL');
    }

    const scrape = await ScraperService.scrape(effectiveUrl, extractionMode);

    const scrapedDoc = await ClientRepository.createClientScrapedData({
      client: { connect: { id } },
      url: effectiveUrl,
      title: scrape.title || client.tradeName || client.name,
      cleanMarkdown: scrape.cleanMarkdown,
      rawLength: scrape.rawHtmlLength,
      tokensCount: scrape.tokensEstimatedClean,
      extractionMode,
      detectedTags: scrape.detectedTags,
      extractedEntities: JSON.stringify(scrape.extractedEntities),
      status: 'COMPLETED',
    });

    return { client, scrape, scrapedDoc, effectiveUrl };
  }

  /**
   * Histórico de dados de raspagem da clínica
   */
  public static async listScrapedData(clientId: string, currentUser?: { role: string; clientId?: string | null }) {
    if (currentUser?.role === 'CLIENT' && currentUser.clientId !== clientId) {
      throw new Error('TENANT_FORBIDDEN');
    }
    return await ClientRepository.findClientScrapedData(clientId);
  }
}
