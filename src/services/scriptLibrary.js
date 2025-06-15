/**
 * 脚本库服务
 * 管理脚本数据，提供搜索和过滤功能，支持混合缓存策略
 */
import { ref } from 'vue'
import { useUserStore } from '@/store/user'
import log from './log'
import apiService from './api.js'
import { getFromStorage, saveToStorage } from '../utils/storage.js'
import { cacheConfig, environment } from '@/config/app-config'

// 本地存储键
const STORAGE_KEYS = {
  SCRIPTS: 'scriptLibrary.scripts',
  USER_SCRIPTS: 'scriptLibrary.userScripts',
  FAVORITES: 'scriptLibrary.favorites',
  LAST_SYNC: 'scriptLibrary.lastSync',
  CACHE_METADATA: 'scriptLibrary.cacheMetadata',
  SUGGESTIONS_CACHE: 'scriptLibrary.suggestionsCache'
}

// 获取缓存配置（支持环境变量覆盖）
const getCacheConfig = () => {
  const config = { ...cacheConfig }

  // 开发环境可以通过环境变量覆盖配置
  if (environment.isDevelopment) {
    // 从localStorage读取开发配置覆盖
    const devConfig = JSON.parse(localStorage.getItem('dev-cache-config') || '{}')
    if (Object.keys(devConfig).length > 0) {
      log.debug('使用开发环境缓存配置覆盖:', devConfig)
      return { ...config, ...devConfig }
    }
  }

  return config
}

class ScriptLibraryService {
  constructor() {
    // 用户存储引用
    this.userStore = null

    // 获取缓存配置
    this.config = getCacheConfig()

    // 脚本数据
    this.scripts = ref([])
    this.userScripts = ref([])
    this.favorites = ref([])
    this.lastSync = ref(null)

    // 混合缓存系统
    this.memoryCache = new Map()           // L1: 内存缓存
    this.suggestionsCache = new Map()      // 建议专用缓存
    this.cacheMetadata = new Map()         // 缓存元数据
    this.backgroundSyncTimer = null        // 后台同步定时器
    this.pendingRequests = new Map()       // 防止重复请求

    // 加载本地数据和缓存
    this.loadFromLocal()
    this.loadCacheMetadata()
    this.setupBackgroundSync()

    // 搜索历史
    this.searchHistory = ref([])

    // 常用命令
    this.frequentCommands = ref([])

    // 开发环境调试
    if (environment.isDevelopment && this.config.development.enableDebugLogs) {
      log.debug('脚本库服务初始化', {
        cacheConfig: this.config,
        memoryMaxSize: this.config.memory.maxSize,
        syncInterval: this.config.sync.backgroundInterval
      })
    }
  }

  /**
   * 从本地存储加载数据
   */
  loadFromLocal() {
    try {
      // 加载脚本数据
      const scripts = getFromStorage(STORAGE_KEYS.SCRIPTS, [])
      if (scripts.length > 0) {
        this.scripts.value = scripts
      }

      // 加载用户脚本
      const userScripts = getFromStorage(STORAGE_KEYS.USER_SCRIPTS, [])
      this.userScripts.value = userScripts

      // 加载收藏
      const favorites = getFromStorage(STORAGE_KEYS.FAVORITES, [])
      this.favorites.value = favorites

      // 加载同步时间
      const lastSync = getFromStorage(STORAGE_KEYS.LAST_SYNC, null)
      this.lastSync.value = lastSync

      // 只在有实际数据时记录信息
      if (this.scripts.value.length > 0 || this.userScripts.value.length > 0) {
        log.debug('从本地存储加载脚本库数据', {
          scriptsCount: this.scripts.value.length,
          userScriptsCount: this.userScripts.value.length,
          favoritesCount: this.favorites.value.length,
          lastSync: this.lastSync.value
        })
      }
    } catch (error) {
      log.error('加载本地脚本库数据失败:', error)
    }
  }

  /**
   * 保存数据到本地存储
   * @param {boolean} silent - 是否静默保存（不记录日志）
   */
  saveToLocal(silent = false) {
    try {
      saveToStorage(STORAGE_KEYS.SCRIPTS, this.scripts.value)
      saveToStorage(STORAGE_KEYS.USER_SCRIPTS, this.userScripts.value)
      saveToStorage(STORAGE_KEYS.FAVORITES, this.favorites.value)
      saveToStorage(STORAGE_KEYS.LAST_SYNC, this.lastSync.value)

      if (!silent) {
        log.debug('脚本库数据已保存到本地存储')
      }
    } catch (error) {
      log.error('保存脚本库数据到本地存储失败:', error)
    }
  }

