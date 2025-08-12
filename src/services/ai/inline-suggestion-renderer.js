/**
 * 行内幽灵提示渲染器
 * 负责在终端中渲染AI智能补全的幽灵文本
 */

import log from '../log'

class InlineSuggestionRenderer {
  constructor(terminal) {
    this.terminal = terminal
    this.decoration = null
    this.currentSuggestion = ''
    this.suggestions = []
    this.currentIndex = 0
    this.isVisible = false
    
    // 样式配置
    this.styles = {
      opacity: '0.45',
      color: '#888888',
      fontStyle: 'italic',
      pointerEvents: 'none',
      whiteSpace: 'pre',
      userSelect: 'none'
    }
    
    log.debug('行内幽灵提示渲染器已初始化')
  }

  /**
   * 显示建议
   * @param {Array|string} suggestions 建议列表或单个建议
   * @param {Object} options 显示选项
   */
  show(suggestions, options = {}) {
    try {
      // 清除之前的建议
      this.clear()

      // 处理建议数据
      if (typeof suggestions === 'string') {
        this.suggestions = [suggestions]
      } else if (Array.isArray(suggestions)) {
        this.suggestions = suggestions.filter(s => s && typeof s === 'string')
      } else {
        log.warn('无效的建议数据类型', typeof suggestions)
        return
      }

      if (this.suggestions.length === 0) {
        log.debug('没有有效的建议可显示')
        return
      }

      // 重置索引
      this.currentIndex = 0
      this.currentSuggestion = this.suggestions[0]

      // 渲染建议
      this.render(options)
      
      log.debug('显示AI建议', { 
        count: this.suggestions.length, 
        current: this.currentSuggestion.substring(0, 50) 
      })

    } catch (error) {
      log.error('显示建议失败', error)
    }
  }

  /**
   * 渲染建议到终端
   * @param {Object} options 渲染选项
   */
  render(options = {}) {
    try {
      if (!this.currentSuggestion) {
        log.debug('没有当前建议，跳过渲染')
        return
      }

      log.debug('开始渲染AI建议', {
        suggestion: this.currentSuggestion.substring(0, 50),
        length: this.currentSuggestion.length
      })

      // 使用DOM覆盖层方式实现幽灵文本
      this.renderWithOverlay(options)

    } catch (error) {
      log.error('渲染建议失败', error, {
        suggestion: this.currentSuggestion?.substring(0, 50),
        hasTerminal: !!this.terminal,
        hasBuffer: !!this.terminal?.buffer?.active
      })
    }
  }

  /**
   * 使用DOM覆盖层渲染建议
   * @param {Object} options 渲染选项
   */
  renderWithOverlay(options = {}) {
    try {
      // 获取终端容器
      const terminalElement = this.terminal.element
      if (!terminalElement) {
        log.warn('无法获取终端元素')
        return
      }

      // 获取当前光标位置
      const buffer = this.terminal.buffer.active
      const cursorY = buffer.cursorY
      const cursorX = buffer.cursorX

      log.debug('终端光标位置', { cursorX, cursorY })

      // 计算光标的像素位置
      const cellDimensions = this.getCellDimensions()
      if (!cellDimensions) {
        log.warn('无法获取终端单元格尺寸')
        return
      }

      const pixelX = cursorX * cellDimensions.width
      const pixelY = cursorY * cellDimensions.height

      log.debug('光标像素位置', { pixelX, pixelY, cellDimensions })

      // 创建建议元素
      this.suggestionElement = document.createElement('div')
      this.suggestionElement.textContent = this.currentSuggestion

      // 应用样式
      Object.assign(this.suggestionElement.style, {
        position: 'absolute',
        left: `${pixelX}px`,
        top: `${pixelY}px`,
        color: '#888888',
        opacity: '0.6',
        fontFamily: 'inherit',
        fontSize: 'inherit',
        fontWeight: 'inherit',
        lineHeight: 'inherit',
        pointerEvents: 'none',
        userSelect: 'none',
        whiteSpace: 'pre',
        zIndex: '1000'
      }, this.styles, options.styles || {})

      // 添加CSS类
      this.suggestionElement.className = 'ai-inline-suggestion'

      // 添加到终端容器
      terminalElement.appendChild(this.suggestionElement)

      this.isVisible = true
      log.debug('AI建议DOM覆盖层渲染完成')

    } catch (error) {
      log.error('DOM覆盖层渲染失败', error)
    }
  }

  /**
   * 获取终端单元格尺寸
   * @returns {Object|null} 单元格尺寸
   */
  getCellDimensions() {
    try {
      // 尝试从终端选项获取
      const fontSize = this.terminal.options.fontSize || 14
      const fontFamily = this.terminal.options.fontFamily || 'monospace'

      // 创建测量元素
      const measureElement = document.createElement('div')
      measureElement.style.cssText = `
        position: absolute;
        visibility: hidden;
        font-family: ${fontFamily};
        font-size: ${fontSize}px;
        white-space: pre;
      `
      measureElement.textContent = 'M' // 使用M字符测量

      document.body.appendChild(measureElement)
      const rect = measureElement.getBoundingClientRect()
      document.body.removeChild(measureElement)

      return {
        width: rect.width,
        height: rect.height
      }
    } catch (error) {
      log.error('获取单元格尺寸失败', error)
      return null
    }
  }

