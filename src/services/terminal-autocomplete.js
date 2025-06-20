/**
 * 终端自动完成服务
 * 处理终端输入的自动完成功能
 */
import scriptLibraryService from './scriptLibrary'
import wordCompletionService from './word-completion'
import log from './log'
import { useUserStore } from '@/store/user'
import { cacheConfig } from '@/config/app-config'
import LRUCache from '@/utils/lru-cache'
import { SmartDebounce } from '@/utils/smart-debounce'

class TerminalAutocompleteService {
  constructor() {
    // 当前输入缓冲区
    this.inputBuffer = ''

    // 当前光标位置
    this.cursorPosition = 0

    // 自动完成状态
    this.isActive = false

    // 建议列表
    this.suggestions = []

    // 当前选中的建议索引，-1表示没有选中
    this.selectedIndex = -1

    // 缓存的位置信息
    this.lastPosition = null

    // 回调函数
    this.callbacks = {
      onSuggestionsUpdate: null,
      onPositionUpdate: null
    }

    // 智能防抖系统
    this.smartDebounce = new SmartDebounce({
      defaultDelay: cacheConfig.suggestions.debounceDelay,
      minDelay: 0,
      maxDelay: 500,
      enableAdaptive: true,
      enablePriority: true
    })

    // 创建防抖函数
    this.debouncedUpdate = this.smartDebounce.create(
      this.updateSuggestions.bind(this),
      {
        key: 'updateSuggestions',
        adaptive: true,
        priority: 1
      }
    )

    // 高优先级防抖函数（用于删除操作）
    this.debouncedUpdateHighPriority = this.smartDebounce.create(
      this.updateSuggestions.bind(this),
      {
        key: 'updateSuggestionsHighPriority',
        delay: 20,
        priority: 2,
        adaptive: false
      }
    )

    // 立即更新函数（用于首字符）
    this.immediateUpdate = this.smartDebounce.create(
      this.updateSuggestions.bind(this),
      {
        key: 'immediateUpdate',
        delay: 0,
        priority: 3,
        immediate: true
      }
    )

    // 配置（从配置文件获取）
    this.config = {
      minInputLength: cacheConfig.suggestions.minInputLength,
      debounceDelay: cacheConfig.suggestions.debounceDelay,
      maxSuggestions: cacheConfig.suggestions.maxSuggestions,
      enableWordCompletion: cacheConfig.suggestions.enableWordCompletion,
      enableScriptCompletion: cacheConfig.suggestions.enableScriptCompletion,
      wordCompletionPriority: cacheConfig.suggestions.wordCompletionPriority,
      scriptCompletionPriority: cacheConfig.suggestions.scriptCompletionPriority,
      maxWordsPerType: cacheConfig.suggestions.maxWordsPerType,
      contextDetection: cacheConfig.suggestions.contextDetection
    }

    // 用户存储引用
    this.userStore = null

    // 智能缓存系统
    this.suggestionCache = new LRUCache({
      maxSize: cacheConfig.suggestions.maxSize,
      defaultTTL: cacheConfig.memory.ttl,
      staleWhileRevalidate: cacheConfig.memory.staleWhileRevalidate,
      enableStats: true,
      onEvict: (key, value, reason) => {
        log.debug(`缓存项被移除: ${key}, 原因: ${reason}`)
      }
    })

    // 预测性缓存
    this.predictiveCache = new Map()
    this.inputPatterns = new Map() // 用户输入模式记录

    // 性能监控
    this.performanceStats = {
      cacheHits: 0,
      cacheMisses: 0,
      avgResponseTime: 0,
      totalRequests: 0
    }
  }

