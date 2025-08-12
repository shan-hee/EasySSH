import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import log from '../log';
import { WS_CONSTANTS } from '../constants';
import terminalAutocompleteService from '../terminal-autocomplete';
import aiService from '../ai/ai-service';
import InlineSuggestionRenderer from '../ai/inline-suggestion-renderer';
import AIBlockRenderer from '../ai/ai-block-renderer';
import CommandInterceptor from '../ai/command-interceptor';

// 常量定义
const RESIZE_DEBOUNCE_DELAY = 100; // 大小调整防抖延迟(ms)
const ERROR_FEEDBACK_DURATION = 3000; // 错误提示显示时间(ms)

/**
 * 终端管理器
 * 负责创建和管理终端实例
 */
class TerminalManager {
  constructor(sshService) {
    this.sshService = sshService;
    this.terminals = new Map(); // 存储终端实例
    this.resizeTimeouts = new Map(); // 存储大小调整防抖定时器
    this.resizeObservers = new Map(); // 存储大小监听器

    // AI相关组件
    this.suggestionRenderers = new Map(); // 智能补全渲染器
    this.aiBlockRenderers = new Map(); // AI块渲染器
    this.commandInterceptors = new Map(); // 命令拦截器

    // 监听AI服务状态变化
    this._setupAIStatusListener();

    log.debug('终端管理器初始化完成');
  }
  
