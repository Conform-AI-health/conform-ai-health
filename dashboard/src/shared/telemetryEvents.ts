import { getRedisConnection } from '../config/redis.js';

export const TELEMETRY_CHANNEL = 'telemetry:events';

export type TelemetryEventType =
  | 'AUDIT_COMPLETED'
  | 'AUDIT_FAILED'
  | 'CRAWL_PROGRESS'
  | 'CRAWL_FINISHED'
  | 'SYSTEM_LOG';

/**
 * Publica um evento de telemetria no Redis (fire-and-forget).
 * Nunca lança erro nem bloqueia o fluxo principal se o Redis estiver indisponível.
 */
export function publishTelemetryEvent(type: TelemetryEventType): void {
  try {
    const redis = getRedisConnection();
    if (redis.status !== 'ready') return;
    redis.publish(TELEMETRY_CHANNEL, JSON.stringify({ type, at: Date.now() })).catch(() => {});
  } catch {
    // Telemetria em tempo real é best-effort
  }
}