  /**
   * 设置回调函数
   * @param {Object} callbacks - 回调函数对象
   */
  setCallbacks(callbacks) {
    this.callbacks = { ...this.callbacks, ...callbacks }
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
   * 处理终端输入数据
   * @param {string} data - 输入数据
   * @param {Object} terminal - 终端实例
   * @returns {boolean} 是否已处理该输入（true表示阻止默认处理）
   */
  processInput(data, terminal) {
    try {
      // 处理特殊字符
      if (this.isControlCharacter(data)) {
        const handled = this.handleControlCharacter(data, terminal)
        if (handled) {
          return true // 阻止默认处理
        }
        return false
      }

      // 检查是否是空格键
      if (data === ' ') {
        // 空格键输入时立即隐藏补全框并更新缓冲区
        this.hideSuggestions()
        this.updateInputBuffer(data)
        return false // 不阻止默认处理
      }

      // 更新输入缓冲区
      this.updateInputBuffer(data)

      log.debug(`自动完成输入处理: "${this.inputBuffer}", 长度: ${this.inputBuffer.length}`)

      // 获取当前正在输入的单词
      const currentWord = this.getCurrentWord()
      log.debug(`当前单词: "${currentWord}"`)

      // 检查是否应该显示建议
      if (currentWord && currentWord.length >= this.config.minInputLength) {
        // 对于第一个字符，立即显示建议，无延迟
        if (currentWord.length === 1) {
          this.immediateUpdate(currentWord, terminal)
        } else {
          // 其他情况使用智能防抖
          this.debouncedUpdate(currentWord, terminal)
        }
      } else {
        // 当前单词为空或太短，隐藏建议
        this.hideSuggestions()
      }

      return false // 不阻止默认处理

    } catch (error) {
      log.error('处理终端自动完成输入失败:', error)
      return false
    }
  }

  /**
   * 检查是否为控制字符
   * @param {string} data - 输入数据
   */
  isControlCharacter(data) {
    const charCode = data.charCodeAt(0)
    
    // 检查常见控制字符
    return charCode < 32 || 
           data === '\x7f' || // DEL
           data === '\x1b' || // ESC
           data.startsWith('\x1b[') // ANSI escape sequences
  }

  /**
   * 处理控制字符
   * @param {string} data - 控制字符数据
   * @param {Object} terminal - 终端实例
   * @returns {boolean} 是否已处理该输入（true表示阻止默认处理）
   */
  handleControlCharacter(data, terminal) {
    const charCode = data.charCodeAt(0)
    log.debug(`处理控制字符: "${data}", charCode=${charCode}, isActive=${this.isActive}`)

    switch (charCode) {
      case 8:   // Backspace
      case 127: // DEL
        const needsUpdate = this.handleBackspace()
        // 获取删除后的当前单词
        const currentWord = this.getCurrentWord()

        // 如果需要更新建议（删除前补全框是激活的）或者补全框未激活但满足条件
        if (currentWord && currentWord.length >= this.config.minInputLength) {
          if (needsUpdate || !this.isActive) {
            log.debug(`删除后更新建议: 当前单词="${currentWord}", 需要更新=${needsUpdate}, 激活状态=${this.isActive}`)
            this.debouncedUpdateHighPriority(currentWord, terminal)
          }
        }
        break

      case 13: // Enter
        const handled = this.handleEnter(terminal)
        if (handled) {
          // 如果自动完成处理了回车，阻止默认行为
          return true
        }
        break

      case 9:  // Tab
        // Tab键可能用于自动完成确认
        if (this.isActive && this.selectedIndex >= 0) {
          const selectedSuggestion = this.getSelectedSuggestion()
          if (selectedSuggestion) {
            this.selectSuggestion(selectedSuggestion, terminal)
            return true // 阻止默认Tab处理
          }
        }
        break

      case 27: // ESC
        if (this.isActive) {
          this.hideSuggestions()
          return true // 阻止默认ESC处理
        }
        break

      default:
        // 处理ANSI转义序列
        if (data.startsWith('\x1b[')) {
          const handled = this.handleAnsiSequence(data, terminal)
          if (handled) {
            return true
          }
        }
        break
    }

    return false // 默认不阻止处理
  }

  /**
   * 处理退格键
   */
  handleBackspace() {
    if (this.inputBuffer.length > 0) {
      this.inputBuffer = this.inputBuffer.slice(0, -1)
      log.debug(`退格后缓冲区: "${this.inputBuffer}", 长度: ${this.inputBuffer.length}`)
    }

    // 获取当前单词
    const currentWord = this.getCurrentWord()

    // 如果当前单词为空或太短，隐藏建议
    if (!currentWord || currentWord.length < this.config.minInputLength) {
      log.debug('当前单词为空或太短，隐藏建议')
      this.hideSuggestions()
      return
    }

    // 如果补全框当前是激活状态，需要重新计算建议
    if (this.isActive) {
      log.debug(`删除后重新计算建议，当前单词: "${currentWord}"`)
      // 重新计算建议，确保建议与当前输入匹配
      return true // 返回true表示需要在外部重新计算建议
    }
  }

  /**
   * 处理回车键
   * @param {Object} terminal - 终端实例
   */
  handleEnter(terminal) {
    // 检查是否有选中的建议
    if (this.isActive && this.selectedIndex >= 0 && this.selectedIndex < this.suggestions.length) {
      // 有选中项时，应用补全
      const selectedSuggestion = this.getSelectedSuggestion()
      if (selectedSuggestion) {
        this.selectSuggestion(selectedSuggestion, terminal)
        return true // 阻止默认回车处理
      }
    }

    // 无选中项时，只清空状态，不阻止默认回车行为
    if (this.isActive) {
      // 如果补全框是激活的，清空输入缓冲区并隐藏建议框
      this.inputBuffer = ''
      this.hideSuggestions()
    }

    // 返回false，让终端正常处理回车键
    return false
  }

  /**
   * 处理ANSI转义序列
   * @param {string} data - ANSI序列数据
   * @param {Object} terminal - 终端实例
   * @returns {boolean} 是否已处理该输入（true表示阻止默认处理）
   */
  handleAnsiSequence(data, terminal) {
    log.debug(`收到ANSI序列: "${data}", 字节: [${Array.from(data).map(c => c.charCodeAt(0)).join(', ')}]`)

    // 注意：上下方向键的处理现在主要由组件级别的键盘事件处理
    // 这里只处理终端直接输入的ANSI序列，避免与组件级别的处理冲突

    // 处理其他光标移动等ANSI序列
    if (data.includes('C')) { // 右箭头
      this.cursorPosition++
    } else if (data.includes('D')) { // 左箭头
      this.cursorPosition--
    }

    return false // 默认不阻止处理
  }

  /**
   * 向上导航建议列表
   */
  navigateUp(terminal) {
    log.debug(`向上导航开始: suggestions.length=${this.suggestions.length}, selectedIndex=${this.selectedIndex}`)

    if (!this.isActive || this.suggestions.length === 0) {
      log.warn('建议框未激活或建议列表为空，无法导航')
      return
    }

    const oldIndex = this.selectedIndex
    this.selectedIndex = this.selectedIndex <= 0
      ? this.suggestions.length - 1  // 循环到最后一项
      : this.selectedIndex - 1

    log.debug(`向上导航完成: ${oldIndex} -> ${this.selectedIndex}`)
    this.updateSuggestionsDisplay(terminal)
  }

  /**
   * 向下导航建议列表
   */
  navigateDown(terminal) {
    log.debug(`向下导航开始: suggestions.length=${this.suggestions.length}, selectedIndex=${this.selectedIndex}`)

    if (!this.isActive || this.suggestions.length === 0) {
      log.warn('建议框未激活或建议列表为空，无法导航')
      return
    }

    const oldIndex = this.selectedIndex
    this.selectedIndex = this.selectedIndex >= this.suggestions.length - 1
      ? 0  // 循环到第一项
      : this.selectedIndex + 1

    log.debug(`向下导航完成: ${oldIndex} -> ${this.selectedIndex}`)
    this.updateSuggestionsDisplay(terminal)
  }

  /**
   * 更新建议显示（包含选中状态）
   */
  updateSuggestionsDisplay(terminal = null) {
    try {
      log.debug(`更新建议显示: suggestions.length=${this.suggestions.length}, selectedIndex=${this.selectedIndex}`)

      // 确保建议框仍然是激活状态
      if (!this.isActive || this.suggestions.length === 0) {
        log.warn('建议框未激活或建议列表为空，跳过显示更新')
        return
      }

      if (this.callbacks.onSuggestionsUpdate) {
        // 使用缓存的位置或重新计算
        const position = terminal ? this.calculatePosition(terminal) : this.lastPosition || { x: 0, y: 0 }
        this.callbacks.onSuggestionsUpdate(this.suggestions, position, this.selectedIndex)
        log.debug('建议显示更新完成')
      } else {
        log.warn('onSuggestionsUpdate回调未设置')
      }
    } catch (error) {
      log.error('更新建议显示失败:', error)
    }
  }

  /**
   * 更新输入缓冲区
   * @param {string} data - 输入数据
   */
  updateInputBuffer(data) {
    // 只处理可打印字符
    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      this.inputBuffer += data
      log.debug(`输入缓冲区: "${this.inputBuffer}", 长度: ${this.inputBuffer.length}`)
    }
  }

