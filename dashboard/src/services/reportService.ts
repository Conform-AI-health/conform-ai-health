import { ReportRepository } from '../repositories/reportRepository.js';
import { ClientRepository } from '../repositories/clientRepository.js';
import { AIStructuredContractAdapter } from '../shared/aiStructuredContract.js';
import { EmailService } from './emailService.js';
import { Role, Verdict, AuditStatus, RuleSeverity } from '@prisma/client';

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
   * Revisão manual humana do laudo por Auditor/Admin
   */
  public static async reviewReport(reportId: string, reviewData: any, currentUser?: { name?: string }) {
    const report = await ReportRepository.findById(reportId);
    if (!report) {
      throw new Error('REPORT_NOT_FOUND');
    }

    const updated = await ReportRepository.update(reportId, {
      reviewStatus: reviewData.reviewStatus || 'REVIEWED',
      auditorReviewed: true,
      reviewedBy: currentUser?.name || 'Auditor',
      reviewedAt: new Date(),
      verdict: reviewData.verdict || report.verdict,
      score: reviewData.score !== undefined ? reviewData.score : report.score,
      summary: reviewData.summary || report.summary,
    });

    return updated;
  }

  /**
   * Notificação de laudo por e-mail para a clínica
   */
  public static async notifyClient(reportId: string) {
    const report = await ReportRepository.findById(reportId, { includeClient: true, includeViolations: true });
    if (!report || !report.client) {
      throw new Error('CLIENT_OR_REPORT_NOT_FOUND');
    }

    const targetEmail = report.client.email;
    if (!targetEmail) {
      throw new Error('CLIENT_HAS_NO_EMAIL');
    }

    await EmailService.sendAuditReportCompletedEmail(targetEmail, report.client.name, {
      id: report.id,
      verdict: report.verdict,
      score: report.score ?? 0,
      targetUrl: report.targetUrl || '',
      summary: report.summary || '',
      violationsCount: (report.violations || []).length,
    });

    await ReportRepository.update(reportId, {
      emailSent: true,
      emailSentAt: new Date(),
    });
  }

  /**
   * Laudos pendentes de revisão humana
   */
  public static async getPendingReview(page: number = 1, limit: number = 10) {
    const where = {
      requiresHumanReview: true,
      reviewStatus: 'PENDING_REVIEW',
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
  public static async getProcessedReview(page: number = 1, limit: number = 10) {
    const where = {
      auditorReviewed: true,
    };

    const [total, reports] = await Promise.all([
      ReportRepository.count(where),
      ReportRepository.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { reviewedAt: 'desc' },
        includeClient: true,
        includeViolations: true,
      }),
    ]);

    return { reports, total, page, limit };
  }

  /**
   * Confirmação e envio customizado de laudo revisado
   */
  public static async confirmAndSendEmail(reportId: string, emailTo?: string, customMessage?: string, currentUser?: { name?: string }) {
    const report = await ReportRepository.findById(reportId, { includeClient: true, includeViolations: true });
    if (!report) {
      throw new Error('REPORT_NOT_FOUND');
    }

    const recipient = emailTo || report.client?.email;
    if (!recipient) {
      throw new Error('CLIENT_HAS_NO_EMAIL');
    }

    await EmailService.sendAuditReportCompletedEmail(recipient, report.client?.name || 'Clínica', {
      id: report.id,
      verdict: report.verdict,
      score: report.score ?? 0,
      targetUrl: report.targetUrl || '',
      summary: customMessage || report.summary || '',
      violationsCount: (report.violations || []).length,
    });

    await ReportRepository.update(reportId, {
      emailSent: true,
      emailSentAt: new Date(),
      reviewStatus: 'APPROVED_AND_SENT',
      reviewedBy: currentUser?.name || 'Auditor',
      reviewedAt: new Date(),
    });
  }
}
