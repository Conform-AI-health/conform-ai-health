import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { Role, Verdict, AuditStatus, RuleSeverity } from '@prisma/client';
import { AIStructuredContractAdapter } from '../shared/aiStructuredContract.js';
import { EmailService } from '../services/emailService.js';

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

      const rawVerdict = String(report.verdict);
      const verdict = (rawVerdict === 'INCONCLUSIVO' ? 'PARCIALMENTE_CONFORME' : report.verdict) as
        | 'CONFORME'
        | 'PARCIALMENTE_CONFORME'
        | 'NAO_CONFORME';

      const structured = AIStructuredContractAdapter.toStructuredContract(
        {
          verdict,
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
          groundingScore: report.groundingScore ?? null,
          hallucinationRisk: (report.hallucinationRisk as any) || 'NOT_EVALUATED',
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

  /**
   * Reenvia notificação por e-mail para a clínica e grava telemetria auditável
   */
  public static async notifyClient(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const report = await prisma.auditReport.findUnique({
        where: { id },
        include: {
          client: {
            include: { users: { select: { email: true } } },
          },
          violations: true,
        },
      });

      if (!report) {
        res.status(404).json({ error: 'Laudo de auditoria não encontrado.' });
        return;
      }

      // Se perfil for CLIENT, valida se pertence à sua clínica
      if (req.user?.role === Role.CLIENT && report.clientId !== req.user.clientId) {
        res.status(403).json({ error: 'Acesso negado ao laudo desta clínica.' });
        return;
      }

      const client = report.client;
      const clientName = client?.tradeName || client?.name || 'Clínica Médica';
      const recipientEmail = client?.email || (client?.users && client.users.length > 0 ? client.users[0].email : null);

      if (!recipientEmail) {
        await prisma.systemLog.create({
          data: {
            level: 'WARN',
            module: 'EMAIL_NOTIFICATION',
            correlationId: id,
            message: `[EMAIL_NOTIFICATION] Falha ao disparar e-mail: Nenhum e-mail de destino encontrado para a clínica "${clientName}".`,
            details: JSON.stringify({ auditReportId: id, clientId: report.clientId }),
          },
        }).catch(() => {});

        res.status(400).json({ error: 'Clínica não possui endereço de e-mail cadastrado.' });
        return;
      }

      const emailResult = await EmailService.sendAuditReportCompletedEmail(recipientEmail, clientName, {
        id: report.id,
        targetUrl: report.targetUrl || '',
        score: report.score ?? 0,
        verdict: report.verdict,
        summary: report.summary,
        violationsCount: report.violations.length,
      });

      if (!emailResult.success) {
        await prisma.systemLog.create({
          data: {
            level: 'WARN',
            module: 'EMAIL_NOTIFICATION',
            correlationId: id,
            message: `[EMAIL_NOTIFICATION] Falha no disparo de notificação de laudo para ${recipientEmail}: ${emailResult.error || 'Erro no provedor de mensageria'}`,
            details: JSON.stringify({ auditReportId: id, recipientEmail, error: emailResult.error, requestedBy: req.user?.email }),
          },
        }).catch(() => {});

        res.status(502).json({ error: `Falha no envio de e-mail: ${emailResult.error || 'Erro no provedor de mensageria'}` });
        return;
      }

      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          module: 'EMAIL_NOTIFICATION',
          correlationId: id,
          message: `[EMAIL_NOTIFICATION] Notificação de laudo enviada com sucesso para ${recipientEmail} | MessageId: ${emailResult.messageId || 'mocked'} por ${req.user?.email || 'sistema'}`,
          details: JSON.stringify({ auditReportId: id, recipientEmail, messageId: emailResult.messageId, requestedBy: req.user?.email }),
        },
      }).catch(() => {});

      res.status(200).json({
        message: 'Notificação de laudo enviada com sucesso para a clínica.',
        recipient: recipientEmail,
        messageId: emailResult.messageId,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Lista todos os laudos que aguardam revisão/homologação de um auditor humano
   * (reviewStatus === 'PENDING_REVIEW' ou auditorReviewed === false)
   */
  public static async getPendingReview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));

      const where: any = {
        status: AuditStatus.COMPLETED,
        reviewStatus: { notIn: ['APPROVED', 'REJECTED'] },
        OR: [
          { reviewStatus: 'PENDING_REVIEW' },
          { auditorReviewed: false },
        ],
      };

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
                email: true,
                users: { select: { email: true } },
              },
            },
            violations: {
              orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }],
            },
          },
        }),
      ]);

      res.status(200).json({
        data: reports.map((r) => ({
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
   * Lista todos os laudos que já foram processados/homologados pelo auditor humano
   * (auditorReviewed === true ou reviewStatus !== 'PENDING_REVIEW')
   */
  public static async getProcessedReview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));

      const where: any = {
        OR: [
          { auditorReviewed: true },
          { reviewStatus: { in: ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED'] } },
        ],
      };

      const [total, reports] = await Promise.all([
        prisma.auditReport.count({ where }),
        prisma.auditReport.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { updatedAt: 'desc' },
          include: {
            client: {
              select: {
                id: true,
                name: true,
                tradeName: true,
                crmResponsavel: true,
                crmUf: true,
                email: true,
                users: { select: { email: true } },
              },
            },
            violations: {
              orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }],
            },
          },
        }),
      ]);

      res.status(200).json({
        data: reports.map((r) => ({
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
   * Homologa o laudo pelo auditor humano com checkbox obrigatório e dispara o e-mail oficial à clínica.
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

      const { confirmed, decision, notes, adjustedScore, adjustedVerdict } = confirmSchema.parse(req.body);

      const report = await prisma.auditReport.findUnique({
        where: { id },
        include: {
          client: {
            include: { users: { select: { email: true } } },
          },
          violations: true,
        },
      });

      if (!report) {
        res.status(404).json({ error: 'Laudo de auditoria não encontrado.' });
        return;
      }

      const client = report.client;
      const clientName = client?.tradeName || client?.name || 'Clínica Médica';
      const reviewerIdentifier = req.user?.email || req.user?.userId || 'auditor';

      // Atualiza o contrato estruturado com o bloco auditável de revisão humana
      let contractObj: any = {};
      if (report.structuredContract) {
        try {
          contractObj = JSON.parse(report.structuredContract);
        } catch {}
      }

      contractObj.humanReview = {
        decision,
        confirmed,
        reviewerId: req.user?.userId || 'system',
        reviewerEmail: req.user?.email || 'auditor@conformia.med.br',
        reviewedAt: new Date().toISOString(),
        notes: notes || (decision === 'REJECTED' ? 'Laudo recusado pelo auditor responsável.' : 'Laudo revisado e confirmado pelo auditor responsável.'),
        adjustedScore,
        adjustedVerdict,
      };

      const finalScore = adjustedScore !== undefined
        ? adjustedScore
        : (decision === 'REJECTED' ? Math.min(report.score ?? 50, 40) : (report.score ?? 0));
      const finalVerdict = adjustedVerdict !== undefined
        ? adjustedVerdict
        : (decision === 'REJECTED' ? Verdict.NAO_CONFORME : report.verdict);

      // 1. Atualiza dados do laudo
      const updatedReport = await prisma.auditReport.update({
        where: { id },
        data: {
          reviewStatus: decision,
          auditorReviewed: true,
          reviewedBy: reviewerIdentifier,
          reviewedAt: new Date(),
          auditorNotes: notes,
          requiresHumanReview: decision === 'CHANGES_REQUESTED',
          score: finalScore,
          verdict: finalVerdict,
          structuredContract: JSON.stringify(contractObj),
        },
      });

      // 2. Registro no SystemLog da homologação humana
      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          module: 'AUDIT_REVIEW',
          correlationId: id,
          message: `[AUDITOR_CONFIRMED] Laudo ${id} revisado e confirmado pelo auditor ${reviewerIdentifier} com decisão: ${decision}.`,
          details: JSON.stringify({
            auditReportId: id,
            reviewer: reviewerIdentifier,
            decision,
            notes,
            score: finalScore,
            verdict: finalVerdict,
          }),
        },
      }).catch(() => {});

      // 3. Se aprovado, dispara o e-mail à clínica
      let emailDispatched = false;

      if (decision === 'APPROVED') {
        const resolvedEmails: string[] = [];
        if (client?.email && client.email.trim().length > 0) {
          resolvedEmails.push(client.email.trim());
        }
        if (client?.users && client.users.length > 0) {
          for (const u of client.users) {
            if (u.email && u.email.trim().length > 0 && !resolvedEmails.includes(u.email.trim())) {
              resolvedEmails.push(u.email.trim());
            }
          }
        }

        if (resolvedEmails.length === 0) {
          await prisma.systemLog.create({
            data: {
              level: 'WARN',
              module: 'EMAIL_NOTIFICATION',
              correlationId: id,
              message: `[EMAIL_WARN] Auditor confirmou o laudo ${id}, mas nenhum e-mail válido foi encontrado para a clínica "${clientName}".`,
              details: JSON.stringify({ auditReportId: id, clientName }),
            },
          }).catch(() => {});
        } else {
          for (const email of resolvedEmails) {
            try {
              const emailResult = await EmailService.sendAuditReportCompletedEmail(email, clientName, {
                id: report.id,
                targetUrl: report.targetUrl || '',
                score: finalScore,
                verdict: finalVerdict,
                summary: report.summary,
                violationsCount: report.violations.length,
              });

              if (emailResult.success) {
                emailDispatched = true;
                await prisma.systemLog.create({
                  data: {
                    level: 'INFO',
                    module: 'EMAIL_NOTIFICATION',
                    correlationId: id,
                    message: `[EMAIL_SUCCESS] E-mail de conclusão de laudo enviado com sucesso para ${email} (Clínica: ${clientName}) após confirmação do auditor ${reviewerIdentifier}. MessageId: ${emailResult.messageId || 'MOCK'}`,
                    details: JSON.stringify({ auditReportId: id, email, messageId: emailResult.messageId, reviewer: reviewerIdentifier }),
                  },
                }).catch(() => {});
              } else {
                await prisma.systemLog.create({
                  data: {
                    level: 'WARN',
                    module: 'EMAIL_NOTIFICATION',
                    correlationId: id,
                    message: `[EMAIL_WARN] Falha ao enviar e-mail para ${email} após confirmação do auditor: ${emailResult.error}`,
                    details: JSON.stringify({ auditReportId: id, email, error: emailResult.error }),
                  },
                }).catch(() => {});
              }
            } catch (err: any) {
              await prisma.systemLog.create({
                data: {
                  level: 'ERROR',
                  module: 'EMAIL_NOTIFICATION',
                  correlationId: id,
                  message: `[EMAIL_ERROR] Exceção ao enviar e-mail para ${email}: ${err.message}`,
                  details: JSON.stringify({ auditReportId: id, email, error: err.message }),
                },
              }).catch(() => {});
            }
          }

          if (emailDispatched) {
            await prisma.auditReport.update({
              where: { id },
              data: {
                emailSent: true,
                emailSentAt: new Date(),
              },
            });
          }
        }
      }

      res.status(200).json({
        message: decision === 'APPROVED'
          ? 'Laudo confirmado e homologado com sucesso! E-mail de notificação processado para a clínica.'
          : (decision === 'REJECTED'
             ? 'Laudo recusado pelo auditor com sucesso. Nenhum e-mail foi disparado para a clínica.'
             : `Revisão do auditor registrada com sucesso (${decision}).`),
        report: updatedReport,
        emailSent: emailDispatched,
      });
    } catch (error) {
      next(error);
    }
  }
}

