/**
 * AI相关的HTTP路由
 * 提供AI配置测试等HTTP API端点
 */

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { authMiddleware } = require('../middleware/auth');
const OpenAIAdapter = require('../ai/openai-adapter');

/**
 * 测试AI API配置
 * POST /api/ai/test-connection
 */
router.post('/test-connection', authMiddleware, async (req, res) => {
  try {
    const { baseUrl, apiKey, model } = req.body;

    // 验证请求参数
    if (!baseUrl || !apiKey || !model) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数：baseUrl、apiKey 和 model'
      });
    }

    // 创建OpenAI适配器并测试连接
    const adapter = new OpenAIAdapter({
      baseUrl: baseUrl.replace(/\/$/, ''), // 移除末尾斜杠
      apiKey,
      model // 移除默认值，要求用户必须提供
    });

    const result = await adapter.testConnection();

    // 检查返回结果的格式，如果不是预期格式则进行转换
    let responseData;
    if (result && typeof result === 'object' && 'success' in result) {
      // 标准格式
      responseData = {
        success: result.success,
        valid: result.valid,
        message: result.message,
        data: result.data || null
      };
    } else if (result && typeof result === 'object' && 'model' in result) {
      // 如果直接返回了OpenAI的数据，包装成标准格式
      responseData = {
        success: true,
        valid: true,
        message: 'API连接测试成功',
        data: result
      };
    } else {
      // 未知格式，当作失败处理
      responseData = {
        success: false,
        valid: false,
        message: '返回数据格式异常',
        data: null
      };
    }

    // 记录测试结果
    if (responseData.success) {
      logger.info('API连接测试成功', {
        userId: req.user?.id || 'anonymous',
        model: responseData.data?.model
      });
    } else {
      logger.warn('API连接测试失败', {
        userId: req.user?.id || 'anonymous',
        message: responseData.message
      });
    }

    res.json(responseData);

  } catch (error) {
    logger.error('API连接测试异常', {
      userId: req.user?.id || 'anonymous',
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      success: false,
      message: `测试失败: ${error.message}`
    });
  }
});

/**
 * 获取AI服务状态
 * GET /api/ai/status
 */
router.get('/status', authMiddleware, async (req, res) => {
  try {
    // 这里可以返回AI服务的状态信息
    res.json({
      success: true,
      data: {
        available: true,
        supportedModels: [
          'gpt-4o-mini',
          'gpt-4o',
          'gpt-4-turbo',
          'gpt-3.5-turbo'
        ],
        features: [
          'completion',
          'explanation',
          'fix',
          'generation'
        ]
      }
    });
  } catch (error) {
    logger.error('获取AI状态失败', error);
    res.status(500).json({
      success: false,
      message: '获取AI状态失败'
    });
  }
});

/**
 * 对API密钥进行打码处理
 * @param {string} apiKey API密钥
 * @returns {string} 打码后的API密钥
 */
function maskApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') {
    return '[无效密钥]';
  }

  if (apiKey.length <= 8) {
    return '***';
  }

  // 显示前4位和后4位，中间用*代替
  const start = apiKey.substring(0, 4);
  const end = apiKey.substring(apiKey.length - 4);
  const middle = '*'.repeat(Math.max(4, apiKey.length - 8));

  return `${start}${middle}${end}`;
}

module.exports = router;