  /**
   * 获取当前行的输入
   */
  getCurrentLineInput() {
    try {
      // 主要依赖输入缓冲区，它是最准确的
      return this.inputBuffer

    } catch (error) {
      log.warn('获取当前行输入失败:', error)
      return ''
    }
  }

  /**
   * 获取当前正在输入的单词
   * @returns {string} 当前单词
   */
  getCurrentWord() {
    try {
      const input = this.inputBuffer
      if (!input) return ''

      // 定义单词分隔符
      const wordSeparators = /[\s&|;()<>]/

      // 从输入缓冲区的末尾向前查找，找到当前正在输入的单词
      let wordStart = input.length

      // 向前查找单词的开始位置
      for (let i = input.length - 1; i >= 0; i--) {
        if (wordSeparators.test(input[i])) {
          wordStart = i + 1
          break
        }
        if (i === 0) {
          wordStart = 0
        }
      }

      // 提取当前单词
      const currentWord = input.substring(wordStart).trim()

      log.debug(`提取当前单词: 输入="${input}", 单词开始位置=${wordStart}, 当前单词="${currentWord}"`)

      return currentWord

    } catch (error) {
      log.warn('获取当前单词失败:', error)
      return ''
    }
  }



  /**
   * 更新建议列表 - 智能混合补全
   * @param {string} input - 当前输入
   * @param {Object} terminal - 终端实例
   */
  updateSuggestions(input, terminal) {
    try {
      // 首先检查用户是否已登录
      if (!this.isUserLoggedIn()) {
        log.debug('用户未登录，不显示自动补全建议')
        this.hideSuggestions()
        return
      }

      // 严格检查输入长度和内容
      if (!input || input.trim().length < this.config.minInputLength) {
        this.hideSuggestions()
        return
      }

      // 检查输入是否只包含空白字符
      if (input.trim() === '') {
        this.hideSuggestions()
        return
      }

      // 获取智能混合建议
      const suggestions = this.getCombinedSuggestions(input.trim(), terminal)

      if (suggestions.length === 0) {
        this.hideSuggestions()
        return
      }

      // 更新建议列表
      this.suggestions = suggestions
      this.selectedIndex = -1  // 默认不选中任何项
      this.isActive = true

      // 计算显示位置并缓存
      const position = this.calculatePosition(terminal)
      this.lastPosition = position

      // 通知回调
      if (this.callbacks.onSuggestionsUpdate) {
        this.callbacks.onSuggestionsUpdate(suggestions, position, this.selectedIndex)
      }

    } catch (error) {
      log.error('更新自动完成建议失败:', error)
      this.hideSuggestions()
    }
  }

