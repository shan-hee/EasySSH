"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Bridge stub for compiled dist to reach source JS implementation
const express_1 = __importDefault(require("express"));
const logger_1 = __importDefault(require("../utils/logger"));
const auth_1 = require("../middleware/auth");
// 以最小化类型定义引入 OpenAIAdapter，后续会对其进行完整类型化
// eslint-disable-next-line @typescript-eslint/no-var-requires
const OpenAIAdapter = require('../ai/openai-adapter');
const router = express_1.default.Router();
router.post('/test-connection', auth_1.authMiddleware, async (req, res) => {
    try {
        const { baseUrl, apiKey, model } = req.body;
        if (!baseUrl || !apiKey || !model) {
            return res.status(400).json({ success: false, message: '缺少必要参数：baseUrl、apiKey 和 model' });
        }
        const adapter = new OpenAIAdapter({ baseUrl: baseUrl.replace(/\/$/, ''), apiKey, model });
        const result = await adapter.testConnection();
        let responseData;
        if (result && typeof result === 'object' && 'success' in result) {
            responseData = { success: !!result.success, valid: result.valid, message: result.message ?? '', data: result.data || null };
        }
        else if (result && typeof result === 'object' && 'model' in result) {
            responseData = { success: true, valid: true, message: 'API连接测试成功', data: result };
        }
        else {
            responseData = { success: false, valid: false, message: '返回数据格式异常', data: null };
        }
        if (responseData.success) {
            logger_1.default.info('API连接测试成功', { userId: req.user?.id || 'anonymous', model: responseData.data?.model });
        }
        else {
            logger_1.default.warn('API连接测试失败', { userId: req.user?.id || 'anonymous', message: responseData.message });
        }
        res.json(responseData);
    }
    catch (error) {
        const err = error;
        logger_1.default.error('API连接测试异常', { userId: req.user?.id || 'anonymous', error: err.message, stack: err.stack });
        res.status(500).json({ success: false, message: `测试失败: ${err.message}` });
    }
});
router.get('/status', auth_1.authMiddleware, async (_req, res) => {
    try {
        res.json({ success: true, data: { available: true, supportedModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'], features: ['completion', 'explanation', 'fix', 'generation'] } });
    }
    catch (error) {
        logger_1.default.error('获取AI状态失败', error);
        res.status(500).json({ success: false, message: '获取AI状态失败' });
    }
});
exports.default = router;
