// Terminal addons are handled in terminal service
import { ClipboardAddon } from '@xterm/addon-clipboard';
import log from '../log';
import { WS_CONSTANTS } from '../constants';
import terminalAutocompleteService from '../terminal-autocomplete';
import terminalService from '../terminal';

// 导入二进制协议支持
import { BinaryMessageSender } from './binary-protocol';

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
  async createTerminal(sessionId, container, options = {}) {
    if (!this.sshService.sessions.has(sessionId)) {
      throw new Error(`未找到会话ID: ${sessionId}`);
    }

    const session = this.sshService.sessions.get(sessionId);

    log.debug(`终端管理器创建终端，会话ID: ${sessionId}`);

    // 使用终端服务创建终端实例
    const terminalInstance = await terminalService.createTerminal(sessionId, container, options);

    if (!terminalInstance) {
      throw new Error(`终端服务创建终端失败，会话ID: ${sessionId}`);
    }

    const terminal = terminalInstance.terminal;

    // 终端服务已经处理了FitAddon和WebLinksAddon，这里获取引用
    const fitAddon = terminalInstance.addons.fit;
    // const webLinksAddon = terminalInstance.addons.webLinks; // 已由终端服务管理

    // 添加ClipboardAddon以支持复制粘贴
    const clipboardAddon = new ClipboardAddon();
    terminal.loadAddon(clipboardAddon);

    // 渲染终端
    terminal.open(container);

    // 异步初始化终端大小，不阻塞创建过程
    this._initializeTerminalSize(terminal, fitAddon, sessionId);

    // 尝试聚焦终端
    try {
      terminal.focus();
      log.debug(`终端聚焦完成: ${sessionId}`);
    } catch (e) {
      log.warn(`聚焦终端失败: ${e.message}`);
    }

    // 处理用户输入 - 统一的数据处理入口
    terminal.onData(async data => {
      // log.debug('终端数据输入', { sessionId, data: data.charCodeAt ? data.charCodeAt(0) : data });

      // 使用智能补全
      terminalAutocompleteService.processInput(data, terminal);

      // 处理SSH输入
      this.sshService._processTerminalInput(session, data);
    });

    // 处理终端大小变化
    terminal.onResize(({ cols, rows }) => {
      if (session.socket && session.socket.readyState === WS_CONSTANTS.OPEN) {
        log.debug(`终端大小变化: ${sessionId} -> ${cols}x${rows}`);

        try {
          // 使用统一的二进制消息发送器
          BinaryMessageSender.sendSSHResize(session.socket, sessionId, cols, rows);
        } catch (error) {
          log.debug(`发送终端大小变化失败: ${sessionId}`, error.message);
        }
      }
    });

    // 处理上下文菜单和粘贴
    const handleContextMenu = event => {
      // 不再无条件阻止默认行为；改为分发自定义事件供上层决定
      const customEvent = new CustomEvent('terminal-context-menu', {
        detail: {
          originalEvent: event,
          sessionId,
          terminalElement: container
        },
        bubbles: true,
        composed: true
      });
      container.dispatchEvent(customEvent);
    };

    const handleTerminalPaste = event => {
      if (event.detail && event.detail.text) {
        terminal.paste(event.detail.text);
      }
    };

    container.addEventListener('contextmenu', handleContextMenu);
    container.addEventListener('terminal-paste', handleTerminalPaste);

    // 处理输出数据以支持特殊功能
    session.processOutput = data => {
      try {
        // 写入终端显示
        terminal.write(data);

        // 触发上下文构建事件
        const context = this._buildTerminalContext(terminal, sessionId);
        window.dispatchEvent(
          new CustomEvent('terminal:context-update', {
            detail: { sessionId, context }
          })
        );
      } catch (error) {
        log.error('处理终端输出失败', error);
      }
    };

    // 设置容器大小监听
    this._setupResizeObserver(terminal, fitAddon, sessionId, container);

    // 将终端与会话绑定
    session.terminal = terminal;
    this.terminals.set(sessionId, terminal);

    // 启用智能补全
    terminalAutocompleteService.enable();
    log.debug('系统默认补全已启用', { sessionId });

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
   * 初始化终端大小
   * @private
   */
  async _initializeTerminalSize(terminal, fitAddon, sessionId) {
    try {
      // 等待延迟确保DOM已准备就绪
      await new Promise(resolve => setTimeout(resolve, 100));

      // 检查fitAddon是否存在并且有fit方法
      if (!fitAddon || typeof fitAddon.fit !== 'function') {
        log.warn(`终端 ${sessionId} fitAddon不可用，跳过大小初始化`);
        return;
      }

      // 检查终端元素是否已准备好
      if (!terminal.element || !terminal.element.parentNode) {
        log.warn(`终端 ${sessionId} 元素未就绪，跳过大小初始化`);
        return;
      }

      // 调整终端大小
      fitAddon.fit();

      log.debug(`终端大小初始化完成: ${sessionId}`);
    } catch (error) {
      log.debug(`初始化终端大小失败: ${sessionId}`, error.message);
    }
  }

  /**
   * 构建终端上下文信息
   * @private
   */
  _buildTerminalContext(terminal, sessionId) {
    try {
      const buffer = terminal.buffer.active;
      const currentLine = this._getCurrentLine(terminal);

      // 获取最近几行输出
      const recentLines = [];
      const maxLines = Math.min(10, buffer.length);
      for (let i = Math.max(0, buffer.cursorY - maxLines + 1); i <= buffer.cursorY; i++) {
        const line = buffer.getLine(i);
        if (line) {
          recentLines.push(line.translateToString().trim());
        }
      }

      // 构建上下文对象
      const context = {
        sessionId,
        currentLine: currentLine.trim(),
        recentOutput: recentLines.join('\n'),
        cursorPosition: {
          x: buffer.cursorX,
          y: buffer.cursorY
        },
        terminalSize: {
          cols: buffer.cols,
          rows: buffer.rows
        },
        timestamp: Date.now()
      };

      return context;
    } catch (error) {
      log.warn('构建终端上下文失败', error);
      return {
        sessionId,
        currentLine: '',
        recentOutput: '',
        cursorPosition: { x: 0, y: 0 },
        terminalSize: { cols: 80, rows: 24 },
        timestamp: Date.now()
      };
    }
  }

  /**
   * 获取当前行内容
   * @private
   */
  _getCurrentLine(terminal) {
    try {
      const buffer = terminal.buffer.active;
      const line = buffer.getLine(buffer.cursorY);
      return line ? line.translateToString() : '';
    } catch (error) {
      log.warn('获取当前行失败', error);
      return '';
    }
  }

  /**
   * 设置终端大小调整监听器
   * @private
   */
  _setupResizeObserver(terminal, fitAddon, sessionId, container) {
    try {
      // 创建ResizeObserver监听容器大小变化
      const resizeObserver = new ResizeObserver(_entries => {
        // 使用防抖避免频繁调整
        this._handleTerminalResize(terminal, fitAddon, sessionId);
      });

      // 开始监听容器大小变化
      resizeObserver.observe(container);

      // 存储observer以便后续清理
      this.resizeObservers.set(sessionId, resizeObserver);

      log.debug(`终端大小监听器已设置: ${sessionId}`);
    } catch (error) {
      log.error('设置终端大小监听器失败', error);

      // 降级方案：使用window resize事件
      const handleResize = () => this._handleTerminalResize(terminal, fitAddon, sessionId);
      window.addEventListener('resize', handleResize);

      // 存储清理函数
      this.resizeObservers.set(sessionId, {
        disconnect: () => window.removeEventListener('resize', handleResize)
      });
    }
  }

  /**
   * 处理终端大小调整（防抖）
   * @private
   */
  _handleTerminalResize(terminal, fitAddon, sessionId) {
    // 清除之前的定时器
    if (this.resizeTimeouts.has(sessionId)) {
      clearTimeout(this.resizeTimeouts.get(sessionId));
    }

    // 设置防抖定时器
    const timeoutId = setTimeout(() => {
      try {
        // 检查fitAddon和terminal是否可用
        if (!fitAddon || typeof fitAddon.fit !== 'function') {
          log.warn(`终端 ${sessionId} fitAddon不可用，跳过大小调整`);
          return;
        }

        if (!terminal || !terminal.element) {
          log.warn(`终端 ${sessionId} 元素不可用，跳过大小调整`);
          return;
        }

        // 调整终端大小
        fitAddon.fit();
        log.debug(`终端大小已调整: ${sessionId}`);

        // 清除定时器记录
        this.resizeTimeouts.delete(sessionId);
      } catch (error) {
        log.debug(`调整终端大小失败: ${sessionId}`, error.message);
        // 不显示用户错误反馈，因为这可能是正常的竞态条件
      }
    }, RESIZE_DEBOUNCE_DELAY);

    this.resizeTimeouts.set(sessionId, timeoutId);
  }

  /**
   * 显示错误反馈
   * @private
   */
  _showErrorFeedback(container, message) {
    try {
      // 创建错误提示元素
      const errorDiv = document.createElement('div');
      errorDiv.style.cssText = `
        position: absolute;
        top: 10px;
        right: 10px;
        background: rgba(239, 68, 68, 0.9);
        color: white;
        padding: 8px 12px;
        border-radius: 4px;
        font-size: 12px;
        z-index: var(--z-tooltip);
        pointer-events: none;
      `;
      errorDiv.textContent = message;

      // 添加到容器
      container.style.position = 'relative';
      container.appendChild(errorDiv);

      // 自动移除
      setTimeout(() => {
        if (errorDiv.parentNode) {
          errorDiv.parentNode.removeChild(errorDiv);
        }
      }, ERROR_FEEDBACK_DURATION);
    } catch (error) {
      log.warn('显示错误反馈失败', error);
    }
  }

  /**
   * 销毁终端
   * @param {string} sessionId - 会话ID
   */
  destroyTerminal(sessionId) {
    try {
      const terminal = this.terminals.get(sessionId);
      if (terminal) {
        // 调用session的destroy方法来清理资源
        const session = this.sshService.sessions.get(sessionId);
        if (session && session.destroy) {
          session.destroy();
        }

        log.debug(`终端已销毁: ${sessionId}`);
      }
    } catch (error) {
      log.error(`销毁终端失败: ${sessionId}`, error);
    }
  }

  /**
   * 向终端写入数据
   * @param {string} sessionId - 会话ID
   * @param {string} data - 要写入的数据
   */
  writeToTerminal(sessionId, data) {
    try {
      const terminal = this.terminals.get(sessionId);
      if (terminal) {
        terminal.write(data);
      }
    } catch (error) {
      log.error(`写入终端数据失败: ${sessionId}`, error);
    }
  }

  /**
   * 调整终端大小
   * @param {string} sessionId - 会话ID
   */
  fitTerminal(sessionId) {
    try {
      const terminal = this.terminals.get(sessionId);
      if (terminal && terminal._addonManager) {
        const fitAddon = terminal._addonManager._addons.find(addon => addon.instance?.fit);
        if (fitAddon) {
          fitAddon.instance.fit();
        }
      }
    } catch (error) {
      log.error(`调整终端大小失败: ${sessionId}`, error);
    }
  }

  /**
   * 获取所有终端实例
   * @returns {Map} - 终端实例映射
   */
  getAllTerminals() {
    return this.terminals;
  }

  /**
   * 获取指定终端实例
   * @param {string} sessionId - 会话ID
   * @returns {Terminal|null} - 终端实例
   */
  getTerminal(sessionId) {
    return this.terminals.get(sessionId) || null;
  }
}

export default TerminalManager;
