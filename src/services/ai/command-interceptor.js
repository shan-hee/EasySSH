/**
 * 命令拦截器
 * 负责拦截和处理AI相关的命令前缀
 */

import log from '../log'
import languageDetector from './language-detector.js'

class CommandInterceptor {
  constructor(terminal, aiService, sessionId = null) {
    this.terminal = terminal
    this.aiService = aiService
    this.sessionId = sessionId // 会话ID，用于调试
    this.isEnabled = true
    this.inputBuffer = '' // 跟踪用户输入
    this.currentCommand = '' // 当前正在输入的命令

    // 语言环境检测（使用专用服务）
    this.languageDetector = languageDetector

    // AI命令前缀配置 - 两种核心模式
    this.commandPrefixes = {
      '/ai': {
        handler: this.handleAICommand.bind(this),
        description: 'AI通用命令前缀（自动路由）'
      },
      '/chat': {
        handler: this.handleChatCommand.bind(this),
        description: 'Chat模式 - 自由对话交流'
      },
      '/agent': {
        handler: this.handleAgentCommand.bind(this),
        description: 'Agent模式 - 智能助手分析'
      }
    }
    
    // 键盘快捷键配置 - 优化为新模式
    this.shortcuts = {
      'Alt+Enter': this.handleAgentShortcut.bind(this), // Agent模式快捷键
      'Ctrl+Enter': this.handleChatShortcut.bind(this), // Chat模式快捷键
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
   * 处理通用AI命令 - 智能路由到合适的模式
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

      // 智能路由：根据子命令自动选择模式
      switch (subCommand) {
        case 'chat':
          await this.handleChatCommand(subArgs)
          break
        case 'agent':
          await this.handleAgentCommand(subArgs)
          break
        case 'help':
          this.showHelp()
          break
        default:
          // 默认情况：智能判断用户意图
          await this.handleSmartRouting(args)
      }
    } catch (error) {
      log.error('处理AI命令失败', error)
      this.terminal.writeln(`处理命令失败: ${error.message}`)
    }
  }

  /**
   * 处理Chat模式命令 - 自由对话交流
   * @param {string} content 对话内容
   */
  async handleChatCommand(content) {
    try {
      if (!content.trim()) {
        this.terminal.writeln('\r\n💬 Chat模式：请输入您想要讨论的问题')
        this.terminal.writeln('示例：/chat 如何优化Linux系统性能？\r\n')
        return
      }

      this.terminal.writeln(`\r\n💬 Chat模式启动，AI正在思考您的问题...`)

      // 构建上下文
      const context = this.buildContext()

      // 请求Chat模式AI服务
      const result = await this.aiService.requestChat({
        question: content,
        prompt: content,
        terminalOutput: context.terminalOutput,
        osHint: context.osHint,
        shellHint: context.shellHint
      })

      if (result && result.success && result.content) {
        this.renderAIResponse('💡 AI回答:', result.content, 'chat')
      } else {
        this.renderAIResponse('❌ 错误:', 'Chat模式暂时无法回答您的问题', 'error')
      }

    } catch (error) {
      log.error('处理Chat模式失败', error)
      this.terminal.writeln(`\r\n❌ Chat模式失败: ${error.message}\r\n`)
    }
  }

  /**
   * 处理Agent模式命令 - 智能助手分析
   * @param {string} args 命令参数
   */
  async handleAgentCommand(args = '') {
    try {
      this.terminal.writeln(`\r\n🤖 Agent模式启动，正在分析终端状态...`)

      // 构建上下文
      const context = this.buildContext()

      // 请求Agent模式AI服务
      const result = await this.aiService.requestAgent({
        prompt: args,
        operationType: 'auto', // 始终使用自动模式
        terminalOutput: context.terminalOutput,
        osHint: context.osHint,
        shellHint: context.shellHint,
        errorDetected: context.errorDetected
      })

      if (result && result.success && result.content) {
        const icon = this.getAgentIcon(result.operationType)
        this.renderAIResponse(`${icon} Agent分析结果:`, result.content, 'agent')
      } else {
        this.renderAIResponse('❌ 错误:', 'Agent模式分析失败', 'error')
      }

    } catch (error) {
      log.error('处理Agent模式失败', error)
      this.terminal.writeln(`\r\n❌ Agent模式失败: ${error.message}\r\n`)
    }
  }

