/**
 * 优化的监控数据传输管理器
 * 提供数据压缩、批量传输和连接管理功能
 */

const zlib = require('zlib');
const EventEmitter = require('events');
const logger = require('../utils/logger');
const monitoringConfig = require('../config/monitoring');

class OptimizedDataTransport extends EventEmitter {
  constructor() {
    super();

    this.config = monitoringConfig.transport;

    // 批量传输队列
    this.batchQueues = new Map(); // sessionId -> batch queue
    this.batchTimers = new Map(); // sessionId -> timer

    // 连接管理
    this.connections = new Map(); // sessionId -> connection info
    this.heartbeatTimers = new Map(); // sessionId -> heartbeat timer
  }

  /**
   * 注册WebSocket连接
   * @param {string} sessionId 会话ID
   * @param {WebSocket} ws WebSocket连接
   * @param {Object} metadata 连接元数据
   */
  registerConnection(sessionId, ws, metadata = {}) {
    const connectionInfo = {
      ws,
      sessionId,
      metadata,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      isAlive: true
    };

    this.connections.set(sessionId, connectionInfo);
    this.setupWebSocketEvents(sessionId, ws);
    this.startHeartbeat(sessionId);

    logger.info('WebSocket连接已注册', {
      sessionId,
      totalConnections: this.connections.size
    });
  }

  /**
   * 注销WebSocket连接
   * @param {string} sessionId 会话ID
   */
  unregisterConnection(sessionId) {
    const connectionInfo = this.connections.get(sessionId);
    if (!connectionInfo) return;
    
    // 清理心跳定时器
    this.stopHeartbeat(sessionId);
    
    // 清理批量传输
    this.clearBatchQueue(sessionId);
    
    // 移除连接
    this.connections.delete(sessionId);
    
    logger.info('WebSocket连接已注销', {
      sessionId,
      duration: Date.now() - connectionInfo.connectedAt,
      messagesSent: connectionInfo.messagesSent,
      totalConnections: this.connections.size
    });
    
    this.emit('connectionUnregistered', { sessionId, connectionInfo });
  }

  /**
   * 发送数据（支持压缩和批量传输）
   * @param {string} sessionId 会话ID
   * @param {Object} data 要发送的数据
   * @param {Object} options 发送选项
   */
  async sendData(sessionId, data, options = {}) {
    const connectionInfo = this.connections.get(sessionId);
    if (!connectionInfo || !connectionInfo.ws || connectionInfo.ws.readyState !== 1) {
      return false;
    }

    try {
      // 检查是否启用批量传输
      if (this.config.batch.enabled && !options.immediate) {
        return this.addToBatch(sessionId, data);
      }

      // 直接发送
      return await this.sendMessage(sessionId, data);
    } catch (error) {
      logger.error('发送数据失败', { sessionId, error: error.message });
      return false;
    }
  }

  /**
   * 添加到批量传输队列
   * @param {string} sessionId 会话ID
   * @param {Object} data 数据
   */
  addToBatch(sessionId, data) {
    if (!this.batchQueues.has(sessionId)) {
      this.batchQueues.set(sessionId, []);
    }
    
    const queue = this.batchQueues.get(sessionId);
    queue.push({
      data,
      timestamp: Date.now()
    });
    
    // 检查是否需要立即发送
    if (queue.length >= this.config.batch.size) {
      this.flushBatch(sessionId);
      return true;
    }
    
    // 设置批量发送定时器
    if (!this.batchTimers.has(sessionId)) {
      const timer = setTimeout(() => {
        this.flushBatch(sessionId);
      }, this.config.batch.timeout);
      
      this.batchTimers.set(sessionId, timer);
    }
    
    return true;
  }

  /**
   * 刷新批量传输队列
   * @param {string} sessionId 会话ID
   */
  async flushBatch(sessionId) {
    const queue = this.batchQueues.get(sessionId);
    if (!queue || queue.length === 0) return;
    
    // 清理定时器
    const timer = this.batchTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.batchTimers.delete(sessionId);
    }
    
    // 构建批量消息
    const batchData = {
      type: 'batch',
      timestamp: Date.now(),
      items: queue.map(item => item.data)
    };
    
    // 发送批量数据
    const success = await this.sendMessage(sessionId, batchData);
    
    if (success) {
      logger.debug('批量数据发送成功', {
        sessionId,
        batchSize: queue.length
      });
    }
    
    // 清空队列
    this.batchQueues.set(sessionId, []);
    
