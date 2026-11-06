import { describe, it, expect, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { enforceTenantIsolation, authorize } from '../middlewares/auth.js';
import { Role } from '@prisma/client';

describe('Segurança & Isolamento Multi-Tenant (RBAC & Tenant Guards)', () => {
  it('deve bloquear usuário CLIENT ao tentar acessar dados de outro clientId (403 Forbidden)', () => {
    const req = {
      user: {
        userId: 'user-123',
        email: 'clinica.a@dermato.med.br',
        role: Role.CLIENT,
        clientId: 'client-aaa',
      },
      params: { id: 'client-bbb' },
      body: {},
      query: {},
    } as unknown as Request;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;

    const next = vi.fn() as NextFunction;

    const middleware = enforceTenantIsolation('id');
    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'TENANT_ISOLATION_VIOLATION',
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('deve autorizar usuário CLIENT quando o clientId solicitado for exatamente o seu', () => {
    const req = {
      user: {
        userId: 'user-123',
        email: 'clinica.a@dermato.med.br',
        role: Role.CLIENT,
        clientId: 'client-aaa',
      },
      params: { id: 'client-aaa' },
      body: {},
      query: {},
    } as unknown as Request;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;

    const next = vi.fn() as NextFunction;

    const middleware = enforceTenantIsolation('id');
    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('deve permitir acesso irrestrito para perfis ADMIN e AUDITOR', () => {
    const req = {
      user: {
        userId: 'admin-123',
        email: 'admin@conformia.med.br',
        role: Role.ADMIN,
        clientId: null,
      },
      params: { id: 'qualquer-cliente' },
      body: {},
      query: {},
    } as unknown as Request;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;

    const next = vi.fn() as NextFunction;

    const middleware = enforceTenantIsolation('id');
    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('authorize deve bloquear papéis não autorizados com 403', () => {
    const req = {
      user: {
        userId: 'user-123',
        email: 'cliente@dermato.med.br',
        role: Role.CLIENT,
      },
    } as unknown as Request;

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;

    const next = vi.fn() as NextFunction;

    const authGuard = authorize(Role.ADMIN, Role.AUDITOR);
    authGuard(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

