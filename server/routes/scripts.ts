import { Router, type RequestHandler } from 'express';
const controller = require('../controllers/scriptController');
import { authMiddleware } from '../middleware/auth';

const router = Router();

// 公开接口（不需要认证）
router.get('/public', controller.getPublicScripts as RequestHandler);
router.get('/categories', controller.getCategories as RequestHandler);
router.get('/popular', controller.getPopularScripts as RequestHandler);
router.get('/search', controller.searchScripts as RequestHandler);

// 需要认证的接口
router.use(authMiddleware as RequestHandler);

router.get('/user', controller.getUserScripts as RequestHandler);
router.post('/user', controller.createUserScript as RequestHandler);
router.put('/user/:id', controller.updateUserScript as RequestHandler);
router.delete('/user/:id', controller.deleteUserScript as RequestHandler);

router.get('/all', controller.getAllUserScripts as RequestHandler);
router.get('/incremental', controller.getScriptsIncremental as RequestHandler);
router.post('/usage', controller.recordScriptUsage as RequestHandler);
router.post('/execute', controller.executeScript as RequestHandler);
router.get('/executions', controller.getExecutionHistory as RequestHandler);
router.get('/executions/:id', controller.getExecutionDetail as RequestHandler);
router.get('/favorites', controller.getUserFavorites as RequestHandler);
router.post('/favorites', controller.updateUserFavorites as RequestHandler);
router.post('/favorites/:scriptId/toggle', controller.toggleScriptFavorite as RequestHandler);

export default router;
