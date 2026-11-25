import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../shared/logger.js';
import { getCurrentContext } from '../shared/tracing.js';

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const ctx = getCurrentContext();
  const requestId = req?.requestId || ctx.requestId;
  const traceId = req?.traceId || ctx.traceId;

  if (typeof res.setHeader === 'function') {
    if (requestId) res.setHeader('X-Request-Id', requestId);
    if (traceId) res.setHeader('X-Trace-Id', traceId);
  }

  // Erros de validação Zod
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Dados de requisição inválidos.',
      code: 'VALIDATION_ERROR',
      details: err.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
    return;
  }

  // Erros do Prisma ORM
  if (err?.code === 'P2002') {
    res.status(409).json({
      error: 'Registro duplicado. Um item com este valor já existe no banco de dados.',
      code: 'DUPLICATE_ENTRY',
      target: err.meta?.target,
    });
    return;
  }

  if (err?.code === 'P2025') {
    res.status(404).json({
      error: 'Registro não encontrado.',
      code: 'NOT_FOUND',
    });
    return;
  }

  const status = typeof err?.status === 'number' ? err.status : 500;
  const isProduction = env.NODE_ENV === 'production';
  const isInternalServerError = status >= 500;

  // Log estruturado do erro completo para observabilidade (redigido pelo Pino)
  logger.error(
    {
      err,
      status,
      code: err?.code || 'INTERNAL_SERVER_ERROR',
      method: req?.method,
      path: req?.originalUrl || req?.path,
      requestId,
      traceId,
    },
    'Unhandled HTTP error'
  );

  // T49: Em produção, falhas internas 500+ nunca devem vazar stack traces, queries, nomes de tabelas ou exceptions brutas
  const message = isProduction && isInternalServerError
    ? 'Ocorreu um erro interno no servidor.'
    : (err?.message || 'Erro interno no servidor.');

  const code = isProduction && isInternalServerError
    ? 'INTERNAL_SERVER_ERROR'
    : (err?.code || 'INTERNAL_SERVER_ERROR');

  res.status(status).json({
    error: message,
    code,
    ...(!isProduction && { stack: err?.stack }),
  });
}