  /**
   * 获取智能混合建议 - 带缓存优化
   * @param {string} input - 用户输入
   * @param {Object} terminal - 终端实例
   * @returns {Array} 混合建议列表
   */
  getCombinedSuggestions(input, terminal) {
    const startTime = performance.now()

    // 生成缓存键
    const context = this.getInputContext(input, terminal)
    const cacheKey = this.generateCacheKey(input, context)

    // 检查缓存
    const cached = this.suggestionCache.get(cacheKey)
    if (cached && !cached.isStale) {
      this.performanceStats.cacheHits++
      log.debug(`缓存命中: ${cacheKey}, 年龄: ${cached.age}ms`)
      this.recordInputPattern(input)
      return cached.value
    }

    // 缓存未命中，计算建议
    this.performanceStats.cacheMisses++
    const allSuggestions = []

    // 获取脚本库建议
    if (this.config.enableScriptCompletion) {
      try {
        const scriptSuggestions = scriptLibraryService.getSimpleCommandSuggestionsSync(
          input,
          this.config.maxWordsPerType
        )

        // 添加类型标识和调整分数
        const typedScriptSuggestions = scriptSuggestions.map(suggestion => ({
          ...suggestion,
          type: 'script',
          category: 'script',
          score: (suggestion.score || 0) * this.config.scriptCompletionPriority
        }))

        allSuggestions.push(...typedScriptSuggestions)
        log.debug(`获取到 ${scriptSuggestions.length} 个脚本建议`)
      } catch (error) {
        log.warn('获取脚本建议失败:', error)
      }
    }

    // 获取单词补全建议
    if (this.config.enableWordCompletion) {
      try {
        const wordSuggestions = wordCompletionService.getWordSuggestions(
          input,
          this.config.maxWordsPerType,
          context
        )

        // 调整分数
        const typedWordSuggestions = wordSuggestions.map(suggestion => ({
          ...suggestion,
          score: (suggestion.score || 0) * this.config.wordCompletionPriority
        }))

        allSuggestions.push(...typedWordSuggestions)
        log.debug(`获取到 ${wordSuggestions.length} 个单词建议`)
      } catch (error) {
        log.warn('获取单词建议失败:', error)
      }
    }

    // 合并、去重和排序
    const mergedSuggestions = this.mergeSuggestions(allSuggestions, input, context)
    const finalSuggestions = mergedSuggestions.slice(0, this.config.maxSuggestions)

    // 缓存结果
    this.suggestionCache.set(cacheKey, finalSuggestions)

    // 记录输入模式和性能统计
    this.recordInputPattern(input)
    const responseTime = performance.now() - startTime
    this.updatePerformanceStats(startTime)

    // 触发预测性缓存
    this.triggerPredictiveCache(input, context)

    log.debug(`智能混合补全: 输入="${input}", 总建议=${finalSuggestions.length}, 耗时: ${responseTime.toFixed(2)}ms`)

    return finalSuggestions
  }

  /**
   * 获取输入上下文
   * @param {string} input - 当前输入（当前单词）
   * @param {Object} terminal - 终端实例
   * @returns {Object} 上下文信息
   */
  getInputContext(input, terminal) {
    const commandLine = this.inputBuffer
    const currentWord = input

    // 计算当前单词在命令行中的位置
    const wordPosition = this.getWordPosition(commandLine, currentWord)

    const context = {
      input: currentWord,
      commandLine: commandLine,
      position: commandLine.length,
      wordPosition: wordPosition,
      isCommandStart: wordPosition === 0, // 第一个单词是命令
      isParameter: currentWord.startsWith('-'),
      hasSpaces: commandLine.includes(' '),
      terminalInfo: null
    }

    // 尝试获取更多终端上下文
    try {
      if (terminal && terminal.buffer && terminal.buffer.active) {
        const buffer = terminal.buffer.active
        context.terminalInfo = {
          cursorX: buffer.cursorX,
          cursorY: buffer.cursorY,
          cols: buffer.cols,
          rows: buffer.rows
        }
      }
    } catch (error) {
      log.debug('获取终端上下文失败:', error)
    }

    return context
  }

  /**
   * 获取当前单词在命令行中的位置（第几个单词，从0开始）
   * @param {string} commandLine - 完整命令行
   * @param {string} currentWord - 当前单词
   * @returns {number} 单词位置
   */
  getWordPosition(commandLine, currentWord) {
    try {
      if (!commandLine || !currentWord) return 0

      // 定义单词分隔符
      const wordSeparators = /[\s&|;()<>]+/

      // 分割命令行为单词数组
      const words = commandLine.split(wordSeparators).filter(word => word.length > 0)

      // 找到当前单词的位置
      const position = words.length > 0 ? words.length - 1 : 0

      log.debug(`单词位置分析: 命令行="${commandLine}", 单词数组=[${words.join(', ')}], 当前单词="${currentWord}", 位置=${position}`)

      return position

    } catch (error) {
      log.warn('获取单词位置失败:', error)
      return 0
    }
  }

