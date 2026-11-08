import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { Role } from '@prisma/client';
import { EmailService } from '../services/emailService.js';

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

const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token é obrigatório'),
});

const forgotPasswordSchema = z.object({
  email: z.string().email('Email inválido'),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token de recuperação é obrigatório'),
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

      const { token, refreshToken } = AuthController.generateTokens(user);

      // Salva o refresh token no usuário
      await prisma.user.update({
        where: { id: user.id },
        data: { refreshToken },
      });

      res.status(200).json({
        token,
        refreshToken,
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

  /**
   * Helper para emissão de Access Token (1h) e Refresh Token (7d)
   */
  public static generateTokens(user: { id: string; email: string; role: Role; clientId?: string | null }) {
    const payload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      clientId: user.clientId || null,
    };

    const token = jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: '1h', // Estritamente 1 hora conforme Atividade 1
    });

    const refreshToken = jwt.sign(
      { userId: user.id, type: 'refresh' },
      env.JWT_REFRESH_SECRET,
      { expiresIn: env.JWT_REFRESH_EXPIRES_IN as any }
    );

    return { token, refreshToken };
  }

  /**
   * Renovação de Access Token via Refresh Token com rotação de segurança
   */
  public static async refreshToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const tokenInput = req.body.refreshToken || req.headers['x-refresh-token'];
      const { refreshToken } = refreshTokenSchema.parse({ refreshToken: tokenInput });

      let decoded: any;
      try {
        decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET);
      } catch (err: any) {
        res.status(401).json({
          error: 'Refresh token expirado ou inválido. Efetue login novamente.',
          code: 'INVALID_REFRESH_TOKEN',
        });
        return;
      }

      if (!decoded || !decoded.userId || decoded.type !== 'refresh') {
        res.status(401).json({
          error: 'Refresh token malformado.',
          code: 'MALFORMED_REFRESH_TOKEN',
        });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
      });

      if (!user || user.refreshToken !== refreshToken) {
        res.status(401).json({
          error: 'Refresh token revogado ou substituído. Efetue login novamente.',
          code: 'REVOKED_REFRESH_TOKEN',
        });
        return;
      }

      // Rotação de tokens: emite novo access token (1h) e novo refresh token (7d)
      const newTokens = AuthController.generateTokens(user);

      await prisma.user.update({
        where: { id: user.id },
        data: { refreshToken: newTokens.refreshToken },
      });

      res.status(200).json({
        token: newTokens.token,
        refreshToken: newTokens.refreshToken,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Solicitação de recuperação de senha via e-mail transacional (Resend)
   */
  public static async forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email } = forgotPasswordSchema.parse(req.body);

      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (user) {
        // Gera token aleatório de 32 bytes (64 caracteres hex)
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hora de validade

        await prisma.user.update({
          where: { id: user.id },
          data: {
            resetPasswordToken: resetToken,
            resetPasswordExpires: resetExpires,
          },
        });

        // Dispara e-mail via Resend
        await EmailService.sendPasswordResetEmail(user.email, resetToken, user.name);
      }

      // Resposta genérica para mitigar enumeração de contas
      res.status(200).json({
        message: 'Se o e-mail informado estiver cadastrado em nosso sistema, as instruções para redefinição foram enviadas.',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Redefinição de senha utilizando o token recebido por e-mail
   */
  public static async resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token, newPassword } = resetPasswordSchema.parse(req.body);

      const user = await prisma.user.findFirst({
        where: {
          resetPasswordToken: token,
          resetPasswordExpires: {
            gt: new Date(),
          },
        },
      });

      if (!user) {
        res.status(400).json({
          error: 'Token de recuperação inválido ou expirado. Solicite um novo link.',
          code: 'INVALID_OR_EXPIRED_RESET_TOKEN',
        });
        return;
      }

      const passwordHash = await bcrypt.hash(newPassword, 12);

      // Atualiza senha, limpa tokens de reset e invalida o refresh token anterior
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          resetPasswordToken: null,
          resetPasswordExpires: null,
          refreshToken: null,
        },
      });

      res.status(200).json({
        message: 'Senha redefinida com sucesso! Você já pode acessar a plataforma com suas novas credenciais.',
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

