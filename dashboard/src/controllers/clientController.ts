import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { ClientStatus, Role, ExtractionMode } from '@prisma/client';
import { ScraperService } from '../services/scraperService.js';

const createClientSchema = z.object({
  name: z.string().min(2, 'Razão Social é obrigatória'),
  tradeName: z.string().optional().nullable(),
  cnpj: z.string().optional().nullable(),
  crmResponsavel: z.string().optional().nullable(),
  crmUf: z.string().max(2).optional().nullable(),
  rqeResponsavel: z.string().optional().nullable(),
  especialidade: z.string().optional().nullable(),
  websiteUrl: z.string().optional().nullable(),
  instagramHandle: z.string().optional().nullable(),
  status: z.enum(['ATIVO', 'INATIVO', 'PENDENTE', 'SUSPENSO']).default('ATIVO'),
  phone: z.string().optional().nullable(),
  email: z.string().email('E-mail de Notificação / Compliance inválido').optional().nullable().or(z.literal('')),
});

const updateClientSchema = createClientSchema.partial();

export class ClientController {
  /**
   * Listagem de clínicas com paginação e busca (ADMIN e AUDITOR)
   */
  public static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 10));
      const search = (req.query.search as string)?.trim();
      const status = req.query.status as ClientStatus;

      const where: any = {};
      if (status) {
        where.status = status;
      }
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { tradeName: { contains: search, mode: 'insensitive' } },
          { crmResponsavel: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [total, clients] = await Promise.all([
        prisma.client.count({ where }),
        prisma.client.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            _count: {
              select: { auditReports: true, users: true },
            },
          },
        }),
      ]);

      res.status(200).json({
        data: clients.map((c) => ({
          ...c,
          email: c.email || 'contato@clinica.com',
          createdAt: c.createdAt || new Date(),
          updatedAt: c.updatedAt || new Date(),
        })),
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Detalhes de uma clínica específica por ID
   */
  public static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      // Isolamento multi-tenant: CLIENT só pode ver a sua própria clínica
      if (req.user?.role === Role.CLIENT && req.user.clientId !== id) {
        res.status(403).json({
          error: 'Acesso negado. Você só tem permissão para visualizar os dados da sua própria clínica.',
          code: 'TENANT_FORBIDDEN',
        });
        return;
      }

      const client = await prisma.client.findUnique({
        where: { id },
        include: {
          users: {
            select: { id: true, name: true, email: true, role: true, createdAt: true },
          },
          auditReports: {
            orderBy: { createdAt: 'desc' },
            take: 5,
            include: {
              _count: { select: { violations: true } },
            },
          },
          _count: {
            select: { auditReports: true, users: true },
          },
        },
      });

      if (!client) {
        res.status(404).json({ error: 'Clínica não encontrada.' });
        return;
      }

      res.status(200).json(client);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Endpoint exclusivo para o perfil CLIENT visualizar seu próprio painel (Portal do Cliente)
   */
  public static async portalMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.clientId) {
        res.status(404).json({
          error: 'Nenhuma clínica vinculada a este usuário.',
          code: 'NO_LINKED_CLIENT',
        });
        return;
      }

      const clientId = req.user.clientId;

      const client = await prisma.client.findUnique({
        where: { id: clientId },
        include: {
          auditReports: {
            orderBy: { createdAt: 'desc' },
            take: 10,
            include: {
              violations: true,
            },
          },
        },
      });

      if (!client) {
        res.status(404).json({ error: 'Clínica não encontrada.' });
        return;
      }

      // Calcula indicadores do cliente
      const reports = client.auditReports || [];
      const latestReport = reports[0] || null;

      const criticalViolationsCount = reports.reduce((acc, r) => {
        return acc + r.violations.filter((v) => v.severity === 'CRITICA' && !v.resolved).length;
      }, 0);

      const graveViolationsCount = reports.reduce((acc, r) => {
        return acc + r.violations.filter((v) => v.severity === 'GRAVE' && !v.resolved).length;
      }, 0);

      res.status(200).json({
        client: {
          id: client.id,
          name: client.name,
          tradeName: client.tradeName,
          crmResponsavel: client.crmResponsavel,
          crmUf: client.crmUf,
          rqeResponsavel: client.rqeResponsavel,
          especialidade: client.especialidade,
          websiteUrl: client.websiteUrl,
          status: client.status,
          email: client.email,
        },
        overview: {
          latestVerdict: latestReport?.verdict || 'PARCIALMENTE_CONFORME',
          latestScore: latestReport?.score ?? 70,
          totalReports: reports.length,
          activeCriticalViolations: criticalViolationsCount,
          activeGraveViolations: graveViolationsCount,
          lastAuditDate: latestReport?.createdAt || null,
        },
        recentReports: reports,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Criação de nova clínica (ADMIN e AUDITOR)
   */
  public static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = createClientSchema.parse(req.body);
      const now = new Date();

      const client = await prisma.client.create({
        data: {
          ...data,
          createdAt: now,
          updatedAt: now,
        },
      });

      res.status(201).json({
        message: 'Clínica cadastrada com sucesso.',
        client,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Atualização de clínica existente
   */
  public static async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      if (req.user?.role === Role.CLIENT && req.user.clientId !== id) {
        res.status(403).json({
          error: 'Acesso negado. Você só pode atualizar a sua própria clínica.',
          code: 'TENANT_FORBIDDEN',
        });
        return;
      }

      const data = updateClientSchema.parse(req.body);

      const updated = await prisma.client.update({
        where: { id },
        data,
      });

      res.status(200).json({
        message: 'Clínica atualizada com sucesso.',
        client: updated,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Exclusão de clínica (Apenas ADMIN)
   */
  public static async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      await prisma.client.delete({
        where: { id },
      });

      res.status(200).json({
        message: 'Clínica e seus laudos associados foram removidos com sucesso.',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Buscar Informações da Clínica (Scraping, Datalink ou MCP) e salvar atrelado ao cliente
   */
  public static async extractInfo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { extractionMode = 'CHEERIO', targetUrl } = req.body;

      const client = await prisma.client.findUnique({
        where: { id },
      });

      if (!client) {
        res.status(404).json({ error: 'Clínica não encontrada.' });
        return;
      }

      const effectiveUrl = (targetUrl || client.websiteUrl || '').trim();
      if (!effectiveUrl) {
        res.status(400).json({ error: 'A clínica não possui URL de website cadastrada e nenhuma URL foi informada.' });
        return;
      }

      // 1. Extração dos dados do canal digital da clínica
      const scrape = await ScraperService.scrape(effectiveUrl, extractionMode as ExtractionMode);

      // 2. Persistência em documento específico atrelado ao cliente (sem poluir o repositório de normas)
      const scrapedDoc = await prisma.clientScrapedData.create({
        data: {
          clientId: id,
          url: effectiveUrl,
          title: scrape.title || client.tradeName || client.name,
          cleanMarkdown: scrape.cleanMarkdown,
          rawLength: scrape.rawHtmlLength,
          tokensCount: scrape.tokensEstimatedClean,
          extractionMode: extractionMode as ExtractionMode,
          detectedTags: scrape.detectedTags,
          extractedEntities: JSON.stringify(scrape.extractedEntities),
          status: 'COMPLETED',
        },
      });

      // 3. Log Operacional no Terminal
      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          module: 'CLIENT_EXTRACTION',
          correlationId: scrapedDoc.id,
          message: `[CLIENT_EXTRACTION] Informações coletadas para "${client.name}" (${effectiveUrl}) via ${extractionMode} | ${scrape.rawHtmlLength} bytes | ${scrape.tokensEstimatedClean} tokens | Documento ID: ${scrapedDoc.id}`,
          details: JSON.stringify({
            clientId: id,
            clientName: client.name,
            url: effectiveUrl,
            extractionMode,
            tokensCount: scrape.tokensEstimatedClean,
            entitiesCount: {
              crms: scrape.extractedEntities.crms.length,
              rqes: scrape.extractedEntities.rqes.length,
            },
          }),
        },
      }).catch(() => {});

      res.status(201).json({
        message: 'Informações da clínica coletadas e persistidas com sucesso.',
        data: scrapedDoc,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Listar histórico de documentos extraídos da clínica
   */
  public static async listScrapedData(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      if (req.user?.role === Role.CLIENT && req.user.clientId !== id) {
        res.status(403).json({
          error: 'Acesso negado. Você só tem permissão para visualizar dados extraídos da sua própria clínica.',
          code: 'TENANT_FORBIDDEN',
        });
        return;
      }

      const items = await prisma.clientScrapedData.findMany({
        where: { clientId: id },
        orderBy: { createdAt: 'desc' },
      });

      res.status(200).json({
        data: items,
        total: items.length,
      });
    } catch (error) {
      next(error);
    }
  }
}

