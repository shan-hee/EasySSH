"use strict";
// 移除 ts-nocheck：为 SSH/SFTP 工具补充类型标注
/**
 * 通用工具模块
 * 用于提供SSH和SFTP共用的功能
 */
Object.defineProperty(exports, "__esModule", { value: true });
const logger = require('../utils/logger');
const crypto = require('crypto');
/**
 * WebSocket状态常量
 */
const WS_STATE = {
    OPEN: 1
};
/**
 * 消息类型常量
 */
const MSG_TYPE = {
    ERROR: 'error',
    SUCCESS: 'sftp_success',
    ERROR_SFTP: 'sftp_error',
    PROGRESS: 'sftp_progress',
    READY: 'sftp_ready',
    FILE: 'sftp_file',
    CONNECTED: 'connected',
    CLOSED: 'closed',
    DISCONNECTED: 'disconnected',
    ABORT: 'abort',
    DATA: 'data',
    PONG: 'pong',
    NETWORK_LATENCY: 'network_latency',
    CONFIRM: 'sftp_confirm'
};
/**
 * 二进制消息类型常量
 */
const BINARY_MSG_TYPE = {
    // 控制消息 (0x00-0x0F)
    HANDSHAKE: 0x00,
    HEARTBEAT: 0x01,
    ERROR: 0x02,
    PING: 0x03,
    PONG: 0x04,
    CONNECT: 0x05,
    AUTHENTICATE: 0x06,
    DISCONNECT: 0x07,
    CONNECTION_REGISTERED: 0x08,
    CONNECTED: 0x09,
    NETWORK_LATENCY: 0x0A,
    STATUS_UPDATE: 0x0B,
    ABORT: 0x0C,
    // SSH终端数据 (0x10-0x1F)
    SSH_DATA: 0x10, // SSH终端数据传输
    SSH_RESIZE: 0x11, // 终端大小调整
    SSH_COMMAND: 0x12, // 终端命令
    SSH_DATA_ACK: 0x13, // SSH数据确认
    // SFTP操作 (0x20-0x3F)
    SFTP_INIT: 0x20,
    SFTP_LIST: 0x21,
    SFTP_UPLOAD: 0x22,
    SFTP_DOWNLOAD: 0x23,
    SFTP_MKDIR: 0x24,
    SFTP_DELETE: 0x25,
    SFTP_RENAME: 0x26,
    SFTP_CHMOD: 0x27,
    SFTP_DOWNLOAD_FOLDER: 0x28,
    SFTP_CLOSE: 0x29,
    SFTP_CANCEL: 0x2A,
    // 响应消息 (0x80-0xFF)
    SFTP_SUCCESS: 0x80,
    SFTP_ERROR: 0x81,
    SFTP_PROGRESS: 0x82,
    SFTP_FILE_DATA: 0x83,
    SFTP_FOLDER_DATA: 0x84
};
/**
 * 发送WebSocket消息
 * @param {WebSocket} ws WebSocket连接
 * @param {string} type 消息类型
 * @param {Object} data 消息数据
 */
function sendMessage(ws, type, data) {
    if (ws && ws.readyState === WS_STATE.OPEN) {
        ws.send(JSON.stringify({
            type,
            data
        }));
    }
}
/**
 * 发送错误消息
 * @param {WebSocket} ws WebSocket连接
 * @param {string} message 错误消息
 * @param {string} [sessionId] 会话ID
 * @param {string} [operationId] 操作ID
 * @param {string} [source] 错误源
 */
function sendError(ws, message, sessionId = null, operationId = null, source = null) {
    const data = { message };
    if (sessionId)
        data.sessionId = sessionId;
    if (operationId)
        data.operationId = operationId;
    if (source)
        data.source = source;
    sendMessage(ws, MSG_TYPE.ERROR, data);
}
/**
 * 发送SFTP错误消息
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {string} operationId 操作ID
 * @param {string} message 错误消息
 */
function sendSftpError(ws, sessionId, operationId, message) {
    sendMessage(ws, MSG_TYPE.ERROR_SFTP, {
        sessionId,
        operationId,
        message
    });
}
/**
 * 发送SFTP成功消息
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {string} operationId 操作ID
 * @param {Object} additionalData 附加数据
 */