  /**
   * 智能路由 - 根据用户输入自动选择合适的模式
   * @param {string} content 用户输入
   */
  async handleSmartRouting(content) {
    try {
      // 简单的意图识别
      const chatKeywords = ['如何', '什么是', '为什么', '怎么样', '请问', '能否', '可以']
      const agentKeywords = ['错误', '失败', '问题', '修复', '生成', '创建', '脚本']

      const isChatIntent = chatKeywords.some(keyword => content.includes(keyword))
      const isAgentIntent = agentKeywords.some(keyword => content.includes(keyword))

      if (isChatIntent && !isAgentIntent) {
        // 倾向于Chat模式
        await this.handleChatCommand(content)
      } else if (isAgentIntent || this.hasTerminalError()) {
        // 倾向于Agent模式
        await this.handleAgentCommand(content)
      } else {
        // 默认使用Chat模式
        await this.handleChatCommand(content)
      }
    } catch (error) {
      log.error('智能路由失败', error)
      // 降级到Chat模式
      await this.handleChatCommand(content)
    }
  }

  /**
   * 处理Agent模式快捷键 (Alt+Enter)
   */
  async handleAgentShortcut() {
    try {
      await this.handleAgentCommand()
    } catch (error) {
      log.error('Agent快捷键处理失败', error)
    }
  }

  /**
   * 处理Chat模式快捷键 (Ctrl+Enter)
   */
  async handleChatShortcut() {
    try {
      const currentLine = this.getCurrentLine()
      if (currentLine) {
        await this.handleChatCommand(currentLine)
      } else {
        this.terminal.writeln('\r\n💬 Chat模式：请输入问题后按 Ctrl+Enter\r\n')
      }
    } catch (error) {
      log.error('Chat快捷键处理失败', error)
    }
  }

  /**
   * 获取Agent模式操作类型对应的图标
   * @param {string} operationType 操作类型
   * @returns {string} 图标
   */
  getAgentIcon(operationType) {
    const icons = {
      'explanation': '📖',
      'fix': '🔧',
      'generation': '📝',
      'auto': '🤖'
    }
    return icons[operationType] || '🤖'
  }

