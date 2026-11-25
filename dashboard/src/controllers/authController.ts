import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { Role } from '@prisma/client';
import { AuthService } from '../services/authService.js';

const publicRegisterSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'Senha deve ter no mínimo 8 caracteres'),
  name: z.string().min(2, 'Nome deve ter no mínimo 2 caracteres'),
});

const internalUserSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'Senha deve ter no mínimo 8 caracteres'),
  name: z.string().min(2, 'Nome deve ter no mínimo 2 caracteres'),
  role: z.enum(['ADMIN', 'AUDITOR', 'CLIENT', 'VIEWER']),
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

const firstAccessPasswordSchema = z.object({
  newPassword: z.string().min(8, 'Nova senha deve ter pelo menos 8 caracteres'),
});

export class AuthController {
  public static parseCookies(cookieHeader?: string): Record<string, string> {
    const list: Record<string, string> = {};
    if (!cookieHeader) return list;

    cookieHeader.split(';').forEach((cookie) => {
      const parts = cookie.split('=');
      const name = parts.shift()?.trim();
      if (name) {
        try {
          list[name] = decodeURIComponent(parts.join('='));
        } catch {
          list[name] = parts.join('=');
        }
      }
    });
    return list;
  }

  public static hashToken(token: string): string {
    return AuthService.hashToken(token);
  }

  public static generateTokens(user: { id: string; email: string; role: Role; clientId?: string | null }) {
    return AuthService.generateTokens(user);
  }

  public static async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (req.body?.role && req.body.role !== 'CLIENT') {
        res.status(403).json({
          error: 'Elevação de privilégio não permitida no cadastro público.',
          code: 'PRIVILEGE_ELEVATION_FORBIDDEN',
        });
        return;
      }

      if (req.body?.clientId) {
        res.status(403).json({
          error: 'Vínculo arbitrário a clínicas não é permitido no cadastro público.',
          code: 'ARBITRARY_CLIENT_LINKING_FORBIDDEN',
        });
        return;
      }

      const data = publicRegisterSchema.parse(req.body);
      const user = await AuthService.register(data);

