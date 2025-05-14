/**
 * 身份验证中间件
 * 验证用户JWT令牌，保护需要登录的路由
 */

const userService = require('../services/userService');
const logger = require('../utils/logger');
const jwt = require('jsonwebtoken');

// 验证JWT令牌
exports.authMiddleware = async (req, res, next) => {
  try {
    logger.debug('认证中间件 - 请求路径', req.path);
    
    // 从请求头获取令牌
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn('认证失败 - 未提供有效的授权头', { 
        authHeader: authHeader ? `${authHeader.substring(0, 15)}...` : 'undefined'
      });
      return res.status(401).json({
        success: false,
        message: '未提供身份验证令牌'
      });
    }
    
    // 提取令牌
    const token = authHeader.split(' ')[1];
    
    if (!token) {
      logger.warn('认证失败 - 授权头中没有令牌');
      return res.status(401).json({
        success: false,
        message: '无效的身份验证格式'
      });
    }
    
    // 基本验证token格式
    if (token.split('.').length !== 3) {
      logger.warn('认证失败 - 无效的JWT格式', { 
        token: token.substring(0, 15) + '...',
        segments: token.split('.').length
      });
      return res.status(401).json({
        success: false,
        message: '无效的身份验证格式'
      });
    }
    
    logger.debug('验证令牌', { 
      length: token.length, 
      prefix: token.substring(0, 10) + '...' 
    });
    
    // 验证令牌
    const result = await userService.verifyToken(token);
    
    if (!result.valid) {
      logger.warn('认证失败 - 令牌验证结果', { 
        valid: result.valid,
        error: result.error || '未知错误',
        tokenExists: !!token,
        tokenLength: token ? token.length : 0
      });
      return res.status(401).json({
        success: false,
        message: result.error || '身份验证失败'
      });
    }
    
    // 将用户信息和令牌添加到请求对象
    req.user = result.user;
    req.token = token;
    
    logger.info('认证成功', { 
      userId: result.user.id, 
      username: result.user.username,
      tokenLength: token.length
    });
    
    // 继续处理请求
    next();
  } catch (error) {
    logger.error('身份验证错误', error);
    res.status(401).json({
      success: false,
      message: '身份验证失败'
    });
  }
};

// 验证管理员权限
exports.adminMiddleware = (req, res, next) => {
  if (!req.user || !req.user.isAdmin) {
    logger.warn('权限不足 - 需要管理员权限', {
      userId: req.user ? req.user.id : null,
      isAdmin: req.user ? req.user.isAdmin : false
    });
    return res.status(403).json({
      success: false,
      message: '需要管理员权限'
    });
  }
  
  logger.debug('验证管理员权限成功', { userId: req.user.id });
  next();
}; 