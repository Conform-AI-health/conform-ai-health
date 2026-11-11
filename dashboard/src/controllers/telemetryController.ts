import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { ReconciliationEngine } from '../services/reconciliationEngine.js';

export class TelemetryController {
  // Preços de referência para Gemini 2.0 / 3.5 Flash por milhão de tokens
  private static readonly PRICE_PROMPT_PER_MILLION_USD = 0.075;
  private static readonly PRICE_COMPLETION_PER_MILLION_USD = 0.30;
  private static readonly USD_TO_BRL = 5.50;

  public static async getTelemetry(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // 1. Relatórios de Auditoria Concluídos
      const reports = await prisma.auditReport.findMany({
        where: { status: 'COMPLETED' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          client: {
            select: { name: true, tradeName: true, crmResponsavel: true, crmUf: true },
          },
          violations: {
            select: { id: true, severity: true, resolved: true, normCode: true },
          },
        },
      });

      // 2. Tokens de Entrada e Saída
      const totalPromptTokens = reports.reduce((acc, r) => acc + (r.promptTokens || 0), 0);
      const totalCompletionTokens = reports.reduce((acc, r) => acc + (r.completionTokens || 0), 0);
      const totalTokens = reports.reduce((acc, r) => acc + (r.totalTokens || ((r.promptTokens || 0) + (r.completionTokens || 0))), 0);
      const totalTokensSaved = reports.reduce((acc, r) => acc + (r.tokensSaved || 0), 0);
      const totalAudits = reports.length;

      // 3. Latência por Chamada de LLM
      const latencies = reports.map((r) => r.executionTimeMs || 0).sort((a, b) => a - b);
      const averageLatencyMs =
        totalAudits > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / totalAudits) : 0;
      const minLatencyMs = latencies.length > 0 ? latencies[0] : 0;
      const maxLatencyMs = latencies.length > 0 ? latencies[latencies.length - 1] : 0;
      const p95Index = Math.floor(latencies.length * 0.95);
      const p95LatencyMs = latencies.length > 0 ? latencies[p95Index] : 0;

      // 4. Custo Financeiro por Auditoria e Acumulado
      const calculateCost = (promptTokens: number, completionTokens: number) => {
        const costUsd =
          (promptTokens / 1_000_000) * TelemetryController.PRICE_PROMPT_PER_MILLION_USD +
          (completionTokens / 1_000_000) * TelemetryController.PRICE_COMPLETION_PER_MILLION_USD;
        const costBrl = costUsd * TelemetryController.USD_TO_BRL;
        return {
          costUsd: Number(costUsd.toFixed(6)),
          costBrl: Number(costBrl.toFixed(4)),
        };
      };

      const totalCost = calculateCost(totalPromptTokens, totalCompletionTokens);
      const averageCostPerAuditUsd =
        totalAudits > 0 ? Number((totalCost.costUsd / totalAudits).toFixed(6)) : 0;
      const averageCostPerAuditBrl =
        totalAudits > 0 ? Number((totalCost.costBrl / totalAudits).toFixed(4)) : 0;

