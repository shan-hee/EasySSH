/**
 * 前端二进制消息编解码器
 * 与服务端保持一致的协议实现
 */

import { BINARY_MESSAGE_TYPES, BINARY_PROTOCOL, CONNECTION_STATUS } from './constants.js';

/**
 * 二进制消息编码器
 */
export class BinaryMessageEncoder {
  static MAGIC_NUMBER = BINARY_PROTOCOL.MAGIC_NUMBER;
  static VERSION = BINARY_PROTOCOL.VERSION;

  /**
   * 编码二进制消息
   * @param {number} messageType 消息类型
   * @param {Object} headerData 头部数据
   * @param {ArrayBuffer|Uint8Array} payloadData 载荷数据
   * @returns {ArrayBuffer} 编码后的消息
   */
  static encode(messageType, headerData, payloadData = null) {
    try {
      // 编码header为UTF-8
      const headerString = JSON.stringify(headerData);
      const headerBuffer = new TextEncoder().encode(headerString);
      const headerLength = headerBuffer.length;

      // 计算总长度
      const payloadLength = payloadData ? payloadData.byteLength : 0;
      const totalLength = 10 + headerLength + payloadLength; // 10 = 4+1+1+4

      // 创建消息缓冲区
      const messageBuffer = new ArrayBuffer(totalLength);
      const dataView = new DataView(messageBuffer);
      const uint8View = new Uint8Array(messageBuffer);

      let offset = 0;

      // 写入Magic Number (大端序)
      dataView.setUint32(offset, this.MAGIC_NUMBER, false);
      offset += 4;

      // 写入Version
      dataView.setUint8(offset, this.VERSION);
      offset += 1;

      // 写入Message Type
      dataView.setUint8(offset, messageType);
      offset += 1;

      // 写入Header Length (大端序)
      dataView.setUint32(offset, headerLength, false);
      offset += 4;

      // 写入Header Data
      uint8View.set(headerBuffer, offset);
      offset += headerLength;

      // 写入Payload Data (如果存在)
      if (payloadData) {
        const payloadView = new Uint8Array(payloadData);
        uint8View.set(payloadView, offset);
      }

      return messageBuffer;
    } catch (error) {
      console.error('二进制消息编码失败:', error);
      throw new Error(`消息编码失败: ${error.message}`);
    }
  }
}

/**
 * 二进制消息解码器
 */
export class BinaryMessageDecoder {
  /**
   * 解码二进制消息
   * @param {ArrayBuffer} messageBuffer 消息缓冲区
   * @returns {Object} 解码后的消息
   */
  static decode(messageBuffer) {
    try {
      if (messageBuffer.byteLength < 10) {
        throw new Error('消息长度不足');
      }

      const dataView = new DataView(messageBuffer);
      let offset = 0;

      // 读取Magic Number
      const magicNumber = dataView.getUint32(offset, false);
      if (magicNumber !== BinaryMessageEncoder.MAGIC_NUMBER) {
        throw new Error(`无效的Magic Number: 0x${magicNumber.toString(16)}`);
      }
      offset += 4;

      // 读取Version
      const version = dataView.getUint8(offset);
      if (version !== BinaryMessageEncoder.VERSION) {
        throw new Error(`不支持的协议版本: ${version}`);
      }
      offset += 1;

      // 读取Message Type
      const messageType = dataView.getUint8(offset);
      offset += 1;

      // 读取Header Length
      const headerLength = dataView.getUint32(offset, false);
      offset += 4;

      // 验证消息长度
      if (messageBuffer.byteLength < 10 + headerLength) {
        throw new Error('消息头长度不匹配');
      }

      // 读取Header Data
      const headerBuffer = messageBuffer.slice(offset, offset + headerLength);
      const headerString = new TextDecoder().decode(headerBuffer);
      const headerData = JSON.parse(headerString);
      offset += headerLength;

      // 读取Payload Data (如果存在)
      let payloadData = null;
      if (offset < messageBuffer.byteLength) {
        payloadData = messageBuffer.slice(offset);
      }

      return {
        version,
        messageType,
        headerData,
        payloadData
      };
    } catch (error) {
      console.error('二进制消息解码失败:', error);
      throw new Error(`消息解码失败: ${error.message}`);
    }
  }
}

