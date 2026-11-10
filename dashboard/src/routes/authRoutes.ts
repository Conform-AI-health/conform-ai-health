import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthController } from '../controllers/authController.js';
import { authenticate, authorize, Role } from '../middlewares/auth.js';

const authBruteForceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10, // Máximo 10 tentativas para prevenir brute-force em credenciais
  message: {
    error: 'Muitas tentativas de autenticação a partir deste IP. Tente novamente em 15 minutos.',
    code: 'AUTH_RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 60, // Limite mais tolerante para renovação automática contínua de sessão
  message: {
    error: 'Limite de renovações de sessão excedido. Tente novamente mais tarde.',
    code: 'REFRESH_RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const router = Router();

router.post('/register', authBruteForceLimiter, AuthController.register);
router.post('/login', authBruteForceLimiter, AuthController.login);
router.post('/refresh', refreshLimiter, AuthController.refreshToken);
router.post('/forgot-password', authBruteForceLimiter, AuthController.forgotPassword);
router.post('/reset-password', authBruteForceLimiter, AuthController.resetPassword);
router.get('/me', authenticate, AuthController.me);
router.post('/change-password', authenticate, AuthController.changePassword);
router.post('/logout', AuthController.logout);

// Gestão de usuários administrativos / internos (SEC-01)
router.post('/users', authenticate, authorize(Role.ADMIN), AuthController.createInternalUser);

export default router;

