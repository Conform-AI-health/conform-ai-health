import { Router } from 'express';
import { NormController } from '../controllers/normController.js';
import { authenticate, authorize, Role } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

// Catálogo e estatísticas
router.get('/catalog', NormController.listCatalog);
router.get('/customer-rules', NormController.customerRules);
router.get('/stats/summary', NormController.getStatsSummary);

// Crawl recursivo de normas (path real: POST /api/v1/norms/crawl) e busca vetorial RAG
router.post('/crawl', authorize(Role.ADMIN, Role.AUDITOR), NormController.startCrawlJob);
router.get('/crawl/:jobId', authorize(Role.ADMIN, Role.AUDITOR), NormController.getCrawlJobStatus);
router.post('/search', NormController.searchNormsVector);

// Base de Normas e Chunks do MongoDB Atlas (Coleções 'norms' e 'norms_chunk')
router.get('/', NormController.listNorms);
router.get('/:normId', NormController.getNormById);
router.get('/:normId/chunks', NormController.getNormChunks);

export default router;
