/**
 * 统一的二进制WebSocket协议
 * 用于SSH终端数据和SFTP文件传输的高性能二进制通信
 */

const logger = require('../utils/logger');

// 协议魔数 "ESSH" - 0x45535348
const PROTOCOL_MAGIC = 0x45535348;
const PROTOCOL_VERSION = 0x02; // 版本2：统一协议

/**
 * 扩展的二进制消息类型
 */
const BINARY_MSG_TYPE = {
  // 控制消息 (0x00-0x0F)
  HANDSHAKE: 0x00,
  HEARTBEAT: 0x01,
  ERROR: 0x02,
  
  // SSH终端数据 (0x10-0x1F) 
  SSH_DATA: 0x10,           // SSH终端数据传输
  SSH_RESIZE: 0x11,         // 终端大小调整
  SSH_COMMAND: 0x12,        // 终端命令
  
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
  
  // 响应消息 (0x80-0xFF)
  SUCCESS: 0x80,            // 通用成功响应
  PROGRESS: 0x81,           // 进度更新
  SFTP_SUCCESS: 0x82,       // SFTP成功响应
  SFTP_ERROR: 0x83,         // SFTP错误响应
  SFTP_PROGRESS: 0x84,      // SFTP进度
  SFTP_FILE_DATA: 0x85,     // SFTP文件数据
  SFTP_FOLDER_DATA: 0x86,   // SFTP文件夹数据
  SSH_DATA_ACK: 0x87        // SSH数据确认
};

/**
 * 二进制消息编码器
 * 
 * 消息格式：
 * +--------+--------+--------+--------+--------+--------+...+--------+...+
 * | Magic  |Version | MsgType| HeaderLen (4B) | Header | Payload    |
 * +--------+--------+--------+--------+--------+--------+...+--------+...+
 * | 4字节  | 1字节  | 1字节  |    4字节       |  N字节  |   M字节    |
 * +--------+--------+--------+--------+--------+--------+...+--------+...+
 */
class BinaryMessageEncoder {
  /**
   * 编码消息
   * @param {number} messageType - 消息类型
   * @param {Object} headerData - 头部数据
   * @param {Buffer|ArrayBuffer|null} payloadData - 载荷数据
   * @returns {Buffer} - 编码后的消息
   */
  static encode(messageType, headerData, payloadData = null) {
    try {
      // 序列化头部数据为JSON字符串
      const headerString = JSON.stringify(headerData);
      const headerBuffer = Buffer.from(headerString, 'utf8');
      const headerLength = headerBuffer.length;

      // 计算总长度
      const payloadLength = payloadData ? Buffer.byteLength(payloadData) : 0;
      const totalLength = 10 + headerLength + payloadLength; // 10 = 4+1+1+4

      // 创建消息缓冲区
      const messageBuffer = Buffer.alloc(totalLength);
      let offset = 0;

      // 写入Magic Number (大端序)
      messageBuffer.writeUInt32BE(PROTOCOL_MAGIC, offset);
      offset += 4;

      // 写入Version
      messageBuffer.writeUInt8(PROTOCOL_VERSION, offset);
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
        const payloadBuffer = Buffer.isBuffer(payloadData) 
          ? payloadData 
          : Buffer.from(payloadData);
        payloadBuffer.copy(messageBuffer, offset);
      }

      return messageBuffer;
    } catch (error) {
      logger.error('二进制消息编码失败:', error);
      throw new Error(`消息编码失败: ${error.message}`);
    }
  }
}

/**
 * 二进制消息解码器
 */
