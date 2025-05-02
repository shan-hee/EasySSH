import { ElMessage } from 'element-plus'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
// 导入剪贴板插件
import { ClipboardAddon } from '@xterm/addon-clipboard'
import apiService from './api'
import log from './log'
import settings from './settings'
import { wsServerConfig } from '../config/app-config'

/**
 * SSH服务模块，负责管理SSH连接和终端会话
 * 使用WebSocket连接到远程SSH服务
 */
class SSHService {
  constructor() {
    this.sessions = new Map() // 存储所有活动的SSH会话
    this.terminals = new Map() // 存储所有终端实例
    this.isReady = false
    this.isInitializing = false // 标记初始化状态
    this.keepAliveIntervals = new Map() // 存储保活定时器
    
    // 从配置构建WebSocket URL
    const { port, path } = wsServerConfig
    
    // 提供两种URL方案，同时支持IPv4和IPv6
    this.ipv4Url = `ws://127.0.0.1:${port}${path}`
    this.ipv6Url = `ws://[::1]:${port}${path}`
    this.baseUrl = this.ipv4Url // 默认先尝试IPv4
    
    this.connectionTimeout = wsServerConfig.connectionTimeout || 10000
    this.reconnectAttempts = wsServerConfig.reconnectAttempts || 3
    this.reconnectDelay = wsServerConfig.reconnectDelay || 1000
    
    log.info(`SSH服务初始化: IPv4=${this.ipv4Url}, IPv6=${this.ipv6Url}`)
  }

  /**
   * 初始化SSH服务
   * @returns {Promise<boolean>} 是否初始化成功
   */
  async init() {
    try {
      if (this.isReady) {
        log.info('SSH服务已初始化，跳过')
        return true
      }
      
      log.info('正在初始化SSH服务...')
      
      // 标记为正在初始化，避免并发初始化
      this.isInitializing = true
      
      // 直接跳过检测连接，使用预设配置
      log.info(`使用预设连接配置: 主URL=${this.baseUrl}`)
      
      log.info('SSH服务初始化完成')
      this.isReady = true
      this.isInitializing = false
      return true
    } catch (error) {
      this.isInitializing = false
      log.error('SSH服务初始化失败', error)
      return false
    }
  }
  
  /**
   * 检测最佳连接方式
   * @returns {Promise<void>}
   * @private
   */
  async _detectBestConnection() {
    try {
      // 直接使用预设的连接方式，不进行测试
      log.info('使用预设连接方式')
    } catch (error) {
      log.error('检测最佳连接方式出错', error)
      throw error
    }
  }
  
  /**
   * 创建新的SSH会话
   * @param {Object} connection - 连接信息
   * @returns {Promise<string>} - 会话ID
   */
  async createSession(connection) {
    try {
      // 如果服务正在初始化中，等待初始化完成
      if (this.isInitializing) {
        log.info('SSH服务正在初始化中，等待初始化完成...')
        await new Promise(resolve => {
          const checkReady = () => {
            if (!this.isInitializing) {
              resolve()
            } else {
              setTimeout(checkReady, 100)
            }
          }
          checkReady()
        })
      }
      
      // 确保服务已初始化
      if (!this.isReady) {
        await this.init()
      }
      
      // 禁用连接复用功能，总是创建新会话
      // 这是为了避免多终端场景下的数据混淆问题
      log.info(`多终端模式: 为连接创建新会话 (${connection.host}:${connection.port})`)
      
      // 在终端ID未指定的情况下，使用内部生成的会话ID
      const generatedSessionId = this._generateSessionId();
      
      // 如果连接对象中有terminalId，则创建对应的映射关系
      let mappedSessionId = generatedSessionId;
      if (connection.terminalId) {
        // 记录映射关系: 终端ID -> SSH会话ID
        this.terminalSessionMap = this.terminalSessionMap || new Map();
        this.terminalSessionMap.set(connection.terminalId, generatedSessionId);
        log.info(`创建终端与SSH会话映射: 终端 ${connection.terminalId} -> 会话 ${generatedSessionId}`);
      }
      
      return this._createNewSession(connection);
    } catch (error) {
      log.error('创建SSH会话失败:', error)
      ElMessage.error(`SSH连接失败: ${error.message || '未知错误'}`)
      throw error
    }
  }
  
