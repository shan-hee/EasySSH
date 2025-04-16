/**
 * 身份验证中间件
 * 验证用户JWT令牌，保护需要登录的路由
 */

const userService = require('../services/userService');

// 验证JWT令牌
exports.authMiddleware = async (req, res, next) => {
  try {
    // 从请求头获取令牌
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: '未提供身份验证令牌'
      });
    }
    
    // 提取令牌
    const token = authHeader.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: '无效的身份验证格式'
      });
    }
    
    // 验证令牌
    const result = await userService.verifyToken(token);
    
    if (!result.success) {
      return res.status(401).json({
        success: false,
        message: result.message || '身份验证失败'
      });
    }
    
    // 将用户信息和令牌添加到请求对象
    req.user = result.user;
    req.token = token;
    
    // 继续处理请求
    next();
  } catch (error) {
    console.error('身份验证错误:', error);
    res.status(401).json({
      success: false,
      message: '身份验证失败'
    });
  }
};

// 验证管理员权限
exports.adminMiddleware = (req, res, next) => {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({
      success: false,
      message: '需要管理员权限'
    });
  }
  
  next();
}; 