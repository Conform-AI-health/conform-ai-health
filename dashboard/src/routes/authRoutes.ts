import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthController } from '../controllers/authController.js';
import { authenticate, authorize, Role } from '../middlewares/auth.js';

// T29: Gerador de chave composto por IP + Conta (E-mail) para prevenir bloqueio em massa de redes corporativas
// e mitigar ataques distribuídos de credential stuffing contra uma conta específica.
const accountIpKeyGenerator = (req: any): string => {
  const email = req.body?.email ? String(req.body.email).toLowerCase().trim() : '';
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  return email ? `${ip}_${email}` : ip;
};

// T29: Contadores independentes por endpoint crítico de autenticação
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: accountIpKeyGenerator,
  message: {
    error: 'Muitas tentativas de login para esta conta/IP. Tente novamente em 15 minutos.',
    code: 'LOGIN_RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: accountIpKeyGenerator,
  message: {
    error: 'Muitas tentativas de cadastro a partir deste endereço. Tente novamente mais tarde.',
    code: 'REGISTER_RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: accountIpKeyGenerator,
  message: {
    error: 'Muitas solicitações de recuperação de senha. Tente novamente em 15 minutos.',
    code: 'FORGOT_PASSWORD_RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.ip || 'unknown',
  message: {
    error: 'Muitas tentativas de redefinição de senha a partir deste IP. Tente novamente mais tarde.',
    code: 'RESET_PASSWORD_RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.ip || 'unknown',
  message: {
    error: 'Limite de renovações de sessão excedido. Tente novamente mais tarde.',
    code: 'REFRESH_RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const router = Router();

router.post('/register', registerLimiter, AuthController.register);
router.post('/login', loginLimiter, AuthController.login);
router.post('/refresh', refreshLimiter, AuthController.refreshToken);
router.post('/forgot-password', forgotPasswordLimiter, AuthController.forgotPassword);
router.post('/reset-password', resetPasswordLimiter, AuthController.resetPassword);
router.get('/me', authenticate, AuthController.me);
router.post('/change-password', authenticate, AuthController.changePassword);
router.post('/logout', AuthController.logout);

// Gestão de usuários administrativos / internos (SEC-01)
router.post('/users', authenticate, authorize(Role.ADMIN), AuthController.createInternalUser);

export default router;