  /**
   * 加载缓存元数据
   */
  loadCacheMetadata() {
    try {
      const metadata = getFromStorage(STORAGE_KEYS.CACHE_METADATA, {})
      const suggestionsCache = getFromStorage(STORAGE_KEYS.SUGGESTIONS_CACHE, {})

      // 恢复缓存元数据
      Object.entries(metadata).forEach(([key, value]) => {
        this.cacheMetadata.set(key, value)
      })

      // 恢复建议缓存（只恢复未过期的）
      Object.entries(suggestionsCache).forEach(([key, value]) => {
        if (this.isCacheValid(value)) {
          this.suggestionsCache.set(key, value)
        }
      })

      // 只在有缓存数据时记录
      if (this.cacheMetadata.size > 0 || this.suggestionsCache.size > 0) {
        log.debug('缓存元数据已加载', {
          metadataCount: this.cacheMetadata.size,
          suggestionsCacheCount: this.suggestionsCache.size
        })
      }
    } catch (error) {
      log.error('加载缓存元数据失败:', error)
    }
  }

  /**
   * 保存缓存元数据
   */
  saveCacheMetadata() {
    try {
      const metadata = Object.fromEntries(this.cacheMetadata)
      const suggestionsCache = Object.fromEntries(this.suggestionsCache)

      saveToStorage(STORAGE_KEYS.CACHE_METADATA, metadata)
      saveToStorage(STORAGE_KEYS.SUGGESTIONS_CACHE, suggestionsCache)

      log.debug('缓存元数据已保存')
    } catch (error) {
      log.error('保存缓存元数据失败:', error)
    }
  }

  /**
   * 设置后台同步
   */
  setupBackgroundSync() {
    // 清除现有定时器
    if (this.backgroundSyncTimer) {
      clearInterval(this.backgroundSyncTimer)
    }

    // 设置后台同步定时器
    this.backgroundSyncTimer = setInterval(() => {
      if (this.isUserLoggedIn()) {
        this.backgroundSync()
      }
    }, this.config.sync.backgroundInterval)

    // 只在开发环境且启用调试日志时记录后台同步设置
    if (environment.isDevelopment && this.config.development.enableDebugLogs) {
      log.debug('后台同步已设置', {
        interval: this.config.sync.backgroundInterval
      })
    }
  }



  /**
   * 检查缓存是否有效
   */
  isCacheValid(cacheItem) {
    if (!cacheItem || !cacheItem.timestamp) {
      return false
    }

    const now = Date.now()
    const age = now - cacheItem.timestamp

    return age < this.config.memory.ttl
  }

  /**
   * 检查缓存是否过期但仍可用（stale-while-revalidate）
   */
  isCacheStale(cacheItem) {
    if (!cacheItem || !cacheItem.timestamp) {
      return true
    }

    const now = Date.now()
    const age = now - cacheItem.timestamp

    return age > this.config.memory.ttl &&
           age < this.config.memory.ttl + this.config.memory.staleWhileRevalidate
  }

  /**
   * 后台同步
   */
  async backgroundSync() {
    try {
      log.debug('执行后台同步...')

      // 检查是否需要同步
      const lastSyncTime = this.lastSync.value ? new Date(this.lastSync.value).getTime() : 0
      const now = Date.now()

      if (now - lastSyncTime < this.config.sync.backgroundInterval) {
        log.debug('距离上次同步时间太短，跳过后台同步')
        return
      }

      // 执行同步
      const success = await this.syncFromServer()
      if (success) {
        // 清理过期缓存
        this.cleanupExpiredCache()
        // 保存缓存元数据
        this.saveCacheMetadata()
      }
    } catch (error) {
      log.warn('后台同步失败:', error)
    }
  }