class BinaryMessageDecoder {
  /**
   * 解码消息
   * @param {Buffer|ArrayBuffer} messageBuffer - 消息缓冲区
   * @returns {Object} - 解码后的消息 {version, messageType, headerData, payloadData}
   */
  static decode(messageBuffer) {
    try {
      // 确保是Buffer类型
      const buffer = Buffer.isBuffer(messageBuffer) 
        ? messageBuffer 
        : Buffer.from(messageBuffer);

      if (buffer.length < 10) {
        throw new Error('消息长度不足');
      }

      let offset = 0;

      // 读取Magic Number
      const magicNumber = buffer.readUInt32BE(offset);
      if (magicNumber !== PROTOCOL_MAGIC) {
        throw new Error(`无效的Magic Number: 0x${magicNumber.toString(16)}`);
      }
      offset += 4;

      // 读取Version
      const version = buffer.readUInt8(offset);
      if (version !== PROTOCOL_VERSION) {
        throw new Error(`不支持的协议版本: ${version}`);
      }
      offset += 1;

      // 读取Message Type
      const messageType = buffer.readUInt8(offset);
      offset += 1;

      // 读取Header Length
      const headerLength = buffer.readUInt32BE(offset);
      offset += 4;

      // 验证消息长度
      if (buffer.length < 10 + headerLength) {
        throw new Error('消息头长度不匹配');
      }

      // 读取Header Data
      const headerBuffer = buffer.slice(offset, offset + headerLength);
      const headerData = JSON.parse(headerBuffer.toString('utf8'));
      offset += headerLength;

      // 读取Payload Data (如果存在)
      let payloadData = null;
      if (offset < buffer.length) {
        payloadData = buffer.slice(offset);
      }

      return {
        version,
        messageType,
        headerData,
        payloadData
      };
    } catch (error) {
      logger.error('二进制消息解码失败:', error);
      throw new Error(`消息解码失败: ${error.message}`);
    }
  }
}

/**
 * 二进制WebSocket消息发送器
 */
class BinaryMessageSender {
  /**
   * 发送二进制消息
   * @param {WebSocket} ws - WebSocket连接
   * @param {number} messageType - 消息类型
   * @param {Object} headerData - 头部数据
   * @param {Buffer|ArrayBuffer|null} payloadData - 载荷数据
   */
  static send(ws, messageType, headerData, payloadData = null) {
    if (!ws || ws.readyState !== 1) { // WebSocket.OPEN
      throw new Error('WebSocket连接未就绪');
    }

    try {
      const messageBuffer = BinaryMessageEncoder.encode(messageType, headerData, payloadData);
      ws.send(messageBuffer, { binary: true });
      
      // 记录传输统计
      if (global.metricsCollector) {
        global.metricsCollector.recordDataTransfer('outbound', 'binary', messageBuffer.length);
      }
      
      logger.debug('二进制消息已发送', {
        messageType: messageType.toString(16),
        headerSize: JSON.stringify(headerData).length,
        payloadSize: payloadData ? Buffer.byteLength(payloadData) : 0
      });
    } catch (error) {
      logger.error('发送二进制消息失败:', error);
      throw error;
    }
  }

  /**
   * 发送SSH终端数据
   * @param {WebSocket} ws - WebSocket连接
   * @param {string} sessionId - 会话ID
   * @param {Buffer} data - 终端数据
   */
  static sendSSHData(ws, sessionId, data) {
    const headerData = {
      sessionId,
      timestamp: Date.now(),
      dataType: 'terminal'
    };
    
    this.send(ws, BINARY_MSG_TYPE.SSH_DATA, headerData, data);
  }

  /**
   * 发送SSH终端大小调整消息
   * @param {WebSocket} ws - WebSocket连接
   * @param {string} sessionId - 会话ID
   * @param {number} cols - 列数
   * @param {number} rows - 行数
   */
  static sendSSHResize(ws, sessionId, cols, rows) {
    const headerData = {
      sessionId,
      cols,
      rows,
      timestamp: Date.now()
    };
    
    this.send(ws, BINARY_MSG_TYPE.SSH_RESIZE, headerData);
  }

  /**
   * 发送SFTP成功响应
   * @param {WebSocket} ws - WebSocket连接
   * @param {string} sessionId - 会话ID
   * @param {string} operationId - 操作ID
   * @param {Object} data - 附加数据
   * @param {Buffer|null} payloadData - 文件数据
   */
  static sendSftpSuccess(ws, sessionId, operationId, data = {}, payloadData = null) {
    const headerData = {
      sessionId,
      operationId,
      timestamp: Date.now(),
      ...data
    };
    
    this.send(ws, BINARY_MSG_TYPE.SFTP_SUCCESS, headerData, payloadData);
  }

