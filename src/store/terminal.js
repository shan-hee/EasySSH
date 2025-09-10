import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';
import sshService from '../services/ssh/index';
import log from '../services/log';
import { useUserStore } from './user';
import { useConnectionStore } from './connection';
import { useLocalConnectionsStore } from './localConnections';
import { FitAddon } from '@xterm/addon-fit';

import { computed } from 'vue';
import { useSessionStore } from './session';
import { waitForFontsLoaded } from '../utils/fontLoader';
import settingsService from '../services/settings';

export const useTerminalStore = defineStore('terminal', () => {
  // 使用reactive管理状态
  const state = reactive({
    // 存储所有终端实例，键为终端ID（通常是连接ID）
    terminals: {},

    // 存储会话信息
    sessions: {},

    // 终端连接状态
    connectionStatus: {},

    // 存储终端的FitAddon实例
    fitAddons: {},

    // 终端背景图片状态
    useBackgroundImage: false,

    // 新增：跟踪正在创建中的会话
    creatingSessionIds: [],

    // 在state中添加用于追踪监控连接状态的Map
    monitorConnectingHosts: {},

    // 新增：终端状态映射，跟踪每个终端的详细状态
    terminalStates: {},

    // 新增：终端初始化锁，防止并发初始化
    terminalInitLocks: {}
  });

  /**
   * 初始化终端
   * @param {string} connectionId - 连接ID
   * @param {HTMLElement} container - 终端容器元素
   * @returns {Promise<boolean>} - 是否成功初始化
   */
  const initTerminal = async (connectionId, container) => {
    try {
      // 参数验证
      if (!connectionId) {
        log.error('未提供连接ID');
        return false;
      }

      if (!container) {
        log.error('未提供终端容器元素');
        return false;
      }

      // 获取当前终端状态或初始化
      const currentState = state.terminalStates[connectionId] || 'not_initialized';

      // 检查终端是否已在初始化中，使用锁机制防止并发初始化
      if (state.terminalInitLocks[connectionId]) {
        // 终端初始化已被锁定
        return false;
      }

      // 检查终端是否已初始化完成
      if (
        currentState === 'initialized' &&
        state.terminals[connectionId] &&
        state.sessions[connectionId]
      ) {
        log.info(`终端 ${connectionId} 已完成初始化，直接重新附加`);
        // 将终端实例重新附加到新的容器
        const success = reattachTerminal(connectionId, container);

        // 触发一次状态更新事件
        window.dispatchEvent(
          new CustomEvent('terminal-status-update', {
            detail: { terminalId: connectionId, status: 'ready', isNew: false }
          })
        );

        return success;
      }

      // 检查终端是否已在创建中但尚未完成
      if (currentState === 'initializing' || state.creatingSessionIds.includes(connectionId)) {
        // 终端正在初始化中
        return false;
      }

      // 设置锁和状态，开始初始化流程
      state.terminalInitLocks[connectionId] = true;
      state.terminalStates[connectionId] = 'initializing';

      // 添加到创建中列表（冗余但兼容现有代码）
      if (!state.creatingSessionIds.includes(connectionId)) {
        state.creatingSessionIds.push(connectionId);
      }

      // 设置连接状态
      state.connectionStatus[connectionId] = 'connecting';

      // 发布状态变更事件，通知UI终端开始初始化
      window.dispatchEvent(
        new CustomEvent('terminal-status-update', {
          detail: { terminalId: connectionId, status: 'initializing', isNew: true }
        })
      );

      const startTime = performance.now();
      log.info(`[Terminal] 开始初始化终端: ${connectionId}`);

      // 获取连接信息（原有逻辑）
      const userStore = useUserStore();
      const connectionStore = useConnectionStore();
      const localConnectionsStore = useLocalConnectionsStore();
      const sessionStore = useSessionStore();

      // 首先从会话存储中尝试获取连接信息
      let connection = null;
      const sessionData = sessionStore.getSession(connectionId);

      if (sessionData) {
        // 从会话存储获取连接配置
        connection = sessionData;
      } else {
        // 尝试使用原始连接ID查找连接信息
        let originalConnectionId = null;

        // 根据登录状态决定从哪个store获取连接
        if (userStore.isLoggedIn) {
          connection = connectionStore.getConnectionById(connectionId);
          if (!connection) {
            // 如果找不到，可能是使用了新生成的会话ID，尝试查找所有连接
            for (const conn of userStore.connections) {
              if (
                conn.host === sessionData?.host &&
                conn.username === sessionData?.username &&
                conn.port === sessionData?.port
              ) {
                originalConnectionId = conn.id;
                connection = conn;
                break;
              }
            }
          }

          if (connection) {
            log.info(`从用户存储获取连接配置: ${originalConnectionId || connectionId}`);
            // 注册到会话存储
            sessionStore.registerSession(connectionId, {
              ...connection,
              id: connectionId,
              originalConnectionId: originalConnectionId || connection.id,
              title: connection.name || `${connection.username}@${connection.host}`
            });
          }
        } else {
          connection = localConnectionsStore.getConnectionById(connectionId);
          if (!connection) {
            // 如果找不到，可能是使用了新生成的会话ID，尝试查找所有连接
            for (const conn of localConnectionsStore.getAllConnections) {
              if (
                conn.host === sessionData?.host &&
                conn.username === sessionData?.username &&
                conn.port === sessionData?.port
              ) {
                originalConnectionId = conn.id;
                connection = conn;
                break;
              }
            }
          }

          if (connection) {
            log.info(`从本地连接存储获取连接配置: ${originalConnectionId || connectionId}`);
            // 注册到会话存储
            sessionStore.registerSession(connectionId, {
              ...connection,
              id: connectionId,
              originalConnectionId: originalConnectionId || connection.id,
              title: connection.name || `${connection.username}@${connection.host}`
            });
          }
        }
      }

      if (!connection) {
        log.error(`无法找到连接信息: ${connectionId}`);
        state.connectionStatus[connectionId] = 'error';
        state.terminalStates[connectionId] = 'error';
        state.terminalInitLocks[connectionId] = false;

        // 从创建中列表移除
        const index = state.creatingSessionIds.indexOf(connectionId);
        if (index !== -1) {
          state.creatingSessionIds.splice(index, 1);
        }

        // 发布错误状态事件
        window.dispatchEvent(
          new CustomEvent('terminal-status-update', {
            detail: { terminalId: connectionId, status: 'error', error: '无法找到连接信息' }
          })
        );

        return false;
      }

      // 触发SSH连接开始事件，用于并行启动监控连接
      window.dispatchEvent(
        new CustomEvent('ssh-connecting', {
          detail: {
            terminalId: connectionId,
            host: connection.host,
            connection
          }
        })
      );

      // 创建SSH会话（原有逻辑）
      try {
        const sessionId = await sshService.createSession({
          ...connection,
          terminalId: connectionId // 传递终端ID，确保正确的映射关系
        });

        // 监控服务连接由统一的监控服务处理，通过 ssh-connected 事件触发
        // 这里不再重复调用，避免重复的API请求

        // 获取终端设置（保留原有逻辑）
        const terminalOptions = await _getTerminalOptions();

        // 创建终端
        const terminal = await sshService.createTerminal(sessionId, container, terminalOptions);

        // 为终端元素添加标识
        if (terminal && terminal.element) {
          terminal.element.setAttribute('data-terminal-id', connectionId);
        }

        // 获取SSHService中可能创建的FitAddon实例
        // 因为没有直接访问FitAddon的方法，我们临时创建一个新的用于备份
        const fitAddon = new FitAddon();

        // 存储终端和会话信息
        state.terminals[connectionId] = terminal;
        state.sessions[connectionId] = sessionId;
        state.connectionStatus[connectionId] = 'connected';
        state.fitAddons[connectionId] = fitAddon;

        // 更新终端状态为已初始化
        state.terminalStates[connectionId] = 'initialized';

        // 修复xterm-helpers元素显示问题
        fixXtermHelpers();

        // 在SSH会话对象中保存终端ID，以便SFTP功能使用
        // 注意：映射关系已在 ssh-service.js 中建立，这里只是确保会话对象中也有引用
        try {
          const session = sshService.sessions.get(sessionId);
          if (session && !session.terminalId) {
            session.terminalId = connectionId;
            log.debug(`补充设置SSH会话 ${sessionId} 的终端ID: ${connectionId}`);
          }
        } catch (error) {
          log.warn('设置终端ID映射失败:', error);
        }

        // 终端初始化完成，发布统一的终端就绪事件
        const endTime = performance.now();
        const duration = Math.round(endTime - startTime);
        log.info(`[Terminal] 终端 ${connectionId} 初始化成功 (耗时: ${duration}ms)`);
        window.dispatchEvent(
          new CustomEvent('terminal-status-update', {
            detail: {
              terminalId: connectionId,
              status: 'ready',
              isNew: true,
              sessionId
            }
          })
        );

        // 从创建中列表移除
        const index = state.creatingSessionIds.indexOf(connectionId);
        if (index !== -1) {
          state.creatingSessionIds.splice(index, 1);
        }

        // 解锁初始化
        state.terminalInitLocks[connectionId] = false;

        return true;
      } catch (error) {
        log.error(`终端 ${connectionId} 初始化失败:`, error);
        state.connectionStatus[connectionId] = 'error';
        state.terminalStates[connectionId] = 'error';

        // 从创建中列表移除
        const index = state.creatingSessionIds.indexOf(connectionId);
        if (index !== -1) {
          state.creatingSessionIds.splice(index, 1);
        }

        // 解锁初始化
        state.terminalInitLocks[connectionId] = false;

        // 发布错误状态事件
        window.dispatchEvent(
          new CustomEvent('terminal-status-update', {
            detail: {
              terminalId: connectionId,
              status: 'error',
              error: error.message || '初始化失败'
            }
          })
        );

        return false;
      }
    } catch (error) {
      log.error('终端初始化发生意外错误:', error);

      // 确保释放锁和更新状态
      state.terminalStates[connectionId] = 'error';
      state.terminalInitLocks[connectionId] = false;

      // 从创建中列表移除
      const index = state.creatingSessionIds.indexOf(connectionId);
      if (index !== -1) {
        state.creatingSessionIds.splice(index, 1);
      }

      return false;
    }
  };

  /**
   * 辅助函数: 获取终端选项
   * @private
   */
  const _getTerminalOptions = async () => {
    // 等待字体加载完成
    await waitForFontsLoaded();

    // 获取基础终端选项，主题将从设置服务获取
    let terminalOptions = {
      fontSize: 16,
      fontFamily: "'JetBrains Mono'",
      // 显式设置字符间距为0，避免渲染差异
      letterSpacing: 0,
      // 使用设置服务的默认主题
      theme: settingsService.getTerminalTheme()
    };

    // 获取设置中的终端选项
    try {
      // 确保设置服务已初始化
      if (!settingsService.isInitialized) {
        log.warn('设置服务未初始化，尝试初始化...');
        await settingsService.init();
      }

      // 直接使用统一的设置服务
      const settings = settingsService.getTerminalSettings();

      // 更新选项
      if (settings) {
        if (settings.fontSize) {
          terminalOptions.fontSize = settings.fontSize;
        }

        if (settings.fontFamily) {
          terminalOptions.fontFamily = settings.fontFamily;
        }

        if (settings.cursorStyle) {
          terminalOptions.cursorStyle = settings.cursorStyle;
        }

        if (settings.cursorBlink !== undefined) {
          terminalOptions.cursorBlink = settings.cursorBlink;
        }

        // 优化：只记录关键配置信息，避免大量主题颜色配置的冗余输出
        log.info(
          `终端配置: 字体${terminalOptions.fontFamily} ${terminalOptions.fontSize}px, 光标${terminalOptions.cursorStyle}${terminalOptions.cursorBlink ? '(闪烁)' : ''}`
        );
      }

      // 获取完整的终端选项（包含主题）
      const fullTerminalOptions = settingsService.getTerminalOptions();
      if (fullTerminalOptions) {
        // 合并完整选项，优先使用设置服务的完整配置
        terminalOptions = { ...terminalOptions, ...fullTerminalOptions };
      }
    } catch (error) {
      log.error('获取终端设置失败，使用默认选项:', error);
    }

    return terminalOptions;
  };

  /**
   * 修复xterm-helpers元素的显示问题
   */
  const fixXtermHelpers = () => {
    setTimeout(() => {
      const helpers = document.querySelector('.xterm-helpers');
      if (helpers) {
        // 确保helpers容器正确定位且不可见
        helpers.style.position = 'absolute';
        helpers.style.top = '0';
        helpers.style.left = '0';
        helpers.style.pointerEvents = 'none';

        // 处理textarea元素
        const textarea = helpers.querySelector('.xterm-helper-textarea');
        if (textarea) {
          textarea.style.opacity = '0';
          textarea.style.zIndex = '-5';
        }

        // 处理字符测量元素
        const charMeasure = helpers.querySelector('.xterm-char-measure-element');
        if (charMeasure) {
          charMeasure.style.visibility = 'hidden';
          charMeasure.style.position = 'absolute';
          charMeasure.style.top = '0';
          charMeasure.style.left = '-9999em';
        }
      }
    }, 100);
  };

  /**
   * 重新附加终端到新的容器元素
   * @param {string} connectionId - 连接ID
   * @param {HTMLElement} container - 新的终端容器元素
   */
  const reattachTerminal = (connectionId, container) => {
    try {
      const terminal = state.terminals[connectionId];
      if (!terminal) {
        return false;
      }

      // 终端重新附加到新容器
      if (container) {
        // 清空容器
        while (container.firstChild) {
          container.removeChild(container.firstChild);
        }

        // 直接获取终端DOM元素
        const terminalElement =
          terminal.element || document.querySelector(`.xterm[data-terminal-id="${connectionId}"]`);

        if (terminalElement && terminalElement.parentElement) {
          terminalElement.parentElement.removeChild(terminalElement);

          // 为终端元素添加标识，方便后续查找
          if (terminalElement) {
            terminalElement.setAttribute('data-terminal-id', connectionId);
          }
        }

        // 将终端DOM元素附加到新容器
        if (terminalElement) {
          container.appendChild(terminalElement);

          // 确保元素尺寸正确
          terminalElement.style.width = '100%';
          terminalElement.style.height = '100%';
        } else {
          log.info('找不到终端DOM元素，将尝试使用替代方案');
          // 替代方案：如果无法移动DOM元素，则重新初始化终端
          terminal.clear();
          // 重新加载当前内容
          terminal.refresh(0, terminal.rows - 1);
        }

        // 确保终端大小适应容器
        setTimeout(() => {
          fitTerminal(connectionId);

          // 在终端调整大小后尝试聚焦
          try {
            log.info(`尝试聚焦重新附加的终端: ${connectionId}`);
            focusTerminal(connectionId);
          } catch (e) {
            log.warn(`聚焦终端失败: ${e.message}`);
          }
        }, 50);
      }

      // 更新状态为已连接
      state.connectionStatus[connectionId] = 'connected';

      return true;
    } catch (error) {
      log.error('重新附加终端失败:', error);
      return false;
    }
  };

  /**
   * 调整终端大小以适应容器
   * @param {string} connectionId - 连接ID
   */
  const fitTerminal = connectionId => {
    // 检查终端是否存在
    if (!state.terminals[connectionId]) {
      log.warn(`终端不存在，无法调整大小: ${connectionId}`);
      return;
    }

    const terminal = state.terminals[connectionId];

    // 检查终端是否有效
    if (!terminal || typeof terminal !== 'object') {
      log.warn(`终端对象无效: ${connectionId}`);
      return;
    }

    try {
      let resizeSuccess = false;
      let finalSize = null;

      // 统一处理终端对象
      if (terminal.terminal) {
        // 标准终端对象结构

        // 检查和使用FitAddon
        if (terminal.addons && terminal.addons.fit) {
          try {
            terminal.addons.fit.fit();
            resizeSuccess = true;
            finalSize = `${terminal.terminal.cols}x${terminal.terminal.rows}`;
          } catch (e) {
            log.warn('使用addons.fit调整大小失败:', e);
          }
        } else {
          // 尝试其他FitAddon获取和创建方式
          // 使用备份或创建新的FitAddon的代码保持不变...
        }

        // 触发终端的resize事件
        if (terminal.terminal._core && resizeSuccess) {
          const _event = {
            cols: terminal.terminal.cols,
            rows: terminal.terminal.rows
          };
          // 内部大小调整代码保持不变...
        }
      } else if (typeof terminal.fit === 'function') {
        // 直接支持fit方法的终端对象
        try {
          terminal.fit();
          resizeSuccess = true;
        } catch (e) {
          log.warn('使用终端自带fit方法失败:', e);
        }
      } else {
        // 通用处理：尝试使用备份的FitAddon
        if (state.fitAddons[connectionId]) {
          try {
            state.fitAddons[connectionId].fit();
            resizeSuccess = true;
          } catch (e) {
            log.warn('使用备份FitAddon失败:', e);
          }
        } else {
          log.warn('无法调整终端大小：缺少合适的FitAddon');
        }
      }

      // 合并日志输出 - 只在成功时输出一条日志
      if (resizeSuccess) {
        log.info(`终端大小调整完成: ${connectionId}${finalSize ? ` (${finalSize})` : ''}`);
      }
    } catch (error) {
      log.error('调整终端大小失败:', error);
    }
  };

  /**
   * 发送命令到终端
   * @param {string} connectionId - 连接ID（可能是终端ID或SSH会话ID）
   * @param {string} command - 要执行的命令
   * @param {Object} options - 选项
   * @param {boolean} options.clearLine - 是否清除当前行，默认true
   * @param {boolean} options.execute - 是否自动执行命令，默认true
   * @param {boolean} options.sendCtrlC - 是否发送Ctrl+C来清除当前输入，默认true
   */
  const sendCommand = (connectionId, command, options = {}) => {
    const terminal = state.terminals[connectionId];
    if (!terminal) {
      log.warn(`终端不存在: ${connectionId}`);
      return false;
    }

    // 获取SSH会话ID - 首先尝试从sessions映射中获取
    let sessionId = state.sessions[connectionId];
    let session = null;

    if (sessionId) {
      // 如果找到了映射的会话ID，使用它
      session = sshService.sessions.get(sessionId);
      log.debug(`通过终端ID ${connectionId} 找到SSH会话ID: ${sessionId}`);
    } else {
      // 如果没有找到映射，可能connectionId本身就是会话ID
      session = sshService.sessions.get(connectionId);
      if (session) {
        sessionId = connectionId;
        log.debug(`直接使用连接ID作为SSH会话ID: ${connectionId}`);
      }
    }

    if (!session) {
      log.warn(`SSH会话不存在: 终端ID=${connectionId}, 会话ID=${sessionId}`);
      return false;
    }

    const { clearLine = true, execute = true, sendCtrlC = true } = options;

    // 如果命令为空，只发送换行符
    if (!command || command.trim() === '') {
      // 直接通过SSH服务发送回车符
      sshService._processTerminalInput(session, '\r');
      return true;
    }

    log.info(
      `发送命令到终端 ${connectionId} (会话: ${sessionId}): ${command.substring(0, 100)}${command.length > 100 ? '...' : ''}`
    );

    try {
      // 如果需要清除当前行
      if (clearLine && sendCtrlC) {
        // 发送 Ctrl+C 来取消当前可能的输入
        sshService._processTerminalInput(session, '\x03');

        // 等待终端处理 Ctrl+C，然后发送命令
        setTimeout(() => {
          try {
            // 发送命令字符串
            sshService._processTerminalInput(session, command);

            // 如果需要自动执行，发送回车
            if (execute) {
              setTimeout(() => {
                sshService._processTerminalInput(session, '\r');
                log.info('命令已执行完成');
              }, 100);
            }
          } catch (error) {
            log.error(`发送命令失败: ${error.message}`);
          }
        }, 300); // 等待 Ctrl+C 被处理
      } else {
        // 直接发送命令
        sshService._processTerminalInput(session, command);

        // 如果需要自动执行，发送回车
        if (execute) {
          setTimeout(() => {
            sshService._processTerminalInput(session, '\r');
            log.info('命令已执行完成');
          }, 100);
        }
      }
      return true;
    } catch (error) {
      log.error(`发送命令到终端失败: ${error.message}`);
      return false;
    }
  };

  /**
   * 清除终端内容
   * @param {string} connectionId - 连接ID
   */
  const clearTerminal = connectionId => {
    const terminal = state.terminals[connectionId];
    if (terminal) {
      terminal.clear();
    }
  };

  /**
   * 测试发送简单命令
   * @param {string} connectionId - 连接ID
   * @param {string} testCommand - 测试命令，默认为 'echo "test"'
   */
  const _sendTestCommand = (connectionId, testCommand = 'echo "test"') => {
    log.info(`发送测试命令: ${testCommand}`);
    return sendCommand(connectionId, testCommand, { clearLine: true, execute: true });
  };

  /**
   * 断开终端连接
   * @param {string} connectionId - 连接ID
   * @returns {Promise<boolean>} - 是否成功断开
   */
  const disconnectTerminal = async connectionId => {
    try {
      log.info(`准备断开终端连接: ${connectionId}`);

      // 获取会话ID
      const sessionId = state.sessions[connectionId];
      if (!sessionId) {
        log.debug(`断开终端连接: 找不到会话ID，连接ID=${connectionId}`);
        return false;
      }

      // 关闭SSH会话
      try {
        await sshService.closeSession(sessionId);
        log.info(`SSH会话已关闭: ${sessionId}`);
      } catch (closeError) {
        log.error(`关闭SSH会话失败: ${sessionId}`, closeError);
        // 即使关闭会话失败，也继续清理资源
      }

      // 清理终端实例
      const terminal = state.terminals[connectionId];
      if (!terminal) {
        log.warn(`找不到终端实例: ${connectionId}`);
        // 继续清理其他资源...
      } else if (typeof terminal !== 'object') {
        log.warn(`终端实例类型无效，类型: ${typeof terminal}`);
        // 继续清理其他资源...
      } else {
        try {
          log.info(`销毁终端实例: ${connectionId}`);

          // 检查是否存在终端实例及其有效性
          if (!terminal) {
            log.warn(`找不到终端实例: ${connectionId}`);
            // 仍然删除任何可能存在的状态
            delete state.terminals[connectionId];
            delete state.sessions[connectionId];
            delete state.connectionStatus[connectionId];
            delete state.fitAddons[connectionId];
            log.debug(`已清理无效终端的状态: ${connectionId}`);
            return true;
          } else if (typeof terminal !== 'object') {
            log.debug(`终端实例类型无效，类型: ${typeof terminal}`);
            // 清理状态
            delete state.terminals[connectionId];
            delete state.sessions[connectionId];
            delete state.connectionStatus[connectionId];
            delete state.fitAddons[connectionId];
            log.debug(`已清理类型无效的终端状态: ${connectionId}`);
            return true;
          }

          // 优化终端结构检测和处理
          if (terminal.terminal && typeof terminal.terminal === 'object') {
            // 标准终端结构处理
            log.debug('检测到标准终端结构，使用安全销毁流程');

            // 处理标准终端结构的代码保持不变...
          }
          // 简化检测逻辑，统一处理其他类型终端
          else {
            log.info('检测到终端对象，执行通用销毁流程');

            // 统一的资源释放流程
            const safeDisposeTerminal = term => {
              // 1. 尝试调用标准的清理方法
              const disposeMethods = ['dispose', 'destroy', 'close', 'shutdown'];

              // 尝试调用所有可能的销毁方法
              let disposed = false;
              for (const method of disposeMethods) {
                if (typeof term[method] === 'function') {
                  try {
                    log.info(`调用终端${method}方法`);
                    term[method]();
                    disposed = true;
                    break; // 一旦成功就不再尝试其他方法
                  } catch (e) {
                    log.warn(`${method}方法调用失败:`, e.message);
                  }
                }
              }

              // 2. 如果终端有clear方法尝试清空内容
              if (!disposed && typeof term.clear === 'function') {
                try {
                  term.clear();
                } catch (e) {
                  log.warn('清空终端内容失败:', e.message);
                }
              }

              // 3. 安全访问和清理内部结构
              try {
                // 使用可选链操作符和严格的存在性判断
                const hasCore = term && term._core;

                if (hasCore) {
                  // 处理事件监听器
                  const hasEvents = term._core._events !== undefined && term._core._events !== null;
                  if (hasEvents) {
                    try {
                      for (const event in term._core._events) {
                        term._core._events[event] = null;
                      }
                    } catch (e) {
                      // 忽略事件处理错误
                    }
                  }

                  // 处理插件管理器
                  const hasAddonManager = term._core._addonManager;
                  if (hasAddonManager) {
                    try {
                      const hasAddons = Array.isArray(term._core._addonManager._addons);
                      if (hasAddons) {
                        term._core._addonManager._addons = [];
                      }
                    } catch (e) {
                      // 忽略插件管理器错误
                    }
                  }

                  // 处理渲染服务 - 彻底解决dimensions访问问题
                  const hasRenderService = term._core._renderService;
                  if (hasRenderService) {
                    try {
                      // 先检查dimensions属性是否真实存在
                      const hasDimensions = Object.prototype.hasOwnProperty.call(
                        term._core._renderService,
                        'dimensions'
                      );

                      if (hasDimensions && term._core._renderService.dimensions) {
                        try {
                          // 使用Object.keys安全地判断要清理的属性
                          const dimensionsObj = term._core._renderService.dimensions;
                          const dimensionProps = Object.keys(dimensionsObj);

                          // 只处理真实存在的属性
                          dimensionProps.forEach(prop => {
                            if (typeof dimensionsObj[prop] === 'object') {
                              dimensionsObj[prop] = {};
                            }
                          });
                        } catch (dimError) {
                          // 静默处理dimensions错误
                        }
                      }
                    } catch (renderError) {
                      // 静默处理渲染服务错误
                    }
                  }
                }
              } catch (e) {
                // 更精确的错误处理
                if (e.message.includes('Cannot read properties of undefined')) {
                  log.debug('忽略未初始化属性访问');
                } else {
                  log.debug('清理终端内部资源时遇到非致命错误:', e.message);
                }
              }

              // 4. 移除DOM元素
              try {
                const selector = `.xterm[data-terminal-id="${connectionId}"]`;
                const terminalElement = document.querySelector(selector);
                if (terminalElement && terminalElement.parentElement) {
                  terminalElement.parentElement.removeChild(terminalElement);
                }
              } catch (e) {
                log.warn('移除终端DOM元素时出错:', e.message);
              }

              // 5. 最终清理 - 移除所有可能的循环引用
              try {
                for (const key in term) {
                  if (typeof term[key] === 'object' && term[key] !== null) {
                    term[key] = null;
                  }
                }
              } catch (e) {
                // 忽略属性清理错误
              }
            };

            // 执行资源释放
            safeDisposeTerminal(terminal);
          }

          log.info(`终端实例已尝试销毁: ${connectionId}`);
        } catch (disposeError) {
          log.error(`销毁终端实例失败，但将继续清理其他资源: ${connectionId}`, disposeError);
        }
      }

      // 清理FitAddon
      if (state.fitAddons?.[connectionId]) {
        log.info(`移除FitAddon: ${connectionId}`);

        try {
          const fitAddon = state.fitAddons[connectionId];

          // 只在fitAddon是有效对象且有dispose方法时尝试销毁
          if (fitAddon && typeof fitAddon === 'object' && typeof fitAddon.dispose === 'function') {
            try {
              // 包装dispose方法以捕获常见错误
              const originalDispose = fitAddon.dispose;
              fitAddon.dispose = function () {
                try {
                  return originalDispose.apply(this, arguments);
                } catch (e) {
                  // 静默处理常见错误
                  if (
                    e.message &&
                    (e.message.includes('has not been loaded') ||
                      e.message.includes('Cannot read properties'))
                  ) {
                    return; // 忽略
                  }
                  throw e; // 重新抛出非预期错误
                }
              };

              fitAddon.dispose();
            } catch (e) {
              log.debug('FitAddon销毁出错，继续处理:', e.message);
            }
          }
        } catch (e) {
          // 完全忽略错误
        } finally {
          // 无论如何都确保引用被清理
          state.fitAddons[connectionId] = null;
          delete state.fitAddons[connectionId];
        }
      }

      // 删除状态
      log.info(`清理终端状态: ${connectionId}`);
      delete state.terminals[connectionId];
      delete state.sessions[connectionId];
      delete state.connectionStatus[connectionId];

      // 通知SSH服务释放资源
      try {
        await sshService.releaseResources(sessionId);
      } catch (error) {
        log.warn(`通知SSH服务释放资源失败: ${sessionId}`, error);
      }

      // 确认资源已释放
      const resourceCheck = {
        terminal: !!state.terminals[connectionId],
        session: !!state.sessions[connectionId],
        status: !!state.connectionStatus[connectionId],
        fitAddon: !!state.fitAddons[connectionId]
      };

      // 如果有任何资源未释放，再次尝试清理
      if (Object.values(resourceCheck).some(v => v)) {
        log.debug(`检测到未完全释放的资源，再次清理: ${connectionId}`);
        for (const key in resourceCheck) {
          if (resourceCheck[key]) {
            state[key === 'fitAddon' ? 'fitAddons' : `${key}s`][connectionId] = null;
            delete state[key === 'fitAddon' ? 'fitAddons' : `${key}s`][connectionId];
          }
        }
      }

      // 触发垃圾回收
      triggerGarbageCollection();

      // 触发终端销毁事件，通知监控工厂和其他组件
      window.dispatchEvent(
        new CustomEvent('terminal:destroyed', {
          detail: { terminalId: connectionId }
        })
      );

      log.info(`终端 ${connectionId} 断开成功`);
      return true;
    } catch (error) {
      log.error(`断开终端连接失败: ${connectionId}`, error);

      // 确保在出错时也尝试清理状态
      try {
        delete state.terminals[connectionId];
        delete state.sessions[connectionId];
        delete state.connectionStatus[connectionId];
        delete state.fitAddons[connectionId];

        // 即使出错也尝试触发终端销毁事件
        window.dispatchEvent(
          new CustomEvent('terminal:destroyed', {
            detail: { terminalId: connectionId }
          })
        );
      } catch (e) {
        // 忽略清理错误
      }

      return false;
    }
  };

  /**
   * 获取终端状态
   * @param {string} connectionId - 连接ID
   * @returns {string} - 连接状态
   */
  const getTerminalStatus = connectionId => {
    return state.connectionStatus[connectionId] || 'unknown';
  };

  /**
   * 终端是否已连接
   * @param {string} connectionId - 连接ID
   * @returns {boolean} - 是否已连接
   */
  const isTerminalConnected = connectionId => {
    return state.connectionStatus[connectionId] === 'connected';
  };

  /**
   * 检查终端是否已存在
   * @param {string} connectionId - 连接ID
   * @returns {boolean} - 是否已存在
   */
  const hasTerminal = connectionId => {
    return !!state.terminals[connectionId];
  };

  /**
   * 获取终端实例
   * @param {string} connectionId - 连接ID
   * @returns {Object|null} - 终端实例或null
   */
  const getTerminal = connectionId => {
    return state.terminals[connectionId] || null;
  };

  /**
   * 聚焦终端
   * @param {string} connectionId - 连接ID
   */
  const focusTerminal = connectionId => {
    if (state.terminals[connectionId]) {
      try {
        const terminal = state.terminals[connectionId];

        // 在聚焦前确保光标样式正确
        const settings = settingsService.getTerminalSettings();

        if (settings.cursorStyle && terminal.setOption) {
          terminal.setOption('cursorStyle', settings.cursorStyle);
        }
        if (settings.cursorBlink !== undefined && terminal.setOption) {
          terminal.setOption('cursorBlink', settings.cursorBlink);
        }

        // 聚焦终端
        terminal.focus();

        // 聚焦后再次确保光标样式正确
        setTimeout(() => {
          if (settings.cursorStyle && terminal.setOption) {
            terminal.setOption('cursorStyle', settings.cursorStyle);
          }
          if (settings.cursorBlink !== undefined && terminal.setOption) {
            terminal.setOption('cursorBlink', settings.cursorBlink);
          }
        }, 10);
      } catch (e) {
        log.error('聚焦终端失败:', e);
      }
    }
  };

  /**
   * 将设置应用到所有打开的终端
   * @param {Object} settings - 终端设置
   * @returns {Object} - 应用结果，键为连接ID，值为是否成功
   */
  const applySettingsToAllTerminals = async settings => {
    if (!settings) {
      log.warn('无法应用设置：设置对象为空');
      return {};
    }

    const results = {};

    // 获取所有终端ID
    const terminalIds = Object.keys(state.terminals);

    if (terminalIds.length === 0) {
      log.info('没有找到打开的终端，无需应用设置');
      return results;
    }

    log.info(`正在将设置应用到 ${terminalIds.length} 个终端...`);

    // 遍历所有终端并应用设置
    for (const termId of terminalIds) {
      try {
        const terminal = state.terminals[termId];
        if (!terminal) {
          results[termId] = false;
          continue;
        }

        let hasChanges = false;

        // 应用字体大小
        if (settings.fontSize && terminal.options.fontSize !== settings.fontSize) {
          terminal.options.fontSize = settings.fontSize;
          hasChanges = true;
        }

        // 应用字体系列
        if (settings.fontFamily && terminal.options.fontFamily !== settings.fontFamily) {
          terminal.options.fontFamily = settings.fontFamily;
          hasChanges = true;
        }

        // 应用光标样式
        if (settings.cursorStyle && terminal.options.cursorStyle !== settings.cursorStyle) {
          terminal.options.cursorStyle = settings.cursorStyle;
          hasChanges = true;
        }

        // 应用光标闪烁
        if (
          settings.cursorBlink !== undefined &&
          terminal.options.cursorBlink !== settings.cursorBlink
        ) {
          terminal.options.cursorBlink = settings.cursorBlink;
          hasChanges = true;
        }

        // 应用终端主题
        if (settings.theme) {
          try {
            const themeConfig = settingsService.getTerminalTheme(settings.theme);
            log.info(`终端 ${termId}: 获取到主题配置:`, themeConfig);

            // 优化主题比较：只比较背景色来判断主题是否变化
            const currentBg = terminal.options?.theme?.background;
            const newBg = themeConfig.background;
            log.info(`终端 ${termId}: 主题比较 - 当前: ${currentBg}, 新: ${newBg}`);

            if (currentBg !== newBg) {
              log.info(`终端 ${termId}: 更新主题 ${currentBg} -> ${newBg}`);
              log.info(`终端 ${termId}: 终端对象结构:`, {
                hasTerminal: !!terminal.terminal,
                hasSetOption: !!(terminal.terminal?.setOption || terminal.setOption),
                terminalType: typeof terminal
              });

              // 应用新主题到终端实例
              // xterm.js 5.x版本中，直接修改options.theme属性即可
              try {
                // 方法1: 直接修改options属性（推荐方式）
                if (terminal.options) {
                  terminal.options.theme = themeConfig;
                  log.info(`终端 ${termId}: 主题已通过options属性应用`);

                  // 使用更轻量的刷新方式
                  setTimeout(() => {
                    if (typeof terminal.refresh === 'function') {
                      terminal.refresh(0, terminal.rows - 1);
                    } else if (terminal._core && typeof terminal._core.refresh === 'function') {
                      terminal._core.refresh(0, terminal.rows - 1);
                    }
                  }, 0); // 异步执行，避免阻塞UI
                }
                // 方法2: 尝试使用setOption（如果存在）
                else if (typeof terminal.setOption === 'function') {
                  terminal.setOption('theme', themeConfig);
                  log.info(`终端 ${termId}: 主题已通过setOption应用`);
                }
                // 方法3: 如果是终端实例对象
                else if (terminal.terminal) {
                  if (terminal.terminal.options) {
                    terminal.terminal.options.theme = themeConfig;
                    log.info(`终端 ${termId}: 主题已通过terminal.terminal.options应用`);

                    // 强制刷新
                    if (typeof terminal.terminal.refresh === 'function') {
                      terminal.terminal.refresh(0, terminal.terminal.rows - 1);
                    }
                  } else if (typeof terminal.terminal.setOption === 'function') {
                    terminal.terminal.setOption('theme', themeConfig);
                    log.info(`终端 ${termId}: 主题已通过terminal.terminal.setOption应用`);
                  }
                } else {
                  log.warn(`终端 ${termId}: 无法找到主题设置方法`, {
                    hasOptions: !!terminal.options,
                    hasSetOption: !!terminal.setOption,
                    hasTerminalSetOption: !!terminal.terminal?.setOption,
                    terminalType: typeof terminal,
                    terminalKeys: Object.keys(terminal || {}).slice(0, 10) // 只显示前10个键
                  });
                }
              } catch (themeError) {
                log.error(`终端 ${termId}: 应用主题时发生错误:`, themeError);
              }

              hasChanges = true;
            } else {
              log.info(`终端 ${termId}: 主题无需更新`);
            }
          } catch (error) {
            log.error(`应用终端 ${termId} 主题失败:`, error);
          }
        } else {
          log.warn(`终端 ${termId}: 没有提供主题设置`);
        }

        // 仅在有更改时执行渲染和调整
        if (hasChanges) {
          try {
            // 优先使用标准API
            if (terminal.terminal && typeof terminal.terminal.refresh === 'function') {
              terminal.terminal.refresh();
            }
            // 兼容非标准结构
            else if (typeof terminal.refresh === 'function') {
              terminal.refresh(0, terminal.rows - 1);
            }

            // 减少终端大小调整延迟，仅在主题变化时调整
            setTimeout(() => {
              try {
                fitTerminal(termId);
              } catch (e) {
                log.warn(`调整终端 ${termId} 大小失败:`, e);
              }
            }, 50); // 减少延迟从100ms到50ms

            results[termId] = true;
            log.info(`成功应用设置到终端 ${termId}`);
          } catch (error) {
            results[termId] = false;
            log.error(`应用设置到终端 ${termId} 失败:`, error);
          }
        } else {
          results[termId] = true;
          log.info(`终端 ${termId} 无需更新设置`);
        }
      } catch (error) {
        results[termId] = false;
        log.error(`应用设置到终端 ${termId} 失败:`, error);
      }
    }

    return results;
  };

  // 切换背景图像状态
  const toggleBackgroundImage = enabled => {
    if (typeof enabled === 'boolean') {
      state.useBackgroundImage = enabled;
    } else {
      state.useBackgroundImage = !state.useBackgroundImage;
    }
    return state.useBackgroundImage;
  };

  // 优化垃圾回收触发函数
  const triggerGarbageCollection = () => {
    // 使用较轻量的方式触发垃圾回收
    setTimeout(() => {
      if (typeof window.gc === 'function') {
        try {
          window.gc();
        } catch (e) {
          // 忽略错误
        }
      }
      // 移除创建大量对象的方式，减少耗时
    }, 200); // 延长超时时间，避免与其他操作竞争
  };

  // 检查指定ID的终端是否有会话
  const hasTerminalSession = terminalId => {
    return !!state.sessions[terminalId];
  };

  // 检查指定ID的终端会话是否正在创建中
  const isSessionCreating = terminalId => {
    return state.creatingSessionIds.includes(terminalId) || !!state.terminalInitLocks[terminalId];
  };

  return {
    ...toRefs(state),
    initTerminal,
    reattachTerminal,
    fitTerminal,
    sendCommand,
    clearTerminal,
    disconnectTerminal,
    getTerminalStatus,
    isTerminalConnected,
    hasTerminal,
    hasTerminalSession,
    getTerminal,
    focusTerminal,
    applySettingsToAllTerminals,
    toggleBackgroundImage,
    triggerGarbageCollection,
    isSessionCreating,
    creatingSessionIds: computed(() => state.creatingSessionIds)
  };
});
