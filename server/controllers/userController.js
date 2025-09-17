/**
 * 用户控制器
 * 处理用户相关API请求
 */

const userService = require('../services/userService');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

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

    // 使用原子化注册，避免并发条件下出现多个首任管理员
    const result = await userService.registerUserFirstAdminAtomic({
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

// 检查是否存在管理员
exports.adminExists = async (req, res) => {
  try {
    const count = User.countAdmins();
    return res.json({ success: true, adminExists: count > 0 });
  } catch (error) {
    console.error('检查管理员存在性错误:', error);
    return res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
  }
};

// 用户登录
exports.login = async (req, res) => {
  try {
    const { username, password, mfaCode, isMfaVerification } = req.body;

    // MFA验证流程
    if (isMfaVerification) {
      // 先尝试从请求中获取用户名，如果没有，则尝试从认证令牌中获取
      let userToVerify = username;

      // 如果请求中没有提供用户名，但有认证令牌
      if (!userToVerify && req.headers.authorization) {
        try {
          const authHeader = req.headers.authorization;
          const token = authHeader.split(' ')[1]; // Bearer TOKEN

          if (token) {
            // 验证并解码token，从中获取用户信息
            const secretKey = process.env.JWT_SECRET || 'your-secret-key';
            const decoded = jwt.verify(token, secretKey);

            // 从解码的token中获取用户ID
            if (decoded && decoded.userId) {
              // 获取用户信息
              const user = await userService.getUserById(decoded.userId);
              if (user && user.username) {
                userToVerify = user.username;
                console.log('从认证令牌获取到用户名：', userToVerify);
              }
            }
          }
        } catch (error) {
          console.error('从令牌获取用户信息失败:', error);
          // 继续处理，让下面的逻辑验证用户名
        }
      }

      if (!userToVerify || !mfaCode) {
        return res.status(400).json({
          success: false,
          message: 'MFA验证需要用户名和验证码'
        });
      }

      // 调用用户服务完成MFA验证
      const result = await userService.verifyMfa(userToVerify, mfaCode);

      if (!result.success) {
        return res.status(401).json(result);
      }

      // 检查是否是禁用MFA的操作
      const operation = req.body.operation;
      if (operation === 'disable') {
        // 如果是禁用MFA的操作，添加禁用标识到返回结果中
        result.operation = 'disable';
        result.operationAllowed = true;
      }

      res.json(result);
      return;
    }

    // 常规登录流程
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

    // 返回登录结果

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

    // 暂时跳过MFA验证
    // 之后可以重新实现MFA逻辑
    /*
    // 检查是否为MFA相关变更
    const isMfaChange = userData.profile && (
      userData.profile.mfaEnabled !== undefined ||
      userData.profile.mfaSecret !== undefined
    );
    if (isMfaChange) {
      // 需要验证码
      const mfaCode = userData.mfaCode;
      if (!mfaCode || !/^\d{6}$/.test(mfaCode)) {
        return res.status(400).json({ success: false, message: '请提供6位数字验证码' });
      }
      // 获取当前用户（必须包含mfaSecret）
      const user = await User.findById(userId);
      // 方案一：启用MFA时优先用请求体中的mfaSecret
      let mfaSecretToVerify = (userData.profile && userData.profile.mfaSecret)
        ? userData.profile.mfaSecret
        : user.mfaSecret;
      if (!mfaSecretToVerify) {
        return res.status(400).json({ success: false, message: '未找到MFA密钥' });
      }
      // 校验TOTP
      const isValid = userService._verifyTOTP(mfaCode, mfaSecretToVerify);
      if (!isValid) {
        return res.status(400).json({ success: false, message: '验证码无效或已过期' });
      }
    }
    */

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

// 注销所有设备
exports.logoutAllDevices = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await userService.logoutAllDevices(userId);

    res.json(result);
  } catch (error) {
    console.error('注销所有设备错误:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误，请稍后重试'
    });
  }
};
