import crypto from 'crypto';
import { env } from '../../config/env.js';
import { getRedisConnection } from '../../config/redis.js';
import { ScrapeResult } from '../scraperService.js';
import {
  AgentContext,
  ReconciliationOutput,
  reconciliationOutputSchema,
} from '../../shared/reconciliationTypes.js';

const MEMORY_MAX_ENTRIES = 300;
const REDIS_KEY_PREFIX = 'conformia:ai_inv:entry:';
const REDIS_AGENT_SET_PREFIX = 'conformia:ai_inv:agent:';
const REDIS_TARGET_KEY_PREFIX = 'conformia:ai_inv:target:';

export interface CachedAIInvocationRecord {
  cacheKey: string;
  agentKey: string;
  targetSlotKey: string;
  skillHash: string;
  contentHash: string;
  normsHash: string;
  modelSignature: string;
  cachedAt: string;
  originalPromptTokens: number;
  originalCompletionTokens: number;
  originalTotalTokens: number;
  output: ReconciliationOutput;
}

export interface AIInvocationLookupResult {
  hit: boolean;
  cacheKey: string;
  agentKey: string;
  targetSlotKey: string;
  skillHash: string;
  contentHash: string;
  normsHash: string;
  modelSignature: string;
  evictedPreviousKey?: string;
  evictionReason?: string;
  record?: CachedAIInvocationRecord;
}

interface MemoryEntry {
  expiresAt: number;
  record: CachedAIInvocationRecord;
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

export class AIInvocationCacheService {
  private static memoryCache = new Map<string, MemoryEntry>();
  private static agentKeysIndex = new Map<string, Set<string>>();
  private static targetLatestKey = new Map<string, string>();
  private static lastInvalidationReason: string | null = null;

  public static isEnabled(): boolean {
    return env.AI_INVOCATION_CACHE_ENABLED !== 'false';
  }

  public static getTtlSeconds(): number {
    return Math.max(60, Number(env.AI_INVOCATION_CACHE_TTL_SECONDS) || 86400);
  }

  public static computeFingerprint(params: {
    scrape: ScrapeResult;
    agentContext: AgentContext;
    agentModuleId?: string;
    modelConfig: {
      provider: string;
      modelId: string;
      temperature?: number;
      maxTokens?: number;
    };
  }): {
    cacheKey: string;
    agentKey: string;
    targetSlotKey: string;
    skillHash: string;
    contentHash: string;
    normsHash: string;
    modelSignature: string;
  } {
    const { scrape, agentContext, agentModuleId, modelConfig } = params;
    const agentKey = (agentContext.id || agentContext.code || agentModuleId || 'default').trim();
    const sortedTags = [...(agentContext.tags || [])]
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
      .sort();

    const skillPayload = [
      agentContext.skill || agentContext.description || '',
      agentContext.systemPrompt || '',
      agentContext.regulatoryFramework || '',
      sortedTags.join(','),
    ].join('\0');
    const skillHash = sha256(skillPayload);

    const normalizedUrl = (scrape.url || '').trim();
    const contentHash = sha256(`${normalizedUrl}\0${scrape.cleanMarkdown || ''}`);

    const normsPayload = [...(agentContext.activeNorms || [])]
      .map((n) => `${n.id}|${n.normCode}|${n.article || ''}|${n.severityDefault || ''}|${sha256(n.content || '')}`)
      .sort()
      .join('\n');
    const normsHash = sha256(normsPayload);

    const modelSignature = `${modelConfig.provider}:${modelConfig.modelId}:${modelConfig.temperature ?? 0.2}:${modelConfig.maxTokens ?? 2048}`;
    const cacheKey = sha256(`${agentKey}\0${skillHash}\0${contentHash}\0${normsHash}\0${modelSignature}`);
    const targetSlotKey = `${agentKey}::${sha256(normalizedUrl)}`;

    return {
      cacheKey,
      agentKey,
      targetSlotKey,
      skillHash,
      contentHash,
      normsHash,
      modelSignature,
    };
  }

