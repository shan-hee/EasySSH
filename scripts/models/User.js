/**
 * 用户数据模型
 * 处理用户信息与认证
 */

import api from '../services/api/index.js';
import { getFromStorage, saveToStorage, removeFromStorage } from '../../src/utils/storage.js';

// 本地存储键
const STORAGE_KEYS = {
  USER: 'auth.user',
  TOKEN: 'auth.token',
  PREFERENCES: 'user.preferences'
};

// 默认用户数据结构
const DEFAULT_USER = {
  id: null,
  username: '',
  email: '',
  firstName: '',
  lastName: '',
  avatar: '',
  role: 'user',
  isActive: true,
  lastLogin: null,
  createdAt: null,
  updatedAt: null,
  preferences: {
    theme: 'light',
    language: 'zh-CN',
    fontSize: 14,
    terminalSettings: {
      fontFamily: 'Consolas, monospace',
      cursorStyle: 'block',
      cursorBlink: true,
      scrollback: 1000
    },
    sshDefaults: {
      keepAliveInterval: 60,
      authType: 'password'
    }
  }
};

/**
 * 用户模型类
 */
export class User {
  /**
   * 构造函数
   * @param {Object} data 用户数据
   */
  constructor(data = {}) {
    // 合并默认值和传入数据
    this._data = this._mergeData(DEFAULT_USER, data);
    
    // 认证状态
    this._auth = {
      authenticated: false,
      token: null,
      tokenExpiry: null,
      loginError: null
    };
    
    // 加载令牌
    this._loadToken();
  }
  