function sendSftpSuccess(ws, sessionId, operationId, additionalData = {}) {
    const data = {
        sessionId,
        operationId,
        ...additionalData
    };
    // 检查WebSocket状态
    if (!ws || ws.readyState !== WS_STATE.OPEN) {
        logger.error('发送SFTP成功消息失败: WebSocket未就绪');
        return;
    }
    try {
        sendMessage(ws, MSG_TYPE.SUCCESS, data);
    }
    catch (error) {
        logger.error('发送SFTP成功消息出错', { error: error.message });
    }
}
/**
 * 发送SFTP进度消息
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {string} operationId 操作ID
 * @param {number} progress 进度百分比
 * @param {number} processed 已处理字节数
 * @param {number} total 总字节数
 */
function sendSftpProgress(ws, sessionId, operationId, progress, processed, total) {
    sendMessage(ws, MSG_TYPE.PROGRESS, {
        sessionId,
        operationId,
        progress,
        processed,
        total
    });
}
/**
 * 验证SSH会话是否有效
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {Map} sessions 会话集合
 * @param {string} [operationId] 操作ID
 * @returns {boolean} 会话是否有效
 */
function validateSshSession(ws, sessionId, sessions, operationId = null) {
    if (!sessionId) {
        sendError(ws, '会话ID不能为空', sessionId, operationId);
        return false;
    }
    if (!sessions.has(sessionId)) {
        sendError(ws, '无效的会话ID', sessionId, operationId);
        return false;
    }
    return true;
}
/**
 * 验证SFTP会话是否有效
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {Map} sftpSessions SFTP会话集合
 * @param {string} operationId 操作ID
 * @returns {boolean} 会话是否有效
 */
function validateSftpSession(ws, sessionId, sftpSessions, operationId) {
    if (!sessionId) {
        sendSftpError(ws, sessionId, operationId, '会话ID不能为空');
        return false;
    }
    if (!sftpSessions.has(sessionId)) {
        sendSftpError(ws, sessionId, operationId, '无效的SFTP会话');
        return false;
    }
    return true;
}
/**
 * 安全执行函数，包装异常处理
 * @param {function} fn 要执行的函数
 * @param {WebSocket} ws WebSocket连接
 * @param {string} errorPrefix 错误前缀
 * @param {string} sessionId 会话ID
 * @param {string} operationId 操作ID
 * @param {boolean} isSftp 是否是SFTP操作
 */
async function safeExec(fn, ws, errorPrefix, sessionId, operationId, isSftp = true) {
    try {
        return await fn();
    }
    catch (err) {
        if (isSftp) {
            sendSftpError(ws, sessionId, operationId, `${errorPrefix}: ${err.message}`);
        }
        else {
            sendError(ws, `${errorPrefix}: ${err.message}`, sessionId);
        }
        return null;
    }
}
/**
 * 记录操作活动
 * @param {Object} session 会话对象
 */
function recordActivity(session) {
    if (session) {
        session.lastActivity = new Date();
    }
}
/**
 * 构建标准日志消息
 * @param {string} action 操作名称
 * @param {string} target 操作目标
 * @param {string} [result='成功'] 操作结果
 * @param {string} [details=''] 详细信息
 * @returns {string} 格式化的日志消息
 */
function logMessage(action, target, result = '成功', details = '') {
    return `${action} ${target} ${result}${details ? `: ${details}` : ''}`;
}
/**
 * 二进制消息编码器
 */
class BinaryMessageEncoder {
    /**
     * 编码二进制消息
     * @param {number} messageType 消息类型
     * @param {Object} headerData 头部数据
     * @param {Buffer} payloadData 载荷数据
     * @returns {Buffer} 编码后的消息
     */
    static encode(messageType, headerData, payloadData = null) {
        try {
            // 编码header为UTF-8
            const headerBuffer = Buffer.from(JSON.stringify(headerData), 'utf8');
            const headerLength = headerBuffer.length;
            // 计算总长度
            const payloadLength = payloadData ? payloadData.length : 0;
            const totalLength = 10 + headerLength + payloadLength; // 10 = 4+1+1+4
            // 创建消息缓冲区
            const messageBuffer = Buffer.allocUnsafe(totalLength);
            let offset = 0;
            // 写入Magic Number (大端序)
            messageBuffer.writeUInt32BE(this.MAGIC_NUMBER, offset);
            offset += 4;
            // 写入Version
            messageBuffer.writeUInt8(this.VERSION, offset);
            offset += 1;
            // 写入Message Type
            messageBuffer.writeUInt8(messageType, offset);
            offset += 1;
            // 写入Header Length (大端序)
            messageBuffer.writeUInt32BE(headerLength, offset);
            offset += 4;
            // 写入Header Data
            headerBuffer.copy(messageBuffer, offset);
            offset += headerLength;
            // 写入Payload Data (如果存在)
            if (payloadData) {
                payloadData.copy(messageBuffer, offset);
            }
            return messageBuffer;
        }
        catch (error) {
            logger.error('二进制消息编码失败:', error);
            throw new Error(`消息编码失败: ${error.message}`);
        }
    }
}
BinaryMessageEncoder.MAGIC_NUMBER = 0x45535348; // "ESSH"
BinaryMessageEncoder.VERSION = 0x02;
/**
 * 二进制消息解码器
 */
