import { Router } from 'express';
import { ClientController } from '../controllers/clientController.js';
import { authenticate, authorize } from '../middlewares/auth.js';
import { Role } from '@prisma/client';

const router = Router();

// Todas as rotas de cliente exigem autenticação
router.use(authenticate);

// Portal do cliente (própria clínica)
router.get('/portal/me', authorize(Role.CLIENT), ClientController.portalMe);

// Rotas administrativas / auditoria
router.get('/', authorize(Role.ADMIN, Role.AUDITOR), ClientController.list);
router.post('/', authorize(Role.ADMIN, Role.AUDITOR), ClientController.create);
router.get('/:id', authorize(Role.ADMIN, Role.AUDITOR, Role.CLIENT), ClientController.getById);
router.put('/:id', authorize(Role.ADMIN, Role.AUDITOR, Role.CLIENT), ClientController.update);
router.delete('/:id', authorize(Role.ADMIN), ClientController.delete);

export default router;

