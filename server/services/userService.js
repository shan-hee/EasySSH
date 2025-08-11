/**
 * 用户服务
 * 实现SQLite和node-cache混合存储
 */

const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { getCache, connectDatabase } = require('../config/database');
const logger = require('../utils/logger');
const { authenticator } = require('otplib');

// 获取缓存实例
const cache = getCache();

class UserService {
  /**
   * 根据ID获取用户
   * 优先从缓存获取，未命中则从SQLite获取并缓存
   */
  async getUserById(userId) {
    try {
      // 尝试从缓存获取
      const userKey = `user:${userId}`;
      const cachedUser = cache.get(userKey);
      
      if (cachedUser) {
        // 缓存命中时减少日志输出，避免频繁认证时的日志噪音
        return cachedUser;
      }

      // 从SQLite获取
      const user = await User.findById(userId);
      
      if (!user) {
        return null;
      }
      
      // 获取安全的用户对象
      const safeUser = user.toSafeObject();
      
      // 缓存数据（24小时过期）
      cache.set(userKey, safeUser, 86400);
      
      return safeUser;
    } catch (error) {
      logger.error('获取用户失败', error);
      throw error;
    }
  }

  /**
   * 用户注册
   */
  async registerUser(userData) {
    try {
      // 检查用户名是否已存在
      const existingUsername = await User.findOne({ username: userData.username });
      if (existingUsername) {
        return { success: false, message: '用户名已被使用' };
      }
      
      // 检查邮箱是否已存在
      if (userData.email) {
      const existingEmail = await User.findOne({ email: userData.email });
      if (existingEmail) {
        return { success: false, message: '邮箱已被注册' };
        }
      }
      
      // 创建新用户
      const user = new User(userData);
      user.setPassword(userData.password); // 确保密码被标记为需要哈希
      await user.save();
      
      // 生成JWT令牌
      const token = await this.generateToken(user.id);
      
      // 创建用户会话
      await this.createUserSession(user.id.toString(), token);
      
      return {
        success: true,
        message: '注册成功',
        user: user.toSafeObject(),
        token
      };
    } catch (error) {
      logger.error('用户注册失败', error);
      return { success: false, message: '注册失败: ' + error.message };
    }
  }

