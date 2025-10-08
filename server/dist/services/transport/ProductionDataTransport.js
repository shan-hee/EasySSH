"use strict";
// @ts-nocheck
/**
 * 生产级数据传输管理器
 * 优化WebSocket数据传输，避免压缩冲突，提供高效可靠的数据传输
 *
 * @author EasySSH Team
 * @version 2.0.0
 * @since 2025-08-01
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductionDataTransport = void 0;
const events_1 = require("events");
const zlib_1 = require("zlib");
const util_1 = require("util");
const logger_js_1 = __importDefault(require("../../utils/logger.js"));
const gzipAsync = (0, util_1.promisify)(zlib_1.gzip);
const gunzipAsync = (0, util_1.promisify)(zlib_1.gunzip);
/**
 * 数据传输配置
 */
const TRANSPORT_CONFIG = {
    // 压缩配置
    compression: {
        enabled: false, // 禁用应用层压缩，使用WebSocket层压缩
        threshold: 1024, // 压缩阈值（字节）
        level: 6, // 压缩级别 (1-9)
        chunkSize: 16384 // 分块大小
    },
    // 批量传输配置
    batching: {
        enabled: true,
        maxBatchSize: 10, // 最大批量大小
        maxBatchDelay: 100, // 最大批量延迟（毫秒）
        maxBatchBytes: 64 * 1024 // 最大批量字节数
    },
    // 重试配置
    retry: {
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 10000,
        backoffFactor: 2
    },
    // 性能配置
    performance: {
        enableMetrics: true,
        metricsInterval: 30000, // 30秒
        maxQueueSize: 1000,
        maxMemoryUsage: 50 * 1024 * 1024 // 50MB
    }
};
/**
 * 生产级数据传输管理器
 */
