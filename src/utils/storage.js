/**
 * 统一本地存储工具
 * 提供统一的本地存储接口，支持过期时间、数据验证、前缀管理和内存缓存
 * 整合了原有的多个存储工具实现
 */

// 默认缓存配置 - 统一配置参数
const CACHE_CONFIG = {
  defaultExpiration: 7 * 24 * 60 * 60 * 1000, // 7天（保持较长的默认过期时间）
  maxSize: 5 * 1024 * 1024, // 5MB
  cleanupInterval: 30 * 60 * 1000, // 30分钟清理一次（提高清理频率）
  prefix: 'easyssh:', // 默认前缀
  enableMemoryCache: true // 是否启用内存缓存
};

// 内存缓存
const memoryCache = new Map();

// 清理定时器
let cleanupTimer = null;

// 初始化状态
let isInitialized = false;

/**
 * 初始化存储工具
 * @returns {Promise<boolean>} 是否初始化成功
 */
export function initStorage() {
  return new Promise(resolve => {
    if (isInitialized) {
      return resolve(true);
    }

    try {
      // 测试localStorage可用性
      const testKey = '__storage_test__';
      localStorage.setItem(testKey, testKey);
      localStorage.removeItem(testKey);

      // 启动清理定时器
      startCleanupTimer();

      isInitialized = true;
      resolve(true);
    } catch (e) {
      console.error('存储工具初始化失败:', e);
      resolve(false);
    }
  });
}

/**
 * 获取带前缀的键名
 * @param {string} key 原始键名
 * @param {string} prefix 前缀（可选）
 * @returns {string} 带前缀的键名
 */
function getPrefixedKey(key, prefix = CACHE_CONFIG.prefix) {
  return prefix ? `${prefix}${key}` : key;
}

/**
 * 从本地存储获取数据
 * @param {string} key 存储键名
 * @param {any} defaultValue 默认值
 * @param {Object} options 选项
 * @param {boolean} options.usePrefix 是否使用前缀
 * @param {string} options.prefix 自定义前缀
 * @returns {any} 存储的数据或默认值
 */
export function getFromStorage(key, defaultValue = null, options = {}) {
  try {
    const { usePrefix = true, prefix } = options;
    const finalKey = usePrefix ? getPrefixedKey(key, prefix) : key;

    // 先从内存缓存获取（如果启用）
    if (CACHE_CONFIG.enableMemoryCache && memoryCache.has(finalKey)) {
      const cached = memoryCache.get(finalKey);
      if (cached.expiration > Date.now()) {
        return cached.value;
      } else {
        // 过期了，删除缓存
        memoryCache.delete(finalKey);
      }
    }

    // 从localStorage获取
    const item = localStorage.getItem(finalKey);
    if (!item) {
      return defaultValue;
    }

    // 解析存储项
    const storageItem = JSON.parse(item);

    // 检查是否过期
    if (storageItem.expiration && storageItem.expiration < Date.now()) {
      localStorage.removeItem(finalKey);
      return defaultValue;
    }

    // 更新内存缓存（如果启用）
    if (CACHE_CONFIG.enableMemoryCache) {
      memoryCache.set(finalKey, storageItem);
    }

    return storageItem.value;
  } catch (error) {
    console.error(`获取存储数据失败 [${key}]:`, error);
    return defaultValue;
  }
}

/**
 * 保存数据到本地存储
 * @param {string} key 存储键名
 * @param {any} value 要存储的数据，将自动进行JSON序列化
 * @param {Object} options 存储选项
 * @param {number} options.expiration 过期时间（毫秒）
 * @param {boolean} options.usePrefix 是否使用前缀
 * @param {string} options.prefix 自定义前缀
 */
export function saveToStorage(key, value, options = {}) {
  try {
    const { expiration = CACHE_CONFIG.defaultExpiration, usePrefix = true, prefix } = options;
    const finalKey = usePrefix ? getPrefixedKey(key, prefix) : key;
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
    localStorage.setItem(finalKey, serializedValue);

    // 同时更新内存缓存（如果启用）
    if (CACHE_CONFIG.enableMemoryCache) {
      memoryCache.set(finalKey, storageItem);
    }

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
 * 从本地存储删除数据
 * @param {string} key 存储键名
 * @param {Object} options 选项
 * @param {boolean} options.usePrefix 是否使用前缀
 * @param {string} options.prefix 自定义前缀
 */
export function removeFromStorage(key, options = {}) {
  try {
    const { usePrefix = true, prefix } = options;
    const finalKey = usePrefix ? getPrefixedKey(key, prefix) : key;

    localStorage.removeItem(finalKey);
    if (CACHE_CONFIG.enableMemoryCache) {
      memoryCache.delete(finalKey);
    }
    return true;
  } catch (error) {
    console.error(`删除存储数据失败 [${key}]:`, error);
    return false;
  }
}

/**
 * 清空所有存储数据
 * @param {Object} options 选项
 * @param {boolean} options.onlyPrefixed 是否只清理带前缀的数据
 * @param {string} options.prefix 自定义前缀
 */
export function clearStorage(options = {}) {
  try {
    const { onlyPrefixed = false, prefix = CACHE_CONFIG.prefix } = options;

    if (onlyPrefixed) {
      // 只清理带指定前缀的数据
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prefix)) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach(key => {
        localStorage.removeItem(key);
        if (CACHE_CONFIG.enableMemoryCache) {
          memoryCache.delete(key);
        }
      });
    } else {
      // 清空所有数据
      localStorage.clear();
      if (CACHE_CONFIG.enableMemoryCache) {
        memoryCache.clear();
      }
    }

    return true;
  } catch (error) {
    console.error('清空存储失败:', error);
    return false;
  }
}

