import { Router } from 'express';
import { SystemController } from '../controllers/systemController.js';
import { TelemetryController } from '../controllers/telemetryController.js';
import { LinkTraceController } from '../controllers/linkTraceController.js';
import { authenticate, authorize, Role } from '../middlewares/auth.js';

const router = Router();

router.get('/status', SystemController.status);
router.get('/worker-status', authenticate, authorize(Role.ADMIN, Role.AUDITOR), SystemController.workerStatus);
router.get('/telemetry', authenticate, authorize(Role.ADMIN, Role.AUDITOR), TelemetryController.getTelemetry);
router.get('/link-trace', authenticate, authorize(Role.ADMIN, Role.AUDITOR), LinkTraceController.list);

router.post('/toggle-provider', authenticate, authorize(Role.ADMIN), SystemController.toggleProvider);
router.post('/test-ai', authenticate, authorize(Role.ADMIN, Role.AUDITOR), SystemController.testAi);
router.get('/logs', authenticate, authorize(Role.ADMIN, Role.AUDITOR), SystemController.logs);

export default router;

