import { Router } from 'express';
import { AgentController } from '../controllers/agentController.js';
import { authenticate } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get('/', AgentController.listModules);
router.get('/:id', AgentController.getModuleById);
router.post('/:id/run', AgentController.runAudit);

export default router;

