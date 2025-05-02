/**
 * 本地存储工具模块
 * 提供对localStorage的封装，支持JSON数据自动序列化和反序列化
 * 增加缓存管理和性能优化功能
 */

// 内存缓存，避免频繁读取localStorage
const memoryCache = new Map();

// 缓存配置
const CACHE_CONFIG = {
  // 默认缓存过期时间（毫秒）
  defaultExpiration: 24 * 60 * 60 * 1000, // 24小时
  // 定期清理周期
  cleanupInterval: 30 * 60 * 1000, // 30分钟
};

// 设置定时器清理过期缓存
let cleanupTimer = null;

/**
 * 保存数据到本地存储
 * @param {string} key 存储键名
 * @param {any} value 要存储的数据，将自动进行JSON序列化
 * @param {Object} options 存储选项
 * @param {number} options.expiration 过期时间（毫秒）
 */
export function saveToStorage(key, value, options = {}) {
  try {
    const expiration = options.expiration || CACHE_CONFIG.defaultExpiration;
    const now = Date.now();
    
    // 创建存储对象，包含值、时间戳和过期时间
    const storageItem = {
      value,
      timestamp: now,
      expiration: now + expiration
    };
    
    // 对对象和数组进行序列化
    const serializedValue = JSON.stringify(storageItem);
    
    // 保存到localStorage
    localStorage.setItem(key, serializedValue);
    
    // 同时更新内存缓存
    memoryCache.set(key, storageItem);
    
    // 启动自动清理定时器（如果尚未启动）
    if (!cleanupTimer) {
      startCleanupTimer();
    }
    
    return true;
  } catch (error) {
    console.error(`存储数据失败 [${key}]:`, error);
    
    // 如果localStorage已满，尝试清理过期数据后重新尝试
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      cleanupExpiredItems();
      try {
        return saveToStorage(key, value, options);
      } catch (retryError) {
        console.error(`重试存储失败 [${key}]:`, retryError);
      }
    }
    
    return false;
  }
}

/**
 * 从本地存储获取数据
 * @param {string} key 存储键名
 * @param {any} defaultValue 如果值不存在时的默认值
 * @returns {any} 存储的数据，已自动进行JSON反序列化
 */
export function getFromStorage(key, defaultValue = null) {
  try {
    // 首先检查内存缓存
    if (memoryCache.has(key)) {
      const cachedItem = memoryCache.get(key);
      
      // 检查是否过期
      if (cachedItem.expiration > Date.now()) {
        return cachedItem.value;
      } else {
        // 如果已过期，从缓存和存储中移除
        memoryCache.delete(key);
        localStorage.removeItem(key);
        return defaultValue;
      }
    }
    
    // 内存缓存中没有，从localStorage获取
    const value = localStorage.getItem(key);
    
    // 如果不存在，返回默认值
    if (value === null) return defaultValue;
    
    // 尝试解析JSON
    try {
      const parsedItem = JSON.parse(value);
      
      // 检查是否是我们的存储格式
      if (parsedItem && typeof parsedItem === 'object' && 'value' in parsedItem) {
        // 检查是否过期
        if (parsedItem.expiration > Date.now()) {
          // 更新内存缓存
          memoryCache.set(key, parsedItem);
          return parsedItem.value;
        } else {
          // 如果已过期，删除
          localStorage.removeItem(key);
          return defaultValue;
        }
      }
      
      // 如果不是我们的格式，可能是老数据，直接返回
      return parsedItem;
    } catch (e) {
      // 如果不是有效的JSON，则直接返回原始值
      return value;
    }
  } catch (error) {
    console.error(`获取存储数据失败 [${key}]:`, error);
    return defaultValue;
  }
}

/**
 * 从本地存储删除数据
 * @param {string} key 存储键名
 */
export function removeFromStorage(key) {
  try {
    // 同时从localStorage和内存缓存中删除
    localStorage.removeItem(key);
    memoryCache.delete(key);
    return true;
  } catch (error) {
    console.error(`删除存储数据失败 [${key}]:`, error);
    return false;
  }
}

/**
 * 清空所有本地存储数据
 */
export function clearStorage() {
  try {
    localStorage.clear();
    memoryCache.clear();
    return true;
  } catch (error) {
    console.error('清空存储数据失败:', error);
    return false;
  }
}