  /**
   * 渲染DOM元素
   * @param {HTMLElement} element DOM元素
   * @param {Object} options 渲染选项
   */
  renderElement(element, options = {}) {
    try {
      log.debug('开始渲染DOM元素', {
        hasElement: !!element,
        suggestion: this.currentSuggestion?.substring(0, 50)
      })

      // 设置文本内容
      element.textContent = this.currentSuggestion
      log.debug('文本内容已设置')

      // 应用样式
      Object.assign(element.style, this.styles, options.styles || {})
      log.debug('样式已应用')

      // 添加CSS类
      element.className = 'ai-inline-suggestion'
      log.debug('CSS类已添加')

      // 设置数据属性
      element.setAttribute('data-suggestion-index', this.currentIndex)
      element.setAttribute('data-suggestion-count', this.suggestions.length)
      log.debug('数据属性已设置')

      log.debug('DOM元素渲染完成')

    } catch (error) {
      log.error('渲染DOM元素失败', error, {
        hasElement: !!element,
        suggestion: this.currentSuggestion?.substring(0, 50),
        currentIndex: this.currentIndex,
        suggestionsLength: this.suggestions.length
      })
    }
  }

  /**
   * 清除建议
   */
  clear() {
    try {
      // 清理装饰
      if (this.decoration) {
        this.decoration.dispose()
        this.decoration = null
      }

      // 清理DOM元素
      if (this.suggestionElement) {
        if (this.suggestionElement.parentNode) {
          this.suggestionElement.parentNode.removeChild(this.suggestionElement)
        }
        this.suggestionElement = null
      }

      this.currentSuggestion = ''
      this.suggestions = []
      this.currentIndex = 0
      this.isVisible = false

      log.debug('AI建议已清除')

    } catch (error) {
      log.error('清除建议失败', error)
    }
  }

  /**
   * 接受当前建议
   * @returns {string} 被接受的建议文本
   */
  accept() {
    try {
      const accepted = this.currentSuggestion
      this.clear()
      
      if (accepted) {
        log.debug('AI建议已接受', { text: accepted.substring(0, 50) })
      }
      
      return accepted
    } catch (error) {
      log.error('接受建议失败', error)
      return ''
    }
  }

  /**
   * 切换到下一个建议
   * @returns {boolean} 是否成功切换
   */
  nextSuggestion() {
    try {
      if (this.suggestions.length <= 1) {
        return false
      }

      this.currentIndex = (this.currentIndex + 1) % this.suggestions.length
      this.currentSuggestion = this.suggestions[this.currentIndex]

      // 重新渲染
      this.clear()
      this.render()

      log.debug('切换到下一个建议', { 
        index: this.currentIndex, 
        text: this.currentSuggestion.substring(0, 50) 
      })

      return true
    } catch (error) {
      log.error('切换建议失败', error)
      return false
    }
  }

  /**
   * 切换到上一个建议
   * @returns {boolean} 是否成功切换
   */
  previousSuggestion() {
    try {
      if (this.suggestions.length <= 1) {
        return false
      }

      this.currentIndex = this.currentIndex === 0 
        ? this.suggestions.length - 1 
        : this.currentIndex - 1
      this.currentSuggestion = this.suggestions[this.currentIndex]

      // 重新渲染
      this.clear()
      this.render()

      log.debug('切换到上一个建议', { 
        index: this.currentIndex, 
        text: this.currentSuggestion.substring(0, 50) 
      })

      return true
    } catch (error) {
      log.error('切换建议失败', error)
      return false
    }
  }

  /**
   * 更新建议样式
   * @param {Object} newStyles 新样式
   */
  updateStyles(newStyles) {
    try {
      this.styles = { ...this.styles, ...newStyles }
      
      // 如果当前有显示的建议，重新渲染
      if (this.isVisible) {
        this.render({ styles: newStyles })
      }

      log.debug('建议样式已更新', newStyles)
    } catch (error) {
      log.error('更新样式失败', error)
    }
  }

  /**
   * 获取当前建议信息
   * @returns {Object} 建议信息
   */
  getCurrentInfo() {
    return {
      isVisible: this.isVisible,
      currentSuggestion: this.currentSuggestion,
      currentIndex: this.currentIndex,
      totalCount: this.suggestions.length,
      hasNext: this.suggestions.length > 1,
      hasPrevious: this.suggestions.length > 1
    }
  }

  /**
   * 检查是否有建议显示
   * @returns {boolean} 是否有建议
   */
  hasVisibleSuggestion() {
    return this.isVisible && !!this.currentSuggestion
  }

  /**
   * 获取建议预览（用于调试）
   * @returns {Array} 建议预览列表
   */
  getPreview() {
    return this.suggestions.map((suggestion, index) => ({
      index,
      text: suggestion.substring(0, 100),
      isCurrent: index === this.currentIndex,
      length: suggestion.length
    }))
  }

  /**
   * 设置建议过滤器
   * @param {Function} filterFn 过滤函数
   */
  setFilter(filterFn) {
    try {
      if (typeof filterFn !== 'function') {
        log.warn('过滤器必须是函数')
        return
      }

      this.filter = filterFn
      log.debug('建议过滤器已设置')
    } catch (error) {
      log.error('设置过滤器失败', error)
    }
  }

  /**
   * 应用过滤器到建议列表
   * @param {Array} suggestions 原始建议列表
   * @returns {Array} 过滤后的建议列表
   */
  applyFilter(suggestions) {
    try {
      if (!this.filter || typeof this.filter !== 'function') {
        return suggestions
      }

      return suggestions.filter(this.filter)
    } catch (error) {
      log.error('应用过滤器失败', error)
      return suggestions
    }
  }

  /**
   * 销毁渲染器
   */
  destroy() {
    try {
      this.clear()
      this.terminal = null
      this.filter = null
      
      log.debug('行内幽灵提示渲染器已销毁')
    } catch (error) {
      log.error('销毁渲染器失败', error)
    }
  }
}

export default InlineSuggestionRenderer
