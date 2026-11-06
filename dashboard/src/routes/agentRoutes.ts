import { Router } from 'express';
import { AgentController } from '../controllers/agentController.js';
import { authenticate, authorize } from '../middlewares/auth.js';
import { Role } from '@prisma/client';

const router = Router();

router.use(authenticate);

router.get('/', AgentController.listModules);
router.get('/:id', AgentController.getModuleById);
router.post('/', authorize(Role.ADMIN, Role.AUDITOR), AgentController.create);
router.put('/:id', authorize(Role.ADMIN, Role.AUDITOR), AgentController.update);
router.delete('/:id', authorize(Role.ADMIN), AgentController.delete);
router.post('/:id/run', AgentController.runAudit);

export default router;

