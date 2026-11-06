import { Router } from 'express';
import { ReportController } from '../controllers/reportController.js';
import { authenticate } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get('/', ReportController.list);
router.get('/:id', ReportController.getById);
router.get('/:id/export', ReportController.exportMarkdown);
router.patch('/:id/violations/:violationId/resolve', ReportController.resolveViolation);

export default router;