  /**
   * 使用特定URL创建会话
   * @param {string} wsUrl - WebSocket URL
   * @param {string} sessionId - 会话ID 
   * @param {Object} connection - 连接信息
   * @returns {Promise<string>} - 会话ID
   * @private
   */
  async _createSessionWithUrl(wsUrl, sessionId, connection) {
    try {
      log.info(`准备建立SSH连接 (${connection.name || connection.host}:${connection.port})`)
      log.debug(`- 会话ID: ${sessionId}`)
      log.debug(`- WebSocket URL: ${wsUrl}`)
      log.debug(`- 主机: ${connection.host}:${connection.port}`)
      log.debug(`- 用户: ${connection.username}`)
      log.debug(`- 认证方式: ${connection.authType || 'password'}`)
      
      sessionId = sessionId || this._generateSessionId()
      
      // 首先检查是否已存在同ID的会话，如果存在则尝试关闭
      if (this.sessions.has(sessionId)) {
        log.warn(`发现同ID会话已存在: ${sessionId}，尝试关闭`)
        try {
          await this.closeSession(sessionId)
          // 等待一段时间，确保资源释放
          await new Promise(resolve => setTimeout(resolve, 200))
        } catch (error) {
          log.warn(`关闭已存在会话失败: ${sessionId}`, error)
        }
      }
      
      // 创建会话状态对象
      const connectionState = {
        status: 'connecting',
        message: '正在连接...',
        error: null,
        startTime: new Date()
      }
      
      log.info(`创建WebSocket连接: ${wsUrl}`)
      // 创建WebSocket
      const socket = new WebSocket(wsUrl)
      
      // 创建会话对象
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
      }
      
      // 存储会话
      log.debug(`存储会话对象: ${sessionId}`)
      this.sessions.set(sessionId, session)
      
      // 设置WebSocket事件处理
      log.debug(`设置WebSocket事件处理: ${sessionId}`)
      await this._setupSocketEvents(socket, sessionId, connection, connectionState)
      
      // 设置保活机制，确保连接不断开
      log.debug(`设置保活机制: ${sessionId}`)
      this._setupKeepAlive(sessionId)
      
      log.info(`SSH会话创建成功: ${sessionId}`)
      
      return sessionId
    } catch (error) {
      // 创建会话失败，彻底清理资源
      log.error(`创建SSH会话失败: ${sessionId}, 错误: ${error.message}`)
      
      try {
        log.debug(`尝试清理失败会话的资源: ${sessionId}`)
        
        if (this.sessions.has(sessionId)) {
          const session = this.sessions.get(sessionId)
          
          // 关闭WebSocket
          if (session.socket) {
            try {
              log.debug(`关闭WebSocket连接: ${sessionId}`)
              session.socket.close()
              
              // 移除WebSocket事件监听器
              session.socket.onopen = null
              session.socket.onclose = null
              session.socket.onerror = null
              session.socket.onmessage = null
            } catch (socketError) {
              log.warn(`关闭WebSocket连接失败: ${sessionId}`, socketError)
            }
          }
          
          // 清除保活定时器
          this._clearKeepAlive(sessionId)
          
          // 删除会话
          this.sessions.delete(sessionId)
        }
        
        // 额外调用资源释放方法
        this.releaseResources(sessionId)
        
        log.debug(`失败会话的资源已清理: ${sessionId}`)
      } catch (cleanupError) {
        log.error(`清理失败会话资源时出错: ${sessionId}`, cleanupError)
      }
      
      // 抛出原始错误
      throw error
    }
  }
  
  /**
   * 设置会话保活机制
   * @param {string} sessionId - 会话ID
   * @private
   */
  _setupKeepAlive(sessionId) {
    // 清除可能存在的旧定时器
    this._clearKeepAlive(sessionId);
    
    // 用于追踪ping请求
    const pingRequests = new Map();
    
    // 从设置中获取保活间隔
    const connectionSettings = settings.getConnectionOptions();
    const keepAliveIntervalSec = connectionSettings.keepAliveInterval || 60; // 默认60秒
    const keepAliveIntervalMs = keepAliveIntervalSec * 1000; // 转换为毫秒
    
    // 创建新的保活定时器
    const interval = setInterval(() => {
      if (!this.sessions.has(sessionId)) {
        this._clearKeepAlive(sessionId);
        return;
      }
      
      const session = this.sessions.get(sessionId);
      const now = new Date();
      
      // 移除对于用户活动时间的判断，无论是否有用户活动都发送保活消息
      if (session.socket && session.socket.readyState === WebSocket.OPEN) {
        try {
          // 生成消息ID和时间戳
          const timestamp = now.toISOString();
          const requestId = Date.now().toString();
          
          // 始终测量延迟，移除每5次ping才测量的限制
          const shouldMeasureLatency = true;
          
          // 记录发送时间
          pingRequests.set(requestId, {
            timestamp: now,
            sessionId
          });
          
          // 发送保活消息，包含时间戳和测量标志
          session.socket.send(JSON.stringify({
            type: 'ping',
            data: { 
              sessionId,
              timestamp,
              requestId,
              measureLatency: shouldMeasureLatency,
              client: 'easyssh'
            }
          }));
          
          // 更新最后活动时间
          session.lastActivity = now;
          
          log.debug(`发送保活消息(ping): ${sessionId}, 测量延迟: ${shouldMeasureLatency}`);
          
          // 清理超时的ping请求（超过10秒未收到响应）
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
    }, keepAliveIntervalMs / 2); // 保活检查间隔为保活间隔的一半
    
    // 保存定时器引用和ping请求映射
    this.keepAliveIntervals.set(sessionId, {
      interval,
      pingRequests
    });
  }
  
  /**
   * 清除会话保活机制
   * @param {string} sessionId - 会话ID
   * @private
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
   * 处理WebSocket关闭码和原因，提供更友好的错误消息
   * @param {number} code - WebSocket关闭码
   * @param {string} reason - 关闭原因
   * @returns {string} - 人类可读的错误消息
   * @private
   */
  _getCloseReasonText(code, reason) {
    // WebSocket关闭码映射表
    const closeCodeMap = {
      1000: '正常关闭',
      1001: '终端关闭',
      1002: '协议错误',
      1003: '数据类型错误',
      1004: '保留',
      1005: '没有收到关闭码',
      1006: '异常关闭',
      1007: '数据格式不一致',
      1008: '违反政策',
      1009: '数据太大',
      1010: '缺少扩展',
      1011: '内部错误',
      1012: '服务重启',
      1013: '临时错误',
      1014: '服务器终止',
      1015: 'TLS握手失败'
    }
    
    const codeText = closeCodeMap[code] || `未知错误(${code})`
    return reason ? `${codeText}：${reason}` : codeText
  }
  
  /**
   * 设置WebSocket事件处理
   * @param {WebSocket} socket - WebSocket连接
   * @param {string} sessionId - 会话ID
   * @param {Object} connection - 连接信息
   * @param {Object} connectionState - 连接状态
   * @returns {Promise<void>}
   * @private
   */
  _setupSocketEvents(socket, sessionId, connection, connectionState) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('连接超时'))
      }, this.connectionTimeout)
      
      // 连接打开时
      socket.onopen = () => {
        log.info('WebSocket连接已建立')
        connectionState.status = 'authenticating'
        connectionState.message = '正在进行SSH认证...'
        
        // 准备SSH连接配置
        const config = {
          sessionId,
          address: connection.host,
          port: connection.port || 22,
          username: connection.username,
          authType: connection.authType || 'password'
        }
        
        // 添加认证信息
        if (config.authType === 'password') {
          config.password = connection.password
        } else if (config.authType === 'key' || config.authType === 'privateKey') {
          config.privateKey = connection.keyFile
          if (connection.passphrase) {
            config.passphrase = connection.passphrase
          }
        }
        
        // 发送连接请求
        socket.send(JSON.stringify({
          type: 'connect',
          data: config
        }))
      }
      
      // 连接错误时
      socket.onerror = (event) => {
        clearTimeout(timeout)
        connectionState.status = 'error'
        connectionState.message = '连接错误'
        log.error('WebSocket连接错误', event)
        
        // 检查是否应该尝试重连
        if (this.sessions.has(sessionId)) {
          const session = this.sessions.get(sessionId)
          if (session.retryCount < this.reconnectAttempts) {
            log.info(`连接错误，将尝试重连 (${session.retryCount + 1}/${this.reconnectAttempts})`)
            // 标记为重连中，避免重复处理
            session.isReconnecting = true
            // 增加重试计数
            session.retryCount++
            
            // 延迟后尝试重连
            setTimeout(() => {
              this._reconnectSession(sessionId, connection)
                .catch(error => {
                  log.error(`重连失败: ${error.message}`)
                })
            }, this.reconnectDelay)
          } else {
            log.warn(`达到最大重连次数(${this.reconnectAttempts})，不再尝试重连`)
          }
        }
        
        reject(new Error('WebSocket连接错误'))
      }
      
      // 连接关闭时
      socket.onclose = (event) => {
        const closeReason = this._getCloseReasonText(event.code, event.reason)
        
        if (connectionState.status !== 'connected') {
          clearTimeout(timeout)
          connectionState.status = 'closed'
          connectionState.message = `连接已关闭: ${closeReason}`
          log.warn(`WebSocket连接关闭: ${event.code} ${closeReason}`)
          reject(new Error(`连接已关闭: ${closeReason}`))
        } else {
          // 如果已连接，则更新状态
          connectionState.status = 'closed'
          connectionState.message = `连接已关闭: ${closeReason}`
          log.warn(`SSH会话 ${sessionId} 已关闭: ${event.code} ${closeReason}`)
          
          // 通知任何监听器连接已关闭
          if (this.sessions.has(sessionId)) {
            const session = this.sessions.get(sessionId)
            
            // 检查是否是非正常关闭，尝试重连
            if (event.code !== 1000 && event.code !== 1001) {
              if (!session.isReconnecting && session.retryCount < this.reconnectAttempts) {
                log.info(`连接异常关闭(${event.code})，将尝试重连 (${session.retryCount + 1}/${this.reconnectAttempts})`)
                // 标记为重连中，避免重复处理
                session.isReconnecting = true
                // 增加重试计数
                session.retryCount++
                
                // 延迟后尝试重连
                setTimeout(() => {
                  this._reconnectSession(sessionId, connection)
                    .catch(error => {
                      log.error(`重连失败: ${error.message}`)
                      
                      if (session.onClose) {
                        session.onClose()
                      }
                    })
                }, this.reconnectDelay)
              } else if (session.retryCount >= this.reconnectAttempts) {
                log.warn(`达到最大重连次数(${this.reconnectAttempts})，不再尝试重连`)
                if (session.onClose) {
                  session.onClose()
                }
              }
            } else {
              // 正常关闭，直接调用关闭回调
              if (session.onClose) {
                session.onClose()
              }
            }
          }
        }
      }
      
      // 接收消息时
      socket.onmessage = (event) => {
        try {
          
          let message;
          try {
            message = JSON.parse(event.data);
          } catch (parseError) {
            log.error(`解析WebSocket消息失败:`, parseError);
            log.debug(`无法解析的消息内容: ${event.data.substring(0, 200)}${event.data.length > 200 ? '...' : ''}`);
            return;
          }
          
          // 确保消息有类型
          if (!message.type) {
            log.warn('收到无类型WebSocket消息:', {
              messageDetails: JSON.stringify(message, null, 2).substring(0, 300),
              sessionId: sessionId
            });
            return;
          }
          
          // 更新会话最后活动时间
          if (this.sessions.has(sessionId)) {
            const session = this.sessions.get(sessionId);
            session.lastActivity = new Date();
          }
          
          switch (message.type) {
            case 'connected':
              // SSH连接成功
              clearTimeout(timeout)
              connectionState.status = 'connected'
              connectionState.message = '已连接'
              log.info(`SSH连接成功: ${sessionId}`)
              
              // 触发SSH连接成功事件，通知监控服务
              try {
                const connHost = connection.host || (this.sessions.has(sessionId) ? this.sessions.get(sessionId).connection?.host : null)
                if (connHost) {
                  // 获取终端ID - 通过terminalSessionMap反查或直接使用connection中的terminalId
                  let terminalId = null;
                  
                  // 通过映射查找对应的终端ID
                  if (this.terminalSessionMap) {
                    for (const [tId, sId] of this.terminalSessionMap.entries()) {
                      if (sId === sessionId) {
                        terminalId = tId;
                        break;
                      }
                    }
                  }
                  
                  // 如果没有找到映射，尝试从连接信息中获取
                  if (!terminalId && connection.terminalId) {
                    terminalId = connection.terminalId;
                  }
                  
                  const sshConnectedEvent = new CustomEvent('ssh-connected', {
                    detail: { 
                      sessionId: sessionId,
                      host: connHost,
                      terminalId: terminalId // 添加终端ID
                    }
                  })
                  window.dispatchEvent(sshConnectedEvent)
                  log.info(`已触发SSH连接成功事件，主机: ${connHost}, 终端ID: ${terminalId || '未知'}`)
                }
              } catch (err) {
                log.error('触发SSH连接事件失败:', err)
              }
              
              // 重置重连计数
              if (this.sessions.has(sessionId)) {
                const session = this.sessions.get(sessionId)
                session.retryCount = 0
                session.isReconnecting = false
              }
              
              resolve()
              break
              
            case 'error':
              // 处理错误消息
              clearTimeout(timeout)
              connectionState.status = 'error'
              connectionState.message = message.data?.message || '未知错误'
              log.error(`SSH连接错误: ${connectionState.message}`)
              reject(new Error(connectionState.message))
              break
              
            case 'closed':
              // 处理连接关闭消息
              connectionState.status = 'closed'
              connectionState.message = '连接已关闭'
              log.info(`SSH连接已关闭: ${sessionId}`)
              
              // 如果已初始化，通知会话关闭
              if (this.sessions.has(sessionId)) {
                const session = this.sessions.get(sessionId)
                if (session.onClose) {
                  session.onClose()
                }
              }
              break
              
            case 'keepalive':
              // 处理保活响应
              log.debug(`收到保活响应: ${sessionId}`)
              if (this.sessions.has(sessionId)) {
                const session = this.sessions.get(sessionId)
                session.lastActivity = new Date()
              }
              break
              
            case 'heartbeat':
              // 处理心跳消息，忽略此类消息
              log.debug(`收到心跳消息: ${sessionId}`)
              if (this.sessions.has(sessionId)) {
                const session = this.sessions.get(sessionId)
                session.lastActivity = new Date()
              }
              break
              
            case 'network_latency':
              // 处理网络延迟消息
              log.info(`收到网络延迟信息: ${JSON.stringify(message.data)}`)
              if (this.sessions.has(sessionId)) {
                const session = this.sessions.get(sessionId)
                // 保存延迟信息，使用新的数据结构
                session.networkLatency = {
                  remote: message.data.remoteLatency || 0,
                  local: message.data.localLatency || 0,
                  total: message.data.totalLatency || 0 
                }
                // 发送自定义事件，通知UI组件更新
                window.dispatchEvent(new CustomEvent('network-latency-update', {
                  detail: {
                    sessionId,
                    remoteLatency: message.data.remoteLatency || 0,
                    localLatency: message.data.localLatency || 0,
                    totalLatency: message.data.totalLatency || 0
                  }
                }))
              }
              break
              
            case 'data':
              // 处理服务器发送的数据
              if (this.sessions.has(sessionId)) {
                const session = this.sessions.get(sessionId)
                
                if (!message.data || !message.data.data) {
                  log.error('数据格式错误:', message)
                  return
                }
                
                // 性能计时 - 开始解码
                const decodeStartTime = performance.now()
                
                // 尝试解码数据
                let data
                try {
                  // 使用更安全和高效的Base64解码
                  if (typeof window.TextDecoder !== 'undefined') {
                    // 使用TextDecoder API更高效地处理Unicode
                    const base64 = message.data.data
                    // 将Base64转换为二进制数组
                    const binary = window.atob(base64)
                    const bytes = new Uint8Array(binary.length)
                    for (let i = 0; i < binary.length; i++) {
                      bytes[i] = binary.charCodeAt(i)
                    }
                    // 使用TextDecoder解码
                    const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true })
                    data = decoder.decode(bytes)
                  } else {
                    // 降级方案，使用传统的atob
                  const binary = atob(message.data.data)
                  data = binary
                  }
                } catch (e) {
                  log.warn(`Base64解码失败, 使用原始数据:`, e)
                  data = message.data.data
                }
                
                // 性能计时 - 结束解码
                const decodeTime = performance.now() - decodeStartTime
                
                // 仅当数据大小超过一定阈值时记录性能，避免日志过多
                const dataSize = message.data.data.length
                if (dataSize > 10000 && decodeTime > 5) {  // 大于10KB且解码时间超过5ms才记录
                  log.debug(`终端数据解析性能: 大小=${dataSize}B, 解码时间=${decodeTime.toFixed(2)}ms`)
                }
                
                if (session.terminal) {
                  // 性能计时 - 写入终端
                  const writeStartTime = performance.now()
                  
                  // 如果终端已创建，直接写入
                  session.terminal.write(data)
                  
                  // 记录大数据包的写入性能
                  const writeTime = performance.now() - writeStartTime
                  if (dataSize > 50000 && writeTime > 10) {  // 大于50KB且写入时间超过10ms才记录
                    log.debug(`终端写入性能: 大小=${dataSize}B, 写入时间=${writeTime.toFixed(2)}ms`)
                  }
                } else {
                  // 如果终端尚未创建，存入缓冲区
                  if (!session.buffer) {
                    session.buffer = ''
                    session.bufferSize = 0
                  }
                  
                  // 添加到缓冲区
                  session.buffer += data
                  session.bufferSize += data.length
                  
                  // 安全检查: 防止缓冲区过大
                  const MAX_BUFFER_SIZE = 1024 * 1024 * 5  // 5MB
                  if (session.bufferSize > MAX_BUFFER_SIZE) {
                    log.warn(`会话 ${sessionId} 缓冲区过大(${session.bufferSize}B)，截断旧数据`)
                    // 保留最后1MB数据，丢弃旧数据以避免内存问题
                    const keepSize = 1024 * 1024
                    session.buffer = session.buffer.substring(session.buffer.length - keepSize)
                    session.bufferSize = session.buffer.length
                  }
                }
                
                // 更新最后活动时间
                session.lastActivity = new Date()
              }
              break
              
            case 'pong':
              // 处理保活响应
              log.debug(`收到保活响应: ${sessionId}`)
              break
              
            default:
              // 扩展忽略列表，包含更多可能的服务器消息类型
              const ignoredTypes = [
                'ping', 'pong', 'status', 'info', 'notification', 
                'system', 'stats', 'heartbeat_ack', 'heartbeat_response',
                'ack', 'response', 'server_status'
              ];
              
              if (ignoredTypes.includes(message.type)) {
                log.debug(`收到非关键消息类型: ${message.type}`, { sessionId });
              } else {
                // 仅记录第一次见到的未知类型消息为ERROR，后续同类型只记录为DEBUG
                const unknownTypeKey = `unknown_type_${message.type}`;
                if (!this[unknownTypeKey]) {
                  this[unknownTypeKey] = true;
                  log.error(`SSH连接错误: 未知的消息类型 ${message.type}`, {
                    messageDetails: JSON.stringify(message, null, 2).substring(0, 300),
                    sessionId: sessionId
                  });
                  
                  // 只为第一次遇到的未知类型消息触发错误事件
                  if (this.sessions.has(sessionId)) {
                    const session = this.sessions.get(sessionId);
                    if (session.onError) {
                      session.onError(`收到未知消息类型: ${message.type}`);
                    }
                    this._dispatchErrorEvent(sessionId, `收到未知消息类型: ${message.type}`);
                  }
                } else {
                  // 后续同类型消息只记录为DEBUG级别
                  log.debug(`再次收到未知消息类型: ${message.type}`, { 
                    sessionId,
                    timestamp: new Date().toISOString()
                  });
                }
              }
          }
        } catch (error) {
          log.error('处理WebSocket消息失败', error)
        }
      }
    })
  }
  
  /**
   * 尝试重新连接会话
   * @param {string} sessionId - 会话ID
   * @param {Object} connection - 连接配置
   * @returns {Promise<void>}
   * @private
   */
  async _reconnectSession(sessionId, connection) {
    if (!this.sessions.has(sessionId)) {
      throw new Error(`会话 ${sessionId} 不存在，无法重连`)
    }
    
    const session = this.sessions.get(sessionId)
    
    // 关闭旧的WebSocket连接
    if (session.socket) {
      try {
        session.socket.close()
      } catch (error) {
        // 忽略关闭错误
      }
    }
    
    log.info(`正在重新连接会话: ${sessionId}`)
    
    // 先尝试IPv4连接
    try {
      log.info(`重连尝试使用IPv4连接: ${this.ipv4Url}`)
      const socket = new WebSocket(this.ipv4Url)
      
      // 更新会话状态
      session.connectionState = {
        status: 'reconnecting',
        message: '正在重新连接(IPv4)...'
      }
      
      // 设置WebSocket事件
      await this._setupSocketEvents(socket, sessionId, connection, session.connectionState)
      
      // 更新会话信息
      session.socket = socket
      session.isReconnecting = false
      session.lastActivity = new Date()
      
      log.info(`会话 ${sessionId} 重连成功(IPv4)`)
      
      return
    } catch (ipv4Error) {
      log.warn(`IPv4重连失败: ${ipv4Error.message}，尝试IPv6连接`)
      
      // 如果IPv4失败，尝试IPv6
      try {
        // 等待一段时间确保连接完全关闭
        await new Promise(resolve => setTimeout(resolve, 500))
        
        log.info(`重连尝试使用IPv6连接: ${this.ipv6Url}`)
        const socket = new WebSocket(this.ipv6Url)
        
        // 更新会话状态
        session.connectionState = {
          status: 'reconnecting',
          message: '正在重新连接(IPv6)...'
        }
        
        // 设置WebSocket事件
        await this._setupSocketEvents(socket, sessionId, connection, session.connectionState)
        
        // 更新会话信息
        session.socket = socket
        session.isReconnecting = false
        session.lastActivity = new Date()
        
        log.info(`会话 ${sessionId} 重连成功(IPv6)`)
        
        return
      } catch (ipv6Error) {
        session.isReconnecting = false
        log.error(`IPv6重连也失败: ${ipv6Error.message}`)
        throw new Error(`重连失败: IPv4(${ipv4Error.message}) 和 IPv6(${ipv6Error.message})`)
      }
    }
  }
  
  /**
   * 生成唯一的会话ID
   * @returns {string} 会话ID
   * @private
   */
  _generateSessionId() {
    return 'ssh_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
  }
  
  /**
   * 创建终端并绑定到会话
   * @param {string} sessionId - 会话ID
   * @param {HTMLElement} container - 终端容器元素
   * @param {Object} options - 终端选项
   * @returns {Terminal} - 创建的终端实例
   */
  createTerminal(sessionId, container, options = {}) {
    if (!this.sessions.has(sessionId)) {
      throw new Error(`未找到会话ID: ${sessionId}`)
    }
    
    const session = this.sessions.get(sessionId)
    
    // 创建终端实例
    const terminal = new Terminal({
      fontSize: options.fontSize || settings.terminalFontSize || 14,
      fontFamily: options.fontFamily || settings.terminalFontFamily || "'JetBrains Mono'",
      theme: options.theme,
      cursorBlink: true,
      scrollback: 3000,
      // 启用右键菜单，以支持右键粘贴
      rightClickSelectsWord: true,
      // 允许选择
      disableStdin: false
    })
    
    // 添加FitAddon以自动调整终端大小
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    
    // 添加WebLinksAddon以支持链接点击
    const webLinksAddon = new WebLinksAddon()
    terminal.loadAddon(webLinksAddon)

    // 添加ClipboardAddon以支持复制粘贴
    const clipboardAddon = new ClipboardAddon()
    terminal.loadAddon(clipboardAddon)
    
    // 渲染终端
    terminal.open(container)
    fitAddon.fit()
    
    // 处理用户输入
    terminal.onData((data) => {
      this._processTerminalInput(session, data)
    })
    
    // 处理终端大小变化
    terminal.onResize(({ cols, rows }) => {
      if (session.socket && session.socket.readyState === WebSocket.OPEN) {
        session.socket.send(JSON.stringify({
          type: 'resize',
          data: {
            sessionId,
            cols,
            rows
          }
        }))
      }
    })
    
    // 添加鼠标左键选中复制功能
    terminal.attachCustomKeyEventHandler((event) => {
      // 允许所有按键事件传递到终端
      return true;
    });

    // 处理选中复制
    terminal.onSelectionChange(() => {
      if (terminal.hasSelection()) {
        const selectedText = terminal.getSelection();
        if (selectedText) {
          try {
            // 使用动态导入避免循环依赖
            import('./settings').then(settingsModule => {
              const settingsService = settingsModule.default;
              // 获取终端选项
              const terminalOptions = settingsService.getTerminalOptions();
              
              // 只有在开启了选中复制选项时才复制
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
      // 始终阻止浏览器默认右键菜单
      event.preventDefault();
      
      try {
        // 使用动态导入获取设置
        const settingsModule = await import('./settings');
        const settingsService = settingsModule.default;
        const terminalOptions = settingsService.getTerminalOptions();
        
        // 如果用户禁用了右键粘贴功能，直接返回不执行粘贴
        if (!terminalOptions || !terminalOptions.rightClickSelectsWord) {
          return;
        }
        
        // 用户启用了右键粘贴功能，执行粘贴
        try {
          // 从剪贴板读取文本
          const text = await navigator.clipboard.readText();
          if (text && text.trim().length > 0) {
            this._processTerminalInput(session, text);
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
        // 加载设置失败时，仍然不显示默认菜单
        log.error('加载设置服务失败:', settingsError);
      }
    };
    
    container.addEventListener('contextmenu', handleContextMenu);
    
    // 添加终端粘贴事件监听
    const handleTerminalPaste = (event) => {
      if (event.detail && event.detail.text) {
        this._processTerminalInput(session, event.detail.text);
      }
    };
    container.addEventListener('terminal-paste', handleTerminalPaste);
    
    // 自动调整终端大小
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit()
      } catch (e) {
        log.error('调整终端大小失败', e)
      }
    })
    
    resizeObserver.observe(container)
    
    // 将终端与会话绑定
    session.terminal = terminal
    this.terminals.set(sessionId, terminal)
    
    // 如果有缓冲的数据，写入终端
    if (session.buffer) {
      terminal.write(session.buffer)
      session.buffer = ''
    }
    
    // 添加销毁处理
    session.destroy = () => {
      container.removeEventListener('contextmenu', handleContextMenu);
      container.removeEventListener('terminal-paste', handleTerminalPaste);
      resizeObserver.disconnect()
      terminal.dispose()
      this.terminals.delete(sessionId)
    }
    
    return terminal
  }
  
  /**
   * 处理终端输入
   * @param {Object} session - 会话对象
   * @param {string} data - 输入数据
   * @private
   */
  _processTerminalInput(session, data) {
    if (!session) {
      log.error('无法处理终端输入: 会话对象为空')
      return
    }

    // 记录活动时间
    session.lastActivity = new Date()
    
    const sessionId = session.id
    
    // 检查WebSocket状态
    if (!session.socket) {
      log.error(`无法发送数据: 会话 [${sessionId}] 的WebSocket为空`)
      return
    }
    
    if (session.socket.readyState !== WebSocket.OPEN) {
      log.error(`无法发送数据: 会话 [${sessionId}] 的WebSocket未打开, 当前状态: ${session.socket.readyState}`)
      return
    }
    
    // 检查会话状态 - 修正状态检查逻辑，使用connectionState而非status
    let isConnected = false
    
    if (session.connectionState) {
      isConnected = session.connectionState.status === 'connected'
    }
    
    if (!isConnected) {
      log.warn(`无法发送数据: 会话 [${sessionId}] 未连接, 当前状态: ${session.connectionState ? session.connectionState.status : '未知'}`)
      return
    }
    
    try {
      // 通过WebSocket发送用户输入数据到服务器
      session.socket.send(JSON.stringify({
        type: 'data',
        data: {
          sessionId: sessionId,
          data: data
        }
      }))
    } catch (error) {
      log.error(`发送数据到会话 [${sessionId}] 失败:`, error)
    }
  }
  
  /**
   * 关闭会话
   * @param {string} sessionId - 会话ID
   * @returns {Promise<boolean>} - 是否成功关闭
   */
  async closeSession(sessionId) {
    if (!sessionId) {
      log.error('关闭会话失败: 未提供会话ID')
      return false
    }
    
    log.info(`准备关闭会话: ${sessionId}`)
    
    if (!this.sessions.has(sessionId)) {
      log.warn(`会话 ${sessionId} 不存在，可能已关闭`)
      return true
    }
    
    const session = this.sessions.get(sessionId)
    let closeSuccess = false
    
    try {
      // 清除保活定时器
      log.debug(`清除会话 ${sessionId} 的保活定时器`)
      this._clearKeepAlive(sessionId);
      
      // 发送关闭请求
      if (session.socket) {
        if (session.socket.readyState === WebSocket.OPEN) {
          try {
            log.debug(`向服务器发送断开请求: ${sessionId}`)
            session.socket.send(JSON.stringify({
              type: 'disconnect',
              data: {
                sessionId
              }
            }))
          } catch (sendError) {
            // 发送断开请求失败，但不阻止后续操作
            log.warn(`发送断开请求失败: ${sessionId}`, sendError)
          }
        } else {
          log.debug(`WebSocket已不在打开状态，无需发送断开请求: ${sessionId}, readyState=${session.socket.readyState}`)
        }
        
        // 关闭WebSocket连接
        try {
          if (session.socket.readyState !== WebSocket.CLOSED) {
            log.debug(`关闭WebSocket连接: ${sessionId}`)
            session.socket.close()
          }
        } catch (closeError) {
          log.warn(`关闭WebSocket连接失败: ${sessionId}`, closeError)
        }
      }
      
      // 触发关闭回调
      if (typeof session.onClose === 'function') {
        try {
          log.debug(`执行会话关闭回调: ${sessionId}`)
          session.onClose()
        } catch (callbackError) {
          log.warn(`执行会话关闭回调失败: ${sessionId}`, callbackError)
        }
      }
      
      // 如果有终端，销毁终端
      if (session.destroy && typeof session.destroy === 'function') {
        try {
          log.debug(`销毁会话终端: ${sessionId}`)
          session.destroy()
        } catch (destroyError) {
          log.warn(`销毁会话终端失败: ${sessionId}`, destroyError)
        }
      }
      
      closeSuccess = true
    } catch (error) {
      log.error(`关闭SSH会话 ${sessionId} 失败`, error)
      closeSuccess = false
    } finally {
      // 无论成功与否，都彻底释放资源
      log.debug(`彻底释放会话资源: ${sessionId}`)
      this.releaseResources(sessionId)
    }
    
    log.info(`SSH会话 ${sessionId} 已${closeSuccess ? '成功' : '尝试'}关闭`)
    return closeSuccess
  }
  
  /**
   * 获取所有会话
   * @returns {Array} - 会话数组
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
    }))
  }

  /**
   * 发送自定义错误事件
   * @param {string} sessionId - 会话ID
   * @param {string} message - 错误消息
   * @private
   */
  _dispatchErrorEvent(sessionId, message) {
    try {
      window.dispatchEvent(new CustomEvent('ssh:error', {
        detail: {
          sessionId: sessionId,
          message: message,
          timestamp: new Date().toISOString()
        }
      }))
      log.debug(`已发送ssh:error事件: ${message}`)
    } catch (error) {
      log.error('发送自定义事件失败:', error)
    }
  }

  /**
   * 彻底释放会话相关的所有资源
   * @param {string} sessionId - 会话ID
   * @returns {boolean} - 是否成功释放资源
   */
  releaseResources(sessionId) {
    try {
      log.info(`开始释放会话 ${sessionId} 的资源`)
      
      // 清除终端实例
      if (this.terminals.has(sessionId)) {
        log.info(`释放终端实例: ${sessionId}`)
        try {
          const terminal = this.terminals.get(sessionId)
          if (terminal) {
            // 移除所有事件监听器
            if (terminal._events) {
              for (const eventName in terminal._events) {
                terminal.off(eventName)
              }
            }
            
            // 应用销毁方法
            if (typeof terminal.dispose === 'function') {
              terminal.dispose()
            }
          }
        } catch (error) {
          log.warn(`释放终端实例失败: ${sessionId}`, error)
        } finally {
          this.terminals.delete(sessionId)
        }
      }
      
      // 清除保活定时器
      this._clearKeepAlive(sessionId)
      
      // 确保WebSocket已关闭
      if (this.sessions.has(sessionId)) {
        const session = this.sessions.get(sessionId)
        if (session && session.socket) {
          try {
            if (session.socket.readyState !== WebSocket.CLOSED) {
              log.info(`关闭WebSocket连接: ${sessionId}`)
              session.socket.close()
            }
          } catch (error) {
            log.warn(`关闭WebSocket连接失败: ${sessionId}`, error)
          }
          
          // 移除WebSocket事件监听器
          try {
            session.socket.onopen = null
            session.socket.onclose = null
            session.socket.onerror = null
            session.socket.onmessage = null
          } catch (error) {
            log.warn(`移除WebSocket事件监听器失败: ${sessionId}`, error)
          }
          
          // 清除引用
          session.socket = null
        }
        
        // 确保删除会话
        this.sessions.delete(sessionId)
      }
      
      log.info(`会话 ${sessionId} 的资源已释放`)
      return true
    } catch (error) {
      log.error(`释放会话 ${sessionId} 资源失败`, error)
      return false
    }
  }

  /**
   * 打开SFTP会话并创建SFTP浏览器标签页
   * @param {string} id - 连接ID
   * @returns {Promise<boolean>} 是否成功
   */
  async openSftp(id) {
    try {
      // 确保WebSocket已连接
      if (!this.isOpen) {
        console.error('WebSocket未连接，无法创建SFTP会话');
        return false;
      }

      // 创建SFTP会话
      const success = await this.sftpService.createSftpSession(id);
      
      if (!success) {
        console.error('创建SFTP会话失败');
        return false;
      }

      // 导入tab store
      const { useTabStore } = await import('@/store/tab');
      const tabStore = useTabStore();
      
      // 打开SFTP浏览器标签页
      const tabIndex = await tabStore.addSftpBrowser(id);
      
      if (tabIndex === -1) {
        console.error('打开SFTP浏览器标签页失败');
        // 关闭SFTP会话，避免资源泄漏
        this.sftpService.closeSftpSession(id);
        return false;
      }
      
      return true;
    } catch (error) {
      console.error('打开SFTP会话失败:', error);
      return false;
    }
  }

  // 添加新方法，封装创建新会话的逻辑
  async _createNewSession(connection) {
    // 生成一个唯一的会话ID
    const sessionId = this._generateSessionId();
    log.info(`创建新SSH会话: ${sessionId}, 地址: ${connection.host}:${connection.port}`);
    
    // 先尝试IPv4连接
    try {
      log.info(`尝试使用IPv4连接: ${this.ipv4Url}`);
      return await this._createSessionWithUrl(this.ipv4Url, sessionId, connection);
    } catch (ipv4Error) {
      log.warn(`IPv4连接失败: ${ipv4Error.message}，尝试IPv6连接`);
      
      // 如果IPv4失败，尝试IPv6
      try {
        // 释放之前可能创建的资源
        this.releaseResources(sessionId);
        
        // 等待一段时间确保连接完全关闭
        await new Promise(resolve => setTimeout(resolve, 500));
        
        log.info(`尝试使用IPv6连接: ${this.ipv6Url}`);
        return await this._createSessionWithUrl(this.ipv6Url, sessionId, connection);
      } catch (ipv6Error) {
        log.error(`IPv6连接也失败: ${ipv6Error.message}`);
        ElMessage.error(`SSH连接失败: 尝试IPv4和IPv6连接均失败`);
        throw new Error(`SSH连接失败: IPv4(${ipv4Error.message}) 和 IPv6(${ipv6Error.message})`);
      }
    }
  }
}

// 创建单例
const sshService = new SSHService()

export default sshService

/**
 * SFTP文件传输功能实现
 * 负责处理SFTP文件列表、上传、下载等操作
 */
class SFTPService {
  constructor(sshService) {
    this.sshService = sshService;
    this.activeSftpSessions = new Map(); // 存储活动的SFTP会话
    this.fileOperations = new Map(); // 存储文件操作任务
    this.operationId = 0; // 操作ID计数器
    log.info('SFTP服务初始化完成');
  }
  
  /**
   * 创建SFTP会话
   * @param {string} sessionId - SSH会话ID
   * @returns {Promise<string>} - SFTP会话ID (与SSH会话ID相同)
   */
  async createSftpSession(sessionId) {
    if (!sessionId) {
      throw new Error('创建SFTP会话失败: 缺少会话ID');
    }
    
    // 通过终端ID获取实际的SSH会话ID (修复会话ID不匹配问题)
    let sshSessionId = sessionId;
    
    // 检查是否是终端ID而不是SSH会话ID
    if (!sessionId.startsWith('ssh_') && this.sshService.sessions.size > 0) {
      // 尝试从连接终端ID关联到SSH会话ID
      for (const [id, session] of this.sshService.sessions.entries()) {
        // 可能的终端ID和SSH会话ID的映射关系
        if (session.terminalId && session.terminalId === sessionId) {
          sshSessionId = id;
          console.log(`找到终端ID ${sessionId} 对应的SSH会话ID: ${sshSessionId}`);
          break;
        }
      }
      
      // 如果仍然找不到，可能需要使用其他策略
      if (sshSessionId === sessionId) {
        // 没有找到映射，如果只有一个会话，可以尝试使用那个
        if (this.sshService.sessions.size === 1) {
          sshSessionId = Array.from(this.sshService.sessions.keys())[0];
          console.log(`未找到终端ID ${sessionId} 的映射，但只有一个SSH会话，使用: ${sshSessionId}`);
        } else {
          console.error(`找不到终端ID ${sessionId} 对应的SSH会话ID`);
        }
      }
    }
    
    // 检查SSH会话是否存在
    if (!this.sshService.sessions.has(sshSessionId)) {
      console.error(`创建SFTP会话失败: SSH会话 ${sshSessionId} 不存在`);
      console.log('可用的SSH会话:', Array.from(this.sshService.sessions.keys()));
      throw new Error(`创建SFTP会话失败: SSH会话 ${sshSessionId} 不存在`);
    }
    
    // 检查是否已存在SFTP会话
    if (this.activeSftpSessions.has(sessionId)) {
      log.info(`SFTP会话 ${sessionId} 已存在，重用现有会话`);
      return sessionId;
    }
    
    try {
      const session = this.sshService.sessions.get(sshSessionId);
      
      // 发送SFTP初始化请求
      if (session.socket && session.socket.readyState === WebSocket.OPEN) {
        return new Promise((resolve, reject) => {
          // 设置超时处理
          const timeout = setTimeout(() => {
            reject(new Error('SFTP初始化超时'));
          }, 10000);
          
          // 一次性消息处理器，用于接收SFTP初始化响应
          const handleSftpInitResponse = (event) => {
            try {
              const message = JSON.parse(event.data);
              
              // 只处理与此会话相关的消息
              if (message.data && message.data.sessionId === sshSessionId) {
                if (message.type === 'sftp_ready') {
                  // 移除消息监听器
                  session.socket.removeEventListener('message', handleSftpInitResponse);
                  clearTimeout(timeout);
                  
                  // 获取SSH会话中的连接信息
                  const connectionInfo = session.connectionInfo || {};
                  
                  // 创建SFTP会话记录
                  this.activeSftpSessions.set(sessionId, {
                    id: sessionId,
                    sshSessionId: sshSessionId, // 保存SSH会话ID
                    currentPath: message.data.path || '/',
                    isActive: true,
                    createdAt: new Date(),
                    // 保存连接信息
                    host: connectionInfo.host,
                    username: connectionInfo.username,
                    port: connectionInfo.port
                  });
                  
                  log.info(`SFTP会话 ${sessionId} 创建成功，初始路径: ${message.data.path || '/'}`);
                  resolve(sessionId);
                } else if (message.type === 'error' && message.data.source === 'sftp') {
                  // 处理SFTP初始化错误
                  session.socket.removeEventListener('message', handleSftpInitResponse);
                  clearTimeout(timeout);
                  reject(new Error(`SFTP初始化失败: ${message.data.message}`));
                }
              }
            } catch (error) {
              log.error('处理SFTP初始化响应失败:', error);
            }
          };
          
          // 添加消息监听器
          session.socket.addEventListener('message', handleSftpInitResponse);
          
          // 发送SFTP初始化请求
          log.info(`发送SFTP初始化请求: ${sshSessionId}`);
          session.socket.send(JSON.stringify({
            type: 'sftp_init',
            data: {
              sessionId: sshSessionId
            }
          }));
        });
      } else {
        throw new Error(`创建SFTP会话失败: WebSocket连接未就绪，当前状态: ${session.socket ? session.socket.readyState : 'null'}`);
      }
    } catch (error) {
      log.error(`创建SFTP会话失败: ${error.message}`, error);
      throw error;
    }
  }
  
  /**
   * 关闭SFTP会话
   * @param {string} sessionId - SFTP会话ID
   * @returns {Promise<boolean>} - 是否成功关闭
   */
  async closeSftpSession(sessionId) {
    if (!sessionId) {
      log.error('关闭SFTP会话失败: 未提供会话ID');
      return false;
    }
    
    if (!this.activeSftpSessions.has(sessionId)) {
      log.warn(`SFTP会话 ${sessionId} 不存在或已关闭`);
      return true;
    }
    
    try {
      // 获取SFTP会话
      const sftpSession = this.activeSftpSessions.get(sessionId);
      const sshSessionId = sftpSession.sshSessionId || sessionId;
      
      // 检查SSH会话是否存在
      if (!this.sshService.sessions.has(sshSessionId)) {
        log.warn(`关联的SSH会话 ${sshSessionId} 不存在，直接清理SFTP会话`);
        this.activeSftpSessions.delete(sessionId);
        return true;
      }
      
      const session = this.sshService.sessions.get(sshSessionId);
      
      // 发送SFTP关闭请求
      if (session.socket && session.socket.readyState === WebSocket.OPEN) {
        session.socket.send(JSON.stringify({
          type: 'sftp_close',
          data: {
            sessionId: sshSessionId
          }
        }));
      }
      
      // 无论服务器是否响应，都清理本地会话
      this.activeSftpSessions.delete(sessionId);
      log.info(`SFTP会话 ${sessionId} 已关闭`);
      
      return true;
    } catch (error) {
      log.error(`关闭SFTP会话失败: ${error.message}`, error);
      return false;
    }
  }
  
  /**
   * 列出目录内容
   * @param {string} sessionId - SFTP会话ID
   * @param {string} path - 目录路径
   * @returns {Promise<Array>} - 文件列表
   */
  async listDirectory(sessionId, path = '.') {
    await this._ensureSftpSession(sessionId);
    
    return new Promise((resolve, reject) => {
      const operationId = this._nextOperationId();
      
      // 获取SFTP会话
      const sftpSession = this.activeSftpSessions.get(sessionId);
      if (!sftpSession) {
        reject(new Error('SFTP会话不存在'));
        return;
      }
      
      // 使用SSH会话ID
      const sshSessionId = sftpSession.sshSessionId || sessionId;
      // 获取SSH会话
      const session = this.sshService.sessions.get(sshSessionId);
      
      if (!session) {
        reject(new Error(`SSH会话 ${sshSessionId} 不存在`));
        return;
      }
      
      // 设置操作超时
      const timeout = setTimeout(() => {
        this.fileOperations.delete(operationId);
        reject(new Error('列出目录超时'));
      }, 30000);
      
      // 保存操作回调
      this.fileOperations.set(operationId, {
        resolve: (data) => {
          clearTimeout(timeout);
          
          // 更新当前路径
          if (this.activeSftpSessions.has(sessionId)) {
            const sftpSession = this.activeSftpSessions.get(sessionId);
            // 只有当请求的是绝对路径时才更新当前路径
            if (path.startsWith('/')) {
              sftpSession.currentPath = path;
            }
          }
          
          resolve(data);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
        type: 'list'
      });
      
      // 发送列目录请求
      if (session.socket && session.socket.readyState === WebSocket.OPEN) {
        session.socket.send(JSON.stringify({
          type: 'sftp_list',
          data: {
            sessionId: sshSessionId,
            path,
            operationId
          }
        }));
      } else {
        clearTimeout(timeout);
        this.fileOperations.delete(operationId);
        reject(new Error('WebSocket连接未就绪'));
      }
    });
  }
  
  /**
   * 上传文件
   * @param {string} sessionId - SFTP会话ID
   * @param {File} file - 文件对象
   * @param {string} remotePath - 远程路径
   * @param {function} progressCallback - 进度回调
   * @returns {Promise<Object>} - 上传结果
   */
  async uploadFile(sessionId, file, remotePath, progressCallback) {
    await this._ensureSftpSession(sessionId);
    
    return new Promise((resolve, reject) => {
      const operationId = this._nextOperationId();
      
      try {
        // 获取SSH会话
        const { sshSessionId, session } = this._getSSHSession(sessionId);
        
        // 设置操作超时
        const timeout = setTimeout(() => {
          this.fileOperations.delete(operationId);
          reject(new Error('文件上传超时'));
        }, 60 * 1000); // 1分钟超时
        
        // 标记是否自动完成
        let autoCompletedFlag = false;
        
        // 保存操作回调
        this.fileOperations.set(operationId, {
          resolve: (data) => {
            clearTimeout(timeout);
            // 如果设置了自动完成标记，则已经resolve了
            if (!autoCompletedFlag) {
              resolve(data);
            }
          },
          reject: (error) => {
            clearTimeout(timeout);
            // 如果设置了自动完成标记，则已经resolve了
            if (!autoCompletedFlag) {
              reject(error);
            }
          },
          progress: (progress) => {
            if (progressCallback && typeof progressCallback === 'function') {
              progressCallback(progress);
              
              // 收到100%进度时，立即完成
              if (progress === 100 && !autoCompletedFlag) {
                autoCompletedFlag = true;
                clearTimeout(timeout);
                resolve({ success: true, message: '上传完成' });
              }
            }
          },
          type: 'upload'
        });
        
        // 读取文件内容
        const reader = new FileReader();
        reader.onload = (event) => {
          const fileContent = event.target.result;
          
          // 发送上传请求
          if (session.socket && session.socket.readyState === WebSocket.OPEN) {
            session.socket.send(JSON.stringify({
              type: 'sftp_upload',
              data: {
                sessionId: sshSessionId,
                filename: file.name,
                path: remotePath,
                size: file.size,
                content: fileContent,
                operationId
              }
            }));
          } else {
            clearTimeout(timeout);
            this.fileOperations.delete(operationId);
            reject(new Error('WebSocket连接未就绪'));
          }
        };
        
        reader.onerror = (error) => {
          clearTimeout(timeout);
          this.fileOperations.delete(operationId);
          reject(new Error(`读取文件失败: ${error.message || '未知错误'}`));
        };
        
        // 开始读取文件
        reader.readAsDataURL(file); // 使用base64编码
      } catch (error) {
        this.fileOperations.delete(operationId);
        reject(error);
      }
    });
  }
  
  /**
   * 下载文件
   * @param {string} sessionId - SFTP会话ID
   * @param {string} remotePath - 远程文件路径
   * @param {function} progressCallback - 进度回调函数
   * @returns {Promise<Blob>} - 文件Blob对象
   */
  async downloadFile(sessionId, remotePath, progressCallback) {
    await this._ensureSftpSession(sessionId);
    
    return new Promise((resolve, reject) => {
      const operationId = this._nextOperationId();
      
      try {
        // 获取SSH会话
        const { sshSessionId, session } = this._getSSHSession(sessionId);
        
        // 设置操作超时
        const timeout = setTimeout(() => {
                    this.fileOperations.delete(operationId);
          reject(new Error('文件下载超时'));
        }, 10 * 60 * 1000); // 10分钟超时
        
        // 保存操作回调
        this.fileOperations.set(operationId, {
          resolve: (data) => {
            clearTimeout(timeout);
            
            // 将base64数据转换为Blob
            try {
              const byteString = atob(data.content.split(',')[1]);
              const mimeType = data.mimeType || 'application/octet-stream';
              
              const arrayBuffer = new ArrayBuffer(byteString.length);
              const uint8Array = new Uint8Array(arrayBuffer);
              
              for (let i = 0; i < byteString.length; i++) {
                uint8Array[i] = byteString.charCodeAt(i);
              }
              
              const blob = new Blob([arrayBuffer], { type: mimeType });
              resolve(blob);
            } catch (error) {
              reject(new Error(`处理下载数据失败: ${error.message}`));
            }
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
          progress: progressCallback,
          type: 'download'
        });
        
        // 发送下载请求
        if (session.socket && session.socket.readyState === WebSocket.OPEN) {
          session.socket.send(JSON.stringify({
            type: 'sftp_download',
            data: {
              sessionId: sshSessionId,
              path: remotePath,
              operationId
            }
          }));
        } else {
          clearTimeout(timeout);
          this.fileOperations.delete(operationId);
          reject(new Error('WebSocket连接未就绪'));
        }
      } catch (error) {
        this.fileOperations.delete(operationId);
        reject(error);
      }
    });
  }
  
  /**
   * 获取文件内容
   * @param {string} sessionId - SFTP会话ID
   * @param {string} remotePath - 远程文件路径
   * @returns {Promise<string>} - 文件内容字符串
   */
  async getFileContent(sessionId, remotePath) {
    await this._ensureSftpSession(sessionId);
    
    try {
      // 获取文件为Blob
      const fileBlob = await this.downloadFile(sessionId, remotePath, () => {});
      
      // 读取Blob内容为文本
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(new Error('读取文件内容失败'));
        reader.readAsText(fileBlob);
      });
    } catch (error) {
      console.error(`获取文件内容失败 ${remotePath}:`, error);
      throw new Error(`获取文件内容失败: ${error.message || '未知错误'}`);
    }
  }
  
  /**
   * 保存文件内容
   * @param {string} sessionId - SFTP会话ID
   * @param {string} remotePath - 远程文件路径
   * @param {string} content - 文件内容
   * @returns {Promise<boolean>} - 是否保存成功
   */
  async saveFileContent(sessionId, remotePath, content) {
    await this._ensureSftpSession(sessionId);
    
    try {
      // 创建一个临时Blob对象
      const blob = new Blob([content], { type: 'text/plain' });
      
      // 创建临时File对象
      const file = new File([blob], remotePath.split('/').pop(), { type: 'text/plain' });
      
      // 使用uploadFile方法上传文件
      await this.uploadFile(sessionId, file, remotePath, () => {});
      
      return true;
    } catch (error) {
      console.error(`保存文件内容失败 ${remotePath}:`, error);
      throw new Error(`保存文件内容失败: ${error.message || '未知错误'}`);
    }
  }
  
  /**
   * 创建目录
   * @param {string} sessionId - SFTP会话ID
   * @param {string} path - 目录路径
   * @returns {Promise<boolean>} - 是否创建成功
   */
  async createDirectory(sessionId, path) {
    await this._ensureSftpSession(sessionId);
    
    return new Promise((resolve, reject) => {
      const operationId = this._nextOperationId();
      
      try {
        // 获取SSH会话
        const { sshSessionId, session } = this._getSSHSession(sessionId);
        
        // 设置操作超时
        const timeout = setTimeout(() => {
          this.fileOperations.delete(operationId);
          reject(new Error('创建文件夹超时'));
        }, 30000);
        
        // 保存操作回调
        this.fileOperations.set(operationId, {
          resolve: (data) => {
            clearTimeout(timeout);
            resolve(data);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
          type: 'mkdir'
        });
        
        // 发送创建文件夹请求
        if (session.socket && session.socket.readyState === WebSocket.OPEN) {
          session.socket.send(JSON.stringify({
            type: 'sftp_mkdir',
            data: {
              sessionId: sshSessionId,
              path,
              operationId
            }
          }));
        } else {
          clearTimeout(timeout);
          this.fileOperations.delete(operationId);
          reject(new Error('WebSocket连接未就绪'));
        }
      } catch (error) {
        this.fileOperations.delete(operationId);
        reject(error);
      }
    });
  }
  
  /**
   * 删除文件或文件夹
   * @param {string} sessionId - SFTP会话ID
   * @param {string} path - 文件或文件夹路径
   * @param {boolean} isDirectory - 是否是文件夹
   * @returns {Promise<Object>} - 删除结果
   */
  async delete(sessionId, path, isDirectory) {
    await this._ensureSftpSession(sessionId);
    
    return new Promise((resolve, reject) => {
      const operationId = this._nextOperationId();
      
      try {
        // 获取SSH会话
        const { sshSessionId, session } = this._getSSHSession(sessionId);
        
        // 设置操作超时
        const timeout = setTimeout(() => {
          this.fileOperations.delete(operationId);
          reject(new Error('删除操作超时'));
        }, 30000);
        
        // 保存操作回调
        this.fileOperations.set(operationId, {
          resolve: (data) => {
            clearTimeout(timeout);
            resolve(data);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
          type: 'delete'
        });
        
        // 发送删除请求
        if (session.socket && session.socket.readyState === WebSocket.OPEN) {
          session.socket.send(JSON.stringify({
            type: 'sftp_delete',
            data: {
              sessionId: sshSessionId,
              path,
              isDirectory,
              operationId
            }
          }));
        } else {
          clearTimeout(timeout);
          this.fileOperations.delete(operationId);
          reject(new Error('WebSocket连接未就绪'));
        }
      } catch (error) {
        this.fileOperations.delete(operationId);
        reject(error);
      }
    });
  }
  
  /**
   * 重命名文件或文件夹
   * @param {string} sessionId - SFTP会话ID
   * @param {string} oldPath - 原路径
   * @param {string} newPath - 新路径
   * @returns {Promise<Object>} - 重命名结果
   */
  async rename(sessionId, oldPath, newPath) {
    await this._ensureSftpSession(sessionId);
    
    return new Promise((resolve, reject) => {
      const operationId = this._nextOperationId();
      
      try {
        // 获取SSH会话
        const { sshSessionId, session } = this._getSSHSession(sessionId);
        
        // 设置操作超时
        const timeout = setTimeout(() => {
          this.fileOperations.delete(operationId);
          reject(new Error('重命名操作超时'));
        }, 30000);
        
        // 保存操作回调
        this.fileOperations.set(operationId, {
          resolve: (data) => {
            clearTimeout(timeout);
            resolve(data);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
          type: 'rename'
        });
        
        // 发送重命名请求
        if (session.socket && session.socket.readyState === WebSocket.OPEN) {
          session.socket.send(JSON.stringify({
            type: 'sftp_rename',
            data: {
              sessionId: sshSessionId,
              oldPath,
              newPath,
              operationId
            }
          }));
        } else {
          clearTimeout(timeout);
          this.fileOperations.delete(operationId);
          reject(new Error('WebSocket连接未就绪'));
        }
      } catch (error) {
        this.fileOperations.delete(operationId);
        reject(error);
      }
    });
  }
  
  /**
   * 确保SFTP会话已创建
   * @param {string} sessionId - 会话ID
   * @private
   */
  async _ensureSftpSession(sessionId) {
    if (!sessionId) {
      throw new Error('无效的会话ID');
    }
    
    // 如果SFTP会话不存在，创建新会话
    if (!this.activeSftpSessions.has(sessionId)) {
      await this.createSftpSession(sessionId);
    }
  }
  
  /**
   * 获取SSH会话ID
   * @param {string} sessionId - SFTP会话ID
   * @returns {object} - 包含SSH会话ID和会话的对象
   * @private
   */
  _getSSHSession(sessionId) {
    // 获取SFTP会话
    const sftpSession = this.activeSftpSessions.get(sessionId);
    if (!sftpSession) {
      throw new Error('SFTP会话不存在');
    }
    
    // 使用SSH会话ID
    const sshSessionId = sftpSession.sshSessionId || sessionId;
    
    // 获取SSH会话
    const session = this.sshService.sessions.get(sshSessionId);
    if (!session) {
      throw new Error(`SSH会话 ${sshSessionId} 不存在`);
    }
    
    return { sshSessionId, session };
  }
  
  /**
   * 生成下一个操作ID
   * @returns {number} - 操作ID
   * @private
   */
  _nextOperationId() {
    return ++this.operationId;
  }
  
  /**
   * 处理来自服务器的SFTP消息
   * @param {Object} message - 消息对象
   */
  handleSftpMessage(message) {
    if (!message || !message.data) {
      log.warn('收到无效的SFTP消息:', message);
      return;
    }
    
    // 特殊处理SFTP会话关闭确认消息
    if (message.type === 'sftp_success' && message.data && message.data.message && 
        message.data.message.includes('SFTP会话已关闭') && !message.data.operationId) {
      console.log(`[SFTP服务] 接收到SFTP会话关闭确认消息`);
      return; // 无需产生警告，静默处理
    }
    
    if (!message.data.operationId) {
      log.warn('收到无效的SFTP消息:', message);
      return;
    }
    
    const { operationId } = message.data;
    
    // 添加消息类型的日志
    log.debug(`收到SFTP消息: 类型=${message.type}, 操作ID=${operationId}`);
    console.log(`[SFTP服务] 收到消息: 类型=${message.type}, 操作ID=${operationId}, 详情=`, JSON.stringify(message.data).substring(0, 200));
    
    // 查找对应的操作
    if (!this.fileOperations.has(operationId)) {
      log.warn(`未找到SFTP操作: ${operationId}, 消息类型: ${message.type}`);
      console.warn(`[SFTP服务] 未找到操作: ${operationId}, 消息类型: ${message.type}`);
      console.warn(`[SFTP服务] 当前操作列表:`, Array.from(this.fileOperations.keys()));
      return;
    }
    
    const operation = this.fileOperations.get(operationId);
    log.debug(`找到对应操作: 类型=${operation.type}, 操作ID=${operationId}`);
    console.log(`[SFTP服务] 找到操作: 类型=${operation.type}, 操作ID=${operationId}`);
    
    switch (message.type) {
      case 'sftp_progress':
        // 处理进度回调
        if (operation.progress && typeof operation.progress === 'function') {
          log.debug(`进度更新: ${message.data.progress}%`);
          operation.progress(message.data.progress);
        }
        break;
        
      case 'sftp_success':
        // 处理成功回调
        log.debug(`操作成功: 类型=${operation.type}, 操作ID=${operationId}`);
        console.log(`[SFTP服务] 操作成功: 类型=${operation.type}, 操作ID=${operationId}`);
        
        if (operation.resolve && typeof operation.resolve === 'function') {
          // 确保文件列表操作返回的是数组
          if (operation.type === 'list') {
            // 确保返回的文件列表是数组
            let filesList = message.data.files || [];
            
            // 记录日志
            log.debug(`收到文件列表: 类型=${typeof filesList}, 长度=${Array.isArray(filesList) ? filesList.length : 'N/A'}`);
            
            // 如果不是数组，转换为空数组
            if (!Array.isArray(filesList)) {
              log.warn(`文件列表不是数组，而是 ${typeof filesList}，将转换为空数组`);
              filesList = [];
            }
            
            operation.resolve(filesList);
          } else if (operation.type === 'upload') {
            log.debug(`文件上传成功: ${message.data.message || '无消息'}`);
            
            try {
              // 检查操作是否已经自动完成
              if (operation.autoCompleted) {
                // 操作已经自动完成，不需要再处理
                log.debug('文件上传操作已自动完成，跳过处理');
              } else {
                // 直接resolve成功消息
                operation.resolve(message.data);
              }
            } catch (error) {
              log.error(`调用resolve回调时出错: ${error.message}`);
            }
            
            // 操作完成，从映射中删除
            this.fileOperations.delete(operationId);
          } else {
            log.debug(`其他操作成功: 类型=${operation.type}`);
            try {
              operation.resolve(message.data);
            } catch (error) {
              log.error(`调用resolve回调时出错: ${error.message}`);
            }
          }
          
          // 从映射中删除操作
          this.fileOperations.delete(operationId);
          log.debug(`操作已从映射中删除: ${operationId}`);
          console.log(`[SFTP服务] 操作已从映射中删除: ${operationId}`);
        } else {
          log.warn(`操作没有resolve回调: 类型=${operation.type}, 操作ID=${operationId}`);
          console.warn(`[SFTP服务] 操作没有resolve回调: 类型=${operation.type}, 操作ID=${operationId}`);
        }
        break;
        
      case 'sftp_error':
        // 处理错误回调
        log.error(`SFTP操作错误: 类型=${operation.type}, 错误=${message.data.message || '未知SFTP错误'}`);
        console.error(`[SFTP服务] 操作错误: 类型=${operation.type}, 错误=${message.data.message || '未知SFTP错误'}`);
        
        if (operation.reject && typeof operation.reject === 'function') {
          // 对于列表操作，如果出错返回空数组
          if (operation.type === 'list') {
            log.warn(`列出目录失败: ${message.data.message || '未知SFTP错误'}，返回空数组`);
            operation.resolve([]);
          } else {
            try {
              operation.reject(new Error(message.data.message || '未知SFTP错误'));
              console.log(`[SFTP服务] 成功调用reject回调`);
            } catch (error) {
              console.error(`[SFTP服务] 调用reject回调时出错:`, error);
              log.error(`调用reject回调时出错: ${error.message}`);
            }
          }
          this.fileOperations.delete(operationId);
          log.debug(`操作已从映射中删除(错误): ${operationId}`);
          console.log(`[SFTP服务] 操作已从映射中删除(错误): ${operationId}`);
        }
        break;
        
      default:
        log.warn(`未知的SFTP消息类型: ${message.type}`);
        console.warn(`[SFTP服务] 未知的消息类型: ${message.type}`);
        break;
    }
  }

  /**
   * 执行SSH命令
   * @param {string} sessionId - SFTP会话ID
   * @param {string} command - 要执行的命令
   * @returns {Promise<Object>} - 执行结果
   */
  async execSshCommand(sessionId, command) {
    await this._ensureSftpSession(sessionId);
    
    return new Promise((resolve, reject) => {
      const operationId = this._nextOperationId();
      
      try {
        // 获取SSH会话
        const { sshSessionId, session } = this._getSSHSession(sessionId);
        
        // 设置操作超时
        const timeout = setTimeout(() => {
          this.fileOperations.delete(operationId);
          reject(new Error('命令执行超时'));
        }, 30000);
        
        // 保存操作回调
        this.fileOperations.set(operationId, {
          resolve: (data) => {
            clearTimeout(timeout);
            resolve(data);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
          type: 'exec'
        });
        
        // 发送命令执行请求
        if (session.socket && session.socket.readyState === WebSocket.OPEN) {
          session.socket.send(JSON.stringify({
            type: 'ssh_exec',
            data: {
              sessionId: sshSessionId,
              command,
              operationId
            }
          }));
        } else {
          clearTimeout(timeout);
          this.fileOperations.delete(operationId);
          reject(new Error('WebSocket连接未就绪'));
        }
      } catch (error) {
        this.fileOperations.delete(operationId);
        reject(error);
      }
    });
  }
  
  /**
   * 快速删除文件夹（直接使用rm -rf命令）
   * @param {string} sessionId - SFTP会话ID
   * @param {string} path - 文件夹路径
   * @returns {Promise<Object>} - 删除结果
   */
  async fastDeleteDirectory(sessionId, path) {
    // 使用rm -rf命令删除目录，这比递归列出和删除更高效
    // 注意：这是一个危险命令，确保路径是有效的
    if (!path || path === '/' || path === '~') {
      throw new Error('不允许删除根目录或home目录');
    }
    
    // 确保路径是绝对路径并转义特殊字符
    const escapedPath = path.replace(/'/g, "'\\''");
    const command = `rm -rf '${escapedPath}'`;
    
    try {
      await this.execSshCommand(sessionId, command);
      return { success: true, message: `已使用快速删除方式删除目录: ${path}` };
    } catch (error) {
      throw new Error(`快速删除目录失败: ${error.message}`);
    }
  }
}

// 创建SFTP服务单例
const sftpService = new SFTPService(sshService);

// 扩展SSH服务，添加SFTP处理器
SSHService.prototype.handleSftpMessages = function(message) {
  // 处理来自服务器的SFTP相关消息
  if (message && message.type && message.type.startsWith('sftp_')) {
    // 特殊处理sftp_ready类型消息
    if (message.type === 'sftp_ready') {
      log.debug('SSH服务捕获到SFTP就绪消息');
      return true; // 消息已处理
    }
    sftpService.handleSftpMessage(message);
    return true; // 消息已处理
  }
  return false; // 不是SFTP消息
};

// 在原有SSH服务的_setupSocketEvents方法中添加SFTP消息处理
const originalSetupSocketEvents = SSHService.prototype._setupSocketEvents;
SSHService.prototype._setupSocketEvents = function(socket, sessionId, connection, connectionState) {
  const promise = originalSetupSocketEvents.call(this, socket, sessionId, connection, connectionState);
  
  // 在WebSocket消息处理中添加SFTP处理
  const originalOnMessage = socket.onmessage;
  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      
      // 记录所有SFTP相关消息，帮助调试
      if (message && message.type && message.type.startsWith('sftp_')) {
        log.debug(`收到SFTP WebSocket消息: 类型=${message.type}, 会话ID=${sessionId}, 操作ID=${message.data?.operationId || 'N/A'}`);
        
        // 如果是sftp_success，添加额外的日志
        if (message.type === 'sftp_success') {
          console.log(`[SSH服务] 收到文件上传成功消息: 操作ID=${message.data?.operationId}, 会话ID=${sessionId}`);
          log.info(`文件操作成功: 类型=${message.type}, 操作ID=${message.data?.operationId}, 消息=${message.data?.message || '无消息'}`);
        }
        
        // 如果是SFTP消息则交给SFTP处理器处理
        if (this.handleSftpMessages(message)) {
          console.log(`[SSH服务] SFTP消息已处理: 类型=${message.type}`);
          return; // 如果已被处理则跳过原有处理
        } else {
          console.warn(`[SSH服务] SFTP消息未被处理: 类型=${message.type}`);
        }
      }
    } catch (error) {
      // 解析失败，仍然尝试原有处理
      console.error(`[SSH服务] 解析WebSocket消息失败:`, error);
      log.error(`解析WebSocket消息失败: ${error.message}`);
    }
    
    // 调用原有的onmessage处理
    if (originalOnMessage) {
      originalOnMessage(event);
    }
  };
  
  return promise;
};

export { sftpService };

// 1. 在SSH服务中实现更可靠的双向会话映射
class SSHSessionManager {
  constructor() {
    this.terminalToSSH = new Map();
    this.sshToTerminal = new Map();
    // 从本地存储恢复映射关系
    this.loadMappings();
  }
  
  // 设置映射关系
  setMapping(terminalId, sshSessionId) {
    this.terminalToSSH.set(terminalId, sshSessionId);
    this.sshToTerminal.set(sshSessionId, terminalId);
    this.saveMappings();
    
    log.info(`已建立会话映射: 终端 ${terminalId} <=> SSH ${sshSessionId}`);
  }
  
  // 根据SSH会话ID获取终端ID
  getTerminalId(sshSessionId) {
    return this.sshToTerminal.get(sshSessionId);
  }
  
  // 根据终端ID获取SSH会话ID
  getSSHSessionId(terminalId) {
    return this.terminalToSSH.get(terminalId);
  }
  
  // 保存映射到本地存储
  saveMappings() {
    try {
      const mappings = {};
      for (const [termId, sshId] of this.terminalToSSH.entries()) {
        mappings[termId] = sshId;
      }
      localStorage.setItem('ssh_terminal_mappings', JSON.stringify(mappings));
    } catch (e) {
      console.warn('保存会话映射失败', e);
    }
  }
  
  // 从本地存储加载映射
  loadMappings() {
    try {
      const saved = localStorage.getItem('ssh_terminal_mappings');
      if (saved) {
        const mappings = JSON.parse(saved);
        for (const [termId, sshId] of Object.entries(mappings)) {
          this.terminalToSSH.set(termId, sshId);
          this.sshToTerminal.set(sshId, termId);
        }
      }
    } catch (e) {
      console.warn('加载会话映射失败', e);
    }
  }
}