class ProductionDataTransport extends events_1.EventEmitter {
    constructor(options = {}) {
        super();
        this.config = { ...TRANSPORT_CONFIG, ...options };
        this.connections = new Map(); // WebSocket连接管理
        this.messageQueue = new Map(); // 消息队列
        this.batchTimers = new Map(); // 批量定时器
        this.retryQueues = new Map(); // 重试队列
        // 性能指标
        this.metrics = {
            totalMessages: 0,
            totalBytes: 0,
            compressedBytes: 0,
            batchedMessages: 0,
            failedMessages: 0,
            retryAttempts: 0,
            averageLatency: 0,
            peakMemoryUsage: 0,
            startTime: Date.now()
        };
        // 启动性能监控
        if (this.config.performance.enableMetrics) {
            this.startMetricsCollection();
        }
    }
    /**
     * 注册WebSocket连接
     */
    registerConnection(connectionId, websocket, options = {}) {
        const connection = {
            id: connectionId,
            websocket,
            options: { ...options },
            isAlive: true,
            lastPing: Date.now(),
            messageCount: 0,
            bytesSent: 0,
            bytesReceived: 0,
            registeredAt: Date.now()
        };
        this.connections.set(connectionId, connection);
        this.messageQueue.set(connectionId, []);
        // 设置WebSocket事件监听
        this.setupWebSocketEvents(connection);
        logger_js_1.default.info('WebSocket连接已注册', {
            connectionId,
            totalConnections: this.connections.size
        });
        this.emit('connectionRegistered', connection);
        return connection;
    }
    /**
     * 设置WebSocket事件监听
     */
    setupWebSocketEvents(connection) {
        const { websocket, id } = connection;
        websocket.on('close', (code, reason) => {
            this.handleConnectionClose(id, code, reason);
        });
        websocket.on('error', (error) => {
            this.handleConnectionError(id, error);
        });
        websocket.on('pong', () => {
            connection.lastPing = Date.now();
            connection.isAlive = true;
        });
        // 定期心跳检测
        const heartbeatInterval = setInterval(() => {
            if (!connection.isAlive) {
                logger_js_1.default.warn('WebSocket连接心跳超时', { connectionId: id });
                websocket.terminate();
                return;
            }
            connection.isAlive = false;
            websocket.ping();
        }, 30000);
        connection.heartbeatInterval = heartbeatInterval;
    }
    /**
     * 发送数据
     */
    async sendData(connectionId, data, options = {}) {
        const connection = this.connections.get(connectionId);
        if (!connection) {
            throw new Error(`连接不存在: ${connectionId}`);
        }
        const message = {
            id: this.generateMessageId(),
            connectionId,
            data,
            options: { ...options },
            timestamp: Date.now(),
            attempts: 0
        };
        try {
            if (this.config.batching.enabled && !options.immediate) {
                await this.addToBatch(message);
            }
            else {
                await this.sendMessage(message);
            }
        }
        catch (error) {
            logger_js_1.default.error('发送数据失败', {
                connectionId,
                messageId: message.id,
                error: error.message
            });
            if (options.retry !== false) {
                await this.addToRetryQueue(message, error);
            }
            throw error;
        }
    }
    /**
     * 添加到批量队列
     */
    async addToBatch(message) {
        const { connectionId } = message;
        const queue = this.messageQueue.get(connectionId);
        if (!queue) {
            throw new Error(`消息队列不存在: ${connectionId}`);
        }
        queue.push(message);
        // 检查是否需要立即发送批量
        const shouldSendBatch = queue.length >= this.config.batching.maxBatchSize ||
            this.calculateQueueSize(queue) >= this.config.batching.maxBatchBytes;
        if (shouldSendBatch) {
            await this.sendBatch(connectionId);
        }
        else {
            // 设置批量定时器
            this.scheduleBatchSend(connectionId);
        }
    }
    /**
     * 调度批量发送
     */
    scheduleBatchSend(connectionId) {
        // 清除现有定时器
        const existingTimer = this.batchTimers.get(connectionId);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }
        // 设置新定时器
        const timer = setTimeout(async () => {
            try {
                await this.sendBatch(connectionId);
            }
            catch (error) {
                logger_js_1.default.error('批量发送失败', { connectionId, error: error.message });
            }
        }, this.config.batching.maxBatchDelay);
        this.batchTimers.set(connectionId, timer);
    }
    /**
     * 发送批量消息
     */
    async sendBatch(connectionId) {
        const queue = this.messageQueue.get(connectionId);
        if (!queue || queue.length === 0) {
            return;
        }
        // 清除批量定时器
        const timer = this.batchTimers.get(connectionId);
        if (timer) {
            clearTimeout(timer);
            this.batchTimers.delete(connectionId);
        }
        // 提取所有消息
        const messages = queue.splice(0);
        if (messages.length === 1) {
            // 单个消息直接发送
            await this.sendMessage(messages[0]);
        }
        else {
            // 创建批量消息
            const batchMessage = {
                id: this.generateMessageId(),
                connectionId,
                data: {
                    type: 'batch',
                    timestamp: Date.now(),
                    items: messages.map(msg => ({
                        id: msg.id,
                        type: msg.data.type || 'data',
                        timestamp: msg.timestamp,
                        ...msg.data
                    }))
                },
                options: { batch: true },
                timestamp: Date.now(),
                attempts: 0
            };
            await this.sendMessage(batchMessage);
            this.metrics.batchedMessages += messages.length;
        }
    }
    /**
     * 发送单个消息
     */
    async sendMessage(message) {
        const connection = this.connections.get(message.connectionId);
        if (!connection) {
            throw new Error(`连接不存在: ${message.connectionId}`);
        }
        const { websocket } = connection;
        if (websocket.readyState !== websocket.OPEN) {
            throw new Error(`WebSocket连接未就绪: ${message.connectionId}`);
        }
        try {
            const startTime = Date.now();
            // 序列化数据
            let payload = JSON.stringify(message.data);
            let compressed = false;
            // 应用层压缩（如果启用）
            if (this.config.compression.enabled &&
                payload.length > this.config.compression.threshold) {
                const compressedBuffer = await gzipAsync(Buffer.from(payload));
                if (compressedBuffer.length < payload.length * 0.8) {
                    payload = compressedBuffer;
                    compressed = true;
                }
            }
            // 发送数据
            if (compressed) {
                websocket.send(payload, { binary: true });
            }
            else {
                websocket.send(payload);
            }
            // 更新统计
            const duration = Date.now() - startTime;
            this.updateMetrics(message, payload.length, duration);
            connection.messageCount++;
            connection.bytesSent += payload.length;
            logger_js_1.default.debug('消息发送成功', {
                connectionId: message.connectionId,
                messageId: message.id,
                size: payload.length,
                compressed,
                duration
            });
        }
        catch (error) {
            this.metrics.failedMessages++;
            throw error;
        }
    }
    /**
     * 添加到重试队列
     */
    async addToRetryQueue(message, error) {
        const { connectionId } = message;
        if (message.attempts >= this.config.retry.maxAttempts) {
            logger_js_1.default.error('消息重试次数超限', {
                connectionId,
                messageId: message.id,
                attempts: message.attempts
            });
            return;
        }
        let retryQueue = this.retryQueues.get(connectionId);
        if (!retryQueue) {
            retryQueue = [];
            this.retryQueues.set(connectionId, retryQueue);
        }
        message.attempts++;
        message.lastError = error.message;
        message.nextRetryAt = Date.now() + this.calculateRetryDelay(message.attempts);
        retryQueue.push(message);
        this.metrics.retryAttempts++;
        // 调度重试
        setTimeout(() => {
            this.processRetryQueue(connectionId);
        }, this.calculateRetryDelay(message.attempts));
    }
    /**
     * 处理重试队列
     */
    async processRetryQueue(connectionId) {
        const retryQueue = this.retryQueues.get(connectionId);
        if (!retryQueue || retryQueue.length === 0) {
            return;
        }
        const now = Date.now();
        const readyMessages = retryQueue.filter(msg => msg.nextRetryAt <= now);
        for (const message of readyMessages) {
            try {
                await this.sendMessage(message);
                // 从重试队列中移除成功的消息
                const index = retryQueue.indexOf(message);
                if (index > -1) {
                    retryQueue.splice(index, 1);
                }
            }
            catch (error) {
                // 重新添加到重试队列
                await this.addToRetryQueue(message, error);
            }
        }
    }
    /**
     * 计算重试延迟
     */
    calculateRetryDelay(attempts) {
        const delay = this.config.retry.baseDelay *
            Math.pow(this.config.retry.backoffFactor, attempts - 1);
        return Math.min(delay, this.config.retry.maxDelay);
    }
    /**
     * 计算队列大小
     */
    calculateQueueSize(queue) {
        return queue.reduce((total, message) => {
            return total + JSON.stringify(message.data).length;
        }, 0);
    }
    /**
     * 更新性能指标
     */
    updateMetrics(message, bytesSent, duration) {
        this.metrics.totalMessages++;
        this.metrics.totalBytes += bytesSent;
        // 更新平均延迟
        const totalMessages = this.metrics.totalMessages;
        this.metrics.averageLatency =
            (this.metrics.averageLatency * (totalMessages - 1) + duration) / totalMessages;
    }
    /**
     * 生成消息ID
     */
    generateMessageId() {
        return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    /**
     * 处理连接关闭
     */
    handleConnectionClose(connectionId, code, reason) {
        const connection = this.connections.get(connectionId);
        if (!connection)
            return;
        // 清理资源
        if (connection.heartbeatInterval) {
            clearInterval(connection.heartbeatInterval);
        }
        const timer = this.batchTimers.get(connectionId);
        if (timer) {
            clearTimeout(timer);
            this.batchTimers.delete(connectionId);
        }
        this.connections.delete(connectionId);
        this.messageQueue.delete(connectionId);
        this.retryQueues.delete(connectionId);
        logger_js_1.default.info('WebSocket连接已关闭', {
            connectionId,
            code,
            reason: reason?.toString(),
            duration: Date.now() - connection.registeredAt
        });
        this.emit('connectionClosed', { connectionId, code, reason });
    }
    /**
     * 处理连接错误
     */
    handleConnectionError(connectionId, error) {
        logger_js_1.default.error('WebSocket连接错误', {
            connectionId,
            error: error.message
        });
        this.emit('connectionError', { connectionId, error });
    }
    /**
     * 启动性能指标收集
     */
    startMetricsCollection() {
        setInterval(() => {
            this.collectMetrics();
        }, this.config.performance.metricsInterval);
    }
    /**
     * 收集性能指标
     */
    collectMetrics() {
        const memoryUsage = process.memoryUsage();
        this.metrics.peakMemoryUsage = Math.max(this.metrics.peakMemoryUsage, memoryUsage.heapUsed);
        const uptime = Date.now() - this.metrics.startTime;
        logger_js_1.default.info('数据传输性能指标', {
            ...this.metrics,
            uptime,
            memoryUsage: {
                heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
                heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
                external: Math.round(memoryUsage.external / 1024 / 1024)
            },
            activeConnections: this.connections.size,
            queuedMessages: Array.from(this.messageQueue.values())
                .reduce((total, queue) => total + queue.length, 0)
        });
    }
    /**
     * 获取连接统计
     */
    getConnectionStats(connectionId) {
        const connection = this.connections.get(connectionId);
        if (!connection)
            return null;
        return {
            id: connection.id,
            isAlive: connection.isAlive,
            messageCount: connection.messageCount,
            bytesSent: connection.bytesSent,
            bytesReceived: connection.bytesReceived,
            uptime: Date.now() - connection.registeredAt,
            queueSize: this.messageQueue.get(connectionId)?.length || 0
        };
    }
    /**
     * 获取全局统计
     */
    getGlobalStats() {
        return {
            ...this.metrics,
            uptime: Date.now() - this.metrics.startTime,
            activeConnections: this.connections.size,
            totalQueuedMessages: Array.from(this.messageQueue.values())
                .reduce((total, queue) => total + queue.length, 0)
        };
    }
    /**
     * 清理资源
     */
    cleanup() {
        // 清理所有定时器
        for (const timer of this.batchTimers.values()) {
            clearTimeout(timer);
        }
        this.batchTimers.clear();
        // 关闭所有连接
        for (const connection of this.connections.values()) {
            if (connection.heartbeatInterval) {
                clearInterval(connection.heartbeatInterval);
            }
            if (connection.websocket.readyState === connection.websocket.OPEN) {
                connection.websocket.close();
            }
        }
        this.connections.clear();
        this.messageQueue.clear();
        this.retryQueues.clear();
        logger_js_1.default.info('数据传输管理器已清理');
    }
}
exports.ProductionDataTransport = ProductionDataTransport;
exports.default = ProductionDataTransport;
