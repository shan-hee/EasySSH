/**
 * 命令拦截器
 * 负责拦截和处理AI相关的命令前缀
 */

import log from '../log'

class CommandInterceptor {
  constructor(terminal, aiService, sessionId = null) {
    this.terminal = terminal
    this.aiService = aiService
    this.sessionId = sessionId // 会话ID，用于调试
    this.isEnabled = true
    this.inputBuffer = '' // 跟踪用户输入
    this.currentCommand = '' // 当前正在输入的命令

    // AI命令前缀配置
    this.commandPrefixes = {
      '/ai': {
        handler: this.handleAICommand.bind(this),
        description: 'AI命令前缀'
      },
      '/explain': {
        handler: this.handleExplainCommand.bind(this),
        description: '解释最近的输出'
      },
      '/fix': {
        handler: this.handleFixCommand.bind(this),
        description: '修复最近的错误'
      },
      '/gen': {
        handler: this.handleGenerateCommand.bind(this),
        description: '生成脚本'
      }
    }
    
    // 键盘快捷键配置
    this.shortcuts = {
      'Alt+Enter': this.handleExplainShortcut.bind(this),
      'Tab': this.handleTabCompletion.bind(this),
      'Escape': this.handleEscape.bind(this)
    }
    
    // 绑定事件
    this.bindEvents()
    
    log.debug('命令拦截器已初始化')
  }

  /**
   * 绑定终端事件
   */
  bindEvents() {
    try {
      // 监听键盘输入
      this.terminal.onKey(({ key, domEvent }) => {
        if (!this.isEnabled) return

        const shortcut = this.getShortcutKey(domEvent)
        if (shortcut && this.shortcuts[shortcut]) {
          domEvent.preventDefault()
          this.shortcuts[shortcut](domEvent)
        }
      })

      // 注意：数据输入处理已移至终端管理器中统一处理
      // 这里不再重复绑定onData事件，避免冲突

      log.debug('命令拦截器事件已绑定')
    } catch (error) {
      log.error('绑定事件失败', error)
    }
  }

  /**
   * 处理回车键
   */
  async handleEnterKey() {
    try {
      const currentLine = this.getCurrentLine()
      log.debug('处理回车键', { currentLine, isEnabled: this.isEnabled })

      if (!currentLine) {
        log.debug('当前行为空，尝试获取输入缓冲区内容')
        // 如果当前行为空，可能是输入还没有被写入缓冲区
        // 尝试从输入历史中获取
        const inputBuffer = this.getInputBuffer()
        log.debug('输入缓冲区内容', { inputBuffer })

        if (!inputBuffer) return false

        // 检查缓冲区中的AI命令
        const aiCommand = this.parseAICommand(inputBuffer)
        log.debug('从缓冲区解析AI命令结果', { aiCommand, inputBuffer })

        if (aiCommand) {
          log.info('从缓冲区检测到AI命令，开始处理', { command: inputBuffer })
          this.preventCommandExecution()
          await this.executeAICommand(aiCommand)
          return true
        }

        return false
      }

      // 检查是否是AI命令
      const aiCommand = this.parseAICommand(currentLine)
      log.debug('AI命令解析结果', { aiCommand, currentLine })

      if (aiCommand) {
        log.info('检测到AI命令，开始处理', { command: currentLine })

        // 阻止命令发送到SSH服务器
        this.preventCommandExecution()

        // 处理AI命令
        await this.executeAICommand(aiCommand)

        // 返回true表示已处理，阻止进一步传播
        return true
      }

      // 返回false表示未处理，允许正常传播
      return false
    } catch (error) {
      log.error('处理回车键失败', error)
      return false
    }
  }

  /**
   * 获取输入缓冲区内容
   * @returns {string} 输入缓冲区文本
   */
  getInputBuffer() {
    try {
      // 尝试多种方法获取用户输入
      if (this.inputBuffer) {
        return this.inputBuffer.trim()
      }

      // 如果没有输入缓冲区，尝试从当前行获取
      return this.getCurrentLine()
    } catch (error) {
      log.error('获取输入缓冲区失败', error)
      return ''
    }
  }

  /**
   * 获取当前行内容
   * @returns {string} 当前行文本
   */
  getCurrentLine() {
    try {
      const buffer = this.terminal.buffer.active
      const currentRow = buffer.cursorY
      const line = buffer.getLine(currentRow)

      if (!line) return ''

      return line.translateToString(true).trim()
    } catch (error) {
      log.error('获取当前行失败', error)
      return ''
    }
  }

