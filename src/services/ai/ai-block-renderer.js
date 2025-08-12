/**
 * AI块渲染器
 * 负责在终端中渲染AI解释、修复建议等块状内容
 */

import log from '../log'

class AIBlockRenderer {
  constructor(terminal) {
    this.terminal = terminal
    this.activeBlocks = new Map()
    this.blockCounter = 0
    
    // 样式配置
    this.styles = {
      container: {
        backgroundColor: 'rgba(0, 100, 200, 0.1)',
        border: '1px solid rgba(0, 100, 200, 0.3)',
        borderRadius: '4px',
        padding: '8px',
        margin: '4px 0',
        fontFamily: 'inherit',
        fontSize: 'inherit',
        lineHeight: '1.4'
      },
      header: {
        color: '#4A90E2',
        fontWeight: 'bold',
        marginBottom: '4px',
        fontSize: '0.9em'
      },
      content: {
        color: '#E8E8E8',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word'
      },
      actions: {
        marginTop: '8px',
        display: 'flex',
        gap: '8px',
        flexWrap: 'wrap'
      },
      button: {
        backgroundColor: 'rgba(74, 144, 226, 0.2)',
        border: '1px solid rgba(74, 144, 226, 0.5)',
        borderRadius: '3px',
        padding: '4px 8px',
        color: '#4A90E2',
        cursor: 'pointer',
        fontSize: '0.8em',
        transition: 'all 0.2s ease'
      }
    }
    
    log.debug('AI块渲染器已初始化')
  }

  /**
   * 渲染AI块
   * @param {Object} content 内容对象
   * @param {Object} options 渲染选项
   * @returns {string} 块ID
   */
  render(content, options = {}) {
    try {
      const blockId = `ai-block-${++this.blockCounter}`
      
      // 获取当前光标位置
      const buffer = this.terminal.buffer.active
      const cursorY = buffer.cursorY

      // 创建标记器
      const marker = this.terminal.registerMarker(0)
      if (!marker) {
        log.warn('无法创建终端标记器')
        return null
      }

      // 创建装饰
      const decoration = this.terminal.registerDecoration({
        marker,
        x: 0,
        width: this.terminal.cols,
        height: this.calculateBlockHeight(content),
        layer: 'top'
      })

      if (!decoration) {
        log.warn('无法创建终端装饰')
        marker.dispose()
        return null
      }

      // 存储块信息
      const blockInfo = {
        id: blockId,
        marker,
        decoration,
        content,
        options,
        createdAt: Date.now()
      }

      this.activeBlocks.set(blockId, blockInfo)

      // 设置渲染回调
      decoration.onRender((element) => {
        this.renderBlockElement(element, blockInfo)
      })

      log.debug('AI块已渲染', { blockId, type: content.type })
      return blockId

    } catch (error) {
      log.error('渲染AI块失败', error)
      return null
    }
  }

  /**
   * 渲染块DOM元素
   * @param {HTMLElement} element DOM元素
   * @param {Object} blockInfo 块信息
   */
  renderBlockElement(element, blockInfo) {
    try {
      const { content, options } = blockInfo

      // 清空元素
      element.innerHTML = ''

      // 创建容器
      const container = document.createElement('div')
      Object.assign(container.style, this.styles.container, options.containerStyles || {})
      container.className = 'ai-block-container'
      container.setAttribute('data-block-id', blockInfo.id)

      // 创建头部
      if (content.title || content.type) {
        const header = document.createElement('div')
        Object.assign(header.style, this.styles.header)
        header.className = 'ai-block-header'
        header.textContent = content.title || this.getTypeTitle(content.type)
        container.appendChild(header)
      }

      // 创建内容区域
      const contentDiv = document.createElement('div')
      Object.assign(contentDiv.style, this.styles.content)
      contentDiv.className = 'ai-block-content'
      
      if (content.html) {
        contentDiv.innerHTML = content.html
      } else {
        contentDiv.textContent = content.text || content.message || ''
      }
      
      container.appendChild(contentDiv)

      // 创建操作按钮
      if (content.actions && content.actions.length > 0) {
        const actionsDiv = document.createElement('div')
        Object.assign(actionsDiv.style, this.styles.actions)
        actionsDiv.className = 'ai-block-actions'

        content.actions.forEach(action => {
          const button = this.createActionButton(action, blockInfo)
          actionsDiv.appendChild(button)
        })

        container.appendChild(actionsDiv)
      }

      // 添加默认操作
      if (!content.actions || content.actions.length === 0) {
        const actionsDiv = document.createElement('div')
        Object.assign(actionsDiv.style, this.styles.actions)
        actionsDiv.className = 'ai-block-actions'

        // 复制按钮
        if (content.text || content.message) {
          const copyButton = this.createActionButton({
            label: '复制',
            action: 'copy',
            data: content.text || content.message
          }, blockInfo)
          actionsDiv.appendChild(copyButton)
        }

        // 关闭按钮
        const closeButton = this.createActionButton({
          label: '关闭',
          action: 'close'
        }, blockInfo)
        actionsDiv.appendChild(closeButton)

        container.appendChild(actionsDiv)
      }

      element.appendChild(container)

    } catch (error) {
      log.error('渲染块元素失败', error)
    }
  }

