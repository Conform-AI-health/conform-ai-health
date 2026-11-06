import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { Role, Verdict, AuditStatus, RuleSeverity } from '@prisma/client';

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
      let requestedClientId = req.query.clientId as string;

      // Isolamento multi-tenant estrito: CLIENT nunca vê relatórios de outros clientes
      if (req.user?.role === Role.CLIENT) {
        requestedClientId = req.user.clientId || 'none';
      }

      const where: any = {};
      if (requestedClientId) {
        where.clientId = requestedClientId;
      }
      if (verdict) {
        where.verdict = verdict;
      }
      if (status) {
        where.status = status;
      }

      const [total, reports] = await Promise.all([
        prisma.auditReport.count({ where }),
        prisma.auditReport.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            client: {
              select: {
                id: true,
                name: true,
                tradeName: true,
                crmResponsavel: true,
                crmUf: true,
              },
            },
            violations: {
              select: {
                id: true,
                severity: true,
                normCode: true,
                normArticle: true,
                resolved: true,
              },
            },
          },
        }),
      ]);

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
   * Detalhes completos do laudo com violações e orientações
   */
  public static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const report = await prisma.auditReport.findUnique({
        where: { id },
        include: {
          client: true,
          violations: {
            orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }],
          },
        },
      });

      if (!report) {
        res.status(404).json({ error: 'Laudo de auditoria não encontrado.' });
        return;
      }

      // Isolamento multi-tenant
      if (req.user?.role === Role.CLIENT && req.user.clientId !== report.clientId) {
        res.status(403).json({
          error: 'Acesso negado. Você só tem permissão para visualizar laudos da sua própria clínica.',
          code: 'TENANT_FORBIDDEN',
        });
        return;
      }

      res.status(200).json(report);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Exporta laudo formatado em Markdown executivo para download
   */
  public static async exportMarkdown(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const report = await prisma.auditReport.findUnique({
        where: { id },
        include: {
          client: true,
          violations: true,
        },
      });

      if (!report) {
        res.status(404).json({ error: 'Laudo de auditoria não encontrado.' });
        return;
      }

      if (req.user?.role === Role.CLIENT && req.user.clientId !== report.clientId) {
        res.status(403).json({ error: 'Acesso negado.' });
        return;
      }

      const dateStr = new Date(report.createdAt).toLocaleDateString('pt-BR');
      const semaphore =
        report.verdict === 'CONFORME'
          ? '🟢 REGULAR / CONFORME'
          : report.verdict === 'PARCIALMENTE_CONFORME'
          ? '🟡 PARCIALMENTE CONFORME (ATENÇÃO)'
          : '🔴 NÃO CONFORME (VIOLAÇÃO CRÍTICA)';

      let md = `# 🏥 LAUDO TÉCNICO DE CONFORMIDADE DEONTOLÓGICA & REGULATÓRIA\n`;
      md += `**Plataforma ConformIA** — Inteligência & Governança Ética em Saúde\n\n`;
      md += `---\n\n`;
      md += `### 📋 Dados da Instituição Auditada\n`;
      md += `- **Clínica:** ${report.client.name}\n`;
      md += `- **Responsável Técnico:** CRM/${report.client.crmUf} ${report.client.crmResponsavel}\n`;
      md += `- **Canal / URL Auditada:** ${report.targetUrl}\n`;
      md += `- **Data da Auditoria:** ${dateStr}\n`;
      md += `- **Status da Auditoria:** ${report.status}\n\n`;
      md += `### 🚥 Veredito Semáforo & Pontuação\n`;
      md += `- **Veredito:** ${semaphore}\n`;
      md += `- **Score de Conformidade:** ${report.score} / 100\n`;
      md += `- **Eficiência de Contexto:** ${report.tokensSaved} tokens economizados via sanitização\n\n`;
      md += `### 📝 Resumo Executivo\n`;
      md += `${report.summary}\n\n`;
      md += `---\n\n`;
      md += `### ⚠️ Apontamentos de Não-Conformidade (${report.violations.length})\n\n`;

      if (report.violations.length === 0) {
        md += `*Nenhuma violação regulatória detectada nesta varredura. Parabéns!*\n`;
      } else {
        report.violations.forEach((v, index) => {
          md += `#### ${index + 1}. [${v.severity}] ${v.normCode} — ${v.normArticle}\n`;
          md += `- **Evidência Encontrada:** _"${v.detectedText}"_\n`;
          md += `- **Recomendação Corretiva:** ${v.correctiveAdvice}\n`;
          md += `- **Situação:** ${v.resolved ? '✅ Regularizado' : '⏳ Pendente de Adequação'}\n\n`;
        });
      }

      md += `---\n\n`;
      md += `*Laudo emitido eletronicamente pela plataforma ConformIA com fundamentação na Resolução CFM nº, ANS e LGPD.*`;

      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=laudo-${report.id}.md`);
      res.status(200).send(md);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Marca uma violação específica como resolvida
   */
  public static async resolveViolation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id, violationId } = req.params;

      const violation = await prisma.violation.findUnique({
        where: { id: violationId },
        include: { auditReport: true },
      });

      if (!violation || violation.auditReportId !== id) {
        res.status(404).json({ error: 'Violação não encontrada para este laudo.' });
        return;
      }

      if (req.user?.role === Role.CLIENT && req.user.clientId !== violation.auditReport.clientId) {
        res.status(403).json({ error: 'Acesso negado.' });
        return;
      }

      const updated = await prisma.violation.update({
        where: { id: violationId },
        data: { resolved: true },
      });

      res.status(200).json({
        message: 'Violação marcada como resolvida com sucesso.',
        violation: updated,
      });
    } catch (error) {
      next(error);
    }
  }
}