  /**
   * 创建终端并绑定到会话
   * @param {string} sessionId - SSH会话ID
   * @param {HTMLElement} container - 终端容器元素
   * @param {Object} options - 终端选项
   * @returns {Terminal} - 创建的终端实例
   */
  createTerminal(sessionId, container, options = {}) {
    if (!this.sshService.sessions.has(sessionId)) {
      throw new Error(`未找到会话ID: ${sessionId}`);
    }
    
    const session = this.sshService.sessions.get(sessionId);
    
    // 从传入的选项中获取光标样式和闪烁设置，如果未提供则使用默认值
    const cursorStyle = options.cursorStyle || 'block';
    const cursorBlink = options.cursorBlink !== undefined ? options.cursorBlink : true;
    
    // 优化：将光标样式信息合并到终端初始化完成日志中，减少分散的日志输出
    // log.info(`创建终端，使用光标样式: ${cursorStyle}, 闪烁: ${cursorBlink}`);
    
    // 创建终端实例 - 使用传入的选项，避免重复创建设置服务
    const terminal = new Terminal({
      fontSize: options.fontSize || 16,
      fontFamily: options.fontFamily || "'JetBrains Mono'",
      theme: options.theme,
      cursorStyle: cursorStyle, // 确保使用传入的光标样式
      cursorBlink: cursorBlink, // 确保使用传入的光标闪烁设置
      scrollback: 5000, // 增加滚动历史行数，默认值通常是1000
      rightClickSelectsWord: options.rightClickSelectsWord || false, // 使用设置中的值
      copyOnSelect: options.copyOnSelect || false, // 使用设置中的值
      disableStdin: false,
      letterSpacing: options.letterSpacing || 0, // 确保应用字符间距设置
      fastScrollModifier: 'alt', // 按住alt键可以快速滚动
      fastScrollSensitivity: 5, // 快速滚动的灵敏度
      smoothScrollDuration: 50 // 平滑滚动持续时间，单位为毫秒
    });
    
    // 添加FitAddon以自动调整终端大小
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    
    // 添加WebLinksAddon以支持链接点击
    const webLinksAddon = new WebLinksAddon();
    terminal.loadAddon(webLinksAddon);

    // 添加ClipboardAddon以支持复制粘贴
    const clipboardAddon = new ClipboardAddon();
    terminal.loadAddon(clipboardAddon);
    
    // 渲染终端
    terminal.open(container);

    // 等待字体加载完成后初始化终端大小
    this._initializeTerminalSize(terminal, fitAddon, sessionId);
    
    // 尝试聚焦终端
    try {
      // 优化：简化聚焦日志，只在失败时记录
      terminal.focus();
      log.debug(`终端聚焦完成: ${sessionId}`);
    } catch (e) {
      log.warn(`聚焦终端失败: ${e.message}`);
    }
    
    // 处理用户输入 - 统一的数据处理入口
    terminal.onData(async (data) => {
      log.debug('终端数据输入', { sessionId, data: data.charCodeAt ? data.charCodeAt(0) : data });

      // 根据AI服务状态决定使用哪种补全方式
      if (!aiService.isEnabled) {
        // AI功能未启用时，使用传统智能补全
        terminalAutocompleteService.processInput(data, terminal);
      }
      // AI功能启用时，传统补全已被禁用，AI补全会在AI命令拦截器中处理

      // 检查是否有AI命令拦截器，如果有则更新输入缓冲区
      const commandInterceptor = this.commandInterceptors.get(sessionId);
      let shouldBlock = false;

      if (commandInterceptor) {
        // 更新命令拦截器的输入缓冲区
        this._updateCommandInterceptorBuffer(commandInterceptor, data);

        // 如果是回车键，检查AI命令
        if (data === '\r' || data === '\n') {
          log.debug('检测到回车键，准备检查AI命令', { sessionId });
          // 直接调用命令拦截器的处理方法，让它决定是否拦截
          try {
            const intercepted = await commandInterceptor.handleEnterKey();
            if (intercepted) {
              shouldBlock = true;
              log.debug('AI命令已被拦截器处理，不发送到SSH服务器', { sessionId });
            } else {
              log.debug('非AI命令，继续正常处理', { sessionId });
            }
          } catch (error) {
            log.error('AI命令拦截处理失败', error);
          }
        }
      }

      // 只有在不需要阻止的情况下才处理SSH输入
      if (!shouldBlock) {
        log.debug('发送数据到SSH服务器', { sessionId, blocked: shouldBlock });
        this.sshService._processTerminalInput(session, data);
      } else {
        log.debug('数据被AI拦截器阻止，不发送到SSH服务器', { sessionId });
      }
    });
    
    // 处理终端大小变化
    terminal.onResize(({ cols, rows }) => {
      if (session.socket && session.socket.readyState === WS_CONSTANTS.OPEN) {
        session.socket.send(JSON.stringify({
          type: 'resize',
          data: {
            sessionId,
            cols,
            rows
          }
        }));
      }
    });
    
    // 添加选中复制功能 - 动态检查设置
    terminal.onSelectionChange(() => {
      // 动态获取当前设置，而不是使用创建时的固定值
      let currentSettings;
      try {
        // 尝试从全局设置服务获取最新设置
        if (window.services && window.services.settings) {
          currentSettings = window.services.settings.getTerminalSettings();
        } else {
          // 回退到传入的选项
          currentSettings = options;
        }
      } catch (error) {
        // 如果获取设置失败，使用传入的选项
        currentSettings = options;
      }

      // 检查是否启用了选中复制功能
      if (!currentSettings.copyOnSelect) {
        return;
      }

      if (terminal.hasSelection()) {
        const selectedText = terminal.getSelection();
        if (selectedText) {
          try {
            // 复制选中文本到剪贴板
            navigator.clipboard.writeText(selectedText);
          } catch (error) {
            log.error('复制到剪贴板失败:', error);
          }
        }
      }
    });
    
    // 添加右键粘贴功能 - 动态检查设置
    const handleContextMenu = async (event) => {
      // 动态获取当前设置，而不是使用创建时的固定值
      let currentSettings;
      try {
        // 尝试从全局设置服务获取最新设置
        if (window.services && window.services.settings) {
          currentSettings = window.services.settings.getTerminalSettings();
        } else {
          // 回退到传入的选项
          currentSettings = options;
        }
      } catch (error) {
        // 如果获取设置失败，使用传入的选项
        currentSettings = options;
      }

      // 检查是否启用了右键粘贴功能
      if (!currentSettings.rightClickSelectsWord) {
        // 如果未启用右键粘贴，允许默认的右键菜单
        return;
      }

      event.preventDefault();

      try {
        // 使用xterm.js原生paste方法，确保粘贴内容原样处理
        const text = await navigator.clipboard.readText();
        if (text && text.trim().length > 0) {
          // 使用terminal.paste()而不是自定义处理，确保多行命令统一执行
          terminal.paste(text);
        }
      } catch (error) {
        log.error('从剪贴板粘贴失败:', error);

        // 显示错误反馈
        if (terminal.element) {
          this._showErrorFeedback(terminal.element, '粘贴失败: ' + (error.message || '无法访问剪贴板'));
        }
      }
    };

    container.addEventListener('contextmenu', handleContextMenu);
    
    // 添加终端粘贴事件监听 - 使用xterm.js原生paste方法
    const handleTerminalPaste = (event) => {
      if (event.detail && event.detail.text) {
        // 使用terminal.paste()确保粘贴内容按照终端标准处理
        terminal.paste(event.detail.text);
      }
    };
    container.addEventListener('terminal-paste', handleTerminalPaste);
    
    // 设置容器大小监听
    this._setupResizeObserver(terminal, fitAddon, sessionId, container);
    
    // 将终端与会话绑定
    session.terminal = terminal;
    this.terminals.set(sessionId, terminal);

    // 始终启用系统默认补全
    terminalAutocompleteService.enable();
    log.debug('系统默认补全已启用', { sessionId });

    // 根据AI服务状态添加AI增强功能
    if (aiService.isEnabled) {
      // AI服务启用时，添加AI增强功能（不影响系统补全）
      log.info('准备为终端添加AI增强功能', { sessionId });
      this._enhanceTerminalWithAI(terminal, sessionId, options);

      // 验证AI组件是否成功创建
      const hasInterceptor = this.commandInterceptors.has(sessionId);
      log.info('AI增强功能添加结果', { sessionId, hasInterceptor });
    } else {
      log.debug('AI服务未启用，仅使用系统默认补全', { sessionId });
    }

    // 如果有缓冲的数据，写入终端
    if (session.buffer) {
      terminal.write(session.buffer);
      session.buffer = '';
      log.debug(`缓冲数据已写入终端: ${sessionId}`);
    }
    
    // 添加销毁处理
    const destroy = () => {
      container.removeEventListener('contextmenu', handleContextMenu);
      container.removeEventListener('terminal-paste', handleTerminalPaste);

      // 清理大小监听
      if (this.resizeObservers.has(sessionId)) {
        this.resizeObservers.get(sessionId).disconnect();
        this.resizeObservers.delete(sessionId);
      }
      if (this.resizeTimeouts.has(sessionId)) {
        clearTimeout(this.resizeTimeouts.get(sessionId));
        this.resizeTimeouts.delete(sessionId);
      }

      // 清理AI组件
      this._cleanupAIComponents(sessionId);

      terminal.dispose();
      this.terminals.delete(sessionId);
    };
    
    session.destroy = destroy;



    return terminal;
  }

