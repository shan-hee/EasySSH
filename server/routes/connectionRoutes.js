/**
 * 连接相关路由
 */

const express = require('express');
const router = express.Router();
const connectionController = require('../controllers/connectionController');
const { authMiddleware } = require('../middleware/auth');

// 所有连接相关API都需要身份验证
router.use(authMiddleware);

// 检查API是否可用（用于前端检测）
router.get('/check', (req, res) => {
  res.json({ success: true, message: '连接API可用' });
});

// 连接管理
router.get('/', connectionController.getUserConnections);
router.post('/', connectionController.addConnection);
router.put('/:id', connectionController.updateConnection);
router.delete('/:id', connectionController.deleteConnection);

// 收藏连接
router.get('/favorites', connectionController.getFavorites);
router.post('/favorites', connectionController.updateFavorites);

// 历史记录
router.get('/history', connectionController.getHistory);
router.post('/history', connectionController.addToHistory);
router.delete('/history/:id', connectionController.removeFromHistory);

// 置顶连接
router.get('/pinned', connectionController.getPinned);
router.post('/pinned', connectionController.updatePinned);

// 批量同步
router.post('/sync', connectionController.syncConnections);

module.exports = router; 