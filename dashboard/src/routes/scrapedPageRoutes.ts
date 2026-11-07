import { Router } from 'express';
import { ScrapedPageController } from '../controllers/scrapedPageController.js';
import { authenticate } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

router.post('/scrape', ScrapedPageController.scrapeAndIndex);
router.post('/upload', ScrapedPageController.uploadAndIndex);
router.get('/', ScrapedPageController.list);
router.get('/:id', ScrapedPageController.getById);
router.get('/:id/compatible-agents', ScrapedPageController.getCompatibleAgents);
router.delete('/:id', ScrapedPageController.delete);

export default router;

