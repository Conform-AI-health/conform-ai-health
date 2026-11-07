import { Router } from 'express';
import { ModelController } from '../controllers/modelController.js';
import { authenticate, authorize, Role } from '../middlewares/auth.js';

const router = Router();

// Todas as rotas de gerenciamento de modelos de IA requerem autenticação ADMIN
router.use(authenticate, authorize(Role.ADMIN));

router.get('/', ModelController.list);
router.post('/', ModelController.create);
router.get('/:id', ModelController.getById);
router.put('/:id', ModelController.update);
router.delete('/:id', ModelController.delete);
router.post('/:id/activate', ModelController.activate);
router.post('/:id/test', ModelController.test);

export default router;