  /**
   * 更新命令拦截器的输入缓冲区
   * @param {CommandInterceptor} commandInterceptor - 命令拦截器实例
   * @param {string} data - 输入数据
   */
  _updateCommandInterceptorBuffer(commandInterceptor, data) {
    try {
      // 如果是回车键，清空缓冲区
      if (data === '\r' || data === '\n') {
        commandInterceptor.inputBuffer = '';
        return;
      }

      // 如果是退格键，删除最后一个字符
      if (data === '\x7f' || data === '\b') {
        commandInterceptor.inputBuffer = commandInterceptor.inputBuffer.slice(0, -1);
        return;
      }

      // 如果是Escape键或其他控制字符，清空缓冲区
      if (data.charCodeAt(0) < 32 && data !== '\t') {
        commandInterceptor.inputBuffer = '';
        return;
      }

      // 普通字符，添加到缓冲区
      commandInterceptor.inputBuffer += data;
    } catch (error) {
      log.error('更新命令拦截器缓冲区失败', error);
    }
  }

  /**
   * 为终端添加AI增强功能
   * @param {Terminal} terminal - 终端实例
   * @param {string} sessionId - 会话ID
   * @param {Object} options - 选项
   */
  _enhanceTerminalWithAI(terminal, sessionId, options = {}) {
    try {
      // 详细检查AI服务状态
      const aiStatus = aiService.getStatus();
      log.debug('AI服务状态检查', {
        sessionId,
        isEnabled: aiService.isEnabled,
        status: aiStatus
      });

      // 检查AI服务是否启用
      if (!aiService.isEnabled) {
        log.warn('AI服务未启用，跳过AI增强', { sessionId });
        return;
      }

      log.info('AI服务已启用，开始创建AI组件', { sessionId });

      // 创建行内建议渲染器
      const suggestionRenderer = new InlineSuggestionRenderer(terminal);
      this.suggestionRenderers.set(sessionId, suggestionRenderer);

      // 创建AI块渲染器
      const aiBlockRenderer = new AIBlockRenderer(terminal);
      this.aiBlockRenderers.set(sessionId, aiBlockRenderer);

      // 创建命令拦截器
      log.info('创建命令拦截器', { sessionId });
      const commandInterceptor = new CommandInterceptor(terminal, aiService, sessionId);
      this.commandInterceptors.set(sessionId, commandInterceptor);
      log.info('命令拦截器已创建并存储', { sessionId, hasInterceptor: this.commandInterceptors.has(sessionId) });

      // 绑定AI相关事件
      this._bindAIEvents(terminal, sessionId);

      log.info('终端AI增强功能已启用', { sessionId, aiStatus });

    } catch (error) {
      log.error('添加AI增强功能失败', error);
    }
  }

