import { afterEach, describe, expect, it, vi } from 'vitest';

const { redisMock, aggregateRaw } = vi.hoisted(() => ({
  redisMock: { status: 'end' as string },
  aggregateRaw: vi.fn(),
}));

vi.mock('../config/redis.js', () => ({
  getRedisConnection: () => redisMock,
}));

vi.mock('../config/prisma.js', () => ({
  prisma: { normChunk: { aggregateRaw } },
}));

import { CircuitBreaker, type CircuitBreakerSharedStore } from '../shared/circuitBreaker.js';
import { ResilientRedisRateLimitStore } from '../shared/distributedResilience.js';
import { searchChunksWithAtlasVector, resetVectorSearchAvailability } from '../services/normsResolver.js';
import { env } from '../config/env.js';

function createMemorySharedStore(): CircuitBreakerSharedStore & { keys: Map<string, number> } {
  const keys = new Map<string, number>();
  return {
    keys,
    async getOpenTtlMs(name) {
      const until = keys.get(name) ?? 0;
      return Math.max(0, until - Date.now());
    },
    async markOpen(name, ttlMs) {
      keys.set(name, Date.now() + ttlMs);
    },
    async clear(name) {
      keys.delete(name);
    },
  };
}

describe('Circuit breaker com estado compartilhado', () => {
  afterEach(() => CircuitBreaker.configureSharedStore(null));

  it('propaga OPEN para outra instância (outro processo) com o mesmo nome', async () => {
    const store = createMemorySharedStore();
    CircuitBreaker.configureSharedStore(store);
    const apiBreaker = new CircuitBreaker({ name: 'provider-x', failureThreshold: 1, resetTimeoutMs: 60000 });
    const workerBreaker = new CircuitBreaker({ name: 'provider-x', failureThreshold: 1, resetTimeoutMs: 60000 });

    await apiBreaker.execute(async () => { throw new Error('down'); }, () => 'fallback');
    await new Promise((resolve) => setImmediate(resolve));
    expect(store.keys.has('provider-x')).toBe(true);

    const action = vi.fn(async () => 'ok');
    const result = await workerBreaker.execute(action, () => 'fallback');
    expect(result).toBe('fallback');
    expect(action).not.toHaveBeenCalled();
    expect(workerBreaker.getState()).toBe('OPEN');
  });

  it('mantém decisão local quando o store compartilhado falha', async () => {
    CircuitBreaker.configureSharedStore({
      getOpenTtlMs: async () => { throw new Error('redis down'); },
      markOpen: async () => { throw new Error('redis down'); },
      clear: async () => { throw new Error('redis down'); },
    });
    const breaker = new CircuitBreaker({ name: 'provider-y', failureThreshold: 3 });
    await expect(breaker.execute(async () => 'ok')).resolves.toBe('ok');
    expect(breaker.getState()).toBe('CLOSED');
  });
});

describe('Rate limit store distribuído', () => {
  it('usa contador em memória quando o Redis não está pronto', async () => {
    redisMock.status = 'end';
    const store = new ResilientRedisRateLimitStore('test');
    store.init({ windowMs: 60000 } as any);

    expect((await store.increment('ip-1')).totalHits).toBe(1);
    expect((await store.increment('ip-1')).totalHits).toBe(2);

    await store.resetKey('ip-1');
    expect((await store.increment('ip-1')).totalHits).toBe(1);
  });
});

describe('RAG com Atlas $vectorSearch', () => {
  afterEach(() => {
    env.RAG_VECTOR_SEARCH_ENABLED = 'false';
    resetVectorSearchAvailability();
    aggregateRaw.mockReset();
  });

  it('não consulta o Atlas quando desabilitado', async () => {
    env.RAG_VECTOR_SEARCH_ENABLED = 'false';
    expect(await searchChunksWithAtlasVector([1, 0], ['507f1f77bcf86cd799439011'], 5)).toBeNull();
    expect(aggregateRaw).not.toHaveBeenCalled();
  });

  it('filtra por normId das normas vigentes e converte o resultado EJSON', async () => {
    env.RAG_VECTOR_SEARCH_ENABLED = 'true';
    aggregateRaw.mockResolvedValue([
      {
        _id: { $oid: 'c1' },
        normId: { $oid: '507f1f77bcf86cd799439011' },
        normCode: 'CFM-RES-2336-2023',
        chunkIndex: { $numberInt: '3' },
        conteudoChunk: 'texto',
        contextoSemantico: null,
        embedding: [{ $numberDouble: '0.5' }, 0.25],
        tags: ['CFM'],
      },
    ]);

    const rows = await searchChunksWithAtlasVector([1, 0], ['507f1f77bcf86cd799439011'], 5);

    const stage = aggregateRaw.mock.calls[0][0].pipeline[0].$vectorSearch;
    expect(stage.filter).toEqual({ normId: { $in: [{ $oid: '507f1f77bcf86cd799439011' }] } });
    expect(stage.limit).toBe(40);
    expect(rows).toEqual([
      {
        id: 'c1',
        normId: '507f1f77bcf86cd799439011',
        normCode: 'CFM-RES-2336-2023',
        chunkIndex: 3,
        conteudoChunk: 'texto',
        contextoSemantico: null,
        embedding: [0.5, 0.25],
        tags: ['CFM'],
      },
    ]);
  });

  it('volta para a busca em memória e suspende novas tentativas quando o índice falha', async () => {
    env.RAG_VECTOR_SEARCH_ENABLED = 'true';
    aggregateRaw.mockRejectedValue(new Error('$vectorSearch stage is only allowed on MongoDB Atlas'));

    expect(await searchChunksWithAtlasVector([1, 0], ['507f1f77bcf86cd799439011'], 5)).toBeNull();
    expect(await searchChunksWithAtlasVector([1, 0], ['507f1f77bcf86cd799439011'], 5)).toBeNull();
    expect(aggregateRaw).toHaveBeenCalledTimes(1);
  });
});
