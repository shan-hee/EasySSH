/**
 * 增强版监控数据传输管理器
 * 支持MessagePack二进制编码、WebSocket原生压缩、差量更新和背压处理
 */

const EventEmitter = require('events');
const msgpack = require('msgpack5')();
const logger = require('../utils/logger');
const monitoringConfig = require('../config/monitoring');

class EnhancedDataTransport extends EventEmitter {
  constructor() {
    super();

    this.config = monitoringConfig.transport;

    // 连接管理
    this.connections = new Map(); // sessionId -> connection info
    this.heartbeatTimers = new Map(); // sessionId -> heartbeat timer

    // 批量传输队列
    this.batchQueues = new Map(); // sessionId -> batch queue
    this.batchTimers = new Map(); // sessionId -> timer

    // 差量更新缓存
    this.deltaCache = new Map(); // sessionId -> { static: {}, lastDynamic: {} }

    // 性能统计
    this.stats = {
      totalMessages: 0,
      compressedMessages: 0,
      binaryMessages: 0,
      deltaMessages: 0,
      droppedMessages: 0,
      totalBytes: 0,
      compressedBytes: 0,
      startTime: Date.now()
    };

    // 背压控制
    this.backpressureThreshold = this.config.ws?.backpressureBytes || 1000000; // 1MB
    this.dropPolicy = this.config.ws?.dropPolicy || 'oldest';
  }

  /**
   * 注册WebSocket连接
   * @param {string} sessionId 会话ID
   * @param {WebSocket} ws WebSocket连接
   * @param {Object} metadata 连接元数据
   */
  registerConnection(sessionId, ws, metadata = {}) {
    // 清理旧连接
    this.unregisterConnection(sessionId);

    const connectionInfo = {
      sessionId,
      ws,
      metadata,
      registeredAt: Date.now(),
      lastActivity: Date.now(),
      messageCount: 0,
      bytesSent: 0,
      codec: this.config.ws?.binaryCodec || 'json', // 'json' | 'msgpack'
      compressionEnabled: ws.extensions && ws.extensions['permessage-deflate']
    };

    this.connections.set(sessionId, connectionInfo);

    // 启动心跳
    this.startHeartbeat(sessionId);

    // 初始化差量缓存
    this.deltaCache.set(sessionId, {
      staticData: {},
      lastDynamic: {},
      staticVersion: 0
    });

    logger.info('WebSocket连接已注册', {
      sessionId,
      codec: connectionInfo.codec,
      compression: connectionInfo.compressionEnabled,
      metadata: metadata.type || 'unknown'
    });

    this.emit('connection-registered', { sessionId, connectionInfo });
  }

  /**
   * 注销WebSocket连接
   * @param {string} sessionId 会话ID
   */
  unregisterConnection(sessionId) {
    const connectionInfo = this.connections.get(sessionId);
    if (connectionInfo) {
      // 停止心跳
      this.stopHeartbeat(sessionId);

      // 清理批量队列
      this.flushBatch(sessionId);
      if (this.batchTimers.has(sessionId)) {
        clearTimeout(this.batchTimers.get(sessionId));
        this.batchTimers.delete(sessionId);
      }

      // 清理缓存
      this.deltaCache.delete(sessionId);
      this.batchQueues.delete(sessionId);
      this.connections.delete(sessionId);

      logger.debug('WebSocket连接已注销', {
        sessionId,
        messageCount: connectionInfo.messageCount,
        bytesSent: connectionInfo.bytesSent
      });

      this.emit('connection-unregistered', { sessionId });
    }
  }