  /**
   * 绑定AI相关事件
   * @param {Terminal} terminal - 终端实例
   * @param {string} sessionId - 会话ID
   */
  _bindAIEvents(terminal, sessionId) {
    try {
      const suggestionRenderer = this.suggestionRenderers.get(sessionId);
      const aiBlockRenderer = this.aiBlockRenderers.get(sessionId);

      if (!suggestionRenderer || !aiBlockRenderer) {
        return;
      }



      log.debug('AI事件已绑定', { sessionId });

    } catch (error) {
      log.error('绑定AI事件失败', error);
    }
  }



  /**
   * 构建终端上下文
   * @param {Terminal} terminal - 终端实例
   * @param {string} sessionId - 会话ID
   * @returns {Object} 上下文对象
   */
  _buildTerminalContext(terminal, sessionId) {
    try {
      const buffer = terminal.buffer.active;
      const lines = [];

      // 获取最近的终端输出
      const startRow = Math.max(0, buffer.cursorY - 50);
      for (let i = startRow; i <= buffer.cursorY; i++) {
        const line = buffer.getLine(i);
        if (line) {
          lines.push(line.translateToString(true));
        }
      }

      const terminalOutput = lines.join('\n');

      return {
        terminalOutput,
        osHint: this._detectOS(terminalOutput),
        shellHint: this._detectShell(terminalOutput),
        errorDetected: this._detectError(terminalOutput)
      };

    } catch (error) {
      log.error('构建终端上下文失败', error);
      return {
        terminalOutput: '',
        osHint: 'unknown',
        shellHint: 'unknown',
        errorDetected: false
      };
    }
  }

  /**
   * 检测操作系统
   * @param {string} output - 终端输出
   * @returns {string} 操作系统类型
   */
  _detectOS(output) {
    if (/Linux|Ubuntu|CentOS|Debian/i.test(output)) return 'linux';
    if (/Darwin|macOS/i.test(output)) return 'darwin';
    if (/Windows|MINGW/i.test(output)) return 'windows';
    return 'unknown';
  }

  /**
   * 检测Shell类型
   * @param {string} output - 终端输出
   * @returns {string} Shell类型
   */
  _detectShell(output) {
    if (/bash/i.test(output) || output.includes('$ ')) return 'bash';
    if (/zsh/i.test(output) || output.includes('% ')) return 'zsh';
    if (/fish/i.test(output)) return 'fish';
    return 'unknown';
  }

  /**
   * 检测错误
   * @param {string} output - 终端输出
   * @returns {boolean} 是否有错误
   */
  _detectError(output) {
    const errorPatterns = [
      /error|failed|failure/i,
      /not found|command not found/i,
      /permission denied/i,
      /no such file or directory/i
    ];
    return errorPatterns.some(pattern => pattern.test(output));
  }

  /**
   * 获取终端当前行内容
   * @param {Terminal} terminal - 终端实例
   * @returns {string} 当前行文本
   */
  _getCurrentLine(terminal) {
    try {
      const buffer = terminal.buffer.active;
      const currentRow = buffer.cursorY;
      const line = buffer.getLine(currentRow);

      if (!line) return '';

      return line.translateToString(true).trim();
    } catch (error) {
      log.error('获取当前行失败', error);
      return '';
    }
  }

  /**
   * 检查是否是AI命令
   * @param {string} line - 命令行文本
   * @returns {boolean} 是否是AI命令
   */
  _isAICommand(line) {
    const aiPrefixes = ['/ai', '/explain', '/fix', '/gen'];
    return aiPrefixes.some(prefix => line.startsWith(prefix));
  }