  /**
   * 解析AI命令
   * @param {string} line 命令行文本
   * @returns {Object|null} 解析结果
   */
  parseAICommand(line) {
    try {
      if (!line) return null

      // 提取实际的命令部分（去除提示符）
      const actualCommand = this.extractCommand(line)
      log.debug('提取的实际命令', { originalLine: line, actualCommand })

      if (!actualCommand) return null

      // 检查是否匹配AI命令前缀
      for (const [prefix, config] of Object.entries(this.commandPrefixes)) {
        if (actualCommand.startsWith(prefix)) {
          const args = actualCommand.substring(prefix.length).trim()
          return {
            prefix,
            args,
            config,
            originalLine: line,
            actualCommand
          }
        }
      }
      return null
    } catch (error) {
      log.error('解析AI命令失败', error)
      return null
    }
  }

  /**
   * 从完整的命令行中提取实际的命令（去除提示符）
   * @param {string} line 完整的命令行
   * @returns {string} 实际的命令
   */
  extractCommand(line) {
    try {
      // 常见的提示符模式
      const promptPatterns = [
        /^.*?[#$%>]\s*(.*)$/, // 匹配 user@host:~# command 或 $ command 等
        /^.*?>\s*(.*)$/, // 匹配 > command
        /^.*?:\s*(.*)$/, // 匹配 path: command
      ]

      for (const pattern of promptPatterns) {
        const match = line.match(pattern)
        if (match && match[1]) {
          return match[1].trim()
        }
      }

      // 如果没有匹配到提示符模式，返回原始行（可能就是纯命令）
      return line.trim()
    } catch (error) {
      log.error('提取命令失败', error)
      return line.trim()
    }
  }

  /**
   * 执行AI命令
   * @param {Object} command 命令对象
   */
  async executeAICommand(command) {
    try {
      log.debug('执行AI命令', { prefix: command.prefix, args: command.args })
      
      // 在终端显示命令执行提示
      this.terminal.writeln(`\r\n执行AI命令: ${command.originalLine}`)
      
      // 调用对应的处理器
      await command.config.handler(command.args, command)
      
    } catch (error) {
      log.error('执行AI命令失败', error)
      this.terminal.writeln(`\r\n错误: ${error.message}`)
    }
  }

  /**
   * 处理通用AI命令
   * @param {string} args 命令参数
   * @param {Object} command 命令对象
   */
  async handleAICommand(args, command) {
    try {
      // 如果没有参数，显示帮助
      if (!args.trim()) {
        this.showHelp()
        return
      }

      const subCommands = args.split(' ')
      const subCommand = subCommands[0]
      const subArgs = subCommands.slice(1).join(' ')

      // 检查是否是特定子命令
      switch (subCommand) {
        case 'explain':
          await this.handleExplainCommand(subArgs)
          break
        case 'fix':
          await this.handleFixCommand(subArgs)
          break
        case 'gen':
        case 'generate':
          await this.handleGenerateCommand(subArgs)
          break
        case 'help':
          this.showHelp()
          break
        default:
          // 如果不是特定子命令，则作为交互内容处理
          await this.handleInteractionCommand(args)
      }
    } catch (error) {
      log.error('处理AI命令失败', error)
      this.terminal.writeln(`处理命令失败: ${error.message}`)
    }
  }

  /**
   * 处理AI交互命令
   * @param {string} content 交互内容
   */
  async handleInteractionCommand(content) {
    try {
      this.terminal.writeln(`\r\n🤖 AI正在思考您的问题...`)

      // 构建上下文
      const context = this.buildContext()

      // 请求AI交互
      const result = await this.aiService.requestInteraction({
        question: content,
        prompt: content,
        terminalOutput: context.terminalOutput,
        osHint: context.osHint,
        shellHint: context.shellHint
      })

      if (result && result.success && result.content) {
        this.terminal.writeln(`\r\n💡 AI回答:`)
        this.terminal.writeln(`${result.content}\r\n`)
      } else {
        this.terminal.writeln(`\r\n❌ AI暂时无法回答您的问题\r\n`)
      }

    } catch (error) {
      log.error('处理AI交互失败', error)
      this.terminal.writeln(`\r\n❌ AI交互失败: ${error.message}\r\n`)
    }
  }

  /**
   * 处理解释命令
   * @param {string} args 命令参数
   */
  async handleExplainCommand(args) {
    try {
      this.terminal.writeln('AI正在分析终端输出...')
      
      const context = this.buildContext()
      const result = await this.aiService.requestExplanation({
        prompt: args || '请解释最近的终端输出',
        terminalOutput: context.terminalOutput,
        osHint: context.osHint,
        shellHint: context.shellHint,
        errorDetected: context.errorDetected
      })

      if (result && result.content) {
        this.displayAIResponse('explanation', result.content, result.metadata)
      } else {
        this.terminal.writeln('AI解释请求失败')
      }
    } catch (error) {
      log.error('处理解释命令失败', error)
      this.terminal.writeln(`解释失败: ${error.message}`)
    }
  }

  /**
   * 处理修复命令
   * @param {string} args 命令参数
   */
  async handleFixCommand(args) {
    try {
      this.terminal.writeln('AI正在分析错误并生成修复建议...')
      
      const context = this.buildContext()
      const result = await this.aiService.requestFix({
        prompt: args || '请提供修复建议',
        terminalOutput: context.terminalOutput,
        osHint: context.osHint,
        shellHint: context.shellHint
      })

      if (result && result.content) {
        this.displayAIResponse('fix', result.content, result.metadata)
      } else {
        this.terminal.writeln('AI修复建议请求失败')
      }
    } catch (error) {
      log.error('处理修复命令失败', error)
      this.terminal.writeln(`修复建议失败: ${error.message}`)
    }
  }

  /**
   * 处理生成命令
   * @param {string} args 命令参数
   */
  async handleGenerateCommand(args) {
    try {
      if (!args) {
        this.terminal.writeln('请提供脚本描述，例如: /gen 备份数据库脚本')
        return
      }

      this.terminal.writeln(`AI正在生成脚本: ${args}`)
      
      const context = this.buildContext()
      const result = await this.aiService.requestGeneration({
        prompt: args,
        description: args,
        terminalOutput: context.terminalOutput,
        osHint: context.osHint,
        shellHint: context.shellHint
      })

      if (result && result.content) {
        this.displayAIResponse('generation', result.content, result.metadata)
      } else {
        this.terminal.writeln('AI脚本生成请求失败')
      }
    } catch (error) {
      log.error('处理生成命令失败', error)
      this.terminal.writeln(`脚本生成失败: ${error.message}`)
    }
  }

  /**
   * 处理解释快捷键
   * @param {KeyboardEvent} event 键盘事件
   */
  async handleExplainShortcut(event) {
    try {
      await this.handleExplainCommand('')
    } catch (error) {
      log.error('处理解释快捷键失败', error)
    }
  }



  /**
   * 处理Tab补全
   * @param {KeyboardEvent} event 键盘事件
   */
  handleTabCompletion(event) {
    try {
      // 这里可以集成现有的补全逻辑
      log.debug('Tab补全触发')
    } catch (error) {
      log.error('处理Tab补全失败', error)
    }
  }

  /**
   * 处理Escape键
   * @param {KeyboardEvent} event 键盘事件
   */
  handleEscape(event) {
    try {
      // 清除AI建议和块
      log.debug('Escape键触发，清除AI内容')
    } catch (error) {
      log.error('处理Escape键失败', error)
    }
  }

  /**
   * 构建上下文
   * @returns {Object} 上下文对象
   */
  buildContext() {
    try {
      const buffer = this.terminal.buffer.active
      const lines = []
      
      // 获取最近的终端输出
      const startRow = Math.max(0, buffer.cursorY - 50)
      for (let i = startRow; i <= buffer.cursorY; i++) {
        const line = buffer.getLine(i)
        if (line) {
          lines.push(line.translateToString(true))
        }
      }

      const terminalOutput = lines.join('\n')
      
      return {
        terminalOutput,
        osHint: this.detectOS(terminalOutput),
        shellHint: this.detectShell(terminalOutput),
        errorDetected: this.detectError(terminalOutput)
      }
    } catch (error) {
      log.error('构建上下文失败', error)
      return {
        terminalOutput: '',
        osHint: 'unknown',
        shellHint: 'unknown',
        errorDetected: false
      }
    }
  }

  /**
   * 检测操作系统
   * @param {string} output 终端输出
   * @returns {string} 操作系统类型
   */
  detectOS(output) {
    if (/Linux|Ubuntu|CentOS|Debian/i.test(output)) return 'linux'
    if (/Darwin|macOS/i.test(output)) return 'darwin'
    if (/Windows|MINGW/i.test(output)) return 'windows'
    return 'unknown'
  }

  /**
   * 检测Shell类型
   * @param {string} output 终端输出
   * @returns {string} Shell类型
   */
  detectShell(output) {
    if (/bash/i.test(output) || output.includes('$ ')) return 'bash'
    if (/zsh/i.test(output) || output.includes('% ')) return 'zsh'
    if (/fish/i.test(output)) return 'fish'
    return 'unknown'
  }

  /**
   * 检测错误
   * @param {string} output 终端输出
   * @returns {boolean} 是否有错误
   */
  detectError(output) {
    const errorPatterns = [
      /error|failed|failure/i,
      /not found|command not found/i,
      /permission denied/i,
      /no such file or directory/i
    ]
    return errorPatterns.some(pattern => pattern.test(output))
  }

  /**
   * 显示AI响应
   * @param {string} type 响应类型
   * @param {string} content 响应内容
   * @param {Object} metadata 元数据
   */
  displayAIResponse(type, content, metadata) {
    try {
      // 在终端显示AI响应
      this.terminal.writeln(`\r\n--- AI ${this.getTypeTitle(type)} ---`)
      this.terminal.writeln(content)
      
      if (metadata && metadata.tokens) {
        this.terminal.writeln(`\r\n[Token使用: ${metadata.tokens.input + metadata.tokens.output}]`)
      }
      
      this.terminal.writeln('--- 结束 ---\r\n')
    } catch (error) {
      log.error('显示AI响应失败', error)
    }
  }

  /**
   * 获取类型标题
   * @param {string} type 类型
   * @returns {string} 标题
   */
  getTypeTitle(type) {
    const titles = {
      explanation: '解释',
      fix: '修复建议',
      generation: '生成的脚本'
    }
    return titles[type] || '响应'
  }

  /**
   * 显示帮助信息
   */
  showHelp() {
    try {
      this.terminal.writeln('\r\n--- AI命令帮助 ---')
      this.terminal.writeln('/ai <问题内容> - 与AI直接对话交流')
      this.terminal.writeln('/ai explain [问题] - 解释最近的终端输出')
      this.terminal.writeln('/ai fix [描述] - 获取错误修复建议')
      this.terminal.writeln('/ai gen <描述> - 生成脚本')
      this.terminal.writeln('/explain - 快速解释')
      this.terminal.writeln('/fix - 快速修复建议')
      this.terminal.writeln('/gen <描述> - 快速生成脚本')
      this.terminal.writeln('\r\n使用示例:')
      this.terminal.writeln('/ai 如何查看系统内存使用情况？')
      this.terminal.writeln('/ai 这个错误是什么意思？')
      this.terminal.writeln('/ai gen 备份当前目录到/tmp')
      this.terminal.writeln('\r\n快捷键:')
      this.terminal.writeln('Alt+Enter - 解释输出')
      this.terminal.writeln('Escape - 清除AI内容')
      this.terminal.writeln('\r\n调试信息:')
      this.terminal.writeln(`AI服务状态: ${this.aiService.isEnabled ? '已启用' : '未启用'}`)
      this.terminal.writeln(`拦截器状态: ${this.isEnabled ? '已启用' : '未启用'}`)
      this.terminal.writeln('--- 帮助结束 ---\r\n')
    } catch (error) {
      log.error('显示帮助失败', error)
    }
  }

  /**
   * 获取快捷键字符串
   * @param {KeyboardEvent} event 键盘事件
   * @returns {string} 快捷键字符串
   */
  getShortcutKey(event) {
    const keys = []
    if (event.ctrlKey) keys.push('Ctrl')
    if (event.altKey) keys.push('Alt')
    if (event.shiftKey) keys.push('Shift')
    if (event.metaKey) keys.push('Meta')
    
    if (event.key && event.key !== 'Control' && event.key !== 'Alt' && event.key !== 'Shift' && event.key !== 'Meta') {
      keys.push(event.key)
    }
    
    return keys.join('+')
  }

  /**
   * 阻止命令执行
   */
  preventCommandExecution() {
    try {
      // 清除当前行，防止命令被发送到SSH服务器
      const buffer = this.terminal.buffer.active
      const currentRow = buffer.cursorY
      const line = buffer.getLine(currentRow)

      if (line) {
        // 清除当前行内容
        this.terminal.write('\r\x1b[K')
        log.debug('AI命令已被拦截，当前行已清除')
      }
    } catch (error) {
      log.error('阻止命令执行失败', error)
    }
  }

  /**
   * 启用拦截器
   */
  enable() {
    this.isEnabled = true
    log.debug('命令拦截器已启用')
  }

  /**
   * 禁用拦截器
   */
  disable() {
    this.isEnabled = false
    log.debug('命令拦截器已禁用')
  }

  /**
   * 销毁拦截器
   */
  destroy() {
    try {
      this.disable()
      this.terminal = null
      this.aiService = null
      
      log.debug('命令拦截器已销毁')
    } catch (error) {
      log.error('销毁拦截器失败', error)
    }
  }
}

export default CommandInterceptor
