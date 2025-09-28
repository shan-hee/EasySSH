/**
 * 统一的前端二进制WebSocket协议
 * 用于SSH终端数据和SFTP文件传输的高性能二进制通信
 */

import log from '../log';

// 协议魔数 "ESSH" - 0x45535348
const PROTOCOL_MAGIC = 0x45535348;
const PROTOCOL_VERSION = 0x02; // 版本2：统一协议

/**
 * 扩展的二进制消息类型
 */
export const BINARY_MSG_TYPE = {
  // 控制消息 (0x00-0x0F)
  HANDSHAKE: 0x00,
  HEARTBEAT: 0x01,
  ERROR: 0x02,
  DISCONNECT: 0x07,

  // SSH终端数据 (0x10-0x1F)
  SSH_DATA: 0x10, // SSH终端数据传输
  SSH_RESIZE: 0x11, // 终端大小调整
  SSH_COMMAND: 0x12, // 终端命令

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
  SFTP_CANCEL: 0x2a,

  // 响应消息 (0x80-0xFF)
  SUCCESS: 0x80, // 通用成功响应
  PROGRESS: 0x81, // 进度更新
  SFTP_SUCCESS: 0x80, // SFTP成功响应
  SFTP_ERROR: 0x81, // SFTP错误响应
  SFTP_PROGRESS: 0x82, // SFTP进度
  SFTP_FILE_DATA: 0x83, // SFTP文件数据
  SFTP_FOLDER_DATA: 0x84, // SFTP文件夹数据
  SSH_DATA_ACK: 0x87 // SSH数据确认
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
export class BinaryMessageEncoder {
  /**
   * 编码消息
   * @param {number} messageType - 消息类型
   * @param {Object} headerData - 头部数据
   * @param {ArrayBuffer|Uint8Array|null} payloadData - 载荷数据
   * @returns {ArrayBuffer} - 编码后的消息
   */
  static encode(messageType, headerData, payloadData = null) {
    try {
      // 序列化头部数据为JSON字符串
      const headerString = JSON.stringify(headerData);
      const headerBuffer = new TextEncoder().encode(headerString);
      const headerLength = headerBuffer.length;

      // 计算总长度
      const payloadLength = payloadData ? payloadData.byteLength : 0;
      const totalLength = 10 + headerLength + payloadLength; // 10 = 4+1+1+4

      // 创建消息缓冲区
      const messageBuffer = new ArrayBuffer(totalLength);
      const view = new DataView(messageBuffer);
      let offset = 0;

      // 写入Magic Number (大端序)
      view.setUint32(offset, PROTOCOL_MAGIC, false);
      offset += 4;

      // 写入Version
      view.setUint8(offset, PROTOCOL_VERSION);
      offset += 1;

      // 写入Message Type
      view.setUint8(offset, messageType);
      offset += 1;

      // 写入Header Length (大端序)
      view.setUint32(offset, headerLength, false);
      offset += 4;

      // 写入Header Data
      const messageArray = new Uint8Array(messageBuffer);
      messageArray.set(headerBuffer, offset);
      offset += headerLength;

      // 写入Payload Data (如果存在)
      if (payloadData) {
        const payloadArray = new Uint8Array(payloadData);
        messageArray.set(payloadArray, offset);
      }

      return messageBuffer;
    } catch (error) {
      log.error('二进制消息编码失败:', error);
      throw new Error(`消息编码失败: ${error.message}`);
    }
  }
}

/**
 * 二进制消息解码器
 */
export class BinaryMessageDecoder {
  /**
   * 解码消息
   * @param {ArrayBuffer} messageBuffer - 消息缓冲区
   * @returns {Object} - 解码后的消息 {version, messageType, headerData, payloadData}
   */
  static decode(messageBuffer) {
    try {
      if (messageBuffer.byteLength < 10) {
        throw new Error('消息长度不足');
      }

      const view = new DataView(messageBuffer);
      let offset = 0;

      // 读取Magic Number
      const magicNumber = view.getUint32(offset, false);
      if (magicNumber !== PROTOCOL_MAGIC) {
        throw new Error(`无效的Magic Number: 0x${magicNumber.toString(16)}`);
      }
      offset += 4;

      // 读取Version
      const version = view.getUint8(offset);
      if (version !== PROTOCOL_VERSION) {
        throw new Error(`不支持的协议版本: ${version}`);
      }
      offset += 1;

      // 读取Message Type
      const messageType = view.getUint8(offset);
      offset += 1;

      // 读取Header Length
      const headerLength = view.getUint32(offset, false);
      offset += 4;

      // 验证消息长度
      if (messageBuffer.byteLength < 10 + headerLength) {
        throw new Error('消息头长度不匹配');
      }

      // 读取Header Data
      const headerBuffer = messageBuffer.slice(offset, offset + headerLength);
      const headerData = JSON.parse(new TextDecoder().decode(headerBuffer));
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
      log.error('二进制消息解码失败:', error);
      throw new Error(`消息解码失败: ${error.message}`);
    }
  }
}

/**
 * 二进制WebSocket消息发送器
 */
export class BinaryMessageSender {
  /**
   * 发送二进制消息
   * @param {WebSocket} ws - WebSocket连接
   * @param {number} messageType - 消息类型
   * @param {Object} headerData - 头部数据
   * @param {ArrayBuffer|Uint8Array|null} payloadData - 载荷数据
   */
  static send(ws, messageType, headerData, payloadData = null) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket连接未就绪');
    }

    try {
      const messageBuffer = BinaryMessageEncoder.encode(messageType, headerData, payloadData);
      ws.send(messageBuffer);

      // log.debug('二进制消息已发送', {
      //   messageType: messageType.toString(16),
      //   headerSize: JSON.stringify(headerData).length,
      //   payloadSize: payloadData ? payloadData.byteLength : 0
      // });
    } catch (error) {
      log.error('发送二进制消息失败:', error);
      throw error;
    }
  }

  /**
   * 发送SSH终端数据
   * @param {WebSocket} ws - WebSocket连接
   * @param {string} sessionId - 会话ID
   * @param {string|Uint8Array} data - 终端数据
   */
  static sendSSHData(ws, sessionId, data) {
    const headerData = {
      sessionId,
      timestamp: Date.now(),
      dataType: 'terminal'
    };

    // 转换字符串为Uint8Array
    let payloadData;
    if (typeof data === 'string') {
      payloadData = new TextEncoder().encode(data);
    } else if (data instanceof Uint8Array) {
      payloadData = data;
    } else {
      payloadData = new Uint8Array(data);
    }

    this.send(ws, BINARY_MSG_TYPE.SSH_DATA, headerData, payloadData);
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
   * 发送SSH命令
   * @param {WebSocket} ws - WebSocket连接
   * @param {string} sessionId - 会话ID
   * @param {string} command - 命令
   */
  static sendSSHCommand(ws, sessionId, command) {
    const headerData = {
      sessionId,
      timestamp: Date.now()
    };

    const payloadData = new TextEncoder().encode(command);
    this.send(ws, BINARY_MSG_TYPE.SSH_COMMAND, headerData, payloadData);
  }

}

