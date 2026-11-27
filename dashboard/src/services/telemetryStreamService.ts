import { Request, Response } from 'express';
import type { Redis } from 'ioredis';
import { getRedisConnection } from '../config/redis.js';
import { TELEMETRY_CHANNEL } from '../shared/telemetryEvents.js';
import { createLogger } from '../shared/logger.js';

type TelemetryBuilder = () => Promise<Record<string, unknown>>;

const log = createLogger('telemetry-stream');

export const TELEMETRY_SNAPSHOT_KEY = 'telemetry:snapshot';
const SNAPSHOT_TTL_SECONDS = 5;
const BROADCAST_DEBOUNCE_MS = 2000;
const HEARTBEAT_MS = 25000;
const SAFETY_REFRESH_MS = 60000;
const MAX_CLIENTS = 50;

/**
 * Entrega a telemetria em tempo real via SSE.
 * Worker e API publicam eventos no canal Redis `telemetry:events`; cada instância da API
 * mantém um único SUBSCRIBE, recalcula o snapshot (com debounce) e envia aos navegadores conectados.
 */
export class TelemetryStreamService {
  private static clients = new Set<Response>();
  private static builder: TelemetryBuilder | null = null;
  private static subscriber: Redis | null = null;
  private static debounceTimer: NodeJS.Timeout | null = null;
  private static heartbeatTimer: NodeJS.Timeout | null = null;
  private static safetyTimer: NodeJS.Timeout | null = null;
  private static inFlight: Promise<Record<string, unknown>> | null = null;

  private static readyRedis(): Redis | null {
    try {
      const redis = getRedisConnection();
      return redis.status === 'ready' ? redis : null;
    } catch {
      return null;
    }
  }

  private static buildOnce(builder: TelemetryBuilder): Promise<Record<string, unknown>> {
    if (!this.inFlight) {
      this.inFlight = builder().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  /**
   * Snapshot com cache curto no Redis, compartilhado entre instâncias e abas.
   */
  public static async getSnapshot(builder: TelemetryBuilder, fresh = false): Promise<Record<string, unknown>> {
    const redis = this.readyRedis();
    if (redis && !fresh) {
      try {
        const cached = await redis.get(TELEMETRY_SNAPSHOT_KEY);
        if (cached) return JSON.parse(cached);
      } catch {
        // Cache indisponível: calcula direto
      }
    }

    const payload = await this.buildOnce(builder);
    if (redis) {
      redis.set(TELEMETRY_SNAPSHOT_KEY, JSON.stringify(payload), 'EX', SNAPSHOT_TTL_SECONDS).catch(() => {});
    }
    return payload;
  }

  public static handleStream(req: Request, res: Response, builder: TelemetryBuilder): void {
    if (this.clients.size >= MAX_CLIENTS) {
      res.status(503).json({ error: 'Limite de conexões de telemetria em tempo real atingido.', code: 'TELEMETRY_STREAM_FULL' });
      return;
    }

    this.builder = builder;
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write('retry: 5000\n\n');

    this.clients.add(res);
    this.ensureBackgroundTasks();

    // Encerra o stream quando o access token expira; o cliente renova o token e reconecta.
    const exp = Number((req.user as { exp?: number } | undefined)?.exp);
    const expiryTimer = Number.isFinite(exp) && exp > 0
      ? setTimeout(() => res.end(), Math.max(0, exp * 1000 - Date.now()))
      : null;

    const cleanup = () => {
      if (expiryTimer) clearTimeout(expiryTimer);
      this.clients.delete(res);
      if (this.clients.size === 0) this.stopBackgroundTasks();
    };
    req.on('close', cleanup);
    res.on('close', cleanup);

    this.getSnapshot(builder)
      .then((payload) => this.send(res, payload))
      .catch((err) => log.warn({ err }, `Falha ao gerar snapshot inicial de telemetria: ${err.message}`));
  }

  private static send(res: Response, payload: Record<string, unknown>): void {
    if (res.writableEnded) return;
    res.write(`event: telemetry\ndata: ${JSON.stringify(payload)}\n\n`);
  }

  private static ensureBackgroundTasks(): void {
    if (!this.heartbeatTimer) {
      this.heartbeatTimer = setInterval(() => {
        for (const client of this.clients) {
          if (!client.writableEnded) client.write(': ping\n\n');
        }
      }, HEARTBEAT_MS);
      this.heartbeatTimer.unref?.();
    }

    if (!this.safetyTimer) {
      // Rede de segurança caso algum evento não seja publicado (ex.: Redis Pub/Sub indisponível)
      this.safetyTimer = setInterval(() => this.scheduleBroadcast(), SAFETY_REFRESH_MS);
      this.safetyTimer.unref?.();
    }

    if (!this.subscriber) {
      try {
        const subscriber = getRedisConnection().duplicate();
        subscriber.on('error', (err) => log.warn({ err }, `Redis Pub/Sub de telemetria indisponível: ${err.message}`));
        subscriber.on('message', (channel) => {
          if (channel === TELEMETRY_CHANNEL) this.scheduleBroadcast();
        });
        subscriber.subscribe(TELEMETRY_CHANNEL).catch((err) => {
          log.warn({ err }, `Falha ao assinar ${TELEMETRY_CHANNEL}: ${err.message}`);
        });
        this.subscriber = subscriber;
      } catch (err: any) {
        log.warn({ err }, `Falha ao criar assinante de telemetria: ${err.message}`);
      }
    }
  }

  private static stopBackgroundTasks(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.safetyTimer) clearInterval(this.safetyTimer);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.heartbeatTimer = null;
    this.safetyTimer = null;
    this.debounceTimer = null;
    if (this.subscriber) {
      const subscriber = this.subscriber;
      this.subscriber = null;
      subscriber.quit().catch(() => subscriber.disconnect());
    }
  }

  /**
   * Agrupa rajadas de eventos (ex.: vários logs de um crawl) em um único recálculo.
   */
  public static scheduleBroadcast(): void {
    if (this.debounceTimer || this.clients.size === 0) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.broadcast();
    }, BROADCAST_DEBOUNCE_MS);
  }

  private static async broadcast(): Promise<void> {
    if (!this.builder || this.clients.size === 0) return;
    try {
      const payload = await this.getSnapshot(this.builder, true);
      for (const client of this.clients) this.send(client, payload);
    } catch (err: any) {
      log.warn({ err }, `Falha ao recalcular telemetria para o stream: ${err.message}`);
    }
  }

  public static getClientCount(): number {
    return this.clients.size;
  }

  public static shutdown(): void {
    for (const client of this.clients) client.end();
    this.clients.clear();
    this.stopBackgroundTasks();
  }
}