    return success;
  }

  /**
   * 发送消息（支持压缩）
   * @param {string} sessionId 会话ID
   * @param {Object} data 数据
   */
  async sendMessage(sessionId, data) {
    const connectionInfo = this.connections.get(sessionId);
    if (!connectionInfo || !connectionInfo.ws || connectionInfo.ws.readyState !== 1) {
      return false;
    }
    
    try {
      let message = JSON.stringify(data);
      let compressed = false;
      
      // 检查是否需要压缩
      if (message.length > this.config.compressionThreshold && monitoringConfig.performance.enableCompression) {
        const compressedBuffer = await this.compressData(message);
        if (compressedBuffer.length < message.length * 0.8) { // 只有压缩率超过20%才使用
          message = compressedBuffer;
          compressed = true;
        }
      }
      
      // 发送消息
      connectionInfo.ws.send(message);
      
      // 更新连接统计
      connectionInfo.lastActivity = Date.now();

      return true;
    } catch (error) {
      logger.error('发送消息失败', {
        sessionId,
        error: error.message
      });
      return false;
    }
  }

  /**
   * 压缩数据
   * @param {string} data 要压缩的数据
   * @returns {Promise<Buffer>} 压缩后的数据
   */
  compressData(data) {
    return new Promise((resolve, reject) => {
      zlib.gzip(data, (err, compressed) => {
        if (err) {
          reject(err);
        } else {
          resolve(compressed);
        }
      });
    });
  }

  /**
   * 设置WebSocket事件监听
   * @param {string} sessionId 会话ID
   * @param {WebSocket} ws WebSocket连接
   */
  setupWebSocketEvents(sessionId, ws) {
    ws.on('message', (message) => {
      const connectionInfo = this.connections.get(sessionId);
      if (connectionInfo) {
        connectionInfo.messagesReceived++;
        connectionInfo.lastActivity = Date.now();
        connectionInfo.isAlive = true;
      }
    });
    
    ws.on('pong', () => {
      const connectionInfo = this.connections.get(sessionId);
      if (connectionInfo) {
        connectionInfo.isAlive = true;
        connectionInfo.lastActivity = Date.now();
      }
    });
    
    ws.on('close', () => {
      this.unregisterConnection(sessionId);
    });
    
    ws.on('error', (error) => {
      logger.error('WebSocket错误', {
        sessionId,
        error: error.message
      });
      this.unregisterConnection(sessionId);
    });
  }

  /**
   * 启动心跳检测
   * @param {string} sessionId 会话ID
   */
  startHeartbeat(sessionId) {
    const heartbeatTimer = setInterval(() => {
      const connectionInfo = this.connections.get(sessionId);
      if (!connectionInfo) {
        clearInterval(heartbeatTimer);
        return;
      }
      
      if (!connectionInfo.isAlive) {
        logger.warn('心跳检测失败，关闭连接', { sessionId });
        connectionInfo.ws.terminate();
        this.unregisterConnection(sessionId);
        return;
      }
      
      connectionInfo.isAlive = false;
      connectionInfo.ws.ping();
    }, 30000); // 30秒心跳间隔
    
    this.heartbeatTimers.set(sessionId, heartbeatTimer);
  }

  /**
   * 停止心跳检测
   * @param {string} sessionId 会话ID
   */
  stopHeartbeat(sessionId) {
    const timer = this.heartbeatTimers.get(sessionId);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(sessionId);
    }
  }

  /**
   * 清理批量传输队列
   * @param {string} sessionId 会话ID
   */
  clearBatchQueue(sessionId) {
    // 先刷新剩余数据
    this.flushBatch(sessionId);
    
    // 清理定时器
    const timer = this.batchTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.batchTimers.delete(sessionId);
    }
    
    // 清理队列
    this.batchQueues.delete(sessionId);
  }

  /**
   * 更新连接活动时间
   * @param {string} sessionId 会话ID
   */
  updateConnectionActivity(sessionId) {
    const connectionInfo = this.connections.get(sessionId);
    if (connectionInfo) {
      connectionInfo.lastActivity = Date.now();
    }
  }

  /**
   * 清理过期连接
   */
  cleanupStaleConnections() {
    const now = Date.now();
    const timeout = 60000; // 60秒超时

    for (const [sessionId, connectionInfo] of this.connections) {
      if (now - connectionInfo.lastActivity > timeout) {
        logger.warn('清理过期连接', {
          sessionId,
          lastActivity: new Date(connectionInfo.lastActivity).toISOString(),
          inactiveTime: now - connectionInfo.lastActivity
        });

        this.unregisterConnection(sessionId);
      }
    }
  }

  /**
   * 广播数据到所有连接
   * @param {Object} data 要广播的数据
   * @param {Function} filter 连接过滤函数
   */
  async broadcast(data, filter = null) {
    const promises = [];

    for (const [sessionId, connectionInfo] of this.connections) {
      if (filter && !filter(connectionInfo)) {
        continue;
      }

      promises.push(this.sendData(sessionId, data, { immediate: true }));
    }

    const results = await Promise.allSettled(promises);
    const successCount = results.filter(r => r.status === 'fulfilled' && r.value).length;

    logger.debug('数据广播完成', {
      totalConnections: this.connections.size,
      successCount,
      failureCount: results.length - successCount
    });

    return successCount;
  }

  /**
   * 获取连接信息
   * @param {string} sessionId 会话ID
   * @returns {Object|null} 连接信息
   */
  getConnectionInfo(sessionId) {
    return this.connections.get(sessionId) || null;
  }

  /**
   * 获取所有连接信息
   * @returns {Array} 连接信息数组
   */
  getAllConnections() {
    return Array.from(this.connections.values());
  }



  /**
   * 清理所有资源
   */
  cleanup() {
    // 清理所有连接
    for (const sessionId of this.connections.keys()) {
      this.unregisterConnection(sessionId);
    }

    // 清理所有定时器
    for (const timer of this.heartbeatTimers.values()) {
      clearInterval(timer);
    }

    for (const timer of this.batchTimers.values()) {
      clearTimeout(timer);
    }

    // 清理所有集合
    this.connections.clear();
    this.batchQueues.clear();
    this.heartbeatTimers.clear();
    this.batchTimers.clear();

    // 移除所有事件监听器
    this.removeAllListeners();

    logger.info('数据传输管理器已清理');
  }
}

module.exports = OptimizedDataTransport;
