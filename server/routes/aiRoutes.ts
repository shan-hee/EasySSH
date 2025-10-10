// Bridge stub for compiled dist to reach source JS implementation
import express, { type Request, type Response } from 'express';
import logger from '../utils/logger';
import { authMiddleware } from '../middleware/auth';

// 以最小化类型定义引入 OpenAIAdapter，后续会对其进行完整类型化
// eslint-disable-next-line @typescript-eslint/no-var-requires
const OpenAIAdapter = require('../ai/openai-adapter') as unknown as {
  new (config: { baseUrl: string; apiKey: string; model: string; timeout?: number }): {
    testConnection: () => Promise<{
      success?: boolean;
      valid?: boolean;
      message?: string;
      data?: { model?: string } | null;
    }>;
  };
};

const router = express.Router();

router.post('/test-connection', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { baseUrl, apiKey, model } = req.body;
    if (!baseUrl || !apiKey || !model) {
      return res.status(400).json({ success: false, message: '缺少必要参数：baseUrl、apiKey 和 model' });
    }
    const adapter = new OpenAIAdapter({ baseUrl: baseUrl.replace(/\/$/, ''), apiKey, model });
    const result = await adapter.testConnection();
    let responseData: { success: boolean; valid?: boolean; message: string; data: any };
    if (result && typeof result === 'object' && 'success' in result) {
      responseData = { success: !!(result as any).success, valid: (result as any).valid, message: (result as any).message ?? '', data: (result as any).data || null };
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
    const err = error as Error & { stack?: string };
    logger.error('API连接测试异常', { userId: req.user?.id || 'anonymous', error: err.message, stack: err.stack });
    res.status(500).json({ success: false, message: `测试失败: ${err.message}` });
  }
});

router.get('/status', authMiddleware, async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, data: { available: true, supportedModels: ['gpt-4o-mini','gpt-4o','gpt-4-turbo','gpt-3.5-turbo'], features: ['completion','explanation','fix','generation'] } });
  } catch (error) {
    logger.error('获取AI状态失败', error);
    res.status(500).json({ success: false, message: '获取AI状态失败' });
  }
});

export default router;
