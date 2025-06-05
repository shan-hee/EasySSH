/**
 * 终端自动完成服务
 * 处理终端输入的自动完成功能
 */
import scriptLibraryService from './scriptLibrary'
import log from './log'

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
    
    // 防抖定时器
    this.debounceTimer = null
    
    // 配置
    this.config = {
      minInputLength: 1,
      debounceDelay: 50, // 减少防抖延迟
      maxSuggestions: 8
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

      // 更新输入缓冲区
      this.updateInputBuffer(data)

      log.debug(`自动完成输入处理: "${this.inputBuffer}", 长度: ${this.inputBuffer.length}`)

      // 对于第一个字符，立即显示建议，无延迟
      if (this.inputBuffer.length === 1) {
        this.updateSuggestions(this.inputBuffer, terminal)
      } else {
        // 其他情况使用防抖
        this.debouncedUpdateSuggestions(this.inputBuffer, terminal)
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
        this.handleBackspace()
        // handleBackspace已经处理了隐藏逻辑，这里只需要更新建议
        if (this.inputBuffer.length > 0) {
          this.debouncedUpdateSuggestions(this.inputBuffer, terminal, 20)
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

    // 如果输入缓冲区为空，立即隐藏建议
    if (this.inputBuffer.length === 0) {
      log.debug('输入缓冲区为空，隐藏建议')
      this.hideSuggestions()
    }
  }

  /**
   * 处理回车键
   * @param {Object} terminal - 终端实例
   */
  handleEnter(terminal) {
    // 如果有选中的建议，则选择它
    if (this.isActive && this.selectedIndex >= 0 && this.selectedIndex < this.suggestions.length) {
      const selectedSuggestion = this.suggestions[this.selectedIndex]
      this.selectSuggestion(selectedSuggestion, terminal)
      return true // 表示已处理
    }

    // 否则正常处理回车
    this.inputBuffer = ''
    this.hideSuggestions()
    return false // 表示未处理，让终端正常处理回车
  }

  /**
   * 处理ANSI转义序列
   * @param {string} data - ANSI序列数据
   * @param {Object} terminal - 终端实例
   * @returns {boolean} 是否已处理该输入（true表示阻止默认处理）
   */
  handleAnsiSequence(data, terminal) {
    log.debug(`收到ANSI序列: "${data}", 字节: [${Array.from(data).map(c => c.charCodeAt(0)).join(', ')}]`)

    // 如果建议框是激活状态，处理上下方向键
    if (this.isActive && this.suggestions.length > 0) {
      log.debug(`建议框激活，检查方向键: isActive=${this.isActive}, suggestions.length=${this.suggestions.length}`)

      if (data === '\x1b[A' || data === '\u001b[A') { // 上箭头
        log.debug('检测到上箭头，执行向上导航')
        this.navigateUp(terminal)
        return true // 阻止默认处理
      } else if (data === '\x1b[B' || data === '\u001b[B') { // 下箭头
        log.debug('检测到下箭头，执行向下导航')
        this.navigateDown(terminal)
        return true // 阻止默认处理
      }
    }

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
   * 防抖更新建议
   * @param {string} input - 当前输入
   * @param {Object} terminal - 终端实例
   * @param {number} delay - 自定义延迟时间
   */
  debouncedUpdateSuggestions(input, terminal, delay = null) {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    const actualDelay = delay !== null ? delay : this.config.debounceDelay
    this.debounceTimer = setTimeout(() => {
      this.updateSuggestions(input, terminal)
    }, actualDelay)
  }

  /**
   * 更新建议列表
   * @param {string} input - 当前输入
   * @param {Object} terminal - 终端实例
   */
  updateSuggestions(input, terminal) {
    try {
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

      // 获取建议
      const suggestions = scriptLibraryService.getSimpleCommandSuggestions(
        input.trim(),
        this.config.maxSuggestions
      )

      if (suggestions.length === 0) {
        this.hideSuggestions()
        return
      }

      // 更新建议列表
      this.suggestions = suggestions
      this.selectedIndex = -1  // 重置选中索引
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
    this.isActive = false
    this.suggestions = []
    this.selectedIndex = -1  // 重置选中索引

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

      // 清除当前输入
      const currentInput = this.getCurrentLineInput()
      if (currentInput) {
        // 发送退格键清除当前输入
        for (let i = 0; i < currentInput.length; i++) {
          terminal._core.coreService.triggerDataEvent('\x08') // Backspace
        }
      }

      // 输入选中的命令
      terminal._core.coreService.triggerDataEvent(suggestion.text)
      
      // 隐藏建议
      this.hideSuggestions()
      
      // 清空输入缓冲区
      this.inputBuffer = ''

    } catch (error) {
      log.error('选择自动完成建议失败:', error)
    }
  }

  /**
   * 销毁服务
   */
  destroy() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }
    
    this.hideSuggestions()
    this.callbacks = {}
  }
}

// 创建单例实例
const terminalAutocompleteService = new TerminalAutocompleteService()

export default terminalAutocompleteService
