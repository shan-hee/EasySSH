/**
 * 登录状态管理器
 * 监听用户登录/登出事件，自动触发存储模式切换
 */

import log from './log';
import storageAdapter from './storage-adapter';
import apiService from './api';
import storageService from './storage';
import settingsService from './settings.js';
import { useUserStore } from '../store/user';

class AuthStateManager {
  constructor() {
    this.initialized = false;
    this.currentUser = null;
    this.isLoggedIn = false;
    this.listeners = new Set();
  }

  /**
   * 初始化状态管理器
   */
  async init() {
    if (this.initialized) return true;

    try {
      // 初始化存储适配器
      await storageAdapter.init();

      this.initialized = true;
      log.debug('登录状态管理器初始化完成');
      return true;
    } catch (error) {
      log.error('登录状态管理器初始化失败', error);
      return false;
    }
  }

  /**
   * 用户登录事件处理
   * @param {Object} user - 用户信息
   */
  async onUserLogin(user) {
    try {
      log.info('用户登录，切换到服务器存储模式', { userId: user.id, username: user.username });

      this.currentUser = user;
      this.isLoggedIn = true;

      // 登录前清理与用户设置相关的请求缓存，避免跨用户命中
      try {
        if (typeof apiService.clearRelatedCache === 'function') {
          apiService.clearRelatedCache('/users/settings');
        }
      } catch (_) {}

      // 通知存储适配器用户状态变化
      await this.notifyStorageModeChange('server');

      // 通知所有监听器
      this.notifyListeners('login', user);
    } catch (error) {
      log.error('处理用户登录事件失败', error);
    }
  }

  /**
   * 用户登出事件处理
   */
  async onUserLogout() {
    try {
      const previousUser = this.currentUser;
      log.info('用户登出，切换到本地存储模式', {
        userId: previousUser?.id,
        username: previousUser?.username
      });

      this.currentUser = null;
      this.isLoggedIn = false;

      // 通知存储适配器用户状态变化
      await this.notifyStorageModeChange('local');

      // 重置设置服务初始化状态，确保再次登录会重新拉取
      try {
        settingsService.isInitialized = false;
      } catch (_) {}

      // 清理与用户设置相关的API缓存
      try {
        if (typeof apiService.clearRelatedCache === 'function') {
          apiService.clearRelatedCache('/users/settings');
        }
      } catch (_) {}

      // 清理本地缓存的服务器设置副本（cache.settings.*），仅清理缓存，不动UI设置
      try {
        const keys = typeof storageService.keys === 'function' ? storageService.keys() : [];
        keys
          .filter(k => typeof k === 'string' && k.startsWith('cache.settings.'))
          .forEach(k => {
            try { storageService.removeItem(k); } catch (_) {}
          });
      } catch (_) {}

      // 通知所有监听器
      this.notifyListeners('logout', previousUser);
    } catch (error) {
      log.error('处理用户登出事件失败', error);
    }
  }

  /**
   * 通知存储模式变化
   * @param {string} mode - 存储模式 ('server' | 'local')
   */
  async notifyStorageModeChange(mode) {
    try {
      // 这里可以添加存储模式切换的额外逻辑
      // 比如清理缓存、预加载数据等

      log.debug(`存储模式已切换到: ${mode}`);

      // 触发自定义事件，通知其他组件
      const event = new CustomEvent('storage-mode-changed', {
        detail: {
          mode,
          isLoggedIn: this.isLoggedIn,
          user: this.currentUser
        }
      });
      window.dispatchEvent(event);
    } catch (error) {
      log.error('通知存储模式变化失败', error);
    }
  }

  /**
   * 添加状态变化监听器
   * @param {Function} listener - 监听器函数
   */
  addListener(listener) {
    this.listeners.add(listener);
  }

  /**
   * 移除状态变化监听器
   * @param {Function} listener - 监听器函数
   */
  removeListener(listener) {
    this.listeners.delete(listener);
  }

  /**
   * 通知所有监听器
   * @param {string} event - 事件类型 ('login' | 'logout')
   * @param {Object} data - 事件数据
   */
  notifyListeners(event, data) {
    for (const listener of this.listeners) {
      try {
        listener(event, data);
      } catch (error) {
        log.error('通知监听器失败', error);
      }
    }
  }

  /**
   * 获取当前状态
   * @returns {Object} 当前状态信息
   */
  getState() {
    return {
      isLoggedIn: this.isLoggedIn,
      currentUser: this.currentUser,
      storageMode: this.isLoggedIn ? 'server' : 'local',
      initialized: this.initialized
    };
  }

  /**
   * 检查用户是否已登录
   * @returns {boolean} 是否已登录
   */
  checkLoginStatus() {
    return this.isLoggedIn;
  }

  /**
   * 获取当前用户信息
   * @returns {Object|null} 用户信息
   */
  getCurrentUser() {
    return this.currentUser;
  }

  /**
   * 强制刷新登录状态
   * 从用户store中同步状态
   */
  async refreshLoginStatus() {
    try {
      const userStore = useUserStore();

      const wasLoggedIn = this.isLoggedIn;
      this.isLoggedIn = userStore.isLoggedIn;
      this.currentUser = userStore.user;

      // 如果状态发生变化，触发相应事件
      if (wasLoggedIn !== this.isLoggedIn) {
        if (this.isLoggedIn) {
          await this.onUserLogin(this.currentUser);
        } else {
          await this.onUserLogout();
        }
      }
    } catch (error) {
      log.error('刷新登录状态失败', error);
    }
  }

  /**
   * 销毁状态管理器
   */
  destroy() {
    this.listeners.clear();
    this.currentUser = null;
    this.isLoggedIn = false;
    this.initialized = false;
    log.debug('登录状态管理器已销毁');
  }
}

// 创建单例实例
const authStateManager = new AuthStateManager();

export default authStateManager;