  /**
   * 发送SFTP错误响应
   * @param {WebSocket} ws - WebSocket连接
   * @param {string} sessionId - 会话ID
   * @param {string} operationId - 操作ID
   * @param {string} message - 错误消息
   * @param {string} errorCode - 错误代码
   */
  static sendSftpError(ws, sessionId, operationId, message, errorCode = 'UNKNOWN_ERROR') {
    const headerData = {
      sessionId,
      operationId,
      errorMessage: message,
      errorCode,
      timestamp: Date.now()
    };
    
    this.send(ws, BINARY_MSG_TYPE.SFTP_ERROR, headerData);
  }

  /**
   * 发送进度更新
   * @param {WebSocket} ws - WebSocket连接  
   * @param {string} sessionId - 会话ID
   * @param {string} operationId - 操作ID
   * @param {number} progress - 进度百分比
   * @param {number} bytesTransferred - 已传输字节数
   * @param {number} totalBytes - 总字节数
   */
  static sendProgress(ws, sessionId, operationId, progress, bytesTransferred, totalBytes) {
    const headerData = {
      sessionId,
      operationId,
      progress,
      bytesTransferred,
      totalBytes,
      timestamp: Date.now()
    };
    
    this.send(ws, BINARY_MSG_TYPE.PROGRESS, headerData);
  }
}

/**
 * 检查和验证会话
 * @param {WebSocket} ws - WebSocket连接
 * @param {string} sessionId - 会话ID
 * @param {Map} sessions - 会话映射
 * @param {string} operationId - 操作ID
 * @returns {boolean} - 验证结果
 */
function validateSession(ws, sessionId, sessions, operationId = null) {
  if (!sessionId) {
    const errorMsg = '会话ID为空';
    logger.error(errorMsg, { operationId });
    BinaryMessageSender.send(ws, BINARY_MSG_TYPE.ERROR, {
      operationId,
      errorMessage: errorMsg,
      errorCode: 'INVALID_SESSION_ID'
    });
    return false;
  }

  if (!sessions.has(sessionId)) {
    const errorMsg = `会话不存在: ${sessionId}`;
    logger.error(errorMsg, { operationId, availableSessions: Array.from(sessions.keys()) });
    BinaryMessageSender.send(ws, BINARY_MSG_TYPE.ERROR, {
      operationId,
      errorMessage: errorMsg,
      errorCode: 'SESSION_NOT_FOUND'
    });
    return false;
  }

  return true;
}

/**
 * 安全执行函数
 * @param {Function} fn - 要执行的异步函数
 * @param {WebSocket} ws - WebSocket连接
 * @param {string} errorContext - 错误上下文
 * @param {string} sessionId - 会话ID
 * @param {string} operationId - 操作ID
 * @param {boolean} enableMetrics - 是否启用指标
 */
async function safeExec(fn, ws, errorContext, sessionId, operationId, enableMetrics = true) {
  const startTime = enableMetrics ? Date.now() : 0;
  
  try {
    await fn();
    
    if (enableMetrics) {
      const duration = Date.now() - startTime;
      logger.debug(`操作完成: ${errorContext}`, { sessionId, operationId, duration });
    }
  } catch (error) {
    const duration = enableMetrics ? Date.now() - startTime : 0;
    
    logger.error(`${errorContext}失败`, {
      sessionId,
      operationId,
      error: error.message,
      stack: error.stack,
      duration
    });
    
    // 发送错误响应
    BinaryMessageSender.send(ws, BINARY_MSG_TYPE.ERROR, {
      sessionId,
      operationId,
      errorMessage: `${errorContext}: ${error.message}`,
      errorCode: 'OPERATION_FAILED',
      timestamp: Date.now()
    });
  }
}

module.exports = {
  BINARY_MSG_TYPE,
  PROTOCOL_MAGIC,
  PROTOCOL_VERSION,
  BinaryMessageEncoder,
  BinaryMessageDecoder,  
  BinaryMessageSender,
  validateSession,
  safeExec
};