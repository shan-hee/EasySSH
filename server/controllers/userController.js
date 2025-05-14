/**
 * 用户控制器
 * 处理用户相关API请求
 */

const userService = require('../services/userService');

// 用户注册
exports.register = async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // 验证必要字段
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: '用户名和密码不能为空'
      });
    }
    
    // 调用用户服务完成注册
    const result = await userService.registerUser({
      username,
      email: req.body.email || null,
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
    const { username, password } = req.body;
    
    // 验证必要字段
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: '用户名和密码不能为空'
      });
    }
    
    // 调用用户服务完成登录
    const result = await userService.loginUser(username, password);
    
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
    
    // 处理密码更新
    const passwordUpdate = {};
    if (userData.oldPassword && userData.newPassword) {
      passwordUpdate.oldPassword = userData.oldPassword;
      passwordUpdate.newPassword = userData.newPassword;
      
      // 从普通更新数据中移除密码字段
      delete userData.oldPassword;
      delete userData.newPassword;
    }
    
    // 不允许直接更新敏感字段
    delete userData.password;
    delete userData._id;
    delete userData.isAdmin;
    
    // 先验证并更新密码（如果有）
    if (passwordUpdate.oldPassword && passwordUpdate.newPassword) {
      const passwordResult = await userService.changePassword(
        userId,
        passwordUpdate.oldPassword,
        passwordUpdate.newPassword
      );
      
      if (!passwordResult.success) {
        return res.status(400).json(passwordResult);
      }
    }
    
    // 更新其他用户信息
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
    const { oldPassword, newPassword } = req.body;
    
    // 验证必要字段
    if (!oldPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: '当前密码和新密码不能为空'
      });
    }
    
    const result = await userService.changePassword(
      userId,
      oldPassword,
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