class BinaryMessageDecoder {
    /**
     * 解码二进制消息
     * @param {Buffer} messageBuffer 消息缓冲区
     * @returns {Object} 解码后的消息
     */
    static decode(messageBuffer) {
        try {
            if (messageBuffer.length < 10) {
                throw new Error('消息长度不足');
            }
            let offset = 0;
            // 读取Magic Number
            const magicNumber = messageBuffer.readUInt32BE(offset);
            if (magicNumber !== BinaryMessageEncoder.MAGIC_NUMBER) {
                throw new Error(`无效的Magic Number: 0x${magicNumber.toString(16)}`);
            }
            offset += 4;
            // 读取Version
            const version = messageBuffer.readUInt8(offset);
            if (version !== BinaryMessageEncoder.VERSION) {
                throw new Error(`不支持的协议版本: ${version}`);
            }
            offset += 1;
            // 读取Message Type
            const messageType = messageBuffer.readUInt8(offset);
            offset += 1;
            // 读取Header Length
            const headerLength = messageBuffer.readUInt32BE(offset);
            offset += 4;
            // 验证消息长度
            if (messageBuffer.length < 10 + headerLength) {
                throw new Error('消息头长度不匹配');
            }
            // 读取Header Data
            const headerBuffer = messageBuffer.slice(offset, offset + headerLength);
            const headerData = JSON.parse(headerBuffer.toString('utf8'));
            offset += headerLength;
            // 读取Payload Data (如果存在)
            let payloadData = null;
            if (offset < messageBuffer.length) {
                payloadData = messageBuffer.slice(offset);
            }
            return {
                version,
                messageType,
                headerData,
                payloadData
            };
        }
        catch (error) {
            logger.error('二进制消息解码失败:', error);
            throw new Error(`消息解码失败: ${error.message}`);
        }
    }
}
/**
 * 分块传输管理器
 */
class ChunkedTransfer {
    /**
     * 计算分块参数
     * @param {number} fileSize 文件大小
     * @returns {Object} 分块参数
     */
    static calculateChunks(fileSize) {
        const chunkSize = Math.max(this.CHUNK_SIZE, Math.ceil(fileSize / this.MAX_CHUNKS));
        const totalChunks = Math.ceil(fileSize / chunkSize);
        return { chunkSize, totalChunks };
    }
    /**
     * 创建分块头部
     * @param {Object} baseHeader 基础头部
     * @param {number} chunkIndex 分块索引
     * @param {number} totalChunks 总分块数
     * @param {number} chunkSize 分块大小
     * @returns {Object} 分块头部
     */
    static createChunkHeader(baseHeader, chunkIndex, totalChunks, chunkSize) {
        return {
            ...baseHeader,
            chunkIndex,
            totalChunks,
            chunkSize,
            isChunked: totalChunks > 1
        };
    }
}
ChunkedTransfer.CHUNK_SIZE = 1024 * 1024; // 1MB per chunk
ChunkedTransfer.MAX_CHUNKS = 1000; // 最大分块数
/**
 * 分块重组器
 */
