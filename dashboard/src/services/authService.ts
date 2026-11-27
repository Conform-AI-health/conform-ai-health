import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { UserRepository } from '../repositories/userRepository.js';
import { ClientRepository } from '../repositories/clientRepository.js';
import { SystemLogRepository } from '../repositories/systemLogRepository.js';
import { EmailService } from './emailService.js';
import { env } from '../config/env.js';
import { Role, User } from '@prisma/client';

export class AuthService {
  public static hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  public static generateTokens(user: {
    id: string;
    email: string;
    role: Role;
    clientId?: string | null;
    isDemo?: boolean | null;
    demoExpiresAt?: Date | null;
  }) {
    const isDemo = Boolean(user.isDemo);
    const payload: Record<string, string | null | boolean> = {
      userId: user.id,
      email: user.email,
      role: user.role,
      clientId: user.clientId || null,
    };

    // Conta de demonstração: tokens nunca ultrapassam o instante de expiração da conta
    let accessExpiresIn: any = '1h';
    let refreshExpiresIn: any = env.JWT_REFRESH_EXPIRES_IN;
    if (isDemo) {
      const remainingSeconds = user.demoExpiresAt
        ? Math.max(1, Math.floor((new Date(user.demoExpiresAt).getTime() - Date.now()) / 1000))
        : 1;
      accessExpiresIn = Math.min(60 * 60, remainingSeconds);
      refreshExpiresIn = remainingSeconds;
      payload.isDemo = true;
      payload.demoExpiresAt = user.demoExpiresAt ? new Date(user.demoExpiresAt).toISOString() : null;
    }

    const token = jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: accessExpiresIn,
    });

    const refreshToken = jwt.sign(
      { userId: user.id, type: 'refresh' },
      env.JWT_REFRESH_SECRET,
      { expiresIn: refreshExpiresIn }
    );

    return { token, refreshToken };
  }

  public static isDemoExpired(user: { isDemo?: boolean | null; demoExpiresAt?: Date | null }): boolean {
    if (!user?.isDemo) return false;
    return !user.demoExpiresAt || new Date(user.demoExpiresAt).getTime() <= Date.now();
  }

  /**
   * Remove contas de demonstração expiradas.
   */
  public static async purgeExpiredDemoAccounts(): Promise<number> {
    const res = await UserRepository.deleteMany({
      isDemo: true,
      OR: [{ demoExpiresAt: { lte: new Date() } }, { demoExpiresAt: null }],
    });
    return res.count;
  }

  /**
   * Cria uma conta temporária VISITANTE para demonstração aos jurados do HackBrasil.
   * - Expira em 60 minutos; tokens limitados a esse prazo
   * - Senha aleatória descartada (não é possível fazer login por e-mail/senha)
   * - Removida automaticamente após a expiração
   */
  public static async createDemoSession(meta: { ip?: string | null; userAgent?: string | null } = {}) {
    await this.purgeExpiredDemoAccounts();

    const suffix = crypto.randomBytes(4).toString('hex');
    const ttlMinutes = 60;
    const demoExpiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);

    const user = await UserRepository.create({
      email: `jurado.hackbrasil.${suffix}@demo.conform-ai.invalid`,
      passwordHash,
      name: `Jurado HackBrasil #${suffix.toUpperCase()}`,
      role: Role.VIEWER,
      mustChangePassword: false,
      isDemo: true,
      demoExpiresAt,
    });

    const { token, refreshToken } = this.generateTokens({ ...user, isDemo: true, demoExpiresAt });
    await UserRepository.update(user.id, { refreshToken: this.hashToken(refreshToken) });

    await SystemLogRepository.create({
      level: 'WARN',
      module: 'AUTH',
      message: `[DEMO_SESSION_CREATED] Conta temporária de demonstração (HackBrasil) criada: ${user.email} | Perfil VISITANTE | Expira em ${demoExpiresAt.toISOString()}`,
      details: JSON.stringify({
        userId: user.id,
        email: user.email,
        role: Role.VIEWER,
        demoExpiresAt: demoExpiresAt.toISOString(),
        ttlMinutes,
        ip: meta.ip || null,
        userAgent: meta.userAgent ? String(meta.userAgent).slice(0, 200) : null,
      }),
    });

    return {
      token,
      refreshToken,
      expiresAt: demoExpiresAt.toISOString(),
      ttlMinutes,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        clientId: null,
        mustChangePassword: false,
        isDemo: true,
        demoExpiresAt: demoExpiresAt.toISOString(),
        client: null,
      },
    };
  }

  public static async register(data: { name: string; email: string; password: string }) {
    const existing = await UserRepository.findByEmail(data.email);
    if (existing) {
      throw new Error('USER_ALREADY_EXISTS');
    }

    const passwordHash = await bcrypt.hash(data.password, 12);
    const user = await UserRepository.create({
      email: data.email,
      passwordHash,
      name: data.name,
      role: Role.CLIENT,
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      clientId: user.clientId,
      createdAt: user.createdAt,
    };
  }

  public static async createInternalUser(data: {
    name: string;
    email: string;
    password: string;
    role: Role;
    clientId?: string | null;
  }) {
    const existing = await UserRepository.findByEmail(data.email);
    if (existing) {
      throw new Error('USER_ALREADY_EXISTS');
    }

    if (data.clientId) {
      const client = await ClientRepository.findById(data.clientId);
      if (!client) {
        throw new Error('CLIENT_NOT_FOUND');
      }
    }

    const passwordHash = await bcrypt.hash(data.password, 12);
    const user = await UserRepository.create({
      email: data.email,
      passwordHash,
      name: data.name,
      role: data.role,
      client: data.clientId ? { connect: { id: data.clientId } } : undefined,
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      clientId: user.clientId,
      createdAt: user.createdAt,
    };
  }

  public static async login(credentials: { email: string; password: string }) {
    const user = await UserRepository.findByEmail(credentials.email);
    if (!user || !user.passwordHash || user.isDemo) {
      // Contas de demonstração só podem ser acessadas pelo botão dedicado (sem senha conhecida)
      throw new Error('INVALID_CREDENTIALS');
    }

    const isMatch = await bcrypt.compare(credentials.password, user.passwordHash);
    if (!isMatch) {
      throw new Error('INVALID_CREDENTIALS');
    }

    const { token, refreshToken } = this.generateTokens(user);
    const refreshTokenHash = this.hashToken(refreshToken);
    await UserRepository.update(user.id, { refreshToken: refreshTokenHash });

    let clientData: any = null;
    if (user.clientId) {
      const client = await ClientRepository.findById(user.clientId);
      if (client) {
        clientData = {
          id: client.id,
          name: client.name,
          tradeName: client.tradeName,
          crmResponsavel: client.crmResponsavel,
          crmUf: client.crmUf,
          status: client.status,
        };
      }
    }

    return {
      token,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        clientId: user.clientId,
        mustChangePassword: user.mustChangePassword ?? false,
        client: clientData,
      },
    };
  }

  public static async refreshToken(rawToken: string) {
    let decoded: any;
    try {
      decoded = jwt.verify(rawToken, env.JWT_REFRESH_SECRET);
    } catch {
      throw new Error('INVALID_OR_EXPIRED_REFRESH_TOKEN');
    }

    if (!decoded?.userId || decoded?.type !== 'refresh') {
      throw new Error('INVALID_REFRESH_TOKEN_PAYLOAD');
    }

    const user = await UserRepository.findById(decoded.userId);
    if (!user || !user.refreshToken) {
      throw new Error('REFRESH_TOKEN_REVOKED');
    }

    if (this.isDemoExpired(user)) {
      throw new Error('DEMO_SESSION_EXPIRED');
    }

    const tokenHash = this.hashToken(rawToken);
    if (user.refreshToken !== tokenHash) {
      // Violação de segurança: token reutilizado ou inválido. Revoga tudo.
      await UserRepository.update(user.id, { refreshToken: null });
      throw new Error('REFRESH_TOKEN_REUSE_DETECTED');
    }

    const { token: newAccessToken, refreshToken: newRefreshToken } = this.generateTokens(user);
    const newRefreshTokenHash = this.hashToken(newRefreshToken);
    await UserRepository.update(user.id, { refreshToken: newRefreshTokenHash });

    return { token: newAccessToken, refreshToken: newRefreshToken };
  }

  public static async forgotPassword(email: string) {
    const user = await UserRepository.findByEmail(email);
    if (!user) {
      // Resposta genérica para evitar enumeração de contas
      return;
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

    await UserRepository.update(user.id, {
      resetPasswordToken: tokenHash,
      resetPasswordExpires: expiresAt,
    });

    await EmailService.sendPasswordResetEmail(user.email, rawToken, user.name);
  }

  public static async resetPassword(tokenRaw: string, newPassword: string) {
    const tokenHash = this.hashToken(tokenRaw);
    const user = await UserRepository.findFirst({
      resetPasswordToken: tokenHash,
      resetPasswordExpires: { gt: new Date() },
    });

    if (!user) {
      throw new Error('INVALID_OR_EXPIRED_RESET_TOKEN');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await UserRepository.update(user.id, {
      passwordHash,
      resetPasswordToken: null,
      resetPasswordExpires: null,
      refreshToken: null,
      mustChangePassword: false,
    });
  }

  public static async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await UserRepository.findById(userId);
    if (!user || !user.passwordHash) {
      throw new Error('USER_NOT_FOUND');
    }

    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) {
      throw new Error('CURRENT_PASSWORD_INCORRECT');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await UserRepository.update(user.id, { passwordHash });
  }

  public static async firstAccessPassword(userId: string, newPassword: string) {
    const user = await UserRepository.findById(userId);
    if (!user) {
      throw new Error('USER_NOT_FOUND');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await UserRepository.update(user.id, {
      passwordHash,
      mustChangePassword: false,
    });

    await SystemLogRepository.create({
      level: 'INFO',
      module: 'AUTH',
      message: `[FIRST_ACCESS_PASSWORD_CHANGED] Usuário institucional ${user.email} (Perfil: ${user.role}) definiu sua senha definitiva no primeiro acesso.`,
      details: JSON.stringify({
        userId: user.id,
        email: user.email,
        role: user.role,
        clientId: user.clientId,
      }),
    });
  }

  public static async logout(userId?: string) {
    if (userId) {
      await UserRepository.update(userId, { refreshToken: null }).catch(() => null);
    }
  }

  public static async getProfile(userId: string) {
    const user = await UserRepository.findById(userId);
    if (!user) {
      throw new Error('USER_NOT_FOUND');
    }

    if (this.isDemoExpired(user)) {
      throw new Error('DEMO_SESSION_EXPIRED');
    }

    let clientData: any = null;
    if (user.clientId) {
      const client = await ClientRepository.findById(user.clientId);
      if (client) {
        clientData = {
          id: client.id,
          name: client.name,
          tradeName: client.tradeName,
          crmResponsavel: client.crmResponsavel,
          crmUf: client.crmUf,
          status: client.status,
        };
      }
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      clientId: user.clientId,
      mustChangePassword: user.mustChangePassword ?? false,
      isDemo: Boolean(user.isDemo),
      demoExpiresAt: user.demoExpiresAt ? new Date(user.demoExpiresAt).toISOString() : null,
      client: clientData,
    };
  }
}