  /**
   * 设置AI状态监听器
   */
  _setupAIStatusListener() {
    try {
      window.addEventListener('ai-service-status-change', (event) => {
        const { status, isEnabled } = event.detail;
        log.debug('收到AI服务状态变化通知', { status, isEnabled });

        if (isEnabled) {
          // AI服务已启用，为所有终端添加AI功能
          this.refreshAIForAllTerminals();
        } else {
          // AI服务已禁用，清理所有终端的AI功能
          this.cleanupAIForAllTerminals();
        }

        // 无论AI服务状态如何，都确保系统补全始终启用
        terminalAutocompleteService.enable();
        log.debug('AI状态变化后，系统补全已确保启用');
      });

      log.debug('AI状态监听器已设置');
    } catch (error) {
      log.error('设置AI状态监听器失败', error);
    }
  }

  /**
   * 为所有现有终端重新启用AI功能
   * 当AI服务状态改变时调用
   */
  refreshAIForAllTerminals() {
    try {
      log.debug('为所有终端刷新AI功能', { terminalCount: this.terminals.size });

      for (const [sessionId, terminal] of this.terminals.entries()) {
        if (aiService.isEnabled) {
          // AI服务启用时，先清理现有的AI组件，然后重新添加
          this._cleanupAIComponents(sessionId);
          this._enhanceTerminalWithAI(terminal, sessionId);
        } else {
          // AI服务禁用时，清理AI组件
          this._cleanupAIComponents(sessionId);
        }
      }

      // 始终确保系统补全启用（不再依赖AI状态）
      terminalAutocompleteService.enable();
      log.debug('系统补全已确保启用，不受AI状态影响');

      log.debug('所有终端AI功能刷新完成');
    } catch (error) {
      log.error('刷新终端AI功能失败', error);
    }
  }

  /**
   * 清理所有终端的AI功能
   */
  cleanupAIForAllTerminals() {
    try {
      log.info('清理所有终端AI功能', { terminalCount: this.terminals.size });

      for (const sessionId of this.terminals.keys()) {
        this._cleanupAIComponents(sessionId);
      }

      // 确保系统补全在清理AI功能后仍然启用
      terminalAutocompleteService.enable();
      log.debug('AI功能清理完成，系统补全已确保启用');
    } catch (error) {
      log.error('清理所有终端AI功能失败', error);
    }
  }

  /**
   * 清理AI组件
   * @param {string} sessionId - 会话ID
   */
  _cleanupAIComponents(sessionId) {
    try {
      // 清理建议渲染器
      const suggestionRenderer = this.suggestionRenderers.get(sessionId);
      if (suggestionRenderer) {
        suggestionRenderer.destroy();
        this.suggestionRenderers.delete(sessionId);
      }

      // 清理AI块渲染器
      const aiBlockRenderer = this.aiBlockRenderers.get(sessionId);
      if (aiBlockRenderer) {
        aiBlockRenderer.destroy();
        this.aiBlockRenderers.delete(sessionId);
      }

      // 清理命令拦截器
      const commandInterceptor = this.commandInterceptors.get(sessionId);
      if (commandInterceptor) {
        commandInterceptor.destroy();
        this.commandInterceptors.delete(sessionId);
      }

      log.debug('AI组件已清理', { sessionId });

    } catch (error) {
      log.error('清理AI组件失败', error);
    }
  }

