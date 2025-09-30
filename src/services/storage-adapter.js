/**
 * 统一存储适配器
 * 根据登录状态自动切换本地存储和服务器存储
 */

import log from './log';
import storageService from './storage';
import apiService from './api';
import { useUserStore } from '../store/user';
import settingsService from './settings.js';

class StorageAdapter {
  constructor() {
    this.userStore = null;
    this.initialized = false;
  }

  /**
   * 初始化存储适配器
   */
  async init() {
    if (this.initialized) return true;

    try {
      // 静态导入用户store
      this.userStore = useUserStore();

      // 初始化本地存储服务
      await storageService.init();

      this.initialized = true;
      log.debug('存储适配器初始化完成');
      return true;
    } catch (error) {
      log.error('存储适配器初始化失败', error);
      return false;
    }
  }

  /**
   * 检查用户是否已登录
   */
  isLoggedIn() {
    return this.userStore?.isLoggedIn || false;
  }

  /**
   * 获取数据
   * @param {string} category - 设置分类 (terminal, connection, ai, keyboard等)
   * @param {any} defaultValue - 默认值
   * @returns {Promise<any>} 数据
   */
  async get(category, defaultValue = null) {
    try {
      if (this.isLoggedIn()) {
        // 登录状态：只有当设置服务已从服务器成功加载该分类时，才使用聚合结果
        try {
          if (settingsService?.isInitialized && 
              settingsService?.hasServerSettings && 
              settingsService?.isCategoryLoaded?.(category)) {
            const aggregated = settingsService.settings?.[category];
            if (aggregated !== undefined) {
              log.debug(`从设置服务聚合结果获取 [${category}]`);
              return aggregated;
            }
          }
        } catch (_) {}

        // 从服务器获取
        // 禁用缓存，确保登录后拉取的是最新的用户配置
        log.debug(`从服务器获取设置 [${category}]`);
        const response = await apiService.get(
          `/users/settings?category=${category}`,
          {},
          { useCache: false }
        );

        if (response.success && response.data[category]) {
          return response.data[category].data;
        }

        return defaultValue;
      } else {
        // 未登录状态：遵循设计，只使用默认配置；仅UI从本地读取
        if (category === 'ui') {
          return storageService.getItem(`settings.${category}`, defaultValue);
        }
        return defaultValue;
      }
    } catch (error) {
      log.error(`获取设置失败 [${category}]:`, error);

      // 如果是网络错误且用户已登录，尝试从本地缓存获取
      if (this.isLoggedIn() && this.isNetworkError(error)) {
        log.warn(`网络错误，尝试从本地缓存获取设置 [${category}]`);
        return storageService.getItem(`cache.settings.${category}`, defaultValue);
      }

      return defaultValue;
    }
  }

  /**
   * 设置数据
   * @param {string} category - 设置分类
   * @param {any} data - 数据
   * @returns {Promise<boolean>} 是否成功
   */
  async set(category, data) {
    try {
      // UI设置保持本地化，不同步到服务器
      if (category === 'ui') {
        return true; // 直接返回成功，UI设置只保存在本地
      }

      if (this.isLoggedIn()) {
        // 登录状态：保存到服务器
        const response = await apiService.put('/users/settings', {
          category,
          data,
          clientTimestamp: new Date().toISOString()
        });

        if (response.success) {
          // 同时缓存到本地，用于离线时使用
          storageService.setItem(`cache.settings.${category}`, data);

          // 同步更新设置服务中的设置（但不包括UI设置，UI设置保持本地化）
          try {
            if (category !== 'ui' && settingsService.isInitialized) {
              Object.keys(data).forEach(key => {
                if (data[key] !== undefined) {
                  settingsService.set(`${category}.${key}`, data[key]);
                }
              });
              log.debug(`设置服务已同步更新 [${category}]`);
            }
          } catch (error) {
            log.warn(`同步设置服务失败 [${category}]:`, error);
          }

          log.debug(`设置已保存到服务器 [${category}]`);
          return true;
        }

        return false;
      } else {
        // 未登录状态：保存到本地存储
        const success = storageService.setItem(`settings.${category}`, data);
        if (success) {
          // 同步更新设置服务中的设置
          try {
            if (settingsService.isInitialized) {
              Object.keys(data).forEach(key => {
                if (data[key] !== undefined) {
                  settingsService.set(`${category}.${key}`, data[key]);
                }
              });
              log.debug(`设置服务已同步更新 [${category}]`);
            }
          } catch (error) {
            log.warn(`同步设置服务失败 [${category}]:`, error);
          }

          log.debug(`设置已保存到本地 [${category}]`);
        }
        return success;
      }
    } catch (error) {
      log.error(`保存设置失败 [${category}]:`, error);

      // 如果是网络错误且用户已登录，保存到本地作为备份
      if (this.isLoggedIn() && this.isNetworkError(error)) {
        log.warn(`网络错误，设置保存到本地备份 [${category}]`);
        return storageService.setItem(`backup.settings.${category}`, data);
      }

      return false;
    }
  }

  /**
   * 删除数据
   * @param {string} category - 设置分类
   * @returns {Promise<boolean>} 是否成功
   */
  async remove(category) {
    try {
      if (this.isLoggedIn()) {
        // 登录状态：从服务器删除
        const response = await apiService.delete(`/users/settings/${category}`);

        if (response.success) {
          // 同时删除本地缓存
          storageService.removeItem(`cache.settings.${category}`);
          log.debug(`设置已从服务器删除 [${category}]`);
          return true;
        }

        return false;
      } else {
        // 未登录状态：从本地存储删除
        const success = storageService.removeItem(`settings.${category}`);
        if (success) {
          log.debug(`设置已从本地删除 [${category}]`);
        }
        return success;
      }
    } catch (error) {
      log.error(`删除设置失败 [${category}]:`, error);
      return false;
    }
  }

  /**
   * 批量获取所有设置
   * @returns {Promise<Object>} 所有设置数据
   */
  // 已移除聚合获取：避免调用未使用的聚合接口 /users/settings

  /**
   * 清除所有设置
   * @returns {Promise<boolean>} 是否成功
   */
  async clear() {
    try {
      if (this.isLoggedIn()) {
        // 登录状态：逐类清除（避免使用聚合接口）
        const categories = ['terminal', 'connection', 'editor', 'advanced', 'monitoring', 'ai-config'];
        const results = await Promise.all(categories.map(category => this.remove(category)));
        return results.every(Boolean);
      } else {
        // 未登录状态：清除本地存储中的所有设置
        const allKeys = storageService.keys();
        const settingsKeys = allKeys.filter(key => key.startsWith('settings.'));

        for (const key of settingsKeys) {
          storageService.removeItem(key);
        }

        log.debug('本地设置已清除');
        return true;
      }
    } catch (error) {
      log.error('清除设置失败:', error);
      return false;
    }
  }

  /**
   * 检查是否为网络错误
   * @param {Error} error - 错误对象
   * @returns {boolean} 是否为网络错误
   */
  isNetworkError(error) {
    return (
      error.code === 'NETWORK_ERROR' ||
      error.message.includes('Network Error') ||
      error.message.includes('fetch')
    );
  }

  /**
   * 获取存储状态信息
   * @returns {Object} 存储状态
   */
  getStatus() {
    return {
      isLoggedIn: this.isLoggedIn(),
      storageMode: this.isLoggedIn() ? 'server' : 'local',
      initialized: this.initialized
    };
  }
}

// 创建单例实例
const storageAdapter = new StorageAdapter();

export default storageAdapter;
