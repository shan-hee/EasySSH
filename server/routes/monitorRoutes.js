/**
 * 系统监控相关路由
 */

const express = require('express');
const router = express.Router();
const monitorController = require('../controllers/monitorController');
const { authMiddleware } = require('../middleware/auth');

// 所有路由都需要身份验证
router.use(authMiddleware);

// 获取监控安装脚本
router.get('/install-script', monitorController.getInstallScript);

// 检查监控服务状态
router.post('/check-status', monitorController.checkStatus);

// 连接到监控服务
router.post('/connect', monitorController.connectToMonitor);

// 下载安装脚本
router.get('/download-script', monitorController.downloadInstallScript);

// 获取所有监控会话
router.get('/sessions', monitorController.getSessions);

module.exports = router; 