  /**
   * 合并和优化建议 - 高性能版本
   * @param {Array} suggestions - 所有建议
   * @param {string} input - 用户输入
   * @param {Object} context - 上下文
   * @returns {Array} 优化后的建议列表
   */
  mergeSuggestions(suggestions, input, context) {
    if (!suggestions.length) return []

    // 使用Map进行高效去重和合并
    const suggestionMap = new Map()
    const inputLower = input.toLowerCase()

    // 预计算类型优先级
    const typePriority = { script: 3, commands: 2, word: 1 }

    for (const suggestion of suggestions) {
      const text = suggestion.text
      const existing = suggestionMap.get(text)

      if (!existing) {
        // 预计算匹配信息
        const matchInfo = this.calculateMatchInfo(suggestion, inputLower)
        suggestionMap.set(text, { ...suggestion, ...matchInfo })
      } else {
        // 保留优先级更高的建议
        const currentPriority = typePriority[suggestion.type] || 0
        const existingPriority = typePriority[existing.type] || 0

        if (currentPriority > existingPriority ||
           (currentPriority === existingPriority && suggestion.score > existing.score)) {
          const matchInfo = this.calculateMatchInfo(suggestion, inputLower)
          suggestionMap.set(text, { ...suggestion, ...matchInfo })
        }
      }
    }

    // 转换为数组
    const uniqueSuggestions = Array.from(suggestionMap.values())

    // 使用优化的排序算法
    const sortedSuggestions = this.optimizedSort(uniqueSuggestions, input, context)

    // 添加调试日志
    if (sortedSuggestions.length > 0) {
      log.debug('排序后的建议列表:', sortedSuggestions.map(s => ({
        text: s.text,
        type: s.type,
        matchType: s.matchType,
        finalScore: s.finalScore,
        originalScore: s.score
      })))
    }

    return sortedSuggestions
  }

  /**
   * 计算匹配信息 - 优化版
   * @param {Object} suggestion - 建议项
   * @param {string} inputLower - 小写的用户输入
   * @returns {Object} 匹配信息
   */
  calculateMatchInfo(suggestion, inputLower) {
    const textLower = suggestion.text.toLowerCase()

    // 计算匹配类型
    let matchType = 'contains'
    if (textLower === inputLower) {
      matchType = 'exact'
    } else if (textLower.startsWith(inputLower)) {
      matchType = 'prefix'
    }

    // 计算匹配分数
    let matchScore = suggestion.score || 0

    // 根据匹配类型调整分数
    switch (matchType) {
      case 'exact':
        matchScore *= 2.0
        break
      case 'prefix':
        matchScore *= 1.5
        break
      case 'contains':
        matchScore *= 1.0
        break
    }

    // 根据类型调整分数
    const typeMultiplier = { script: 1.2, commands: 1.1, word: 1.0 }
    matchScore *= (typeMultiplier[suggestion.type] || 1.0)

    return {
      matchType,
      finalScore: matchScore,
      sortKey: this.getSortKey(matchType, suggestion.type, matchScore)
    }
  }

  /**
   * 获取排序键
   * @param {string} matchType - 匹配类型
   * @param {string} suggestionType - 建议类型
   * @param {number} score - 分数
   * @returns {number} 排序键
   */
  getSortKey(matchType, suggestionType, score) {
    // 使用位运算优化排序键计算
    let key = 0

    // 匹配类型权重 (高16位)
    const matchWeight = { exact: 3, prefix: 2, contains: 1 }
    key |= (matchWeight[matchType] || 0) << 16

    // 建议类型权重 (中8位)
    const typeWeight = { script: 3, commands: 2, word: 1 }
    key |= (typeWeight[suggestionType] || 0) << 8

    // 分数权重 (低8位，限制在0-255)
    key |= Math.min(255, Math.max(0, Math.floor(score)))

    return key
  }

  /**
   * 优化的排序算法
   * @param {Array} suggestions - 建议列表
   * @param {string} input - 用户输入
   * @param {Object} context - 上下文
   * @returns {Array} 排序后的建议
   */
  optimizedSort(suggestions, input, context) {
    // 使用预计算的排序键进行快速排序
    return suggestions.sort((a, b) => {
      // 首先按排序键排序（降序）
      const keyDiff = b.sortKey - a.sortKey
      if (keyDiff !== 0) return keyDiff

      // 如果排序键相同，按最终分数排序
      const scoreDiff = b.finalScore - a.finalScore
      if (scoreDiff !== 0) return scoreDiff

      // 最后按字母顺序排序
      return a.text.localeCompare(b.text)
    })
  }

  /**
   * 获取匹配类型
   * @param {Object} suggestion - 建议项
   * @param {string} input - 用户输入
   * @returns {string} 匹配类型
   */
  getMatchType(suggestion, input) {
    const inputLower = input.toLowerCase().trim()
    const textLower = suggestion.text.toLowerCase()

    if (suggestion.type === 'script') {
      // 脚本类型的匹配判断

      // 1. 检查完全匹配（脚本命令与输入完全相同）
      if (textLower === inputLower) {
        return 'script_exact'
      }

      // 2. 检查前缀匹配（脚本命令以输入开头）
      if (textLower.startsWith(inputLower)) {
        return 'script_exact'  // 前缀匹配也视为精确匹配，因为这是用户最可能想要的
      }

      // 3. 检查命令开头匹配（脚本的第一个单词匹配输入）
      const firstCommand = textLower.split(/\s+/)[0] // 获取第一个命令
      if (firstCommand === inputLower || firstCommand.startsWith(inputLower)) {
        return 'script_exact'  // 命令开头匹配也视为精确匹配
      }

      // 4. 检查包含匹配
      if (textLower.includes(inputLower)) {
        return 'script_contains'
      }
    } else if (suggestion.type === 'word') {
      // 单词类型的匹配
      return 'word_match'
    }

    return 'other'
  }