      res.status(201).json({
        message: 'Usuário cadastrado com sucesso.',
        user,
      });
    } catch (error: any) {
      if (error.message === 'USER_ALREADY_EXISTS') {
        res.status(409).json({
          error: 'Um usuário com este e-mail já está cadastrado no sistema.',
          code: 'USER_ALREADY_EXISTS',
        });
        return;
      }
      next(error);
    }
  }

  public static async createInternalUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = internalUserSchema.parse(req.body);
      const user = await AuthService.createInternalUser({
        name: data.name,
        email: data.email,
        password: data.password,
        role: data.role as Role,
        clientId: data.clientId,
      });

      res.status(201).json({
        message: 'Usuário interno criado com sucesso.',
        user,
      });
    } catch (error: any) {
      if (error.message === 'USER_ALREADY_EXISTS') {
        res.status(409).json({
          error: 'Um usuário com este e-mail já está cadastrado no sistema.',
          code: 'USER_ALREADY_EXISTS',
        });
        return;
      }
      if (error.message === 'CLIENT_NOT_FOUND') {
        res.status(404).json({
          error: 'A clínica informada não foi encontrada.',
          code: 'CLIENT_NOT_FOUND',
        });
        return;
      }
      next(error);
    }
  }

  public static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = loginSchema.parse(req.body);
      const { token, refreshToken, user } = await AuthService.login({ email, password });

      const isProd = env.NODE_ENV === 'production';
      if (typeof res.setHeader === 'function') {
        res.setHeader('Set-Cookie', [
          `conformia_refresh_token=${refreshToken}; HttpOnly; Path=/api/v1/auth; SameSite=Strict; Max-Age=${
            7 * 24 * 60 * 60
          }${isProd ? '; Secure' : ''}`,
        ]);
      }

      res.status(200).json({
        token,
        user,
      });
    } catch (error: any) {
      if (error.message === 'INVALID_CREDENTIALS') {
        res.status(401).json({
          error: 'Credenciais inválidas. Verifique seu e-mail e senha.',
          code: 'INVALID_CREDENTIALS',
        });
        return;
      }
      next(error);
    }
  }

  public static async refreshToken(req: Request, res: Response, next?: NextFunction): Promise<void> {
    try {
      const headers = req.headers || {};
      const cookies = AuthController.parseCookies(headers.cookie);
      const isCookieSource = Boolean(cookies['conformia_refresh_token']);

      if (isCookieSource) {
        const xRequestedWith = headers['x-requested-with'];
        const origin = headers['origin'];
        const allowedOrigins = (env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);
        const isAllowedOrigin = origin && (allowedOrigins.includes(origin) || env.NODE_ENV !== 'production');

        if (!xRequestedWith && !isAllowedOrigin) {
          res.status(403).json({
            error: 'Requisição de renovação de sessão bloqueada por política de segurança anti-CSRF.',
            code: 'CSRF_VALIDATION_FAILED',
          });
          return;
        }
      }

      const rawTokenInput =
        req.body?.refreshToken || headers['x-refresh-token'] || cookies['conformia_refresh_token'];
      const refreshToken = rawTokenInput ? refreshTokenSchema.parse({ refreshToken: rawTokenInput }).refreshToken : '';

      if (!refreshToken) {
        res.status(401).json({
          error: 'Refresh token não fornecido. Sessão expirada.',
          code: 'REFRESH_TOKEN_REQUIRED',
        });
        return;
      }

      const { token: newAccessToken, refreshToken: newRefreshToken } = await AuthService.refreshToken(refreshToken);

      const isProd = env.NODE_ENV === 'production';
      if (typeof res.setHeader === 'function') {
        res.setHeader('Set-Cookie', [
          `conformia_refresh_token=${newRefreshToken}; HttpOnly; Path=/api/v1/auth; SameSite=Strict; Max-Age=${
            7 * 24 * 60 * 60
          }${isProd ? '; Secure' : ''}`,
        ]);
      }

      res.status(200).json({
        token: newAccessToken,
      });
    } catch (error: any) {
      if (
        error.message === 'INVALID_OR_EXPIRED_REFRESH_TOKEN' ||
        error.message === 'INVALID_REFRESH_TOKEN_PAYLOAD' ||
        error.message === 'REFRESH_TOKEN_REVOKED' ||
        error.message === 'REFRESH_TOKEN_REUSE_DETECTED'
      ) {
        res.status(401).json({
          error: 'Sessão expirada ou inválida. Por favor, faça login novamente.',
          code: 'INVALID_REFRESH_TOKEN',
        });
        return;
      }
      if (typeof next === 'function') {
        next(error);
      } else {
        res.status(500).json({ error: error?.message || 'Erro interno ao renovar sessão.' });
      }
    }
  }

  public static async forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email } = forgotPasswordSchema.parse(req.body);
      await AuthService.forgotPassword(email);

      res.status(200).json({
        message: 'Se o e-mail informado estiver cadastrado, as instruções para redefinição de senha foram enviadas.',
      });
    } catch (error) {
      next(error);
    }
  }

  public static async resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token, newPassword } = resetPasswordSchema.parse(req.body);
      await AuthService.resetPassword(token, newPassword);

      res.status(200).json({
        message: 'Senha redefinida com sucesso. Você já pode fazer login com as novas credenciais.',
      });
    } catch (error: any) {
      if (error.message === 'INVALID_OR_EXPIRED_RESET_TOKEN') {
        res.status(400).json({
          error: 'Token de recuperação inválido ou expirado. Solicite uma nova recuperação.',
          code: 'INVALID_RESET_TOKEN',
        });
        return;
      }
      next(error);
    }
  }

  public static async me(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'Não autenticado.' });
        return;
      }

      const profile = await AuthService.getProfile(userId);
      res.status(200).json({ user: profile });
    } catch (error: any) {
      if (error.message === 'USER_NOT_FOUND') {
        res.status(404).json({ error: 'Usuário não encontrado.' });
        return;
      }
      next(error);
    }
  }

  public static async changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'Não autenticado.' });
        return;
      }

      const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
      await AuthService.changePassword(userId, currentPassword, newPassword);

      res.status(200).json({
        message: 'Senha alterada com sucesso.',
      });
    } catch (error: any) {
      if (error.message === 'CURRENT_PASSWORD_INCORRECT') {
        res.status(400).json({
          error: 'Senha atual incorreta.',
          code: 'INVALID_CURRENT_PASSWORD',
        });
        return;
      }
      next(error);
    }
  }

  public static async firstAccessPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'Não autenticado.' });
        return;
      }

      const { newPassword } = firstAccessPasswordSchema.parse(req.body);
      await AuthService.firstAccessPassword(userId, newPassword);

      res.status(200).json({
        message: 'Senha definitiva configurada com sucesso! Acesso ao Portal da Clínica liberado.',
        mustChangePassword: false,
      });
    } catch (error) {
      next(error);
    }
  }

  public static async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.userId;
      await AuthService.logout(userId);

      const isProd = env.NODE_ENV === 'production';
      if (typeof res.setHeader === 'function') {
        res.setHeader('Set-Cookie', [
          `conformia_refresh_token=; HttpOnly; Path=/api/v1/auth; SameSite=Strict; Max-Age=0${isProd ? '; Secure' : ''}`,
        ]);
      }

      res.status(200).json({
        message: 'Logout realizado com sucesso. Sessão encerrada.',
      });
    } catch (error) {
      next(error);
    }
  }
}
