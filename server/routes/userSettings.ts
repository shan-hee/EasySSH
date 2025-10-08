import { Router, type RequestHandler } from 'express';
const userSettingsController = require('../controllers/userSettingsController');
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware as RequestHandler);

router.get('/', userSettingsController.getSettings as RequestHandler);
router.get('/terminal/minimal', userSettingsController.getTerminalMinimal as RequestHandler);
router.put('/', userSettingsController.updateSettings as RequestHandler);
router.put('/batch', userSettingsController.updateSettingsBatch as RequestHandler);
router.post('/sync', userSettingsController.syncSettings as RequestHandler);
router.delete('/:category', userSettingsController.deleteSettings as RequestHandler);

export default router;
