import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { redisMock, subscriberMock } = vi.hoisted(() => {
  const { EventEmitter } = require('events');
  const subscriberMock = Object.assign(new EventEmitter(), {
    subscribe: vi.fn(async () => 1),
    quit: vi.fn(async () => 'OK'),
    disconnect: vi.fn(),
  });
  const redisMock = {
    status: 'ready' as string,
    store: new Map<string, string>(),
    publish: vi.fn(async () => 1),
    get: vi.fn(async (key: string) => redisMock.store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      redisMock.store.set(key, value);
      return 'OK';
    }),
    duplicate: vi.fn(() => subscriberMock),
  };
  return { redisMock, subscriberMock };
});

vi.mock('../config/redis.js', () => ({ getRedisConnection: () => redisMock }));

import { publishTelemetryEvent, TELEMETRY_CHANNEL } from '../shared/telemetryEvents.js';
import { TelemetryStreamService, TELEMETRY_SNAPSHOT_KEY } from '../services/telemetryStreamService.js';

function createSseResponse() {
  const res: any = new EventEmitter();
  res.chunks = [] as string[];
  res.headers = {} as Record<string, string>;
  res.writableEnded = false;
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.setHeader = vi.fn((k: string, v: string) => {
    res.headers[k] = v;
  });
  res.flushHeaders = vi.fn();
  res.write = vi.fn((chunk: string) => {
    res.chunks.push(chunk);
    return true;
  });
  res.end = vi.fn(() => {
    res.writableEnded = true;
    res.emit('close');
  });
  return res;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('publishTelemetryEvent', () => {
  beforeEach(() => {
    redisMock.publish.mockClear();
    redisMock.status = 'ready';
  });

  it('publica no canal de telemetria quando o Redis está pronto', () => {
    publishTelemetryEvent('AUDIT_COMPLETED');
    expect(redisMock.publish).toHaveBeenCalledWith(TELEMETRY_CHANNEL, expect.stringContaining('AUDIT_COMPLETED'));
  });

  it('não publica nem lança erro quando o Redis está indisponível', () => {
    redisMock.status = 'reconnecting';
    expect(() => publishTelemetryEvent('SYSTEM_LOG')).not.toThrow();
    expect(redisMock.publish).not.toHaveBeenCalled();
  });

  it('não propaga rejeição do publish', async () => {
    redisMock.publish.mockRejectedValueOnce(new Error('redis down'));
    expect(() => publishTelemetryEvent('CRAWL_PROGRESS')).not.toThrow();
    await flush();
  });
});

describe('TelemetryStreamService', () => {
  beforeEach(() => {
    redisMock.status = 'ready';
    redisMock.store.clear();
    redisMock.get.mockClear();
    subscriberMock.subscribe.mockClear();
    subscriberMock.removeAllListeners('message');
  });

  afterEach(() => {
    TelemetryStreamService.shutdown();
    vi.useRealTimers();
  });

  it('getSnapshot usa o cache do Redis e evita recalcular', async () => {
    const builder = vi.fn(async () => ({ metrics: { totalAudits: 1 } }));
    await TelemetryStreamService.getSnapshot(builder);
    expect(redisMock.store.has(TELEMETRY_SNAPSHOT_KEY)).toBe(true);
    const second = await TelemetryStreamService.getSnapshot(builder);
    expect(builder).toHaveBeenCalledTimes(1);
    expect(second).toEqual({ metrics: { totalAudits: 1 } });
  });

  it('getSnapshot calcula direto quando o Redis não está pronto', async () => {
    redisMock.status = 'end';
    const builder = vi.fn(async () => ({ ok: true }));
    await TelemetryStreamService.getSnapshot(builder);
    await TelemetryStreamService.getSnapshot(builder);
    expect(builder).toHaveBeenCalledTimes(2);
    expect(redisMock.get).not.toHaveBeenCalled();
  });

  it('abre o stream SSE com headers corretos e envia o snapshot inicial', async () => {
    const res = createSseResponse();
    const req: any = new EventEmitter();
    TelemetryStreamService.handleStream(req, res, async () => ({ metrics: { totalAudits: 3 } }));
    await flush();

    expect(res.headers['Content-Type']).toContain('text/event-stream');
    expect(res.headers['X-Accel-Buffering']).toBe('no');
    expect(subscriberMock.subscribe).toHaveBeenCalledWith(TELEMETRY_CHANNEL);
    expect(res.chunks.join('')).toContain('event: telemetry\ndata: {"metrics":{"totalAudits":3}}\n\n');
    expect(TelemetryStreamService.getClientCount()).toBe(1);

    req.emit('close');
    expect(TelemetryStreamService.getClientCount()).toBe(0);
    expect(subscriberMock.quit).toHaveBeenCalled();
  });

  it('agrupa rajadas de eventos Redis em um único recálculo e envio', async () => {
    vi.useFakeTimers();
    let version = 0;
    const builder = vi.fn(async () => ({ version: ++version }));
    const res = createSseResponse();
    TelemetryStreamService.handleStream(new EventEmitter() as any, res, builder);
    await vi.advanceTimersByTimeAsync(0);
    expect(builder).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 5; i++) subscriberMock.emit('message', TELEMETRY_CHANNEL, '{"type":"SYSTEM_LOG"}');
    await vi.advanceTimersByTimeAsync(2500);

    expect(builder).toHaveBeenCalledTimes(2);
    expect(res.chunks.join('')).toContain('data: {"version":2}');
  });

  it('encerra o stream quando o access token expira', async () => {
    vi.useFakeTimers();
    const res = createSseResponse();
    const req: any = Object.assign(new EventEmitter(), { user: { exp: Math.floor(Date.now() / 1000) + 10 } });
    TelemetryStreamService.handleStream(req, res, async () => ({}));
    await vi.advanceTimersByTimeAsync(11000);
    expect(res.end).toHaveBeenCalled();
    expect(TelemetryStreamService.getClientCount()).toBe(0);
  });
});