  /**
   * 获取类型排序优先级
   * @param {string} matchType - 匹配类型
   * @param {string} suggestionType - 建议类型
   * @returns {number} 排序优先级（数字越小优先级越高）
   */
  getTypeOrder(matchType, suggestionType) {
    // 排序优先级：完全匹配脚本 > 单词补全 > 包含匹配脚本
    const orderMap = {
      'script_exact': 1,      // 脚本完全匹配 - 最高优先级
      'word_match': 2,        // 单词补全 - 中等优先级
      'script_contains': 3,   // 脚本包含匹配 - 最低优先级
      'other': 4              // 其他 - 最低
    }

    return orderMap[matchType] || 4
  }

  /**
   * 计算最终分数
   * @param {Object} suggestion - 建议项
   * @param {string} input - 用户输入
   * @param {Object} context - 上下文
   * @param {string} matchType - 匹配类型
   * @returns {number} 最终分数
   */
  calculateFinalScore(suggestion, input, context, matchType) {
    const inputLower = input.toLowerCase().trim()
    const textLower = suggestion.text.toLowerCase()

    // 根据匹配类型设置基础分数
    const baseScores = {
      'script_exact': 10000,    // 脚本精确匹配基础分数最高
      'word_match': 1000,       // 单词补全中等分数
      'script_contains': 500,   // 脚本包含匹配基础分数较低
      'other': 100
    }

    // 使用匹配类型的基础分数
    let score = baseScores[matchType] || 100

    // 对于脚本类型，添加额外的匹配精度加分
    if (suggestion.type === 'script') {
      // 完全匹配加分
      if (textLower === inputLower) {
        score += 5000
      }
      // 前缀匹配加分
      else if (textLower.startsWith(inputLower)) {
        score += 3000
      }
      // 命令开头匹配加分
      else {
        const firstCommand = textLower.split(/\s+/)[0]
        if (firstCommand === inputLower) {
          score += 4000
        } else if (firstCommand.startsWith(inputLower)) {
          score += 2000
        }
      }

      // 脚本原始分数加权（来自脚本库的相关性分数）
      if (suggestion.score) {
        score += suggestion.score * 10
      }
    }

    // 对于单词类型的精确匹配加分
    if (suggestion.type === 'word') {
      if (textLower === inputLower) {
        score += 500
      } else if (textLower.startsWith(inputLower)) {
        score += 300
      }
    }

    // 应用上下文权重
    score *= this.getContextWeight(suggestion, input, context)

    // 输入长度加分（更短的输入匹配更长的命令应该得到更高分数）
    if (inputLower.length > 0) {
      const matchRatio = inputLower.length / textLower.length
      if (matchRatio > 0.1) { // 避免除零和过小的比例
        score += (1 - matchRatio) * 100
      }
    }

    return Math.round(score)
  }

  /**
   * 获取上下文权重
   * @param {Object} suggestion - 建议项
   * @param {string} input - 用户输入
   * @param {Object} context - 上下文
   * @returns {number} 权重值
   */
  getContextWeight(suggestion, input, context) {
    let weight = 1.0

    // 命令开始位置，优先命令类型
    if (context.isCommandStart && suggestion.category === 'commands') {
      weight *= 1.2
    }

    // 参数位置，优先选项类型
    if (context.isParameter && suggestion.category === 'options') {
      weight *= 1.3
    }

    // 检查特定上下文
    if (context.commandLine) {
      const commandLine = context.commandLine.toLowerCase()

      // Git 上下文
      if (commandLine.includes('git') && suggestion.category === 'development') {
        weight *= 1.2
      }

      // Docker 上下文
      if ((commandLine.includes('docker') || commandLine.includes('kubectl')) &&
          suggestion.category === 'development') {
        weight *= 1.2
      }

      // 网络命令上下文
      if (this.config.contextDetection.commandPrefixes.some(prefix =>
          commandLine.includes(prefix)) && suggestion.category === 'network') {
        weight *= 1.1
      }
    }

    return weight
  }

  /**
   * 计算建议框位置
   * @param {Object} terminal - 终端实例
   */
  calculatePosition(terminal) {
    try {
      if (!terminal || !terminal.element) {
        return { x: 0, y: 0 }
      }

      const terminalRect = terminal.element.getBoundingClientRect()
      const buffer = terminal.buffer.active
      
      if (!buffer) {
        return { x: terminalRect.left, y: terminalRect.top + 20 }
      }

      // 计算光标位置
      const charWidth = terminal._core._renderService.dimensions.actualCellWidth || 9
      const charHeight = terminal._core._renderService.dimensions.actualCellHeight || 17

      const x = terminalRect.left + (buffer.cursorX * charWidth)
      const y = terminalRect.top + ((buffer.cursorY + 1) * charHeight)

      return { x, y }

    } catch (error) {
      log.warn('计算自动完成位置失败:', error)
      return { x: 0, y: 0 }
    }
  }