  /**
   * 创建操作按钮
   * @param {Object} action 操作配置
   * @param {Object} blockInfo 块信息
   * @returns {HTMLElement} 按钮元素
   */
  createActionButton(action, blockInfo) {
    const button = document.createElement('button')
    Object.assign(button.style, this.styles.button)
    button.className = 'ai-block-action-button'
    button.textContent = action.label
    button.setAttribute('data-action', action.action)

    // 添加悬停效果
    button.addEventListener('mouseenter', () => {
      button.style.backgroundColor = 'rgba(74, 144, 226, 0.3)'
    })

    button.addEventListener('mouseleave', () => {
      button.style.backgroundColor = 'rgba(74, 144, 226, 0.2)'
    })

    // 添加点击事件
    button.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.handleAction(action, blockInfo)
    })

    return button
  }

  /**
   * 处理操作
   * @param {Object} action 操作配置
   * @param {Object} blockInfo 块信息
   */
  handleAction(action, blockInfo) {
    try {
      switch (action.action) {
        case 'copy':
          this.copyToClipboard(action.data || blockInfo.content.text || blockInfo.content.message)
          break

        case 'close':
          this.removeBlock(blockInfo.id)
          break

        case 'apply':
          this.applyCommand(action.data)
          break

        case 'explain':
          this.requestExplanation(action.data)
          break

        default:
          if (typeof action.handler === 'function') {
            action.handler(blockInfo, action)
          } else {
            log.warn('未知的操作类型', action.action)
          }
      }

      log.debug('AI块操作已执行', { action: action.action, blockId: blockInfo.id })

    } catch (error) {
      log.error('处理AI块操作失败', error)
    }
  }

  /**
   * 复制到剪贴板
   * @param {string} text 要复制的文本
   */
  async copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        // 降级方案
        const textArea = document.createElement('textarea')
        textArea.value = text
        document.body.appendChild(textArea)
        textArea.select()
        document.execCommand('copy')
        document.body.removeChild(textArea)
      }
      
      log.debug('文本已复制到剪贴板', { length: text.length })
    } catch (error) {
      log.error('复制到剪贴板失败', error)
    }
  }

  /**
   * 应用命令到终端
   * @param {string} command 命令文本
   */
  applyCommand(command) {
    try {
      if (!command) return

      // 将命令写入终端输入
      this.terminal.write(command)
      
      log.debug('命令已应用到终端', { command })
    } catch (error) {
      log.error('应用命令失败', error)
    }
  }

  /**
   * 请求解释
   * @param {string} content 要解释的内容
   */
  requestExplanation(content) {
    try {
      // 这里可以触发AI解释请求
      // 具体实现依赖于AI服务集成
      log.debug('请求AI解释', { content: content?.substring(0, 100) })
    } catch (error) {
      log.error('请求解释失败', error)
    }
  }

  /**
   * 移除AI块
   * @param {string} blockId 块ID
   */
  removeBlock(blockId) {
    try {
      const blockInfo = this.activeBlocks.get(blockId)
      if (!blockInfo) {
        log.warn('未找到要移除的AI块', blockId)
        return
      }

      // 清理装饰和标记器
      if (blockInfo.decoration) {
        blockInfo.decoration.dispose()
      }
      if (blockInfo.marker) {
        blockInfo.marker.dispose()
      }

      // 从活跃块列表中移除
      this.activeBlocks.delete(blockId)

      log.debug('AI块已移除', { blockId })

    } catch (error) {
      log.error('移除AI块失败', error)
    }
  }

  /**
   * 清除所有AI块
   */
  clearAll() {
    try {
      for (const blockId of this.activeBlocks.keys()) {
        this.removeBlock(blockId)
      }
      
      log.debug('所有AI块已清除')
    } catch (error) {
      log.error('清除所有AI块失败', error)
    }
  }

  /**
   * 计算块高度
   * @param {Object} content 内容对象
   * @returns {number} 高度（行数）
   */
  calculateBlockHeight(content) {
    try {
      let lines = 1 // 基础高度

      // 标题行
      if (content.title || content.type) {
        lines += 1
      }

      // 内容行
      const text = content.text || content.message || ''
      const contentLines = text.split('\n').length
      lines += contentLines

      // 操作按钮行
      if (content.actions && content.actions.length > 0) {
        lines += 2 // 间距 + 按钮行
      } else {
        lines += 2 // 默认操作按钮
      }

      return Math.min(lines, 10) // 最大10行
    } catch (error) {
      log.error('计算块高度失败', error)
      return 3 // 默认高度
    }
  }

  /**
   * 获取类型标题
   * @param {string} type 内容类型
   * @returns {string} 标题
   */
  getTypeTitle(type) {
    const titles = {
      explanation: 'AI 解释',
      fix: '修复建议',
      generation: '生成的脚本',
      error: '错误信息',
      warning: '警告',
      info: '信息'
    }
    return titles[type] || 'AI 响应'
  }

  /**
   * 更新块样式
   * @param {Object} newStyles 新样式
   */
  updateStyles(newStyles) {
    try {
      this.styles = { ...this.styles, ...newStyles }
      log.debug('AI块样式已更新')
    } catch (error) {
      log.error('更新样式失败', error)
    }
  }

  /**
   * 获取活跃块信息
   * @returns {Array} 活跃块列表
   */
  getActiveBlocks() {
    return Array.from(this.activeBlocks.values()).map(block => ({
      id: block.id,
      type: block.content.type,
      createdAt: block.createdAt,
      title: block.content.title
    }))
  }

  /**
   * 销毁渲染器
   */
  destroy() {
    try {
      this.clearAll()
      this.terminal = null
      
      log.debug('AI块渲染器已销毁')
    } catch (error) {
      log.error('销毁渲染器失败', error)
    }
  }
}

export default AIBlockRenderer
