/**
 * 脚本库服务
 * 管理脚本数据，提供搜索和过滤功能，支持混合缓存策略
 */
import { ref } from 'vue'
import { useUserStore } from '@/store/user'
import log from './log'
import apiService from './api.js'
import { getFromStorage, saveToStorage } from '../utils/storage.js'
import { autocompleteConfig, environment } from '@/config/app-config'

// 本地存储键
const STORAGE_KEYS = {
  SCRIPTS: 'scriptLibrary.scripts',
  USER_SCRIPTS: 'scriptLibrary.userScripts',
  FAVORITES: 'scriptLibrary.favorites',
  LAST_SYNC: 'scriptLibrary.lastSync'
}

class ScriptLibraryService {
  constructor() {
    // 用户存储引用
    this.userStore = null

    // 脚本数据
    this.scripts = ref([])
    this.userScripts = ref([])
    this.favorites = ref([])
    this.lastSync = ref(null)

    // 后台同步定时器
    this.backgroundSyncTimer = null

    // 加载本地数据
    this.loadFromLocal()
    this.setupBackgroundSync()

    // 搜索历史
    this.searchHistory = ref([])

    // 常用命令
    this.frequentCommands = ref([])

    // 开发环境调试
    if (environment.isDevelopment) {
      log.debug('脚本库服务初始化')
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
   * 设置后台同步
   */
  setupBackgroundSync() {
    // 清除现有定时器
    if (this.backgroundSyncTimer) {
      clearInterval(this.backgroundSyncTimer)
    }

    // 设置后台同步定时器 - 每5分钟同步一次
    this.backgroundSyncTimer = setInterval(() => {
      if (this.isUserLoggedIn()) {
        this.backgroundSync()
      }
    }, 5 * 60 * 1000) // 5分钟

    // 开发环境调试
    if (environment.isDevelopment) {
      log.debug('后台同步已设置', {
        interval: '5分钟'
      })
    }
  }





  /**
   * 后台同步
   */
  async backgroundSync() {
    try {
      // 检查是否需要同步
      if (this.shouldSkipSync()) {
        // 优化：后台同步跳过时不记录日志，减少噪音
        return
      }

      // 执行同步
      const success = await this.syncFromServer(false)
      if (success) {
        log.debug('脚本库后台同步完成')
      }
    } catch (error) {
      log.warn('后台同步失败:', error)
    }
  }

  /**
   * 智能同步策略
   */
  async smartSync() {
    try {
      if (!this.isUserLoggedIn()) {
        log.debug('用户未登录，跳过同步')
        return false
      }

      // 检查网络状况
      const isOnline = navigator.onLine
      if (!isOnline) {
        log.debug('网络离线，跳过同步')
        return false
      }

      // 根据上次同步时间决定同步策略
      const lastSyncTime = this.lastSync.value ? new Date(this.lastSync.value).getTime() : 0
      const now = Date.now()
      const timeSinceLastSync = now - lastSyncTime

      // 1小时强制全量同步
      const fullSyncInterval = 60 * 60 * 1000
      const forceFullSync = timeSinceLastSync > fullSyncInterval

      log.debug('同步策略', {
        timeSinceLastSync: Math.round(timeSinceLastSync / 1000),
        forceFullSync
      })

      return await this.syncFromServer(forceFullSync)
    } catch (error) {
      log.error('同步失败:', error)
      return false
    }
  }



  /**
   * 从服务器同步脚本库数据
   * @param {boolean} forceFullSync - 是否强制全量同步
   */
  async syncFromServer(forceFullSync = false) {
    try {
      if (!this.isUserLoggedIn()) {
        log.debug('用户未登录，跳过脚本库同步')
        return false
      }

      // 检查是否需要同步
      if (!forceFullSync && this.shouldSkipSync()) {
        // 优化：降低跳过同步的日志级别，减少噪音
        return true
      }

      log.info('开始同步脚本库数据...', { forceFullSync })

      // 优先使用增量同步
      if (!forceFullSync && this.lastSync.value) {
        const incrementalSuccess = await this.incrementalSyncFromServer()
        if (incrementalSuccess) {
          return true
        }
        log.info('增量同步失败，回退到全量同步')
      }

      // 全量同步
      return await this.fullSyncFromServer()
    } catch (error) {
      log.error('同步脚本库数据失败:', error)
      return false
    }
  }

  /**
   * 检查是否应该跳过同步
   */
  shouldSkipSync() {
    if (!this.lastSync.value) {
      return false
    }

    const lastSyncTime = new Date(this.lastSync.value).getTime()
    const now = Date.now()
    const minSyncInterval = 30000 // 30秒最小间隔

    return (now - lastSyncTime) < minSyncInterval
  }

  /**
   * 增量同步脚本库数据
   */
  async incrementalSyncFromServer() {
    try {
      const lastSyncTime = this.lastSync.value

      // 获取增量更新
      const incrementalResponse = await apiService.get('/scripts/incremental', {
        since: lastSyncTime
      })

      if (incrementalResponse && incrementalResponse.success) {
        const { updates, deletes, favorites } = incrementalResponse

        // 处理更新和新增的脚本
        if (updates && updates.length > 0) {
          this.applyScriptUpdates(updates)
          log.debug('应用脚本增量更新', { count: updates.length })
        }

        // 处理删除的脚本
        if (deletes && deletes.length > 0) {
          this.applyScriptDeletes(deletes)
          log.debug('应用脚本删除', { count: deletes.length })
        }

        // 更新收藏状态
        if (favorites) {
          this.favorites.value = favorites
          log.debug('更新收藏状态', { count: favorites.length })
        }

        // 更新同步时间
        this.lastSync.value = new Date().toISOString()

        // 保存到本地存储
        this.saveToLocal()

        log.info('脚本库增量同步成功')
        return true
      }

      return false
    } catch (error) {
      // 如果是404错误，说明后端不支持增量同步
      if (error.response && error.response.status === 404) {
        log.debug('后端不支持增量同步API')
        return false
      }

      log.warn('增量同步失败:', error)
      return false
    }
  }

  /**
   * 全量同步脚本库数据
   */
  async fullSyncFromServer() {
    try {
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

        // 保存到本地存储
        this.saveToLocal()

        log.info('脚本库数据全量同步成功', {
          publicScripts: publicScripts.length,
          userScripts: userScripts.length
        })

        return true
      } else {
        log.warn('获取脚本库数据失败，使用本地数据')
        return false
      }
    } catch (error) {
      log.error('全量同步脚本库数据失败:', error)
      return false
    }
  }

  /**
   * 应用脚本更新
   */
  applyScriptUpdates(updates) {
    updates.forEach(update => {
      const script = {
        ...update,
        updatedAt: update.updatedAt || update.updated_at,
        createdAt: update.createdAt || update.created_at,
        isFavorite: this.favorites.value.includes(update.id)
      }

      if (update.source === 'public') {
        const index = this.scripts.value.findIndex(s => s.id === update.id)
        if (index >= 0) {
          this.scripts.value[index] = script
        } else {
          this.scripts.value.push(script)
        }
      } else if (update.source === 'user') {
        const index = this.userScripts.value.findIndex(s => s.id === update.id)
        if (index >= 0) {
          this.userScripts.value[index] = script
        } else {
          this.userScripts.value.push(script)
        }
      }
    })
  }

  /**
   * 应用脚本删除
   */
  applyScriptDeletes(deletes) {
    deletes.forEach(deleteInfo => {
      if (deleteInfo.source === 'public') {
        this.scripts.value = this.scripts.value.filter(s => s.id !== deleteInfo.id)
      } else if (deleteInfo.source === 'user') {
        this.userScripts.value = this.userScripts.value.filter(s => s.id !== deleteInfo.id)
      }
    })
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
   * 增强的本地缓存优先策略
   */
  getAllScripts() {
    // 合并公开脚本和用户脚本
    const allScripts = [
      ...this.scripts.value.map(script => ({ ...script, source: 'public' })),
      ...this.userScripts.value.map(script => ({ ...script, source: 'user' }))
    ]

    // 如果没有数据且用户已登录，触发后台同步
    if (allScripts.length === 0 && this.isUserLoggedIn() && !this.lastSync.value) {
      log.debug('检测到无脚本数据，触发后台同步')
      // 异步触发同步，不阻塞当前调用
      setTimeout(() => {
        this.smartSync().catch(error => {
          log.warn('后台智能同步失败:', error)
        })
      }, 100)
    }

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
   * 获取简化的命令建议（用于终端自动完成）
   * @param {string} input - 用户输入
   * @param {number} limit - 返回结果数量限制
   */
  async getSimpleCommandSuggestions(input, limit = 8) {
    // 检查用户是否已登录
    if (!this.isUserLoggedIn()) {
      log.debug('用户未登录，不提供命令建议')
      return []
    }

    // 直接计算建议
    const suggestions = this.getCommandSuggestions(input, limit)
    const result = suggestions.map(script => ({
      id: script.id,
      text: script.command,
      description: script.name,
      fullCommand: script.command,
      score: script.score
    }))

    return result
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

    // 直接计算建议（同步）
    const suggestions = this.getCommandSuggestions(input, limit)
    const result = suggestions.map(script => ({
      id: script.id,
      text: script.command,
      description: script.name,
      fullCommand: script.command,
      score: script.score
    }))

    return result
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
   * 销毁服务
   */
  destroy() {
    // 清理定时器
    if (this.backgroundSyncTimer) {
      clearInterval(this.backgroundSyncTimer)
      this.backgroundSyncTimer = null
    }

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
   * 根据名称获取脚本
   * @param {string} name - 脚本名称
   * @param {string} source - 脚本来源 ('public', 'user', 或 'all')
   */
  getScriptByName(name, source = 'all') {
    if (!name) return null

    const searchName = name.toLowerCase().trim()

    if (source === 'user') {
      return this.userScripts.value.find(script =>
        script.name.toLowerCase() === searchName
      )
    } else if (source === 'public') {
      return this.scripts.value.find(script =>
        script.name.toLowerCase() === searchName
      )
    } else {
      // 搜索所有脚本，优先返回公开脚本
      const publicScript = this.scripts.value.find(script =>
        script.name.toLowerCase() === searchName
      )
      if (publicScript) {
        return { ...publicScript, source: 'public' }
      }

      const userScript = this.userScripts.value.find(script =>
        script.name.toLowerCase() === searchName
      )
      if (userScript) {
        return { ...userScript, source: 'user' }
      }

      return null
    }
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
