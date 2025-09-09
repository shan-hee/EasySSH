/**
 * 存储服务模块 - 统一存储工具的服务封装
 * 提供应用级别的存储服务，基于统一的存储工具实现
 */
import log from './log';
import storageUtils from '../utils/storage.js';

class StorageService {
  constructor() {
    this.prefix = 'easyssh:';
    this.initialized = false;
    // 创建带前缀的存储实例
    this.prefixedStorage = storageUtils.createPrefixedStorage(this.prefix);
  }

  /**
   * 初始化存储服务
   * @returns {Promise<boolean>}
   */
  init() {
    if (this.initialized) {
      return Promise.resolve(true);
    }

    return storageUtils.init().then(success => {
      if (success) {
        this.initialized = true;
        // 存储服务初始化成功，但不输出日志，因为这是基础服务
        return true;
      } else {
        log.error('存储服务初始化失败');
        return false;
      }
    });
  }

  /**
   * 存储数据项
   * @param {string} key - 键名
   * @param {any} value - 值
   * @param {Object} options - 存储选项
   * @param {number} options.expiry - 过期时间(毫秒)
   */
  setItem(key, value, options = {}) {
    try {
      const storageOptions = {};
      if (options.expiry) {
        storageOptions.expiration = options.expiry;
      }

      return this.prefixedStorage.set(key, value, storageOptions);
    } catch (error) {
      log.error('存储数据失败', { key, error });
      return false;
    }
  }

  /**
   * 获取数据项
   * @param {string} key - 键名
   * @param {any} defaultValue - 默认值
   * @returns {any} - 存储的值或默认值
   */
  getItem(key, defaultValue = null) {
    try {
      return this.prefixedStorage.get(key, defaultValue);
    } catch (error) {
      log.error('获取数据失败', { key, error });
      return defaultValue;
    }
  }

  /**
   * 移除数据项
   * @param {string} key - 键名
   */
  removeItem(key) {
    try {
      return this.prefixedStorage.remove(key);
    } catch (error) {
      log.error('移除数据失败', { key, error });
      return false;
    }
  }

  /**
   * 清空所有数据
   * @param {boolean} clearAll - 是否清除所有数据(包括非本应用)
   */
  clear(clearAll = false) {
    try {
      if (clearAll) {
        return storageUtils.clearStorage();
      } else {
        return this.prefixedStorage.clear();
      }
    } catch (error) {
      log.error('清空存储失败', { clearAll, error });
      return false;
    }
  }

  /**
   * 获取存储中的所有键
   * @returns {Array<string>} - 键名数组
   */
  keys() {
    try {
      return this.prefixedStorage.keys();
    } catch (error) {
      log.error('获取存储键失败', { error });
      return [];
    }
  }

  /**
   * 检查键是否存在
   * @param {string} key - 键名
   * @returns {boolean} - 是否存在
   */
  hasItem(key) {
    try {
      return this.prefixedStorage.has(key);
    } catch (error) {
      log.error('检查键存在失败', { key, error });
      return false;
    }
  }

  /**
   * 获取存储信息
   * @returns {Object} - 存储使用情况
   */
  getStorageInfo() {
    try {
      return storageUtils.getStorageInfo();
    } catch (error) {
      log.error('获取存储信息失败', { error });
      return null;
    }
  }

  /**
   * 清理过期项
   * @returns {number} - 清理的项目数量
   */
  cleanupExpiredItems() {
    try {
      return storageUtils.cleanupExpiredItems();
    } catch (error) {
      log.error('清理过期项失败', { error });
      return 0;
    }
  }
}

// 创建单例实例
const storageService = new StorageService();

export default storageService;
