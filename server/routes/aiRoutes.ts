// Bridge stub for compiled dist to reach source JS implementation
// @ts-nocheck
const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { authMiddleware } = require('../middleware/auth');
const OpenAIAdapter = require('../ai/openai-adapter');

router.post('/test-connection', authMiddleware, async (req, res) => {
  try {
    const { baseUrl, apiKey, model } = req.body;
    if (!baseUrl || !apiKey || !model) {
      return res.status(400).json({ success: false, message: '缺少必要参数：baseUrl、apiKey 和 model' });
    }
    const adapter = new OpenAIAdapter({ baseUrl: baseUrl.replace(/\/$/, ''), apiKey, model });
    const result = await adapter.testConnection();
    let responseData;
    if (result && typeof result === 'object' && 'success' in result) {
      responseData = { success: result.success, valid: result.valid, message: result.message, data: result.data || null };
    } else if (result && typeof result === 'object' && 'model' in result) {
      responseData = { success: true, valid: true, message: 'API连接测试成功', data: result };
    } else {
      responseData = { success: false, valid: false, message: '返回数据格式异常', data: null };
    }
    if (responseData.success) {
      logger.info('API连接测试成功', { userId: req.user?.id || 'anonymous', model: responseData.data?.model });
    } else {
      logger.warn('API连接测试失败', { userId: req.user?.id || 'anonymous', message: responseData.message });
    }
    res.json(responseData);
  } catch (error) {
    logger.error('API连接测试异常', { userId: req.user?.id || 'anonymous', error: error.message, stack: error.stack });
    res.status(500).json({ success: false, message: `测试失败: ${error.message}` });
  }
});

router.get('/status', authMiddleware, async (_req, res) => {
  try {
    res.json({ success: true, data: { available: true, supportedModels: ['gpt-4o-mini','gpt-4o','gpt-4-turbo','gpt-3.5-turbo'], features: ['completion','explanation','fix','generation'] } });
  } catch (error) {
    logger.error('获取AI状态失败', error);
    res.status(500).json({ success: false, message: '获取AI状态失败' });
  }
});

module.exports = router;