  /**
   * 初始化终端大小 - 等待字体加载完成
   * @param {Terminal} terminal - xterm.js终端实例
   * @param {FitAddon} fitAddon - 大小适配插件
   * @param {string} sessionId - 会话ID
   */
  async _initializeTerminalSize(terminal, fitAddon, sessionId) {
    try {
      // 等待字体加载完成
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }

      // 初始化终端大小
      fitAddon.fit();
      // 优化：合并字体加载和初始化完成的日志，包含光标样式信息
      const cursorStyle = terminal.options.cursorStyle || 'block';
      const cursorBlink = terminal.options.cursorBlink !== undefined ? terminal.options.cursorBlink : true;
      log.debug(`终端初始化完成: ${sessionId}, 大小: ${terminal.cols}x${terminal.rows}, 光标: ${cursorStyle}${cursorBlink ? '(闪烁)' : ''}`);
    } catch (e) {
      log.error('初始化终端大小失败', e);
      // 备用方案
      try {
        fitAddon.fit();
      } catch (e2) {
        log.error('备用终端大小调整也失败', e2);
      }
    }
  }

  /**
   * 设置容器大小监听
   * @param {Terminal} terminal - xterm.js终端实例
   * @param {FitAddon} fitAddon - 大小适配插件
   * @param {string} sessionId - 会话ID
   * @param {HTMLElement} container - 容器元素
   */
  _setupResizeObserver(terminal, fitAddon, sessionId, container) {
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === container) {
          // 防抖处理
          clearTimeout(this.resizeTimeouts.get(sessionId));
          this.resizeTimeouts.set(sessionId, setTimeout(() => {
            this._handleTerminalResize(terminal, fitAddon, sessionId);
          }, RESIZE_DEBOUNCE_DELAY));
        }
      }
    });

    resizeObserver.observe(container);
    this.resizeObservers.set(sessionId, resizeObserver);
  }

  /**
   * 处理终端大小调整
   * @param {Terminal} terminal - xterm.js终端实例
   * @param {FitAddon} fitAddon - 大小适配插件
   * @param {string} sessionId - 会话ID
   */
  _handleTerminalResize(terminal, fitAddon, sessionId) {
    try {
      const beforeCols = terminal.cols;
      const beforeRows = terminal.rows;

      // 调整终端大小
      fitAddon.fit();

      // 刷新显示并滚动到底部
      terminal.refresh(0, terminal.rows - 1);
      terminal.scrollToBottom();

      const afterCols = terminal.cols;
      const afterRows = terminal.rows;

      if (beforeCols !== afterCols || beforeRows !== afterRows) {
        log.info(`终端大小调整: ${sessionId}, ${beforeCols}x${beforeRows} -> ${afterCols}x${afterRows}`);
      }
    } catch (e) {
      log.error('调整终端大小失败', e);
    }
  }

  /**
   * 显示错误反馈
   * @param {HTMLElement} container - 容器元素
   * @param {string} message - 错误消息
   */
  _showErrorFeedback(container, message) {
    const errorFeedback = document.createElement('div');
    errorFeedback.textContent = message;

    // 设置样式
    Object.assign(errorFeedback.style, {
      position: 'absolute',
      right: '10px',
      top: '10px',
      backgroundColor: 'rgba(220, 53, 69, 0.8)',
      color: '#fff',
      padding: '5px 10px',
      borderRadius: '3px',
      fontSize: '12px',
      zIndex: '9999'
    });

    container.appendChild(errorFeedback);

    // 自动移除
    setTimeout(() => {
      if (errorFeedback.parentNode) {
        errorFeedback.parentNode.removeChild(errorFeedback);
      }
    }, ERROR_FEEDBACK_DURATION);
  }

  /**
   * 销毁终端
   * @param {string} sessionId - 会话ID
   */
  destroyTerminal(sessionId) {
    if (this.terminals.has(sessionId)) {
      const terminal = this.terminals.get(sessionId);
      terminal.dispose();
      this.terminals.delete(sessionId);
      log.info(`终端 ${sessionId} 已销毁`);
    }
  }
  
  /**
   * 写入数据到终端
   * @param {string} sessionId - 会话ID
   * @param {string} data - 要写入的数据
   */
  writeToTerminal(sessionId, data) {
    if (this.terminals.has(sessionId)) {
      const terminal = this.terminals.get(sessionId);
      terminal.write(data);
    } else {
      log.warn(`尝试写入到不存在的终端: ${sessionId}`);
    }
  }
  
  /**
   * 调整终端大小
   * @param {string} sessionId - 会话ID
   */
  fitTerminal(sessionId) {
    if (this.terminals.has(sessionId)) {
      const terminal = this.terminals.get(sessionId);
      const fitAddon = terminal._addonManager._addons.find(addon => addon.instance instanceof FitAddon);
      if (fitAddon && fitAddon.instance.fit) {
        fitAddon.instance.fit();
      }
    }
  }
  
  /**
   * 获取所有终端
   * @returns {Map} - 终端Map
   */
  getAllTerminals() {
    return this.terminals;
  }
}

export default TerminalManager; 