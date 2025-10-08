import { Router, type RequestHandler } from 'express';
const monitorController = require('../controllers/monitorController');
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware as RequestHandler);

router.get('/status', monitorController.checkStatus as RequestHandler);
router.get('/sessions', monitorController.getSessions as RequestHandler);

export default router;
