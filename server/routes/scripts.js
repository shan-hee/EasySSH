/**
 * 脚本库路由
 * 处理脚本相关的API路由
 */

const express = require('express');
const router = express.Router();
const {
  getPublicScripts,
  getCategories,
  getPopularScripts,
  searchScripts,
  getUserScripts,
  createUserScript,
  updateUserScript,
  deleteUserScript,
  getAllUserScripts,
  recordScriptUsage,
  executeScript,
  getUserFavorites,
  updateUserFavorites,
  toggleScriptFavorite
} = require('../controllers/scriptController');
const { authMiddleware } = require('../middleware/auth');

// 公开接口（不需要认证）
router.get('/public', getPublicScripts);
router.get('/categories', getCategories);
router.get('/popular', getPopularScripts);
router.get('/search', searchScripts);

// 需要认证的接口
router.use(authMiddleware);

// 用户脚本管理
router.get('/user', getUserScripts);
router.post('/user', createUserScript);
router.put('/user/:id', updateUserScript);
router.delete('/user/:id', deleteUserScript);

// 获取用户所有脚本（包括公开脚本和用户脚本）
router.get('/all', getAllUserScripts);

// 记录脚本使用
router.post('/usage', recordScriptUsage);

// 执行脚本
router.post('/execute', executeScript);

// 脚本收藏相关接口
router.get('/favorites', getUserFavorites);
router.post('/favorites', updateUserFavorites);
router.post('/favorites/:scriptId/toggle', toggleScriptFavorite);

module.exports = router;
