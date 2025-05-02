/**
 * 用户服务
 * 实现SQLite和node-cache混合存储
 */

const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { getCache, connectDatabase } = require('../config/database');

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
        console.log('从缓存获取用户数据');
        return cachedUser;
      }
      
      // 从SQLite获取
      console.log('从SQLite获取用户数据');
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
      console.error('获取用户失败:', error);
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
      const existingEmail = await User.findOne({ email: userData.email });
      if (existingEmail) {
        return { success: false, message: '邮箱已被注册' };
      }
      
      // 创建新用户
      const user = new User(userData);
      user.setPassword(userData.password); // 确保密码被标记为需要哈希
      await user.save();
      
      // 生成JWT令牌
      const token = this.generateToken(user.id);
      
      // 创建用户会话
      await this.createUserSession(user.id.toString(), token);
      
      return {
        success: true,
        message: '注册成功',
        user: user.toSafeObject(),
        token
      };
    } catch (error) {
      console.error('用户注册失败:', error);
      return { success: false, message: '注册失败: ' + error.message };
    }
  }

  /**
   * 用户登录
   */
  async loginUser(email, password) {
    try {
      // 查找用户
      const user = await User.findOne({ email });
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
      
      // 创建用户会话
      await this.createUserSession(user.id.toString(), token);
      
      return {
        success: true,
        message: '登录成功',
        user: user.toSafeObject(),
        token
      };
    } catch (error) {
      console.error('用户登录失败:', error);
      return { success: false, message: '登录失败: ' + error.message };
    }
  }

  /**
   * 创建用户会话
   * 存储在缓存中
   */
  async createUserSession(userId, token) {
    try {
      // 存储令牌映射，用于验证
      const tokenKey = `token:${token}`;
      cache.set(tokenKey, { userId, valid: true }, 24 * 60 * 60); // 24小时过期
      
      // 将令牌添加到用户的活动会话列表
      const userSessionsKey = `user:sessions:${userId}`;
      const userSessions = cache.get(userSessionsKey) || [];
      userSessions.push(token);
      
      // 更新用户的会话列表
      cache.set(userSessionsKey, userSessions, 30 * 24 * 60 * 60); // 30天过期
      
      return true;
    } catch (error) {
      console.error('创建用户会话失败:', error);
      return false;
    }
  }

  /**
   * 验证令牌
   */
  async verifyToken(token) {
    try {
      // 首先检查令牌是否过期，并解码用户ID
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      
      // 然后检查令牌是否在缓存中
      const tokenKey = `token:${token}`;
      const session = cache.get(tokenKey);
      
      if (!session || !session.valid || session.userId !== decoded.userId) {
        return { valid: false };
      }
      
      // 获取用户信息
      const user = await this.getUserById(decoded.userId);
      
      return {
        valid: true,
        user
      };
    } catch (error) {
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
      console.error('用户注销失败:', error);
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
      
      // 处理配置文件更新
      if (userData.profile) {
        user.profile = {
          ...user.profile,
          ...userData.profile
        };
      }
      
      // 处理设置更新
      if (userData.settings) {
        user.settings = {
          ...user.settings,
          ...userData.settings
        };
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
      console.error('更新用户信息失败:', error);
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
      console.error('获取用户列表失败:', error);
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
      console.error('删除用户失败:', error);
      return { success: false, message: '删除失败: ' + error.message };
    }
  }

  /**
   * 生成JWT令牌
   */
  generateToken(userId) {
    const payload = {
      userId,
      iat: Date.now() / 1000,
      exp: Date.now() / 1000 + 24 * 60 * 60 // 24小时有效期
    };
    
    return jwt.sign(payload, process.env.JWT_SECRET || 'your-secret-key');
  }
}

module.exports = new UserService();