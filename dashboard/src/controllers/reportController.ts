import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Verdict, AuditStatus } from '@prisma/client';
import { ReportService } from '../services/reportService.js';

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
   * Revisa e altera o status/veredito de um laudo
   */
  public static async reviewReport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const reviewSchema = z.object({
        reviewStatus: z.enum(['APPROVED', 'REJECTED', 'CORRECTED', 'REVIEWED']).optional(),
        verdict: z.nativeEnum(Verdict).optional(),
        score: z.number().min(0).max(100).optional(),
        summary: z.string().optional(),
      });

      const parsed = reviewSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Dados de revisão inválidos.', details: parsed.error.format() });
        return;
      }

      const updated = await ReportService.reviewReport(
        id,
        parsed.data,
        req.user ? { name: req.user.email || req.user.userId } : undefined
      );

      res.status(200).json({
        message: 'Revisão humana registrada com sucesso.',
        report: updated,
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
   * Dispara notificação por e-mail para a clínica auditada
   */
  public static async notifyClient(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      await ReportService.notifyClient(id);

      res.status(200).json({
        message: 'Notificação por e-mail disparada com sucesso.',
      });
    } catch (error: any) {
      if (error.message === 'CLIENT_OR_REPORT_NOT_FOUND') {
        res.status(404).json({ error: 'Laudo ou cliente associado não encontrado.' });
        return;
      }
      if (error.message === 'CLIENT_HAS_NO_EMAIL') {
        res.status(400).json({ error: 'Clínica não possui endereço de e-mail cadastrado.' });
        return;
      }
      next(error);
    }
  }

  /**
   * Listagem de laudos que requerem revisão humana pendente
   */
  public static async getPendingReview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 10));

      const { reports, total } = await ReportService.getPendingReview(page, limit);

      res.status(200).json({
        data: reports,
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
   * Listagem de laudos já revisados por auditores
   */
  public static async getProcessedReview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 10));

      const { reports, total } = await ReportService.getProcessedReview(page, limit);

      res.status(200).json({
        data: reports,
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
   * Confirma a revisão e envia e-mail com relatório final para a clínica
   */
  public static async confirmAndSendEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const sendSchema = z.object({
        emailTo: z.string().email().optional(),
        customMessage: z.string().optional(),
      });

      const parsed = sendSchema.safeParse(req.body);
      const emailTo = parsed.success ? parsed.data.emailTo : undefined;
      const customMessage = parsed.success ? parsed.data.customMessage : undefined;

      await ReportService.confirmAndSendEmail(
        id,
        emailTo,
        customMessage,
        req.user ? { name: req.user.email || req.user.userId } : undefined
      );

      res.status(200).json({
        message: 'Relatório revisado aprovado e e-mail enviado com sucesso.',
      });
    } catch (error: any) {
      if (error.message === 'REPORT_NOT_FOUND') {
        res.status(404).json({ error: 'Laudo de auditoria não encontrado.' });
        return;
      }
      if (error.message === 'CLIENT_HAS_NO_EMAIL') {
        res.status(400).json({ error: 'Nenhum e-mail de destino válido encontrado para este cliente.' });
        return;
      }
      next(error);
    }
  }
}
