import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { Role, Verdict, AuditStatus, RuleSeverity } from '@prisma/client';
import { AIStructuredContractAdapter } from '../shared/aiStructuredContract.js';

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
        data: reports.map((r) => ({
          ...r,
          targetUrl: r.targetUrl || 'https://conform-ia.med.br',
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

      const report = await prisma.auditReport.findUnique({
        where: { id },
        include: { violations: true },
      });

      if (!report) {
        res.status(404).json({ error: 'Laudo de auditoria não encontrado.' });
        return;
      }

      if (req.user?.role === Role.CLIENT && req.user.clientId !== report.clientId) {
        res.status(403).json({
          error: 'Acesso negado. Você só tem permissão para visualizar laudos da sua própria clínica.',
          code: 'TENANT_FORBIDDEN',
        });
        return;
      }

      if (report.structuredContract) {
        try {
          const parsed = JSON.parse(report.structuredContract);
          res.status(200).json(parsed);
          return;
        } catch {}
      }

      const structured = AIStructuredContractAdapter.toStructuredContract(
        {
          verdict: (report.verdict === 'INCONCLUSIVO' ? 'PARCIALMENTE_CONFORME' : report.verdict) as
            | 'CONFORME'
            | 'PARCIALMENTE_CONFORME'
            | 'NAO_CONFORME',
          score: report.score ?? 0,
          summary: report.summary || 'Laudo de conformidade deontológica.',
          violations: report.violations.map((v) => ({
            normArticle: v.normArticle || 'Artigo Geral',
            normCode: v.normCode || 'Normativo Vigente',
            severity: v.severity,
            detectedText: v.detectedText || 'Evidência identificada',
            correctiveAdvice: v.correctiveAdvice || 'Adequar comunicação.',
          })),
          promptTokens: report.promptTokens ?? 0,
          completionTokens: report.completionTokens ?? 0,
          totalTokens: report.totalTokens ?? 0,
          sourcesUsed: report.sourcesUsed,
          aiModelUsed: report.aiModelUsed || 'gemini-3.5-flash',
          groundingScore: report.groundingScore ?? 100,
          hallucinationRisk: (report.hallucinationRisk as any) || 'NONE',
          guardrailsApplied: report.guardrailsApplied ?? false,
          hallucinationsInterceptedCount: 0,
        },
        report.id
      );

      res.status(200).json(structured);
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

      res.status(200).json({
        ...report,
        targetUrl: report.targetUrl || 'https://conform-ia.med.br',
        summary: report.summary || 'Laudo de conformidade deontológica.',
        client: report.client || {
          id: report.clientId || 'avulso',
          name: 'Auditoria Direta / Avulsa',
          tradeName: 'Sem vínculo',
          crmResponsavel: '-',
          crmUf: '-',
        },
      });
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

      const dateStr = new Date(report.createdAt || Date.now()).toLocaleDateString('pt-BR');
      const semaphore =
        report.verdict === 'CONFORME'
          ? '🟢 REGULAR / CONFORME'
          : report.verdict === 'PARCIALMENTE_CONFORME'
          ? '🟡 PARCIALMENTE CONFORME (ATENÇÃO)'
          : '🔴 NÃO CONFORME (VIOLAÇÃO CRÍTICA)';

      const clientName = report.client?.name || 'Clínica Não Vinculada';
      const techResp = report.client
        ? `CRM/${report.client.crmUf || '-'} ${report.client.crmResponsavel || '-'}`
        : 'Não informado';

      let md = `# 🏥 LAUDO TÉCNICO DE CONFORMIDADE DEONTOLÓGICA & REGULATÓRIA\n`;
      md += `**Plataforma ConformIA** — Inteligência & Governança Ética em Saúde\n\n`;
      md += `---\n\n`;
      md += `### 📋 Dados da Instituição Auditada\n`;
      md += `- **Clínica:** ${clientName}\n`;
      md += `- **Responsável Técnico:** ${techResp}\n`;
      md += `- **Canal / URL Auditada:** ${report.targetUrl || 'N/A'}\n`;
      md += `- **Data da Auditoria:** ${dateStr}\n`;
      md += `- **Status da Auditoria:** ${report.status}\n\n`;
      md += `### 🚥 Veredito Semáforo & Pontuação\n`;
      md += `- **Veredito:** ${semaphore}\n`;
      md += `- **Score de Conformidade:** ${report.score ?? 0} / 100\n`;
      md += `- **Eficiência de Contexto:** ${report.tokensSaved ?? 0} tokens economizados via sanitização\n\n`;
      md += `### 📝 Resumo Executivo\n`;
      md += `${report.summary || 'Resumo executivo não disponível.'}\n\n`;
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

  /**
   * AI-05: Fluxo de Governança e Revisão Humana de Laudo Deontológico
   * Permite que auditores humanos homologuem, alterem ou rejeitem pareceres da IA
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

      const { decision, notes, adjustedScore, adjustedVerdict } = reviewSchema.parse(req.body);

      const report = await prisma.auditReport.findUnique({
        where: { id },
      });

      if (!report) {
        res.status(404).json({ error: 'Laudo de auditoria não encontrado.' });
        return;
      }

      // Atualiza contrato estruturado para conter o bloco auditável de revisão humana
      let contractObj: any = {};
      if (report.structuredContract) {
        try {
          contractObj = JSON.parse(report.structuredContract);
        } catch {}
      }

      contractObj.humanReview = {
        decision,
        reviewerId: req.user?.userId || 'system',
        reviewerEmail: req.user?.email || 'auditor@conformia.med.br',
        reviewedAt: new Date().toISOString(),
        notes,
        adjustedScore,
        adjustedVerdict,
      };

      const dataToUpdate: any = {
        structuredContract: JSON.stringify(contractObj),
      };

      if (decision === 'APPROVED') {
        dataToUpdate.requiresHumanReview = false;
        if (adjustedScore !== undefined) dataToUpdate.score = adjustedScore;
        if (adjustedVerdict !== undefined) dataToUpdate.verdict = adjustedVerdict;
      } else if (decision === 'REJECTED') {
        dataToUpdate.requiresHumanReview = false;
        dataToUpdate.verdict = Verdict.NAO_CONFORME;
        if (adjustedScore !== undefined) dataToUpdate.score = adjustedScore;
      } else if (decision === 'CHANGES_REQUESTED') {
        dataToUpdate.requiresHumanReview = true;
      }

      const updatedReport = await prisma.auditReport.update({
        where: { id },
        data: dataToUpdate,
      });

      // Registro de trilha de auditoria e conformidade (LGPD / CFM)
      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          module: 'HUMAN_REVIEW',
          message: `Revisão humana registrada: ${decision} para o laudo ${id}`,
          correlationId: id,
          details: JSON.stringify({
            decision,
            reviewerId: req.user?.userId,
            reviewerEmail: req.user?.email,
            notes,
            adjustedVerdict,
            adjustedScore,
          }),
        },
      });

      res.status(200).json({
        message: `Revisão humana registrada com sucesso (${decision}).`,
        report: updatedReport,
        review: contractObj.humanReview,
      });
    } catch (error) {
      next(error);
    }
  }
}