  /**
   * 清理过期缓存
   */
  cleanupExpiredCache() {
    const now = Date.now()
    let cleanedCount = 0

    // 清理内存缓存
    for (const [key, value] of this.memoryCache.entries()) {
      if (!this.isCacheValid(value) && !this.isCacheStale(value)) {
        this.memoryCache.delete(key)
        cleanedCount++
      }
    }

    // 清理建议缓存
    for (const [key, value] of this.suggestionsCache.entries()) {
      if (!this.isCacheValid(value) && !this.isCacheStale(value)) {
        this.suggestionsCache.delete(key)
        cleanedCount++
      }
    }

    // 限制缓存大小
    if (this.memoryCache.size > this.config.memory.maxSize) {
      const entries = Array.from(this.memoryCache.entries())
      entries.sort((a, b) => (a[1].timestamp || 0) - (b[1].timestamp || 0))

      const toDelete = entries.slice(0, entries.length - this.config.memory.maxSize)
      toDelete.forEach(([key]) => this.memoryCache.delete(key))
      cleanedCount += toDelete.length
    }

    if (cleanedCount > 0) {
      log.debug(`清理了 ${cleanedCount} 个过期缓存项`)
    }
  }

  /**
   * 从服务器同步脚本库数据
   */
  async syncFromServer() {
    try {
      if (!this.isUserLoggedIn()) {
        log.debug('用户未登录，跳过脚本库同步')
        return false
      }

      log.info('开始同步脚本库数据...')

      // 同步收藏状态
      await this.syncFavoritesFromServer()

      // 获取公开脚本
      const publicScriptsResponse = await apiService.get('/scripts/all')
      if (publicScriptsResponse && publicScriptsResponse.success) {
        // 合并公开脚本和用户脚本
        const allScripts = publicScriptsResponse.scripts || []

        // 分离公开脚本和用户脚本
        const publicScripts = allScripts.filter(script => script.source === 'public')
        const userScripts = allScripts.filter(script => script.source === 'user')

        // 更新本地数据
        this.scripts.value = publicScripts.map(script => ({
          ...script,
          updatedAt: script.updatedAt || script.updated_at,
          createdAt: script.createdAt || script.created_at,
          isFavorite: this.favorites.value.includes(script.id)
        }))

        this.userScripts.value = userScripts.map(script => ({
          ...script,
          updatedAt: script.updatedAt || script.updated_at,
          createdAt: script.createdAt || script.created_at
        }))

        // 更新同步时间
        this.lastSync.value = new Date().toISOString()

        // 清理相关缓存
        this.invalidateRelatedCache()

        // 保存到本地存储
        this.saveToLocal()

        log.info('脚本库数据同步成功', {
          publicScripts: publicScripts.length,
          userScripts: userScripts.length
        })

        return true
      } else {
        log.warn('获取脚本库数据失败，使用本地数据')
        return false
      }
    } catch (error) {
      log.error('同步脚本库数据失败:', error)
      return false
    }
  }

  /**
   * 从服务器同步收藏状态
   */
  async syncFavoritesFromServer() {
    try {
      if (!this.isUserLoggedIn()) {
        return false
      }

      const response = await apiService.get('/scripts/favorites')
      if (response && response.success) {
        this.favorites.value = response.favorites || []
        // 合并保存操作，避免重复的"脚本库数据已保存到本地存储"日志
        this.saveToLocal(true) // 传入silent参数
        log.info('脚本收藏状态同步成功', { count: this.favorites.value.length })
        return true
      }
      return false
    } catch (error) {
      log.warn('从服务器同步收藏状态失败:', error)
      return false
    }
  }

  /**
   * 使相关缓存失效
   */
  invalidateRelatedCache() {
    // 检查是否有缓存需要清理
    const hasSuggestionsCache = this.suggestionsCache.size > 0
    const hasMemoryCache = this.memoryCache.size > 0

    // 清空建议缓存，因为脚本数据已更新
    this.suggestionsCache.clear()
    this.memoryCache.clear()

    // 只在有实际缓存被清理时记录
    if (hasSuggestionsCache || hasMemoryCache) {
      log.debug('已清理相关缓存')
    }
  }

  /**
   * 记录脚本使用
   */
  async recordScriptUsage(script) {
    try {
      if (!this.isUserLoggedIn()) {
        return false
      }

      const usageData = {
        scriptId: script.source === 'public' ? script.id : null,
        userScriptId: script.source === 'user' ? script.id : null,
        scriptName: script.name,
        command: script.command
      }

      await apiService.post('/scripts/usage', usageData)
      log.debug('脚本使用记录已保存', usageData)
      return true
    } catch (error) {
      log.warn('记录脚本使用失败:', error)
      return false
    }
  }

