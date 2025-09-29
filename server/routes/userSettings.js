/**
 * 用户设置路由
 */

const express = require('express');
const router = express.Router();
const userSettingsController = require('../controllers/userSettingsController');
const { authMiddleware } = require('../middleware/auth');

// 所有路由都需要认证
router.use(authMiddleware);

// 获取用户设置
router.get('/', userSettingsController.getSettings);

// 获取终端初始化所需的最小设置集（严格最小化返回）
router.get('/terminal/minimal', userSettingsController.getTerminalMinimal);

// 更新用户设置
router.put('/', userSettingsController.updateSettings);

// 批量更新用户设置
router.put('/batch', userSettingsController.updateSettingsBatch);

// 数据同步接口
router.post('/sync', userSettingsController.syncSettings);

// 删除用户设置
router.delete('/:category', userSettingsController.deleteSettings);

module.exports = router;