/**
 * 获取所有存储的键名
 * @returns {Array<string>} 键名数组
 */
export function getStorageKeys() {
  try {
    return Object.keys(localStorage);
  } catch (error) {
    console.error('获取存储键名失败:', error);
    return [];
  }
}

/**
 * 检查存储项是否存在且未过期
 * @param {string} key 存储键名
 * @returns {boolean} 是否存在且未过期
 */
export function hasStorageItem(key) {
  // 首先检查内存缓存
  if (memoryCache.has(key)) {
    return memoryCache.get(key).expiration > Date.now();
  }
  
  // 检查localStorage
  const item = localStorage.getItem(key);
  if (item === null) return false;
  
  try {
    const parsedItem = JSON.parse(item);
    if (parsedItem && typeof parsedItem === 'object' && 'expiration' in parsedItem) {
      return parsedItem.expiration > Date.now();
    }
    return true; // 如果是旧格式数据，认为有效
  } catch (e) {
    return true; // 解析失败，认为有效
  }
}

/**
 * 获取存储使用情况
 * @returns {Object} 包含使用的字节数和总容量的对象
 */
export function getStorageUsage() {
  try {
    let totalSize = 0;
    
    // 计算所有项的大小
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const value = localStorage.getItem(key);
      totalSize += (key.length + value.length) * 2; // UTF-16字符占用2字节
    }
    
    // 估计总容量（通常为5MB）
    const totalCapacity = 5 * 1024 * 1024;
    
    return {
      used: totalSize,
      total: totalCapacity,
      percentage: Math.round((totalSize / totalCapacity) * 100)
    };
  } catch (error) {
    console.error('获取存储使用情况失败:', error);
    return { used: 0, total: 0, percentage: 0 };
  }
}

/**
 * 清理所有过期的存储项
 * @returns {number} 清理的项目数量
 */
export function cleanupExpiredItems() {
  try {
    let count = 0;
    const now = Date.now();
    
    // 从localStorage中获取所有键
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const value = localStorage.getItem(key);
      
      try {
        const parsedItem = JSON.parse(value);
        if (parsedItem && typeof parsedItem === 'object' && 'expiration' in parsedItem) {
          if (parsedItem.expiration < now) {
            localStorage.removeItem(key);
            memoryCache.delete(key);
            count++;
          }
        }
      } catch (e) {
        // 忽略非JSON格式的项
      }
    }
    
    // 同时清理内存缓存中的过期项
    memoryCache.forEach((item, key) => {
      if (item.expiration < now) {
        memoryCache.delete(key);
      }
    });
    
    return count;
  } catch (error) {
    console.error('清理过期项目失败:', error);
    return 0;
  }
}

/**
 * 启动自动清理定时器
 */
function startCleanupTimer() {
  cleanupTimer = setInterval(() => {
    const cleanedCount = cleanupExpiredItems();
    if (cleanedCount > 0) {
      console.log(`自动清理了 ${cleanedCount} 个过期存储项`);
    }
  }, CACHE_CONFIG.cleanupInterval);
  
  // 确保在页面卸载时清理定时器
  window.addEventListener('beforeunload', () => {
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  });
}

// 页面加载时，初始化内存缓存
function initializeCache() {
  try {
    // 遍历localStorage中的所有项目
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const value = localStorage.getItem(key);
      
      try {
        const parsedItem = JSON.parse(value);
        // 如果是我们的存储格式且未过期，添加到内存缓存
        if (parsedItem && typeof parsedItem === 'object' && 'value' in parsedItem) {
          if (parsedItem.expiration > Date.now()) {
            memoryCache.set(key, parsedItem);
          } else {
            // 如果已过期，删除
            localStorage.removeItem(key);
          }
        }
      } catch (e) {
        // 忽略非JSON格式的项
      }
    }
  } catch (error) {
    console.error('初始化缓存失败:', error);
  }
  
  // 启动清理定时器
  startCleanupTimer();
}

// 页面加载时初始化缓存
if (typeof window !== 'undefined') {
  initializeCache();
}

export default {
  saveToStorage,
  getFromStorage,
  removeFromStorage,
  clearStorage,
  getStorageKeys,
  hasStorageItem,
  getStorageUsage,
  cleanupExpiredItems
};
