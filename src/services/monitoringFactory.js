/**
 * 监控服务工厂
 * 负责创建和管理每个终端的独立监控实例
 */

import { reactive } from 'vue'
import { ElMessage } from 'element-plus'
import { wsServerConfig } from '../config/app-config'
import log from './log'
import axios from 'axios'

/**
 * 监控实例类
 * 每个终端拥有独立的监控实例
 */
class MonitoringInstance {
  constructor(terminalId) {
    this.terminalId = terminalId;
    this.state = reactive({
      connected: false,
      connecting: false,
      sessionId: null,
      error: null,
      stats: {
        messagesReceived: 0,
        messagesSent: 0
      },
      lastActivity: null,
      targetHost: null, // 存储远程服务器地址
      serverHost: null,  // 项目服务器地址
      systemInfo: null, // 存储最新的系统信息
      subscribed: false, // 是否已订阅目标服务器
      monitorData: {
        cpu: { usage: 0, cores: 0, model: '' },
        memory: { total: 0, used: 0, free: 0, usedPercentage: 0 },
        swap: { total: 0, used: 0, free: 0, usedPercentage: 0 },
        disk: { total: 0, used: 0, free: 0, usedPercentage: 0 },
        network: {},
        os: {}
      }
    });
    
    this.ws = null;
    this.messageListeners = new Map();
    this.reconnectTimeout = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 3000; // 3秒
    this.keepAliveInterval = null;
    this.keepAliveTimeout = 30000; // 30秒
    
    // 获取配置中的端口
    const { port } = wsServerConfig;
    this.port = port;
    
    // 使用当前网页的服务器地址（项目服务器）
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    this.serverHost = host;
    this.serverPort = window.location.port || port;
  }
  
  // 构建WebSocket URL（重构版 - 专用前端监控通道）
  _buildWebSocketUrl(remoteHost) {
    // 使用协议
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

    // 保存远程主机地址
    if (remoteHost) {
      this.state.targetHost = remoteHost;
    }

    // 连接到专用前端监控WebSocket，移除type参数（后端已简化）
    const host = window.location.host; // 使用当前页面的host（包含端口）
    const params = new URLSearchParams({
      subscribe: remoteHost || 'unknown'
    });
    const proxyUrl = `${protocol}//${host}/monitor?${params.toString()}`;
    log.debug(`[终端${this.terminalId}] 监控WebSocket URL: ${proxyUrl}`);

    return proxyUrl;
  }
  