/**
 * 向后兼容的Base64数据处理器
 */
export class LegacyDataHandler {
  /**
   * 解码Base64终端数据
   * @param {string} base64Data - Base64编码的数据
   * @returns {string} - 解码后的字符串
   */
  static decodeTerminalData(base64Data) {
    try {
      if (typeof window !== 'undefined' && window.TextDecoder) {
        const binary = window.atob(base64Data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });
        return decoder.decode(bytes);
      } else {
        // 降级方案
        return atob(base64Data);
      }
    } catch (error) {
      log.error('Base64解码失败:', error);
      return base64Data; // 解码失败时返回原始数据
    }
  }
}

/**
 * 统一的二进制消息处理器
 */
export class UnifiedBinaryHandler {
  constructor() {
    this.messageHandlers = new Map();
  }

  /**
   * 注册消息处理器
   * @param {number} messageType - 消息类型
   * @param {Function} handler - 处理函数
   */
  registerHandler(messageType, handler) {
    this.messageHandlers.set(messageType, handler);
  }

  /**
   * 处理二进制消息
   * @param {ArrayBuffer} messageBuffer - 消息缓冲区
   */
  async handleMessage(messageBuffer) {
    try {
      const message = BinaryMessageDecoder.decode(messageBuffer);
      const { messageType, headerData, payloadData } = message;

      log.debug('收到统一二进制消息', {
        type: messageType.toString(16),
        sessionId: headerData.sessionId,
        operationId: headerData.operationId,
        payloadSize: payloadData ? payloadData.byteLength : 0
      });

      const handler = this.messageHandlers.get(messageType);
      if (handler) {
        await handler(headerData, payloadData);
      } else {
        log.warn(`未知的二进制消息类型: 0x${messageType.toString(16)}`);
      }
    } catch (error) {
      log.error('处理二进制消息失败:', error);
    }
  }

  /**
   * 处理已解码的消息（避免重复解码）
   * @param {Object} decodedMessage - 已解码的消息对象 {version, messageType, headerData, payloadData}
   */
  async handleDecodedMessage(decodedMessage) {
    try {
      const { messageType, headerData, payloadData } = decodedMessage;

      const handler = this.messageHandlers.get(messageType);
      if (handler) {
        await handler(headerData, payloadData);
      } else {
        log.warn(`未知的二进制消息类型: 0x${messageType.toString(16)}`);
      }
    } catch (error) {
      log.error('处理已解码消息失败:', error);
    }
  }
}

export default {
  BINARY_MSG_TYPE,
  BinaryMessageEncoder,
  BinaryMessageDecoder,
  BinaryMessageSender,
  LegacyDataHandler,
  UnifiedBinaryHandler
};