  /**
   * 用户登录
   */
  async loginUser(username, password) {
    try {
      // 查找用户（仅支持用户名登录）
      const user = await User.findOne({ username });
      
      if (!user) {
        return { success: false, message: '用户不存在' };
      }
      
      // 验证密码
      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        return { success: false, message: '密码错误' };
      }
      
      // 检查用户状态
      if (user.status !== 'active') {
        return { success: false, message: '账户已禁用，请联系管理员' };
      }
      
      // 更新最后登录时间
      user.lastLogin = new Date().toISOString();
      await user.save();
      
      // 生成JWT令牌
      const token = this.generateToken(user.id);
      
      // 先验证会话缓存是否工作正常
      const testKey = `test:${Date.now()}`;
      const testValue = { test: true, timestamp: Date.now() };
      cache.set(testKey, testValue, 60); // 60秒过期
      const retrievedValue = cache.get(testKey);
      
      logger.info('缓存测试结果', {
        key: testKey,
        valueSet: testValue,
        valueRetrieved: retrievedValue,
        cacheWorking: !!retrievedValue,
        matches: JSON.stringify(retrievedValue) === JSON.stringify(testValue)
      });
      
      // 创建用户会话
      const sessionCreated = await this.createUserSession(user.id.toString(), token);
      logger.info('用户会话创建结果', {
        userId: user.id,
        sessionCreated,
        tokenLength: token.length
      });
      
      // 检查会话是否能被检索到
      const tokenKey = `token:${token}`;
      const session = cache.get(tokenKey);
      logger.info('会话检索测试', {
        key: tokenKey.substring(0, 20) + '...',
        sessionExists: !!session,
        sessionValue: session
      });
      
      // 检查用户是否设置了多因素认证
      const needMfa = user.mfaEnabled;
      
      // 检查是否使用默认密码
      const isDefaultPassword = user.isDefaultPassword || false;
      logger.info('用户登录信息', { 
        userId: user.id,
        username: user.username,
        isDefaultPassword, 
        needMfa
      });
      
      return {
        success: true,
        message: '登录成功',
        user: user.toSafeObject(),
        token,
        isDefaultPassword
      };
    } catch (error) {
      logger.error('用户登录失败', error);
      return { success: false, message: '登录失败: ' + error.message };
    }
  }

  /**
   * 创建用户会话
   * 存储在缓存中
   */
  async createUserSession(userId, token) {
    try {
      logger.info('创建用户会话', { userId, tokenLength: token.length });
      
      // 存储令牌映射，用于验证
      const tokenKey = `token:${token}`;
      const sessionData = { userId, valid: true };
      // 支持表达式（如60*60*48），否则直接转为数字
      let cacheTimeSeconds = process.env.TOKEN_EXPIRES_IN;
      if (typeof cacheTimeSeconds === 'string') {
        try {
          // eslint-disable-next-line no-eval
          cacheTimeSeconds = eval(cacheTimeSeconds);
        } catch (e) {
          cacheTimeSeconds = parseInt(cacheTimeSeconds, 10);
        }
      }
      if (!cacheTimeSeconds || isNaN(cacheTimeSeconds)) cacheTimeSeconds = 48 * 60 * 60; // 默认48小时
      
      cache.set(tokenKey, sessionData, cacheTimeSeconds);
      logger.info('会话数据已缓存', { 
        key: tokenKey.substring(0, 20) + '...',
        expiresIn: `${cacheTimeSeconds}秒`,
        data: sessionData
      });
      
      // 将令牌添加到用户的活动会话列表
      const userSessionsKey = `user:sessions:${userId}`;
      const userSessions = cache.get(userSessionsKey) || [];
      userSessions.push(token);
      
      // 更新用户的会话列表
      const userSessionsCacheTime = 30 * 24 * 60 * 60; // 30天过期
      cache.set(userSessionsKey, userSessions, userSessionsCacheTime);
      logger.info('用户会话列表已更新', { 
        key: userSessionsKey, 
        sessionsCount: userSessions.length,
        expiresIn: `${userSessionsCacheTime}秒`
      });
      
      // 验证会话是否正确保存
      const savedSession = cache.get(tokenKey);
      logger.info('验证缓存中的会话', {
        exists: !!savedSession,
        valid: savedSession ? savedSession.valid : false,
        userId: savedSession ? savedSession.userId : null,
        match: savedSession ? String(savedSession.userId) === String(userId) : false
      });
      
      return true;
    } catch (error) {
      logger.error('创建用户会话失败', error);
      return false;
    }
  }

  /**
   * 验证令牌
   */
  async verifyToken(token) {
    try {
      // 首先检查令牌是否过期，并解码用户ID
      const secretKey = process.env.JWT_SECRET || 'your-secret-key';

      const decoded = jwt.verify(token, secretKey);

      // 然后检查令牌是否在缓存中
      const tokenKey = `token:${token}`;
      const session = cache.get(tokenKey);
      
      if (!session || !session.valid || String(session.userId) !== String(decoded.userId)) {
        // 新增：如果是remote-logout，返回特定错误
        if (session && session.remoteLogout) {
          logger.debug('令牌验证失败 - 远程注销', { tokenKey });
          return { valid: false, error: 'remote-logout' };
        }
        logger.debug('令牌验证失败 - 缓存数据不匹配或无效', {
          sessionExists: !!session,
          sessionValid: session ? session.valid : false,
          sessionUserId: session ? session.userId : null,
          decodedUserId: decoded.userId
        });
        return { valid: false };
      }

      // 获取用户信息
      const user = await this.getUserById(decoded.userId);

      if (!user) {
        logger.debug('令牌验证失败 - 用户不存在', { userId: decoded.userId });
        return { valid: false };
      }
      
      return {
        valid: true,
        user
      };
    } catch (error) {
      logger.debug('令牌验证失败', { error: error.message, tokenLength: token.length });
      return { valid: false, error: error.message };
    }
  }

  /**
   * 注销用户
   */
  async logoutUser(token) {
    try {
      // 验证令牌
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      const userId = decoded.userId;
      
      // 使令牌失效
      const tokenKey = `token:${token}`;
      cache.set(tokenKey, { userId, valid: false }, 60); // 短期过期，仅用于防止重播攻击
      
      // 从用户会话列表中移除令牌
      const userSessionsKey = `user:sessions:${userId}`;
      const userSessions = cache.get(userSessionsKey) || [];
      const updatedSessions = userSessions.filter(t => t !== token);
      
      // 更新用户的会话列表
      if (updatedSessions.length > 0) {
        cache.set(userSessionsKey, updatedSessions, 30 * 24 * 60 * 60);
      } else {
        cache.del(userSessionsKey);
      }
      
      return { success: true, message: '注销成功' };
    } catch (error) {
      logger.error('用户注销失败', error);
      return { success: false, message: '注销失败: ' + error.message };
    }
  }

  /**
   * 更新用户信息
   */
  async updateUser(userId, userData) {
    try {
      const user = await User.findById(userId);
      
      if (!user) {
        return { success: false, message: '用户不存在' };
      }
      
      // 处理需要验证唯一性的字段
      if (userData.username && userData.username !== user.username) {
        const existingUsername = await User.findOne({ username: userData.username });
        if (existingUsername) {
          return { success: false, message: '用户名已被使用' };
        }
        user.username = userData.username;
      }
      
      if (userData.email && userData.email !== user.email) {
        const existingEmail = await User.findOne({ email: userData.email });
        if (existingEmail) {
          return { success: false, message: '邮箱已被注册' };
        }
        user.email = userData.email;
      }
      
      // 处理密码更新
      if (userData.password) {
        user.setPassword(userData.password);
      }
      
      // 处理提取为独立字段的属性
      if (userData.profile) {
        // 直接更新字段
        if (userData.profile.displayName !== undefined) {
          user.displayName = userData.profile.displayName;
        }
        if (userData.profile.avatar !== undefined) {
          user.avatar = userData.profile.avatar;
        }
        if (userData.profile.mfaEnabled !== undefined) {
          user.mfaEnabled = userData.profile.mfaEnabled;
        }
        if (userData.profile.mfaSecret !== undefined) {
          user.mfaSecret = userData.profile.mfaSecret;
        }
        
        // 其他profile数据保存到profileData
        const newProfileData = { ...user.profileData };
        Object.keys(userData.profile).forEach(key => {
          if (!['displayName', 'avatar', 'mfaEnabled', 'mfaSecret'].includes(key)) {
            newProfileData[key] = userData.profile[key];
          }
        });
        user.profileData = newProfileData;
      }
      
      // 处理settings字段
      if (userData.settings) {
        // 获取现有的设置数据
        const currentSettingsData = user.settingsData || {};

        // 处理UI设置中的主题和字体大小
        if (userData.settings.ui) {
          if (userData.settings.ui.theme !== undefined) {
            user.theme = userData.settings.ui.theme;
          }
          if (userData.settings.ui.fontSize !== undefined) {
            user.fontSize = userData.settings.ui.fontSize;
          }
        }

        // 处理终端设置中的字体大小
        if (userData.settings.terminal && userData.settings.terminal.fontSize !== undefined) {
          user.fontSize = userData.settings.terminal.fontSize;
        }

        // 合并所有设置数据到settingsData
        const newSettingsData = { ...currentSettingsData };
        Object.keys(userData.settings).forEach(settingType => {
          newSettingsData[settingType] = {
            ...newSettingsData[settingType],
            ...userData.settings[settingType]
          };
        });

        user.settingsData = newSettingsData;

        console.log('用户设置已更新:', {
          theme: user.theme,
          fontSize: user.fontSize,
          settingsData: user.settingsData
        });
      }
      
      // 更新其他字段
      if (userData.status) user.status = userData.status;
      
      // 保存更新
      await user.save();
      
      // 清除用户缓存
      cache.del(`user:${userId}`);
      
      return {
        success: true,
        message: '用户信息更新成功',
        user: user.toSafeObject()
      };
    } catch (error) {
      logger.error('更新用户信息失败', error);
      return { success: false, message: '更新失败: ' + error.message };
    }
  }

  /**
   * 获取用户列表
   */
  async getUsers(filters = {}) {
    try {
      const users = await User.find(filters);
      
      // 过滤敏感信息
      const safeUsers = users.map(user => user.toSafeObject());
      
      return safeUsers;
    } catch (error) {
      logger.error('获取用户列表失败', error);
      throw error;
    }
  }

  /**
   * 删除用户
   */
  async deleteUser(userId, adminId) {
    try {
      // 确保删除操作是由管理员执行的
      const admin = await User.findById(adminId);
      if (!admin || !admin.isAdmin) {
        return { success: false, message: '无权限执行此操作' };
      }
      
      // 查找要删除的用户
      const user = await User.findById(userId);
      if (!user) {
        return { success: false, message: '用户不存在' };
      }
      
      // 禁止删除自己
      if (userId === adminId) {
        return { success: false, message: '不能删除自己的账户' };
      }
      
      // 从数据库中删除用户
      // 在SQLite中我们需要手动处理，因为我们没有实现deleteOne方法
      const db = connectDatabase();
      const stmt = db.prepare('DELETE FROM users WHERE id = ?');
      stmt.run(userId);
      
      // 清除用户相关的所有缓存
      cache.del(`user:${userId}`);
      cache.del(`user:sessions:${userId}`);
      
      return { success: true, message: '用户删除成功' };
    } catch (error) {
      logger.error('删除用户失败', error);
      return { success: false, message: '删除失败: ' + error.message };
    }
  }

  /**
   * 生成JWT令牌
   */
  generateToken(userId) {
    // 支持表达式（如60*60*48），否则直接转为数字
    let expiresIn = process.env.TOKEN_EXPIRES_IN;
    if (typeof expiresIn === 'string') {
      try {
        // eslint-disable-next-line no-eval
        expiresIn = eval(expiresIn);
      } catch (e) {
        expiresIn = parseInt(expiresIn, 10);
      }
    }
    if (!expiresIn || isNaN(expiresIn)) expiresIn = 48 * 60 * 60; // 默认48小时
    const now = Date.now() / 1000;
    const payload = {
      userId,
      iat: now,
      exp: now + expiresIn // 有效期
    };
    return jwt.sign(payload, process.env.JWT_SECRET || 'your-secret-key');
  }

  /**
   * 更改用户密码
   * @param {string} userId - 用户ID
   * @param {string} currentPassword - 当前密码
   * @param {string} newPassword - 新密码
   * @returns {Promise<Object>} - 操作结果
   */
  async changePassword(userId, currentPassword, newPassword) {
    try {
      logger.debug('开始处理密码更改', { userId });
      
      // 获取用户
      const user = await User.findById(userId);
      if (!user) {
        return { success: false, message: '用户不存在' };
      }
      
      // 验证当前密码
      const isMatch = await user.comparePassword(currentPassword);
      if (!isMatch) {
        logger.warn('密码更改失败 - 当前密码不匹配', { userId });
        return { success: false, message: '当前密码不正确' };
      }
      
      // 设置新密码
      user.setPassword(newPassword);
      
      // 如果密码被修改，将不再是默认密码
      user.isDefaultPassword = false;
      
      await user.save();
      
      // 清除用户缓存
      cache.del(`user:${userId}`);
      
      logger.info('密码更改成功', { userId });
      return { success: true, message: '密码更改成功' };
    } catch (error) {
      logger.error('密码更改处理失败', error);
      return { success: false, message: '密码更改失败: ' + error.message };
    }
  }

  /**
   * 注销用户的所有设备
   * @param {string} userId - 用户ID
   * @returns {Promise<Object>} - 操作结果
   */
  async logoutAllDevices(userId) {
    try {
      logger.debug('开始处理注销所有设备', { userId });
      
      // 从缓存中获取用户所有会话
      const userSessionsKey = `user:sessions:${userId}`;
      const userSessions = cache.get(userSessionsKey) || [];
      
      // 使所有令牌失效，并标记remote-logout
      for (const token of userSessions) {
        const tokenKey = `token:${token}`;
        cache.set(tokenKey, { userId, valid: false, remoteLogout: true }, 60); // 设置短期过期
      }
      
      // 清除用户会话列表
      cache.del(userSessionsKey);
      
      logger.info('已注销所有设备', { userId, sessionsCount: userSessions.length });
      return { success: true, message: '已成功注销所有设备' };
    } catch (error) {
      logger.error('注销所有设备失败', error);
      return { success: false, message: '注销所有设备失败: ' + error.message };
    }
  }

  /**
   * 验证MFA
   */
  async verifyMfa(username, mfaCode) {
    try {
      logger.info('验证MFA', { username });
      
      // 查找用户
      const user = await User.findOne({ username });
      
      if (!user) {
        logger.warn('MFA验证失败 - 用户不存在', { username });
        return { success: false, message: '用户不存在' };
      }
      
      // 确认用户已启用MFA
      if (!user.mfaEnabled || !user.mfaSecret) {
        logger.warn('MFA验证失败 - 用户未启用MFA', { username });
        return { success: false, message: '用户未启用多因素认证' };
      }
      
      // 验证TOTP码
      const isValid = this._verifyTOTP(mfaCode, user.mfaSecret);
      
      if (!isValid) {
        logger.warn('MFA验证失败 - 验证码无效', { username });
        return { success: false, message: '验证码无效' };
      }
      
      // 生成令牌和用户会话
      const token = this.generateToken(user.id);
      await this.createUserSession(user.id.toString(), token);
      
      // 检查是否使用默认密码
      const isDefaultPassword = user.isDefaultPassword || false;
      
      logger.info('MFA验证成功', { userId: user.id, username });
      
      return {
        success: true,
        message: '验证成功',
        user: user.toSafeObject(),
        token,
        isDefaultPassword
      };
    } catch (error) {
      logger.error('MFA验证失败', error);
      return { success: false, message: '验证失败: ' + error.message };
    }
  }
  
  /**
   * 验证TOTP码
   * @private
   * @param {string} code 用户输入的码
   * @param {string} secret 密钥
   * @returns {boolean} 是否有效
   */
  _verifyTOTP(code, secret, window = 2) {
    try {
      code = code.replace(/\s/g, '');
      if (!code || code.length !== 6 || !/^\d+$/.test(code)) {
        logger.warn('TOTP验证失败：验证码格式无效', { codeLength: code?.length });
        return false;
      }
      // 使用otplib标准算法校验
      const isValid = authenticator.check(code, secret, { window });
      if (isValid) {
        logger.info('TOTP验证成功（otplib标准算法）');
        return true;
      }
      logger.warn('TOTP验证失败：验证码不匹配');
      return false;
    } catch (error) {
      logger.error('TOTP验证失败', error);
      return false;
    }
  }
  
  /**
   * 生成TOTP码（如需调试或生成二维码时用）
   * @private
   * @param {string} secret 密钥
   * @returns {string} 生成的6位验证码
   */
  _generateTOTP(secret) {
    try {
      return authenticator.generate(secret);
    } catch (error) {
      logger.error('生成TOTP码失败', error);
      return null;
    }
  }
}

module.exports = new UserService();