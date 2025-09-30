// import { WebSocket } from 'ws';
import log from '../log';
import { EVENTS } from '@/services/events';
import settingsService from '../settings';
import { wsServerConfig } from '../../config/app-config';
import {
  WS_CONSTANTS,
  MESSAGE_TYPES,
  BINARY_MESSAGE_TYPES,
  LATENCY_EVENTS,
  getDynamicConstants
} from '../constants';

// 导入二进制消息处理工具
import { BinaryMessageDecoder, BinaryMessageUtils } from '../binary-message-utils';

// 导入统一二进制协议
import { BinaryMessageSender, UnifiedBinaryHandler } from './binary-protocol';

/**
 * SSH服务模块，负责管理SSH连接和终端会话
 */
class SSHService {
  constructor() {
    this.sessions = new Map(); // 存储所有活动的SSH会话
    this.terminals = new Map(); // 存储所有终端实例
    this.isReady = false;
    this.isInitializing = false;
    this.keepAliveIntervals = new Map();
    this.latencyTimers = new Map(); // 存储延迟测量定时器
    this.terminalSessionMap = new Map(); // 终端ID到会话ID的映射
    this.sessionTerminalMap = new Map(); // 会话ID到终端ID的映射（双向映射提高查询效率）
    this.pendingTerminalCancels = new Map(); // 终端级挂起的取消请求
    this._pendingQuietCloses = new WeakMap();
    this.connectionTimeoutHandles = new Map();

    // 详细日志开关：用于控制可能高频但关键的日志输出
    // 可通过实例方法进行配置
    // 使用方法 sshService.setVerboseLogging({ wsData: true })
    this.verboseLogging = {
      buffer: false, // 是否逐块记录终端未就绪时的缓存数据日志
      abort: false, // 是否记录占位实现的 abort 请求日志
      wsData: false // 是否将 SSH WS 返回数据直接输出到控制台（生产默认关闭）
    };

    // 初始化统一二进制处理器
    this.binaryHandler = new UnifiedBinaryHandler();
    this._setupBinaryHandlers();

    // 从配置构建WebSocket URL - 使用当前页面的host和协议
    const { path } = wsServerConfig;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host; // 使用当前页面的host（包含端口）
    this.ipv4Url = `${protocol}//${host}${path}`;
    this.ipv6Url = this.ipv4Url; // 在容器环境中使用相同的URL
    this.baseUrl = this.ipv4Url;

    // 使用默认配置值，避免在构造函数中调用settings
    this.connectionTimeout = wsServerConfig.connectionTimeout || 10000; // 10秒默认值
    this.reconnectAttempts = wsServerConfig.reconnectAttempts || 3; // 默认3次重试
    this.reconnectDelay = wsServerConfig.reconnectDelay || 1000;

    // 初始化延迟监控状态
    this.latencyData = new Map(); // 存储会话的网络延迟数据
    this.dynamicConfig = null; // 在init方法中再获取动态配置

    // 清理相关配置
    this.cleanupInterval = 60000 * 5; // 5分钟清理一次
    this.connectionIdExpiration = 60000 * 10; // 10分钟过期时间

    // 启动定期清理
    setInterval(() => this._cleanupPendingConnections(), this.cleanupInterval);

    // 暂存服务实例引用
    this.instance = this;

    log.debug(`SSH服务初始化: IPv4=${this.ipv4Url}, IPv6=${this.ipv6Url}`);
  }

  /**
   * 初始化SSH服务
   */
  async init() {
    try {
      if (this.isReady) {
        log.debug('SSH服务已初始化，跳过');
        return true;
      }

      log.debug('正在初始化SSH服务...');
      this.isInitializing = true;

      // 更新动态配置 - 使用全局设置服务实例
      try {
        this.dynamicConfig = getDynamicConstants(settingsService);
        // 更新超时和重连配置
        if (this.dynamicConfig && this.dynamicConfig.SSH_CONSTANTS) {
          this.connectionTimeout =
            wsServerConfig.connectionTimeout || this.dynamicConfig.SSH_CONSTANTS.DEFAULT_TIMEOUT;
          this.reconnectAttempts =
            wsServerConfig.reconnectAttempts ||
            this.dynamicConfig.SSH_CONSTANTS.MAX_RECONNECT_ATTEMPTS;
        }
      } catch (configError) {
        log.warn('获取动态配置失败，将使用默认值继续', configError);
      }

      log.debug(`使用预设连接配置: 主URL=${this.baseUrl}`);

      this.isReady = true;
      this.isInitializing = false;
      return true;
    } catch (error) {
      this.isInitializing = false;
      log.error('SSH服务初始化失败', error);
      return false;
    }
  }

  /**
   * 设置统一二进制处理器
   */
  _setupBinaryHandlers() {
    try {
      // 注册新的控制消息处理器
      this.binaryHandler.registerHandler(BINARY_MESSAGE_TYPES.PING, (headerData, _payloadData) => {
        this._handleBinaryPing(headerData);
      });

      this.binaryHandler.registerHandler(BINARY_MESSAGE_TYPES.PONG, (headerData, _payloadData) => {
        this._handleBinaryPong(headerData);
      });

      this.binaryHandler.registerHandler(
        BINARY_MESSAGE_TYPES.CONNECTION_REGISTERED,
        (headerData, _payloadData) => {
          this._handleBinaryConnectionRegistered(headerData);
        }
      );

      this.binaryHandler.registerHandler(
        BINARY_MESSAGE_TYPES.CONNECTED,
        (headerData, _payloadData) => {
          this._handleBinaryConnected(headerData);
        }
      );

      this.binaryHandler.registerHandler(
        BINARY_MESSAGE_TYPES.NETWORK_LATENCY,
        (headerData, _payloadData) => {
          this._handleBinaryNetworkLatency(headerData);
        }
      );

      // 注册SSH终端数据处理器
      this.binaryHandler.registerHandler(
        BINARY_MESSAGE_TYPES.SSH_DATA,
        (headerData, payloadData) => {
          this._handleBinarySSHData(headerData, payloadData);
        }
      );

      // 注册SSH数据确认处理器
      this.binaryHandler.registerHandler(
        BINARY_MESSAGE_TYPES.SSH_DATA_ACK,
        (headerData, _payloadData) => {
          this._handleSSHDataAck(headerData);
        }
      );

      // 注册SFTP相关消息处理器（委托给SFTP服务）
      this.binaryHandler.registerHandler(
        BINARY_MESSAGE_TYPES.SFTP_SUCCESS,
        (headerData, payloadData) => {
          // 通过事件系统转发给SFTP服务
          window.dispatchEvent(
            new CustomEvent('sftp-binary-message', {
              detail: { headerData, payloadData, messageType: BINARY_MESSAGE_TYPES.SFTP_SUCCESS }
            })
          );
        }
      );

      this.binaryHandler.registerHandler(
        BINARY_MESSAGE_TYPES.SFTP_ERROR,
        (headerData, payloadData) => {
          window.dispatchEvent(
            new CustomEvent('sftp-binary-message', {
              detail: { headerData, payloadData, messageType: BINARY_MESSAGE_TYPES.SFTP_ERROR }
            })
          );
        }
      );

      this.binaryHandler.registerHandler(
        BINARY_MESSAGE_TYPES.SFTP_PROGRESS,
        (headerData, payloadData) => {
          window.dispatchEvent(
            new CustomEvent('sftp-binary-message', {
              detail: { headerData, payloadData, messageType: BINARY_MESSAGE_TYPES.SFTP_PROGRESS }
            })
          );
        }
      );

      this.binaryHandler.registerHandler(
        BINARY_MESSAGE_TYPES.SFTP_FILE_DATA,
        (headerData, payloadData) => {
          window.dispatchEvent(
            new CustomEvent('sftp-binary-message', {
              detail: { headerData, payloadData, messageType: BINARY_MESSAGE_TYPES.SFTP_FILE_DATA }
            })
          );
        }
      );

      this.binaryHandler.registerHandler(
        BINARY_MESSAGE_TYPES.SFTP_FOLDER_DATA,
        (headerData, payloadData) => {
          window.dispatchEvent(
            new CustomEvent('sftp-binary-message', {
              detail: {
                headerData,
                payloadData,
                messageType: BINARY_MESSAGE_TYPES.SFTP_FOLDER_DATA
              }
            })
          );
        }
      );

      log.debug('统一二进制处理器已设置');
    } catch (error) {
      log.error('设置二进制处理器失败:', error);
    }
  }

  /**
   * 处理SSH二进制数据
   */
  _handleBinarySSHData(headerData, payloadData) {
    const { sessionId } = headerData;
    const session = this.sessions.get(sessionId);

    if (!session) {
      log.warn(`收到未知会话的SSH数据: ${sessionId}`);
      return;
    }

    if (!session.terminal) {
      // 终端未就绪：缓存数据并仅在首次缓存时提示一次
      if (!session.buffer) {
        session.buffer = '';
      }
      const dataStr = new TextDecoder('utf-8', { fatal: false }).decode(payloadData);
      session.buffer += dataStr;

      if (!session._bufferingNotified) {
        session._bufferingNotified = true;
        log.debug(`开始缓存SSH数据，等待终端就绪: ${sessionId}`);
      } else if (this.verboseLogging.buffer) {
        // 仅在启用详细日志时记录持续缓存
        log.debug('继续缓存SSH数据', { sessionId, chunkBytes: payloadData.byteLength });
      }
      if (this.verboseLogging.wsData) {
        try { console.log(`[WS][SSH_DATA][buffering] ${sessionId} len=${payloadData.byteLength}\n${dataStr}`); } catch (_) {}
      }
      return;
    }

    try {
      // 解码二进制数据为字符串
      const dataStr = new TextDecoder('utf-8', { fatal: false }).decode(payloadData);

      if (this.verboseLogging.wsData) {
        try { console.log(`[WS][SSH_DATA] ${sessionId} len=${payloadData.byteLength}\n${dataStr}`); } catch (_) {}
      }

      // 写入终端
      session.terminal.write(dataStr);

      // 记录活动时间
      this._recordSessionActivity(session);

      // log.debug('SSH二进制数据已处理', {
      //   sessionId,
      //   dataLength: payloadData.byteLength
      // });
    } catch (error) {
      log.error('处理SSH二进制数据失败:', error);
    }
  }

