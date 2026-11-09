import { Router } from 'express';
import { ScrapedPageController } from '../controllers/scrapedPageController.js';
import { authenticate, authorize, Role } from '../middlewares/auth.js';

const router = Router();

// Todas as rotas exigem usuário autenticado
router.use(authenticate);

// Ingestão e exclusão de normas restritas a Administradores e Auditores (SEC-03)
router.post('/scrape', authorize(Role.ADMIN, Role.AUDITOR), ScrapedPageController.scrapeAndIndex);
router.post('/upload', authorize(Role.ADMIN, Role.AUDITOR), ScrapedPageController.uploadAndIndex);
router.delete('/:id', authorize(Role.ADMIN, Role.AUDITOR), ScrapedPageController.delete);

// Leitura de catálogo regulatório liberada para usuários autorizados
router.get('/', ScrapedPageController.list);
router.get('/:id', ScrapedPageController.getById);
router.get('/:id/compatible-agents', ScrapedPageController.getCompatibleAgents);

export default router;
