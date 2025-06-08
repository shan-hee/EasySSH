/**
 * 缓存管理器
 * 提供多层缓存、过期策略、LRU淘汰等功能
 */
import log from '../services/log'
import { cacheConfig } from '../config/app-config'

/**
 * LRU缓存实现
 */
class LRUCache {
  constructor(maxSize = 100) {
    this.maxSize = maxSize
    this.cache = new Map()
  }

  get(key) {
    if (this.cache.has(key)) {
      // 移动到最后（最近使用）
      const value = this.cache.get(key)
      this.cache.delete(key)
      this.cache.set(key, value)
      return value
    }
    return undefined
  }

  set(key, value) {
    if (this.cache.has(key)) {
      // 更新现有项
      this.cache.delete(key)
    } else if (this.cache.size >= this.maxSize) {
      // 删除最久未使用的项
      const firstKey = this.cache.keys().next().value
      this.cache.delete(firstKey)
    }
    
    this.cache.set(key, value)
  }

  has(key) {
    return this.cache.has(key)
  }

  delete(key) {
    return this.cache.delete(key)
  }

  clear() {
    this.cache.clear()
  }

  get size() {
    return this.cache.size
  }

  entries() {
    return this.cache.entries()
  }
}

/**
 * 缓存项包装器
 */
class CacheItem {
  constructor(data, options = {}) {
    this.data = data
    this.timestamp = Date.now()
    this.ttl = options.ttl || 30 * 60 * 1000 // 默认30分钟
    this.staleWhileRevalidate = options.staleWhileRevalidate || 10 * 60 * 1000 // 默认10分钟
    this.tags = options.tags || []
    this.metadata = options.metadata || {}
  }

  isValid() {
    return Date.now() - this.timestamp < this.ttl
  }

  isStale() {
    const age = Date.now() - this.timestamp
    return age > this.ttl && age < this.ttl + this.staleWhileRevalidate
  }

  isExpired() {
    return Date.now() - this.timestamp > this.ttl + this.staleWhileRevalidate
  }

  getAge() {
    return Date.now() - this.timestamp
  }
}

/**
 * 混合缓存管理器
 */
class HybridCacheManager {
  constructor(options = {}) {
    // 合并默认配置、全局配置和传入选项
    this.options = {
      memoryMaxSize: options.memoryMaxSize || cacheConfig.memory.maxSize || 100,
      defaultTTL: options.defaultTTL || cacheConfig.memory.ttl || 30 * 60 * 1000,
      staleWhileRevalidate: options.staleWhileRevalidate || cacheConfig.memory.staleWhileRevalidate || 10 * 60 * 1000,
      cleanupInterval: options.cleanupInterval || cacheConfig.memory.cleanupInterval || 5 * 60 * 1000,
      storagePrefix: options.storagePrefix || cacheConfig.storage.prefix || 'cache',
      ...options
    }

    // L1: 内存缓存 (LRU)
    this.memoryCache = new LRUCache(this.options.memoryMaxSize)
    
    // L2: 持久化缓存标识
    this.persistentKeys = new Set()
    
    // 清理定时器
    this.cleanupTimer = null
    this.setupCleanup()

    // 统计信息
    this.stats = {
      hits: 0,
      misses: 0,
      memoryHits: 0,
      persistentHits: 0,
      evictions: 0
    }
  }

  /**
   * 获取缓存项
   */
  async get(key) {
    // L1: 检查内存缓存
    const memoryItem = this.memoryCache.get(key)
    if (memoryItem) {
      this.stats.hits++
      this.stats.memoryHits++
      
      if (memoryItem.isValid()) {
        return memoryItem.data
      } else if (memoryItem.isStale()) {
        // 返回过期但可用的数据
        return memoryItem.data
      }
    }

    // L2: 检查持久化缓存
    const persistentItem = await this.getFromPersistent(key)
    if (persistentItem) {
      this.stats.hits++
      this.stats.persistentHits++
      
      // 提升到内存缓存
      this.memoryCache.set(key, persistentItem)
      
      if (persistentItem.isValid()) {
        return persistentItem.data
      } else if (persistentItem.isStale()) {
        return persistentItem.data
      }
    }

    this.stats.misses++
    return null
  }

  /**
   * 设置缓存项
   */
  async set(key, data, options = {}) {
    const cacheOptions = {
      ttl: options.ttl || this.options.defaultTTL,
      staleWhileRevalidate: options.staleWhileRevalidate || this.options.staleWhileRevalidate,
      tags: options.tags || [],
      metadata: options.metadata || {},
      persistent: options.persistent !== false // 默认持久化
    }

    const cacheItem = new CacheItem(data, cacheOptions)

    // 存储到内存缓存
    this.memoryCache.set(key, cacheItem)

    // 存储到持久化缓存
    if (cacheOptions.persistent) {
      await this.setToPersistent(key, cacheItem)
      this.persistentKeys.add(key)
    }

    return true
  }

