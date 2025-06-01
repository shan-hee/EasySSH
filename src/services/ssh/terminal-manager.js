import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import log from '../log';
import settings from '../settings';
import { WS_CONSTANTS } from '../constants';

/**
 * 终端管理器
 * 负责创建和管理终端实例
 */
class TerminalManager {
  constructor(sshService) {
    this.sshService = sshService;
    this.terminals = new Map(); // 存储终端实例
    log.info('终端管理器初始化完成');
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
    
    log.info(`创建终端，使用光标样式: ${cursorStyle}, 闪烁: ${cursorBlink}`);
    
    // 创建终端实例
    const terminal = new Terminal({
      fontSize: options.fontSize || settings.terminalFontSize || 14,
      fontFamily: options.fontFamily || settings.terminalFontFamily || "'JetBrains Mono'",
      theme: options.theme,
      cursorStyle: cursorStyle, // 确保使用传入的光标样式
      cursorBlink: cursorBlink, // 确保使用传入的光标闪烁设置
      scrollback: 5000, // 增加滚动历史行数，默认值通常是1000
      rightClickSelectsWord: true,
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
    fitAddon.fit();
    
    // 尝试聚焦终端
    try {
      log.info(`尝试聚焦新创建的终端: ${sessionId}`);
      terminal.focus();
    } catch (e) {
      log.warn(`聚焦终端失败: ${e.message}`);
    }
    
    // 处理用户输入
    terminal.onData((data) => {
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
    
    // 添加选中复制功能
    terminal.onSelectionChange(() => {
      if (terminal.hasSelection()) {
        const selectedText = terminal.getSelection();
        if (selectedText) {
          try {
            import('../settings').then(settingsModule => {
              const settingsService = settingsModule.default;
              const terminalOptions = settingsService.getTerminalOptions();
              
              if (terminalOptions && terminalOptions.copyOnSelect) {
                navigator.clipboard.writeText(selectedText);
              }
            }).catch(error => {
              log.error('加载设置服务失败:', error);
            });
          } catch (error) {
            log.error('复制到剪贴板失败:', error);
          }
        }
      }
    });
    
    // 添加右键粘贴功能
    const handleContextMenu = async (event) => {
      event.preventDefault();
      
      try {
        const settingsModule = await import('../settings');
        const settingsService = settingsModule.default;
        const terminalOptions = settingsService.getTerminalOptions();
        
        if (!terminalOptions || !terminalOptions.rightClickSelectsWord) {
          return;
        }
        
        try {
          const text = await navigator.clipboard.readText();
          if (text && text.trim().length > 0) {
            this.sshService._processTerminalInput(session, text);
          }
        } catch (error) {
          log.error('从剪贴板粘贴失败:', error);
          
          // 显示错误反馈
          if (terminal.element) {
            const errorFeedback = document.createElement('div');
            errorFeedback.textContent = '粘贴失败: ' + (error.message || '无法访问剪贴板');
            errorFeedback.style.position = 'absolute';
            errorFeedback.style.right = '10px';
            errorFeedback.style.top = '10px';
            errorFeedback.style.backgroundColor = 'rgba(220, 53, 69, 0.8)';
            errorFeedback.style.color = '#fff';
            errorFeedback.style.padding = '5px 10px';
            errorFeedback.style.borderRadius = '3px';
            errorFeedback.style.fontSize = '12px';
            errorFeedback.style.zIndex = '9999';
            
            terminal.element.appendChild(errorFeedback);
            
            // 3秒后移除错误提示
            setTimeout(() => {
              if (errorFeedback.parentNode) {
                errorFeedback.parentNode.removeChild(errorFeedback);
              }
            }, 3000);
          }
        }
      } catch (settingsError) {
        log.error('加载设置服务失败:', settingsError);
      }
    };
    
    container.addEventListener('contextmenu', handleContextMenu);
    
    // 添加终端粘贴事件监听
    const handleTerminalPaste = (event) => {
      if (event.detail && event.detail.text) {
        this.sshService._processTerminalInput(session, event.detail.text);
      }
    };
    container.addEventListener('terminal-paste', handleTerminalPaste);
    
    // 自动调整终端大小
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch (e) {
        log.error('调整终端大小失败', e);
      }
    });
    
    resizeObserver.observe(container);
    
    // 将终端与会话绑定
    session.terminal = terminal;
    this.terminals.set(sessionId, terminal);
    
    // 如果有缓冲的数据，写入终端
    if (session.buffer) {
      terminal.write(session.buffer);
      session.buffer = '';
    }
    
    // 添加销毁处理
    const destroy = () => {
      container.removeEventListener('contextmenu', handleContextMenu);
      container.removeEventListener('terminal-paste', handleTerminalPaste);
      resizeObserver.disconnect();
      terminal.dispose();
      this.terminals.delete(sessionId);
    };
    
    session.destroy = destroy;
    
    return terminal;
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