  /**
   * 获取用户存储实例
   * @returns {Object} 用户存储实例
   */
  getUserStore() {
    if (!this.userStore) {
      this.userStore = useUserStore()
    }
    return this.userStore
  }

  /**
   * 检查用户是否已登录
   * @returns {boolean} 是否已登录
   */
  isUserLoggedIn() {
    try {
      const userStore = this.getUserStore()
      return userStore.isLoggedIn
    } catch (error) {
      log.warn('检查用户登录状态失败:', error)
      return false
    }
  }

  /**
   * 获取所有脚本（包括公开脚本和用户脚本）
   */
  getAllScripts() {
    // 合并公开脚本和用户脚本
    const allScripts = [
      ...this.scripts.value.map(script => ({ ...script, source: 'public' })),
      ...this.userScripts.value.map(script => ({ ...script, source: 'user' }))
    ]

    // 按使用次数和更新时间排序
    return allScripts.sort((a, b) => {
      if (a.usageCount !== b.usageCount) {
        return (b.usageCount || 0) - (a.usageCount || 0)
      }
      // 安全的日期比较
      const dateA = a.updatedAt ? new Date(a.updatedAt) : new Date(0)
      const dateB = b.updatedAt ? new Date(b.updatedAt) : new Date(0)
      return dateB - dateA
    })
  }

  /**
   * 获取公开脚本
   */
  getPublicScripts() {
    return this.scripts.value
  }

  /**
   * 获取用户脚本
   */
  getUserScripts() {
    return this.userScripts.value
  }

  /**
   * 根据查询字符串搜索脚本
   * @param {string} query - 搜索查询
   * @param {Object} options - 搜索选项
   */
  searchScripts(query, options = {}) {
    if (!query || query.trim() === '') {
      return this.getAllScripts()
    }

    const searchQuery = query.toLowerCase().trim()
    const {
      matchName = true,
      matchDescription = true,
      matchCommand = true,
      matchKeywords = true,
      matchTags = true,
      fuzzyMatch = true
    } = options

    return this.getAllScripts().filter(script => {
      // 精确匹配
      if (matchName && script.name.toLowerCase().includes(searchQuery)) {
        return true
      }
      
      if (matchDescription && script.description.toLowerCase().includes(searchQuery)) {
        return true
      }
      
      if (matchCommand && script.command.toLowerCase().includes(searchQuery)) {
        return true
      }
      
      if (matchKeywords && script.keywords && 
          script.keywords.some(keyword => keyword.toLowerCase().includes(searchQuery))) {
        return true
      }
      
      if (matchTags && script.tags && 
          script.tags.some(tag => tag.toLowerCase().includes(searchQuery))) {
        return true
      }

      // 模糊匹配
      if (fuzzyMatch) {
        const searchTerms = searchQuery.split(/\s+/)
        return searchTerms.every(term => {
          return (matchName && script.name.toLowerCase().includes(term)) ||
                 (matchDescription && script.description.toLowerCase().includes(term)) ||
                 (matchCommand && script.command.toLowerCase().includes(term)) ||
                 (matchKeywords && script.keywords && 
                  script.keywords.some(keyword => keyword.toLowerCase().includes(term))) ||
                 (matchTags && script.tags && 
                  script.tags.some(tag => tag.toLowerCase().includes(term)))
        })
      }

      return false
    })
  }

