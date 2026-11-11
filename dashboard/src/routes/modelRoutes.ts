import { Router } from 'express';
import { ModelController } from '../controllers/modelController.js';
import { authenticate, authorize, Role } from '../middlewares/auth.js';

const router = Router();

// Todas as rotas de modelos de IA requerem autenticação (ADMIN e AUDITOR para operação)
router.use(authenticate);

// Leitura e testes de conectividade liberados para Administradores e Auditores
router.get('/', authorize(Role.ADMIN, Role.AUDITOR), ModelController.list);
router.get('/:id', authorize(Role.ADMIN, Role.AUDITOR), ModelController.getById);
router.post('/:id/test', authorize(Role.ADMIN, Role.AUDITOR), ModelController.test);

// Criação, alteração, ativação e exclusão restritas estritamente a Administradores (T10 / SEC-P1)
router.post('/', authorize(Role.ADMIN), ModelController.create);
router.put('/:id', authorize(Role.ADMIN), ModelController.update);
router.post('/:id/activate', authorize(Role.ADMIN), ModelController.activate);
router.delete('/:id', authorize(Role.ADMIN), ModelController.delete);

export default router;