class ChunkReassembler {
    constructor() {
        this.chunks = new Map(); // operationId -> chunks
    }
    /**
     * 添加分块
     * @param {string} operationId 操作ID
     * @param {number} chunkIndex 分块索引
     * @param {number} totalChunks 总分块数
     * @param {Buffer} chunkData 分块数据
     * @returns {Buffer|null} 完整数据或null
     */
    addChunk(operationId, chunkIndex, totalChunks, chunkData) {
        if (!this.chunks.has(operationId)) {
            this.chunks.set(operationId, {
                totalChunks,
                receivedChunks: new Map(),
                totalSize: 0
            });
        }
        const transfer = this.chunks.get(operationId);
        transfer.receivedChunks.set(chunkIndex, chunkData);
        transfer.totalSize += chunkData.length;
        // 检查是否完成
        if (transfer.receivedChunks.size === totalChunks) {
            return this.reassembleChunks(operationId);
        }
        return null; // 未完成
    }
    /**
     * 重组分块
     * @param {string} operationId 操作ID
     * @returns {Buffer} 完整数据
     */
    reassembleChunks(operationId) {
        const transfer = this.chunks.get(operationId);
        const chunks = [];
        // 按顺序组装分块
        for (let i = 0; i < transfer.totalChunks; i++) {
            const chunk = transfer.receivedChunks.get(i);
            if (!chunk) {
                throw new Error(`缺少分块 ${i}`);
            }
            chunks.push(chunk);
        }
        // 清理
        this.chunks.delete(operationId);
        return Buffer.concat(chunks);
    }
    /**
     * 清理超时的传输
     * @param {number} timeoutMs 超时时间(毫秒)
     */
    cleanupTimeouts(timeoutMs = 300000) {
        const now = Date.now();
        for (const [operationId, transfer] of this.chunks.entries()) {
            if (transfer && transfer.startTime && (now - transfer.startTime > timeoutMs)) {
                this.chunks.delete(operationId);
                logger.warn(`清理超时的分块传输: ${operationId}`);
            }
        }
    }
    /**
     * 丢弃指定操作ID的分块缓存
     * @param {string} operationId
     */
    discard(operationId) {
        if (this.chunks.has(operationId)) {
            this.chunks.delete(operationId);
        }
    }
}
/**
 * 校验和验证器
 */
class ChecksumValidator {
    /**
     * 计算SHA256校验和
     * @param {Buffer} data 数据
     * @returns {string} 校验和
     */
    static calculateSHA256(data) {
        return crypto.createHash('sha256').update(data).digest('hex');
    }
    /**
     * 验证校验和
     * @param {Buffer} data 数据
     * @param {string} expectedChecksum 期望的校验和
     * @returns {boolean} 是否匹配
     */
    static validateChecksum(data, expectedChecksum) {
        const actualChecksum = this.calculateSHA256(data);
        return actualChecksum === expectedChecksum;
    }
}
/**
 * 发送二进制消息
 * @param {WebSocket} ws WebSocket连接
 * @param {number} messageType 消息类型
 * @param {Object} headerData 头部数据
 * @param {Buffer} payloadData 载荷数据
 */
function sendBinaryMessage(ws, messageType, headerData, payloadData = null) {
    if (ws && ws.readyState === WS_STATE.OPEN) {
        try {
            const messageBuffer = BinaryMessageEncoder.encode(messageType, headerData, payloadData);
            ws.send(messageBuffer);
        }
        catch (error) {
            logger.error('发送二进制消息失败:', error);
        }
    }
}
/**
 * 发送二进制SFTP成功消息
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {string} operationId 操作ID
 * @param {Object} additionalData 附加数据
 * @param {Buffer} payloadData 载荷数据
 */
function sendBinarySftpSuccess(ws, sessionId, operationId, additionalData = {}, payloadData = null) {
    const headerData = {
        sessionId,
        operationId,
        timestamp: Date.now(),
        ...additionalData
    };
    sendBinaryMessage(ws, BINARY_MSG_TYPE.SFTP_SUCCESS, headerData, payloadData);
}
/**
 * 发送二进制SFTP错误消息
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {string} operationId 操作ID
 * @param {string} errorMessage 错误消息
 * @param {string} errorCode 错误代码
 */
function sendBinarySftpError(ws, sessionId, operationId, errorMessage, errorCode = 'UNKNOWN_ERROR') {
    const headerData = {
        sessionId,
        operationId,
        errorCode,
        errorMessage,
        timestamp: Date.now()
    };
    sendBinaryMessage(ws, BINARY_MSG_TYPE.SFTP_ERROR, headerData);
}
/**
 * 发送二进制PING消息
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data PING数据
 */
