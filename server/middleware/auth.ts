// Bridge stub for compiled dist to reach source JS implementation
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import userService from '../services/userService';
const logger = require('../utils/logger');
import jwt from 'jsonwebtoken';

export const authMiddleware: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization as string | undefined;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.debug('认证失败 - 未提供有效的授权头', { path: req.path, authHeader: authHeader ? `${authHeader.substring(0, 15)}...` : 'undefined' });
      return res.status(401).json({ success: false, message: '未提供身份验证令牌' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      logger.debug('认证失败 - 授权头中没有令牌', { path: req.path });
      return res.status(401).json({ success: false, message: '无效的身份验证格式' });
    }

    if (token.split('.').length !== 3) {
      logger.debug('认证失败 - 无效的JWT格式', { path: req.path, token: `${token.substring(0, 15)}...`, segments: token.split('.').length });
      return res.status(401).json({ success: false, message: '无效的身份验证格式' });
    }

    const result = await (userService as any).verifyToken(token);
    if (!result.valid) {
      logger.debug('认证失败 - 令牌验证失败', { path: req.path, error: result.error || '未知错误', tokenLength: token ? token.length : 0 });
      return res.status(401).json({ success: false, message: result.error || '身份验证失败' });
    }

    // attach
    (req as any).user = result.user;
    (req as any).token = token;

    logger.info('认证成功', { userId: (result.user as any).id, username: (result.user as any).username, path: req.path, tokenLength: token.length });
    next();
  } catch (error: any) {
    logger.error('身份验证错误', { path: req.path, error: error.message });
    res.status(401).json({ success: false, message: '身份验证失败' });
  }
};

export const adminMiddleware: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const user = (req as any).user;
  if (!user || !user.isAdmin) {
    logger.warn('权限不足 - 需要管理员权限', { userId: user ? user.id : null, isAdmin: user ? user.isAdmin : false });
    return res.status(403).json({ success: false, message: '需要管理员权限' });
  }
  logger.debug('验证管理员权限成功', { userId: user.id });
  next();
};

export const tokenOnlyMiddleware: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    logger.debug('tokenOnlyMiddleware - 请求路径', req.path);
    const authHeader = req.headers.authorization as string | undefined;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: '未提供身份验证令牌' });
    }
    const token = authHeader.split(' ')[1];
    if (!token || token.split('.').length !== 3) {
      return res.status(401).json({ success: false, message: '无效的身份验证格式' });
    }
    let decoded: any;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    } catch (err) {
      return res.status(401).json({ success: false, message: '身份验证失败' });
    }
    const user = await (userService as any).getUserById(decoded.userId);
    if (!user) {
      return res.status(401).json({ success: false, message: '用户不存在' });
    }
    (req as any).user = user;
    (req as any).token = token;
    next();
  } catch (error) {
    logger.error('tokenOnlyMiddleware错误', error);
    res.status(401).json({ success: false, message: '身份验证失败' });
  }
};

export default { authMiddleware, adminMiddleware, tokenOnlyMiddleware };