  /**
   * 发送数据（支持压缩、二进制编码和差量更新）
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
      // 检查背压
      if (this.checkBackpressure(connectionInfo)) {
        this.handleBackpressure(sessionId, data);
        return false;
      }

      // 应用差量编码
      const processedData = this.applyDeltaEncoding(sessionId, data);

      // 检查是否启用批量传输
      if (this.config.batch?.enabled && !options.immediate) {
        return this.addToBatch(sessionId, processedData);
      }

      // 直接发送
      return await this.sendMessage(sessionId, processedData);
    } catch (error) {
      logger.error('发送数据失败', { sessionId, error: error.message });
      return false;
    }
  }

  /**
   * 应用差量编码
   * @param {string} sessionId 会话ID
   * @param {Object} data 原始数据
   * @returns {Object} 处理后的数据
   */
  applyDeltaEncoding(sessionId, data) {
    if (!this.config.delta?.enabled) {
      return data;
    }

    const cache = this.deltaCache.get(sessionId);
    if (!cache) {
      return data;
    }

    // 分离静态和动态字段
    const { static: staticFields, dynamic: dynamicFields } = this.splitFields(data);

    // 处理静态字段
    let staticVersion = cache.staticVersion;
    let includeStatic = false;

    if (JSON.stringify(staticFields) !== JSON.stringify(cache.staticData)) {
      cache.staticData = staticFields;
      cache.staticVersion = ++staticVersion;
      includeStatic = true;
    }

    // 处理动态字段差量
    const deltaFields = this.computeDelta(dynamicFields, cache.lastDynamic);
    cache.lastDynamic = dynamicFields;

    // 构建差量消息
    const deltaMessage = {
      type: data.type,
      timestamp: data.timestamp || Date.now(),
      staticVersion,
      delta: deltaFields
    };

    if (includeStatic) {
      deltaMessage.staticFields = staticFields;
    }

    this.stats.deltaMessages++;
    return deltaMessage;
  }

  /**
   * 分离静态和动态字段
   * @param {Object} data 数据对象
   * @returns {Object} { staticFields, dynamicFields }
   */
  splitFields(data) {
    const staticFieldNames = ['os', 'cpu.model', 'cpu.cores', 'hostId', 'ip'];
    const staticFields = {};
    const dynamicFields = {};

    for (const [key, value] of Object.entries(data)) {
      if (staticFieldNames.some(field => field === key || field.startsWith(key + '.'))) {
        staticFields[key] = value;
      } else {
        dynamicFields[key] = value;
      }
    }

    return { static: staticFields, dynamic: dynamicFields };
  }

  /**
   * 计算字段差量
   * @param {Object} current 当前数据
   * @param {Object} previous 上次数据
   * @returns {Object} 差量数据
   */
  computeDelta(current, previous) {
    const delta = {};

    for (const [key, value] of Object.entries(current)) {
      if (JSON.stringify(value) !== JSON.stringify(previous[key])) {
        delta[key] = value;
      }
    }

    return delta;
  }

  /**
   * 检查背压
   * @param {Object} connectionInfo 连接信息
   * @returns {boolean} 是否存在背压
   */
  checkBackpressure(connectionInfo) {
    return connectionInfo.ws.bufferedAmount > this.backpressureThreshold;
  }