  /**
   * 获取命令建议
   * @param {string} input - 用户输入
   * @param {number} limit - 返回结果数量限制
   */
  getCommandSuggestions(input, limit = 10) {
    if (!input || input.trim() === '') {
      // 返回常用命令或最近使用的命令
      return this.getFrequentCommands().slice(0, limit)
    }

    const suggestions = this.searchScripts(input, {
      matchCommand: true,
      matchName: true,
      matchKeywords: true,
      fuzzyMatch: true
    })

    // 按相关性排序
    const scored = suggestions.map(script => ({
      ...script,
      score: this.calculateRelevanceScore(script, input)
    }))

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  /**
   * 获取简化的命令建议（用于终端自动完成）- 混合缓存策略
   * @param {string} input - 用户输入
   * @param {number} limit - 返回结果数量限制
   */
  async getSimpleCommandSuggestions(input, limit = 8) {
    // 检查用户是否已登录
    if (!this.isUserLoggedIn()) {
      log.debug('用户未登录，不提供命令建议')
      return []
    }

    const cacheKey = `suggestions:${input}:${limit}`

    // L1: 检查内存缓存
    const memoryCached = this.memoryCache.get(cacheKey)
    if (memoryCached && this.isCacheValid(memoryCached)) {
      log.debug('从内存缓存返回建议', { input, count: memoryCached.data.length })
      return memoryCached.data
    }

    // L2: 检查建议缓存
    const suggestionsCached = this.suggestionsCache.get(cacheKey)
    if (suggestionsCached && this.isCacheValid(suggestionsCached)) {
      // 更新到内存缓存
      this.memoryCache.set(cacheKey, suggestionsCached)
      log.debug('从建议缓存返回建议', { input, count: suggestionsCached.data.length })
      return suggestionsCached.data
    }

    // L3: 使用过期但可用的缓存 + 后台更新
    if (suggestionsCached && this.isCacheStale(suggestionsCached)) {
      log.debug('使用过期缓存并触发后台更新', { input })

      // 异步更新缓存
      this.updateSuggestionsInBackground(input, limit, cacheKey)

      // 返回过期但可用的数据
      return suggestionsCached.data
    }

    // L4: 计算新的建议
    return await this.computeAndCacheSuggestions(input, limit, cacheKey)
  }

  /**
   * 同步版本的获取建议（向后兼容）
   */
  getSimpleCommandSuggestionsSync(input, limit = 8) {
    // 检查用户是否已登录
    if (!this.isUserLoggedIn()) {
      log.debug('用户未登录，不提供命令建议')
      return []
    }

    const cacheKey = `suggestions:${input}:${limit}`

    // 只检查内存缓存和建议缓存
    const memoryCached = this.memoryCache.get(cacheKey)
    if (memoryCached && this.isCacheValid(memoryCached)) {
      return memoryCached.data
    }

    const suggestionsCached = this.suggestionsCache.get(cacheKey)
    if (suggestionsCached && (this.isCacheValid(suggestionsCached) || this.isCacheStale(suggestionsCached))) {
      // 如果缓存过期，触发后台更新
      if (this.isCacheStale(suggestionsCached)) {
        this.updateSuggestionsInBackground(input, limit, cacheKey)
      }
      return suggestionsCached.data
    }

    // 计算新建议（同步）
    const suggestions = this.getCommandSuggestions(input, limit)
    const result = suggestions.map(script => ({
      id: script.id,
      text: script.command,
      description: script.name,
      fullCommand: script.command,
      score: script.score
    }))

    // 缓存结果
    this.cacheResult(cacheKey, result)

    return result
  }

  /**
   * 后台更新建议
   */
  async updateSuggestionsInBackground(input, limit, cacheKey) {
    try {
      // 防止重复请求
      if (this.pendingRequests.has(cacheKey)) {
        return
      }

      this.pendingRequests.set(cacheKey, true)

      log.debug('后台更新建议开始', { input, cacheKey })

      // 计算新建议
      const result = await this.computeAndCacheSuggestions(input, limit, cacheKey, false)

      log.debug('后台更新建议完成', { input, count: result.length })

    } catch (error) {
      log.warn('后台更新建议失败:', error)
    } finally {
      this.pendingRequests.delete(cacheKey)
    }
  }

  /**
   * 计算并缓存建议
   */
  async computeAndCacheSuggestions(input, limit, cacheKey, logResult = true) {
    const suggestions = this.getCommandSuggestions(input, limit)
    const result = suggestions.map(script => ({
      id: script.id,
      text: script.command,
      description: script.name,
      fullCommand: script.command,
      score: script.score
    }))

    // 缓存结果
    this.cacheResult(cacheKey, result)

    if (logResult) {
      log.debug('计算新建议', { input, count: result.length })
    }

    return result
  }

  /**
   * 缓存结果
   */
  cacheResult(cacheKey, data) {
    const cacheItem = {
      data,
      timestamp: Date.now()
    }

    // 存储到内存缓存
    this.memoryCache.set(cacheKey, cacheItem)

    // 存储到建议缓存
    this.suggestionsCache.set(cacheKey, cacheItem)

    // 限制建议缓存大小
    if (this.suggestionsCache.size > this.config.suggestions.maxSize) {
      const entries = Array.from(this.suggestionsCache.entries())
      entries.sort((a, b) => (a[1].timestamp || 0) - (b[1].timestamp || 0))

      const toDelete = entries.slice(0, entries.length - this.config.suggestions.maxSize)
      toDelete.forEach(([key]) => this.suggestionsCache.delete(key))
    }

    // 异步保存缓存元数据
    setTimeout(() => this.saveCacheMetadata(), 100)
  }

  /**
   * 提取命令的主要部分（第一个命令）
   * @param {string} command - 完整命令
   */
  extractMainCommand(command) {
    if (!command) return ''

    // 处理管道命令，取第一个命令
    const firstPart = command.split('|')[0].trim()

    // 处理复合命令，取第一个命令
    const firstCommand = firstPart.split('&&')[0].trim()

    // 提取命令名称（去掉参数）
    const commandParts = firstCommand.split(/\s+/)
    return commandParts[0] || command
  }

  /**
   * 计算相关性分数
   * @param {Object} script - 脚本对象
   * @param {string} input - 用户输入
   */
  calculateRelevanceScore(script, input) {
    const query = input.toLowerCase()
    let score = 0

    // 命令开头匹配得分最高
    if (script.command.toLowerCase().startsWith(query)) {
      score += 100
    }

    // 名称匹配
    if (script.name.toLowerCase().includes(query)) {
      score += 50
    }

    // 关键词匹配
    if (script.keywords) {
      script.keywords.forEach(keyword => {
        if (keyword.toLowerCase().includes(query)) {
          score += 30
        }
      })
    }

    // 标签匹配
    if (script.tags) {
      script.tags.forEach(tag => {
        if (tag.toLowerCase().includes(query)) {
          score += 20
        }
      })
    }

    // 命令包含匹配
    if (script.command.toLowerCase().includes(query)) {
      score += 10
    }

    // 收藏的脚本额外加分
    if (script.isFavorite) {
      score += 5
    }

    return score
  }

  /**
   * 获取常用命令
   */
  getFrequentCommands() {
    // 返回收藏的脚本作为常用命令
    const allScripts = this.getAllScripts()
    return allScripts.filter(script => script.isFavorite || this.favorites.value.includes(script.id))
  }

  /**
   * 添加到搜索历史
   * @param {string} query - 搜索查询
   */
  addToSearchHistory(query) {
    if (!query || query.trim() === '') return

    const trimmedQuery = query.trim()
    
    // 移除重复项
    this.searchHistory.value = this.searchHistory.value.filter(item => item !== trimmedQuery)
    
    // 添加到开头
    this.searchHistory.value.unshift(trimmedQuery)
    
    // 限制历史记录数量
    if (this.searchHistory.value.length > 20) {
      this.searchHistory.value = this.searchHistory.value.slice(0, 20)
    }
  }

  /**
   * 获取搜索历史
   */
  getSearchHistory() {
    return this.searchHistory.value
  }

  /**
   * 获取缓存统计信息
   */
  getCacheStats() {
    return {
      memoryCache: {
        size: this.memoryCache.size,
        maxSize: this.config.memory.maxSize
      },
      suggestionsCache: {
        size: this.suggestionsCache.size,
        maxSize: this.config.suggestions.maxSize
      },
      cacheMetadata: {
        size: this.cacheMetadata.size
      },
      lastSync: this.lastSync.value,
      pendingRequests: this.pendingRequests.size,
      config: this.config
    }
  }

  /**
   * 手动清理缓存
   */
  clearCache() {
    this.memoryCache.clear()
    this.suggestionsCache.clear()
    this.cacheMetadata.clear()
    this.pendingRequests.clear()

    // 清理本地存储中的缓存
    try {
      localStorage.removeItem(`easyssh-${STORAGE_KEYS.CACHE_METADATA}`)
      localStorage.removeItem(`easyssh-${STORAGE_KEYS.SUGGESTIONS_CACHE}`)
    } catch (error) {
      log.warn('清理本地存储缓存失败:', error)
    }

    log.info('缓存已清理')
  }

  /**
   * 销毁服务
   */
  destroy() {
    // 清理定时器
    if (this.backgroundSyncTimer) {
      clearInterval(this.backgroundSyncTimer)
      this.backgroundSyncTimer = null
    }

    // 保存缓存元数据
    this.saveCacheMetadata()

    // 清理内存
    this.memoryCache.clear()
    this.pendingRequests.clear()

    log.debug('脚本库服务已销毁')
  }

  /**
   * 根据ID获取脚本
   * @param {number} id - 脚本ID
   * @param {string} source - 脚本来源 ('public' 或 'user')
   */
  getScriptById(id, source = 'public') {
    if (source === 'user') {
      return this.userScripts.value.find(script => script.id === id)
    }
    return this.scripts.value.find(script => script.id === id)
  }

  /**
   * 切换脚本收藏状态
   * @param {number} scriptId - 脚本ID
   */
  async toggleFavorite(scriptId) {
    const index = this.favorites.value.indexOf(scriptId)
    const wasFavorite = index > -1

    if (wasFavorite) {
      this.favorites.value.splice(index, 1)
    } else {
      this.favorites.value.push(scriptId)
    }

    // 更新本地存储
    this.saveToLocal()

    // 同步到服务器
    try {
      if (this.isUserLoggedIn()) {
        await apiService.post('/scripts/favorites', {
          favorites: this.favorites.value
        })
        log.debug('脚本收藏状态已同步到服务器', { scriptId, isFavorite: !wasFavorite })
      }
    } catch (error) {
      log.warn('同步脚本收藏状态到服务器失败:', error)
      // 如果同步失败，恢复本地状态
      if (wasFavorite) {
        this.favorites.value.push(scriptId)
      } else {
        const restoreIndex = this.favorites.value.indexOf(scriptId)
        if (restoreIndex > -1) {
          this.favorites.value.splice(restoreIndex, 1)
        }
      }
      this.saveToLocal()
      throw error
    }

    return this.favorites.value.includes(scriptId)
  }

  /**
   * 检查脚本是否被收藏
   * @param {number} scriptId - 脚本ID
   */
  isFavorite(scriptId) {
    return this.favorites.value.includes(scriptId)
  }

  /**
   * 添加新脚本
   * @param {Object} scriptData - 脚本数据
   */
  addScript(scriptData) {
    const newScript = {
      id: Math.max(...this.scripts.value.map(s => s.id)) + 1,
      ...scriptData,
      updatedAt: new Date(),
      keywords: this.generateKeywords(scriptData)
    }

    this.scripts.value.push(newScript)
    return newScript
  }

  /**
   * 更新脚本
   * @param {number} id - 脚本ID
   * @param {Object} updates - 更新数据
   */
  updateScript(id, updates) {
    const index = this.scripts.value.findIndex(script => script.id === id)
    if (index !== -1) {
      this.scripts.value[index] = {
        ...this.scripts.value[index],
        ...updates,
        updatedAt: new Date(),
        keywords: this.generateKeywords({ ...this.scripts.value[index], ...updates })
      }
      return this.scripts.value[index]
    }
    return null
  }

  /**
   * 删除脚本
   * @param {number} id - 脚本ID
   */
  deleteScript(id) {
    const index = this.scripts.value.findIndex(script => script.id === id)
    if (index !== -1) {
      const deleted = this.scripts.value.splice(index, 1)[0]
      return deleted
    }
    return null
  }

  /**
   * 生成关键词
   * @param {Object} scriptData - 脚本数据
   */
  generateKeywords(scriptData) {
    const keywords = new Set()

    // 从名称提取关键词
    if (scriptData.name) {
      scriptData.name.split(/\s+/).forEach(word => {
        if (word.length > 1) {
          keywords.add(word.toLowerCase())
        }
      })
    }

    // 从描述提取关键词
    if (scriptData.description) {
      scriptData.description.split(/\s+/).forEach(word => {
        if (word.length > 2) {
          keywords.add(word.toLowerCase())
        }
      })
    }

    // 从命令提取关键词
    if (scriptData.command) {
      const commandWords = scriptData.command.match(/\b[a-zA-Z]+\b/g) || []
      commandWords.forEach(word => {
        if (word.length > 1) {
          keywords.add(word.toLowerCase())
        }
      })
    }

    // 添加标签
    if (scriptData.tags) {
      scriptData.tags.forEach(tag => {
        keywords.add(tag.toLowerCase())
      })
    }

    return Array.from(keywords)
  }
}

// 创建单例实例
const scriptLibraryService = new ScriptLibraryService()

export default scriptLibraryService
