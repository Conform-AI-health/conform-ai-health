import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { env } from '../config/env.js';

export interface TokenPayload {
  userId: string;
  email: string;
  role: Role;
  clientId?: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

/**
 * Middleware para validação de token JWT Bearer
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Não autorizado. Token de autenticação não fornecido ou inválido.',
      code: 'AUTH_TOKEN_MISSING',
    });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({
      error: 'Token de autenticação expirado ou inválido.',
      code: 'AUTH_TOKEN_INVALID',
    });
  }
}

/**
 * Middleware para Controle de Acesso Baseado em Papéis (RBAC)
 */
export function authorize(...allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'Não autenticado.',
        code: 'UNAUTHENTICATED',
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: 'Acesso negado. Seu perfil não possui permissão para acessar este recurso.',
        code: 'FORBIDDEN',
        requiredRoles: allowedRoles,
        userRole: req.user.role,
      });
      return;
    }

    next();
  };
}

/**
 * Middleware de isolamento multi-tenant:
 * Se o usuário for CLIENT, garante que ele só pode acessar os dados do seu próprio clientId
 */
export function enforceTenantIsolation(paramKey: string = 'id') {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Não autenticado.' });
      return;
    }

    // Administradores e Auditores possuem visão e permissão global
    if (req.user.role === Role.ADMIN || req.user.role === Role.AUDITOR) {
      return next();
    }

    // Usuário do tipo CLIENT é obrigado a pertencer a uma clínica
    if (req.user.role === Role.CLIENT) {
      const requestedClientId = req.params[paramKey] || req.body?.clientId || req.query?.clientId;

      if (!req.user.clientId) {
        res.status(403).json({
          error: 'Acesso negado. Usuário do perfil CLIENT sem clínica vinculada.',
          code: 'CLIENT_NOT_LINKED',
        });
        return;
      }

      if (requestedClientId && requestedClientId !== req.user.clientId) {
        res.status(403).json({
          error: 'Acesso negado. Violação de isolamento multi-tenant.',
          code: 'TENANT_ISOLATION_VIOLATION',
        });
        return;
      }
    }

    next();
  };
}

