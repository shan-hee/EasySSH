/**
 * 本地存储工具
 * 提供统一的本地存储接口，支持过期时间和数据验证
 */

// 默认缓存配置
const CACHE_CONFIG = {
  defaultExpiration: 7 * 24 * 60 * 60 * 1000, // 7天
  maxSize: 5 * 1024 * 1024, // 5MB
  cleanupInterval: 60 * 60 * 1000 // 1小时清理一次
}

// 内存缓存
const memoryCache = new Map()

// 清理定时器
let cleanupTimer = null

/**
 * 从本地存储获取数据
 * @param {string} key 存储键名
 * @param {any} defaultValue 默认值
 * @returns {any} 存储的数据或默认值
 */
export function getFromStorage(key, defaultValue = null) {
  try {
    // 先从内存缓存获取
    if (memoryCache.has(key)) {
      const cached = memoryCache.get(key)
      if (cached.expiration > Date.now()) {
        return cached.value
      } else {
        // 过期了，删除缓存
        memoryCache.delete(key)
      }
    }

    // 从localStorage获取
    const item = localStorage.getItem(key)
    if (!item) {
      return defaultValue
    }

    // 解析存储项
    const storageItem = JSON.parse(item)
    
    // 检查是否过期
    if (storageItem.expiration && storageItem.expiration < Date.now()) {
      localStorage.removeItem(key)
      return defaultValue
    }

    // 更新内存缓存
    memoryCache.set(key, storageItem)
    
    return storageItem.value
  } catch (error) {
    console.error(`获取存储数据失败 [${key}]:`, error)
    return defaultValue
  }
}

/**
 * 保存数据到本地存储
 * @param {string} key 存储键名
 * @param {any} value 要存储的数据，将自动进行JSON序列化
 * @param {Object} options 存储选项
 * @param {number} options.expiration 过期时间（毫秒）
 */
export function saveToStorage(key, value, options = {}) {
  try {
    const expiration = options.expiration || CACHE_CONFIG.defaultExpiration
    const now = Date.now()
    
    // 创建存储对象，包含值、时间戳和过期时间
    const storageItem = {
      value,
      timestamp: now,
      expiration: now + expiration
    }
    
    // 对对象和数组进行序列化
    const serializedValue = JSON.stringify(storageItem)
    
    // 保存到localStorage
    localStorage.setItem(key, serializedValue)
    
    // 同时更新内存缓存
    memoryCache.set(key, storageItem)
    
    // 启动自动清理定时器（如果尚未启动）
    if (!cleanupTimer) {
      startCleanupTimer()
    }
    
    return true
  } catch (error) {
    console.error(`存储数据失败 [${key}]:`, error)
    
    // 如果localStorage已满，尝试清理过期数据后重新尝试
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      cleanupExpiredItems()
      try {
        return saveToStorage(key, value, options)
      } catch (retryError) {
        console.error(`重试存储失败 [${key}]:`, retryError)
      }
    }
    
    return false
  }
}

/**
 * 从本地存储删除数据
 * @param {string} key 存储键名
 */
export function removeFromStorage(key) {
  try {
    localStorage.removeItem(key)
    memoryCache.delete(key)
    return true
  } catch (error) {
    console.error(`删除存储数据失败 [${key}]:`, error)
    return false
  }
}

/**
 * 清空所有存储数据
 */
export function clearStorage() {
  try {
    localStorage.clear()
    memoryCache.clear()
    return true
  } catch (error) {
    console.error('清空存储失败:', error)
    return false
  }
}

/**
 * 获取存储使用情况
 */
export function getStorageInfo() {
  try {
    let totalSize = 0
    let itemCount = 0
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      const value = localStorage.getItem(key)
      if (value) {
        totalSize += value.length
        itemCount++
      }
    }
    
    return {
      itemCount,
      totalSize,
      totalSizeKB: Math.round(totalSize / 1024),
      maxSize: CACHE_CONFIG.maxSize,
      usagePercent: Math.round((totalSize / CACHE_CONFIG.maxSize) * 100)
    }
  } catch (error) {
    console.error('获取存储信息失败:', error)
    return null
  }
}

/**
 * 清理过期的存储项
 */
export function cleanupExpiredItems() {
  try {
    const now = Date.now()
    const keysToRemove = []
    
    // 检查localStorage中的过期项
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      try {
        const item = localStorage.getItem(key)
        if (item) {
          const storageItem = JSON.parse(item)
          if (storageItem.expiration && storageItem.expiration < now) {
            keysToRemove.push(key)
          }
        }
      } catch (parseError) {
        // 如果解析失败，可能是非标准格式的数据，跳过
        continue
      }
    }
    
    // 删除过期项
    keysToRemove.forEach(key => {
      localStorage.removeItem(key)
      memoryCache.delete(key)
    })
    
    // 清理内存缓存中的过期项
    for (const [key, item] of memoryCache.entries()) {
      if (item.expiration < now) {
        memoryCache.delete(key)
      }
    }
    
    console.log(`清理了 ${keysToRemove.length} 个过期存储项`)
    return keysToRemove.length
  } catch (error) {
    console.error('清理过期存储项失败:', error)
    return 0
  }
}

/**
 * 启动自动清理定时器
 */
function startCleanupTimer() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer)
  }
  
  cleanupTimer = setInterval(() => {
    cleanupExpiredItems()
  }, CACHE_CONFIG.cleanupInterval)
}

/**
 * 停止自动清理定时器
 */
export function stopCleanupTimer() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
  }
}

/**
 * 检查键是否存在且未过期
 * @param {string} key 存储键名
 */
export function hasValidKey(key) {
  try {
    const item = localStorage.getItem(key)
    if (!item) return false
    
    const storageItem = JSON.parse(item)
    return !storageItem.expiration || storageItem.expiration > Date.now()
  } catch (error) {
    return false
  }
}

/**
 * 获取所有存储的键名
 */
export function getAllKeys() {
  try {
    const keys = []
    for (let i = 0; i < localStorage.length; i++) {
      keys.push(localStorage.key(i))
    }
    return keys
  } catch (error) {
    console.error('获取存储键名失败:', error)
    return []
  }
}

// 页面加载时启动清理定时器
if (typeof window !== 'undefined') {
  startCleanupTimer()
  
  // 页面卸载时停止定时器
  window.addEventListener('beforeunload', stopCleanupTimer)
}

export default {
  getFromStorage,
  saveToStorage,
  removeFromStorage,
  clearStorage,
  getStorageInfo,
  cleanupExpiredItems,
  stopCleanupTimer,
  hasValidKey,
  getAllKeys
}