  /**
   * 处理背压
   * @param {string} sessionId 会话ID
   * @param {Object} data 数据
   */
  handleBackpressure(sessionId, data) {
    const queue = this.batchQueues.get(sessionId) || [];

    if (this.dropPolicy === 'oldest' && queue.length > 0) {
      // 丢弃最旧的消息
      queue.shift();
      this.stats.droppedMessages++;
    } else if (this.dropPolicy === 'current') {
      // 丢弃当前消息
      this.stats.droppedMessages++;
      return;
    }

    // 添加到队列
    queue.push({
      data,
      timestamp: Date.now()
    });

    this.batchQueues.set(sessionId, queue);

    logger.debug('背压处理', {
      sessionId,
      queueLength: queue.length,
      droppedMessages: this.stats.droppedMessages
    });
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
   * 刷新批量队列
   * @param {string} sessionId 会话ID
   */
  async flushBatch(sessionId) {
    const queue = this.batchQueues.get(sessionId);
    if (!queue || queue.length === 0) {
      return;
    }

    // 清理定时器
    if (this.batchTimers.has(sessionId)) {
      clearTimeout(this.batchTimers.get(sessionId));
      this.batchTimers.delete(sessionId);
    }

    // 构建批量消息
    const batchMessage = {
      type: 'batch',
      items: queue.map(item => item.data),
      timestamp: Date.now()
    };

    // 清空队列
    this.batchQueues.set(sessionId, []);

    // 发送批量消息
    await this.sendMessage(sessionId, batchMessage);
  }

  /**
   * 发送消息
   * @param {string} sessionId 会话ID
   * @param {Object} data 数据
   */
  async sendMessage(sessionId, data) {
    const connectionInfo = this.connections.get(sessionId);
    if (!connectionInfo || !connectionInfo.ws || connectionInfo.ws.readyState !== 1) {
      return false;
    }

    try {
      let message;
      let messageSize;

      // 选择编码格式
      if (connectionInfo.codec === 'msgpack') {
        // MessagePack二进制编码
        message = msgpack.encode(data);
        messageSize = message.length;
        this.stats.binaryMessages++;
      } else {
        // JSON编码
        message = JSON.stringify(data);
        messageSize = Buffer.byteLength(message, 'utf8');
      }

      // 发送消息（WebSocket会自动应用permessage-deflate压缩）
      connectionInfo.ws.send(message);

      // 更新统计
      this.updateStats(connectionInfo, messageSize);

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
   * 更新统计信息
   * @param {Object} connectionInfo 连接信息
   * @param {number} messageSize 消息大小
   */
  updateStats(connectionInfo, messageSize) {
    this.stats.totalMessages++;
    this.stats.totalBytes += messageSize;

    connectionInfo.messageCount++;
    connectionInfo.bytesSent += messageSize;
    connectionInfo.lastActivity = Date.now();

    // 如果启用了压缩，估算压缩后大小
    if (connectionInfo.compressionEnabled) {
      this.stats.compressedMessages++;
      this.stats.compressedBytes += Math.floor(messageSize * 0.7); // 估算70%压缩率
    }
  }

  /**
   * 启动心跳
   * @param {string} sessionId 会话ID
   */
  startHeartbeat(sessionId) {
    const heartbeatInterval = 30000; // 30秒

    const timer = setInterval(() => {
      const connectionInfo = this.connections.get(sessionId);
      if (!connectionInfo || connectionInfo.ws.readyState !== 1) {
        this.stopHeartbeat(sessionId);
        return;
      }

      this.sendData(sessionId, {
        type: 'ping',
        timestamp: Date.now()
      }, { immediate: true });
    }, heartbeatInterval);

    this.heartbeatTimers.set(sessionId, timer);
  }

  /**
   * 停止心跳
   * @param {string} sessionId 会话ID
   */
  stopHeartbeat(sessionId) {
    if (this.heartbeatTimers.has(sessionId)) {
      clearInterval(this.heartbeatTimers.get(sessionId));
      this.heartbeatTimers.delete(sessionId);
    }
  }

  /**
   * 获取统计信息
   * @returns {Object} 统计数据
   */
  getStats() {
    const uptime = Date.now() - this.stats.startTime;
    const messagesPerSecond = this.stats.totalMessages / (uptime / 1000);
    const compressionRatio = this.stats.compressedBytes / (this.stats.totalBytes || 1);

    return {
      ...this.stats,
      uptime,
      messagesPerSecond: parseFloat(messagesPerSecond.toFixed(2)),
      compressionRatio: parseFloat(compressionRatio.toFixed(3)),
      activeConnections: this.connections.size,
      activeBatchQueues: this.batchQueues.size,
      activeHeartbeats: this.heartbeatTimers.size
    };
  }

  /**
   * 获取所有连接信息
   * @returns {Array} 连接列表
   */
  getAllConnections() {
    return Array.from(this.connections.values()).map(conn => ({
      sessionId: conn.sessionId,
      metadata: conn.metadata,
      registeredAt: conn.registeredAt,
      lastActivity: conn.lastActivity,
      messageCount: conn.messageCount,
      bytesSent: conn.bytesSent,
      codec: conn.codec,
      compressionEnabled: conn.compressionEnabled
    }));
  }
}

module.exports = EnhancedDataTransport;
