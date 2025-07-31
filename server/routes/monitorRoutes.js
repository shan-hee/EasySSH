/**
 * 系统监控相关路由 - SSH集成版
 * 处理基于SSH的监控状态检查API
 */

const express = require('express');
const router = express.Router();
const monitorController = require('../controllers/monitorController');
const { authMiddleware } = require('../middleware/auth');

// 所有路由都需要身份验证
router.use(authMiddleware);

// 检查监控状态
router.get('/status', monitorController.checkStatus);

// 获取所有监控会话
router.get('/sessions', monitorController.getSessions);

module.exports = router;