  /**
   * 连接到监控WebSocket
   * @param {string} remoteHost 远程主机地址
   * @returns {Promise<boolean>} 连接结果
   */
  async connect(remoteHost) {
    if (this.state.connected || this.state.connecting) {
      log.debug(`[终端${this.terminalId}] 监控服务已连接或正在连接中`);
      
      // 如果当前连接的目标主机就是要连接的主机，直接返回true
      if (this.state.targetHost === remoteHost) {
        return this.state.connected;
      }
      
      // 如果要连接的主机与当前连接的主机不同，先断开当前连接
      if (this.state.connected && this.state.targetHost !== remoteHost) {
        await this.disconnect();
      } else {
        return this.state.connected;
      }
    }
    
    try {
      this.state.connecting = true;
      this.state.error = null;
      
      // 构建WebSocket URL
      const url = this._buildWebSocketUrl(remoteHost);
      // 连接到监控WebSocket服务
      
      // 保存目标主机
      this.state.targetHost = remoteHost;
      
      // 设置连接超时
      const connectionTimeout = setTimeout(() => {
        if (this.state.connecting && !this.state.connected) {
          log.debug(`[终端${this.terminalId}] 监控服务连接超时`);
          this.state.connecting = false;
          this.state.error = '连接超时';
          
          // 发送全局错误事件，但不立即修改状态，避免后续可能的成功连接导致状态混乱
          window.dispatchEvent(new CustomEvent('monitoring-connection-timeout', {
            detail: {
              terminalId: this.terminalId,
              host: remoteHost,
              error: '连接超时'
            }
          }));
        }
      }, 10000);
      
      try {
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          clearTimeout(connectionTimeout);
          this.state.connecting = false;
          this.state.connected = true;
          this.state.error = null;

          log.info(`[终端${this.terminalId}] 监控连接已建立: ${remoteHost}`);

          // 初始化保活机制
          this._setupKeepAlive();

          // 发送订阅消息（URL参数已包含订阅信息，这里作为确认）
          setTimeout(() => {
            this._sendSubscribeMessage(remoteHost);
          }, 100);

          // 触发连接成功事件（用于内部状态管理）
          window.dispatchEvent(new CustomEvent('monitoring-connected', {
            detail: {
              terminalId: this.terminalId,
              hostAddress: remoteHost,
              success: true
            }
          }));
        };
        
        this.ws.onmessage = (event) => {
          this._handleMessage(event);
        };
        
        this.ws.onclose = (event) => {
          clearTimeout(connectionTimeout);
          log.debug(`[终端${this.terminalId}] WebSocket连接关闭: code=${event.code}, reason=${event.reason}, wasClean=${event.wasClean}`);

          // 避免重复处理，只在真正断开连接时更新状态
          if (this.state.connected) {
            this._handleClose(event);
          } else if (this.state.connecting) {
            this.state.connecting = false;
            this.state.error = `连接关闭 (code: ${event.code})`;
            log.debug(`[终端${this.terminalId}] 监控连接建立失败: 连接被关闭 (code: ${event.code}, reason: ${event.reason})`);
          }
        };
        
        this.ws.onerror = (error) => {
          clearTimeout(connectionTimeout);
          log.debug(`[终端${this.terminalId}] 监控WebSocket错误:`, error);
          log.debug(`[终端${this.terminalId}] WebSocket URL: ${url}`);
          log.debug(`[终端${this.terminalId}] WebSocket readyState: ${this.ws ? this.ws.readyState : 'null'}`);

          // 设置错误状态，但不立即更新连接状态，因为onclose事件会随后触发
          this.state.error = '连接错误';

          // 如果仍在连接中，则标记连接失败
          if (this.state.connecting) {
            this.state.connecting = false;
            log.debug(`[终端${this.terminalId}] 监控服务连接失败`);

            // 发送错误事件，但保留最终状态变更给onclose处理
            window.dispatchEvent(new CustomEvent('monitoring-connection-error', {
              detail: {
                terminalId: this.terminalId,
                host: remoteHost,
                error: error
              }
            }));
          }
        };
        
        return new Promise((resolve) => {
          // 连接结果处理
          const handleResult = (event) => {
            if (event.detail && event.detail.terminalId === this.terminalId) {
              // 移除事件监听
              window.removeEventListener('monitoring-connected', handleResult);
              window.removeEventListener('monitoring-connection-error', handleError);
              window.removeEventListener('monitoring-connection-timeout', handleError);
              
              resolve(true);
            }
          };
          
          // 错误处理
          const handleError = (event) => {
            if (event.detail && event.detail.terminalId === this.terminalId) {
              // 移除事件监听
              window.removeEventListener('monitoring-connected', handleResult);
              window.removeEventListener('monitoring-connection-error', handleError);
              window.removeEventListener('monitoring-connection-timeout', handleError);
              
              resolve(false);
            }
          };
          
          // 设置事件监听
          window.addEventListener('monitoring-connected', handleResult, { once: true });
          window.addEventListener('monitoring-connection-error', handleError, { once: true });
          window.addEventListener('monitoring-connection-timeout', handleError, { once: true });
          
          // 如果已经连接成功或失败，立即解析promise
          if (this.state.connected) {
            resolve(true);
          } else if (!this.state.connecting && this.state.error) {
            resolve(false);
          }
        });
      } catch (err) {
        clearTimeout(connectionTimeout);
        this.state.connecting = false;
        this.state.error = err.message || '连接失败';
        log.debug(`[终端${this.terminalId}] 创建监控WebSocket连接失败: ${err.message}`);
        return false;
      }
    } catch (error) {
      this.state.connecting = false;
      this.state.error = error.message || '连接失败';
      log.debug(`[终端${this.terminalId}] 连接到监控WebSocket服务失败: ${error.message}`);
      return false;
    }
  }
  
  /**
   * 断开与监控WebSocket的连接
   */
  disconnect() {
    if (!this.state.connected && !this.ws) {
      return;
    }
    
    log.debug(`[终端${this.terminalId}] 正在断开监控WebSocket连接`);

    // 如果已连接且有目标主机，发送取消订阅消息
    if (this.state.connected && this.state.targetHost && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this._sendUnsubscribeMessage(this.state.targetHost);
    }

    // 清除保活定时器
    this._clearKeepAlive();
    
    // 清除重连定时器
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    // 存储断开前的连接状态，用于触发事件
    const wasConnected = this.state.connected;
    const targetHost = this.state.targetHost;
    
    // 关闭WebSocket连接
    if (this.ws) {
      try {
        // 使用正常关闭代码1000
        this.ws.close(1000, "主动断开连接");
        log.debug(`[终端${this.terminalId}] 监控连接已成功断开`);
      } catch (error) {
        log.error(`[终端${this.terminalId}] 关闭监控WebSocket连接时出错:`, error);
      }
      this.ws = null;
    }
    
    this.state.connected = false;
    this.state.sessionId = null;

    // 重置状态
    this.state.connecting = false;
    this.state.lastActivity = null;
    
    // 清除保持连接的定时任务
    this._clearKeepAlive();
    
    // 只有在之前是连接状态时才触发状态变更事件
    if (wasConnected) {
      // 通知监控WebSocket已断开（主动断开）
      window.dispatchEvent(new CustomEvent('monitoring-status-change', {
        detail: {
          installed: false,
          available: false,
          host: targetHost,
          terminalId: this.terminalId,
          status: 'manually_disconnected',
          message: '监控连接已主动断开'
        }
      }));
    }
    
    // 重置目标主机
    this.state.targetHost = null;
  }
  
  /**
   * 发送消息到监控WebSocket
   * @param {Object} message 要发送的消息
   * @returns {boolean} 是否发送成功
   */
  sendMessage(message) {
    if (!this.state.connected || !this.ws) {
      log.error(`[终端${this.terminalId}] 发送监控消息失败: WebSocket未连接`);
      return false;
    }
    
    try {
      this.ws.send(JSON.stringify(message));
      this.state.stats.messagesSent++;
      this.state.lastActivity = new Date();
      return true;
    } catch (error) {
      log.error(`[终端${this.terminalId}] 发送监控消息失败:`, error);
      return false;
    }
  }
  
  /**
   * 发送ping消息以测试连接
   * @returns {boolean} 是否发送成功
   */
  sendPing() {
    return this.sendMessage({
      type: 'ping',
      payload: {
        timestamp: Date.now(),
        terminalId: this.terminalId
      }
    });
  }
  
  /**
   * 设置消息监听器
   * @param {string} type 消息类型
   * @param {Function} callback 回调函数
   * @returns {string} 监听器ID
   */
  addMessageListener(type, callback) {
    const id = `${type}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    if (!this.messageListeners.has(type)) {
      this.messageListeners.set(type, new Map());
    }
    
    this.messageListeners.get(type).set(id, callback);
    return id;
  }
  
  /**
   * 移除消息监听器
   * @param {string} type 消息类型
   * @param {string} id 监听器ID
   */
  removeMessageListener(type, id) {
    if (this.messageListeners.has(type)) {
      this.messageListeners.get(type).delete(id);
      
      if (this.messageListeners.get(type).size === 0) {
        this.messageListeners.delete(type);
      }
    }
  }
  
  /**
   * 处理接收到的消息
   * @private
   * @param {MessageEvent} event 消息事件
   */
  _handleMessage(event) {
    const currentTime = Date.now();
    let message;
    
    this.state.lastActivity = currentTime;
    this.state.stats.messagesReceived++;
    
    try {
      // 尝试解析JSON消息
      if (typeof event.data === 'string') {
        message = JSON.parse(event.data);
      } else {
        // 如果不是字符串，可能是二进制数据
        return;
      }
      
      // 添加接收时间戳
      if (!message.timestamp) {
        message.timestamp = currentTime;
      }
      
      // 提取消息类型
      const messageType = message.type || (message.data && message.data.type) || 'unknown';
      
      // 将服务器ID添加到消息中
      const serverId = this.state.targetHost;
      message.serverId = serverId;
      
      // 如果是系统状态或系统信息消息，更新全局数据存储
      if (
        messageType === 'system_stats' ||
        messageType === 'system-stats' ||
        messageType === 'system-info' ||
        (message.payload && (message.payload.cpu || message.payload.memory))
      ) {
        this._updateMonitorData(message);

        // 更新中央数据存储
        if (serverId) {
          monitoringFactory.updateServerData(serverId, message);
        }

        // 注意：不在这里触发状态变更事件
        // 状态变更只在收到特定的状态消息时触发
      }
      
      // 处理特殊消息类型
      if (message.type === 'pong') {
        // 心跳成功
        return;
      }

      if (message.type === 'session_created') {
        // 前端监控会话已创建
        this.state.sessionId = message.data.sessionId;
        return;
      }

      if (message.type === 'subscribe_ack') {
        // 订阅确认已收到
        this.state.subscribed = true;
        return;
      }

      if (message.type === 'unsubscribe_ack') {
        // 取消订阅确认已收到
        return;
      }

      if (message.type === 'identify_ack') {
        log.debug(`[终端${this.terminalId}] 标识确认已收到，目标主机: ${message.data?.targetHost}`);
        this.state.identified = true;
        return;
      }

      if (message.type === 'error') {
        log.error(`[终端${this.terminalId}] 监控服务错误: ${message.data?.message || '未知错误'}`);
        this.state.error = message.data?.message || '监控服务错误';
        return;
      }

      // 移除监控连接成功状态处理
      // 后端不再发送 monitoring_connected 消息
      // 监控状态完全基于 monitoring_status 消息

      // 处理监控断开状态
      if (message.type === 'monitoring_disconnected') {
        log.warn(`[终端${this.terminalId}] 监控连接断开: ${this.state.targetHost}`);

        // 触发监控状态更新事件（连接断开）
        window.dispatchEvent(new CustomEvent('monitoring-status-change', {
          detail: {
            installed: false,
            available: false,
            host: this.state.targetHost,
            terminalId: this.terminalId,
            status: 'disconnected',
            message: message.data?.message || '监控连接断开'
          }
        }));
        return;
      }

      // 处理监控状态信息
      if (message.type === 'monitoring_status') {
        const statusData = message.data;
        const isInstalled = statusData.status === 'installed';

        log.debug(`[终端${this.terminalId}] 收到监控状态: ${statusData.status}, 主机: ${statusData.hostId}`);

        // 触发监控状态更新事件（状态检查结果）
        window.dispatchEvent(new CustomEvent('monitoring-status-change', {
          detail: {
            installed: isInstalled,
            available: statusData.available,
            host: statusData.hostId,
            terminalId: this.terminalId,
            status: statusData.status,
            message: statusData.message
          }
        }));
        return;
      }
      
      // 通知所有匹配类型的监听器
      this._notifyListeners('*', message);
      
      // 根据消息类型通知特定监听器
      if (messageType !== 'unknown') {
        this._notifyListeners(messageType, message);
      }
      
    } catch (error) {
      log.error(`[终端${this.terminalId}] 处理WebSocket消息时出错:`, error);
    }
  }
  
  /**
   * 通知特定类型的所有监听器
   * @param {string} type 消息类型
   * @param {object} message 消息内容
   */
  _notifyListeners(type, message) {
    if (!this.messageListeners.has(type)) {
      return;
    }
    
    const listeners = this.messageListeners.get(type);
    for (const [id, callback] of listeners) {
      try {
        callback(message);
      } catch (error) {
        log.error(`[终端${this.terminalId}] 调用消息监听器(${type}, ${id})时出错:`, error);
      }
    }
  }
  
  /**
   * 更新监控数据
   * @private
   * @param {Object} data 系统信息数据
   */
  _updateMonitorData(data) {
    try {
      if (data.cpu) {
        this.state.monitorData.cpu = {
          usage: data.cpu.usage || 0,
          cores: data.cpu.cores || 0,
          model: data.cpu.model || ''
        };
      }
      
      if (data.memory) {
        this.state.monitorData.memory = {
          total: data.memory.total || 0,
          used: data.memory.used || 0,
          free: data.memory.free || 0,
          usedPercentage: data.memory.usedPercentage || 0
        };
      }
      
      if (data.swap) {
        this.state.monitorData.swap = {
          total: data.swap.total || 0,
          used: data.swap.used || 0,
          free: data.swap.free || 0,
          usedPercentage: data.swap.usedPercentage || 0
        };
      }
      
      if (data.disk) {
        this.state.monitorData.disk = {
          total: data.disk.total || 0,
          used: data.disk.used || 0,
          free: data.disk.free || 0,
          usedPercentage: data.disk.usedPercentage || 0
        };
      }
      
      if (data.network) {
        this.state.monitorData.network = data.network;
      }
      
      if (data.os) {
        this.state.monitorData.os = data.os;
      }
    } catch (error) {
      log.error(`[终端${this.terminalId}] 更新监控数据时出错:`, error);
    }
  }
  
  /**
   * 处理连接关闭
   * @private
   * @param {CloseEvent} event 关闭事件
   */
  _handleClose(event) {
    const wasConnected = this.state.connected;
    this.state.connected = false;
    
    log.debug(`[终端${this.terminalId}] 监控WebSocket连接关闭: ${event.code}`);
    
    // 触发监控连接断开事件（WebSocket层面的断开）
    if (wasConnected) {
      window.dispatchEvent(new CustomEvent('monitoring-status-change', {
        detail: {
          installed: false,
          available: false,
          host: this.state.targetHost,
          terminalId: this.terminalId,
          status: 'websocket_disconnected',
          message: 'WebSocket连接断开'
        }
      }));
    }
    
    // 清除保活定时器
    this._clearKeepAlive();
    
    // 如果之前是连接状态，尝试重连
    if (wasConnected) {
      log.debug(`[终端${this.terminalId}] 监控连接已断开，准备重连`);
      this._reconnect();
    }
  }
  
  /**
   * 尝试重新连接
   * @private
   */
  _reconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      log.debug(`[终端${this.terminalId}] 达到最大重连尝试次数(${this.maxReconnectAttempts})，停止重连`);
      this.state.error = '重连失败';
      return;
    }
    
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * this.reconnectAttempts;
    
    log.debug(`[终端${this.terminalId}] 计划在 ${delay}ms 后进行第 ${this.reconnectAttempts} 次重连`);
    
    this.reconnectTimeout = setTimeout(async () => {
      log.debug(`[终端${this.terminalId}] 正在尝试第 ${this.reconnectAttempts} 次重连`);
      try {
        const connected = await this.connect(this.state.targetHost);
        if (connected) {
          log.debug(`[终端${this.terminalId}] 重连成功`);
          this.reconnectAttempts = 0;
        } else {
          log.debug(`[终端${this.terminalId}] 重连未成功完成`);
          this._reconnect();
        }
      } catch (error) {
        log.debug(`[终端${this.terminalId}] 重连过程中出错`);
        this._reconnect();
      }
    }, delay);
  }
  
  /**
   * 设置保活定时器
   * @private
   */
  _setupKeepAlive() {
    this._clearKeepAlive();
    
    // 创建新的保活定时器
    this.keepAliveInterval = setInterval(() => {
      if (this.state.connected) {
        // 发送ping消息
        this.sendPing();
      }
    }, this.keepAliveTimeout);
  }
  
  /**
   * 清除保活定时器
   * @private
   */
  _clearKeepAlive() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }
  
  /**
   * 获取当前监控数据
   * @returns {Object} 监控数据
   */
  getMonitorData() {
    return this.state.monitorData;
  }
  
  /**
   * 获取完整的系统信息
   * @returns {Object|null} 系统信息，如果未连接则返回null
   */
  getSystemInfo() {
    return this.state.systemInfo;
  }
  
  /**
   * 请求系统状态数据
   * 向监控服务发送请求获取最新的系统统计信息
   */
  requestSystemStats() {
    if (!this.state.connected || !this.ws) {
      log.debug(`[终端${this.terminalId}] 无法请求系统数据: 未连接`);
      return;
    }
    
    // 生成安全的主机ID（使用哈希）
    const secureHostId = this._generateSecureHostId(this.state.targetHost);
    
    // 发送获取系统数据的请求 - 使用安全主机ID代替直接IP
    this.sendMessage({
      type: 'request_system_stats',
      hostId: secureHostId, // 安全的主机ID
      terminalId: this.terminalId,
      timestamp: Date.now()
    });
    
    // 如果有监控数据且未触发过监听器，显式触发system_stats事件
    if (this.state.systemInfo) {
      log.debug(`[终端${this.terminalId}] 使用缓存数据主动触发监听器`);
      
      // 尝试调用已注册的系统数据监听器
      if (this.messageListeners.has('system_stats')) {
        this.messageListeners.get('system_stats').forEach(callback => {
          try {
            callback({
              type: 'system_stats',
              terminalId: this.terminalId,
              targetHost: this.state.targetHost,
              payload: this.state.systemInfo
            });
          } catch (error) {
            log.debug(`[终端${this.terminalId}] 触发system_stats监听器出错:`, error);
          }
        });
      }
    }
  }
  
  // 移除不再使用的 _sendIdentify 方法

  /**
   * 发送订阅消息到监控WebSocket
   * @param {string} serverId - 要订阅的服务器ID
   * @private
   */
  _sendSubscribeMessage(serverId) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log.debug(`[终端${this.terminalId}] 无法发送订阅消息: WebSocket未连接`);
      return;
    }

    const subscribeMessage = {
      type: 'subscribe_server',
      payload: {
        serverId: serverId,
        terminalId: this.terminalId,
        timestamp: Date.now()
      }
    };

    log.debug(`[终端${this.terminalId}] 发送订阅消息:`, subscribeMessage);
    this.sendMessage(subscribeMessage);
  }

  /**
   * 发送取消订阅消息到监控WebSocket
   * @param {string} serverId - 要取消订阅的服务器ID
   * @private
   */
  _sendUnsubscribeMessage(serverId) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log.debug(`[终端${this.terminalId}] 无法发送取消订阅消息: WebSocket未连接`);
      return;
    }

    const unsubscribeMessage = {
      type: 'unsubscribe_server',
      payload: {
        serverId: serverId,
        terminalId: this.terminalId,
        timestamp: Date.now()
      }
    };

    log.debug(`[终端${this.terminalId}] 发送取消订阅消息:`, unsubscribeMessage);
    this.sendMessage(unsubscribeMessage);
  }

  /**
   * 生成安全的主机ID
   * @param {string} host - 主机地址
   * @returns {string} - 安全的主机ID
   */
  _generateSecureHostId(host) {
    if (!host) return 'unknown_host';

    // 简单哈希算法，增加前缀和随机因子
    let hash = 0;
    for (let i = 0; i < host.length; i++) {
      const char = host.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 转换为32位整数
    }

    // 使用时间戳作为盐，保持会话内一致性
    const salt = Math.floor(Date.now() / (1000 * 60 * 60)); // 每小时更新一次
    const hashCode = Math.abs((hash + salt) % 100000).toString().padStart(5, '0');

    return `h_${hashCode}_${this.terminalId.substring(0, 5)}`;
  }
}

/**
 * 监控服务工厂类
 * 管理所有监控实例
 */
class MonitoringFactory {
  constructor() {
    // 实例映射 - 存储每个终端ID对应的监控实例
    this.instances = new Map();
    
    // 服务器数据存储 - 按服务器ID存储最新系统数据
    this.serverStatsMap = new Map();
    
    // 订阅映射 - 存储每个服务器ID的订阅回调
    this.subscriptions = new Map();
    
    // 数据历史记录 - 按服务器ID存储历史数据点
    this.dataHistory = new Map();
    
    // 初始化事件监听
    this._initEvents();
  }
  
  /**
   * 初始化事件监听
   * @private
   */
  _initEvents() {
    // 监听SSH连接成功事件，优化监控状态检查
    window.addEventListener('ssh-connected', (event) => {
      if (event.detail && event.detail.connection && event.detail.connection.host) {
        const host = event.detail.connection.host;
        const serverId = event.detail.connection.serverId || host;
        const terminalId = event.detail.terminalId;

        if (terminalId) {
          // 检查用户登录状态，如果未登录则跳过监控状态检查
          const token = localStorage.getItem('auth_token');
          if (!token) {
            log.debug(`[监控工厂] 用户未登录，跳过监控状态检查: ${serverId}`);
            return;
          }

          log.debug(`[监控工厂] 检测到SSH连接成功，检查服务器 ${serverId} 的监控状态`);

          // 使用重构后的监控初始化服务
          import('./monitoringStatusService.js').then(({ default: monitoringStatusService }) => {
            monitoringStatusService.initializeMonitoring(host, terminalId).then(result => {
              // 只记录重要的状态变更，避免重复日志
              if (result.success && result.websocketConnected) {
                log.info(`[监控工厂] 初始化成功: ${host}`);
              } else if (result.success && !result.websocketConnected) {
                log.debug(`[监控工厂] 初始状态可用但WebSocket连接失败: ${host}`);
              } else {
                log.debug(`[监控工厂] 监控初始化失败: ${host}`);
              }
            }).catch(err => {
              log.warn(`[监控工厂] 初始化失败: ${host} -> ${err.message}`);
            });
          }).catch(err => {
            log.error(`[监控工厂] 导入监控状态服务失败: ${err.message}`);
          });
        }
      }
    });
    
    // 监听终端创建事件
    window.addEventListener('terminal:created', (event) => {
      if (event.detail && event.detail.terminalId) {
        this.createInstance(event.detail.terminalId);
      }
    });
    
    // 监听终端销毁事件
    window.addEventListener('terminal:destroyed', (event) => {
      if (event.detail && event.detail.terminalId) {
        this.removeInstance(event.detail.terminalId);
      }
    });
    
    // 全局监控连接事件
    window.addEventListener('monitoring-connect', (event) => {
      if (event.detail && event.detail.host && event.detail.terminalId) {
        const instance = this.getInstance(event.detail.terminalId);
        if (instance) {
          instance.connect(event.detail.host);
        }
      }
    });
    
    // 全局监控断开事件
    window.addEventListener('monitoring-disconnect', (event) => {
      if (event.detail && event.detail.terminalId) {
        const instance = this.getInstance(event.detail.terminalId);
        if (instance) {
          instance.disconnect();
        }
      } else {
        // 断开所有监控连接
        this.disconnectAll();
      }
    });
    
    // 监控状态完全基于 WebSocket 验证
  }
  
  /**
   * 为指定终端创建监控实例
   * @param {string} terminalId 终端ID
   * @returns {MonitoringInstance} 监控实例
   */
  createInstance(terminalId) {
    if (!terminalId) {
      log.error('创建监控实例失败: 未提供终端ID');
      return null;
    }
    
    // 如果已存在，返回现有实例
    if (this.instances.has(terminalId)) {
      return this.instances.get(terminalId);
    }
    
    // 创建新实例
    const instance = new MonitoringInstance(terminalId);
    this.instances.set(terminalId, instance);
    
    // 创建监控实例（减少日志输出）
    return instance;
  }
  
  /**
   * 获取指定终端的监控实例
   * @param {string} terminalId 终端ID
   * @returns {MonitoringInstance|null} 监控实例或null
   */
  getInstance(terminalId) {
    // 如果不存在，自动创建
    if (!this.instances.has(terminalId)) {
      return this.createInstance(terminalId);
    }
    
    return this.instances.get(terminalId);
  }
  
  /**
   * 移除指定终端的监控实例
   * @param {string} terminalId 终端ID
   */
  removeInstance(terminalId) {
    if (!terminalId || !this.instances.has(terminalId)) {
      return false;
    }
    
    // 先获取实例信息，以便后续清理相关数据
    const instance = this.instances.get(terminalId);
    if (!instance) {
      return false;
    }
    
    // 获取实例关联的服务器ID
    const serverId = instance.state.targetHost;
    
    // 断开连接
    instance.disconnect();
    
    // 移除实例
    this.instances.delete(terminalId);
    log.debug(`已移除终端 ${terminalId} 的监控实例`);
    
    // 如果这是关联到特定服务器的唯一终端，清理服务器数据
    if (serverId) {
      // 检查是否还有其他终端连接到同一服务器
      let hasOtherConnection = false;
      this.instances.forEach((otherInstance) => {
        if (otherInstance.state.targetHost === serverId && otherInstance.state.connected) {
          hasOtherConnection = true;
        }
      });
      
      // 如果没有其他连接，清理该服务器的所有数据
      if (!hasOtherConnection) {
        log.debug(`终端 ${terminalId} 是连接到服务器 ${serverId} 的最后一个终端，清理服务器数据`);
        
        // 清理服务器相关的订阅
        if (this.subscriptions.has(serverId)) {
          log.debug(`清理服务器 ${serverId} 的 ${this.subscriptions.get(serverId).size} 个订阅`);
          this.subscriptions.delete(serverId);
        }
        
        // 清理服务器的历史数据
        if (this.dataHistory.has(serverId)) {
          this.dataHistory.delete(serverId);
          log.debug(`已清理服务器 ${serverId} 的历史数据`);
        }
        
        // 清理服务器的实时数据
        if (this.serverStatsMap.has(serverId)) {
          this.serverStatsMap.delete(serverId);
          log.debug(`已清理服务器 ${serverId} 的实时数据`);
        }
        
        // 通知所有组件该服务器数据已被清理
        window.dispatchEvent(new CustomEvent('server-data-cleared', {
          detail: {
            serverId: serverId,
            reason: 'terminal_destroyed',
            terminalId: terminalId
          }
        }));
      } else {
        log.debug(`终端 ${terminalId} 被销毁，但服务器 ${serverId} 仍有其他终端连接，保留服务器数据`);
      }
    }
    
    return true;
  }
  
  /**
   * 断开所有监控连接
   */
  disconnectAll() {
    this.instances.forEach((instance) => {
      instance.disconnect();
    });
    log.debug('已断开所有监控连接');
  }
  
  /**
   * 查找已连接到指定主机的终端实例
   * @param {string} host 主机地址
   * @returns {Object|null} 返回找到的实例和终端ID，如果未找到则返回null
   */
  findInstanceByHost(host) {
    if (!host) return null;
    
    // 遍历所有实例，查找已连接到指定主机的实例
    for (const [terminalId, instance] of this.instances.entries()) {
      if (instance.state.connected && instance.state.targetHost === host) {
        log.debug(`找到已连接到 ${host} 的现有实例，终端ID: ${terminalId}`);
        return { instance, terminalId };
      }
    }
    
    // 查找连接中的实例
    for (const [terminalId, instance] of this.instances.entries()) {
      if (instance.state.connecting && instance.state.targetHost === host) {
        log.debug(`找到正在连接到 ${host} 的实例，终端ID: ${terminalId}`);
        return { instance, terminalId };
      }
    }
    
    return null;
  }
  
  /**
   * 连接指定终端到远程主机
   * @param {string} terminalId 终端ID
   * @param {string} host 远程主机地址
   * @returns {Promise<boolean>} 连接结果
   */
  async connect(terminalId, host) {
    if (!terminalId || !host) {
      return false;
    }
    
    // 获取当前实例
    const instance = this.getInstance(terminalId);
    if (!instance) {
      return false;
    }
    
    // 检查当前实例是否已连接到相同主机
    if (instance.state.connected && instance.state.targetHost === host) {
      log.debug(`终端 ${terminalId} 已连接到 ${host}，跳过重复连接`);
      return true;
    }
    
    // 检查当前实例是否正在连接到相同主机
    if (instance.state.connecting && instance.state.targetHost === host) {
      log.debug(`终端 ${terminalId} 正在连接到 ${host}，跳过重复连接`);
      return true;
    }
    
    // 先检查是否有其他终端已连接到相同主机
    const existingConnection = this.findInstanceByHost(host);
    if (existingConnection) {
      log.debug(`终端 ${terminalId} 请求连接到 ${host}，但已有终端 ${existingConnection.terminalId} 已连接，共享该连接`);
      
      // 如果调用者不是连接的拥有者，创建事件映射
      if (existingConnection.terminalId !== terminalId) {
        // 这里可以添加代码来创建从新终端到现有终端的事件转发
        log.debug(`创建从终端 ${terminalId} 到终端 ${existingConnection.terminalId} 的事件映射`);
        
        // 不再自动触发状态变更事件
        // 监控状态应该通过WebSocket验证，而不是基于连接共享
        // 让新终端通过正常的状态检查流程获取真实状态
        log.debug(`终端 ${terminalId} 将通过WebSocket验证获取监控状态`);
      }
      
      // 利用现有连接而不是创建新连接
      return true;
    }
    
    return await instance.connect(host);
  }
  
  /**
   * 断开指定终端的监控连接
   * @param {string} terminalId 终端ID
   */
  disconnect(terminalId) {
    if (!terminalId) {
      return false;
    }
    
    const instance = this.getInstance(terminalId);
    if (!instance) {
      return false;
    }
    
    instance.disconnect();
    return true;
  }
  
  /**
   * 判断指定终端是否已连接监控
   * @param {string} terminalId 终端ID
   * @returns {boolean} 是否已连接
   */
  isMonitored(terminalId) {
    if (!terminalId) {
      return false;
    }
    
    const instance = this.getInstance(terminalId);
    if (!instance) {
      return false;
    }
    
    return instance.state.connected;
  }
  
  /**
   * 获取指定终端的监控状态
   * @param {string} terminalId 终端ID
   * @returns {Object|null} 监控状态
   */
  getStatus(terminalId) {
    if (!terminalId) {
      return null;
    }
    
    const instance = this.getInstance(terminalId);
    if (!instance) {
      return null;
    }
    
    return instance.state;
  }
  
  /**
   * 获取指定终端的系统信息
   * @param {string} terminalId 终端ID
   * @returns {Object|null} 系统信息
   */
  getSystemInfo(terminalId) {
    if (!terminalId) {
      return null;
    }
    
    const instance = this.getInstance(terminalId);
    if (!instance) {
      return null;
    }
    
    return instance.getSystemInfo();
  }
  
  /**
   * 获取指定终端的监控数据
   * @param {string} terminalId 终端ID
   * @returns {Object|null} 监控数据
   */
  getMonitorData(terminalId) {
    if (!terminalId) {
      return null;
    }
    
    const instance = this.getInstance(terminalId);
    if (!instance) {
      return null;
    }
    
    return instance.getMonitorData();
  }
  
  /**
   * 添加消息监听器
   * @param {string} terminalId 终端ID
   * @param {string} type 消息类型
   * @param {Function} callback 回调函数
   * @returns {string|null} 监听器ID或null
   */
  addMessageListener(terminalId, type, callback) {
    if (!terminalId) {
      return null;
    }
    
    const instance = this.getInstance(terminalId);
    if (!instance) {
      return null;
    }
    
    return instance.addMessageListener(type, callback);
  }
  
  /**
   * 移除消息监听器
   * @param {string} terminalId 终端ID
   * @param {string} type 消息类型
   * @param {string} id 监听器ID
   */
  removeMessageListener(terminalId, type, id) {
    if (!terminalId) {
      return false;
    }
    
    const instance = this.getInstance(terminalId);
    if (!instance) {
      return false;
    }
    
    instance.removeMessageListener(type, id);
    return true;
  }
  
  /**
   * 请求系统状态数据
   * @param {string} terminalId 终端ID
   */
  requestSystemStats(terminalId) {
    if (!terminalId) {
      return false;
    }
    
    const instance = this.getInstance(terminalId);
    if (!instance) {
      return false;
    }
    
    instance.requestSystemStats();
    return true;
  }
  
  /**
   * 更新服务器数据存储
   * @param {string} serverId 服务器ID
   * @param {object} data 监控数据
   */
  updateServerData(serverId, data) {
    if (!serverId) return;
    
    // 提取有效的监控数据
    let statsData = null;
    const messageType = data.type || (data.data && data.data.type) || 'unknown';
    
    // 根据消息类型提取数据
    if (messageType === 'system_stats' || messageType === 'system-stats') {
      statsData = data.payload || data.data || data;
    } else if (messageType === 'system-info') {
      statsData = (data.data && data.data.data) || data.data || data;
    } else if (data.payload && (data.payload.cpu || data.payload.memory)) {
      statsData = data.payload;
    }
    
    if (!statsData) return;
    
    // 获取当前服务器的数据，如果不存在则创建新的
    const currentData = this.serverStatsMap.get(serverId) || {
      cpu: {},
      memory: {},
      swap: {},
      disk: {},
      network: {},
      os: {},
      ip: {},
      location: {},
      timestamp: Date.now(),
      lastUpdate: Date.now()
    };
    
    // 更新时间戳
    currentData.lastUpdate = Date.now();
    if (data.timestamp) currentData.timestamp = data.timestamp;
    
    // 更新各类数据
    this._updateStatsObject(currentData, statsData);
    
    // 存储更新后的数据
    this.serverStatsMap.set(serverId, currentData);
    
    // 更新历史数据
    this._updateHistoryData(serverId, currentData);
    
    // 通知订阅者
    this._notifySubscribers(serverId, currentData);
    
    // log.debug(`[监控工厂] 更新了服务器 ${serverId} 的数据`);
  }
  
  /**
   * 更新统计对象的属性
   * @param {object} target 目标对象
   * @param {object} source 源数据
   * @private
   */
  _updateStatsObject(target, source) {
    // 更新CPU信息
    if (source.cpu) {
      target.cpu = {
        ...target.cpu,
        usage: source.cpu.usage !== undefined ? source.cpu.usage : target.cpu.usage,
        cores: source.cpu.cores || target.cpu.cores,
        model: source.cpu.model || target.cpu.model
      };
    }
    
    // 更新内存信息
    if (source.memory) {
      target.memory = {
        ...target.memory,
        total: source.memory.total || target.memory.total,
        used: source.memory.used || target.memory.used,
        free: source.memory.free || target.memory.free,
        usedPercentage: source.memory.usedPercentage !== undefined ? 
                        source.memory.usedPercentage : target.memory.usedPercentage
      };
    }
    
    // 更新交换分区信息
    if (source.swap) {
      target.swap = {
        ...target.swap,
        total: source.swap.total || target.swap.total,
        used: source.swap.used || target.swap.used,
        free: source.swap.free || target.swap.free,
        usedPercentage: source.swap.usedPercentage !== undefined ? 
                        source.swap.usedPercentage : target.swap.usedPercentage
      };
    }
    
    // 更新磁盘信息
    if (source.disk) {
      target.disk = {
        ...target.disk,
        total: source.disk.total || target.disk.total,
        used: source.disk.used || target.disk.used,
        free: source.disk.free || target.disk.free,
        usedPercentage: source.disk.usedPercentage !== undefined ? 
                        source.disk.usedPercentage : target.disk.usedPercentage
      };
    }
    
    // 更新网络信息
    if (source.network) {
      target.network = {
        ...target.network,
        ...source.network
      };
    }
    
    // 更新操作系统信息
    if (source.os) {
      target.os = {
        ...target.os,
        type: source.os.type || target.os.type,
        platform: source.os.platform || target.os.platform,
        arch: source.os.arch || target.os.arch,
        release: source.os.release || target.os.release,
        uptime: source.os.uptime || target.os.uptime,
        hostname: source.os.hostname || target.os.hostname
      };
    }
    
    // 更新IP地址信息
    if (source.ip) {
      target.ip = {
        ...target.ip,
        internal: source.ip.internal || target.ip.internal,
        public: source.ip.public || target.ip.public
      };
    }
    
    // 更新地理位置信息
    if (source.location) {
      target.location = {
        ...target.location,
        country: source.location.country || target.location.country,
        region: source.location.region || target.location.region,
        city: source.location.city || target.location.city,
        timezone: source.location.timezone || target.location.timezone
      };
    }
  }
  
  /**
   * 更新历史数据
   * @param {string} serverId 服务器ID
   * @param {object} currentData 当前数据
   * @private
   */
  _updateHistoryData(serverId, currentData) {
    const MAX_HISTORY_POINTS = 20;
    
    // 获取当前服务器的历史数据，如果不存在则创建新的
    if (!this.dataHistory.has(serverId)) {
      this.dataHistory.set(serverId, {
        timePoints: [],
        cpuHistory: [],
        memoryHistory: [],
        networkHistory: {
          input: [],
          output: []
        }
      });
    }
    
    const history = this.dataHistory.get(serverId);
    
    // 生成时间点
    const now = new Date();
    const timeStr = now.getHours().toString().padStart(2, '0') + ':' + 
                  now.getMinutes().toString().padStart(2, '0') + ':' + 
                  now.getSeconds().toString().padStart(2, '0');
    
    // 添加时间点
    history.timePoints.push(timeStr);
    if (history.timePoints.length > MAX_HISTORY_POINTS) {
      history.timePoints.shift();
    }
    
    // 添加CPU数据
    history.cpuHistory.push(currentData.cpu?.usage || 0);
    if (history.cpuHistory.length > MAX_HISTORY_POINTS) {
      history.cpuHistory.shift();
    }
    
    // 添加内存数据
    history.memoryHistory.push(currentData.memory?.usedPercentage || 0);
    if (history.memoryHistory.length > MAX_HISTORY_POINTS) {
      history.memoryHistory.shift();
    }
    
    // 添加网络数据
    const inputBytes = currentData.network?.total_rx_speed || 0;
    const outputBytes = currentData.network?.total_tx_speed || 0;
    
    history.networkHistory.input.push(parseFloat(inputBytes));
    history.networkHistory.output.push(parseFloat(outputBytes));
    
    if (history.networkHistory.input.length > MAX_HISTORY_POINTS) {
      history.networkHistory.input.shift();
    }
    if (history.networkHistory.output.length > MAX_HISTORY_POINTS) {
      history.networkHistory.output.shift();
    }
    
    // 更新历史数据
    this.dataHistory.set(serverId, history);
  }
  
  /**
   * 通知特定服务器的所有订阅者
   * @param {string} serverId 服务器ID
   * @param {object} data 监控数据
   * @private
   */
  _notifySubscribers(serverId, data) {
    if (!this.subscriptions.has(serverId)) {
      return;
    }
    
    const subscribers = this.subscriptions.get(serverId);
    for (const [id, callback] of subscribers) {
      try {
        callback({
          data,
          history: this.dataHistory.get(serverId) || null,
          timestamp: Date.now()
        });
      } catch (error) {
        log.error(`[监控工厂] 通知订阅者(${serverId}, ${id})时出错:`, error);
      }
    }
  }
  
  /**
   * 获取服务器的最新监控数据
   * @param {string} serverId 服务器ID
   * @returns {object} 服务器监控数据
   */
  getServerData(serverId) {
    return this.serverStatsMap.get(serverId) || null;
  }
  
  /**
   * 获取服务器的历史数据
   * @param {string} serverId 服务器ID
   * @returns {object} 服务器历史数据
   */
  getServerHistoryData(serverId) {
    return this.dataHistory.get(serverId) || null;
  }
  
  /**
   * 订阅服务器数据更新
   * @param {string} serverId 服务器ID
   * @param {function} callback 回调函数
   * @returns {string} 订阅ID
   */
  subscribeToServer(serverId, callback) {
    if (!serverId || typeof callback !== 'function') {
      return null;
    }
    
    // 初始化订阅映射
    if (!this.subscriptions.has(serverId)) {
      this.subscriptions.set(serverId, new Map());
    }
    
    // 生成唯一订阅ID
    const subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    
    // 添加订阅
    this.subscriptions.get(serverId).set(subscriptionId, callback);
    
    // 移除重复的订阅日志，由上层组件统一记录
    
    // 如果已有数据，立即通知订阅者
    const currentData = this.serverStatsMap.get(serverId);
    if (currentData) {
      setTimeout(() => {
        try {
          callback({
            data: currentData,
            history: this.dataHistory.get(serverId) || null,
            timestamp: Date.now(),
            isInitial: true
          });
        } catch (error) {
          log.error(`[监控工厂] 初始通知订阅者出错:`, error);
        }
      }, 0);
    }
    
    return subscriptionId;
  }
  
  /**
   * 取消订阅服务器数据更新
   * @param {string} serverId 服务器ID
   * @param {string} subscriptionId 订阅ID
   * @returns {boolean} 是否成功取消
   */
  unsubscribeFromServer(serverId, subscriptionId) {
    if (!serverId || !subscriptionId || !this.subscriptions.has(serverId)) {
      return false;
    }
    
    const result = this.subscriptions.get(serverId).delete(subscriptionId);
    
    // 如果该服务器没有订阅者了，删除整个映射
    if (this.subscriptions.get(serverId).size === 0) {
      this.subscriptions.delete(serverId);
    }
    
    log.debug(`[监控工厂] ${result ? '成功' : '未能'}取消服务器 ${serverId} 的订阅: ${subscriptionId}`);
    
    return result;
  }
}

// 创建单例实例
const monitoringFactory = new MonitoringFactory();

// 导出
export default monitoringFactory; 