import { Router } from 'express';
import authRoutes from './authRoutes.js';
import clientRoutes from './clientRoutes.js';
import agentRoutes from './agentRoutes.js';
import reportRoutes from './reportRoutes.js';
import normRoutes from './normRoutes.js';
import systemRoutes from './systemRoutes.js';
import scrapedPageRoutes from './scrapedPageRoutes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/clients', clientRoutes);
router.use('/agents', agentRoutes);
router.use('/reports', reportRoutes);
router.use('/norms', normRoutes);
router.use('/system', systemRoutes);
router.use('/scraped-pages', scrapedPageRoutes);

export default router;

