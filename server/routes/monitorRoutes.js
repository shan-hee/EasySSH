/**
 * 系统监控相关路由 - 重构版
 * 专门处理监控客户端主动连接模式的API
 */

const express = require('express');
const router = express.Router();
const monitorController = require('../controllers/monitorController');
const { authMiddleware } = require('../middleware/auth');

// 下载安装脚本（无需认证，供客户端直接下载）
router.get('/download-script', monitorController.downloadInstallScript);

// 其他路由都需要身份验证
router.use(authMiddleware);

// 获取监控安装脚本
router.get('/install-script', monitorController.getInstallScript);



// 获取所有监控会话
router.get('/sessions', monitorController.getSessions);

module.exports = router;