/**
 * 获取存储使用情况
 */
export function getStorageInfo() {
  try {
    let totalSize = 0;
    let itemCount = 0;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const value = localStorage.getItem(key);
      if (value) {
        totalSize += value.length;
        itemCount++;
      }
    }

    return {
      itemCount,
      totalSize,
      totalSizeKB: Math.round(totalSize / 1024),
      maxSize: CACHE_CONFIG.maxSize,
      usagePercent: Math.round((totalSize / CACHE_CONFIG.maxSize) * 100)
    };
  } catch (error) {
    console.error('获取存储信息失败:', error);
    return null;
  }
}

/**
 * 清理过期的存储项
 */
export function cleanupExpiredItems() {
  try {
    const now = Date.now();
    const keysToRemove = [];

    // 检查localStorage中的过期项
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      try {
        const item = localStorage.getItem(key);
        if (item) {
          const storageItem = JSON.parse(item);
          if (storageItem.expiration && storageItem.expiration < now) {
            keysToRemove.push(key);
          }
        }
      } catch (parseError) {
        // 如果解析失败，可能是非标准格式的数据，跳过
        continue;
      }
    }

    // 删除过期项
    keysToRemove.forEach(key => {
      localStorage.removeItem(key);
      memoryCache.delete(key);
    });

    // 清理内存缓存中的过期项
    for (const [key, item] of memoryCache.entries()) {
      if (item.expiration < now) {
        memoryCache.delete(key);
      }
    }

    console.log(`清理了 ${keysToRemove.length} 个过期存储项`);
    return keysToRemove.length;
  } catch (error) {
    console.error('清理过期存储项失败:', error);
    return 0;
  }
}

/**
 * 启动自动清理定时器
 */
function startCleanupTimer() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
  }

  cleanupTimer = setInterval(() => {
    cleanupExpiredItems();
  }, CACHE_CONFIG.cleanupInterval);
}

/**
 * 停止自动清理定时器
 */
export function stopCleanupTimer() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

/**
 * 检查键是否存在且未过期
 * @param {string} key 存储键名
 * @param {Object} options 选项
 * @param {boolean} options.usePrefix 是否使用前缀
 * @param {string} options.prefix 自定义前缀
 */
export function hasValidKey(key, options = {}) {
  try {
    const { usePrefix = true, prefix } = options;
    const finalKey = usePrefix ? getPrefixedKey(key, prefix) : key;

    const item = localStorage.getItem(finalKey);
    if (!item) return false;

    const storageItem = JSON.parse(item);
    return !storageItem.expiration || storageItem.expiration > Date.now();
  } catch (error) {
    return false;
  }
}

/**
 * 获取所有存储的键名
 * @param {Object} options 选项
 * @param {boolean} options.onlyPrefixed 是否只返回带前缀的键名
 * @param {string} options.prefix 自定义前缀
 * @param {boolean} options.stripPrefix 是否去除前缀返回
 */
export function getAllKeys(options = {}) {
  try {
    const { onlyPrefixed = false, prefix = CACHE_CONFIG.prefix, stripPrefix = false } = options;
    const keys = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        if (onlyPrefixed) {
          if (key.startsWith(prefix)) {
            keys.push(stripPrefix ? key.substring(prefix.length) : key);
          }
        } else {
          keys.push(key);
        }
      }
    }
    return keys;
  } catch (error) {
    console.error('获取存储键名失败:', error);
    return [];
  }
}

/**
 * 创建带前缀的存储实例
 * @param {string} prefix 前缀
 * @returns {Object} 存储实例
 */
export function createPrefixedStorage(prefix) {
  return {
    get: (key, defaultValue) => getFromStorage(key, defaultValue, { prefix }),
    set: (key, value, options = {}) => saveToStorage(key, value, { ...options, prefix }),
    remove: key => removeFromStorage(key, { prefix }),
    clear: () => clearStorage({ onlyPrefixed: true, prefix }),
    has: key => hasValidKey(key, { prefix }),
    keys: () => getAllKeys({ onlyPrefixed: true, prefix, stripPrefix: true })
  };
}

// 页面加载时自动初始化（如果在浏览器环境）
if (typeof window !== 'undefined') {
  initStorage().then(success => {
    if (!success) {
      console.warn('存储工具初始化失败，某些功能可能不可用');
    }
  });

  // 页面卸载时停止定时器
  window.addEventListener('beforeunload', stopCleanupTimer);
}

// 默认导出对象，保持向后兼容
export default {
  // 核心方法
  init: initStorage,
  getFromStorage,
  saveToStorage,
  removeFromStorage,
  clearStorage,

  // 工具方法
  getStorageInfo,
  cleanupExpiredItems,
  stopCleanupTimer,
  hasValidKey,
  getAllKeys,

  // 高级功能
  createPrefixedStorage,

  // 配置
  config: CACHE_CONFIG
};
