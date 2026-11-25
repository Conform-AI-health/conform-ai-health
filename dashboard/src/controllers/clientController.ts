import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ClientStatus, Role, ExtractionMode } from '@prisma/client';
import { ClientService } from '../services/clientService.js';

const safeHttpUrlSchema = z
  .string()
  .url('Formato de URL inválido')
  .refine(
    (val) => val.startsWith('http://') || val.startsWith('https://'),
    'Apenas os protocolos HTTP e HTTPS são permitidos'
  );

const clientFieldsSchema = z.object({
  name: z.string().min(2, 'Razão Social é obrigatória'),
  tradeName: z.string().optional().nullable(),
  cnpj: z.string().optional().nullable(),
  crmResponsavel: z.string().optional().nullable(),
  crmUf: z.string().max(2).optional().nullable(),
  rqeResponsavel: z.string().optional().nullable(),
  especialidade: z.string().optional().nullable(),
  websiteUrl: safeHttpUrlSchema.optional().nullable().or(z.literal('')),
  instagramHandle: z.string().optional().nullable(),
  status: z.enum(['ATIVO', 'INATIVO', 'PENDENTE', 'SUSPENSO']),
  phone: z.string().optional().nullable(),
  email: z.string().email('E-mail de Notificação / Compliance inválido').optional().nullable().or(z.literal('')),
  accessEmail: z.string().email('E-mail de acesso inválido').optional().nullable().or(z.literal('')),
  initialPassword: z.string().min(6, 'Senha inicial deve ter no mínimo 6 caracteres').optional().nullable().or(z.literal('')),
});

const clientSelfUpdateSchema = z.object({
  tradeName: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email('E-mail de Notificação / Compliance inválido').optional().nullable().or(z.literal('')),
  websiteUrl: safeHttpUrlSchema.optional().nullable().or(z.literal('')),
  instagramHandle: z.string().optional().nullable(),
});

const createClientSchema = clientFieldsSchema.extend({
  status: clientFieldsSchema.shape.status.default('ATIVO'),
});

