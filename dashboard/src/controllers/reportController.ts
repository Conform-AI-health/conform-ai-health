import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Verdict, AuditStatus, RuleSeverity } from '@prisma/client';
import { ReportService } from '../services/reportService.js';

const emptyToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((val) => (typeof val === 'string' && val.trim() === '' ? undefined : val), schema);

const reviewListQuerySchema = z.object({
  page: z.preprocess(
    (val) => {
      if (val === undefined || val === '') return 1;
      const parsed = parseInt(String(val), 10);
      return Number.isNaN(parsed) ? 1 : Math.max(1, parsed);
    },
    z.number().int().min(1).default(1)
  ),
  limit: z.preprocess(
    (val) => {
      if (val === undefined || val === '') return 20;
      const parsed = parseInt(String(val), 10);
      return Number.isNaN(parsed) ? 20 : Math.min(100, Math.max(1, parsed));
    },
    z.number().int().min(1).max(100).default(20)
  ),
  search: emptyToUndefined(z.string().trim().max(200).optional()),
  clientId: emptyToUndefined(z.string().trim().max(64).optional()),
  verdict: emptyToUndefined(z.nativeEnum(Verdict).optional()),
  severity: emptyToUndefined(z.nativeEnum(RuleSeverity).optional()),
  reviewStatus: emptyToUndefined(z.enum(['APPROVED', 'REJECTED', 'CHANGES_REQUESTED']).optional()),
  emailStatus: emptyToUndefined(z.enum(['SENT', 'PENDING']).optional()),
  startDate: emptyToUndefined(z.string().trim().max(32).optional()),
  endDate: emptyToUndefined(z.string().trim().max(32).optional()),
});

