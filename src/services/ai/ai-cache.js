/**
 * AI缓存管理器
 * 负责AI请求结果的智能缓存
 */

import log from '../log'

class AICache {
  constructor() {
    this.cache = new Map()
    this.maxSize = 100 // 最大缓存条目数
    this.defaultTTL = 300 // 默认5分钟过期
    
    // 定期清理过期缓存
    this.cleanupInterval = setInterval(() => {
      this.cleanup()
    }, 60000) // 每分钟清理一次
    
    log.debug('AI缓存管理器已初始化')
  }

  /**
   * 生成缓存键
   * @param {string} type 请求类型
   * @param {Object} context 上下文
   * @returns {string} 缓存键
   */
  generateKey(type, context) {
    try {
      // 创建用于生成哈希的内容
      const keyContent = {
        type,
        prefix: context.prefix?.substring(0, 100), // 限制长度
        suffix: context.suffix?.substring(0, 50),
        currentLine: context.currentLine?.substring(0, 200),
        terminalOutput: this.hashString(context.terminalOutput || ''),
        osHint: context.osHint,
        shellHint: context.shellHint
      }

      // 生成哈希键
      const keyString = JSON.stringify(keyContent)
      const hash = this.hashString(keyString)
      
      return `${type}_${hash}`
    } catch (error) {
      log.error('生成缓存键失败', error)
      return `${type}_${Date.now()}_${Math.random()}`
    }
  }

  /**
   * 设置缓存
   * @param {string} key 缓存键
   * @param {*} value 缓存值
   * @param {number} ttl 过期时间（秒）
   */
  set(key, value, ttl = null) {
    try {
      // 检查缓存大小限制
      if (this.cache.size >= this.maxSize) {
        this.evictOldest()
      }

      const expiresAt = Date.now() + (ttl || this.defaultTTL) * 1000
      
      this.cache.set(key, {
        value,
        expiresAt,
        createdAt: Date.now(),
        accessCount: 0,
        lastAccessed: Date.now()
      })

      log.debug('缓存已设置', { key, ttl, size: this.cache.size })
    } catch (error) {
      log.error('设置缓存失败', error)
    }
  }

  /**
   * 获取缓存
   * @param {string} key 缓存键
   * @returns {*} 缓存值或null
   */
  get(key) {
    try {
      const item = this.cache.get(key)
      
      if (!item) {
        return null
      }

      // 检查是否过期
      if (Date.now() > item.expiresAt) {
        this.cache.delete(key)
        log.debug('缓存已过期', { key })
        return null
      }

      // 更新访问统计
      item.accessCount++
      item.lastAccessed = Date.now()

      log.debug('缓存命中', { key, accessCount: item.accessCount })
      return item.value
    } catch (error) {
      log.error('获取缓存失败', error)
      return null
    }
  }

  /**
   * 删除缓存
   * @param {string} key 缓存键
   */
  delete(key) {
    const deleted = this.cache.delete(key)
    if (deleted) {
      log.debug('缓存已删除', { key })
    }
    return deleted
  }

  /**
   * 清空所有缓存
   */
  clear() {
    const size = this.cache.size
    this.cache.clear()
    log.debug('所有缓存已清空', { previousSize: size })
  }

  /**
   * 清理过期缓存
   */
  cleanup() {
    const now = Date.now()
    let cleanedCount = 0

    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiresAt) {
        this.cache.delete(key)
        cleanedCount++
      }
    }

    if (cleanedCount > 0) {
      log.debug('清理过期缓存', { cleanedCount, remainingSize: this.cache.size })
    }
  }

  /**
   * 淘汰最旧的缓存项
   */
  evictOldest() {
    let oldestKey = null
    let oldestTime = Date.now()

    // 找到最久未访问的项
    for (const [key, item] of this.cache.entries()) {
      if (item.lastAccessed < oldestTime) {
        oldestTime = item.lastAccessed
        oldestKey = key
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey)
      log.debug('淘汰最旧缓存', { key: oldestKey })
    }
  }

  /**
   * 生成字符串哈希
   * @param {string} str 输入字符串
   * @returns {string} 哈希值
   */
  hashString(str) {
    if (!str) return '0'
    
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // 转换为32位整数
    }
    return Math.abs(hash).toString(36)
  }

  /**
   * 获取缓存统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    const stats = {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: 0,
      items: []
    }

    let totalAccess = 0
    for (const [key, item] of this.cache.entries()) {
      totalAccess += item.accessCount
      stats.items.push({
        key,
        accessCount: item.accessCount,
        createdAt: item.createdAt,
        lastAccessed: item.lastAccessed,
        expiresAt: item.expiresAt,
        isExpired: Date.now() > item.expiresAt
      })
    }

    // 计算命中率（简化计算）
    if (stats.items.length > 0) {
      stats.hitRate = totalAccess / stats.items.length
    }

    return stats
  }

  /**
   * 预热缓存
   * @param {Array} items 预热项目列表
   */
  preload(items) {
    try {
      for (const item of items) {
        if (item.key && item.value) {
          this.set(item.key, item.value, item.ttl)
        }
      }
      log.debug('缓存预热完成', { count: items.length })
    } catch (error) {
      log.error('缓存预热失败', error)
    }
  }

  /**
   * 设置缓存配置
   * @param {Object} config 配置对象
   */
  configure(config) {
    if (config.maxSize && config.maxSize > 0) {
      this.maxSize = config.maxSize
    }
    
    if (config.defaultTTL && config.defaultTTL > 0) {
      this.defaultTTL = config.defaultTTL
    }

    log.debug('缓存配置已更新', { maxSize: this.maxSize, defaultTTL: this.defaultTTL })
  }

  /**
   * 检查缓存是否存在
   * @param {string} key 缓存键
   * @returns {boolean} 是否存在
   */
  has(key) {
    const item = this.cache.get(key)
    if (!item) return false
    
    // 检查是否过期
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key)
      return false
    }
    
    return true
  }

  /**
   * 获取缓存剩余时间
   * @param {string} key 缓存键
   * @returns {number} 剩余时间（秒），-1表示不存在或已过期
   */
  getTTL(key) {
    const item = this.cache.get(key)
    if (!item) return -1
    
    const remaining = Math.max(0, item.expiresAt - Date.now())
    return Math.floor(remaining / 1000)
  }

  /**
   * 延长缓存过期时间
   * @param {string} key 缓存键
   * @param {number} additionalTTL 额外的过期时间（秒）
   * @returns {boolean} 是否成功
   */
  extend(key, additionalTTL) {
    const item = this.cache.get(key)
    if (!item) return false
    
    item.expiresAt += additionalTTL * 1000
    log.debug('缓存过期时间已延长', { key, additionalTTL })
    return true
  }

  /**
   * 销毁缓存管理器
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    
    this.clear()
    log.debug('AI缓存管理器已销毁')
  }
}

export default AICache