  /**
   * 处理SSH数据确认
   */
  _handleSSHDataAck(headerData) {
    const { sessionId, bytesProcessed } = headerData;
    log.debug('收到SSH数据确认', { sessionId, bytesProcessed });
  }

  /**
   * 记录会话活动时间
   */
  _recordSessionActivity(session) {
    if (session) {
      session.lastActivity = new Date();
    }
  }

  /**
   * 创建新的SSH会话
   * @param {Object} connection - 连接信息
   * @returns {Promise<string>} - 会话ID
   */
  async createSession(connection) {
    return new Promise((resolve, reject) => {
      // 检查WebSocket服务是否已初始化
      if (!this.ipv4Url && !this.ipv6Url) {
        return reject(new Error('SSH服务未初始化'));
      }

      // 生成会话ID
      const sessionId = connection.sessionId || this._generateSessionId();

      // 检查是否已经存在该会话
      const checkReady = () => {
        if (this.sessions.has(sessionId)) {
          const session = this.sessions.get(sessionId);

          if (session.connectionState.status === 'connected') {
            resolve(sessionId);
            return true;
          } else if (session.connectionState.status === 'error') {
            reject(new Error(session.connectionState.error || 'SSH连接失败'));
            return true;
          }
        }
        return false;
      };

      // 先检查一次是否已连接
      if (checkReady()) return;

      // 创建新会话
      this._createNewSession(connection, sessionId)
        .then(newSessionId => {
          // 返回可能新生成的会话ID
          resolve(newSessionId);
        })
        .catch(error => {
          reject(error);
        });
    });
  }

  /**
   * 创建新会话的核心逻辑
   * @param {Object} connection - 连接配置
   * @param {string} [providedSessionId] - 可选的会话ID，如果提供则使用这个ID
   * @returns {Promise<string>} - 会话ID
   */
  async _createNewSession(connection, providedSessionId) {
    try {
      const sessionId = providedSessionId || this._generateSessionId();

      // 如果提供了终端ID，建立双向映射关系
      if (connection.terminalId) {
        this.terminalSessionMap.set(connection.terminalId, sessionId);
        this.sessionTerminalMap.set(sessionId, connection.terminalId);
      }

      // 尝试WebSocket连接
      try {
        // 确保URL是最新的 - 使用当前页面的host通过nginx代理
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const { path } = wsServerConfig;
        this.ipv4Url = `${protocol}//${host}${path}`;

        // 尝试连接 - 合并日志输出
        const resultSessionId = await this._createSessionWithUrl(
          this.ipv4Url,
          sessionId,
          connection
        );
        return resultSessionId; // 返回可能新生成的会话ID
    } catch (connectionError) {
      const connectionErrorMessage = this._getErrorMessage(connectionError);

      // 获取terminalId以便通知终端组件
      const terminalId =
        this.sessionTerminalMap.get(sessionId) ||
        (connection.terminalId ? connection.terminalId : null);

      const pendingCancel = terminalId && this.pendingTerminalCancels.has(terminalId);
      const isExpectedClosure = pendingCancel || this._isExpectedClosure(connectionError);

      if (pendingCancel) {
        this.pendingTerminalCancels.delete(terminalId);
      }

      if (isExpectedClosure) {
        log.debug(`WebSocket连接已被取消: ${connectionErrorMessage}`);
      } else {
        log.error(`WebSocket连接失败: ${connectionErrorMessage}`);
      }

      // 触发全局事件，通知SSH连接失败
      if (terminalId && !isExpectedClosure) {
        window.dispatchEvent(
          new CustomEvent('ssh-connection-failed', {
            detail: {
              connectionId: terminalId,
              sessionId,
              error: 'SSH连接失败',
              message: this._translateErrorMessage(connectionErrorMessage),
              reason: connectionErrorMessage,
              status: 'failed'
            }
          })
        );

        window.dispatchEvent(
          new CustomEvent(EVENTS.SSH_SESSION_CREATION_FAILED, {
            detail: {
              sessionId,
              terminalId,
              error: this._translateErrorMessage(connectionErrorMessage),
              reason: connectionErrorMessage,
              status: 'failed'
            }
          })
        );
      }
      throw connectionError;
    }
    } catch (error) {
      const cancelMessage = this._getErrorMessage(error);
      const terminalId = connection?.terminalId
        ? connection.terminalId
        : this.sessionTerminalMap.get(providedSessionId);
      const pendingCancel = terminalId && this.pendingTerminalCancels.has(terminalId);
      const expectedCancellationFlag =
        typeof error === 'object' && error !== null && error.expectedCancellation;
      const expected = pendingCancel || expectedCancellationFlag || this._isExpectedClosure(error);

      if (pendingCancel) {
        this.pendingTerminalCancels.delete(terminalId);
      } else if (expectedCancellationFlag && terminalId && this.pendingTerminalCancels.has(terminalId)) {
        this.pendingTerminalCancels.delete(terminalId);
      }

      if (expected) {
        const originalReason =
          typeof error === 'object' && error !== null && error.originalMessage
            ? `，原始原因: ${error.originalMessage}`
            : '';
        log.debug(`创建SSH会话流程已取消: ${cancelMessage || '连接已取消'}${originalReason}`);
      } else {
        log.error('创建SSH会话失败:', error);
      }
      throw error;
    }
  }

  /**
   * 使用特定URL创建会话
   * @param {string} wsUrl - WebSocket URL
   * @param {string} sessionId - 会话ID
   * @param {Object} connection - 连接信息
   * @param {boolean} [isFallback=false] - 是否为IPv6备用连接
   * @returns {Promise<string>} - 会话ID
   */
  async _createSessionWithUrl(wsUrl, sessionId, connection, isFallback = false) {
    try {
      // 如果会话ID已存在，强制生成新的会话ID，确保不复用
      if (this.sessions.has(sessionId)) {
        log.warn(`发现同ID会话已存在: ${sessionId}，生成新的会话ID`);
        // 生成新的会话ID
        const newSessionId = this._generateSessionId();
        log.debug(`为相同连接生成新会话ID: ${newSessionId}`);
        sessionId = newSessionId;
      }

      const connectionState = {
        status: 'connecting',
        message: '正在连接...',
        error: null,
        startTime: new Date()
      };

      // 合并SSH连接日志 - 一次性输出关键信息
      log.info(
        `建立SSH连接: ${connection.username}@${connection.host}:${connection.port} via ${wsUrl}`
      );
      const socket = new WebSocket(wsUrl);

      // 启用二进制数据接收
      socket.binaryType = 'arraybuffer';

      const session = {
        id: sessionId,
        connection: { ...connection },
        connectionState,
        socket,
        retryCount: 0,
        isReconnecting: false,
        lastActivity: new Date(),
        createdAt: new Date(),
        terminal: null,
        onData: null,
        onClose: null,
        onError: null
      };

      this.sessions.set(sessionId, session);

      await this._setupSocketEvents(socket, sessionId, connection, connectionState);

      this._setupKeepAlive(sessionId);

      this._setupLatencyTimer(sessionId);

      // 优化：合并会话创建成功和映射建立的日志，减少重复输出
      // log.info(`SSH会话创建成功: ${sessionId}`) - 移至连接成功回调中统一输出

      return sessionId;
    } catch (error) {
      this._clearConnectionTimeout(sessionId);
      const normalizedMessage = this._getErrorMessage(error);
      const terminalId =
        this.sessionTerminalMap.get(sessionId) ||
        (connection.terminalId ? connection.terminalId : null);
      const pendingCancelInfo = terminalId ? this.pendingTerminalCancels.get(terminalId) : null;
      const pendingCancel = !!pendingCancelInfo;

      // 在向上传递错误之前，生成标准化的错误对象并附加上下文信息
      const originalMessage = normalizedMessage || '未知错误';
      let propagatedError;

      if (pendingCancel) {
        propagatedError = new Error('连接已取消');
        propagatedError.expectedCancellation = true;
        propagatedError.originalMessage = originalMessage;
        propagatedError.cancellationReason = pendingCancelInfo.reason || 'frontend_monitor_unsubscribed';
        propagatedError.terminalId = terminalId;
        propagatedError.originalError = error;
        this.pendingTerminalCancels.delete(terminalId);
      } else if (error instanceof Error) {
        propagatedError = error;
      } else {
        propagatedError = new Error(originalMessage);
      }

      const isExpectedClosure =
        pendingCancel ||
        (propagatedError && propagatedError.expectedCancellation) ||
        this._isExpectedClosure(error) ||
        this._isExpectedClosure(propagatedError);

      if (isExpectedClosure) {
        const cancelLogReason = pendingCancelInfo?.reason
          ? `${pendingCancelInfo.reason} (${originalMessage})`
          : originalMessage;
        log.debug(`创建SSH会话已取消: ${sessionId}, 原因: ${cancelLogReason}`);
      } else {
        log.error(`创建SSH会话失败: ${sessionId}, 错误: ${originalMessage}`);
      }

      try {
        if (this.sessions.has(sessionId)) {
          const session = this.sessions.get(sessionId);

          if (session.socket) {
            try {
              session.socket.close();
              session.socket.onopen = null;
              session.socket.onclose = null;
              session.socket.onerror = null;
              session.socket.onmessage = null;
            } catch (socketError) {
              log.warn(`关闭WebSocket连接失败: ${sessionId}`, socketError);
            }
          }

          this._clearKeepAlive(sessionId);
          this._clearLatencyTimer(sessionId);
          this.sessions.delete(sessionId);
        }

        this.releaseResources(sessionId);

        // 获取terminalId以便通知终端组件
        const terminalId =
          this.sessionTerminalMap.get(sessionId) ||
          (connection.terminalId ? connection.terminalId : null);

        const translatedMessage = this._translateErrorMessage(
          propagatedError?.message || originalMessage
        );

        // 只在最终失败时（IPv6备用连接失败或直接失败）才触发全局事件
        if (isFallback || !this.ipv6Url) {
          const finalMessage = isExpectedClosure ? '连接已取消' : translatedMessage;

          if (terminalId && !isExpectedClosure) {
            window.dispatchEvent(
              new CustomEvent('ssh-connection-failed', {
                detail: {
                  connectionId: terminalId,
                  sessionId,
                  error: finalMessage,
                  message: finalMessage,
                  reason: normalizedMessage,
                  status: 'failed'
                }
              })
            );

            window.dispatchEvent(
              new CustomEvent(EVENTS.SSH_SESSION_CREATION_FAILED, {
                detail: {
                  sessionId,
                  terminalId,
                  error: finalMessage,
                  reason: normalizedMessage,
                  status: 'failed'
                }
              })
            );
          }
        }
      } catch (cleanupError) {
        log.error(`清理失败会话资源时出错: ${sessionId}`, cleanupError);
      }

      throw propagatedError;
    }
  }

