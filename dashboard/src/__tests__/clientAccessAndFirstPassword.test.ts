import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import { ClientController } from '../controllers/clientController.js';
import { AuthController } from '../controllers/authController.js';
import { prisma } from '../config/prisma.js';
import { Role } from '@prisma/client';

vi.mock('../config/prisma.js', () => ({
  prisma: {
    client: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    user: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    systemLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

describe('🏥 Gestão de Clínicas: Criação de Usuário Institucional & Troca Obrigatória no Primeiro Acesso', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. ClientController.create: Cadastro de Clínica com Acesso Institucional Provisório', () => {
    it('deve cadastrar clínica e criar usuário institucional (Role: CLIENT) com mustChangePassword = true', async () => {
      (prisma.client.create as any).mockResolvedValue({
        id: 'client-123',
        name: 'Hospital São Lucas',
        tradeName: 'São Lucas Saúde',
        cnpj: '12.345.678/0001-90',
        email: 'contato@saolucas.med.br',
      });

      (prisma.user.findUnique as any).mockResolvedValue(null);
      (prisma.user.create as any).mockResolvedValue({
        id: 'user-client-1',
        email: 'diretoria@saolucas.med.br',
        name: 'São Lucas Saúde',
        role: Role.CLIENT,
        clientId: 'client-123',
        mustChangePassword: true,
      });

      const req: any = {
        body: {
          name: 'Hospital São Lucas',
          tradeName: 'São Lucas Saúde',
          email: 'contato@saolucas.med.br',
          accessEmail: 'diretoria@saolucas.med.br',
          initialPassword: 'SenhaProvisoria@123',
        },
      };

      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await ClientController.create(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(prisma.client.create).toHaveBeenCalled();
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'diretoria@saolucas.med.br',
            role: Role.CLIENT,
            clientId: 'client-123',
            mustChangePassword: true,
          }),
        })
      );

      const jsonRes = res.json.mock.calls[0][0];
      expect(jsonRes.accessUser).toBeDefined();
      expect(jsonRes.accessUser.mustChangePassword).toBe(true);
    });
  });

  describe('2. ClientController.createOrUpdateAccess: Provisionamento de Acesso para Clínica Existente', () => {
    it('deve provisionar/redefinir senha temporária e ativar mustChangePassword = true para a instituição', async () => {
      (prisma.client.findUnique as any).mockResolvedValue({
        id: 'client-999',
        name: 'Clínica Dermatológica Derma',
        tradeName: 'DermaClin',
      });

      (prisma.user.findUnique as any).mockResolvedValue(null);
      (prisma.user.create as any).mockResolvedValue({
        id: 'user-derma-1',
        email: 'gestao@dermaclin.med.br',
        name: 'DermaClin',
        role: Role.CLIENT,
        clientId: 'client-999',
        mustChangePassword: true,
      });

      const req: any = {
        params: { id: 'client-999' },
        body: {
          email: 'gestao@dermaclin.med.br',
          password: 'NovaSenhaTemp@456',
        },
        user: { email: 'admin@conformia.med.br' },
      };

      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await ClientController.createOrUpdateAccess(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'gestao@dermaclin.med.br',
            role: Role.CLIENT,
            clientId: 'client-999',
            mustChangePassword: true,
          }),
        })
      );

      const jsonRes = res.json.mock.calls[0][0];
      expect(jsonRes.user.mustChangePassword).toBe(true);
    });
  });

  describe('3. AuthController: Exposição de mustChangePassword no Login & Troca Obrigatória no Primeiro Acesso', () => {
    it('deve retornar mustChangePassword = true no payload do login quando o usuário estiver com senha temporária', async () => {
      const hashed = await bcrypt.hash('SenhaTemp@123', 10);
      (prisma.user.findUnique as any).mockResolvedValue({
        id: 'user-temp-1',
        email: 'clinica@med.br',
        passwordHash: hashed,
        name: 'Clínica Exemplo',
        role: Role.CLIENT,
        clientId: 'cli-1',
        mustChangePassword: true,
        client: { id: 'cli-1', name: 'Clínica Exemplo' },
      });

      (prisma.user.update as any).mockResolvedValue({});

      const req: any = {
        body: {
          email: 'clinica@med.br',
          password: 'SenhaTemp@123',
        },
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await AuthController.login(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      const jsonRes = res.json.mock.calls[0][0];
      expect(jsonRes.user.mustChangePassword).toBe(true);
    });

    it('AuthController.firstAccessPassword: deve atualizar senha definitiva e desmarcar mustChangePassword para false', async () => {
      (prisma.user.findUnique as any).mockResolvedValue({
        id: 'user-first-access-1',
        email: 'instituicao@med.br',
        role: Role.CLIENT,
        clientId: 'cli-2',
        mustChangePassword: true,
      });

      (prisma.user.update as any).mockResolvedValue({
        id: 'user-first-access-1',
        mustChangePassword: false,
      });

      const req: any = {
        user: { userId: 'user-first-access-1', email: 'instituicao@med.br' },
        body: {
          newPassword: 'MinhaSenhaSeguraDefinitiva@2026',
        },
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await AuthController.firstAccessPassword(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-first-access-1' },
          data: expect.objectContaining({
            mustChangePassword: false,
          }),
        })
      );

      const jsonRes = res.json.mock.calls[0][0];
      expect(jsonRes.mustChangePassword).toBe(false);
      expect(jsonRes.message).toMatch(/liberado/i);
    });

    it('AuthController.firstAccessPassword: deve rejeitar senhas fracas com menos de 8 caracteres', async () => {
      const req: any = {
        user: { userId: 'user-first-access-1' },
        body: {
          newPassword: 'curta',
        },
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await AuthController.firstAccessPassword(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