  /**
   * 隐藏建议
   */
  hideSuggestions() {
    if (!this.isActive) {
      return // 如果已经隐藏，直接返回
    }

    this.isActive = false
    this.suggestions = []
    this.selectedIndex = -1  // 重置选中索引
    this.lastPosition = null // 清除位置缓存

    // 取消所有防抖任务
    this.smartDebounce.cancelAll()

    if (this.callbacks.onSuggestionsUpdate) {
      this.callbacks.onSuggestionsUpdate([], { x: 0, y: 0 }, -1)
    }

    log.debug('补全建议已隐藏')
  }

  /**
   * 重置自动完成状态
   */
  reset() {
    this.inputBuffer = ''
    this.selectedIndex = -1
    this.hideSuggestions()
    log.debug('自动完成状态已重置')
  }

  /**
   * 获取当前选中的建议
   */
  getSelectedSuggestion() {
    if (this.selectedIndex >= 0 && this.selectedIndex < this.suggestions.length) {
      return this.suggestions[this.selectedIndex]
    }
    return null
  }

  /**
   * 选择建议
   * @param {Object} suggestion - 选中的建议
   * @param {Object} terminal - 终端实例
   */
  selectSuggestion(suggestion, terminal) {
    try {
      if (!suggestion || !terminal) return

      log.debug(`选择建议: "${suggestion.text}", 类型: ${suggestion.type}`)

      // 根据建议类型决定行为
      if (suggestion.type === 'script') {
        // 脚本类型：覆盖整个输入行
        this.handleScriptSelection(suggestion, terminal)
      } else {
        // 系统命令类型：只补全当前单词
        this.handleWordCompletion(suggestion, terminal)
      }

      // 立即隐藏建议并重置状态
      this.hideSuggestions()

      log.debug(`补全完成，输入缓冲区: "${this.inputBuffer}"`)

    } catch (error) {
      log.error('选择自动完成建议失败:', error)
    }
  }

  /**
   * 处理脚本选择 - 覆盖整个输入行
   * @param {Object} suggestion - 脚本建议
   * @param {Object} terminal - 终端实例
   */
  handleScriptSelection(suggestion, terminal) {
    try {
      const currentInput = this.getCurrentLineInput()

      if (currentInput) {
        // 清除整个当前输入行
        const inputLength = currentInput.length
        for (let i = 0; i < inputLength; i++) {
          terminal._core.coreService.triggerDataEvent('\x08') // Backspace
        }
      }

      // 输入脚本命令
      terminal._core.coreService.triggerDataEvent(suggestion.text)

      // 更新输入缓冲区为脚本命令
      this.inputBuffer = suggestion.text

      log.debug(`脚本覆盖完成: "${suggestion.text}"`)

    } catch (error) {
      log.error('处理脚本选择失败:', error)
    }
  }

  /**
   * 处理系统命令补全 - 只补全当前单词
   * @param {Object} suggestion - 单词建议
   * @param {Object} terminal - 终端实例
   */
  handleWordCompletion(suggestion, terminal) {
    try {
      // 获取当前正在输入的单词
      const currentWord = this.getCurrentWord()
      const currentInput = this.getCurrentLineInput()

      if (currentWord && currentInput) {
        // 计算当前单词在输入缓冲区中的位置
        const wordStart = this.getCurrentWordStartPosition()

        // 只删除当前单词的字符数
        const wordLength = currentWord.length
        for (let i = 0; i < wordLength; i++) {
          terminal._core.coreService.triggerDataEvent('\x08') // Backspace
        }

        // 输入选中的建议文本
        terminal._core.coreService.triggerDataEvent(suggestion.text)

        // 更新输入缓冲区：替换当前单词
        const beforeWord = currentInput.substring(0, wordStart)
        const afterWord = currentInput.substring(wordStart + wordLength)
        this.inputBuffer = beforeWord + suggestion.text + afterWord

        log.debug(`单词补全完成: "${currentWord}" -> "${suggestion.text}"`)

      } else {
        // 如果没有当前单词，直接输入建议
        terminal._core.coreService.triggerDataEvent(suggestion.text)
        this.inputBuffer = suggestion.text
      }

    } catch (error) {
      log.error('处理单词补全失败:', error)
    }
  }

  /**
   * 获取当前单词在输入缓冲区中的开始位置
   * @returns {number} 单词开始位置
   */
  getCurrentWordStartPosition() {
    try {
      const input = this.inputBuffer
      if (!input) return 0

      // 定义单词分隔符
      const wordSeparators = /[\s&|;()<>]/

      // 从输入缓冲区的末尾向前查找，找到当前正在输入的单词的开始位置
      for (let i = input.length - 1; i >= 0; i--) {
        if (wordSeparators.test(input[i])) {
          return i + 1
        }
      }

      // 如果没有找到分隔符，说明当前单词从开头开始
      return 0

    } catch (error) {
      log.warn('获取当前单词开始位置失败:', error)
      return 0
    }
  }

