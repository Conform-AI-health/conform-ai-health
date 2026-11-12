import { Router } from 'express';
import { NormController } from '../controllers/normController.js';
import { authenticate } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

// Catálogo e estatísticas
router.get('/catalog', NormController.listCatalog);
router.get('/customer-rules', NormController.customerRules);
router.get('/stats/summary', NormController.getStatsSummary);

// Base de Normas e Chunks do MongoDB Atlas (Coleções 'norms' e 'norms_chunk')
router.get('/', NormController.listNorms);
router.get('/:normId', NormController.getNormById);
router.get('/:normId/chunks', NormController.getNormChunks);

export default router;
