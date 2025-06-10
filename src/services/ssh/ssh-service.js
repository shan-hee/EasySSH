// import { WebSocket } from 'ws';
import { ElMessage } from 'element-plus';
import log from '../log';
import SettingsService from '../settings';
import { wsServerConfig } from '../../config/app-config';
import { WS_CONSTANTS, MESSAGE_TYPES, LATENCY_EVENTS, LATENCY_CONFIG, getDynamicConstants } from '../constants';

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
    this.terminalSessionMap = new Map(); // 终端ID到会话ID的映射
    this.sessionTerminalMap = new Map(); // 会话ID到终端ID的映射（双向映射提高查询效率）
    
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
    this.cleanupInterval = 60000 * 15; // 15分钟清理一次
    this.connectionIdExpiration = 60000 * 30; // 30分钟过期时间
    
    // 启动定期清理
    setInterval(() => this._cleanupPendingConnections(), this.cleanupInterval);
    
    // 暂存服务实例引用
    this.instance = this;
    
    log.info(`SSH服务初始化: IPv4=${this.ipv4Url}, IPv6=${this.ipv6Url}`);
  }

  /**
   * 初始化SSH服务
   */
  async init() {
    try {
      if (this.isReady) {
        log.info('SSH服务已初始化，跳过');
        return true;
      }
      
      log.info('正在初始化SSH服务...');
      this.isInitializing = true;
      
      // 更新动态配置 - 移到这里，确保settings服务已完全初始化
      try {
        const settingsService = new SettingsService();
        this.dynamicConfig = getDynamicConstants(settingsService);
        // 更新超时和重连配置
        if (this.dynamicConfig && this.dynamicConfig.SSH_CONSTANTS) {
          this.connectionTimeout = wsServerConfig.connectionTimeout || this.dynamicConfig.SSH_CONSTANTS.DEFAULT_TIMEOUT;
          this.reconnectAttempts = wsServerConfig.reconnectAttempts || this.dynamicConfig.SSH_CONSTANTS.MAX_RECONNECT_ATTEMPTS;
        }
      } catch (configError) {
        log.warn('获取动态配置失败，将使用默认值继续', configError);
      }
      
      log.info(`使用预设连接配置: 主URL=${this.baseUrl}`);
      
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
        log.info(`创建终端与SSH会话映射: 终端 ${connection.terminalId} -> 会话 ${sessionId}`);
      }
      
      // 尝试WebSocket连接
      try {
        // 确保URL是最新的 - 使用当前页面的host通过nginx代理
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const { path } = wsServerConfig;
        this.ipv4Url = `${protocol}//${host}${path}`;

        log.info(`尝试连接到WebSocket服务: ${this.ipv4Url}`);

        // 尝试连接
        const resultSessionId = await this._createSessionWithUrl(this.ipv4Url, sessionId, connection);
        return resultSessionId; // 返回可能新生成的会话ID
      } catch (connectionError) {
        log.error(`WebSocket连接失败: ${connectionError.message}`);

        // 获取terminalId以便通知终端组件
        const terminalId = this.sessionTerminalMap.get(sessionId) ||
                          (connection.terminalId ? connection.terminalId : null);

        // 触发全局事件，通知SSH连接失败
        if (terminalId) {
          window.dispatchEvent(new CustomEvent('ssh-connection-failed', {
            detail: {
              connectionId: terminalId,
              sessionId: sessionId,
              error: `SSH连接失败`,
              message: connectionError.message
            }
          }));

          // 触发会话创建失败事件
          window.dispatchEvent(new CustomEvent('ssh-session-creation-failed', {
            detail: {
              sessionId: sessionId,
              terminalId: terminalId,
              error: connectionError.message
            }
          }));
        }

        ElMessage.error(`连接失败: ${connectionError.message || '服务器无响应'}`);
        throw connectionError;
      }
    } catch (error) {
      log.error('创建SSH会话失败:', error);
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
      log.info(`准备建立SSH连接 (${connection.name || connection.host}:${connection.port})`);
      
      // 如果会话ID已存在，强制生成新的会话ID，确保不复用
      if (this.sessions.has(sessionId)) {
        log.warn(`发现同ID会话已存在: ${sessionId}，生成新的会话ID`);
        // 生成新的会话ID
        const newSessionId = this._generateSessionId();
        log.info(`为相同连接生成新会话ID: ${newSessionId}`);
        sessionId = newSessionId;
      }
      
      const connectionState = {
        status: 'connecting',
        message: '正在连接...',
        error: null,
        startTime: new Date()
      };
      
      log.info(`创建WebSocket连接: ${wsUrl}`);
      const socket = new WebSocket(wsUrl);
      
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
      
      log.info(`SSH会话创建成功: ${sessionId}`);
      
      return sessionId;
    } catch (error) {
      log.error(`创建SSH会话失败: ${sessionId}, 错误: ${error.message}`);
      
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
          this.sessions.delete(sessionId);
        }
        
        this.releaseResources(sessionId);
        
        // 获取terminalId以便通知终端组件
        const terminalId = this.sessionTerminalMap.get(sessionId) || 
                          (connection.terminalId ? connection.terminalId : null);
        
        // 只在最终失败时（IPv6备用连接失败或直接失败）才触发全局事件
        if (isFallback || !this.ipv6Url) {
          // 触发全局事件，通知SSH连接失败
          if (terminalId) {
            window.dispatchEvent(new CustomEvent('ssh-connection-failed', {
              detail: {
                connectionId: terminalId,
                sessionId: sessionId,
                error: this._translateErrorMessage(error.message),
                message: this._translateErrorMessage(error.message)
              }
            }));
            
            // 触发会话创建失败事件
            window.dispatchEvent(new CustomEvent('ssh-session-creation-failed', {
              detail: {
                sessionId: sessionId,
                terminalId: terminalId,
                error: this._translateErrorMessage(error.message)
              }
            }));
          }
        }
      } catch (cleanupError) {
        log.error(`清理失败会话资源时出错: ${sessionId}`, cleanupError);
      }
      
      throw error;
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
      
      // 连接打开时
      socket.onopen = () => {
        log.info('WebSocket连接已建立');
        connectionState.status = 'authenticating';
        connectionState.message = '正在进行SSH认证...';
        
        // 安全处理连接信息
        // 1. 生成临时连接ID替代直接发送完整配置
        const connectionId = this._generateSecureConnectionId(connection);
        
        // 2. 在本地会话存储完整连接信息(不通过网络传输)
        if(!this.pendingConnections) {
          this.pendingConnections = new Map();
        }
        this.pendingConnections.set(connectionId, {
          connection,
          createdAt: Date.now()
        });
        
        // 3. 只发送最小化必要信息
        socket.send(JSON.stringify({
          type: 'connect',
          data: {
            sessionId,
            connectionId // 只传递连接ID，不传递完整连接信息
          }
        }));
      };
      
      // 连接错误时
      socket.onerror = (event) => {
        clearTimeout(timeout);
        connectionState.status = 'error';
        connectionState.message = '连接错误';
        log.error('WebSocket连接错误', event);
        
        if (this.sessions.has(sessionId)) {
          const session = this.sessions.get(sessionId);
          if (session.retryCount < this.reconnectAttempts) {
            log.info(`连接错误，将尝试重连 (${session.retryCount + 1}/${this.reconnectAttempts})`);
            session.isReconnecting = true;
            session.retryCount++;
            
            setTimeout(() => {
              this._reconnectSession(sessionId, connection)
                .catch(error => {
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
      socket.onclose = (event) => {
          clearTimeout(timeout);
        
        const reason = this._getCloseReasonText(event.code, event.reason);
        log.info(`WebSocket连接关闭: ${reason}`);
        
        // 如果是正常关闭且处于已连接状态，则不触发错误
        if(event.code === 1000 && connectionState.status === 'connected') {
          connectionState.status = 'closed';
          connectionState.message = '连接已关闭';
          resolve(sessionId);
          return;
        }
        
        // 处理认证失败
        if(event.code === 4401) {
          connectionState.status = 'error';
          connectionState.message = '认证失败';
          connectionState.error = '用户名或密码错误';
          
          reject(new Error('认证失败: 用户名或密码错误'));
          return;
        }
        
        // 处理其他错误
        connectionState.status = 'error';
        connectionState.message = `连接关闭: ${reason}`;
                      
        if(!connectionState.error) {
          connectionState.error = reason;
                }
        
        reject(new Error(reason));
      };
      
      // 接收消息时
      socket.onmessage = (event) => {
        try {
          let message;
          try {
            message = JSON.parse(event.data);
          } catch (parseError) {
            log.error(`解析WebSocket消息失败:`, parseError);
            return;
          }
          
          if (!message.type) {
            log.warn('收到无类型WebSocket消息:', {
              messageDetails: JSON.stringify(message, null, 2).substring(0, 300),
              sessionId: sessionId
            });
            return;
          }
          
          if (this.sessions.has(sessionId)) {
            const session = this.sessions.get(sessionId);
            session.lastActivity = new Date();
          }
          
          switch (message.type) {
            case MESSAGE_TYPES.CONNECTED:
              clearTimeout(timeout);
              connectionState.status = 'connected';
              connectionState.message = '已连接';
              log.info(`SSH连接成功: ${sessionId}`);
              
              try {
                const connHost = connection.host || (this.sessions.has(sessionId) ? this.sessions.get(sessionId).connection?.host : null);
                if (connHost) {
                  // 优先从会话-终端映射中获取终端ID
                  let terminalId = this.sessionTerminalMap.get(sessionId);
                  
                  // 如果没有映射关系，尝试从连接配置中获取
                  if (!terminalId && connection.terminalId) {
                    terminalId = connection.terminalId;
                    // 建立双向映射关系
                    this.sessionTerminalMap.set(sessionId, terminalId);
                    this.terminalSessionMap.set(terminalId, sessionId);
                  }
                  
                  // 更新会话对象，保存终端ID信息
                  if (this.sessions.has(sessionId) && terminalId) {
                    const session = this.sessions.get(sessionId);
                    session.terminalId = terminalId;
                  }
                  
                  const sshConnectedEvent = new CustomEvent('ssh-connected', {
                    detail: { 
                      sessionId: sessionId,
                      host: connHost,
                      terminalId: terminalId,
                      connection: connection
                    }
                  });
                  window.dispatchEvent(sshConnectedEvent);
                  log.info(`已触发SSH连接成功事件，主机: ${connHost}, 终端ID: ${terminalId || '未知'}`);
                }
              } catch (err) {
                log.error('触发SSH连接事件失败:', err);
              }
              
              if (this.sessions.has(sessionId)) {
                const session = this.sessions.get(sessionId);
                session.retryCount = 0;
                session.isReconnecting = false;
              }
              
              resolve(sessionId);
              break;
              
            // 处理安全连接ID注册响应
            case 'connection_id_registered': 
              if (message.data && message.data.connectionId && message.data.status === 'need_auth') {
                log.info(`连接ID已注册，需要发送认证信息: ${message.data.connectionId}`);
                
                // 从pending连接中获取完整的连接信息
                if (!this.pendingConnections || !this.pendingConnections.has(message.data.connectionId)) {
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
                } else if (authPayload.authType === 'key' || authPayload.authType === 'privateKey') {
                  authPayload.privateKey = authConnection.keyFile;
                  if (authConnection.passphrase) {
                    authPayload.passphrase = authConnection.passphrase;
                  }
                }
                
                // 构建认证消息数据
                const authData = {
                  connectionId: message.data.connectionId,
                  sessionId: message.data.sessionId || sessionId,
                };
                
                // 使用同步方式处理
                try {
                  // 对完整的认证载荷进行加密 - 直接使用同步加密
                  const encryptedPayload = this._encryptSensitiveData(JSON.stringify(authPayload), randomKey);
                  authData.encryptedPayload = encryptedPayload;
                  authData.keyId = randomKey;
                  
                  // 发送认证请求
                  socket.send(JSON.stringify({
                    type: 'authenticate',
                    data: authData
                  }));
                } catch (encryptError) {
                  log.error('加密认证信息失败', encryptError);
                  reject(new Error('加密认证信息失败，无法安全连接'));
                }
                
                // 不要在这里resolve，等待CONNECTED消息
              } else if (message.data && message.data.status === 'reconnected') {
                log.info(`重新连接到已存在的连接ID: ${message.data.connectionId}`);
              }
              break;
              
            case MESSAGE_TYPES.ERROR:
              clearTimeout(timeout);
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
              log.info(`SSH连接已关闭: ${sessionId}`);
              
              if (this.sessions.has(sessionId)) {
                const session = this.sessions.get(sessionId);
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
                
                let data;
                try {
                  if (typeof window.TextDecoder !== 'undefined') {
                    const base64 = message.data.data;
                    const binary = window.atob(base64);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) {
                      bytes[i] = binary.charCodeAt(i);
                    }
                    const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });
                    data = decoder.decode(bytes);
                  } else {
                    const binary = atob(message.data.data);
                    data = binary;
                  }
                } catch (e) {
                  log.warn(`Base64解码失败, 使用原始数据:`, e);
                  data = message.data.data;
                }
                
                if (session.terminal) {
                  session.terminal.write(data);
                } else {
                  if (!session.buffer) {
                    session.buffer = '';
                    session.bufferSize = 0;
                  }
                  
                  session.buffer += data;
                  session.bufferSize += data.length;
                  
                  const MAX_BUFFER_SIZE = 1024 * 1024 * 5;  // 5MB
                  if (session.bufferSize > MAX_BUFFER_SIZE) {
                    log.warn(`会话 ${sessionId} 缓冲区过大(${session.bufferSize}B)，截断旧数据`);
                    const keepSize = 1024 * 1024;
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
                // 触发网络延迟事件，让UI可以显示
                const latencyDetail = {
                  sessionId: message.data?.sessionId || sessionId,
                  // 使用服务器返回的延迟数据
                  remoteLatency: message.data?.remoteLatency || message.data?.latency || 0,
                  localLatency: message.data?.localLatency || LATENCY_CONFIG.DEFAULT_LOCAL,
                  totalLatency: message.data?.totalLatency || message.data?.latency || 0,
                  timestamp: message.data?.timestamp || new Date().toISOString()
                };
                
                // log.debug(`收到网络延迟信息: ${JSON.stringify(latencyDetail)}`);
                
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
                window.dispatchEvent(new CustomEvent(LATENCY_EVENTS.GLOBAL, {
                  detail: enrichedLatencyDetail
                }));
                
                // 为保持兼容性，同时触发工具栏使用的事件格式
                window.dispatchEvent(new CustomEvent(LATENCY_EVENTS.TOOLBAR, {
                  detail: enrichedLatencyDetail
                }));
                
                // 如果有终端ID，触发终端特定的延迟事件
                if (terminalId) {
                  window.dispatchEvent(new CustomEvent(LATENCY_EVENTS.TERMINAL, {
                    detail: enrichedLatencyDetail
                  }));
                }
              } catch (e) {
                log.warn('处理网络延迟消息失败:', e);
                // 记录详细错误和消息数据，帮助调试
                log.debug('延迟消息数据:', JSON.stringify(message.data || {}));
                log.debug('错误详情:', e.message, e.stack);
              }
              break;
              
            // 增加SFTP相关消息类型的处理
            case MESSAGE_TYPES.SFTP_SUCCESS:
            case MESSAGE_TYPES.SFTP_PROGRESS:
            case MESSAGE_TYPES.SFTP_ERROR:
            case MESSAGE_TYPES.SFTP_READY:
            case MESSAGE_TYPES.SFTP_FILE:
            case MESSAGE_TYPES.SFTP_LIST:
            case MESSAGE_TYPES.SFTP_CONFIRM:
              // 由handleSftpMessages处理，此处仅标记为已识别类型
              break;
              
            // 处理其他消息类型
            default:
              const ignoredTypes = [
                MESSAGE_TYPES.PING, 
                MESSAGE_TYPES.PONG, 
                'keepalive', 'heartbeat', 'status', 'info', 'notification', 
                'system', 'stats', 'heartbeat_ack', 'heartbeat_response',
                'ack', 'response', 'server_status'
              ];
              
              // 忽略所有SFTP相关消息类型，避免它们被标记为未知类型
              if (!ignoredTypes.includes(message.type) && !message.type.startsWith('sftp_')) {
                log.debug(`收到未知消息类型: ${message.type}`, { sessionId });
              }
          }
          
          // SFTP消息专门由SFTP服务处理
          if (message.type && message.type.startsWith('sftp_')) {
            if (this.handleSftpMessages) {
              this.handleSftpMessages(message);
            } else {
              log.debug(`收到SFTP消息但未配置处理器: ${message.type}`, { sessionId });
            }
          }
          
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
    
    // 获取最新的动态配置
    const settingsService = new SettingsService();
    const dynamicConfig = getDynamicConstants(settingsService);

    // 从设置获取保活间隔
    const connectionSettings = settingsService.getConnectionOptions();
    const keepAliveIntervalSec = connectionSettings.keepAliveInterval || 
                                 dynamicConfig.LATENCY_CONFIG.CHECK_INTERVAL;
    const keepAliveIntervalMs = keepAliveIntervalSec * 1000;
    
    const interval = setInterval(() => {
      if (!this.sessions.has(sessionId)) {
        this._clearKeepAlive(sessionId);
        return;
      }
      
      const session = this.sessions.get(sessionId);
      const now = new Date();
      
      if (session.socket && session.socket.readyState === WS_CONSTANTS.OPEN) {
        try {
          const timestamp = now.toISOString();
          const requestId = Date.now().toString();
          
          pingRequests.set(requestId, {
            timestamp: now,
            sessionId
          });
          
          session.socket.send(JSON.stringify({
            type: MESSAGE_TYPES.PING,
            data: { 
              sessionId,
              timestamp,
              requestId,
              measureLatency: true,
              client: 'easyssh'
            }
          }));
          
          session.lastActivity = now;
          
          // 清理超时的ping请求
          const expireTime = new Date(now.getTime() - 10000);
          for (const [id, request] of pingRequests.entries()) {
            if (request.timestamp < expireTime) {
              pingRequests.delete(id);
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
    
    log.info(`正在重新连接会话: ${sessionId}`);
    
    try {
      log.info(`重连尝试使用IPv4连接: ${this.ipv4Url}`);
      const socket = new WebSocket(this.ipv4Url);
      
      session.connectionState = {
        status: 'reconnecting',
        message: '正在重新连接(IPv4)...'
      };
      
      await this._setupSocketEvents(socket, sessionId, connection, session.connectionState);
      
      session.socket = socket;
      session.isReconnecting = false;
      session.lastActivity = new Date();
      
      log.info(`会话 ${sessionId} 重连成功(IPv4)`);
      
      return;
    } catch (ipv4Error) {
      log.warn(`IPv4重连失败: ${ipv4Error.message}，尝试IPv6连接`);
      
      try {
        await new Promise(resolve => setTimeout(resolve, 500));
        
        log.info(`重连尝试使用IPv6连接: ${this.ipv6Url}`);
        const socket = new WebSocket(this.ipv6Url);
        
        session.connectionState = {
          status: 'reconnecting',
          message: '正在重新连接(IPv6)...'
        };
        
        await this._setupSocketEvents(socket, sessionId, connection, session.connectionState);
        
        session.socket = socket;
        session.isReconnecting = false;
        session.lastActivity = new Date();
        
        log.info(`会话 ${sessionId} 重连成功(IPv6)`);
        
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
  _generateSecureConnectionId(connection) {
    // 生成随机ID
    const randomPart = Math.random().toString(36).substring(2, 10);
    // 使用时间戳确保唯一性
    const timestamp = Date.now().toString(36);
    // 组合生成最终ID
    return `conn_${timestamp}_${randomPart}`;
  }
  
  /**
   * 清理过期的待处理连接
   * 定期清理超过30分钟未使用的连接信息
   */
  _cleanupPendingConnections() {
    if (!this.pendingConnections) return;
    
    const now = Date.now();
    const expirationTime = 30 * 60 * 1000; // 30分钟过期
    
    for (const [id, data] of this.pendingConnections.entries()) {
      if (now - data.createdAt > expirationTime) {
        this.pendingConnections.delete(id);
        log.debug(`已清理过期连接ID: ${id}`);
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
      log.error(`无法发送数据: 会话 [${sessionId}] 的WebSocket未打开, 当前状态: ${session.socket.readyState}`);
      return;
    }
    
    let isConnected = false;
    
    if (session.connectionState) {
      isConnected = session.connectionState.status === 'connected';
    }
    
    if (!isConnected) {
      log.warn(`无法发送数据: 会话 [${sessionId}] 未连接, 当前状态: ${session.connectionState ? session.connectionState.status : '未知'}`);
      return;
    }
    
    try {
      session.socket.send(JSON.stringify({
        type: 'data',
        data: {
          sessionId: sessionId,
          data: data
        }
      }));
    } catch (error) {
      log.error(`发送数据到会话 [${sessionId}] 失败:`, error);
    }
  }
  
  /**
   * 关闭会话
   */
  async closeSession(sessionId) {
    if (!sessionId) {
      log.error('关闭会话失败: 未提供会话ID');
      return false;
    }
    
    log.info(`准备关闭会话: ${sessionId}`);
    
    if (!this.sessions.has(sessionId)) {
      log.warn(`会话 ${sessionId} 不存在，可能已关闭`);
      return true;
    }
    
    const session = this.sessions.get(sessionId);
    let closeSuccess = false;
    
    try {
      log.debug(`清除会话 ${sessionId} 的保活定时器`);
      this._clearKeepAlive(sessionId);
      
      if (session.socket) {
        if (session.socket.readyState === WS_CONSTANTS.OPEN) {
          try {
            log.debug(`向服务器发送断开请求: ${sessionId}`);
            session.socket.send(JSON.stringify({
              type: 'disconnect',
              data: {
                sessionId
              }
            }));
          } catch (sendError) {
            log.warn(`发送断开请求失败: ${sessionId}`, sendError);
          }
        }
        
        try {
          if (session.socket.readyState !== WS_CONSTANTS.CLOSED) {
            log.debug(`关闭WebSocket连接: ${sessionId}`);
            session.socket.close();
          }
        } catch (closeError) {
          log.warn(`关闭WebSocket连接失败: ${sessionId}`, closeError);
        }
      }
      
      if (typeof session.onClose === 'function') {
        try {
          log.debug(`执行会话关闭回调: ${sessionId}`);
          session.onClose();
        } catch (callbackError) {
          log.warn(`执行会话关闭回调失败: ${sessionId}`, callbackError);
        }
      }
      
      if (session.destroy && typeof session.destroy === 'function') {
        try {
          log.debug(`销毁会话终端: ${sessionId}`);
          session.destroy();
        } catch (destroyError) {
          log.warn(`销毁会话终端失败: ${sessionId}`, destroyError);
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
    
    log.info(`SSH会话 ${sessionId} 已${closeSuccess ? '成功' : '尝试'}关闭`);
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
      status: session.connectionState || {status: 'unknown', message: '未知状态'},
      createdAt: session.createdAt,
      lastActivity: session.lastActivity
    }));
  }

  /**
   * 发送自定义错误事件
   */
  _dispatchErrorEvent(sessionId, message) {
    try {
      window.dispatchEvent(new CustomEvent('ssh:error', {
        detail: {
          sessionId: sessionId,
          message: message,
          timestamp: new Date().toISOString()
        }
      }));
    } catch (error) {
      log.error('发送自定义事件失败:', error);
    }
  }

  /**
   * 彻底释放会话相关的所有资源
   */
  releaseResources(sessionId) {
    try {
      log.info(`开始释放会话 ${sessionId} 的资源`);
      
      if (this.terminals.has(sessionId)) {
        log.info(`释放终端实例: ${sessionId}`);
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
      
      if (this.sessions.has(sessionId)) {
        const session = this.sessions.get(sessionId);
        if (session && session.socket) {
          try {
            if (session.socket.readyState !== WS_CONSTANTS.CLOSED) {
              log.info(`关闭WebSocket连接: ${sessionId}`);
              session.socket.close();
            }
          } catch (error) {
            log.warn(`关闭WebSocket连接失败: ${sessionId}`, error);
          }
          
          try {
            session.socket.onopen = null;
            session.socket.onclose = null;
            session.socket.onerror = null;
            session.socket.onmessage = null;
          } catch (error) {
            log.warn(`移除WebSocket事件监听器失败: ${sessionId}`, error);
          }
          
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
      
      log.info(`会话 ${sessionId} 的资源已释放`);
      return true;
    } catch (error) {
      log.error(`释放会话 ${sessionId} 资源失败`, error);
      return false;
    }
  }

  /**
   * 创建终端并绑定到会话
   */
  createTerminal(sessionId, container, options = {}) {
    // 这个方法内容太长，需要移到单独文件中实现
    // 此处仅保留方法签名，具体实现将在终端管理器模块中
    console.log('终端创建功能已移至终端管理模块');
    throw new Error('终端创建功能已移至终端管理模块');
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
      
      log.info(`设置SSH会话 ${sessionId} 的终端ID: ${terminalId}`);
      
      // 如果终端ID与会话ID不一致，记录警告日志
      if (terminalId !== sessionId) {
        log.info(`警告: SSH会话ID(${sessionId})与终端ID(${terminalId})不一致，已正确关联`);
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
    let translatedMessage = errorMessage.replace(/SSH连接失败:\s*/g, '');
    
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
}

// 创建单例
const sshService = new SSHService();

export default sshService; 