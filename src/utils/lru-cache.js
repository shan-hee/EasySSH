/**
 * 高性能LRU缓存实现
 * 支持TTL、容量限制和性能监控
 */

class LRUCacheNode {
  constructor(key, value, ttl = null) {
    this.key = key
    this.value = value
    this.prev = null
    this.next = null
    this.createdAt = Date.now()
    this.accessedAt = Date.now()
    this.expiresAt = ttl ? Date.now() + ttl : null
    this.accessCount = 1
  }

  isExpired() {
    return this.expiresAt && Date.now() > this.expiresAt
  }

  isStale(staleTime = 0) {
    return staleTime > 0 && (Date.now() - this.accessedAt) > staleTime
  }

  touch() {
    this.accessedAt = Date.now()
    this.accessCount++
  }
}

export class LRUCache {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 100
    this.defaultTTL = options.defaultTTL || null
    this.staleWhileRevalidate = options.staleWhileRevalidate || 0
    this.onEvict = options.onEvict || null
    this.enableStats = options.enableStats !== false

    // 双向链表头尾节点
    this.head = new LRUCacheNode('__head__', null)
    this.tail = new LRUCacheNode('__tail__', null)
    this.head.next = this.tail
    this.tail.prev = this.head

    // 哈希表用于O(1)查找
    this.cache = new Map()

    // 性能统计
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      expired: 0,
      staleHits: 0
    }

    // 定期清理过期项
    this.cleanupInterval = setInterval(() => {
      this.cleanup()
    }, options.cleanupInterval || 60000) // 默认1分钟清理一次
  }

  /**
   * 获取缓存项
   */
  get(key) {
    const node = this.cache.get(key)
    
    if (!node) {
      this.stats.misses++
      return null
    }

    // 检查是否过期
    if (node.isExpired()) {
      this.delete(key)
      this.stats.expired++
      this.stats.misses++
      return null
    }

    // 更新访问信息
    node.touch()
    
    // 移动到链表头部（最近使用）
    this.moveToHead(node)

    // 检查是否过时但仍可用
    if (node.isStale(this.staleWhileRevalidate)) {
      this.stats.staleHits++
    } else {
      this.stats.hits++
    }

    return {
      value: node.value,
      isStale: node.isStale(this.staleWhileRevalidate),
      age: Date.now() - node.createdAt,
      accessCount: node.accessCount
    }
  }

  /**
   * 设置缓存项
   */
  set(key, value, ttl = null) {
    const existingNode = this.cache.get(key)
    
    if (existingNode) {
      // 更新现有节点
      existingNode.value = value
      existingNode.createdAt = Date.now()
      existingNode.accessedAt = Date.now()
      existingNode.expiresAt = ttl ? Date.now() + ttl : 
                               (this.defaultTTL ? Date.now() + this.defaultTTL : null)
      existingNode.accessCount = 1
      this.moveToHead(existingNode)
    } else {
      // 创建新节点
      const newNode = new LRUCacheNode(
        key, 
        value, 
        ttl || this.defaultTTL
      )
      
      // 检查容量限制
      if (this.cache.size >= this.maxSize) {
        this.evictLRU()
      }
      
      this.cache.set(key, newNode)
      this.addToHead(newNode)
    }

    this.stats.sets++
    return true
  }

  /**
   * 删除缓存项
   */
  delete(key) {
    const node = this.cache.get(key)
    if (node) {
      this.cache.delete(key)
      this.removeNode(node)
      this.stats.deletes++
      
      if (this.onEvict) {
        this.onEvict(key, node.value, 'delete')
      }
      
      return true
    }
    return false
  }

  /**
   * 清空缓存
   */
  clear() {
    this.cache.clear()
    this.head.next = this.tail
    this.tail.prev = this.head
    this.resetStats()
  }

  /**
   * 获取缓存大小
   */
  size() {
    return this.cache.size
  }

  /**
   * 检查是否包含某个键
   */
  has(key) {
    const node = this.cache.get(key)
    return node && !node.isExpired()
  }

  /**
   * 获取所有键
   */
  keys() {
    const keys = []
    let current = this.head.next
    while (current !== this.tail) {
      if (!current.isExpired()) {
        keys.push(current.key)
      }
      current = current.next
    }
    return keys
  }

  /**
   * 获取性能统计
   */
  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0 ? 
                   (this.stats.hits / (this.stats.hits + this.stats.misses)) * 100 : 0
    
    return {
      ...this.stats,
      hitRate: hitRate.toFixed(2) + '%',
      size: this.cache.size,
      maxSize: this.maxSize
    }
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      expired: 0,
      staleHits: 0
    }
  }

  // 私有方法

  /**
   * 移动节点到链表头部
   */
  moveToHead(node) {
    this.removeNode(node)
    this.addToHead(node)
  }

  /**
   * 添加节点到链表头部
   */
  addToHead(node) {
    node.prev = this.head
    node.next = this.head.next
    this.head.next.prev = node
    this.head.next = node
  }

  /**
   * 从链表中移除节点
   */
  removeNode(node) {
    node.prev.next = node.next
    node.next.prev = node.prev
  }

  /**
   * 移除最近最少使用的节点
   */
  evictLRU() {
    const lru = this.tail.prev
    if (lru !== this.head) {
      this.cache.delete(lru.key)
      this.removeNode(lru)
      this.stats.evictions++
      
      if (this.onEvict) {
        this.onEvict(lru.key, lru.value, 'evict')
      }
    }
  }

  /**
   * 清理过期项
   */
  cleanup() {
    const now = Date.now()
    const toDelete = []
    
    for (const [key, node] of this.cache) {
      if (node.isExpired()) {
        toDelete.push(key)
      }
    }
    
    toDelete.forEach(key => {
      this.delete(key)
      this.stats.expired++
    })
    
    return toDelete.length
  }

  /**
   * 销毁缓存
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    this.clear()
  }
}

export default LRUCache
