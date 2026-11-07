import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma.js';
import { ReconciliationEngine } from '../services/reconciliationEngine.js';

export class TelemetryController {
  public static async getTelemetry(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const reports = await prisma.auditReport.findMany({
        where: { status: 'COMPLETED' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          client: {
            select: { name: true, tradeName: true, crmResponsavel: true, crmUf: true },
          },
        },
      });

      const totalPromptTokens = reports.reduce((acc, r) => acc + (r.promptTokens || 0), 0);
      const totalCompletionTokens = reports.reduce((acc, r) => acc + (r.completionTokens || 0), 0);
      const totalTokens = reports.reduce((acc, r) => acc + (r.totalTokens || ((r.promptTokens || 0) + (r.completionTokens || 0))), 0);
      const totalTokensSaved = reports.reduce((acc, r) => acc + (r.tokensSaved || 0), 0);

      const totalAudits = reports.length;
      const averageLatencyMs =
        totalAudits > 0
          ? Math.round(reports.reduce((acc, r) => acc + (r.executionTimeMs || 0), 0) / totalAudits)
          : 0;

      const rawTotalEstimated = totalTokens + totalTokensSaved;
      const savingsPercentage =
        rawTotalEstimated > 0 ? Math.round((totalTokensSaved / rawTotalEstimated) * 100) : 0;

      // Distribuição das fontes normativas mais utilizadas
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

      // Logs recentes do sistema
      const recentLogs = await prisma.systemLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 30,
      });

      res.status(200).json({
        metrics: {
          totalPromptTokens,
          totalCompletionTokens,
          totalTokens,
          totalTokensSaved,
          savingsPercentage,
          averageLatencyMs,
          totalAudits,
          activeAiModel: ReconciliationEngine.getActiveProvider(),
        },
        sourcesDistribution,
        auditsTelemetry: reports.map((r) => ({
          id: r.id,
          targetUrl: r.targetUrl || 'N/A',
          clientName: r.client?.tradeName || r.client?.name || 'Clínica Médica',
          crm: `CRM/${r.client?.crmUf} ${r.client?.crmResponsavel}`,
          verdict: r.verdict,
          score: r.score ?? 0,
          aiModelUsed: r.aiModelUsed || 'gemini-2.0-flash',
          promptTokens: r.promptTokens || 0,
          completionTokens: r.completionTokens || 0,
          totalTokens: r.totalTokens || ((r.promptTokens || 0) + (r.completionTokens || 0)) || 0,
          tokensSaved: r.tokensSaved || 0,
          executionTimeMs: r.executionTimeMs ?? 0,
          sourcesUsed: r.sourcesUsed || [],
          createdAt: r.createdAt,
        })),
        systemLogs: recentLogs,
      });
    } catch (error) {
      next(error);
    }
  }
}

