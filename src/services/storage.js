/**
 * 存储服务模块，负责应用数据的本地存储与检索
 */
import log from './log';

class StorageService {
  constructor() {
    this.prefix = 'easyssh:'
    this.isReady = false
    this.memoryCache = new Map() // 内存缓存
    this.initialized = false;
  }
  
  /**
   * 初始化存储服务
   * @returns {Promise<boolean>}
   */
  init() {
    return new Promise((resolve) => {
      if (this.initialized) {
        return resolve(true);
      }

      try {
        // 对localStorage进行测试以确保可用
        const testKey = '__storage_test__';
        localStorage.setItem(testKey, testKey);
        localStorage.removeItem(testKey);

        this.initialized = true;
        // 存储服务初始化成功，但不输出日志，因为这是基础服务
        resolve(true);
      } catch (e) {
        log.error('存储服务初始化失败', e);
        resolve(false);
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
    const prefixedKey = this._getPrefixedKey(key)
    
    try {
      let storageValue = value
      
      // 如果值不是字符串，进行序列化
      if (typeof value !== 'string') {
        storageValue = JSON.stringify({
          data: value,
          meta: {
            type: typeof value,
            expiry: options.expiry ? Date.now() + options.expiry : null,
            createdAt: Date.now()
          }
        })
      }
      
      // 存储到localStorage
      localStorage.setItem(prefixedKey, storageValue)
      
      // 同时更新内存缓存
      this.memoryCache.set(prefixedKey, value)
    } catch (error) {
      console.error(`存储数据失败[${prefixedKey}]:`, error)
      
      // 降级到内存存储
      this.memoryCache.set(prefixedKey, value)
    }
  }
  
  /**
   * 获取数据项
   * @param {string} key - 键名
   * @param {any} defaultValue - 默认值
   * @returns {any} - 存储的值或默认值
   */
  getItem(key, defaultValue = null) {
    const prefixedKey = this._getPrefixedKey(key)
    
    try {
      // 先尝试从localStorage获取
      const value = localStorage.getItem(prefixedKey)
      
      if (value === null) {
        return defaultValue
      }
      
      try {
        // 尝试解析为JSON
        const parsed = JSON.parse(value)
        
        // 检查是否是我们存储的格式
        if (parsed && parsed.meta) {
          // 检查是否已过期
          if (parsed.meta.expiry && parsed.meta.expiry < Date.now()) {
            // 已过期，删除并返回默认值
            this.removeItem(key)
            return defaultValue
          }
          
          // 返回实际数据
          return parsed.data
        }
        
        // 如果不是我们存储的格式，直接返回解析后的值
        return parsed
      } catch (e) {
        // 如果无法解析为JSON，说明是普通字符串
        return value
      }
    } catch (error) {
      console.error(`获取数据失败[${prefixedKey}]:`, error)
      
      // 尝试从内存缓存获取
      if (this.memoryCache.has(prefixedKey)) {
        return this.memoryCache.get(prefixedKey)
      }
      
      return defaultValue
    }
  }
  
  /**
   * 移除数据项
   * @param {string} key - 键名
   */
  removeItem(key) {
    const prefixedKey = this._getPrefixedKey(key)
    
    try {
      // 从localStorage移除
      localStorage.removeItem(prefixedKey)
    } catch (error) {
      console.error(`移除数据失败[${prefixedKey}]:`, error)
    }
    
    // 从内存缓存移除
    this.memoryCache.delete(prefixedKey)
  }
  
  /**
   * 清空所有数据
   * @param {boolean} clearAll - 是否清除所有数据(包括非本应用)
   */
  clear(clearAll = false) {
    try {
      if (clearAll) {
        // 清除所有localStorage数据
        localStorage.clear()
        this.memoryCache.clear()
      } else {
        // 只清除本应用的数据
        const keysToRemove = []
        
        // 找出所有以前缀开头的键
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key && key.startsWith(this.prefix)) {
            keysToRemove.push(key)
          }
        }
        
        // 移除找到的键
        keysToRemove.forEach(key => {
          localStorage.removeItem(key)
        })
        
        // 清空内存缓存
        this.memoryCache.clear()
      }
    } catch (error) {
      console.error('清空存储失败:', error)
    }
  }
  
  /**
   * 获取存储中的所有键
   * @returns {Array<string>} - 键名数组
   */
  keys() {
    const keys = []
    
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && key.startsWith(this.prefix)) {
          // 移除前缀并添加到结果
          keys.push(key.substring(this.prefix.length))
        }
      }
    } catch (error) {
      console.error('获取存储键失败:', error)
    }
    
    return keys
  }
  
  /**
   * 获取指定键的过期时间
   * @param {string} key - 键名
   * @returns {number|null} - 过期时间戳或null(如果不存在或无过期时间)
   */
  getExpiry(key) {
    const prefixedKey = this._getPrefixedKey(key)
    
    try {
      const value = localStorage.getItem(prefixedKey)
      
      if (!value) {
        return null
      }
      
      try {
        const parsed = JSON.parse(value)
        if (parsed && parsed.meta && parsed.meta.expiry) {
          return parsed.meta.expiry
        }
      } catch (e) {
        // 如果无法解析，则没有过期时间
      }
    } catch (error) {
      console.error(`获取过期时间失败[${prefixedKey}]:`, error)
    }
    
    return null
  }
  
  /**
   * 更新数据项的过期时间
   * @param {string} key - 键名
   * @param {number} expiry - 新的过期时间(毫秒)
   * @returns {boolean} - 是否成功更新
   */
  updateExpiry(key, expiry) {
    const prefixedKey = this._getPrefixedKey(key)
    
    try {
      const value = localStorage.getItem(prefixedKey)
      
      if (!value) {
        return false
      }
      
      try {
        const parsed = JSON.parse(value)
        if (parsed && parsed.meta) {
          // 更新过期时间
          parsed.meta.expiry = expiry ? Date.now() + expiry : null
          
          // 保存回localStorage
          localStorage.setItem(prefixedKey, JSON.stringify(parsed))
          return true
        }
      } catch (e) {
        // 如果无法解析，则不能更新过期时间
        return false
      }
    } catch (error) {
      console.error(`更新过期时间失败[${prefixedKey}]:`, error)
    }
    
    return false
  }
  
  /**
   * 检查键是否存在
   * @param {string} key - 键名
   * @returns {boolean} - 是否存在
   */
  hasItem(key) {
    const prefixedKey = this._getPrefixedKey(key)
    
    try {
      const value = localStorage.getItem(prefixedKey)
      
      if (value !== null) {
        // 检查是否已过期
        try {
          const parsed = JSON.parse(value)
          if (parsed && parsed.meta && parsed.meta.expiry) {
            if (parsed.meta.expiry < Date.now()) {
              // 已过期，删除并返回false
              this.removeItem(key)
              return false
            }
          }
        } catch (e) {
          // 如果无法解析为JSON，说明是普通字符串
        }
        
        return true
      }
    } catch (error) {
      console.error(`检查键存在失败[${prefixedKey}]:`, error)
      
      // 检查内存缓存
      return this.memoryCache.has(prefixedKey)
    }
    
    return false
  }
  
  /**
   * 获取前缀化的键名
   * @param {string} key - 原始键名
   * @returns {string} - 前缀化的键名
   * @private
   */
  _getPrefixedKey(key) {
    return `${this.prefix}${key}`
  }
}

// 创建单例实例
const storageService = new StorageService()

export default storageService 