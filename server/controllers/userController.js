/**
 * 用户控制器
 * 处理用户相关API请求
 */

const userService = require('../services/userService');

// 用户注册
exports.register = async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    // 验证必要字段
    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: '用户名、邮箱和密码不能为空'
      });
    }
    
    // 调用用户服务完成注册
    const result = await userService.registerUser({
      username,
      email,
      password,
      profile: req.body.profile || {},
      settings: req.body.settings || {}
    });
    
    if (!result.success) {
      return res.status(400).json(result);
    }
    
    res.status(201).json(result);
  } catch (error) {
    console.error('注册处理错误:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误，请稍后重试'
    });
  }
};

// 用户登录
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // 验证必要字段
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: '邮箱和密码不能为空'
      });
    }
    
    // 调用用户服务完成登录
    const result = await userService.loginUser(email, password);
    
    if (!result.success) {
      return res.status(401).json(result);
    }
    
    res.json(result);
  } catch (error) {
    console.error('登录处理错误:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误，请稍后重试'
    });
  }
};

// 用户登出
exports.logout = async (req, res) => {
  try {
    const userId = req.user.id;
    const token = req.token;
    
    const result = await userService.logoutUser(userId, token);
    
    res.json(result);
  } catch (error) {
    console.error('登出处理错误:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误，请稍后重试'
    });
  }
};

// 获取当前用户信息
exports.getCurrentUser = async (req, res) => {
  try {
    // 用户信息已由身份验证中间件放入req.user
    res.json({
      success: true,
      user: req.user
    });
  } catch (error) {
    console.error('获取用户信息错误:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误，请稍后重试'
    });
  }
};

// 更新用户信息
exports.updateUser = async (req, res) => {
  try {
    const userId = req.user.id;
    const userData = req.body;
    
    // 不允许更新敏感字段
    delete userData.password;
    delete userData._id;
    delete userData.isAdmin;
    
    const result = await userService.updateUser(userId, userData);
    
    if (!result.success) {
      return res.status(400).json(result);
    }
    
    res.json(result);
  } catch (error) {
    console.error('更新用户信息错误:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误，请稍后重试'
    });
  }
};

// 更改密码
exports.changePassword = async (req, res) => {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;
    
    // 验证必要字段
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: '当前密码和新密码不能为空'
      });
    }
    
    const result = await userService.changePassword(
      userId,
      currentPassword,
      newPassword
    );
    
    if (!result.success) {
      return res.status(400).json(result);
    }
    
    res.json(result);
  } catch (error) {
    console.error('密码更改错误:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误，请稍后重试'
    });
  }
}; 