import { Router } from 'express';
import { ModelController } from '../controllers/modelController.js';
import { authenticate, authorize, Role } from '../middlewares/auth.js';

const router = Router();

// Todas as rotas de modelos de IA requerem autenticação (ADMIN e AUDITOR para operação)
router.use(authenticate);

router.get('/', authorize(Role.ADMIN, Role.AUDITOR), ModelController.list);
router.get('/:id', authorize(Role.ADMIN, Role.AUDITOR), ModelController.getById);
router.post('/', authorize(Role.ADMIN, Role.AUDITOR), ModelController.create);
router.put('/:id', authorize(Role.ADMIN, Role.AUDITOR), ModelController.update);
router.post('/:id/activate', authorize(Role.ADMIN, Role.AUDITOR), ModelController.activate);
router.post('/:id/test', authorize(Role.ADMIN, Role.AUDITOR), ModelController.test);
router.delete('/:id', authorize(Role.ADMIN), ModelController.delete);

export default router;
