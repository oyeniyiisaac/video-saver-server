import { Router } from 'express';
import { getInfo, download, getStats, healthCheck } from '../controllers/videoController.js';
import { infoLimiter, downloadLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.get('/health', healthCheck);
router.post('/info', infoLimiter, getInfo);
router.post('/download', downloadLimiter, download);
router.get('/stats', getStats);

export default router;
