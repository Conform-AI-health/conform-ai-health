import { ReportRepository } from '../repositories/reportRepository.js';
import { SystemLogRepository } from '../repositories/systemLogRepository.js';
import { AIStructuredContractAdapter } from '../shared/aiStructuredContract.js';
import { EmailService } from './emailService.js';
import { Role, Verdict, AuditStatus } from '@prisma/client';

export class ReportService {
  /**
   * Listagem de laudos com paginação, filtros e isolamento multi-tenant
   */
  public static async listReports(params: {
    page?: number;
    limit?: number;
    verdict?: Verdict;
    status?: AuditStatus;
    clientId?: string;
    currentUser?: { role: string; clientId?: string | null };
  }) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 10));

    let effectiveClientId = params.clientId;
    if (params.currentUser?.role === Role.CLIENT) {
      effectiveClientId = params.currentUser.clientId || 'none';
    }

    const where: any = {};
    if (effectiveClientId) where.clientId = effectiveClientId;
    if (params.verdict) where.verdict = params.verdict;
    if (params.status) where.status = params.status;

    const [total, reports] = await Promise.all([
      ReportRepository.count(where),
      ReportRepository.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        includeClient: true,
        includeViolations: true,
      }),
    ]);

    return { reports, total, page, limit };
  }

  /**
   * Retorna o laudo auditado por ID com validação de tenant
   */
  public static async getReportById(id: string, currentUser?: { role: string; clientId?: string | null }) {
    const report = await ReportRepository.findById(id, { includeClient: true, includeViolations: true });
    if (!report) {
      throw new Error('REPORT_NOT_FOUND');
    }

    if (currentUser?.role === Role.CLIENT && report.clientId !== currentUser.clientId) {
      throw new Error('TENANT_FORBIDDEN');
    }

    return report;
  }

  /**
   * Retorna o Contrato Estruturado de Alta Confiabilidade
   */
  public static async getStructuredContract(id: string, currentUser?: { role: string; clientId?: string | null }) {
    const report = await this.getReportById(id, currentUser);
    if (report.structuredContract) {
      try {
        return JSON.parse(report.structuredContract);
      } catch {}
    }

    const rawVerdict = String(report.verdict);
    const verdict = (rawVerdict === 'INCONCLUSIVO' ? 'PARCIALMENTE_CONFORME' : report.verdict) as
      | 'CONFORME'
      | 'PARCIALMENTE_CONFORME'
      | 'NAO_CONFORME';

    return AIStructuredContractAdapter.toStructuredContract(
      {
        verdict,
        score: report.score ?? 0,
        summary: report.summary || 'Laudo de conformidade deontológica.',
        violations: (report.violations || []).map((v: any) => ({
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
  }

  /**
   * Exporta laudo estruturado em formato Markdown
   */
  public static async exportMarkdown(id: string, currentUser?: { role: string; clientId?: string | null }): Promise<{ filename: string; content: string }> {
    const report = await this.getReportById(id, currentUser);

    const clientName = report.client?.name || 'Cliente Não Identificado';
    const crm = report.client?.crmResponsavel
      ? `${report.client.crmResponsavel}/${report.client.crmUf || ''}`
      : 'Não Informado';

    const header = [
      `# Relatório de Conformidade Deontológica & Regulatória`,
      `**ID da Auditoria:** ${report.id}`,
      `**Clínica / Entidade:** ${clientName}`,
      `**Responsável Técnico (CRM):** ${crm}`,
      `**URL Auditada:** ${report.targetUrl || 'N/A'}`,
      `**Data da Auditoria:** ${new Date(report.createdAt).toLocaleString('pt-BR')}`,
      `**Veredito:** ${report.verdict}`,
      `**Pontuação de Conformidade:** ${report.score ?? 0}/100`,
      `**Status:** ${report.status}`,
      `\n---\n`,
      `## Sumário Executivo`,
      report.summary || 'Nenhum sumário registrado.',
      `\n---\n`,
      `## Detalhamento de Violações Identificadas`,
    ];

    const violationsList = (report.violations || []).map((v: any, index: number) => {
      return [
        `### ${index + 1}. [${v.severity}] ${v.normCode || 'Norma'} - Art. ${v.normArticle || 'N/A'}`,
        `**Status:** ${v.resolved ? '✅ RESOLVIDO' : '❌ PENDENTE'}`,
        `**Descrição da Não-Conformidade:**\n${v.description || 'Sem descrição.'}`,
        `**Recomendação de Adequação:**\n${v.recommendation || 'Sem recomendação.'}`,
        v.resolved ? `*Resolução registrada em ${new Date(v.resolvedAt).toLocaleString('pt-BR')} por ${v.resolvedBy || 'Auditor'}*` : '',
        `\n`,
      ].filter(Boolean).join('\n');
    });

    const footer = [
      `---\n`,
      `*Relatório gerado automaticamente pela plataforma Conform.AI Health em conformidade com as resoluções do CFM, ANS e ANVISA.*`,
    ];

    const content = [...header, ...violationsList, ...footer].join('\n');
    const filename = `relatorio-conformidade-${report.id.slice(-6)}.md`;

    return { filename, content };
  }

  /**
   * Resolução de uma violação pelo auditor
   */
  public static async resolveViolation(reportId: string, violationId: string, data: { resolutionNote?: string }, currentUser?: { name?: string; role?: string }) {
    const report = await ReportRepository.findById(reportId);
    if (!report) {
      throw new Error('REPORT_NOT_FOUND');
    }

    const violation = await ReportRepository.findViolationById(violationId);
    if (!violation) {
      throw new Error('VIOLATION_NOT_FOUND');
    }

    const updatedViolation = await ReportRepository.updateViolation(violationId, {
      resolved: true,
      resolutionNote: data.resolutionNote || 'Violação marcada como resolvida pelo auditor.',
      resolvedAt: new Date(),
      resolvedBy: currentUser?.name || 'Auditor Responsável',
    });

    const unresolvedCount = await ReportRepository.countUnresolvedViolations(reportId);
    if (unresolvedCount === 0 && report.verdict !== Verdict.CONFORME) {
      await ReportRepository.update(reportId, {
        verdict: Verdict.CONFORME,
        score: 100,
      });
    }

    return updatedViolation;
  }

  /**
   * AI-05: Revisão manual humana do laudo por Auditor/Admin com bloco auditável humanReview
   */
  public static async reviewReport(
    reportId: string,
    reviewData: {
      decision: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED';
      notes: string;
      adjustedScore?: number;
      adjustedVerdict?: Verdict;
    },
    currentUser?: { userId?: string; email?: string }
  ) {
    const report = await ReportRepository.findById(reportId);
    if (!report) {
      throw new Error('REPORT_NOT_FOUND');
    }

    let contractObj: any = {};
    if (report.structuredContract) {
      try {
        contractObj = JSON.parse(report.structuredContract);
      } catch {}
    }

    contractObj.humanReview = {
      decision: reviewData.decision,
      reviewerId: currentUser?.userId || 'system',
      reviewerEmail: currentUser?.email || 'auditor@conformia.med.br',
      reviewedAt: new Date().toISOString(),
      notes: reviewData.notes,
      adjustedScore: reviewData.adjustedScore,
      adjustedVerdict: reviewData.adjustedVerdict,
    };

    const dataToUpdate: any = {
      structuredContract: JSON.stringify(contractObj),
    };

    if (reviewData.decision === 'APPROVED') {
      dataToUpdate.requiresHumanReview = false;
      if (reviewData.adjustedScore !== undefined) dataToUpdate.score = reviewData.adjustedScore;
      if (reviewData.adjustedVerdict !== undefined) dataToUpdate.verdict = reviewData.adjustedVerdict;
    } else if (reviewData.decision === 'REJECTED') {
      dataToUpdate.requiresHumanReview = false;
      dataToUpdate.verdict = Verdict.NAO_CONFORME;
      if (reviewData.adjustedScore !== undefined) dataToUpdate.score = reviewData.adjustedScore;
    } else if (reviewData.decision === 'CHANGES_REQUESTED') {
      dataToUpdate.requiresHumanReview = true;
    }

    const updatedReport = await ReportRepository.update(reportId, dataToUpdate);

    await SystemLogRepository.create({
      level: 'INFO',
      module: 'HUMAN_REVIEW',
      message: `Revisão humana registrada: ${reviewData.decision} para o laudo ${reportId}`,
      correlationId: reportId,
      details: JSON.stringify({
        decision: reviewData.decision,
        reviewerId: currentUser?.userId,
        reviewerEmail: currentUser?.email,
        notes: reviewData.notes,
        adjustedVerdict: reviewData.adjustedVerdict,
        adjustedScore: reviewData.adjustedScore,
      }),
    });

    return { report: updatedReport, review: contractObj.humanReview };
  }

  /**
   * Reenvia notificação de laudo por e-mail para a clínica e grava telemetria auditável
   */
  public static async notifyClient(
    reportId: string,
    currentUser?: { role?: string; clientId?: string | null; email?: string }
  ): Promise<{ recipient: string; messageId?: string }> {
    const report = await ReportRepository.findById(reportId, { includeClient: true, includeViolations: true });
    if (!report) {
      throw new Error('REPORT_NOT_FOUND');
    }

    if (currentUser?.role === Role.CLIENT && report.clientId !== currentUser.clientId) {
      throw new Error('TENANT_FORBIDDEN');
    }

    const client = report.client;
    const clientName = client?.tradeName || client?.name || 'Clínica Médica';
    const recipientEmail =
      client?.email || (client?.users && client.users.length > 0 ? client.users[0].email : null);

    if (!recipientEmail) {
      await SystemLogRepository.create({
        level: 'WARN',
        module: 'EMAIL_NOTIFICATION',
        correlationId: reportId,
        message: `[EMAIL_NOTIFICATION] Falha ao disparar e-mail: Nenhum e-mail de destino encontrado para a clínica "${clientName}".`,
        details: JSON.stringify({ auditReportId: reportId, clientId: report.clientId }),
      });
      throw new Error('CLIENT_HAS_NO_EMAIL');
    }

    const emailResult = await EmailService.sendAuditReportCompletedEmail(recipientEmail, clientName, {
      id: report.id,
      targetUrl: report.targetUrl || '',
      score: report.score ?? 0,
      verdict: report.verdict,
      summary: report.summary,
      violationsCount: (report.violations || []).length,
    });

    if (!emailResult.success) {
      const errorDetail = emailResult.error || 'Erro no provedor de mensageria';
      await SystemLogRepository.create({
        level: 'WARN',
        module: 'EMAIL_NOTIFICATION',
        correlationId: reportId,
        message: `[EMAIL_NOTIFICATION] Falha no disparo de notificação de laudo para ${recipientEmail}: ${errorDetail}`,
        details: JSON.stringify({
          auditReportId: reportId,
          recipientEmail,
          error: emailResult.error,
          requestedBy: currentUser?.email,
        }),
      });
      throw new Error(`EMAIL_DELIVERY_FAILED:${errorDetail}`);
    }

    await SystemLogRepository.create({
      level: 'INFO',
      module: 'EMAIL_NOTIFICATION',
      correlationId: reportId,
      message: `[EMAIL_NOTIFICATION] Notificação de laudo enviada com sucesso para ${recipientEmail} | MessageId: ${emailResult.messageId || 'mocked'} por ${currentUser?.email || 'sistema'}`,
      details: JSON.stringify({
        auditReportId: reportId,
        recipientEmail,
        messageId: emailResult.messageId,
        requestedBy: currentUser?.email,
      }),
    });

    return { recipient: recipientEmail, messageId: emailResult.messageId };
  }

  /**
   * Laudos pendentes de revisão humana
   */
  public static async getPendingReview(page: number = 1, limit: number = 20) {
    const where: any = {
      status: AuditStatus.COMPLETED,
      reviewStatus: { notIn: ['APPROVED', 'REJECTED'] },
      OR: [
        { reviewStatus: 'PENDING_REVIEW' },
        { auditorReviewed: false },
      ],
    };

    const [total, reports] = await Promise.all([
      ReportRepository.count(where),
      ReportRepository.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        includeClient: true,
        includeViolations: true,
      }),
    ]);

    return { reports, total, page, limit };
  }

  /**
   * Laudos já revisados por auditores
   */
  public static async getProcessedReview(page: number = 1, limit: number = 20) {
    const where: any = {
      OR: [
        { auditorReviewed: true },
        { reviewStatus: { in: ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED'] } },
      ],
    };

    const [total, reports] = await Promise.all([
      ReportRepository.count(where),
      ReportRepository.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        includeClient: true,
        includeViolations: true,
      }),
    ]);

    return { reports, total, page, limit };
  }

  /**
   * Homologação de laudo pelo auditor humano com checkbox obrigatório e envio condicional à clínica
   */
  public static async confirmAndSendEmail(
    reportId: string,
    payload: {
      confirmed: boolean;
      decision: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED';
      notes?: string;
      adjustedScore?: number;
      adjustedVerdict?: Verdict;
    },
    currentUser?: { userId?: string; email?: string }
  ) {
    const report = await ReportRepository.findById(reportId, { includeClient: true, includeViolations: true });
    if (!report) {
      throw new Error('REPORT_NOT_FOUND');
    }

    const { confirmed, decision, notes, adjustedScore, adjustedVerdict } = payload;
    const client = report.client;
    const clientName = client?.tradeName || client?.name || 'Clínica Médica';
    const reviewerIdentifier = currentUser?.email || currentUser?.userId || 'auditor';

    let contractObj: any = {};
    if (report.structuredContract) {
      try {
        contractObj = JSON.parse(report.structuredContract);
      } catch {}
    }

    contractObj.humanReview = {
      decision,
      confirmed,
      reviewerId: currentUser?.userId || 'system',
      reviewerEmail: currentUser?.email || 'auditor@conformia.med.br',
      reviewedAt: new Date().toISOString(),
      notes:
        notes ||
        (decision === 'REJECTED'
          ? 'Laudo recusado pelo auditor responsável.'
          : 'Laudo revisado e confirmado pelo auditor responsável.'),
      adjustedScore,
      adjustedVerdict,
    };

    const finalScore =
      adjustedScore !== undefined
        ? adjustedScore
        : decision === 'REJECTED'
        ? Math.min(report.score ?? 50, 40)
        : report.score ?? 0;
    const finalVerdict =
      adjustedVerdict !== undefined
        ? adjustedVerdict
        : decision === 'REJECTED'
        ? Verdict.NAO_CONFORME
        : report.verdict;

    // 1. Atualiza dados do laudo
    const updatedReport = await ReportRepository.update(reportId, {
      reviewStatus: decision,
      auditorReviewed: true,
      reviewedBy: reviewerIdentifier,
      reviewedAt: new Date(),
      auditorNotes: notes,
      requiresHumanReview: decision === 'CHANGES_REQUESTED',
      score: finalScore,
      verdict: finalVerdict,
      structuredContract: JSON.stringify(contractObj),
    });

    // 2. Registro no SystemLog da homologação humana
    await SystemLogRepository.create({
      level: 'INFO',
      module: 'AUDIT_REVIEW',
      correlationId: reportId,
      message: `[AUDITOR_CONFIRMED] Laudo ${reportId} revisado e confirmado pelo auditor ${reviewerIdentifier} com decisão: ${decision}.`,
      details: JSON.stringify({
        auditReportId: reportId,
        reviewer: reviewerIdentifier,
        decision,
        notes,
        score: finalScore,
        verdict: finalVerdict,
      }),
    });

    // 3. Apenas se aprovado, dispara o e-mail à clínica
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
        await SystemLogRepository.create({
          level: 'WARN',
          module: 'EMAIL_NOTIFICATION',
          correlationId: reportId,
          message: `[EMAIL_WARN] Auditor confirmou o laudo ${reportId}, mas nenhum e-mail válido foi encontrado para a clínica "${clientName}".`,
          details: JSON.stringify({ auditReportId: reportId, clientName }),
        });
      } else {
        for (const email of resolvedEmails) {
          try {
            const emailResult = await EmailService.sendAuditReportCompletedEmail(email, clientName, {
              id: report.id,
              targetUrl: report.targetUrl || '',
              score: finalScore,
              verdict: finalVerdict,
              summary: report.summary,
              violationsCount: (report.violations || []).length,
            });

            if (emailResult.success) {
              emailDispatched = true;
              await SystemLogRepository.create({
                level: 'INFO',
                module: 'EMAIL_NOTIFICATION',
                correlationId: reportId,
                message: `[EMAIL_SUCCESS] E-mail de conclusão de laudo enviado com sucesso para ${email} (Clínica: ${clientName}) após confirmação do auditor ${reviewerIdentifier}. MessageId: ${emailResult.messageId || 'MOCK'}`,
                details: JSON.stringify({
                  auditReportId: reportId,
                  email,
                  messageId: emailResult.messageId,
                  reviewer: reviewerIdentifier,
                }),
              });
            } else {
              await SystemLogRepository.create({
                level: 'WARN',
                module: 'EMAIL_NOTIFICATION',
                correlationId: reportId,
                message: `[EMAIL_WARN] Falha ao enviar e-mail para ${email} após confirmação do auditor: ${emailResult.error}`,
                details: JSON.stringify({ auditReportId: reportId, email, error: emailResult.error }),
              });
            }
          } catch (err: any) {
            await SystemLogRepository.create({
              level: 'ERROR',
              module: 'EMAIL_NOTIFICATION',
              correlationId: reportId,
              message: `[EMAIL_ERROR] Exceção ao enviar e-mail para ${email}: ${err.message}`,
              details: JSON.stringify({ auditReportId: reportId, email, error: err.message }),
            });
          }
        }

        if (emailDispatched) {
          await ReportRepository.update(reportId, {
            emailSent: true,
            emailSentAt: new Date(),
          });
        }
      }
    }

    return { report: updatedReport, emailSent: emailDispatched, decision };
  }
}
