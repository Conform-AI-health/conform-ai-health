import crypto from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { SpanKind, SpanStatusCode, context } from '@opentelemetry/api';
import { createLogger } from '../shared/logger.js';
import {
  extractTraceContext,
  getTracer,
  runWithContext,
} from '../shared/tracing.js';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      traceId?: string;
    }
  }
}

const httpLogger = createLogger('HTTP');
const ZERO_TRACE_ID = '00000000000000000000000000000000';

/**
 * Middleware de observabilidade HTTP ponta a ponta:
 * - Cria span SERVER OpenTelemetry herdando traceparent W3C quando presente
 * - Gera ou preserva X-Request-Id e expõe X-Trace-Id nos headers da resposta
 * - Registra log estruturado ao finalizar a resposta sem ler/consumir req.body
 */
export function requestObservability(req: Request, res: Response, next: NextFunction): void {
  const headerReqId = req.headers['x-request-id'];
  const requestId =
    (Array.isArray(headerReqId) ? headerReqId[0] : headerReqId)?.trim() ||
    crypto.randomUUID();

  const parentContext = extractTraceContext(req.headers);
  const tracer = getTracer('conformia-http');
  const startHrTime = process.hrtime.bigint();

  tracer.startActiveSpan(
    `HTTP ${req.method} ${req.path}`,
    { kind: SpanKind.SERVER },
    parentContext,
    (span) => {
      const spanCtx = span.spanContext();
      const traceId = spanCtx.traceId && spanCtx.traceId !== ZERO_TRACE_ID ? spanCtx.traceId : undefined;
      const spanId = spanCtx.spanId;

      span.setAttribute('http.method', req.method);
      span.setAttribute('http.target', req.originalUrl || req.url);
      span.setAttribute('http.request_id', requestId);

      req.requestId = requestId;
      if (traceId) {
        req.traceId = traceId;
      }

      if (typeof res.setHeader === 'function') {
        res.setHeader('X-Request-Id', requestId);
        if (traceId) {
          res.setHeader('X-Trace-Id', traceId);
        }
      }

      let finished = false;
      const finalizeSpan = () => {
        if (finished) return;
        finished = true;

        const durationMs = Number(process.hrtime.bigint() - startHrTime) / 1_000_000;
        const statusCode = res.statusCode || 200;
        const routePath = req.route?.path ? `${req.baseUrl || ''}${req.route.path}` : req.path;

        span.setAttribute('http.status_code', statusCode);
        if (routePath) {
          span.setAttribute('http.route', routePath);
        }
        if (req.user?.userId) {
          span.setAttribute('enduser.id', req.user.userId);
        }
        if (req.user?.clientId) {
          span.setAttribute('tenant.client_id', req.user.clientId);
        }
        if (statusCode >= 500) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${statusCode}` });
        }

        const logPayload = {
          method: req.method,
          path: req.originalUrl || req.url,
          route: routePath,
          statusCode,
          durationMs: Math.round(durationMs * 100) / 100,
          userId: req.user?.userId,
          clientId: req.user?.clientId,
          requestId,
          traceId,
          spanId,
        };

        if (req.method === 'GET' && req.path === '/health' && statusCode === 200) {
          httpLogger.debug(logPayload, 'HTTP healthcheck');
        } else if (statusCode >= 500) {
          httpLogger.error(logPayload, 'HTTP request failed');
        } else if (statusCode >= 400) {
          httpLogger.warn(logPayload, 'HTTP request client error');
        } else {
          httpLogger.info(logPayload, 'HTTP request completed');
        }

        span.end();
      };

      res.on('finish', finalizeSpan);
      res.on('close', finalizeSpan);

      const activeCtx = context.active();
      context.with(activeCtx, () => {
        runWithContext(
          {
            requestId,
            traceId,
            spanId,
          },
          () => next()
        );
      });
    }
  );
}
