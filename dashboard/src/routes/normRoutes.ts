import { Router } from 'express';
import { NormController } from '../controllers/normController.js';
import { authenticate } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.get('/catalog', NormController.listCatalog);
router.get('/customer-rules', NormController.customerRules);

export default router;

