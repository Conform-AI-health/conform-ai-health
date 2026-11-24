import { Router } from 'express';
import { ReportController } from '../controllers/reportController.js';
import { authenticate, requireLinkedClient, authorize, Role } from '../middlewares/auth.js';

const router = Router();

// Todas as rotas de relatórios requerem usuário autenticado
router.use(authenticate);
router.use(requireLinkedClient);

router.get('/', ReportController.list);
router.get('/pending-review', authorize(Role.ADMIN, Role.AUDITOR), ReportController.getPendingReview);
router.get('/processed-review', authorize(Role.ADMIN, Role.AUDITOR), ReportController.getProcessedReview);
router.get('/:id/contract', ReportController.getContract);
router.get('/:id', ReportController.getById);
router.get('/:id/export', ReportController.exportMarkdown);

// AI-05: Fluxo de Revisão e Governança Humana (restrito a Auditores e Administradores)
router.post('/:id/review', authorize(Role.ADMIN, Role.AUDITOR), ReportController.reviewReport);
router.post('/:id/confirm-and-send', authorize(Role.ADMIN, Role.AUDITOR), ReportController.confirmAndSendEmail);
router.patch('/:id/violations/:violationId/resolve', authorize(Role.ADMIN, Role.AUDITOR), ReportController.resolveViolation);
router.post('/:id/notify', authorize(Role.ADMIN, Role.AUDITOR), ReportController.notifyClient);

export default router;