/**
 * 二进制消息工具类
 */
export class BinaryMessageUtils {
  /**
   * 判断是否为二进制消息
   * @param {*} data WebSocket接收的数据
   * @returns {boolean}
   */
  static isBinaryMessage(data) {
    return (
      data instanceof ArrayBuffer ||
      data instanceof Uint8Array ||
      (data && typeof data === 'object' && data.constructor === ArrayBuffer)
    );
  }

  /**
   * 创建PING消息
   * @param {Object} options PING选项
   * @returns {ArrayBuffer}
   */
  static createPingMessage(options = {}) {
    const headerData = {
      sessionId: options.sessionId,
      requestId: options.requestId || this.generateRequestId(),
      timestamp: options.timestamp || Date.now(), // 使用传入的timestamp，如果没有则使用当前时间
      clientSendTime: options.clientSendTime || Date.now(),
      measureLatency: options.measureLatency !== false,
      immediate: options.immediate || false,
      client: options.client || 'browser',
      webSocketLatency: options.webSocketLatency // 添加webSocketLatency字段支持
    };

    return BinaryMessageEncoder.encode(BINARY_MESSAGE_TYPES.PING, headerData);
  }

  /**
   * 创建PONG消息
   * @param {Object} options PONG选项
   * @returns {ArrayBuffer}
   */
  static createPongMessage(options = {}) {
    const headerData = {
      sessionId: options.sessionId,
      requestId: options.requestId,
      timestamp: Date.now(),
      serverTime: options.serverTime,
      latency: options.latency || 0,
      originalTimestamp: options.originalTimestamp
    };

    return BinaryMessageEncoder.encode(BINARY_MESSAGE_TYPES.PONG, headerData);
  }

  /**
   * 创建连接消息
   * @param {Object} options 连接选项
   * @returns {ArrayBuffer}
   */
  static createConnectMessage(options = {}) {
    const headerData = {
      sessionId: options.sessionId,
      connectionId: options.connectionId,
      supportsBinary: true,
      protocolVersion: '2.0',
      timestamp: Date.now()
    };

    // 如果包含认证信息，添加到header
    if (options.address) headerData.address = options.address;
    if (options.port) headerData.port = options.port;
    if (options.username) headerData.username = options.username;

    return BinaryMessageEncoder.encode(BINARY_MESSAGE_TYPES.CONNECT, headerData);
  }

  /**
   * 创建认证消息
   * @param {Object} options 认证选项
   * @returns {ArrayBuffer}
   */
  static createAuthenticateMessage(options = {}) {
    const headerData = {
      connectionId: options.connectionId,
      timestamp: Date.now()
    };

    // 添加认证信息
    if (options.encryptedPayload) {
      headerData.encryptedPayload = options.encryptedPayload;
      headerData.keyId = options.keyId;
    }

    if (options.address) headerData.address = options.address;
    if (options.port) headerData.port = options.port;
    if (options.username) headerData.username = options.username;

    return BinaryMessageEncoder.encode(BINARY_MESSAGE_TYPES.AUTHENTICATE, headerData);
  }

  /**
   * 解码连接状态
   * @param {number} statusCode 状态代码
   * @returns {string}
   */
  static decodeConnectionStatus(statusCode) {
    return CONNECTION_STATUS.NAMES[statusCode] || 'error';
  }

  /**
   * 编码连接状态
   * @param {string} status 状态字符串
   * @returns {number}
   */
  static encodeConnectionStatus(status) {
    return CONNECTION_STATUS.CODES[status.toUpperCase()] || CONNECTION_STATUS.CODES.ERROR;
  }

