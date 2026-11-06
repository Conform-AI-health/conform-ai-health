import { Redis } from 'ioredis';
import { Queue, QueueOptions } from 'bullmq';
import { env } from './env.js';

let redisInstance: Redis | null = null;

export function getRedisConnection(): Redis {
  if (!redisInstance) {
    redisInstance = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy(times) {
        // Exponential backoff with maximum 2000ms delay
        const delay = Math.min(times * 100, 2000);
        return delay;
      },
      lazyConnect: true,
    });

    redisInstance.on('error', (err) => {
      // Log connection error without crashing the main process
      if (env.NODE_ENV !== 'test') {
        console.warn(`[Redis Connection Warning]: ${err.message}`);
      }
    });

    redisInstance.on('connect', () => {
      console.log('✅ Conexão com Redis estabelecida com sucesso.');
    });
  }
  return redisInstance;
}

const queueOptions: QueueOptions = {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 3000,
    },
    removeOnComplete: {
      count: 1000,
      age: 24 * 3600,
    },
    removeOnFail: {
      count: 500,
      age: 7 * 24 * 3600,
    },
  },
};

export const auditQueue = new Queue('auditQueue', queueOptions);

