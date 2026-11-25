import type { Redis } from 'ioredis';
import { MemoryStore, type Options, type Store, type IncrementResponse } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { getRedisConnection } from '../config/redis.js';
import { env } from '../config/env.js';
import { CircuitBreaker, type CircuitBreakerSharedStore } from './circuitBreaker.js';

const REDIS_OP_TIMEOUT_MS = 300;

function isDistributedEnabled(): boolean {
  return env.NODE_ENV !== 'test' && env.DISTRIBUTED_RESILIENCE !== 'false';
}

function withTimeout<T>(promise: Promise<T>, ms = REDIS_OP_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('REDIS_OP_TIMEOUT')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function readyRedis(): Redis | null {
  const redis = getRedisConnection();
  return redis.status === 'ready' ? redis : null;
}

/**
 * Store de rate limit compartilhado via Redis entre todas as instâncias da API.
 * Se o Redis não estiver pronto ou falhar, usa o MemoryStore local (fail-open por instância).
 */
export class ResilientRedisRateLimitStore implements Store {
  public prefix: string;
  private readonly memory = new MemoryStore();
  private redisStore: RedisStore | null = null;
  private options: Options | null = null;

  constructor(prefix: string) {
    this.prefix = `rl:${prefix}:`;
  }

  init(options: Options): void {
    this.options = options;
    this.memory.init(options);
  }

  private getRedisStore(): RedisStore | null {
    const redis = readyRedis();
    if (!redis || !this.options) return null;
    if (!this.redisStore) {
      this.redisStore = new RedisStore({
        prefix: this.prefix,
        sendCommand: (command: string, ...args: string[]) => redis.call(command, ...args) as Promise<any>,
      });
      this.redisStore.init(this.options);
    }
    return this.redisStore;
  }

  async increment(key: string): Promise<IncrementResponse> {
    const store = this.getRedisStore();
    if (store) {
      try {
        return await withTimeout(store.increment(key));
      } catch {
        // fallback local
      }
    }
    return this.memory.increment(key);
  }

  async decrement(key: string): Promise<void> {
    const store = this.getRedisStore();
    if (store) {
      await withTimeout(store.decrement(key)).catch(() => {});
    }
    await this.memory.decrement(key);
  }

  async resetKey(key: string): Promise<void> {
    const store = this.getRedisStore();
    if (store) {
      await withTimeout(store.resetKey(key)).catch(() => {});
    }
    await this.memory.resetKey(key);
  }
}

/**
 * Retorna store distribuído para express-rate-limit, ou undefined (MemoryStore padrão) em testes.
 */
export function createRateLimitStore(prefix: string): Store | undefined {
  return isDistributedEnabled() ? new ResilientRedisRateLimitStore(prefix) : undefined;
}

export const redisCircuitBreakerStore: CircuitBreakerSharedStore = {
  async getOpenTtlMs(name: string): Promise<number> {
    const redis = readyRedis();
    if (!redis) return 0;
    const ttl = await withTimeout(redis.pttl(`cb:open:${name}`));
    return ttl > 0 ? ttl : 0;
  },
  async markOpen(name: string, ttlMs: number): Promise<void> {
    const redis = readyRedis();
    if (!redis) return;
    await withTimeout(redis.set(`cb:open:${name}`, '1', 'PX', Math.max(1, Math.floor(ttlMs))));
  },
  async clear(name: string): Promise<void> {
    const redis = readyRedis();
    if (!redis) return;
    await withTimeout(redis.del(`cb:open:${name}`));
  },
};

/**
 * Ativa estado distribuído de circuit breakers (API e worker) quando habilitado.
 */
export function initDistributedResilience(): void {
  if (!isDistributedEnabled()) return;
  CircuitBreaker.configureSharedStore(redisCircuitBreakerStore);
  const redis = getRedisConnection();
  if (redis.status === 'wait') {
    redis.connect().catch(() => {});
  }
}
