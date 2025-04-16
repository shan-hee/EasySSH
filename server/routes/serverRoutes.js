/**
 * 服务器相关路由
 */

const express = require('express');
const router = express.Router();
const serverController = require('../controllers/serverController');
const { authMiddleware } = require('../middleware/auth');

// 所有路由都需要身份验证
router.use(authMiddleware);

// 获取用户的所有服务器
router.get('/', serverController.getUserServers);

// 创建新服务器
router.post('/', serverController.createServer);

// 获取单个服务器信息
router.get('/:id', serverController.getServer);

// 更新服务器
router.put('/:id', serverController.updateServer);

// 删除服务器
router.delete('/:id', serverController.deleteServer);

// 连接服务器（更新连接计数）
router.post('/:id/connect', serverController.connectServer);

module.exports = router; 