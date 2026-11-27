import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { createRateLimitStore } from '../shared/distributedResilience.js';
import { AgentController } from '../controllers/agentController.js';
import { authenticate, requireLinkedClient, authorize, Role } from '../middlewares/auth.js';

const runAuditLimiter = rateLimit({
  store: createRateLimitStore('runAudit'),
  windowMs: 15 * 60 * 1000,
  max: 25,
  message: {
    error: 'Limite de disparos de auditoria excedido para este intervalo. Tente novamente mais tarde.',
    code: 'AUDIT_RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const router = Router();

router.use(authenticate);
router.use(requireLinkedClient);

router.get('/', AgentController.listModules);
router.get('/:id', AgentController.getModuleById);
router.post('/', authorize(Role.ADMIN, Role.AUDITOR), AgentController.create);
router.put('/:id', authorize(Role.ADMIN, Role.AUDITOR), AgentController.update);
router.delete('/:id', authorize(Role.ADMIN), AgentController.delete);
router.post('/:id/run', authorize(Role.ADMIN, Role.AUDITOR, Role.VIEWER), runAuditLimiter, AgentController.runAudit);

export default router;

