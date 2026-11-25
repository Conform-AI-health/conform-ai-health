import { AsyncLocalStorage } from 'node:async_hooks';
import {
  Context,
  ROOT_CONTEXT,
  Span,
  SpanKind,
  SpanStatusCode,
  Tracer,
  context,
  propagation,
  trace,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { env } from '../config/env.js';

export interface ObservabilityContext {
  requestId?: string;
  traceId?: string;
  spanId?: string;
  userId?: string;
  clientId?: string;
  jobId?: string;
  auditReportId?: string;
}

const ZERO_TRACE_ID = '00000000000000000000000000000000';

export const observabilityContext = new AsyncLocalStorage<ObservabilityContext>();

let tracerProvider: NodeTracerProvider | null = null;
let initializedServiceName: string | null = null;

/**
 * Converte cabeçalhos OTLP no formato "chave=valor,outra=valor2" em objeto simples.
 */
export function parseOtlpHeaders(raw?: string): Record<string, string> {
  if (!raw || !raw.trim()) {
    return {};
  }

  const headers: Record<string, string> = {};
  for (const part of raw.split(',')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) {
      headers[key] = value;
    }
  }
  return headers;
}

/**
 * Inicializa o NodeTracerProvider de forma idempotente com propagação W3C.
 * Mesmo sem OTEL_EXPORTER_OTLP_ENDPOINT configurado, gera e propaga traceId/spanId em memória.
 */
export function initTracing(serviceName?: string): NodeTracerProvider {
  if (tracerProvider) {
    return tracerProvider;
  }

  const effectiveService = serviceName || env.SERVICE_NAME || 'conformia-api';
  const environmentName = env.APP_ENV || env.NODE_ENV;

  const resource = new Resource({
    [ATTR_SERVICE_NAME]: effectiveService,
    [ATTR_SERVICE_VERSION]: env.APP_VERSION,
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: environmentName,
  });

  const otlpEndpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  const shouldExportOtlp =
    env.OTEL_ENABLED !== 'false' &&
    Boolean(otlpEndpoint) &&
    env.NODE_ENV !== 'test';

  const spanProcessors = shouldExportOtlp
    ? [
        new BatchSpanProcessor(
          new OTLPTraceExporter({
            url: otlpEndpoint,
            headers: parseOtlpHeaders(env.OTEL_EXPORTER_OTLP_HEADERS),
          })
        ),
      ]
    : [];

  const provider = new NodeTracerProvider({
    resource,
    spanProcessors,
  });

  provider.register({
    propagator: new W3CTraceContextPropagator(),
  });

  tracerProvider = provider;
  initializedServiceName = effectiveService;
  return provider;
}

/**
 * Encerra o provider OpenTelemetry liberando buffers pendentes com segurança.
 */
export async function shutdownTracing(): Promise<void> {
  if (!tracerProvider) {
    return;
  }
  const provider = tracerProvider;
  tracerProvider = null;
  initializedServiceName = null;
  await provider.shutdown().catch(() => {});
}

/**
 * Obtém o Tracer ativo inicializando o provider caso ainda não esteja registrado.
 */
export function getTracer(name?: string): Tracer {
  initTracing(initializedServiceName || env.SERVICE_NAME || 'conformia-api');
  return trace.getTracer(name || 'conformia', env.APP_VERSION);
}

/**
 * Retorna os identificadores de trace/span ativos do contexto OTel ou fallback do AsyncLocalStorage.
 */
export function getActiveTraceIds(): { traceId?: string; spanId?: string } {
  const spanCtx = trace.getSpan(context.active())?.spanContext();
  if (spanCtx && spanCtx.traceId && spanCtx.traceId !== ZERO_TRACE_ID) {
    return {
      traceId: spanCtx.traceId,
      spanId: spanCtx.spanId,
    };
  }

  const store = observabilityContext.getStore();
  if (store?.traceId && store.traceId !== ZERO_TRACE_ID) {
    return {
      traceId: store.traceId,
      spanId: store.spanId,
    };
  }

  return {};
}

/**
 * Retorna o contexto consolidado de observabilidade para logs e telemetria.
 */
export function getCurrentContext(): ObservabilityContext {
  const store = observabilityContext.getStore() || {};
  const activeIds = getActiveTraceIds();
  return {
    ...store,
    ...(activeIds.traceId ? { traceId: activeIds.traceId } : {}),
    ...(activeIds.spanId ? { spanId: activeIds.spanId } : {}),
  };
}

/**
 * Executa uma função preservando e enriquecendo o contexto assíncrono de observabilidade.
 */
export function runWithContext<T>(partial: Partial<ObservabilityContext>, fn: () => T): T {
  const current = observabilityContext.getStore() || {};
  return observabilityContext.run({ ...current, ...partial }, fn);
}

/**
 * Injeta o contexto W3C (traceparent/tracestate) e x-request-id em um carrier serializável (ex: job BullMQ).
 */
export function injectTraceCarrier(): Record<string, string> {
  initTracing(initializedServiceName || env.SERVICE_NAME || 'conformia-api');
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);

  const store = observabilityContext.getStore();
  if (store?.requestId && !carrier['x-request-id']) {
    carrier['x-request-id'] = store.requestId;
  }

  return carrier;
}

/**
 * Extrai um contexto OpenTelemetry a partir de cabeçalhos HTTP ou carrier de fila.
 */
export function extractTraceContext(
  carrier?: Record<string, string | string[] | undefined>
): Context {
  initTracing(initializedServiceName || env.SERVICE_NAME || 'conformia-api');
  if (!carrier) {
    return ROOT_CONTEXT;
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(carrier)) {
    if (typeof value === 'string') {
      normalized[key.toLowerCase()] = value;
    } else if (Array.isArray(value) && value.length > 0) {
      normalized[key.toLowerCase()] = String(value[0]);
    }
  }

  return propagation.extract(ROOT_CONTEXT, normalized);
}

/**
 * Executa uma operação assíncrona dentro de um span OpenTelemetry gerenciado,
 * propagando traceId/spanId automaticamente para logs via AsyncLocalStorage.
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean | undefined>,
  fn: (span: Span) => Promise<T>,
  options?: { kind?: SpanKind; parentContext?: Context }
): Promise<T> {
  const tracer = getTracer();
  const baseContext = options?.parentContext ?? context.active();

  return await tracer.startActiveSpan(
    name,
    { kind: options?.kind ?? SpanKind.INTERNAL },
    baseContext,
    async (span) => {
      for (const [key, val] of Object.entries(attributes)) {
        if (val !== undefined) {
          span.setAttribute(key, val);
        }
      }

      const spanCtx = span.spanContext();
      const traceUpdate: Partial<ObservabilityContext> =
        spanCtx.traceId && spanCtx.traceId !== ZERO_TRACE_ID
          ? { traceId: spanCtx.traceId, spanId: spanCtx.spanId }
          : {};

      try {
        return await runWithContext(traceUpdate, () => fn(span));
      } catch (err: any) {
        if (err instanceof Error) {
          span.recordException(err);
        }
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err?.message || String(err),
        });
        throw err;
      } finally {
        span.end();
      }
    }
  );
}
