/**
 * 用户相关路由
 */

const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// 公开路由
router.post('/register', userController.register);
router.post('/login', userController.login);
// 添加MFA验证路由 - 这个不需要身份验证
router.post('/verify-mfa', userController.login); // 复用登录控制器，通过isMfaVerification参数区分

// 需要身份验证的路由
// 特殊处理：GET /me 不强制MFA，仅校验token
router.get('/me', authMiddleware, userController.getCurrentUser);

// 其余接口继续使用authMiddleware
router.use(authMiddleware);

router.post('/logout', userController.logout);
router.post('/logout-all-devices', userController.logoutAllDevices);
router.put('/me', userController.updateUser);
router.post('/change-password', userController.changePassword);

module.exports = router;