  /**
   * 生成缓存键
   * @param {string} input - 用户输入
   * @param {Object} context - 上下文信息
   * @returns {string} 缓存键
   */
  generateCacheKey(input, context) {
    const contextKey = JSON.stringify({
      isCommandStart: context.isCommandStart,
      isParameter: context.isParameter,
      hasSpaces: context.hasSpaces,
      wordPosition: context.wordPosition
    })
    return `suggestions:${input}:${contextKey}`
  }

  /**
   * 记录用户输入模式
   * @param {string} input - 用户输入
   */
  recordInputPattern(input) {
    if (input.length < 2) return

    const pattern = input.substring(0, Math.min(input.length, 3))
    const count = this.inputPatterns.get(pattern) || 0
    this.inputPatterns.set(pattern, count + 1)

    // 限制模式记录数量
    if (this.inputPatterns.size > 100) {
      const entries = Array.from(this.inputPatterns.entries())
      entries.sort((a, b) => a[1] - b[1]) // 按使用频率排序
      const toDelete = entries.slice(0, 20) // 删除最少使用的20个
      toDelete.forEach(([key]) => this.inputPatterns.delete(key))
    }
  }

  /**
   * 更新性能统计
   * @param {number} startTime - 开始时间
   */
  updatePerformanceStats(startTime) {
    const responseTime = performance.now() - startTime
    this.performanceStats.totalRequests++

    // 计算平均响应时间
    this.performanceStats.avgResponseTime =
      (this.performanceStats.avgResponseTime * (this.performanceStats.totalRequests - 1) + responseTime) /
      this.performanceStats.totalRequests
  }

  /**
   * 触发预测性缓存
   * @param {string} input - 当前输入
   * @param {Object} context - 上下文
   */
  triggerPredictiveCache(input, context) {
    // 基于输入模式预测可能的下一个字符
    const predictions = this.getPredictedInputs(input)

    // 异步预加载预测的建议
    setTimeout(() => {
      predictions.forEach(predictedInput => {
        const predictedCacheKey = this.generateCacheKey(predictedInput, context)
        if (!this.suggestionCache.has(predictedCacheKey)) {
          // 在后台计算预测的建议
          this.computePredictiveSuggestions(predictedInput, context)
        }
      })
    }, 100) // 延迟100ms执行，避免阻塞主线程
  }

  /**
   * 获取预测的输入
   * @param {string} input - 当前输入
   * @returns {Array} 预测的输入列表
   */
  getPredictedInputs(input) {
    const predictions = []

    // 基于常见字符预测
    const commonChars = ['a', 'e', 'i', 'o', 'u', 's', 't', 'n', 'r', 'l']
    commonChars.forEach(char => {
      predictions.push(input + char)
    })

    // 基于历史模式预测
    for (const [pattern, count] of this.inputPatterns) {
      if (pattern.startsWith(input) && pattern.length > input.length) {
        predictions.push(pattern)
      }
    }

    return predictions.slice(0, 5) // 限制预测数量
  }

  /**
   * 计算预测性建议
   * @param {string} input - 预测的输入
   * @param {Object} context - 上下文
   */
  async computePredictiveSuggestions(input, context) {
    try {
      // 简化的建议计算，只获取最相关的建议
      const suggestions = []

      if (this.config.enableScriptCompletion) {
        const scriptSuggestions = scriptLibraryService.getSimpleCommandSuggestionsSync(
          input,
          Math.min(3, this.config.maxWordsPerType)
        )
        suggestions.push(...scriptSuggestions.map(s => ({ ...s, type: 'script' })))
      }

      if (suggestions.length > 0) {
        const cacheKey = this.generateCacheKey(input, context)
        this.suggestionCache.set(cacheKey, suggestions.slice(0, 3))
        log.debug(`预测性缓存: ${input} -> ${suggestions.length} 个建议`)
      }
    } catch (error) {
      log.warn('预测性缓存计算失败:', error)
    }
  }

  /**
   * 获取缓存统计信息
   * @returns {Object} 缓存统计
   */
  getCacheStats() {
    return {
      cache: this.suggestionCache.getStats(),
      performance: { ...this.performanceStats },
      patterns: this.inputPatterns.size,
      debounce: this.smartDebounce.getStats()
    }
  }

  /**
   * 清理缓存
   */
  clearCache() {
    this.suggestionCache.clear()
    this.predictiveCache.clear()
    this.inputPatterns.clear()
    this.performanceStats = {
      cacheHits: 0,
      cacheMisses: 0,
      avgResponseTime: 0,
      totalRequests: 0
    }
    log.debug('缓存已清理')
  }

  /**
   * 销毁服务
   */
  destroy() {
    // 销毁智能防抖
    if (this.smartDebounce) {
      this.smartDebounce.destroy()
    }

    // 销毁缓存
    if (this.suggestionCache) {
      this.suggestionCache.destroy()
    }

    this.hideSuggestions()
    this.callbacks = {}
    this.clearCache()
  }
}

// 创建单例实例
const terminalAutocompleteService = new TerminalAutocompleteService()

export default terminalAutocompleteService
