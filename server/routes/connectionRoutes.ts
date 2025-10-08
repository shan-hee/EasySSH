import { Router, type RequestHandler } from 'express';
const connectionController = require('../controllers/connectionController');
import { authMiddleware } from '../middleware/auth';

const router = Router();

// 所有连接相关API都需要身份验证
router.use(authMiddleware as RequestHandler);

// 健康/可用性检查
router.get('/check', ((_req, res) => res.json({ success: true, message: '连接API可用' })) as RequestHandler);

// 连接管理
router.get('/', connectionController.getUserConnections as RequestHandler);
router.get('/overview', connectionController.getOverview as RequestHandler);
router.post('/', connectionController.addConnection as RequestHandler);
router.put('/:id', connectionController.updateConnection as RequestHandler);
router.delete('/:id', connectionController.deleteConnection as RequestHandler);

// 收藏连接
router.get('/favorites', connectionController.getFavorites as RequestHandler);
router.post('/favorites', connectionController.updateFavorites as RequestHandler);

// 历史记录
router.get('/history', connectionController.getHistory as RequestHandler);
router.post('/history', connectionController.addToHistory as RequestHandler);
router.delete('/history/entry/:entryId', connectionController.removeHistoryEntry as RequestHandler);
router.delete('/history', connectionController.clearHistory as RequestHandler);

// 置顶连接
router.get('/pinned', connectionController.getPinned as RequestHandler);
router.post('/pinned', connectionController.updatePinned as RequestHandler);

// 排序
router.post('/order', connectionController.updateConnectionOrder as RequestHandler);

// 批量同步
router.post('/sync', connectionController.syncConnections as RequestHandler);

export default router;