  /**
   * Consulta o cache para a invocação atual.
   * Caso já existisse outra entrada para o mesmo (agente + URL) com hash diferente
   * (alteração de página, skill, normas ou modelo), remove imediatamente a entrada anterior do cache.
   */
  public static async lookupAndEvictStale(params: {
    scrape: ScrapeResult;
    agentContext: AgentContext;
    agentModuleId?: string;
    modelConfig: {
      provider: string;
      modelId: string;
      temperature?: number;
      maxTokens?: number;
    };
  }): Promise<AIInvocationLookupResult> {
    const fp = this.computeFingerprint(params);
    if (!this.isEnabled()) {
      return { hit: false, ...fp };
    }

    let evictedPreviousKey: string | undefined;
    let evictionReason: string | undefined;

    // 1. Verifica se havia chave anterior para o mesmo (agentKey + URL) e remove se mudou
    const previousMemKey = this.targetLatestKey.get(fp.targetSlotKey);
    if (previousMemKey && previousMemKey !== fp.cacheKey) {
      const prevEntry = this.memoryCache.get(previousMemKey)?.record;
      evictionReason = prevEntry
        ? prevEntry.contentHash !== fp.contentHash
          ? 'conteudo_pagina_alterado'
          : prevEntry.skillHash !== fp.skillHash
            ? 'skill_ou_prompt_alterado'
            : prevEntry.normsHash !== fp.normsHash
              ? 'normas_atualizadas'
              : 'modelo_ia_alterado'
        : 'contexto_alterado';
      await this.deleteEntryByKey(previousMemKey, fp.agentKey);
      this.targetLatestKey.delete(fp.targetSlotKey);
      evictedPreviousKey = previousMemKey;
    } else if (this.lastInvalidationReason) {
      evictionReason = this.lastInvalidationReason;
      this.lastInvalidationReason = null;
    }

    // 2. Verifica também no Redis se o slot (agentKey + URL) apontava para chave antiga
    const redis = this.getSafeRedis();
    if (redis) {
      try {
        const prevRedisKey = await Promise.race([
          redis.get(`${REDIS_TARGET_KEY_PREFIX}${fp.targetSlotKey}`),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
        ]);
        if (prevRedisKey && prevRedisKey !== fp.cacheKey) {
          await redis.del(`${REDIS_KEY_PREFIX}${prevRedisKey}`).catch(() => {});
          await redis.srem(`${REDIS_AGENT_SET_PREFIX}${fp.agentKey}`, prevRedisKey).catch(() => {});
          await redis.del(`${REDIS_TARGET_KEY_PREFIX}${fp.targetSlotKey}`).catch(() => {});
          evictedPreviousKey = evictedPreviousKey || prevRedisKey;
          evictionReason = evictionReason || 'alteracao_detectada';
        }
      } catch {
        // Ignora indisponibilidade do Redis
      }
    }

    // 3. Tenta recuperar da memória (L1)
    const now = Date.now();
    const memHit = this.memoryCache.get(fp.cacheKey);
    if (memHit) {
      if (memHit.expiresAt > now) {
        // Refresh LRU order
        this.memoryCache.delete(fp.cacheKey);
        this.memoryCache.set(fp.cacheKey, memHit);
        return {
          hit: true,
          ...fp,
          record: memHit.record,
        };
      }
      this.deleteMemoryKey(fp.cacheKey, fp.agentKey);
    }

    // 4. Tenta recuperar do Redis (L2)
    if (redis) {
      try {
        const raw = await Promise.race([
          redis.get(`${REDIS_KEY_PREFIX}${fp.cacheKey}`),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 600)),
        ]);
        if (raw) {
          const parsed = JSON.parse(raw) as CachedAIInvocationRecord;
          const validatedOutput = reconciliationOutputSchema.parse(parsed.output);
          const hydrated: CachedAIInvocationRecord = {
            ...parsed,
            output: validatedOutput,
          };
          this.setMemoryRecord(hydrated, this.getTtlSeconds());
          return {
            hit: true,
            ...fp,
            record: hydrated,
          };
        }
      } catch {
        // Fallback silencioso caso Redis falhe ou JSON esteja expirado
      }
    }

