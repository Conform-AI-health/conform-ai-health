import { Router } from 'express';
import { ClientController } from '../controllers/clientController.js';
import { authenticate, requireLinkedClient, authorize, enforceTenantIsolation, denyDemoAccount, Role } from '../middlewares/auth.js';

const router = Router();

// Todas as rotas de cliente exigem autenticação
router.use(authenticate);
router.use(requireLinkedClient);

// Portal do cliente (própria clínica)
router.get('/portal/me', authorize(Role.CLIENT), ClientController.portalMe);

// Rotas administrativas / auditoria
router.get('/', authorize(Role.ADMIN, Role.AUDITOR, Role.VIEWER), ClientController.list);
router.post('/', authorize(Role.ADMIN, Role.AUDITOR), ClientController.create);
router.post('/:id/access', authorize(Role.ADMIN, Role.AUDITOR), denyDemoAccount, ClientController.createOrUpdateAccess);
router.get('/:id', authorize(Role.ADMIN, Role.AUDITOR, Role.CLIENT), enforceTenantIsolation('id'), ClientController.getById);
router.put('/:id', authorize(Role.ADMIN, Role.AUDITOR, Role.CLIENT), enforceTenantIsolation('id'), ClientController.update);
router.delete('/:id', authorize(Role.ADMIN), ClientController.delete);
router.post('/:id/scrape', authorize(Role.ADMIN, Role.AUDITOR), ClientController.extractInfo);
router.get('/:id/scraped-data', authorize(Role.ADMIN, Role.AUDITOR, Role.CLIENT, Role.VIEWER), enforceTenantIsolation('id'), ClientController.listScrapedData);

export default router;