      // 5. Logs Recentes para Extração de Métricas de Falha e Guardrails
      const recentLogs = await prisma.systemLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 150,
      });

      // 6. Taxa de Respostas sem Evidências e Taxa de Citações Inválidas (Guardrails Analytics)
      const guardrailLogs = recentLogs.filter((l) => l.module === 'AI_GUARDRAILS');
      let fabricatedEvidenceIncidents = 0;
      let invalidCitationIncidents = 0;

      guardrailLogs.forEach((l) => {
        try {
          if (l.details) {
            const parsed = JSON.parse(l.details);
            if (Array.isArray(parsed.incidents)) {
              parsed.incidents.forEach((inc: any) => {
                if (inc.type === 'FABRICATED_EVIDENCE') fabricatedEvidenceIncidents++;
                if (inc.type === 'UNGROUNDED_NORM' || inc.type === 'REVOKED_NORM') invalidCitationIncidents++;
              });
            }
          }
        } catch {}
      });

      const totalEvaluatedAudits = Math.max(1, totalAudits);
      const evidenceMissingRate = Number(((fabricatedEvidenceIncidents / totalEvaluatedAudits) * 100).toFixed(1));
      const invalidCitationsRate = Number(((invalidCitationIncidents / totalEvaluatedAudits) * 100).toFixed(1));

      // 7. Taxa de Divergência entre Avaliadores Humanos e IA
      let totalViolationsReported = 0;
      let totalHumanResolvedViolations = 0;

      reports.forEach((r) => {
        const viols = r.violations || [];
        totalViolationsReported += viols.length;
        totalHumanResolvedViolations += viols.filter((v: any) => v.resolved).length;
      });

      const humanAiDivergenceRate =
        totalViolationsReported > 0
          ? Number(((totalHumanResolvedViolations / totalViolationsReported) * 100).toFixed(1))
          : 0;

      // 8. Métricas de Notificações por E-mail (Telemetria & Mensageria)
      const emailLogs = recentLogs.filter((l) => l.module === 'EMAIL_NOTIFICATION');
      const emailSentCount = emailLogs.filter((l) => l.level === 'INFO').length;
      const emailFailedCount = emailLogs.filter((l) => l.level === 'WARN' || l.level === 'ERROR').length;
      const emailDeliveryRate = emailLogs.length > 0 ? Number(((emailSentCount / emailLogs.length) * 100).toFixed(1)) : 100;

      // 9. Taxa de Falhas por Modelo
      const modelUsageCounts: Record<string, { total: number; failures: number }> = {
        gemini: { total: 0, failures: 0 },
        ollama: { total: 0, failures: 0 },
        heuristic: { total: 0, failures: 0 },
      };

      reports.forEach((r) => {
        const model = (r.aiModelUsed || 'gemini').toLowerCase();
        if (model.includes('gemini')) modelUsageCounts.gemini.total++;
        else if (model.includes('ollama')) modelUsageCounts.ollama.total++;
        else modelUsageCounts.heuristic.total++;
      });

      recentLogs.forEach((l) => {
        if (l.level === 'WARN' || l.level === 'ERROR') {
          if (l.message.includes('Gemini')) modelUsageCounts.gemini.failures++;
          if (l.message.includes('Ollama')) modelUsageCounts.ollama.failures++;
        }
      });

      const modelFailureRates = Object.entries(modelUsageCounts).map(([model, data]) => {
        const rate = data.total > 0 ? Number(((data.failures / (data.total + data.failures)) * 100).toFixed(1)) : 0;
        return {
          model,
          invocations: data.total,
          failures: data.failures,
          failureRate: rate,
        };
      });

      // 9. Histórico de Prompts e Versões dos Agentes
      const agentModules = await prisma.agentModule.findMany({
        select: {
          id: true,
          name: true,
          version: true,
          regulatoryFramework: true,
          systemPrompt: true,
          tags: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
      });

      const promptVersionHistory = agentModules.map((m) => ({
        moduleId: m.id,
        agentName: m.name,
        version: m.version,
        framework: m.regulatoryFramework || 'CFM (Resolução 2.336/2023)',
        promptSnippet: m.systemPrompt ? `${m.systemPrompt.substring(0, 120)}...` : 'Prompt Padrão de Deontologia Médica',
        tags: m.tags,
        updatedAt: m.updatedAt,
      }));

      // Fontes mais utilizadas
      const sourcesMap: Record<string, number> = {};
      reports.forEach((r) => {
        const sources = r.sourcesUsed || [];
        sources.forEach((s) => {
          sourcesMap[s] = (sourcesMap[s] || 0) + 1;
        });
      });

      const sourcesDistribution = Object.entries(sourcesMap)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // 10. Resposta consolidada
      res.status(200).json({
        metrics: {
          totalPromptTokens,
          totalCompletionTokens,
          totalTokens,
          totalTokensSaved,
          savingsPercentage:
            totalTokens + totalTokensSaved > 0
              ? Math.round((totalTokensSaved / (totalTokens + totalTokensSaved)) * 100)
              : 0,
          averageLatencyMs,
          minLatencyMs,
          maxLatencyMs,
          p95LatencyMs,
          totalAudits,
          activeAiModel: ReconciliationEngine.getActiveProvider(),
          // Custo
          totalCostUsd: totalCost.costUsd,
          totalCostBrl: totalCost.costBrl,
          averageCostPerAuditUsd,
          averageCostPerAuditBrl,
          // Guardrails e Qualidade
          evidenceMissingRate,
          invalidCitationsRate,
          humanAiDivergenceRate,
          // Notificações por E-mail (Telemetria)
          emailNotifications: {
            totalAttempted: emailLogs.length,
            sentTotal: emailSentCount,
            failedTotal: emailFailedCount,
            deliveryRate: emailDeliveryRate,
          },
        },
        modelFailureRates,
        promptVersionHistory,
        sourcesDistribution,
        auditsTelemetry: reports.map((r) => {
          const cost = calculateCost(r.promptTokens || 0, r.completionTokens || 0);
          return {
            id: r.id,
            targetUrl: r.targetUrl || 'N/A',
            clientName: r.client?.tradeName || r.client?.name || 'Clínica Médica',
            crm: `CRM/${r.client?.crmUf} ${r.client?.crmResponsavel}`,
            verdict: r.verdict,
            score: r.score ?? 0,
            aiModelUsed: r.aiModelUsed || 'gemini-3.5-flash',
            promptTokens: r.promptTokens || 0,
            completionTokens: r.completionTokens || 0,
            totalTokens: r.totalTokens || ((r.promptTokens || 0) + (r.completionTokens || 0)) || 0,
            tokensSaved: r.tokensSaved || 0,
            costUsd: cost.costUsd,
            costBrl: cost.costBrl,
            executionTimeMs: r.executionTimeMs ?? 0,
            sourcesUsed: r.sourcesUsed || [],
            violationsCount: r.violations?.length || 0,
            createdAt: r.createdAt,
          };
        }),
        systemLogs: recentLogs,
      });
    } catch (error) {
      next(error);
    }
  }
}
