import { Router } from 'express';
import { SystemController } from '../controllers/systemController.js';
import { TelemetryController } from '../controllers/telemetryController.js';
import { authenticate, authorize } from '../middlewares/auth.js';
import { Role } from '@prisma/client';

const router = Router();

router.get('/status', SystemController.status);
router.get('/telemetry', authenticate, authorize(Role.ADMIN, Role.AUDITOR), TelemetryController.getTelemetry);

router.post('/toggle-provider', authenticate, authorize(Role.ADMIN), SystemController.toggleProvider);
router.get('/logs', authenticate, authorize(Role.ADMIN, Role.AUDITOR), SystemController.logs);

export default router;