  /**
   * 检查终端是否有错误
   * @returns {boolean} 是否有错误
   */
  hasTerminalError() {
    try {
      const context = this.buildContext()
      return context.errorDetected || false
    } catch (error) {
      return false
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

      // 更新服务器语言环境
      const langStatus = this.languageDetector.detectServerLanguage(terminalOutput)

      return {
        terminalOutput,
        osHint: this.detectOS(terminalOutput),
        shellHint: this.detectShell(terminalOutput),
        errorDetected: this.detectError(terminalOutput),
        languageStatus: langStatus
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
      this.terminal.writeln('\r\n=== EasySSH AI助手帮助 ===')
      this.terminal.writeln('')
      this.terminal.writeln('🎯 两种核心模式:')
      this.terminal.writeln('💬 Chat模式  - 自由对话交流，回答技术问题')
      this.terminal.writeln('🤖 Agent模式 - 智能分析终端状态，提供操作建议')
      this.terminal.writeln('')
      this.terminal.writeln('📝 命令使用:')
      this.terminal.writeln('/chat <问题>     - 进入Chat模式对话')
      this.terminal.writeln('/agent [描述]    - 启动Agent模式分析')
      this.terminal.writeln('/ai <内容>       - 智能路由到合适模式')
      this.terminal.writeln('')
      this.terminal.writeln('⌨️ 快捷键:')
      this.terminal.writeln('Alt+Enter       - 快速启动Agent模式')
      this.terminal.writeln('Ctrl+Enter      - 快速启动Chat模式')
      this.terminal.writeln('Escape          - 清除AI内容')
      this.terminal.writeln('')
      this.terminal.writeln('💡 使用示例:')
      this.terminal.writeln('/chat 如何优化Linux系统性能？')
      this.terminal.writeln('/agent 分析这个错误并提供修复方案')
      this.terminal.writeln('/ai 生成一个备份脚本')
      this.terminal.writeln('')

      const langStatus = this.languageDetector.getStatus()

      this.terminal.writeln('📊 状态信息:')
      this.terminal.writeln(`AI服务: ${this.aiService.isEnabled ? '✅ 已启用' : '❌ 未启用'}`)
      this.terminal.writeln(`拦截器: ${this.isEnabled ? '✅ 已启用' : '❌ 未启用'}`)
      this.terminal.writeln(`服务器语言: ${langStatus.serverLanguage}`)
      this.terminal.writeln(`客户端语言: ${langStatus.clientLanguage}`)
      this.terminal.writeln(`Unicode支持: ${langStatus.unicodeSupport ? '✅ 支持' : '❌ 不支持'}`)
      this.terminal.writeln(`ASCII模式: ${langStatus.shouldUseAsciiMode ? '✅ 启用' : '❌ 禁用'}`)
      this.terminal.writeln(`推荐AI语言: ${langStatus.recommendedAILanguage}`)
      this.terminal.writeln('')
      this.terminal.writeln('🌐 多语言支持:')
      this.terminal.writeln('• AI命令在客户端处理，避免服务器编码问题')
      this.terminal.writeln('• 自动检测服务器语言环境和Unicode支持')
      this.terminal.writeln('• 不支持Unicode时自动启用ASCII兼容模式')
      this.terminal.writeln('• 原始内容可在浏览器控制台查看')
      this.terminal.writeln('========================\r\n')
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
   * 阻止命令执行 - 增强版，确保AI命令不会发送到服务器
   */
  preventCommandExecution() {
    try {
      // 清除当前行，防止命令被发送到SSH服务器
      const buffer = this.terminal.buffer.active
      const currentRow = buffer.cursorY
      const line = buffer.getLine(currentRow)

      if (line) {
        // 清除当前行内容，使用更强的清除方式
        this.terminal.write('\r\x1b[2K') // 清除整行
        this.terminal.write('\r') // 回到行首
        log.debug('AI命令已被拦截，当前行已完全清除')
      }

      // 清空输入缓冲区
      this.inputBuffer = ''
      this.currentCommand = ''

    } catch (error) {
      log.error('阻止命令执行失败', error)
    }
  }

  /**
   * 渲染AI响应 - 支持多语言兼容
   * @param {string} title 标题
   * @param {string} content 内容
   * @param {string} type 类型 (chat/agent/error)
   */
  renderAIResponse(title, content, type = 'chat') {
    try {
      // 更新服务器语言环境检测
      const context = this.buildContext()
      const langStatus = this.languageDetector.detectServerLanguage(context.terminalOutput)

      log.debug('AI响应渲染', {
        langStatus,
        type
      })

      // 处理标题和内容
      let displayTitle = title
      let displayContent = content

      if (langStatus.shouldUseAsciiMode) {
        // ASCII兼容模式
        displayTitle = this.languageDetector.toAsciiCompatible(title)
        displayContent = this.languageDetector.toAsciiCompatible(content)

        // 添加ASCII模式提示
        this.terminal.writeln('\r\n[ASCII Mode - Server does not support Unicode]')
      }

      // 渲染响应
      this.terminal.writeln(`\r\n${displayTitle}`)

      // 分行显示内容，避免长行显示问题
      const lines = displayContent.split('\n')
      lines.forEach(line => {
        if (line.trim()) {
          this.terminal.writeln(line)
        } else {
          this.terminal.writeln('')
        }
      })

      this.terminal.writeln('') // 添加空行分隔

      // 如果是ASCII模式，提供原始内容的提示
      if (langStatus.shouldUseAsciiMode && content !== displayContent) {
        this.terminal.writeln('[Tip: Use browser console to see original Unicode content]')
        // 使用日志服务而不是console.log
        log.debug('AI Response (Original):', { title, content })
      }

    } catch (error) {
      log.error('渲染AI响应失败', error)
      // 降级显示
      this.terminal.writeln(`\r\n${title}`)
      this.terminal.writeln(content)
      this.terminal.writeln('')
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