  /**
   * 深度合并对象
   * @param {Object} target 目标对象
   * @param {Object} source 源对象
   * @returns {Object} 合并后的对象
   * @private
   */
  _mergeData(target, source) {
    const result = { ...target };
    
    for (const key in source) {
      if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        // 如果是对象且非数组，递归合并
        result[key] = this._mergeData(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    
    return result;
  }
  
  /**
   * 从存储加载令牌
   * @private
   */
  _loadToken() {
    const token = getFromStorage(STORAGE_KEYS.TOKEN);
    if (token) {
      this._auth.token = token;
      this._auth.authenticated = true;
      
      // 加载用户数据
      const userData = getFromStorage(STORAGE_KEYS.USER);
      if (userData) {
        this._data = this._mergeData(this._data, userData);
      }
    }
  }
  
  /**
   * 保存令牌和用户数据到存储
   * @param {string} token 认证令牌
   * @param {Object} userData 用户数据
   * @private
   */
  _saveAuth(token, userData) {
    if (token) {
      saveToStorage(STORAGE_KEYS.TOKEN, token);
      this._auth.token = token;
      this._auth.authenticated = true;
    }
    
    if (userData) {
      saveToStorage(STORAGE_KEYS.USER, userData);
      this._data = this._mergeData(this._data, userData);
    }
  }
  
  /**
   * 清除认证信息
   * @private
   */
  _clearAuth() {
    removeFromStorage(STORAGE_KEYS.TOKEN);
    removeFromStorage(STORAGE_KEYS.USER);
    
    this._auth.token = null;
    this._auth.authenticated = false;
    this._auth.tokenExpiry = null;
    
    // 重置数据
    this._data = { ...DEFAULT_USER };
  }
  
  /**
   * 获取所有用户数据
   * @returns {Object} 用户数据
   */
  get data() {
    return { ...this._data };
  }
  
  /**
   * 获取用户ID
   * @returns {string} 用户ID
   */
  get id() {
    return this._data.id;
  }
  
  /**
   * 获取用户名
   * @returns {string} 用户名
   */
  get username() {
    return this._data.username;
  }
  
  /**
   * 获取邮箱
   * @returns {string} 邮箱
   */
  get email() {
    return this._data.email;
  }
  
  /**
   * 获取全名
   * @returns {string} 全名
   */
  get fullName() {
    const { firstName, lastName } = this._data;
    if (firstName && lastName) {
      return `${firstName} ${lastName}`;
    } else if (firstName) {
      return firstName;
    } else if (lastName) {
      return lastName;
    }
    return this._data.username;
  }
  
  /**
   * 获取头像URL
   * @returns {string} 头像URL
   */
  get avatar() {
    return this._data.avatar || this._getDefaultAvatar();
  }
  
  /**
   * 获取默认头像
   * @returns {string} 默认头像URL
   * @private
   */
  _getDefaultAvatar() {
    // 使用Gravatar服务生成默认头像
    if (this._data.email) {
      const hash = this._md5(this._data.email.trim().toLowerCase());
      return `https://www.gravatar.com/avatar/${hash}?d=identicon`;
    }
    return 'assets/images/default-avatar.png';
  }
  
  /**
   * 简单的MD5实现(仅用于演示，实际应使用专门的库)
   * @param {string} str 要计算的字符串
   * @returns {string} MD5哈希
   * @private
   */
  _md5(str) {
    // 简化版实现，实际项目应使用crypto-js或其他库
    return Array.from(str)
      .reduce((hash, char) => (hash << 5) - hash + char.charCodeAt(0), 0)
      .toString(16)
      .padStart(32, '0');
  }
  
  /**
   * 获取用户角色
   * @returns {string} 用户角色
   */
  get role() {
    return this._data.role;
  }
  
  /**
   * 检查是否具有特定角色
   * @param {string} role 角色名称
   * @returns {boolean} 是否具有该角色
   */
  hasRole(role) {
    return this._data.role === role;
  }
  
  /**
   * 是否是管理员
   * @returns {boolean} 是否是管理员
   */
  get isAdmin() {
    return this._data.role === 'admin';
  }
  
  /**
   * 获取认证状态
   * @returns {boolean} 是否已认证
   */
  get isAuthenticated() {
    return this._auth.authenticated;
  }
  
  /**
   * 获取认证令牌
   * @returns {string} 认证令牌
   */
  get token() {
    return this._auth.token;
  }
  
  /**
   * 获取用户偏好设置
   * @returns {Object} 偏好设置
   */
  get preferences() {
    return { ...this._data.preferences };
  }
  
  /**
   * 更新用户偏好设置
   * @param {Object} newPreferences 新的偏好设置
   */
  updatePreferences(newPreferences) {
    this._data.preferences = this._mergeData(this._data.preferences, newPreferences);
    
    // 保存到本地存储
    saveToStorage(STORAGE_KEYS.PREFERENCES, this._data.preferences);
    
    // 如果已认证，同步到服务器
    if (this.isAuthenticated) {
      this._updatePreferencesToServer();
    }
  }
  
  /**
   * 更新偏好设置到服务器
   * @private
   */
  async _updatePreferencesToServer() {
    try {
      await api.user.updateProfile({ preferences: this._data.preferences });
    } catch (error) {
      console.error('更新用户偏好设置失败:', error);
    }
  }
  
  /**
   * 登录
   * @param {Object} credentials 登录凭证
   * @param {string} credentials.username 用户名
   * @param {string} credentials.password 密码
   * @param {boolean} credentials.rememberMe 是否记住登录状态
   * @returns {Promise<boolean>} 登录结果
   */
  async login(credentials) {
    try {
      const { username, password, rememberMe = false } = credentials;
      
      // 验证输入
      if (!username || !password) {
        throw new Error('用户名和密码不能为空');
      }
      
      // 调用登录API
      const result = await api.user.login({ username, password, rememberMe });
      
      // 保存认证信息
      this._saveAuth(result.token, result.user);
      
      return true;
    } catch (error) {
      this._auth.loginError = error;
      console.error('登录失败:', error);
      throw error;
    }
  }
  
  /**
   * 登出
   * @returns {Promise<boolean>} 登出结果
   */
  async logout() {
    try {
      if (this.isAuthenticated) {
        await api.user.logout();
      }
      
      // 清除认证信息
      this._clearAuth();
      
      return true;
    } catch (error) {
      console.error('登出失败:', error);
      
      // 无论如何都清除本地认证
      this._clearAuth();
      
      return true;
    }
  }
  
  /**
   * 注册新用户
   * @param {Object} userData 用户数据
   * @returns {Promise<boolean>} 注册结果
   */
  async register(userData) {
    try {
      const { username, email, password, confirmPassword } = userData;
      
      // 验证输入
      if (!username || !email || !password) {
        throw new Error('用户名、邮箱和密码不能为空');
      }
      
      if (password !== confirmPassword) {
        throw new Error('两次输入的密码不一致');
      }
      
      // 调用注册API
      const result = await api.user.register(userData);
      
      // 如果注册后自动登录
      if (result.token) {
        this._saveAuth(result.token, result.user);
      }
      
      return true;
    } catch (error) {
      console.error('注册失败:', error);
      throw error;
    }
  }
  
  /**
   * 更新用户资料
   * @param {Object} userData 用户数据
   * @returns {Promise<User>} 更新后的用户
   */
  async updateProfile(userData) {
    try {
      // 调用API
      const result = await api.user.updateProfile(userData);
      
      // 更新本地数据
      this._data = this._mergeData(this._data, result);
      
      // 更新存储
      saveToStorage(STORAGE_KEYS.USER, this._data);
      
      return this;
    } catch (error) {
      console.error('更新用户资料失败:', error);
      throw error;
    }
  }
  
  /**
   * 修改密码
   * @param {Object} passwordData 密码数据
   * @param {string} passwordData.oldPassword 旧密码
   * @param {string} passwordData.newPassword 新密码
   * @param {string} passwordData.confirmPassword 确认新密码
   * @returns {Promise<boolean>} 修改结果
   */
  async changePassword(passwordData) {
    try {
      const { oldPassword, newPassword, confirmPassword } = passwordData;
      
      // 验证输入
      if (!oldPassword || !newPassword || !confirmPassword) {
        throw new Error('所有密码字段都不能为空');
      }
      
      if (newPassword !== confirmPassword) {
        throw new Error('两次输入的新密码不一致');
      }
      
      // 调用API
      await api.user.changePassword({
        oldPassword,
        newPassword
      });
      
      return true;
    } catch (error) {
      console.error('修改密码失败:', error);
      throw error;
    }
  }
  
  /**
   * 找回密码
   * @param {string} email 邮箱
   * @returns {Promise<boolean>} 操作结果
   */
  async resetPassword(email) {
    try {
      if (!email) {
        throw new Error('邮箱不能为空');
      }
      
      await api.user.resetPassword(email);
      return true;
    } catch (error) {
      console.error('找回密码失败:', error);
      throw error;
    }
  }
  
  /**
   * 验证令牌
   * @param {string} token 令牌
   * @returns {Promise<boolean>} 验证结果
   */
  async verifyToken(token) {
    try {
      const result = await api.user.verifyToken(token);
      return result.valid === true;
    } catch (error) {
      console.error('验证令牌失败:', error);
      return false;
    }
  }
  
  /**
   * 刷新用户数据
   * @returns {Promise<User>} 更新后的用户
   */
  async refresh() {
    try {
      if (!this.isAuthenticated) {
        throw new Error('用户未登录');
      }
      
      const userData = await api.user.getCurrentUser();
      
      // 更新本地数据
      this._data = this._mergeData(this._data, userData);
      
      // 更新存储
      saveToStorage(STORAGE_KEYS.USER, this._data);
      
      return this;
    } catch (error) {
      console.error('刷新用户数据失败:', error);
      
      // 如果401错误，可能是令牌过期
      if (error.status === 401) {
        this._clearAuth();
      }
      
      throw error;
    }
  }
  
  /**
   * 创建用户实例
   * @returns {User} 用户实例
   */
  static create() {
    return new User();
  }
  
  /**
   * 获取当前用户
   * @returns {User} 用户实例
   */
  static getCurrentUser() {
    return new User();
  }
}

export default User; 