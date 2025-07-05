import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import log from '../log';
import { WS_CONSTANTS } from '../constants';
import terminalAutocompleteService from '../terminal-autocomplete';

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
    
    // 处理用户输入
    terminal.onData((data) => {
      // 处理自动完成
      terminalAutocompleteService.processInput(data, terminal);

      // 处理SSH输入
      this.sshService._processTerminalInput(session, data);
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

      terminal.dispose();
      this.terminals.delete(sessionId);
    };
    
    session.destroy = destroy;



    return terminal;
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