function sendBinaryPing(ws, data) {
    const headerData = {
        sessionId: data.sessionId,
        requestId: data.requestId || generateRequestId(),
        timestamp: Date.now(),
        clientSendTime: data.clientSendTime,
        measureLatency: data.measureLatency || true,
        immediate: data.immediate || false,
        client: data.client || 'server'
    };
    sendBinaryMessage(ws, BINARY_MSG_TYPE.PING, headerData);
}
/**
 * 发送二进制PONG消息
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data PONG数据
 */
function sendBinaryPong(ws, data) {
    const headerData = {
        sessionId: data.sessionId,
        requestId: data.requestId,
        timestamp: data.timestamp || Date.now(),
        serverTime: data.serverTime || Date.now(),
        latency: data.latency || 0,
        originalTimestamp: data.originalTimestamp,
        originTimestamp: data.originTimestamp, // 保持兼容性
        serverReceiveTime: data.serverReceiveTime,
        serverSendTime: data.serverSendTime
    };
    sendBinaryMessage(ws, BINARY_MSG_TYPE.PONG, headerData);
}
/**
 * 发送二进制连接注册确认消息
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 连接数据
 */
function sendBinaryConnectionRegistered(ws, data) {
    const headerData = {
        connectionId: data.connectionId,
        sessionId: data.sessionId,
        status: encodeConnectionStatus(data.status),
        timestamp: Date.now(),
        needAuth: data.status === 'need_auth'
    };
    sendBinaryMessage(ws, BINARY_MSG_TYPE.CONNECTION_REGISTERED, headerData);
}
/**
 * 发送二进制连接完成消息
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 连接数据
 */
function sendBinaryConnected(ws, data) {
    const headerData = {
        sessionId: data.sessionId,
        connectionId: data.connectionId,
        status: encodeConnectionStatus('connected'),
        timestamp: Date.now(),
        serverInfo: data.serverInfo || {}
    };
    sendBinaryMessage(ws, BINARY_MSG_TYPE.CONNECTED, headerData);
}
/**
 * 发送二进制网络延迟消息
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 延迟数据
 */
function sendBinaryNetworkLatency(ws, data) {
    const headerData = {
        sessionId: data.sessionId,
        clientLatency: data.clientLatency || 0,
        serverLatency: data.serverLatency || 0,
        totalLatency: data.totalLatency || 0,
        timestamp: data.timestamp || Date.now(),
        type: data.type || 'measurement',
        source: data.source || 'server'
    };
    sendBinaryMessage(ws, BINARY_MSG_TYPE.NETWORK_LATENCY, headerData);
}
/**
 * 编码连接状态为数字
 * @param {string} status 状态字符串
 * @returns {number} 状态数字
 */
function encodeConnectionStatus(status) {
    const statusMap = {
        'connecting': 0,
        'connected': 1,
        'disconnecting': 2,
        'disconnected': 3,
        'need_auth': 4,
        'authenticating': 5,
        'reconnected': 6,
        'error': 7
    };
    return statusMap[status] || 7;
}
/**
 * 解码连接状态数字为字符串
 * @param {number} statusCode 状态数字
 * @returns {string} 状态字符串
 */
function decodeConnectionStatus(statusCode) {
    const statusMap = {
        0: 'connecting',
        1: 'connected',
        2: 'disconnecting',
        3: 'disconnected',
        4: 'need_auth',
        5: 'authenticating',
        6: 'reconnected',
        7: 'error'
    };
    return statusMap[statusCode] || 'error';
}
/**
 * 生成唯一请求ID
 * @returns {string} 请求ID
 */
function generateRequestId() {
    return crypto.randomUUID ? crypto.randomUUID() :
        `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
// 导出所有函数和常量
module.exports = {
    WS_STATE,
    MSG_TYPE,
    BINARY_MSG_TYPE,
    sendMessage,
    sendError,
    sendSftpError,
    sendSftpSuccess,
    sendSftpProgress,
    sendBinaryMessage,
    sendBinarySftpSuccess,
    sendBinarySftpError,
    sendBinaryPing,
    sendBinaryPong,
    sendBinaryConnectionRegistered,
    sendBinaryConnected,
    sendBinaryNetworkLatency,
    encodeConnectionStatus,
    decodeConnectionStatus,
    generateRequestId,
    validateSshSession,
    validateSftpSession,
    safeExec,
    recordActivity,
    logMessage,
    BinaryMessageEncoder,
    BinaryMessageDecoder,
    ChunkedTransfer,
    ChunkReassembler,
    ChecksumValidator
};
