import { prisma } from '../config/prisma.js';

/**
 * Rastreio de links do crawler de normas (telemetria "Links Consultados").
 *
 * Cada link descoberto/visitado gera um registro em `system_logs` com module = 'LINK_TRACE',
 * permitindo conferir na aba de telemetria se TODOS os links foram realmente consultados
 * e qual foi o resultado de cada um.
 */
export const LINK_TRACE_MODULE = 'LINK_TRACE';

export type LinkTraceStatus =
  | 'DISCOVERED' // link encontrado e enfileirado
  | 'SAVED' // virou norma e foi gravado em norms + norms_chunk
  | 'UPDATED' // norma já existia e foi versionada
  | 'UNCHANGED' // norma já existia com mesmo hash (idempotente)
  | 'DISCARDED_NOT_NORM' // aberto, mas não é norma legal
  | 'DISCARDED_NO_TOPIC' // é norma, mas fora dos temas (LGPD/CFM/ANVISA/ANS)
  | 'DISCARDED_DUPLICATE_CONTENT' // mesmo conteúdo já processado no job
  | 'SKIPPED_DUPLICATE' // URL já visitada
  | 'SKIPPED_DOMAIN' // fora da allowlist de domínios
  | 'SKIPPED_IRRELEVANT' // asset estático, rede social ou navegação
  | 'SKIPPED_MAX_DEPTH' // além da profundidade máxima
  | 'SKIPPED_MAX_PAGES' // limite de páginas do job atingido
  | 'BLOCKED_SSRF' // bloqueado por segurança
  | 'ERROR'; // falha ao abrir/processar

export interface LinkTraceEntry {
  jobId: string;
  url: string;
  status: LinkTraceStatus;
  parentUrl?: string;
  depth?: number;
  fileType?: string;
  anchorText?: string;
  topics?: string[];
  title?: string;
  reason?: string;
  engine?: 'firecrawl' | 'http';
  normId?: string;
  chunksCount?: number;
  score?: number;
}

function levelFor(status: LinkTraceStatus): 'INFO' | 'WARN' | 'ERROR' {
  if (status === 'ERROR' || status === 'BLOCKED_SSRF') return 'ERROR';
  if (
    status === 'DISCARDED_NOT_NORM' ||
    status === 'DISCARDED_NO_TOPIC' ||
    status === 'DISCARDED_DUPLICATE_CONTENT' ||
    status.startsWith('SKIPPED_')
  ) {
    return 'WARN';
  }
  return 'INFO';
}

export class LinkTraceService {
  /**
   * Registra um evento de link. NUNCA lança exceção (telemetria não pode derrubar o crawler).
   */
  public static async record(entry: LinkTraceEntry): Promise<void> {
    try {
      await prisma.systemLog.create({
        data: {
          level: levelFor(entry.status),
          module: LINK_TRACE_MODULE,
          correlationId: entry.jobId,
          message: `[LINK_TRACE:${entry.status}] ${entry.url}`,
          details: JSON.stringify({ ...entry, recordedAt: new Date().toISOString() }),
        },
      });
    } catch (err: any) {
      console.warn(`⚠️ [LinkTrace] Falha ao registrar telemetria de link (${entry.url}): ${err?.message}`);
    }
  }

  /**
   * Consulta registros de rastreio, opcionalmente filtrados por job/status, e devolve o resumo por status.
   */
  public static async query(params: {
    jobId?: string;
    status?: string;
    search?: string;
    limit?: number;
  }): Promise<{
    items: Array<LinkTraceEntry & { id: string; createdAt: Date | null }>;
    summary: Record<string, number>;
    jobs: Array<{ jobId: string; lastEventAt: Date | null; total: number }>;
  }> {
    const limit = Math.min(2000, Math.max(1, params.limit || 500));

    const where: any = { module: LINK_TRACE_MODULE };
    if (params.jobId) where.correlationId = params.jobId;
    if (params.status) where.message = { startsWith: `[LINK_TRACE:${params.status}]` };

    const rows = await prisma.systemLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const items: Array<LinkTraceEntry & { id: string; createdAt: Date | null }> = [];
    const summary: Record<string, number> = {};
    const jobsMap = new Map<string, { jobId: string; lastEventAt: Date | null; total: number }>();

    for (const row of rows) {
      let parsed: any = {};
      try {
        parsed = row.details ? JSON.parse(row.details) : {};
      } catch {
        parsed = {};
      }
      const status = (parsed.status || 'ERROR') as LinkTraceStatus;
      const item = {
        ...parsed,
        status,
        jobId: parsed.jobId || row.correlationId || '',
        url: parsed.url || '',
        id: row.id,
        createdAt: row.createdAt ?? null,
      };

      if (params.search) {
        const needle = params.search.toLowerCase();
        const haystack = `${item.url} ${item.title || ''} ${item.reason || ''} ${item.anchorText || ''}`.toLowerCase();
        if (!haystack.includes(needle)) continue;
      }

      items.push(item);
      summary[status] = (summary[status] || 0) + 1;

      const job = jobsMap.get(item.jobId) || { jobId: item.jobId, lastEventAt: item.createdAt, total: 0 };
      job.total++;
      jobsMap.set(item.jobId, job);
    }

    return { items, summary, jobs: Array.from(jobsMap.values()) };
  }
}