  /**
   * 生成请求ID
   * @returns {string}
   */
  static generateRequestId() {
    if (crypto && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * 获取消息类型名称
   * @param {number} messageType 消息类型代码
   * @returns {string}
   */
  static getMessageTypeName(messageType) {
    for (const [name, code] of Object.entries(BINARY_MESSAGE_TYPES)) {
      if (code === messageType) {
        return name;
      }
    }
    return `UNKNOWN_${messageType}`;
  }

  /**
   * 创建网络延迟测量消息
   * @param {Object} options 延迟测量选项
   * @returns {ArrayBuffer}
   */
  static createNetworkLatencyMessage(options = {}) {
    const headerData = {
      sessionId: options.sessionId,
      latency: options.latency || 0,
      timestamp: Date.now(),
      type: options.type || 'measurement',
      source: options.source || 'client'
    };

    return BinaryMessageEncoder.encode(BINARY_MESSAGE_TYPES.NETWORK_LATENCY, headerData);
  }

  /**
   * 创建SFTP初始化消息
   * @param {Object} options SFTP初始化选项
   * @returns {ArrayBuffer}
   */
  static createSftpInitMessage(options = {}) {
    const headerData = {
      sessionId: options.sessionId,
      operationId: options.operationId,
      timestamp: Date.now()
    };

    return BinaryMessageEncoder.encode(BINARY_MESSAGE_TYPES.SFTP_INIT, headerData);
  }

  /**
   * 创建SFTP列表消息
   * @param {Object} options SFTP列表选项
   * @returns {ArrayBuffer}
   */
  static createSftpListMessage(options = {}) {
    const headerData = {
      sessionId: options.sessionId,
      operationId: options.operationId,
      path: options.path,
      timestamp: Date.now()
    };

    return BinaryMessageEncoder.encode(BINARY_MESSAGE_TYPES.SFTP_LIST, headerData);
  }

  /**
   * 创建SFTP创建目录消息
   * @param {Object} options SFTP创建目录选项
   * @returns {ArrayBuffer}
   */
  static createSftpMkdirMessage(options = {}) {
    const headerData = {
      sessionId: options.sessionId,
      operationId: options.operationId,
      path: options.path,
      timestamp: Date.now()
    };

    return BinaryMessageEncoder.encode(BINARY_MESSAGE_TYPES.SFTP_MKDIR, headerData);
  }

  /**
   * 创建SFTP删除消息
   * @param {Object} options SFTP删除选项
   * @returns {ArrayBuffer}
   */
  static createSftpDeleteMessage(options = {}) {
    const headerData = {
      sessionId: options.sessionId,
      operationId: options.operationId,
      path: options.path,
      isDirectory: options.isDirectory || false,
      timestamp: Date.now()
    };

    return BinaryMessageEncoder.encode(BINARY_MESSAGE_TYPES.SFTP_DELETE, headerData);
  }

  /**
   * 创建SFTP重命名消息
   * @param {Object} options SFTP重命名选项
   * @returns {ArrayBuffer}
   */
  static createSftpRenameMessage(options = {}) {
    const headerData = {
      sessionId: options.sessionId,
      operationId: options.operationId,
      oldPath: options.oldPath,
      newPath: options.newPath,
      timestamp: Date.now()
    };

    return BinaryMessageEncoder.encode(BINARY_MESSAGE_TYPES.SFTP_RENAME, headerData);
  }

  /**
   * 创建SFTP权限修改消息
   * @param {Object} options SFTP权限修改选项
   * @returns {ArrayBuffer}
   */
  static createSftpChmodMessage(options = {}) {
    const headerData = {
      sessionId: options.sessionId,
      operationId: options.operationId,
      path: options.path,
      permissions: options.permissions,
      timestamp: Date.now()
    };

    return BinaryMessageEncoder.encode(BINARY_MESSAGE_TYPES.SFTP_CHMOD, headerData);
  }

  /**
   * 创建SFTP关闭消息
   * @param {Object} options SFTP关闭选项
   * @returns {ArrayBuffer}
   */
  static createSftpCloseMessage(options = {}) {
    const headerData = {
      sessionId: options.sessionId,
      operationId: options.operationId,
      timestamp: Date.now()
    };

    return BinaryMessageEncoder.encode(BINARY_MESSAGE_TYPES.SFTP_CLOSE, headerData);
  }

  /**
   * 创建SFTP取消操作消息
   * @param {Object} options SFTP取消操作选项
   * @returns {ArrayBuffer}
   */
  static createSftpCancelMessage(options = {}) {
    const headerData = {
      sessionId: options.sessionId,
      operationId: options.operationId,
      timestamp: Date.now()
    };

    return BinaryMessageEncoder.encode(BINARY_MESSAGE_TYPES.SFTP_CANCEL, headerData);
  }
}

export default {
  BinaryMessageEncoder,
  BinaryMessageDecoder,
  BinaryMessageUtils
};
