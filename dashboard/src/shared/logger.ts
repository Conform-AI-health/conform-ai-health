import pino, { DestinationStream, Logger, LoggerOptions } from 'pino';
import { env } from '../config/env.js';
import { getCurrentContext } from './tracing.js';

/**
 * Caminhos redigidos automaticamente para conformidade estrita com LGPD (Art. 11/46) e segurança.
 */
export const LOGGER_REDACT_PATHS: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-refresh-token"]',
  'headers.authorization',
  'headers.cookie',
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'authPassword',
  'initialPassword',
  'apiKey',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'cpf',
  '*.password',
  '*.passwordHash',
  '*.authPassword',
  '*.apiKey',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  '*.cpf',
  '*.authorization',
  '*.cookie',
];

/**
 * Constrói as opções padrão do Pino com contexto distribuído (traceId, requestId, tenant, auditReportId)
 * e máscara LGPD para campos sensíveis.
 */
export function buildLoggerOptions(overrides?: Partial<LoggerOptions>): LoggerOptions {
  return {
    level: env.LOG_LEVEL || (env.NODE_ENV === 'test' ? 'silent' : 'info'),
    base: {
      service: env.SERVICE_NAME || 'conformia-api',
      env: env.APP_ENV || env.NODE_ENV,
      version: env.APP_VERSION || 'dev',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    redact: {
      paths: LOGGER_REDACT_PATHS,
      censor: '[REDACTED]',
    },
    mixin: () => {
      const ctx = getCurrentContext();
      const extra: Record<string, string> = {};
      if (ctx.requestId) extra.requestId = ctx.requestId;
      if (ctx.traceId) extra.traceId = ctx.traceId;
      if (ctx.spanId) extra.spanId = ctx.spanId;
      if (ctx.userId) extra.userId = ctx.userId;
      if (ctx.clientId) extra.clientId = ctx.clientId;
      if (ctx.jobId) extra.jobId = ctx.jobId;
      if (ctx.auditReportId) extra.auditReportId = ctx.auditReportId;
      return extra;
    },
    ...overrides,
  };
}

export const logger: Logger = pino(buildLoggerOptions());

/**
 * Cria um sub-logger estruturado vinculado a um módulo lógico da plataforma.
 */
export function createLogger(moduleName: string): Logger {
  return logger.child({ module: moduleName });
}

/**
 * Cria instância determinística apontando para stream customizado (útil para testes automatizados).
 */
export function createLoggerForStream(
  stream: DestinationStream,
  moduleName?: string,
  level: string = 'trace'
): Logger {
  const baseLogger = pino(buildLoggerOptions({ level }), stream);
  return moduleName ? baseLogger.child({ module: moduleName }) : baseLogger;
}
