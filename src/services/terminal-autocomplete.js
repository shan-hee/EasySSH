/**
 * 终端自动完成服务
 * 处理终端输入的自动完成功能
 */
import scriptLibraryService from './scriptLibrary'
import wordCompletionService from './word-completion'
import log from './log'
import { useUserStore } from '@/store/user'
import { autocompleteConfig } from '@/config/app-config'
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

    // 补全完成后是否需要重置输入缓冲区的标志
    this._shouldResetOnNextInput = false

    // 回调函数
    this.callbacks = {
      onSuggestionsUpdate: null,
      onPositionUpdate: null
    }

    // 智能防抖系统 - 优化配置
    this.smartDebounce = new SmartDebounce({
      defaultDelay: autocompleteConfig.debounceDelay,
      minDelay: 0,
      maxDelay: 300, // 降低最大延迟
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

    // 高优先级防抖函数（用于删除操作）- 优化为零延迟
    this.debouncedUpdateHighPriority = this.smartDebounce.create(
      this.updateSuggestions.bind(this),
      {
        key: 'updateSuggestionsHighPriority',
        delay: 0,
        priority: 2,
        adaptive: false,
        immediate: true
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
      minInputLength: autocompleteConfig.minInputLength,
      debounceDelay: autocompleteConfig.debounceDelay,
      maxSuggestions: autocompleteConfig.maxSuggestions,
      enableWordCompletion: autocompleteConfig.enableWordCompletion,
      enableScriptCompletion: autocompleteConfig.enableScriptCompletion,
      wordCompletionPriority: autocompleteConfig.wordCompletionPriority,
      scriptCompletionPriority: autocompleteConfig.scriptCompletionPriority,
      maxWordsPerType: autocompleteConfig.maxWordsPerType,
      contextDetection: autocompleteConfig.contextDetection
    }

    // 用户存储引用
    this.userStore = null

    // 装饰器锚点相关（用于精准定位补全框）
    this._decoration = null
    this._marker = null
    this._anchorElement = null
    this._decorationSupported = undefined
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
      // 检查服务是否启用
      if (!this.isEnabled()) {
        return false
      }

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

      // 获取当前正在输入的单词
      const currentWord = this.getCurrentWord()

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

    switch (charCode) {
      case 8:   // Backspace
      case 127: // DEL
        const needsUpdate = this.handleBackspace()

        // 优化：如果不需要更新建议，直接返回，避免不必要的处理
        if (!needsUpdate) {
          return false
        }

        // 获取删除后的当前单词
        const currentWord = this.getCurrentWord()

        // 如果需要更新建议且当前单词满足条件，立即更新
        if (currentWord && currentWord.length >= this.config.minInputLength) {
          this.debouncedUpdateHighPriority(currentWord, terminal)
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
   * 处理退格键 - 优化版本
   */
  handleBackspace() {
    if (this.inputBuffer.length > 0) {
      this.inputBuffer = this.inputBuffer.slice(0, -1)
    }

    // 获取当前单词
    const currentWord = this.getCurrentWord()

    // 如果当前单词为空或太短，立即隐藏建议
    if (!currentWord || currentWord.length < this.config.minInputLength) {
      this.hideSuggestions()
      return false
    }

    // 如果补全框当前是激活状态，需要重新计算建议
    if (this.isActive) {
      // 重新计算建议，确保建议与当前输入匹配
      return true // 返回true表示需要在外部重新计算建议
    }

    return false
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

    // 重要修复：无论补全框是否激活，回车键都应该清空输入缓冲区
    // 因为回车意味着命令已经执行，需要重新开始跟踪新的输入
    this.inputBuffer = ''
    this._shouldResetOnNextInput = false

    // 如果补全框是激活的，隐藏建议框
    if (this.isActive) {
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
  handleAnsiSequence(data, _terminal) {
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
    if (!this.isActive || this.suggestions.length === 0) {
      return
    }

    this.selectedIndex = this.selectedIndex <= 0
      ? this.suggestions.length - 1  // 循环到最后一项
      : this.selectedIndex - 1

    this.updateSuggestionsDisplay(terminal)
  }

  /**
   * 向下导航建议列表
   */
  navigateDown(terminal) {
    if (!this.isActive || this.suggestions.length === 0) {
      return
    }

    this.selectedIndex = this.selectedIndex >= this.suggestions.length - 1
      ? 0  // 循环到第一项
      : this.selectedIndex + 1

    this.updateSuggestionsDisplay(terminal)
  }

  /**
   * 更新建议显示（包含选中状态）
   */
  updateSuggestionsDisplay(terminal = null) {
    try {
      // 确保建议框仍然是激活状态
      if (!this.isActive || this.suggestions.length === 0) {
        return
      }

      if (this.callbacks.onSuggestionsUpdate) {
        // 使用装饰器锚点位置，若不可用回退
        let position = this.lastPosition || { x: 0, y: 0 }
        if (terminal) {
          this._ensureDecoration(terminal)
          position = this._getAnchorPosition(terminal) || this.calculatePosition(terminal)
          this.lastPosition = position
        }
        this.callbacks.onSuggestionsUpdate(this.suggestions, position, this.selectedIndex)
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
      // 检查是否需要重置输入缓冲区（补全完成后的第一次输入）
      if (this._shouldResetOnNextInput) {
        // 重置缓冲区，从新字符开始重新跟踪
        this.inputBuffer = data
        this._shouldResetOnNextInput = false
      } else {
        // 正常追加字符
        this.inputBuffer += data
      }
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
      this._ensureDecoration(terminal)
      const position = this._getAnchorPosition(terminal) || this.calculatePosition(terminal)
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
   * 获取智能混合建议
   * @param {string} input - 用户输入
   * @param {Object} terminal - 终端实例
   * @returns {Array} 混合建议列表
   */
  getCombinedSuggestions(input, terminal) {
    // 获取输入上下文
    const context = this.getInputContext(input, terminal)
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
      } catch (error) {
        log.warn('获取单词建议失败:', error)
      }
    }

    // 合并、去重和排序
    const mergedSuggestions = this.mergeSuggestions(allSuggestions, input, context)
    const finalSuggestions = mergedSuggestions.slice(0, this.config.maxSuggestions)

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
  optimizedSort(suggestions, _input, _context) {
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
  getTypeOrder(matchType, _suggestionType) {
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
  getContextWeight(suggestion, _input, context) {
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

      // 优先使用终端视口，避免内部滚动/内边距带来的偏差
      const viewportEl = terminal.element.querySelector('.xterm-viewport')
      const baseRect = (viewportEl || terminal.element).getBoundingClientRect()
      const buffer = terminal.buffer.active
      
      if (!buffer) {
        return { x: baseRect.left, y: baseRect.top + 20 }
      }

      // 计算光标位置（以CSS像素为单位，兼容高DPI/缩放）
      const dims = terminal._core && terminal._core._renderService && terminal._core._renderService.dimensions
      const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1
      const cssCellWidth = (dims && dims.css && dims.css.cell && dims.css.cell.width) || null
      const cssCellHeight = (dims && dims.css && dims.css.cell && dims.css.cell.height) || null
      const actualCellWidth = (dims && dims.actualCellWidth) || 9
      const actualCellHeight = (dims && dims.actualCellHeight) || 17
      const charWidth = cssCellWidth != null ? cssCellWidth : (actualCellWidth / dpr)
      const charHeight = cssCellHeight != null ? cssCellHeight : (actualCellHeight / dpr)

      const x = Math.round(baseRect.left + (buffer.cursorX * charWidth))
      const y = Math.round(baseRect.top + ((buffer.cursorY + 1) * charHeight))

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

    // 释放装饰器锚点
    this._disposeDecoration()

    if (this.callbacks.onSuggestionsUpdate) {
      this.callbacks.onSuggestionsUpdate([], { x: 0, y: 0 }, -1)
    }
  }

  /**
   * 重置自动完成状态
   */
  reset() {
    this.inputBuffer = ''
    this.selectedIndex = -1
    this._shouldResetOnNextInput = false
    this.hideSuggestions()
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

      } else {
        // 如果没有当前单词，直接输入建议
        terminal._core.coreService.triggerDataEvent(suggestion.text)
        this.inputBuffer = suggestion.text
      }

      // 重要：补全完成后，重置输入缓冲区为当前终端显示的内容
      // 这样可以确保后续输入能够正确追加，而不是基于旧的缓冲区状态
      this.resetInputBufferAfterCompletion()

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
   * 补全完成后重置输入缓冲区
   * 这个方法确保输入缓冲区与终端实际显示的内容同步
   */
  resetInputBufferAfterCompletion() {
    try {
      // 关键修复：在补全完成后，我们需要标记一个状态
      // 表示下一次输入应该重新开始跟踪，而不是追加到当前缓冲区
      this._shouldResetOnNextInput = true

    } catch (error) {
      log.error('重置输入缓冲区失败:', error)
    }
  }





  /**
   * 销毁服务
   */
  destroy() {
    // 销毁智能防抖
    if (this.smartDebounce) {
      this.smartDebounce.destroy()
    }

    this.hideSuggestions()
    this.callbacks = {}

    // 清理AI相关资源
    this.cleanupAI()

    // 释放装饰器
    this._disposeDecoration()
  }



  /**
   * 启用整个补全服务
   */
  enable() {
    this.isActive = false // 重置状态，但允许处理输入
    this._enabled = true
    log.debug('智能补全服务已启用')
  }

  /**
   * 禁用整个补全服务
   */
  disable() {
    this.isActive = false
    this._enabled = false
    this.hideSuggestions()
    log.debug('智能补全服务已禁用')
  }

  /**
   * 检查服务是否启用
   */
  isEnabled() {
    return this._enabled !== false // 默认启用
  }


  /**
   * 确保创建并维护基于装饰器的锚点
   */
  _ensureDecoration(terminal) {
    try {
      if (!terminal || !terminal.element) return

      // 首次检测是否支持装饰器
      if (this._decorationSupported === undefined) {
        this._decorationSupported = typeof terminal.registerDecoration === 'function'
      }
      if (!this._decorationSupported) return

      const buffer = terminal.buffer?.active
      if (!buffer) return

      const cursorX = buffer.cursorX || 0

      // 若已有装饰器，尝试更新列；若不可更新则重建
      if (this._decoration) {
        try {
          if (typeof this._decoration.updateOptions === 'function') {
            this._decoration.updateOptions({ x: cursorX })
            return
          }
        } catch (_) {}
        this._disposeDecoration()
      }

      // 使用 marker 锚定当前行
      let marker = null
      try {
        if (typeof terminal.registerMarker === 'function') {
          marker = terminal.registerMarker(0)
        }
      } catch (_) {}

      // 注册装饰器
      try {
        const options = marker ? { marker, x: cursorX } : { x: cursorX }
        const decoration = terminal.registerDecoration(options)
        if (decoration) {
          this._decoration = decoration
          this._marker = marker
          if (typeof decoration.onRender === 'function') {
            // 使用 rAF 节流，避免在 xterm 渲染帧内触发多次 Vue 更新
            let rafId = null
            decoration.onRender((el) => {
              try {
                if (!el) return
                if (rafId) cancelAnimationFrame(rafId)
                rafId = requestAnimationFrame(() => {
                  this._anchorElement = el
                  el.style.width = '0px'
                  el.style.height = '0px'
                  el.style.pointerEvents = 'none'
                  el.style.opacity = '0'

                  const rect = el.getBoundingClientRect()
                  if (rect && this.isActive && this.suggestions.length > 0) {
                    // 将Y定位到字符格底部（rect为锚点元素自身，height为0，需加上单元格高度）
                    const dims = terminal._core && terminal._core._renderService && terminal._core._renderService.dimensions
                    const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1
                    const cssCellHeight = (dims && dims.css && dims.css.cell && dims.css.cell.height) || null
                    const actualCellHeight = (dims && dims.actualCellHeight) || 17
                    const charHeight = cssCellHeight != null ? cssCellHeight : (actualCellHeight / dpr)
                    const verticalOffset = 0
                    const pos = { x: Math.round(rect.left), y: Math.round(rect.top + charHeight + verticalOffset), cellHeight: charHeight }
                    this.lastPosition = pos
                    if (this.callbacks.onSuggestionsUpdate) {
                      this.callbacks.onSuggestionsUpdate(this.suggestions, pos, this.selectedIndex)
                    }
                  }
                })
              } catch (_) {}
            })
          }
        }
      } catch (e) {
        this._decorationSupported = false
      }
    } catch (_) {}
  }

  /**
   * 获取锚点位置
   */
  _getAnchorPosition(_terminal) {
    try {
      if (!this._anchorElement) return null
      const rect = this._anchorElement.getBoundingClientRect()
      if (!rect) return null
      return { x: Math.round(rect.left), y: Math.round(rect.bottom) }
    } catch (_) {
      return null
    }
  }

  /**
   * 释放装饰器锚点
   */
  _disposeDecoration() {
    try {
      if (this._decoration && typeof this._decoration.dispose === 'function') {
        this._decoration.dispose()
      }
    } catch (_) {}
    this._decoration = null
    this._marker = null
    this._anchorElement = null
  }

}

// 创建单例实例
const terminalAutocompleteService = new TerminalAutocompleteService()

export default terminalAutocompleteService