  /**
   * 设置WebSocket事件处理
   */
  _setupSocketEvents(socket, sessionId, connection, connectionState) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('连接超时'));
      }, this.connectionTimeout);
      this.connectionTimeoutHandles.set(sessionId, timeout);

      // 连接打开时
      socket.onopen = () => {
        this._clearConnectionTimeout(sessionId);
        connectionState.status = 'authenticating';
        connectionState.message = '正在进行SSH认证...';

        // 安全处理连接信息
        // 1. 生成临时连接ID替代直接发送完整配置
        const connectionId = this._generateSecureConnectionId(connection);

        // 2. 在本地会话存储完整连接信息(不通过网络传输)
        if (!this.pendingConnections) {
          this.pendingConnections = new Map();
        }
        this.pendingConnections.set(connectionId, {
          connection,
          terminalId: connection.terminalId || null,
          sessionId,
          createdAt: Date.now(),
          socket, // 保存WebSocket连接引用
          resolve, // 保存Promise resolve回调
          reject // 保存Promise reject回调
        });

        // 3. 使用二进制协议发送连接消息
        const connectMessage = BinaryMessageUtils.createConnectMessage({
          sessionId,
          connectionId, // 只传递连接ID，不传递完整连接信息
          supportsBinary: true,
          protocolVersion: '2.0' // 统一使用协议版本2.0
        });
        socket.send(connectMessage);
      };

      // 连接错误时
      socket.onerror = event => {
        this._clearConnectionTimeout(sessionId);
        connectionState.status = 'error';
        connectionState.message = '连接错误';
        log.error('WebSocket连接错误', event);

        if (this.sessions.has(sessionId)) {
          const session = this.sessions.get(sessionId);
          if (session.retryCount < this.reconnectAttempts) {
            log.debug(`连接错误，将尝试重连 (${session.retryCount + 1}/${this.reconnectAttempts})`);
            session.isReconnecting = true;
            session.retryCount++;

            setTimeout(() => {
              this._reconnectSession(sessionId, connection).catch(error => {
                log.error(`重连失败: ${error.message}`);
              });
            }, this.reconnectDelay);
          } else {
            log.warn(`达到最大重连次数(${this.reconnectAttempts})，不再尝试重连`);
          }
        }

        reject(new Error('WebSocket连接错误'));
      };

      // 连接关闭时
      socket.onclose = event => {
        this._clearConnectionTimeout(sessionId);

        // 获取会话引用，判断关闭是否用户主动触发
        let sessionRef = null;
        if (this.sessions.has(sessionId)) {
          sessionRef = this.sessions.get(sessionId);
        }
        const userInitiated = !!(sessionRef && sessionRef.userInitiatedClose);
        const wasConnected = (
          connectionState.status === 'connected' ||
          (sessionRef &&
            sessionRef.connectionState &&
            sessionRef.connectionState.status === 'connected')
        );

        const reason = this._getCloseReasonText(event.code, event.reason);
        const normalizedCloseReason = (event.reason || '').toLowerCase();
        const isNormalClose = [1000, 1001, 1005].includes(event.code);
        const isExpectedClosure = (
          event.code === 1000 &&
          (connectionState.status === 'connected' ||
            userInitiated ||
            normalizedCloseReason.includes('frontend_monitor_unsubscribed') ||
            normalizedCloseReason.includes('user_close'))
        );
        const logLevel = isNormalClose ? 'debug' : 'warn';
        log[logLevel](`WebSocket连接关闭: ${reason}`, {
          code: event.code,
          wasConnected: connectionState.status === 'connected'
        });

        const notifyTerminalDisconnected = () => {
          try {
            const term = sessionRef && sessionRef.terminal ? sessionRef.terminal : null;
            const msg = '\r\n连接已断开\r\n';
            if (term && typeof term.write === 'function') {
              term.write(msg);
            } else if (sessionRef) {
              // 如果终端实例不可用，写入缓冲区
              sessionRef.buffer = (sessionRef.buffer || '') + msg;
            }
            if (sessionRef) {
              sessionRef.disconnectNotified = true;
            }
          } catch (_e) {
            // 忽略通知错误
          }
        };

        // 如果是预期的正常关闭，则不触发错误
        if (isExpectedClosure) {
          connectionState.status = 'closed';
          connectionState.message = normalizedCloseReason.includes('frontend_monitor_unsubscribed')
            ? '连接已取消'
            : '连接已关闭';
          if (
            !userInitiated &&
            wasConnected &&
            !normalizedCloseReason.includes('frontend_monitor_unsubscribed')
          ) {
            notifyTerminalDisconnected();
          }

          if (wasConnected) {
            resolve(sessionId);
          } else {
            reject(new Error('连接已取消'));
          }
          return;
        }

        // 处理认证失败
        if (event.code === 4401) {
          connectionState.status = 'error';
          connectionState.message = '认证失败';
          connectionState.error = '用户名或密码错误';

          reject(new Error('认证失败: 用户名或密码错误'));
          return;
        }

        // 处理其他错误
        connectionState.status = 'error';
        connectionState.message = `连接关闭: ${reason}`;

        if (!connectionState.error) {
          connectionState.error = reason;
        }

        if (!userInitiated && wasConnected) {
          notifyTerminalDisconnected();
        }

        reject(new Error(reason));
      };

      // 接收消息时 - 支持二进制和JSON消息
      socket.onmessage = event => {
        try {
          // 检查是否为二进制消息
          if (event.data instanceof ArrayBuffer) {
            this._handleBinaryMessage(event.data, sessionId);
            return;
          }

          // 处理JSON消息
          let message;
          try {
            message = JSON.parse(event.data);
          } catch (parseError) {
            log.error('解析WebSocket消息失败:', parseError);
            return;
          }

          if (!message.type) {
            log.warn('收到无类型WebSocket消息:', {
              messageDetails: JSON.stringify(message, null, 2).substring(0, 300),
              sessionId
            });
            return;
          }

          if (this.sessions.has(sessionId)) {
            const session = this.sessions.get(sessionId);
            session.lastActivity = new Date();
          }

          switch (message.type) {
            case MESSAGE_TYPES.CONNECTED: {
              this._clearConnectionTimeout(sessionId);
              connectionState.status = 'connected';
              connectionState.message = '已连接';

              const sessionRef = this.sessions.has(sessionId)
                ? this.sessions.get(sessionId)
                : null;
              const connHost =
                connection.host ||
                (sessionRef && sessionRef.connection ? sessionRef.connection.host : null);
              let resolvedTerminalId = this.sessionTerminalMap.get(sessionId);
              if (!resolvedTerminalId && connection.terminalId) {
                resolvedTerminalId = connection.terminalId;
              } else if (!resolvedTerminalId && sessionRef && sessionRef.terminalId) {
                resolvedTerminalId = sessionRef.terminalId;
              }

              log.info(`SSH连接成功: ${sessionId}`, {
                host: connHost || connection.host || '未知主机',
                terminalId: resolvedTerminalId || '未知'
              });

              // SSH连接成功后稍微延迟触发保活ping来获取延迟信息
              // 使用setTimeout确保保活机制完全设置好
              setTimeout(() => {
                this._triggerImmediatePing(sessionId);
              }, 100);

              try {
                if (connHost) {
                  if (resolvedTerminalId) {
                    this.sessionTerminalMap.set(sessionId, resolvedTerminalId);
                    this.terminalSessionMap.set(resolvedTerminalId, sessionId);
                  }

                  if (this.sessions.has(sessionId) && resolvedTerminalId) {
                    const session = this.sessions.get(sessionId);
                    session.terminalId = resolvedTerminalId;
                  }

          const sshConnectedEvent = new CustomEvent(EVENTS.SSH_CONNECTED, {
                    detail: {
                      sessionId,
                      host: connHost,
                      terminalId: resolvedTerminalId,
                      connection
                    }
                  });
                  window.dispatchEvent(sshConnectedEvent);
                }
              } catch (err) {
                log.error('触发SSH连接事件失败:', err);
              }

              if (sessionRef) {
                sessionRef.retryCount = 0;
                sessionRef.isReconnecting = false;
              }

              resolve(sessionId);
              break;
            }

            // 处理安全连接ID注册响应
            case 'connection_id_registered':
              if (
                message.data &&
                message.data.connectionId &&
                message.data.status === 'need_auth'
              ) {

                // 从pending连接中获取完整的连接信息
                if (
                  !this.pendingConnections ||
                  !this.pendingConnections.has(message.data.connectionId)
                ) {
                  log.error(`无法找到连接ID对应的信息: ${message.data.connectionId}`);
                  reject(new Error('连接ID无效'));
                  return;
                }

                const pendingData = this.pendingConnections.get(message.data.connectionId);
                const authConnection = pendingData.connection;

                // 生成临时的AES密钥
                const randomKey = Array.from(crypto.getRandomValues(new Uint8Array(16)))
                  .map(b => b.toString(16).padStart(2, '0'))
                  .join('');

                // 准备完整的认证数据对象
                const authPayload = {
                  address: authConnection.host,
                  port: authConnection.port || 22,
                  username: authConnection.username,
                  authType: authConnection.authType || 'password'
                };

                // 根据认证方式添加凭据
                if (authPayload.authType === 'password') {
                  authPayload.password = authConnection.password;
                } else if (
                  authPayload.authType === 'key' ||
                  authPayload.authType === 'privateKey'
                ) {
                  authPayload.privateKey = authConnection.keyFile;
                  if (authConnection.passphrase) {
                    authPayload.passphrase = authConnection.passphrase;
                  }
                }

                // 构建认证消息数据
                const authData = {
                  connectionId: message.data.connectionId,
                  sessionId: message.data.sessionId || sessionId
                };

                // 使用同步方式处理
                try {
                  // 对完整的认证载荷进行加密 - 直接使用同步加密
                  const encryptedPayload = this._encryptSensitiveData(
                    JSON.stringify(authPayload),
                    randomKey
                  );
                  authData.encryptedPayload = encryptedPayload;
                  authData.keyId = randomKey;

                  // 发送认证请求 - 使用二进制协议
                  const authMessage = BinaryMessageUtils.createAuthenticateMessage(authData);
                  socket.send(authMessage);
                } catch (encryptError) {
                  log.error('加密认证信息失败', encryptError);
                  reject(new Error('加密认证信息失败，无法安全连接'));
                }

                // 不要在这里resolve，等待CONNECTED消息
              } else if (message.data && message.data.status === 'reconnected') {
                // 已存在的连接无需额外日志
              }
              break;

            case MESSAGE_TYPES.ERROR:
              this._clearConnectionTimeout(sessionId);
              connectionState.status = 'error';
              connectionState.message = message.data?.message || '未知错误';
              log.error(`SSH连接错误: ${connectionState.message}`);

              // 不再单独弹出错误消息，由最终的IPv6失败时统一处理
              // ElMessage.error(`SSH连接错误: ${connectionState.message}`);

              reject(new Error(connectionState.message));
              break;

        case MESSAGE_TYPES.CLOSED:
          connectionState.status = 'closed';
          connectionState.message = '连接已关闭';
          log.debug(`SSH连接已关闭: ${sessionId}`);

          if (this.sessions.has(sessionId)) {
            const session = this.sessions.get(sessionId);
            // 非用户主动断开时，输出提示到终端
            if (!session.userInitiatedClose && !session.disconnectNotified) {
              try {
                const term = session.terminal;
                const msg = '\r\n连接已断开\r\n';
                if (term && typeof term.write === 'function') {
                  term.write(msg);
                } else {
                  session.buffer = (session.buffer || '') + msg;
                }
              } catch (_e) {
                /* no-op */
              }
              session.disconnectNotified = true;
            }

            if (session.onClose) {
              session.onClose();
            }
          }
          break;

            case MESSAGE_TYPES.DATA:
              if (this.sessions.has(sessionId)) {
                const session = this.sessions.get(sessionId);

                if (!message.data || !message.data.data) {
                  log.error('数据格式错误:', message);
                  return;
                }

                const data = message.data.data;

                if (session.terminal) {
                  session.terminal.write(data);
                } else {
                  if (!session.buffer) {
                    session.buffer = '';
                    session.bufferSize = 0;
                  }

                  session.buffer += data;
                  session.bufferSize += data.length;

                  const MAX_BUFFER_SIZE = 512 * 1024; // 512KB
                  if (session.bufferSize > MAX_BUFFER_SIZE) {
                    const keepSize = 256 * 1024; // 保留256KB
                    session.buffer = session.buffer.substring(session.buffer.length - keepSize);
                    session.bufferSize = session.buffer.length;
                  }
                }

                session.lastActivity = new Date();
              }
              break;

            // 处理网络延迟消息
            case MESSAGE_TYPES.NETWORK_LATENCY:
              try {
                // 解析延迟数据（简化格式）
                const latencyDetail = {
                  sessionId: message.data?.sessionId || sessionId,
                  clientLatency: message.data?.clientLatency
                    ? Math.round(message.data.clientLatency)
                    : undefined,
                  serverLatency: message.data?.serverLatency
                    ? Math.round(message.data.serverLatency)
                    : undefined,
                  totalLatency: message.data?.totalLatency
                    ? Math.round(message.data.totalLatency)
                    : message.data?.clientLatency && message.data?.serverLatency
                      ? Math.round(message.data.clientLatency + message.data.serverLatency)
                      : undefined,
                  timestamp: message.data?.timestamp || new Date().toISOString()
                };

                // 保存延迟数据到内部状态
                this.latencyData.set(sessionId, {
                  ...latencyDetail,
                  updatedAt: new Date()
                });

                // 获取当前会话的终端ID（优先从映射中获取）
                let terminalId = this.sessionTerminalMap.get(sessionId);

                if (!terminalId && this.sessions.has(sessionId)) {
                  const currentSession = this.sessions.get(sessionId);
                  terminalId = currentSession.terminalId || null;
                }

                // 更新延迟事件数据，包含终端ID
                const enrichedLatencyDetail = {
                  ...latencyDetail,
                  terminalId
                };

                // 触发全局网络延迟事件
                window.dispatchEvent(
                  new CustomEvent(LATENCY_EVENTS.GLOBAL, {
                    detail: enrichedLatencyDetail
                  })
                );

                // 为保持兼容性，同时触发工具栏使用的事件格式
                window.dispatchEvent(
                  new CustomEvent(LATENCY_EVENTS.TOOLBAR, {
                    detail: enrichedLatencyDetail
                  })
                );

                // 如果有终端ID，触发终端特定的延迟事件
                if (terminalId) {
                  window.dispatchEvent(
                    new CustomEvent(LATENCY_EVENTS.TERMINAL, {
                      detail: enrichedLatencyDetail
                    })
                  );
                }
              } catch (e) {
                /* no-op */
              }
              break;

            // 处理保活响应
            case MESSAGE_TYPES.PONG:
              try {
                // 更新会话活动时间
                if (this.sessions.has(sessionId)) {
                  const session = this.sessions.get(sessionId);
                  session.lastActivity = new Date();
                }
              } catch (e) {
                /* no-op */
              }
              break;

            // SFTP消息已迁移到二进制协议处理

            // 处理其他消息类型
            default: {
              const ignoredTypes = [
                MESSAGE_TYPES.PING,
                'keepalive',
                'heartbeat',
                'status',
                'info',
                'notification',
                'system',
                'stats',
                'heartbeat_ack',
                'heartbeat_response',
                'ack',
                'response',
                'server_status',
                'latency_update',
                'cancel_response',
                'cleanup',
                'file_cleanup',
                'operation_cleanup'
              ];

              // 忽略所有SFTP相关消息类型，避免它们被标记为未知类型
              if (!ignoredTypes.includes(message.type) && !message.type.startsWith('sftp_')) {
                // 进一步减少未知消息类型的日志，只在开发模式下显示
                if (import.meta.env.DEV) {
                  log.debug(`收到未知消息类型: ${message.type}`, { sessionId });
                }
              }
              break;
            }
          }

          // SFTP消息已全部迁移到二进制协议，不再需要JSON处理
        } catch (error) {
          log.error('处理WebSocket消息失败', error);
        }
      };
    });
  }

  /**
   * 设置会话保活机制
   */
  _setupKeepAlive(sessionId) {
    this._clearKeepAlive(sessionId);

    const pingRequests = new Map();

    // 获取最新的动态配置 - 使用同步方式避免async/await
    const dynamicConfig = getDynamicConstants(settingsService);

    // 从设置获取保活间隔
    const connectionSettings = settingsService.getConnectionSettings();
    const keepAliveIntervalSec =
      connectionSettings.keepAliveInterval || dynamicConfig.LATENCY_CONFIG.CHECK_INTERVAL;
    const keepAliveIntervalMs = keepAliveIntervalSec * 1000;

    const interval = setInterval(() => {
      if (!this.sessions.has(sessionId)) {
        this._clearKeepAlive(sessionId);
        this._clearLatencyTimer(sessionId);
        return;
      }

      const session = this.sessions.get(sessionId);
      const now = new Date();

      if (session.socket && session.socket.readyState === WS_CONSTANTS.OPEN) {
        try {
          const timestamp = Date.now();
          const requestId = Date.now().toString();

          pingRequests.set(requestId, {
            timestamp: now,
            sessionId
          });

          const pingMessage = BinaryMessageUtils.createPingMessage({
            sessionId,
            timestamp,
            requestId,
            measureLatency: false, // 保活ping不测量延迟
            client: 'easyssh'
          });
          session.socket.send(pingMessage);

          session.lastActivity = now;

          // 定期清理过期ping请求（减少频率）
          if (pingRequests.size > 50) {
            const expireTime = new Date(now.getTime() - 30000);
            for (const [id, request] of pingRequests.entries()) {
              if (request.timestamp < expireTime) {
                pingRequests.delete(id);
              }
            }
          }
        } catch (error) {
          log.warn(`发送保活消息失败: ${sessionId}`, error);
        }
      }
    }, keepAliveIntervalMs / 2);

    this.keepAliveIntervals.set(sessionId, {
      interval,
      pingRequests
    });
  }

  /**
   * 清除会话保活机制
   */
  _clearKeepAlive(sessionId) {
    if (this.keepAliveIntervals.has(sessionId)) {
      const keepAliveData = this.keepAliveIntervals.get(sessionId);
      if (keepAliveData.interval) {
        clearInterval(keepAliveData.interval);
      }
      this.keepAliveIntervals.delete(sessionId);
    }
  }

  /**
   * 立即触发一次保活ping（用于SSH连接成功后获取完整延迟信息）
   */
  _triggerImmediatePing(sessionId) {
    if (!this.sessions.has(sessionId)) {
      return;
    }

    const session = this.sessions.get(sessionId);
    const now = new Date();

    if (session.socket && session.socket.readyState === WS_CONSTANTS.OPEN) {
      try {
        const timestamp = Date.now();
        const requestId = `parallel_ping_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        const clientSendTime = performance.now();

        // 获取或创建保活数据
        let keepAliveData = this.keepAliveIntervals.get(sessionId);
        if (!keepAliveData) {
          this._setupKeepAlive(sessionId);
          keepAliveData = this.keepAliveIntervals.get(sessionId);
        }

        if (keepAliveData && keepAliveData.pingRequests) {
          keepAliveData.pingRequests.set(requestId, {
            timestamp: now,
            clientSendTime,
            sessionId,
            isParallelPingMeasurement: true // 标记为并行ping测量
          });

          // 发送并行ping延迟测量请求 - 服务端将并行ping客户端和SSH主机
          const binaryPingMessage = BinaryMessageUtils.createPingMessage({
            sessionId,
            timestamp,
            clientSendTime,
            requestId,
            measureLatency: true,
            client: 'easyssh',
            webSocketLatency: 1 // 触发服务端并行ping测量
          });
          session.socket.send(binaryPingMessage);

          session.lastActivity = now;
          // 定期保活不需要详细日志，只记录异常情况
        }
      } catch (error) {
        log.warn(`立即发送保活消息失败: ${sessionId}`, error);
      }
    }
  }

  /**
   * 处理WebSocket关闭码和原因
   */
  _getCloseReasonText(code, reason) {
    const closeCodeMap = {
      1000: '正常关闭',
      1001: '终端关闭',
      1002: '协议错误',
      1003: '数据类型错误',
      1006: '异常关闭',
      1007: '数据格式不一致',
      1008: '违反政策',
      1009: '数据太大',
      1011: '内部错误',
      1012: '服务重启',
      1013: '临时错误',
      4401: '认证失败，请检查用户名和密码',
      4403: '权限被拒绝',
      4404: '服务不可用',
      4408: '连接超时'
    };

    const codeText = closeCodeMap[code] || `未知错误(${code})`;

    // 如果有原因字符串，检查是否需要翻译
    if (reason) {
      return `${codeText}：${this._translateErrorMessage(reason)}`;
    }

    return codeText;
  }

  /**
   * 尝试重新连接会话
   */
  async _reconnectSession(sessionId, connection) {
    if (!this.sessions.has(sessionId)) {
      throw new Error(`会话 ${sessionId} 不存在，无法重连`);
    }

    const session = this.sessions.get(sessionId);

    if (session.socket) {
      try {
        session.socket.close();
      } catch (error) {
        // 忽略关闭错误
      }
    }

    log.debug(`正在重新连接会话: ${sessionId}`);

    try {
      log.debug(`重连尝试使用IPv4连接: ${this.ipv4Url}`);
      const socket = new WebSocket(this.ipv4Url);

      session.connectionState = {
        status: 'reconnecting',
        message: '正在重新连接(IPv4)...'
      };

      await this._setupSocketEvents(socket, sessionId, connection, session.connectionState);

      session.socket = socket;
      session.isReconnecting = false;
      session.lastActivity = new Date();

      log.debug(`会话 ${sessionId} 重连成功(IPv4)`);

      return;
    } catch (ipv4Error) {
      log.warn(`IPv4重连失败: ${ipv4Error.message}，尝试IPv6连接`);

      try {
        await new Promise(resolve => setTimeout(resolve, 500));

        log.debug(`重连尝试使用IPv6连接: ${this.ipv6Url}`);
        const socket = new WebSocket(this.ipv6Url);

        session.connectionState = {
          status: 'reconnecting',
          message: '正在重新连接(IPv6)...'
        };

        await this._setupSocketEvents(socket, sessionId, connection, session.connectionState);

        session.socket = socket;
        session.isReconnecting = false;
        session.lastActivity = new Date();

        log.debug(`会话 ${sessionId} 重连成功(IPv6)`);

        return;
      } catch (ipv6Error) {
        session.isReconnecting = false;
        log.error(`IPv6重连也失败: ${ipv6Error.message}`);
        throw new Error(`重连失败: IPv4(${ipv4Error.message}) 和 IPv6(${ipv6Error.message})`);
      }
    }
  }

  /**
   * 生成唯一的会话ID
   */
  _generateSessionId() {
    return `ssh_${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * 生成安全的连接ID，避免在WebSocket中传输敏感信息
   * @param {Object} connection 连接信息
   * @returns {string} 安全的连接ID
   */
  _generateSecureConnectionId(_connection) {
    // 生成随机ID
    const randomPart = Math.random().toString(36).substring(2, 10);
    // 使用时间戳确保唯一性
    const timestamp = Date.now().toString(36);
    // 组合生成最终ID
    return `conn_${timestamp}_${randomPart}`;
  }

  /**
   * 清理过期的待处理连接
   */
  _cleanupPendingConnections() {
    if (!this.pendingConnections) return;

    const now = Date.now();
    const expirationTime = this.connectionIdExpiration;

    for (const [id, data] of this.pendingConnections.entries()) {
      if (now - data.createdAt > expirationTime) {
        this.pendingConnections.delete(id);
      }
    }
  }

  /**
   * 处理终端输入
   */
  _processTerminalInput(session, data) {
    if (!session) {
      log.error('无法处理终端输入: 会话对象为空');
      return;
    }

    session.lastActivity = new Date();

    const sessionId = session.id;

    if (!session.socket) {
      log.error(`无法发送数据: 会话 [${sessionId}] 的WebSocket为空`);
      return;
    }

    if (session.socket.readyState !== WS_CONSTANTS.OPEN) {
      log.error(
        `无法发送数据: 会话 [${sessionId}] 的WebSocket未打开, 当前状态: ${session.socket.readyState}`
      );
      return;
    }

    let isConnected = false;

    if (session.connectionState) {
      isConnected = session.connectionState.status === 'connected';
    }

    if (!isConnected) {
      log.warn(
        `无法发送数据: 会话 [${sessionId}] 未连接, 当前状态: ${session.connectionState ? session.connectionState.status : '未知'}`
      );
      return;
    }

    try {
      // 使用统一二进制协议发送SSH终端数据
      BinaryMessageSender.sendSSHData(session.socket, sessionId, data);
    } catch (error) {
      log.error(`发送SSH数据失败 [${sessionId}]:`, error);
      throw error; // 抛出错误，不再使用JSON回退
    }
  }

  /**
   * 统一的会话中断接口（占位实现）
   * @param {string} sessionId
   * @param {string} [reason='user_abort']
   * @param {Object} [detail={}]
   * @returns {boolean} 是否成功触发中断
   */
  abortSession(sessionId, reason = 'user_abort', detail = {}) {
    if (!sessionId) {
      log.warn('Abort 会话失败: 未提供会话ID', { reason, detail });
      return false;
    }

    if (this.verboseLogging.abort) {
      log.debug('Abort 会话请求 (占位实现)', { sessionId, reason, detail });
    }
    return false;
  }

  /**
   * 启用/关闭详细日志
   * @param {Object} options
   * @param {boolean} [options.buffer]
   * @param {boolean} [options.abort]
   */
  setVerboseLogging(options = {}) {
    if (typeof options.buffer === 'boolean') this.verboseLogging.buffer = options.buffer;
    if (typeof options.abort === 'boolean') this.verboseLogging.abort = options.abort;
  }

  /**
   * 关闭会话
   */
  async cancelConnectionByTerminal(terminalId, reason = 'frontend_monitor_unsubscribed') {
    if (!terminalId) {
      log.warn('取消连接失败: 未提供终端ID');
      return false;
    }

    log.debug(`尝试按终端取消连接: ${terminalId}`, { reason });

    let handled = false;

    // 若已有会话映射，优先尝试触发统一 abort
    if (this.terminalSessionMap.has(terminalId)) {
      const sessionId = this.terminalSessionMap.get(terminalId);
      this.pendingTerminalCancels.delete(terminalId);
      const abortDetail = {
        source: 'cancelConnectionByTerminal',
        terminalId,
        requestedAt: Date.now()
      };

      const aborted = this.abortSession(sessionId, reason, abortDetail);
      if (!aborted) {
        await this.closeSession(sessionId, { reason });
      }
      handled = true;
    }

    // 检查挂起的连接
    if (this.pendingConnections && this.pendingConnections.size) {
      for (const [connectionId, data] of this.pendingConnections.entries()) {
        if (data && data.connection && data.connection.terminalId === terminalId) {
          handled = true;
          log.debug(`取消待建立的SSH连接: ${connectionId}`, { terminalId });

          if (data.sessionId && this.sessions.has(data.sessionId)) {
            const sessionRef = this.sessions.get(data.sessionId);
            sessionRef.userInitiatedClose = true;
            if (sessionRef.connectionState) {
              sessionRef.connectionState.status = 'cancelled';
              sessionRef.connectionState.message = '连接已取消';
            }
            this._clearConnectionTimeout(data.sessionId);
          }

          this._closeSocketQuietly(data.socket, reason);

          if (data.reject) {
            try {
              data.reject(new Error('连接已取消'));
            } catch (rejectError) {
              log.debug('通知挂起连接取消失败', rejectError);
            }
          }

          this.pendingConnections.delete(connectionId);
        }
      }
    }

    const hasExistingCancel = this.pendingTerminalCancels.has(terminalId);

    this.pendingTerminalCancels.set(terminalId, {
      reason,
      timestamp: Date.now()
    });

    if (!handled && !hasExistingCancel) {
      window.dispatchEvent(
        new CustomEvent('ssh-connection-failed', {
          detail: {
            connectionId: terminalId,
            sessionId: null,
            error: '连接已取消',
            message: '连接已取消',
            reason,
            status: 'cancelled'
          }
        })
      );

      window.dispatchEvent(
        new CustomEvent(EVENTS.SSH_SESSION_CREATION_FAILED, {
          detail: {
            sessionId: null,
            terminalId,
            error: '连接已取消',
            reason,
            status: 'cancelled'
          }
        })
      );
    }

    return handled;
  }

  /**
   * 关闭会话
   */
  async closeSession(sessionId, options = {}) {
    if (!sessionId) {
      log.error('关闭会话失败: 未提供会话ID');
      return false;
    }

    const { reason = 'user_close' } = options;

    log.debug(`关闭SSH会话: ${sessionId}`, { reason });

    if (!this.sessions.has(sessionId)) {
      log.debug(`会话 ${sessionId} 不存在，可能已关闭`);
      return true;
    }

    const session = this.sessions.get(sessionId);
    let closeSuccess = false;

    try {
      const abortDetail = {
        source: 'closeSession',
        requestedAt: Date.now(),
        ...options.detail
      };

      const aborted = this.abortSession(sessionId, reason, abortDetail);

      // 如果 abort 已经执行，则视为关闭成功
      if (aborted) {
        this._clearConnectionTimeout(sessionId);
        this._clearKeepAlive(sessionId);
        this._clearLatencyTimer(sessionId);
        closeSuccess = true;
        return true;
      }

      // 否则走旧流程作为兜底
      this._clearConnectionTimeout(sessionId);
      log.debug(`清除会话 ${sessionId} 的保活定时器`);
      this._clearKeepAlive(sessionId);
      this._clearLatencyTimer(sessionId);

      session.userInitiatedClose = true;
      session.userCloseReason = reason;

      if (session.socket) {
        if (session.socket.readyState === WS_CONSTANTS.OPEN) {
          try {
            log.debug(`向服务器发送二进制断开请求: ${sessionId}`);
            const binaryDisconnect = BinaryMessageUtils.createDisconnectMessage({ sessionId, reason });
            session.socket.send(binaryDisconnect);
          } catch (sendBinaryError) {
            log.debug(`二进制断开请求失败，回退JSON: ${sessionId}`, sendBinaryError);
            try {
              const disconnectMessage = this._createStandardMessage('disconnect', { sessionId, reason });
              session.socket.send(JSON.stringify(disconnectMessage));
            } catch (sendJsonError) {
              log.debug(`发送JSON断开请求失败: ${sessionId}`, sendJsonError);
            }
          }
        }

        this._closeSocketQuietly(session.socket, reason);
      }

      if (typeof session.onClose === 'function') {
        try {
          session.onClose();
        } catch (callbackError) {
          log.debug(`执行会话关闭回调失败: ${sessionId}`, callbackError);
        }
      }

      if (session.destroy && typeof session.destroy === 'function') {
        try {
          log.debug(`销毁会话终端: ${sessionId}`);
          session.destroy();
        } catch (destroyError) {
          log.debug(`销毁会话终端失败: ${sessionId}`, destroyError);
        }
      }

      closeSuccess = true;
    } catch (error) {
      log.error(`关闭SSH会话 ${sessionId} 失败`, error);
      closeSuccess = false;
    } finally {
      log.debug(`彻底释放会话资源: ${sessionId}`);
      this.releaseResources(sessionId);
    }

    log.debug(`SSH会话已关闭: ${sessionId}`);
    return closeSuccess;
  }

  /**
   * 获取所有会话
   */
  getAllSessions() {
    return Array.from(this.sessions.values()).map(session => ({
      id: session.id,
      name: session.connection.name || `${session.connection.username}@${session.connection.host}`,
      host: session.connection.host,
      port: session.connection.port,
      status: session.connectionState || { status: 'unknown', message: '未知状态' },
      createdAt: session.createdAt,
      lastActivity: session.lastActivity
    }));
  }

  /**
   * 发送自定义错误事件
   */
  _dispatchErrorEvent(sessionId, message) {
    try {
      window.dispatchEvent(
        new CustomEvent('ssh:error', {
          detail: {
            sessionId,
            message,
            timestamp: new Date().toISOString()
          }
        })
      );
    } catch (error) {
      log.error('发送自定义事件失败:', error);
    }
  }

  /**
   * 彻底释放会话相关的所有资源
   */
  releaseResources(sessionId) {
    try {
      if (this.terminals.has(sessionId)) {
        try {
          const terminal = this.terminals.get(sessionId);
          if (terminal) {
            if (terminal._events) {
              for (const eventName in terminal._events) {
                terminal.off(eventName);
              }
            }

            if (typeof terminal.dispose === 'function') {
              terminal.dispose();
            }
          }
        } catch (error) {
          log.warn(`释放终端实例失败: ${sessionId}`, error);
        } finally {
          this.terminals.delete(sessionId);
        }
      }

      this._clearKeepAlive(sessionId);
      this._clearLatencyTimer(sessionId);

      if (this.sessions.has(sessionId)) {
        const session = this.sessions.get(sessionId);
        if (session && session.socket) {
          const socketRef = session.socket;
          this._closeSocketQuietly(socketRef, 'cleanup');

          try {
            socketRef.onopen = null;
            socketRef.onclose = null;
            socketRef.onerror = null;
            socketRef.onmessage = null;
          } catch (error) {
            log.warn(`移除WebSocket事件监听器失败: ${sessionId}`, error);
          }

          this._pendingQuietCloses.delete(socketRef);
          session.socket = null;
        }

        this.sessions.delete(sessionId);
      }

      // 清理终端-会话映射关系
      const terminalId = this.sessionTerminalMap.get(sessionId);
      if (terminalId) {
        this.terminalSessionMap.delete(terminalId);
        this.sessionTerminalMap.delete(sessionId);
      }

      // 清理延迟数据
      this.latencyData.delete(sessionId);

      log.debug(`会话 ${sessionId} 的资源已释放`);
      return true;
    } catch (error) {
      log.error(`释放会话 ${sessionId} 资源失败`, error);
      return false;
    }
  }

  /**
   * 获取会话的网络延迟数据
   * @param {string} sessionId - 会话ID
   * @returns {Object|null} - 延迟数据或null
   */
  getNetworkLatency(sessionId) {
    return this.latencyData.get(sessionId) || null;
  }

  /**
   * 获取终端的网络延迟数据
   * @param {string} terminalId - 终端ID
   * @returns {Object|null} - 延迟数据或null
   */
  getTerminalNetworkLatency(terminalId) {
    const sessionId = this.terminalSessionMap.get(terminalId);
    if (sessionId) {
      return this.getNetworkLatency(sessionId);
    }
    return null;
  }

  /**
   * 设置终端与会话的映射关系
   * @param {string} terminalId - 终端ID
   * @param {string} sessionId - 会话ID
   */
  setTerminalSessionMapping(terminalId, sessionId) {
    if (!terminalId || !sessionId) {
      log.warn('设置终端会话映射失败: 终端ID或会话ID无效', { terminalId, sessionId });
      return;
    }

    this.terminalSessionMap.set(terminalId, sessionId);
    this.sessionTerminalMap.set(sessionId, terminalId);

    // 同时更新会话对象
    if (this.sessions.has(sessionId)) {
      const session = this.sessions.get(sessionId);
      session.terminalId = terminalId;

      log.debug(`设置SSH会话 ${sessionId} 的终端ID: ${terminalId}`);

      // 如果终端ID与会话ID不一致，记录警告日志
      if (terminalId !== sessionId) {
        log.warn(`SSH会话ID(${sessionId})与终端ID(${terminalId})不一致，已重新关联`);
      }
    }
  }

  /**
   * 将英文错误消息翻译为中文
   * @param {string} errorMessage - 英文错误消息
   * @returns {string} - 翻译后的中文错误消息
   */
  _translateErrorMessage(errorMessage) {
    if (!errorMessage) return '未知错误';

    // 如果错误消息包含"SSH连接失败:"，则删除这个前缀
    const translatedMessage = errorMessage.replace(/SSH连接失败:\s*/g, '');

    // 常见错误消息的翻译映射
    const errorTranslations = {
      'All configured authentication methods failed': '所有认证方式均失败，请检查用户名和密码',
      'Authentication failed': '认证失败，请检查用户名和密码',
      'Connection refused': '连接被拒绝，请检查服务器地址和端口',
      'Connection timed out': '连接超时，请检查网络和服务器状态',
      'Host not found': '无法找到主机，请检查服务器地址',
      'Network error': '网络错误，请检查网络连接',
      'Permission denied': '权限被拒绝，请检查用户名和密码',
      'Server unexpectedly closed connection': '服务器意外关闭连接',
      'Unable to connect': '无法连接到服务器',
      'Connection failed': '连接失败',
      'Invalid username or password': '用户名或密码错误'
    };

    // 寻找完全匹配的错误消息
    if (errorTranslations[translatedMessage]) {
      return errorTranslations[translatedMessage];
    }

    // 寻找部分匹配的错误消息
    for (const [engError, cnError] of Object.entries(errorTranslations)) {
      if (translatedMessage.includes(engError)) {
        return cnError;
      }
    }

    // 如果没有匹配项，返回原始消息
    return translatedMessage;
  }

  /**
   * 获取规范化后的错误消息文本
   * @param {unknown} error - 错误对象或消息
   * @returns {string} - 规范化消息
   */
  _getErrorMessage(error) {
    if (!error) return '未知错误';
    if (typeof error === 'string') return error;
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'object') {
      const maybeMessage = error.message || error.reason || error.statusText;
      if (maybeMessage) {
        return maybeMessage;
      }
    }

    try {
      return JSON.stringify(error);
    } catch (_jsonError) {
      return String(error);
    }
  }

  /**
   * 判断错误是否属于预期的正常关闭/取消场景
   * @param {unknown} error - 错误对象或消息
   * @returns {boolean}
   */
  _isExpectedClosure(error) {
    const message = this._getErrorMessage(error);
    const normalized = message ? message.toLowerCase() : '';

    const patterns = [
      '正常关闭',
      'frontend_monitor_unsubscribed',
      'frontend_cancelled',
      'user_close',
      'client_cancelled',
      'connection cancelled',
      'connection canceled',
      '连接已关闭',
      '终端关闭',
      '连接已取消',
      'normal closure',
      'connection closed cleanly',
      'closed before the connection is established',
      'before the connection is established'
    ];

    if (patterns.some(pattern => normalized.includes(pattern))) {
      return true;
    }

    const code =
      (typeof error === 'object' && error !== null && 'code' in error && error.code) ||
      (typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode);

    if (code === 1000 || code === '1000' || code === 'NormalClosure') {
      return true;
    }

    return false;
  }

  /**
   * 安全关闭WebSocket，避免连接阶段产生控制台报错
   * @param {WebSocket} socket - 待关闭的WebSocket实例
   * @param {string} [reason='client_close'] - 关闭原因
   */
  _closeSocketQuietly(socket, reason = 'client_close') {
    if (!socket) return;

    const noop = () => {};

    try {
      const readyState = socket.readyState;

      // 仅在尚未关闭时处理
      if (readyState === WS_CONSTANTS.CLOSED) {
        return;
      }

      // 避免重复为同一个socket附加监听
      if (!this._pendingQuietCloses.has(socket)) {
        socket.addEventListener('error', noop, { once: true });
        socket.addEventListener('close', noop, { once: true });
        this._pendingQuietCloses.set(socket, true);
      }

      if (readyState === WS_CONSTANTS.OPEN || readyState === WS_CONSTANTS.CLOSING) {
        socket.close(1000, reason);
        return;
      }

      if (readyState === WS_CONSTANTS.CONNECTING) {
        const handleOpen = () => {
          socket.removeEventListener('open', handleOpen);
          try {
            socket.close(1000, reason);
          } catch (closeError) {
            log.debug('延迟关闭WebSocket连接失败', closeError);
          }
        };

        socket.addEventListener('open', handleOpen, { once: true });
        return;
      }
    } catch (error) {
      log.debug('静默关闭WebSocket时遇到异常', error);
    }
  }

  _clearConnectionTimeout(sessionId) {
    if (!sessionId) return;
    if (this.connectionTimeoutHandles.has(sessionId)) {
      const handle = this.connectionTimeoutHandles.get(sessionId);
      clearTimeout(handle);
      this.connectionTimeoutHandles.delete(sessionId);
    }
  }

  /**
   * 使用同步XOR加密敏感数据
   * @param {string} data 要加密的数据
   * @param {string} key 加密密钥
   * @returns {string} 加密后的Base64字符串
   */
  _encryptSensitiveData(data, key) {
    try {
      if (!data) return '';

      // 初始化向量
      const iv = crypto.getRandomValues(new Uint8Array(12));

      // 将字符串转换为字节数组
      const textEncoder = new TextEncoder();
      const dataBytes = textEncoder.encode(data);

      // 将密钥转换为字节数组
      const keyBytes = textEncoder.encode(key);

      // 使用XOR加密数据
      const encryptedData = new Uint8Array(dataBytes.length);
      for (let i = 0; i < dataBytes.length; i++) {
        encryptedData[i] = dataBytes[i] ^ keyBytes[i % keyBytes.length] ^ iv[i % iv.length];
      }

      // 创建完整加密结果：IV + 加密数据
      const result = new Uint8Array(iv.length + encryptedData.length);
      result.set(iv);
      result.set(encryptedData, iv.length);

      // 转换为Base64
      return btoa(String.fromCharCode.apply(null, result));
    } catch (error) {
      log.error('加密敏感数据失败:', error);
      throw error;
    }
  }

  /**
   * 根据会话ID获取终端ID
   * @param {string} sessionId - 会话ID
   * @returns {string|null} 终端ID或null
   */
  getTerminalIdBySession(sessionId) {
    if (!sessionId) {
      return null;
    }

    return this.sessionTerminalMap.get(sessionId) || null;
  }

  /**
   * 创建标准化的WebSocket消息
   * @param {string} type 消息类型
   * @param {Object} data 消息数据
   * @param {string} requestId 可选的请求ID
   * @returns {Object} 标准化的消息对象
   */
  _createStandardMessage(type, data, requestId = null) {
    const message = {
      type,
      data,
      timestamp: Date.now(),
      version: '2.0'
    };

    if (requestId) {
      message.requestId = requestId;
    }

    return message;
  }

  /**
   * 处理二进制WebSocket消息
   * 使用统一二进制协议: [Magic:4][Version:1][Type:1][HeaderLen:4][Header][Payload]
   * @param {ArrayBuffer} buffer 二进制数据
   * @param {string} sessionId 会话ID
   */
  _handleBinaryMessage(buffer, sessionId) {
    try {
      if (buffer.byteLength < 10) {
        log.error('二进制消息长度不足', { length: buffer.byteLength });
        return;
      }

      const view = new DataView(buffer);
      const magicNumber = view.getUint32(0, false);

      if (magicNumber !== 0x45535348) {
        log.error('无效的二进制协议格式');
        return;
      }

      const decoded = BinaryMessageDecoder.decode(buffer);

      // 委托给统一二进制处理器
      if (this.binaryHandler) {
        this.binaryHandler.handleDecodedMessage(decoded);
      }
    } catch (error) {
      log.error('处理二进制消息失败', { error: error.message, sessionId });
    }
  }

  /**
   * 处理二进制PING消息
   * @param {Object} headerData 头部数据
   */
  _handleBinaryPing(headerData) {
    log.debug('收到二进制PING消息', headerData);
    // 此处可以执行相关的PING处理逻辑
    // 一般情况下客户端不会主动发PING，都是服务端发送
  }

  /**
   * 处理二进制PONG消息
   * @param {Object} headerData 头部数据
   */
  _handleBinaryPong(headerData) {
    const { sessionId } = headerData;

    if (!sessionId || !this.sessions.has(sessionId)) {
      log.warn('无效的会话ID在PONG消息中', { sessionId });
      return;
    }

    const session = this.sessions.get(sessionId);
    session.lastActivity = new Date();
  }

  /**
   * 处理二进制连接注册消息
   * @param {Object} headerData 头部数据
   */
  _handleBinaryConnectionRegistered(headerData) {
    const { connectionId, sessionId, status } = headerData;
    log.debug('收到二进制连接注册消息', { connectionId, sessionId, status });

    const statusName = BinaryMessageUtils.decodeConnectionStatus(status);

    if (statusName === 'need_auth') {
      log.debug(`连接ID已注册，需要发送认证信息: ${connectionId}`);

      // 从 pending 连接中获取完整的连接信息
      if (!this.pendingConnections || !this.pendingConnections.has(connectionId)) {
        log.error(`无法找到连接ID对应的信息: ${connectionId}`);
        return;
      }

      const pendingData = this.pendingConnections.get(connectionId);
      const authConnection = pendingData.connection;
      const socket = pendingData.socket; // 获取WebSocket连接

      // 生成临时的AES密钥
      const randomKey = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      // 准备完整的认证数据对象
      const authPayload = {
        address: authConnection.host,
        port: authConnection.port || 22,
        username: authConnection.username,
        authType: authConnection.authType || 'password'
      };

      // 根据认证方式添加凭据
      if (authPayload.authType === 'password') {
        authPayload.password = authConnection.password;
      } else if (authPayload.authType === 'key' || authPayload.authType === 'privateKey') {
        authPayload.privateKey = authConnection.keyFile;
        if (authConnection.passphrase) {
          authPayload.passphrase = authConnection.passphrase;
        }
      }

      // 构建认证消息数据
      const authData = {
        connectionId,
        sessionId
      };

      // 使用同步方式处理
      try {
        // 对完整的认证载荷进行加密
        const encryptedPayload = this._encryptSensitiveData(JSON.stringify(authPayload), randomKey);
        authData.encryptedPayload = encryptedPayload;
        authData.keyId = randomKey;

        // 发送认证请求 - 使用二进制协议
        const authMessage = BinaryMessageUtils.createAuthenticateMessage(authData);
        socket.send(authMessage);

        log.debug('已发送加密认证请求', { connectionId, sessionId });
      } catch (encryptError) {
        log.error('加密认证信息失败', encryptError);
        // 触发错误回调
        if (pendingData.reject) {
          pendingData.reject(new Error('加密认证信息失败，无法安全连接'));
        }
      }
    } else if (statusName === 'reconnected') {
      log.debug(`连接ID已重连: ${connectionId}`);
    }
  }

  /**
   * 处理二进制连接完成消息
   * @param {Object} headerData 头部数据
   */
  _handleBinaryConnected(headerData) {
    const { sessionId, connectionId, status: _status, serverInfo } = headerData;
    log.debug('收到二进制连接完成消息', { sessionId, connectionId });

    if (!sessionId || !this.sessions.has(sessionId)) {
      log.warn('无效的会话ID在CONNECTED消息中', { sessionId });
      return;
    }

    const session = this.sessions.get(sessionId);
    session.lastActivity = new Date();
    session.retryCount = 0;
    session.isReconnecting = false;

    // 更新连接状态
    if (session.connectionState) {
      session.connectionState.status = 'connected';
      session.connectionState.message = '已连接';
    }

    // 如果有connectionId，查找并调用pendingConnection的resolve回调
    if (connectionId && this.pendingConnections && this.pendingConnections.has(connectionId)) {
      const pendingData = this.pendingConnections.get(connectionId);
      if (pendingData.resolve) {
        log.debug('调用连接Promise的resolve回调', { sessionId, connectionId });
        pendingData.resolve(sessionId);
      }
      // 清理pendingConnection
      this.pendingConnections.delete(connectionId);
    }

    // 触发连接成功事件
    this._triggerConnectionSuccess(sessionId, serverInfo);
  }

  /**
   * 处理二进制网络延迟消息
   * @param {Object} headerData 头部数据
   */
  _handleBinaryNetworkLatency(headerData) {
    const { sessionId, clientLatency, serverLatency, totalLatency, timestamp } = headerData;

    if (!sessionId || !this.sessions.has(sessionId)) {
      log.warn('收到无效会话的延迟数据', { sessionId });
      return;
    }

    const session = this.sessions.get(sessionId);

    // 更新会话中的延迟信息
    session.latency = {
      total: totalLatency,
      client: clientLatency,
      server: serverLatency,
      lastUpdate: new Date(timestamp)
    };

    //log.debug(`客户端：${clientLatency} 服务器：${serverLatency} 总延迟：${totalLatency}ms`);

    // 获取终端ID
    const terminalId = session.terminalId;

    // 触发延迟更新事件 - 使用与TerminalToolbar期望匹配的数据格式
    const latencyDetail = {
      sessionId,
      terminalId,
      clientLatency,
      serverLatency,
      totalLatency,
      timestamp: Date.now()
    };

    // 保存延迟数据
    this.latencyData.set(sessionId, {
      ...latencyDetail,
      lastUpdate: new Date()
    });

    // 触发全局延迟事件
    window.dispatchEvent(
      new CustomEvent(LATENCY_EVENTS.GLOBAL, {
        detail: latencyDetail
      })
    );

    // 触发工具栏延迟事件
    window.dispatchEvent(
      new CustomEvent(LATENCY_EVENTS.TOOLBAR, {
        detail: latencyDetail
      })
    );

    // 触发终端延迟事件
    if (terminalId) {
      window.dispatchEvent(
        new CustomEvent(LATENCY_EVENTS.TERMINAL, {
          detail: { ...latencyDetail, terminalId }
        })
      );
    }
  }

  /**
   * 触发连接成功事件
   * @param {string} sessionId 会话ID
   * @param {Object} serverInfo 服务器信息
   */
  _triggerConnectionSuccess(sessionId, serverInfo = {}) {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) return;

      const connection = session.connection || {};
      const connHost = serverInfo.host || connection.host;

      if (connHost) {
        // 获取终端ID
        let terminalId = this.sessionTerminalMap.get(sessionId);
        if (!terminalId && connection.terminalId) {
          terminalId = connection.terminalId;
          this.sessionTerminalMap.set(sessionId, terminalId);
          this.terminalSessionMap.set(terminalId, sessionId);
        }

        // 更新会话对象
        if (terminalId) {
          session.terminalId = terminalId;
        }

        const sshConnectedEvent = new CustomEvent(EVENTS.SSH_CONNECTED, {
          detail: {
            sessionId,
            host: connHost,
            terminalId,
            connection
          }
        });
        window.dispatchEvent(sshConnectedEvent);
        log.debug(`已触发SSH连接成功事件，主机: ${connHost}, 终端ID: ${terminalId || '未知'}`);

        if (terminalId && this.pendingTerminalCancels.has(terminalId)) {
          const cancelInfo = this.pendingTerminalCancels.get(terminalId);
          log.debug(`终端 ${terminalId} 存在挂起的取消请求，会话 ${sessionId} 将立即关闭`, cancelInfo);
          this.pendingTerminalCancels.delete(terminalId);
          setTimeout(() => {
            this.closeSession(sessionId, {
              reason: cancelInfo?.reason || 'frontend_monitor_unsubscribed'
            });
          }, 0);
        }
      }

      // SSH连接成功后稍微延迟触发保活ping来获取延迟信息
      setTimeout(() => {
        this._triggerImmediatePing(sessionId);
      }, 100);
    } catch (err) {
      log.error('触发SSH连接事件失败:', err);
    }
  }

  /**
   * 设置延迟测量定时器
   * @param {string} sessionId 会话ID
   */
  _setupLatencyTimer(sessionId) {
    if (!sessionId || !this.sessions.has(sessionId)) {
      return;
    }

    // 清除已存在的定时器
    this._clearLatencyTimer(sessionId);

    // 获取延迟测量专用间隔配置
    const dynamicConfig = getDynamicConstants(settingsService);
    const intervalSeconds = dynamicConfig.LATENCY_CONFIG.CHECK_INTERVAL || 5;
    const intervalMs = intervalSeconds * 1000;

    // 创建延迟测量定时器
    const timer = setInterval(() => {
      if (!this.sessions.has(sessionId)) {
        this._clearLatencyTimer(sessionId);
        return;
      }

      const session = this.sessions.get(sessionId);
      if (
        session.socket &&
        session.socket.readyState === WS_CONSTANTS.OPEN &&
        session.connectionState &&
        session.connectionState.status === 'connected'
      ) {
        this._triggerLatencyMeasurement(sessionId);
      }
    }, intervalMs);

    this.latencyTimers.set(sessionId, timer);
    log.debug(`延迟测量定时器已设置，间隔: ${intervalSeconds}秒`, { sessionId });
  }

  /**
   * 清除延迟测量定时器
   * @param {string} sessionId 会话ID
   */
  _clearLatencyTimer(sessionId) {
    if (this.latencyTimers.has(sessionId)) {
      const timer = this.latencyTimers.get(sessionId);
      clearInterval(timer);
      this.latencyTimers.delete(sessionId);
      log.debug('延迟测量定时器已清除', { sessionId });
    }
  }

  /**
   * 触发延迟测量（定时触发版本）
   * @param {string} sessionId 会话ID
   */
  _triggerLatencyMeasurement(sessionId) {
    if (!this.sessions.has(sessionId)) {
      return;
    }

    const session = this.sessions.get(sessionId);
    if (!session.socket || session.socket.readyState !== WS_CONSTANTS.OPEN) {
      return;
    }

    try {
      const timestamp = Date.now();
      const requestId = `latency_timer_${timestamp}_${Math.random().toString(36).substring(2, 9)}`;
      const clientSendTime = performance.now();

      // 获取或创建保活数据以复用ping请求机制
      let keepAliveData = this.keepAliveIntervals.get(sessionId);
      if (!keepAliveData) {
        this._setupKeepAlive(sessionId);
        keepAliveData = this.keepAliveIntervals.get(sessionId);
      }

      if (keepAliveData && keepAliveData.pingRequests) {
        keepAliveData.pingRequests.set(requestId, {
          timestamp: new Date(),
          clientSendTime,
          sessionId,
          isTimedLatencyMeasurement: true
        });

        // 发送延迟测量ping消息
        const binaryPingMessage = BinaryMessageUtils.createPingMessage({
          sessionId,
          timestamp,
          clientSendTime,
          requestId,
          measureLatency: true,
          client: 'easyssh',
          webSocketLatency: 1 // 触发服务端并行ping测量
        });
        session.socket.send(binaryPingMessage);

        session.lastActivity = new Date();
      }
    } catch (error) {
      log.warn(`定时延迟测量失败: ${sessionId}`, error);
    }
  }
}

// 创建单例
const sshService = new SSHService();

export default sshService;