    return {
      hit: false,
      ...fp,
      ...(evictedPreviousKey ? { evictedPreviousKey } : {}),
      ...(evictionReason ? { evictionReason } : {}),
    };
  }

  /**
   * Armazena resultado válido da IA no cache (nunca armazena INCONCLUSIVO ou fallback heurístico).
   */
  public static async store(params: {
    lookup: AIInvocationLookupResult;
    agentKey: string;
    targetSlotKey: string;
    output: ReconciliationOutput;
  }): Promise<void> {
    if (!this.isEnabled()) return;

    const { lookup, agentKey, targetSlotKey, output } = params;
    const modelTag = String(output.aiModelUsed || '');
    if (
      output.verdict === 'INCONCLUSIVO' ||
      modelTag.startsWith('retrieval:') ||
      modelTag.startsWith('heuristic:fallback')
    ) {
      return;
    }

    const ttlSeconds = this.getTtlSeconds();
    const record: CachedAIInvocationRecord = {
      cacheKey: lookup.cacheKey,
      agentKey,
      targetSlotKey,
      skillHash: lookup.skillHash,
      contentHash: lookup.contentHash,
      normsHash: lookup.normsHash,
      modelSignature: lookup.modelSignature,
      cachedAt: new Date().toISOString(),
      originalPromptTokens: output.promptTokens || 0,
      originalCompletionTokens: output.completionTokens || 0,
      originalTotalTokens: output.totalTokens || 0,
      output,
    };

    this.setMemoryRecord(record, ttlSeconds);

    const redis = this.getSafeRedis();
    if (redis) {
      try {
        await Promise.race([
          Promise.all([
            redis.set(`${REDIS_KEY_PREFIX}${lookup.cacheKey}`, JSON.stringify(record), 'EX', ttlSeconds),
            redis.sadd(`${REDIS_AGENT_SET_PREFIX}${agentKey}`, lookup.cacheKey),
            redis.expire(`${REDIS_AGENT_SET_PREFIX}${agentKey}`, ttlSeconds),
            redis.set(`${REDIS_TARGET_KEY_PREFIX}${targetSlotKey}`, lookup.cacheKey, 'EX', ttlSeconds),
          ]),
          new Promise((resolve) => setTimeout(resolve, 600)),
        ]);
      } catch {
        // Ignora falha de escrita no Redis mantendo cache L1 em memória
      }
    }
  }

  /**
   * Remove do cache todas as invocações vinculadas a um módulo de agente específico
   * (acionado ao editar Skill/Persona, URL alvo, tags ou excluir o agente).
   */
  public static async invalidateByAgent(agentIdOrCode: string, reason = 'agent_updated'): Promise<number> {
    const cleanId = (agentIdOrCode || '').trim();
    if (!cleanId) return 0;

    let removed = 0;
    this.lastInvalidationReason = reason;

    const memKeys = this.agentKeysIndex.get(cleanId);
    if (memKeys) {
      for (const key of Array.from(memKeys)) {
        if (this.memoryCache.delete(key)) {
          removed++;
        }
      }
      this.agentKeysIndex.delete(cleanId);
    }

    for (const [slotKey] of Array.from(this.targetLatestKey.entries())) {
      if (slotKey.startsWith(`${cleanId}::`)) {
        this.targetLatestKey.delete(slotKey);
      }
    }

    const redis = this.getSafeRedis();
    if (redis) {
      try {
        const keys = await Promise.race([
          redis.smembers(`${REDIS_AGENT_SET_PREFIX}${cleanId}`),
          new Promise<string[]>((resolve) => setTimeout(() => resolve([]), 600)),
        ]);
        if (keys.length > 0) {
          await redis.del(...keys.map((k) => `${REDIS_KEY_PREFIX}${k}`)).catch(() => {});
          removed += keys.length;
        }
        await redis.del(`${REDIS_AGENT_SET_PREFIX}${cleanId}`).catch(() => {});
      } catch {
        // Ignora erro de Redis
      }
    }

    return removed;
  }

  /**
   * Limpa globalmente o cache de invocação de IA (acionado quando normas regulatórias
   * ou configurações de modelo/provedor de IA sofrem qualquer alteração).
   */
  public static async invalidateAll(reason = 'global_invalidation'): Promise<number> {
    const removedMem = this.memoryCache.size;
    this.memoryCache.clear();
    this.agentKeysIndex.clear();
    this.targetLatestKey.clear();
    this.lastInvalidationReason = reason;

    const redis = this.getSafeRedis();
    if (redis) {
      try {
        let cursor = '0';
        do {
          const [nextCursor, foundKeys] = await Promise.race([
            redis.scan(cursor, 'MATCH', 'conformia:ai_inv:*', 'COUNT', 100),
            new Promise<[string, string[]]>((resolve) => setTimeout(() => resolve(['0', []]), 600)),
          ]);
          cursor = nextCursor;
          if (foundKeys.length > 0) {
            await redis.del(...foundKeys).catch(() => {});
          }
        } while (cursor !== '0');
      } catch {
        // Ignora indisponibilidade de Redis
      }
    }

    return removedMem;
  }

  public static clearMemoryCache(): void {
    this.memoryCache.clear();
    this.agentKeysIndex.clear();
    this.targetLatestKey.clear();
    this.lastInvalidationReason = null;
  }

  public static getStats(): { memoryEntries: number; trackedAgents: number; trackedTargets: number } {
    return {
      memoryEntries: this.memoryCache.size,
      trackedAgents: this.agentKeysIndex.size,
      trackedTargets: this.targetLatestKey.size,
    };
  }

  private static setMemoryRecord(record: CachedAIInvocationRecord, ttlSeconds: number): void {
    if (this.memoryCache.size >= MEMORY_MAX_ENTRIES && !this.memoryCache.has(record.cacheKey)) {
      const oldestKey = this.memoryCache.keys().next().value;
      if (oldestKey) {
        const oldest = this.memoryCache.get(oldestKey);
        this.memoryCache.delete(oldestKey);
        if (oldest) {
          this.agentKeysIndex.get(oldest.record.agentKey)?.delete(oldestKey);
        }
      }
    }

    this.memoryCache.set(record.cacheKey, {
      expiresAt: Date.now() + ttlSeconds * 1000,
      record,
    });

    let keySet = this.agentKeysIndex.get(record.agentKey);
    if (!keySet) {
      keySet = new Set<string>();
      this.agentKeysIndex.set(record.agentKey, keySet);
    }
    keySet.add(record.cacheKey);
    this.targetLatestKey.set(record.targetSlotKey, record.cacheKey);
  }

  private static deleteMemoryKey(cacheKey: string, agentKey: string): void {
    this.memoryCache.delete(cacheKey);
    this.agentKeysIndex.get(agentKey)?.delete(cacheKey);
  }

  private static async deleteEntryByKey(cacheKey: string, agentKey: string): Promise<void> {
    this.deleteMemoryKey(cacheKey, agentKey);
    const redis = this.getSafeRedis();
    if (redis) {
      try {
        await Promise.race([
          Promise.all([
            redis.del(`${REDIS_KEY_PREFIX}${cacheKey}`),
            redis.srem(`${REDIS_AGENT_SET_PREFIX}${agentKey}`, cacheKey),
          ]),
          new Promise((resolve) => setTimeout(resolve, 400)),
        ]);
      } catch {
        // Ignora erro de Redis
      }
    }
  }

  private static getSafeRedis() {
    if (env.NODE_ENV === 'test') {
      return null;
    }
    try {
      const redis = getRedisConnection();
      if (redis && redis.status === 'ready') {
        return redis;
      }
      return null;
    } catch {
      return null;
    }
  }
}