export class ReportController {
  /**
   * Listagem de laudos com paginação e filtros (com isolamento multi-tenant)
   */
  public static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 10));
      const verdict = req.query.verdict as Verdict;
      const status = req.query.status as AuditStatus;
      const requestedClientId = req.query.clientId as string;

      const { reports, total } = await ReportService.listReports({
        page,
        limit,
        verdict,
        status,
        clientId: requestedClientId,
        currentUser: req.user,
      });

      res.status(200).json({
        data: reports.map((r: any) => ({
          ...r,
          targetUrl: r.targetUrl || 'URL não informada',
          summary: r.summary || 'Laudo de conformidade deontológica.',
          client: r.client || {
            id: r.clientId || 'avulso',
            name: 'Auditoria Direta / Avulsa',
            tradeName: 'Sem vínculo',
            crmResponsavel: '-',
            crmUf: '-',
          },
          createdAt: r.createdAt || new Date(),
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
   * Retorna o laudo no formato de Contrato Estruturado de Alta Confiabilidade
   */
  public static async getContract(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const structured = await ReportService.getStructuredContract(id, req.user);
      res.status(200).json(structured);
    } catch (error: any) {
      if (error.message === 'REPORT_NOT_FOUND') {
        res.status(404).json({ error: 'Laudo de auditoria não encontrado.' });
        return;
      }
      if (error.message === 'TENANT_FORBIDDEN') {
        res.status(403).json({
          error: 'Acesso negado. Você só tem permissão para visualizar laudos da sua própria clínica.',
          code: 'TENANT_FORBIDDEN',
        });
        return;
      }
      next(error);
    }
  }

  /**
   * Retorna um laudo específico por ID
   */
  public static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const report = await ReportService.getReportById(id, req.user);
      res.status(200).json(report);
    } catch (error: any) {
      if (error.message === 'REPORT_NOT_FOUND') {
        res.status(404).json({ error: 'Laudo de auditoria não encontrado.' });
        return;
      }
      if (error.message === 'TENANT_FORBIDDEN') {
        res.status(403).json({
          error: 'Acesso negado. Você só tem permissão para visualizar laudos da sua própria clínica.',
          code: 'TENANT_FORBIDDEN',
        });
        return;
      }
      next(error);
    }
  }

  /**
   * Exporta o laudo em formato Markdown estruturado
   */
  public static async exportMarkdown(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { filename, content } = await ReportService.exportMarkdown(id, req.user);

      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.status(200).send(content);
    } catch (error: any) {
      if (error.message === 'REPORT_NOT_FOUND') {
        res.status(404).json({ error: 'Laudo de auditoria não encontrado.' });
        return;
      }
      if (error.message === 'TENANT_FORBIDDEN') {
        res.status(403).json({
          error: 'Acesso negado. Você só tem permissão para visualizar laudos da sua própria clínica.',
          code: 'TENANT_FORBIDDEN',
        });
        return;
      }
      next(error);
    }
  }

  /**
   * Marca uma violação específica de um laudo como resolvida
   */
  public static async resolveViolation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id, violationId } = req.params;
      const resolveSchema = z.object({
        resolutionNote: z.string().optional(),
      });
      const parsed = resolveSchema.safeParse(req.body);
      const resolutionNote = parsed.success ? parsed.data.resolutionNote : undefined;

      const updated = await ReportService.resolveViolation(
        id,
        violationId,
        { resolutionNote },
        req.user ? { name: req.user.email || req.user.userId, role: req.user.role } : undefined
      );

      res.status(200).json({
        message: 'Violação marcada como resolvida com sucesso.',
        violation: updated,
      });
    } catch (error: any) {
      if (error.message === 'REPORT_NOT_FOUND') {
        res.status(404).json({ error: 'Laudo de auditoria não encontrado.' });
        return;
      }
      if (error.message === 'VIOLATION_NOT_FOUND') {
        res.status(404).json({ error: 'Violação não encontrada para este laudo.' });
        return;
      }
      next(error);
    }
  }

  /**
   * AI-05: Revisão humana de laudo deontológico
   */
  public static async reviewReport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const reviewSchema = z.object({
        decision: z.enum(['APPROVED', 'REJECTED', 'CHANGES_REQUESTED']),
        notes: z.string().min(5, 'Parecer técnico da revisão humana é obrigatório (mínimo 5 caracteres).'),
        adjustedScore: z.number().min(0).max(100).optional(),
        adjustedVerdict: z.nativeEnum(Verdict).optional(),
      });

      const data = reviewSchema.parse(req.body);
      const { report, review } = await ReportService.reviewReport(id, data, req.user);

      res.status(200).json({
        message: `Revisão humana registrada com sucesso (${data.decision}).`,
        report,
        review,
      });
    } catch (error: any) {
      if (error.message === 'REPORT_NOT_FOUND') {
        res.status(404).json({ error: 'Laudo de auditoria não encontrado.' });
        return;
      }
      next(error);
    }
  }

  /**
   * Reenvia notificação por e-mail para a clínica e grava telemetria auditável
   */
  public static async notifyClient(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { recipient, messageId } = await ReportService.notifyClient(id, req.user);

      res.status(200).json({
        message: 'Notificação de laudo enviada com sucesso para a clínica.',
        recipient,
        messageId,
      });
    } catch (error: any) {
      if (error.message === 'REPORT_NOT_FOUND') {
        res.status(404).json({ error: 'Laudo de auditoria não encontrado.' });
        return;
      }
      if (error.message === 'TENANT_FORBIDDEN') {
        res.status(403).json({ error: 'Acesso negado ao laudo desta clínica.' });
        return;
      }
      if (error.message === 'CLIENT_HAS_NO_EMAIL') {
        res.status(400).json({ error: 'Clínica não possui endereço de e-mail cadastrado.' });
        return;
      }
      if (error.message?.startsWith('EMAIL_DELIVERY_FAILED:')) {
        const reason = error.message.slice('EMAIL_DELIVERY_FAILED:'.length);
        res.status(502).json({ error: `Falha no envio de e-mail: ${reason}` });
        return;
      }
      next(error);
    }
  }

  /**
   * Listagem de laudos que requerem revisão humana pendente (com filtros validados via Zod)
   */
  public static async getPendingReview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { page, limit, ...rawFilters } = reviewListQuerySchema.parse(req.query || {});
      const hasAnyFilter = Object.values(rawFilters).some((v) => v !== undefined);

      const { reports, total } = await ReportService.getPendingReview(
        page,
        limit,
        hasAnyFilter ? rawFilters : undefined
      );

      res.status(200).json({
        data: reports.map((r: any) => ({
          ...r,
          targetUrl: r.targetUrl || 'URL não informada',
          summary: r.summary || 'Laudo de conformidade deontológica.',
        })),
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 1,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Listagem de laudos já revisados por auditores (com filtros validados via Zod)
   */
  public static async getProcessedReview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { page, limit, ...rawFilters } = reviewListQuerySchema.parse(req.query || {});
      const hasAnyFilter = Object.values(rawFilters).some((v) => v !== undefined);

      const { reports, total } = await ReportService.getProcessedReview(
        page,
        limit,
        hasAnyFilter ? rawFilters : undefined
      );

      res.status(200).json({
        data: reports.map((r: any) => ({
          ...r,
          targetUrl: r.targetUrl || 'URL não informada',
          summary: r.summary || 'Laudo de conformidade deontológica.',
        })),
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 1,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Homologa o laudo pelo auditor humano com checkbox obrigatório e dispara o e-mail oficial à clínica
   */
  public static async confirmAndSendEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const confirmSchema = z.object({
        confirmed: z.boolean().refine((val) => val === true, {
          message: 'A confirmação do auditor é obrigatória (a flag/checkbox deve estar selecionada).',
        }),
        decision: z.enum(['APPROVED', 'REJECTED', 'CHANGES_REQUESTED']).default('APPROVED'),
        notes: z.string().optional(),
        adjustedScore: z.number().min(0).max(100).optional(),
        adjustedVerdict: z.nativeEnum(Verdict).optional(),
      });

      const payload = confirmSchema.parse(req.body);
      const { report, emailSent, decision } = await ReportService.confirmAndSendEmail(id, payload, req.user);

      res.status(200).json({
        message:
          decision === 'APPROVED'
            ? 'Laudo confirmado e homologado com sucesso! E-mail de notificação processado para a clínica.'
            : decision === 'REJECTED'
            ? 'Laudo recusado pelo auditor com sucesso. Nenhum e-mail foi disparado para a clínica.'
            : `Revisão do auditor registrada com sucesso (${decision}).`,
        report,
        emailSent,
      });
    } catch (error: any) {
      if (error.message === 'REPORT_NOT_FOUND') {
        res.status(404).json({ error: 'Laudo de auditoria não encontrado.' });
        return;
      }
      next(error);
    }
  }
}