  /**
   * 检查缓存是否存在且有效
   */
  async has(key) {
    const item = await this.get(key)
    return item !== null
  }

  /**
   * 删除缓存项
   */
  async delete(key) {
    this.memoryCache.delete(key)
    await this.deleteFromPersistent(key)
    this.persistentKeys.delete(key)
    return true
  }

  /**
   * 根据标签清理缓存
   */
  async invalidateByTags(tags) {
    const tagsSet = new Set(Array.isArray(tags) ? tags : [tags])
    let deletedCount = 0

    // 清理内存缓存
    for (const [key, item] of this.memoryCache.entries()) {
      if (item.tags.some(tag => tagsSet.has(tag))) {
        this.memoryCache.delete(key)
        deletedCount++
      }
    }

    // 清理持久化缓存
    for (const key of this.persistentKeys) {
      const item = await this.getFromPersistent(key)
      if (item && item.tags.some(tag => tagsSet.has(tag))) {
        await this.deleteFromPersistent(key)
        this.persistentKeys.delete(key)
        deletedCount++
      }
    }

    log.debug(`根据标签清理了 ${deletedCount} 个缓存项`, { tags })
    return deletedCount
  }

  /**
   * 清理所有缓存
   */
  async clear() {
    this.memoryCache.clear()
    
    for (const key of this.persistentKeys) {
      await this.deleteFromPersistent(key)
    }
    this.persistentKeys.clear()

    this.stats = {
      hits: 0,
      misses: 0,
      memoryHits: 0,
      persistentHits: 0,
      evictions: 0
    }

    log.debug('所有缓存已清理')
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0 
      ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
      : 0

    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      memorySize: this.memoryCache.size,
      persistentSize: this.persistentKeys.size,
      memoryMaxSize: this.options.memoryMaxSize
    }
  }

  /**
   * 从持久化存储获取
   */
  async getFromPersistent(key) {
    try {
      const storageKey = `${this.options.storagePrefix}:${key}`
      const stored = localStorage.getItem(storageKey)
      
      if (!stored) return null

      const parsed = JSON.parse(stored)
      return new CacheItem(parsed.data, {
        ttl: parsed.ttl,
        staleWhileRevalidate: parsed.staleWhileRevalidate,
        tags: parsed.tags,
        metadata: parsed.metadata
      })
    } catch (error) {
      log.warn('从持久化存储获取缓存失败:', error)
      return null
    }
  }

  /**
   * 存储到持久化存储
   */
  async setToPersistent(key, cacheItem) {
    try {
      const storageKey = `${this.options.storagePrefix}:${key}`
      const toStore = {
        data: cacheItem.data,
        timestamp: cacheItem.timestamp,
        ttl: cacheItem.ttl,
        staleWhileRevalidate: cacheItem.staleWhileRevalidate,
        tags: cacheItem.tags,
        metadata: cacheItem.metadata
      }
      
      localStorage.setItem(storageKey, JSON.stringify(toStore))
    } catch (error) {
      log.warn('存储到持久化存储失败:', error)
    }
  }

  /**
   * 从持久化存储删除
   */
  async deleteFromPersistent(key) {
    try {
      const storageKey = `${this.options.storagePrefix}:${key}`
      localStorage.removeItem(storageKey)
    } catch (error) {
      log.warn('从持久化存储删除缓存失败:', error)
    }
  }

  /**
   * 设置清理定时器
   */
  setupCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanup()
    }, this.options.cleanupInterval)
  }

  /**
   * 清理过期缓存
   */
  async cleanup() {
    let cleanedCount = 0

    // 清理内存缓存
    for (const [key, item] of this.memoryCache.entries()) {
      if (item.isExpired()) {
        this.memoryCache.delete(key)
        cleanedCount++
        this.stats.evictions++
      }
    }

    // 清理持久化缓存
    const keysToDelete = []
    for (const key of this.persistentKeys) {
      const item = await this.getFromPersistent(key)
      if (!item || item.isExpired()) {
        keysToDelete.push(key)
      }
    }

    for (const key of keysToDelete) {
      await this.deleteFromPersistent(key)
      this.persistentKeys.delete(key)
      cleanedCount++
    }

    if (cleanedCount > 0) {
      log.debug(`清理了 ${cleanedCount} 个过期缓存项`)
    }
  }

  /**
   * 销毁缓存管理器
   */
  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }

    this.memoryCache.clear()
    log.debug('缓存管理器已销毁')
  }
}

export { HybridCacheManager, LRUCache, CacheItem }
export default HybridCacheManager
