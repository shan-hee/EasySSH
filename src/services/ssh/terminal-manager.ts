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
  private sshService: any;
  private terminals: Map<string, any>;
  private resizeTimeouts: Map<string, number>;
  private resizeObservers: Map<string, ResizeObserver | { disconnect: () => void }>;
  private lastSyncedSize: Map<string, { cols: number; rows: number }>;
  private initialSizing: Map<string, boolean>;

  constructor(sshService: any) {
    this.sshService = sshService;
    this.terminals = new Map(); // 存储终端实例
    this.resizeTimeouts = new Map(); // 存储大小调整防抖定时器
    this.resizeObservers = new Map(); // 存储大小监听器
    this.lastSyncedSize = new Map(); // 记录每个会话最后一次同步到后端的尺寸，避免重复发送/重复日志
    this.initialSizing = new Map(); // 记录每个会话是否处于初始化尺寸阶段

    log.debug('终端管理器初始化完成');
  }

  /**
   * 创建终端并绑定到会话
   * @param {string} sessionId - SSH会话ID
   * @param {HTMLElement} container - 终端容器元素
   * @param {Object} options - 终端选项
   * @returns {Terminal} - 创建的终端实例
   */
  async createTerminal(
    sessionId: string,
    container: HTMLElement,
    options: Record<string, unknown> = {}
  ): Promise<any> {
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
    this._initializeTerminalSize(terminal, fitAddon, sessionId, container);

    // 尝试聚焦终端
    try {
      terminal.focus();
      log.debug(`终端聚焦完成: ${sessionId}`);
    } catch (e: any) {
      log.warn(`聚焦终端失败: ${e?.message}`);
    }

    // 处理用户输入 - 统一的数据处理入口
    terminal.onData(async (data: string) => {
      // log.debug('终端数据输入', { sessionId, data: data.charCodeAt ? data.charCodeAt(0) : data });

      // 使用智能补全
      terminalAutocompleteService.processInput(data, terminal);

      // 处理SSH输入
      this.sshService._processTerminalInput(session, data);
    });

    // 标记进入初始化尺寸阶段
    this.initialSizing.set(sessionId, true);

    // 处理终端大小变化
    terminal.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      if (session.socket && session.socket.readyState === WS_CONSTANTS.OPEN) {
        if (!this.initialSizing.get(sessionId)) {
          log.debug(`终端大小变化: ${sessionId} -> ${cols}x${rows}`);
        }

        try {
          // 使用统一的二进制消息发送器
          BinaryMessageSender.sendSSHResize(session.socket, sessionId, cols, rows);
          // 记录最后一次同步的尺寸
          this.lastSyncedSize.set(sessionId, { cols, rows });
        } catch (error: any) {
          log.debug(`发送终端大小变化失败: ${sessionId}`, error?.message);
        }
      }
    });

    // 处理上下文菜单和粘贴
    const handleContextMenu = (event: MouseEvent): void => {
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

    const handleTerminalPaste = (event: Event): void => {
      const ce = event as CustomEvent;
      if ((ce as any).detail && (ce as any).detail.text) {
        terminal.paste((ce as any).detail.text);
      }
    };

    container.addEventListener('contextmenu', handleContextMenu);
    container.addEventListener('terminal-paste', handleTerminalPaste as EventListener);

    // 处理输出数据以支持特殊功能
    session.processOutput = (data: string) => {
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
    // 不再显式发送 SSH_ATTACH；由“首次 RESIZE” 作为隐式附着信号触发后端启动 Shell

    // 启用智能补全
    terminalAutocompleteService.enable();
    log.debug('系统默认补全已启用', { sessionId });

    // 如果有缓冲的数据，写入终端
    if (session.buffer) {
      terminal.write(session.buffer);
      session.buffer = '';
      log.debug(`缓冲数据已写入终端: ${sessionId}`);
    }

    // 稳定终端尺寸：在终端完全可见后多次适配，并显式同步尺寸到服务器
    const scheduleStabilizeSize = () => {
      const ws = session.ws || session.socket || this.sshService.sessions.get(sessionId)?.ws || this.sshService.sessions.get(sessionId)?.socket;
      const safeResize = () => {
        try {
          // 使用创建时的 fitAddon 引用；避免未定义的变量
          if (fitAddon && typeof fitAddon.fit === 'function') {
            fitAddon.fit();
          }
        } catch (_) { /* ignore */ }
        try {
          if (ws && ws.readyState === WS_CONSTANTS.OPEN) {
            const cols = terminal.cols;
            const rows = terminal.rows;
            const last = this.lastSyncedSize.get(sessionId);
            // 仅当与上次不同才发送与记录，避免重复
            if (!last || last.cols !== cols || last.rows !== rows) {
              BinaryMessageSender.sendSSHResize(ws, sessionId, cols, rows);
              this.lastSyncedSize.set(sessionId, { cols, rows });
              log.debug(`显式同步终端尺寸: ${sessionId} -> ${cols}x${rows}`);
            }
          }
        } catch (_) { /* ignore */ }
      };
      // 多次尝试，覆盖字体/布局异步变化
      requestAnimationFrame(() => safeResize());
      setTimeout(() => safeResize(), 120);
      setTimeout(() => safeResize(), 360);
      // 在稳定化尝试后，结束初始化尺寸阶段
      setTimeout(() => {
        this.initialSizing.set(sessionId, false);
      }, 420);
    };
    scheduleStabilizeSize();

    // 添加销毁处理
    const destroy = (): void => {
      container.removeEventListener('contextmenu', handleContextMenu);
      container.removeEventListener('terminal-paste', handleTerminalPaste as unknown as EventListener);

      // 清理大小监听
      if (this.resizeObservers.has(sessionId)) {
        const ro = this.resizeObservers.get(sessionId)!;
        ro.disconnect();
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
  async _initializeTerminalSize(
    terminal: any,
    fitAddon: any,
    sessionId: string,
    container: HTMLElement
  ): Promise<void> {
    try {
      // 等待容器尺寸稳定（避免在首帧半高时进行fit）
      await this._awaitStableSize(container, { samples: 2, interval: 60, tolerance: 1 });

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

      // 调整终端大小（初始化阶段不记录日志）
      fitAddon.fit();
    } catch (error: any) {
      log.debug(`初始化终端大小失败: ${sessionId}`, error?.message);
    }
  }

  /**
   * 等待容器尺寸稳定
   * @private
   * @param {HTMLElement} el
   * @param {{samples?:number, interval?:number, tolerance?:number}} options
   */
  async _awaitStableSize(
    el: HTMLElement,
    { samples = 2, interval = 60, tolerance = 1 }: { samples?: number; interval?: number; tolerance?: number } = {}
  ): Promise<void> {
    if (!el || typeof el.getBoundingClientRect !== 'function') return;
    const near = (a: number, b: number) => Math.abs(a - b) <= tolerance;
    const rect = () => el.getBoundingClientRect();
    let last = rect();
    let stable = 0;
    while (stable < samples) {
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, interval)));
      const cur = rect();
      if (near(cur.width, last.width) && near(cur.height, last.height)) {
        stable++;
      } else {
        stable = 0;
        last = cur;
      }
    }
  }

  /**
   * 构建终端上下文信息
   * @private
   */
  _buildTerminalContext(terminal: any, sessionId: string): any {
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
  _getCurrentLine(terminal: any) {
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
  _setupResizeObserver(terminal: any, fitAddon: any, sessionId: string, container: HTMLElement): void {
    try {
      // 创建ResizeObserver监听容器大小变化
      const resizeObserver = new ResizeObserver((_entries) => {
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
  _handleTerminalResize(terminal: any, fitAddon: any, sessionId: string): void {
    // 清除之前的定时器
    if (this.resizeTimeouts.has(sessionId)) {
      clearTimeout(this.resizeTimeouts.get(sessionId));
    }

    // 设置防抖定时器
    const timeoutId = window.setTimeout(() => {
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
        if (!this.initialSizing.get(sessionId)) {
          log.debug(`终端大小已调整: ${sessionId}`);
        }

        // 清除定时器记录
        this.resizeTimeouts.delete(sessionId);
      } catch (error: any) {
        log.debug(`调整终端大小失败: ${sessionId}`, error?.message);
        // 不显示用户错误反馈，因为这可能是正常的竞态条件
      }
    }, RESIZE_DEBOUNCE_DELAY);

    this.resizeTimeouts.set(sessionId, timeoutId);
  }

  /**
   * 显示错误反馈
   * @private
   */
  _showErrorFeedback(container: HTMLElement, message: string): void {
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
  destroyTerminal(sessionId: string): void {
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
  writeToTerminal(sessionId: string, data: string): void {
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
  fitTerminal(sessionId: string): void {
    try {
      const terminal = this.terminals.get(sessionId);
      if (terminal && terminal._addonManager) {
        const fitAddon = terminal._addonManager._addons.find((addon: any) => addon.instance?.fit);
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
  getAllTerminals(): Map<string, any> {
    return this.terminals;
  }

  /**
   * 获取指定终端实例
   * @param {string} sessionId - 会话ID
   * @returns {Terminal|null} - 终端实例
   */
  getTerminal(sessionId: string): any | null {
    return this.terminals.get(sessionId) || null;
  }
}

export default TerminalManager;
