import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { ScrapedPageController } from '../controllers/scrapedPageController.js';
import { authenticate, authorize, Role } from '../middlewares/auth.js';

const scrapingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: {
    error: 'Limite de requisições de raspagem/indexação excedido. Tente novamente mais tarde.',
    code: 'SCRAPING_RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const router = Router();

// Todas as rotas exigem usuário autenticado
router.use(authenticate);

// Ingestão e exclusão de normas restritas a Administradores e Auditores (SEC-03)
router.post('/scrape', authorize(Role.ADMIN, Role.AUDITOR), scrapingLimiter, ScrapedPageController.scrapeAndIndex);
router.post('/upload', authorize(Role.ADMIN, Role.AUDITOR), express.json({ limit: '20mb' }), scrapingLimiter, ScrapedPageController.uploadAndIndex);
router.delete('/:id', authorize(Role.ADMIN, Role.AUDITOR), ScrapedPageController.delete);

// Leitura de catálogo regulatório liberada para usuários autorizados
router.get('/', ScrapedPageController.list);
router.get('/:id', ScrapedPageController.getById);
router.get('/:id/compatible-agents', ScrapedPageController.getCompatibleAgents);

export default router;