const updateClientSchema = clientFieldsSchema.partial();

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

      const result = await ClientService.listClients({ page, limit, search, status });

      res.status(200).json({
        data: result.clients,
        pagination: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: Math.ceil(result.total / result.limit) || 1,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Detalhes de uma clínica por ID
   */
  public static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const client = await ClientService.getClientById(id, req.user);

      res.status(200).json(client);
    } catch (error: any) {
      if (error.message === 'TENANT_FORBIDDEN') {
        res.status(403).json({
          error: 'Acesso negado. Você só tem permissão para visualizar os dados da sua própria clínica.',
          code: 'TENANT_FORBIDDEN',
        });
        return;
      }
      if (error.message === 'CLIENT_NOT_FOUND') {
        res.status(404).json({ error: 'Clínica não encontrada.' });
        return;
      }
      next(error);
    }
  }

  /**
   * Retorna os dados cadastrais da clínica do usuário logado (Portal do Cliente)
   */
  public static async portalMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const clientId = req.user?.clientId;
      if (!clientId) {
        res.status(403).json({ error: 'Usuário não vinculado a uma clínica específica.' });
        return;
      }

      const portalData = await ClientService.getPortalDashboard(clientId);

      res.status(200).json({
        client: portalData.client,
        metrics: portalData.metrics,
        latestReports: portalData.latestReports,
      });
    } catch (error: any) {
      if (error.message === 'CLIENT_NOT_FOUND') {
        res.status(404).json({ error: 'Cadastro da clínica não encontrado.' });
        return;
      }
      next(error);
    }
  }

  /**
   * Cadastro de nova clínica (Apenas ADMIN)
   */
  public static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = createClientSchema.parse(req.body);
      const { client, createdUser } = await ClientService.createClient(data);

      res.status(201).json({
        message: 'Clínica cadastrada com sucesso.',
        client,
        user: createdUser ? { id: createdUser.id, email: createdUser.email, role: createdUser.role } : null,
      });
    } catch (error: any) {
      if (error.message === 'CRM_ALREADY_EXISTS') {
        res.status(409).json({
          error: 'Já existe uma clínica cadastrada com este CRM e UF do Responsável Técnico.',
          code: 'CRM_ALREADY_EXISTS',
        });
        return;
      }
      next(error);
    }
  }

  /**
   * Provisionar ou Atualizar Usuário de Acesso da Clínica
   */
  public static async createOrUpdateAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { email, password, name } = req.body;

      if (!email) {
        res.status(400).json({ error: 'E-mail de acesso é obrigatório.' });
        return;
      }

      const result = await ClientService.createOrUpdateAccess(id, { email, password, name });

      res.status(200).json({
        message: 'Acesso do cliente configurado com sucesso.',
        user: result.user,
      });
    } catch (error: any) {
      if (error.message === 'CLIENT_NOT_FOUND') {
        res.status(404).json({ error: 'Clínica não encontrada.' });
        return;
      }
      if (error.message === 'EMAIL_ALREADY_IN_USE') {
        res.status(409).json({ error: 'Este e-mail já está vinculado a outro cadastro no sistema.' });
        return;
      }
      if (error.message === 'PASSWORD_REQUIRED_FOR_NEW_USER') {
        res.status(400).json({ error: 'Senha inicial é obrigatória para criar novo acesso.' });
        return;
      }
      next(error);
    }
  }

  /**
   * Atualização cadastral da clínica
   */
  public static async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const isClientSelf = req.user?.role === Role.CLIENT;

      if (isClientSelf && req.user?.clientId !== id) {
        res.status(403).json({
          error: 'Acesso negado. Você só pode atualizar a sua própria clínica.',
          code: 'TENANT_FORBIDDEN',
        });
        return;
      }

      const data = isClientSelf
        ? clientSelfUpdateSchema.parse(req.body)
        : updateClientSchema.parse(req.body);

      const updated = await ClientService.updateClient(id, data, req.user);

      res.status(200).json({
        message: 'Clínica atualizada com sucesso.',
        client: updated,
      });
    } catch (error: any) {
      if (error.message === 'TENANT_FORBIDDEN') {
        res.status(403).json({ error: 'Acesso negado.', code: 'TENANT_FORBIDDEN' });
        return;
      }
      if (error.message === 'CLIENT_NOT_FOUND') {
        res.status(404).json({ error: 'Clínica não encontrada.' });
        return;
      }
      next(error);
    }
  }

  /**
   * Exclusão de clínica (Apenas ADMIN)
   */
  public static async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      await ClientService.deleteClient(id);

      res.status(200).json({
        message: 'Clínica e seus laudos associados foram removidos com sucesso.',
      });
    } catch (error: any) {
      if (error.message === 'CLIENT_NOT_FOUND') {
        res.status(404).json({ error: 'Clínica não encontrada.' });
        return;
      }
      next(error);
    }
  }

  /**
   * Buscar Informações da Clínica (Scraping) e salvar atrelado ao cliente
   */
  public static async extractInfo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { extractionMode = 'CHEERIO', targetUrl } = req.body;

      const result = await ClientService.extractAndSaveInfo(id, targetUrl, extractionMode as ExtractionMode);

      res.status(201).json({
        message: 'Informações da clínica coletadas e persistidas com sucesso.',
        data: result.scrapedDoc,
      });
    } catch (error: any) {
      if (error.message === 'CLIENT_NOT_FOUND') {
        res.status(404).json({ error: 'Clínica não encontrada.' });
        return;
      }
      if (error.message === 'EMPTY_URL') {
        res.status(400).json({ error: 'A clínica não possui URL de website cadastrada e nenhuma URL foi informada.' });
        return;
      }
      next(error);
    }
  }

  /**
   * Listar histórico de documentos extraídos da clínica
   */
  public static async listScrapedData(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const items = await ClientService.listScrapedData(id, req.user);

      res.status(200).json({
        data: items,
        total: items.length,
      });
    } catch (error: any) {
      if (error.message === 'TENANT_FORBIDDEN') {
        res.status(403).json({
          error: 'Acesso negado. Você só tem permissão para visualizar dados extraídos da sua própria clínica.',
          code: 'TENANT_FORBIDDEN',
        });
        return;
      }
      next(error);
    }
  }
}
