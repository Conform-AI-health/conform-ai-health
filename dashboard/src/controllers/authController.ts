import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { Role } from '@prisma/client';

const registerSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'Senha deve ter no mínimo 8 caracteres'),
  name: z.string().min(2, 'Nome deve ter no mínimo 2 caracteres'),
  role: z.enum(['ADMIN', 'AUDITOR', 'CLIENT', 'VIEWER']).default('CLIENT'),
  clientId: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'Senha é obrigatória'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Senha atual é obrigatória'),
  newPassword: z.string().min(8, 'Nova senha deve ter pelo menos 8 caracteres'),
});

export class AuthController {
  public static async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = registerSchema.parse(req.body);

      const existingUser = await prisma.user.findUnique({
        where: { email: data.email },
      });

      if (existingUser) {
        res.status(409).json({
          error: 'Um usuário com este e-mail já está cadastrado no sistema.',
          code: 'USER_ALREADY_EXISTS',
        });
        return;
      }

      // Validação de clientId se o papel for CLIENT
      if (data.role === 'CLIENT' && data.clientId) {
        const clientExists = await prisma.client.findUnique({
          where: { id: data.clientId },
        });
        if (!clientExists) {
          res.status(404).json({
            error: 'A clínica informada para o usuário não foi encontrada.',
            code: 'CLIENT_NOT_FOUND',
          });
          return;
        }
      }

      const passwordHash = await bcrypt.hash(data.password, 12);

      const user = await prisma.user.create({
        data: {
          email: data.email,
          passwordHash,
          name: data.name,
          role: data.role as Role,
          clientId: data.clientId || null,
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          clientId: true,
          createdAt: true,
        },
      });

      res.status(201).json({
        message: 'Usuário cadastrado com sucesso.',
        user,
      });
    } catch (error) {
      next(error);
    }
  }

  public static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = loginSchema.parse(req.body);

      const user = await prisma.user.findUnique({
        where: { email },
        include: { client: true },
      });

      if (!user) {
        res.status(401).json({
          error: 'Credenciais inválidas. Verifique seu e-mail e senha.',
          code: 'INVALID_CREDENTIALS',
        });
        return;
      }

      if (!user.passwordHash) {
        res.status(401).json({
          error: 'Credenciais inválidas. Usuário sem senha configurada.',
          code: 'INVALID_CREDENTIALS',
        });
        return;
      }

      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
        res.status(401).json({
          error: 'Credenciais inválidas. Verifique seu e-mail e senha.',
          code: 'INVALID_CREDENTIALS',
        });
        return;
      }

      const tokenPayload = {
        userId: user.id,
        email: user.email,
        role: user.role,
        clientId: user.clientId,
      };

      const token = jwt.sign(tokenPayload, env.JWT_SECRET, {
        expiresIn: env.JWT_EXPIRES_IN as any,
      });

      res.status(200).json({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          clientId: user.clientId,
          client: user.client
            ? {
                id: user.client.id,
                name: user.client.name,
                tradeName: user.client.tradeName,
                crmResponsavel: user.client.crmResponsavel,
                crmUf: user.client.crmUf,
                status: user.client.status,
              }
            : null,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  public static async me(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Não autenticado.' });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user.userId },
        include: {
          client: {
            include: {
              _count: {
                select: { auditReports: true },
              },
            },
          },
        },
      });

      if (!user) {
        res.status(404).json({ error: 'Usuário não encontrado.' });
        return;
      }

      res.status(200).json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          clientId: user.clientId,
          client: user.client,
          createdAt: user.createdAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  public static async changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Não autenticado.' });
        return;
      }

      const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

      const user = await prisma.user.findUnique({
        where: { id: req.user.userId },
      });

      if (!user) {
        res.status(404).json({ error: 'Usuário não encontrado.' });
        return;
      }

      if (!user.passwordHash) {
        res.status(400).json({
          error: 'Usuário não possui senha definida.',
          code: 'PASSWORD_NOT_SET',
        });
        return;
      }

      const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!isMatch) {
        res.status(400).json({
          error: 'A senha atual informada está incorreta.',
          code: 'CURRENT_PASSWORD_INCORRECT',
        });
        return;
      }

      const newPasswordHash = await bcrypt.hash(newPassword, 12);
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: newPasswordHash },
      });

      res.status(200).json({
        message: 'Senha alterada com sucesso.',
      });
    } catch (error) {
      next(error);
    }
  }
}

