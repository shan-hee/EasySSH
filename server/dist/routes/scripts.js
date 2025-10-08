"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const controller = require('../controllers/scriptController');
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// 公开接口（不需要认证）
router.get('/public', controller.getPublicScripts);
router.get('/categories', controller.getCategories);
router.get('/popular', controller.getPopularScripts);
router.get('/search', controller.searchScripts);
// 需要认证的接口
router.use(auth_1.authMiddleware);
router.get('/user', controller.getUserScripts);
router.post('/user', controller.createUserScript);
router.put('/user/:id', controller.updateUserScript);
router.delete('/user/:id', controller.deleteUserScript);
router.get('/all', controller.getAllUserScripts);
router.get('/incremental', controller.getScriptsIncremental);
router.post('/usage', controller.recordScriptUsage);
router.post('/execute', controller.executeScript);
router.get('/executions', controller.getExecutionHistory);
router.get('/executions/:id', controller.getExecutionDetail);
router.get('/favorites', controller.getUserFavorites);
router.post('/favorites', controller.updateUserFavorites);
router.post('/favorites/:scriptId/toggle', controller.toggleScriptFavorite);
exports.default = router;
