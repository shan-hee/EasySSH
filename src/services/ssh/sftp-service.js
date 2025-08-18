import log from '../log';
import { WS_CONSTANTS } from '../constants';

/**
 * 二进制消息类型常量
 */
const BINARY_MSG_TYPE = {
  // 控制消息 (0x00-0x0F)
  HANDSHAKE: 0x00,
  HEARTBEAT: 0x01,
  ERROR: 0x02,

  // SFTP操作 (0x10-0x2F)
  SFTP_INIT: 0x10,
  SFTP_LIST: 0x11,
  SFTP_UPLOAD: 0x12,
  SFTP_DOWNLOAD: 0x13,
  SFTP_MKDIR: 0x14,
  SFTP_DELETE: 0x15,
  SFTP_RENAME: 0x16,
  SFTP_CHMOD: 0x17,
  SFTP_DOWNLOAD_FOLDER: 0x18,

  // 响应消息 (0x80-0xFF)
  SFTP_SUCCESS: 0x80,
  SFTP_ERROR: 0x81,
  SFTP_PROGRESS: 0x82,
  SFTP_FILE_DATA: 0x83,
  SFTP_FOLDER_DATA: 0x84
};

/**
 * SFTP文件传输功能实现
 * 负责处理SFTP文件列表、上传、下载等操作
 * 支持Base64和二进制两种传输模式
 */
class SFTPService {
  constructor(sshService) {
    this.sshService = sshService;
    this.activeSftpSessions = new Map(); // 存储活动的SFTP会话
    this.fileOperations = new Map(); // 存储文件操作任务
    this.operationId = 0; // 操作ID计数器

    // 从环境变量读取传输配置
    this.chunkSize = parseInt(import.meta.env.VITE_SFTP_CHUNK_SIZE) || 1024 * 1024; // 默认1MB
    this.transferTimeout = parseInt(import.meta.env.VITE_SFTP_TRANSFER_TIMEOUT) || 300000; // 默认5分钟

    this.chunkReassembler = new Map(); // 分块重组器

    // 监听SFTP二进制消息事件
    window.addEventListener('sftp-binary-message', (event) => {
      this.handleBinaryMessage(event.detail.buffer);
    });

    log.debug('SFTP服务初始化完成');
  }

  /**
   * 创建标准化的SFTP消息
   * @param {string} type 消息类型
   * @param {Object} data 消息数据
   * @returns {Object} 标准化的消息对象
   */
  _createSftpMessage(type, data) {
    return {
      type,
      data,
      timestamp: Date.now(),
      version: '2.0'
    };
  }

  /**
   * 二进制消息编码器
   */
  static _encodeBinaryMessage(messageType, headerData, payloadData = null) {
    const MAGIC_NUMBER = 0x45535348; // "ESSH"
    const VERSION = 0x01;

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
      const view = new DataView(messageBuffer);
      let offset = 0;

      // 写入Magic Number (大端序)
      view.setUint32(offset, MAGIC_NUMBER, false);
      offset += 4;

      // 写入Version
      view.setUint8(offset, VERSION);
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

  /**
   * 二进制消息解码器
   */
  static _decodeBinaryMessage(messageBuffer) {
    const MAGIC_NUMBER = 0x45535348; // "ESSH"
    const VERSION = 0x01;

    try {
      if (messageBuffer.byteLength < 10) {
        throw new Error('消息长度不足');
      }

      const view = new DataView(messageBuffer);
      let offset = 0;

      // 读取Magic Number
      const magicNumber = view.getUint32(offset, false);
      if (magicNumber !== MAGIC_NUMBER) {
        throw new Error(`无效的Magic Number: 0x${magicNumber.toString(16)}`);
      }
      offset += 4;

      // 读取Version
      const version = view.getUint8(offset);
      if (version !== VERSION) {
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

  /**
   * 计算SHA256校验和
   */
  static async _calculateSHA256(data) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
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
    
    // 通过终端ID获取实际的SSH会话ID
    let sshSessionId = sessionId;
    
    // 检查是否是终端ID而不是SSH会话ID
    if (!sessionId.startsWith('ssh_') && this.sshService.sessions.size > 0) {
      // 尝试从连接终端ID关联到SSH会话ID
      for (const [id, session] of this.sshService.sessions.entries()) {
        if (session.terminalId && session.terminalId === sessionId) {
          sshSessionId = id;
          log.info(`找到终端ID ${sessionId} 对应的SSH会话ID: ${sshSessionId}`);
          break;
        }
      }
      
      // 如果仍然找不到，可能需要使用其他策略
      if (sshSessionId === sessionId) {
        if (this.sshService.sessions.size === 1) {
          sshSessionId = Array.from(this.sshService.sessions.keys())[0];
          log.info(`未找到终端ID ${sessionId} 的映射，但只有一个SSH会话，使用: ${sshSessionId}`);
        } else {
          log.error(`找不到终端ID ${sessionId} 对应的SSH会话ID`);
        }
      }
    }
    
    // 检查SSH会话是否存在
    if (!this.sshService.sessions.has(sshSessionId)) {
      log.error(`创建SFTP会话失败: SSH会话 ${sshSessionId} 不存在`);
      log.info('可用的SSH会话:', Array.from(this.sshService.sessions.keys()));
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
      if (session.socket && session.socket.readyState === WS_CONSTANTS.OPEN) {
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
                if (message.type === 'sftp_success' && message.data.message === 'SFTP会话已建立') {
                  // 移除消息监听器
                  session.socket.removeEventListener('message', handleSftpInitResponse);
                  clearTimeout(timeout);

                  // 获取SSH会话中的连接信息
                  const connectionInfo = session.connectionInfo || {};

                  // 创建SFTP会话记录
                  this.activeSftpSessions.set(sessionId, {
                    id: sessionId,
                    sshSessionId: sshSessionId, // 保存SSH会话ID
                    currentPath: '/', // 默认根目录
                    isActive: true,
                    createdAt: new Date(),
                    // 保存连接信息
                    host: connectionInfo.host,
                    username: connectionInfo.username,
                    port: connectionInfo.port
                  });

                  log.info(`SFTP会话 ${sessionId} 创建成功`);
                  resolve(sessionId);
                } else if (message.type === 'sftp_error') {
                  // 处理SFTP初始化错误
                  session.socket.removeEventListener('message', handleSftpInitResponse);
                  clearTimeout(timeout);
                  reject(new Error(`SFTP初始化失败: ${message.data.error}`));
                }
              }
            } catch (error) {
              log.error('处理SFTP初始化响应失败:', error);
            }
          };
          
          // 添加消息监听器
          session.socket.addEventListener('message', handleSftpInitResponse);
          
          // 发送SFTP初始化请求
          const operationId = this._nextOperationId();
          log.info(`发送SFTP初始化请求: ${sshSessionId}`);
          const initMessage = this._createSftpMessage('sftp_init', {
            sessionId: sshSessionId,
            operationId
          });
          session.socket.send(JSON.stringify(initMessage));
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
      if (session.socket && session.socket.readyState === WS_CONSTANTS.OPEN) {
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
      if (session.socket && session.socket.readyState === WS_CONSTANTS.OPEN) {
        const listMessage = this._createSftpMessage('sftp_list', {
          sessionId: sshSessionId,
          path,
          operationId
        });
        session.socket.send(JSON.stringify(listMessage));
      } else {
        clearTimeout(timeout);
        this.fileOperations.delete(operationId);
        reject(new Error('WebSocket连接未就绪'));
      }
    });
  }
  
  /**
   * 二进制上传文件
   * @param {string} sessionId - SFTP会话ID
   * @param {File} file - 文件对象
   * @param {string} remotePath - 远程路径
   * @param {function} progressCallback - 进度回调
   * @returns {Promise<Object>} - 上传结果
   */
  async uploadFileBinary(sessionId, file, remotePath, progressCallback) {
    await this._ensureSftpSession(sessionId);

    return new Promise((resolve, reject) => {
      const operationId = this._nextOperationId();

      try {
        const { sshSessionId, session } = this._getSSHSession(sessionId);

        // 设置操作超时
        const timeout = setTimeout(() => {
          this.fileOperations.delete(operationId);
          reject(new Error('文件上传超时'));
        }, 60 * 1000);

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
          progress: progressCallback,
          type: 'upload_binary'
        });

        // 读取文件为ArrayBuffer
        const reader = new FileReader();
        reader.onload = async (event) => {
          try {
            const fileBuffer = event.target.result;

            // 计算校验和
            const checksum = await SFTPService._calculateSHA256(fileBuffer);

            // 创建元数据
            const metadata = {
              sessionId: sshSessionId,
              operationId,
              filename: file.name,
              remotePath,
              fileSize: file.size,
              mimeType: file.type || 'application/octet-stream',
              checksum,
              timestamp: Date.now()
            };

            // 检查是否需要分块传输
            if (file.size > this.chunkSize) {
              // 分块传输
              await this._uploadFileInChunks(session, metadata, fileBuffer, progressCallback);
            } else {
              // 单块传输
              metadata.chunkIndex = 0;
              metadata.totalChunks = 1;
              metadata.isChunked = false;

              const messageBuffer = SFTPService._encodeBinaryMessage(
                BINARY_MSG_TYPE.SFTP_UPLOAD,
                metadata,
                fileBuffer
              );

              session.socket.send(messageBuffer);
            }
          } catch (error) {
            clearTimeout(timeout);
            this.fileOperations.delete(operationId);
            reject(new Error(`处理文件失败: ${error.message}`));
          }
        };

        reader.onerror = () => {
          clearTimeout(timeout);
          this.fileOperations.delete(operationId);
          reject(new Error('读取文件失败'));
        };

        reader.readAsArrayBuffer(file);

      } catch (error) {
        this.fileOperations.delete(operationId);
        reject(error);
      }
    });
  }

  /**
   * 分块上传文件
   * @private
   */
  async _uploadFileInChunks(session, baseMetadata, fileBuffer, progressCallback) {
    const totalChunks = Math.ceil(fileBuffer.byteLength / this.chunkSize);

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const start = chunkIndex * this.chunkSize;
      const end = Math.min(start + this.chunkSize, fileBuffer.byteLength);
      const chunkData = fileBuffer.slice(start, end);

      const chunkMetadata = {
        ...baseMetadata,
        chunkIndex,
        totalChunks,
        chunkSize: chunkData.byteLength,
        isChunked: true
      };

      const messageBuffer = SFTPService._encodeBinaryMessage(
        BINARY_MSG_TYPE.SFTP_UPLOAD,
        chunkMetadata,
        chunkData
      );

      // 发送分块
      session.socket.send(messageBuffer);

      // 等待一小段时间避免过快发送
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  /**
   * 上传文件（高性能二进制传输）
   * @param {string} sessionId - SFTP会话ID
   * @param {File} file - 文件对象
   * @param {string} remotePath - 远程路径
   * @param {function} progressCallback - 进度回调
   * @returns {Promise<Object>} - 上传结果
   */
  async uploadFile(sessionId, file, remotePath, progressCallback) {
    return this.uploadFileBinary(sessionId, file, remotePath, progressCallback);
  }


  
  /**
   * 二进制下载文件
   * @param {string} sessionId - SFTP会话ID
   * @param {string} remotePath - 远程文件路径
   * @param {function} progressCallback - 进度回调函数
   * @returns {Promise<Blob>} - 文件Blob对象
   */
  async downloadFileBinary(sessionId, remotePath, progressCallback) {
    await this._ensureSftpSession(sessionId);

    return new Promise((resolve, reject) => {
      const operationId = this._nextOperationId();

      try {
        const { sshSessionId, session } = this._getSSHSession(sessionId);

        // 设置操作超时
        const timeout = setTimeout(() => {
          this.fileOperations.delete(operationId);
          reject(new Error('文件下载超时'));
        }, 10 * 60 * 1000);

        // 保存操作回调
        this.fileOperations.set(operationId, {
          resolve: (data) => {
            clearTimeout(timeout);

            // 处理二进制数据
            try {
              const blob = new Blob([data.payloadData], {
                type: data.headerData.mimeType || 'application/octet-stream'
              });

              resolve({
                blob,
                filename: data.headerData.filename,
                size: data.headerData.size,
                checksum: data.headerData.checksum
              });
            } catch (error) {
              reject(new Error(`处理下载数据失败: ${error.message}`));
            }
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
          progress: progressCallback,
          type: 'download_binary'
        });

        // 创建下载请求元数据
        const metadata = {
          sessionId: sshSessionId,
          operationId,
          remotePath,
          timestamp: Date.now()
        };

        // 发送二进制下载请求
        if (session.socket && session.socket.readyState === WS_CONSTANTS.OPEN) {
          const messageBuffer = SFTPService._encodeBinaryMessage(
            BINARY_MSG_TYPE.SFTP_DOWNLOAD,
            metadata
          );
          session.socket.send(messageBuffer);
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
   * 下载文件（高性能二进制传输）
   * @param {string} sessionId - SFTP会话ID
   * @param {string} remotePath - 远程文件路径
   * @param {function} progressCallback - 进度回调函数
   * @returns {Promise<Blob>} - 文件Blob对象
   */
  async downloadFile(sessionId, remotePath, progressCallback) {
    const result = await this.downloadFileBinary(sessionId, remotePath, progressCallback);
    return result.blob;
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
        reader.onerror = () => reject(new Error('读取文件内容失败'));
        reader.readAsText(fileBlob);
      });
    } catch (error) {
      log.error(`获取文件内容失败 ${remotePath}:`, error);
      throw new Error(`获取文件内容失败: ${error.message || '未知错误'}`);
    }
  }

  /**
   * 二进制下载文件夹
   * @param {string} sessionId - SFTP会话ID
   * @param {string} remotePath - 远程文件夹路径
   * @param {function} progressCallback - 进度回调函数
   * @returns {Promise<Object>} - 下载结果对象
   */
  async downloadFolderBinary(sessionId, remotePath, progressCallback) {
    await this._ensureSftpSession(sessionId);

    return new Promise((resolve, reject) => {
      const operationId = this._nextOperationId();

      try {
        const { sshSessionId, session } = this._getSSHSession(sessionId);

        // 设置操作超时
        const timeout = setTimeout(() => {
          this.fileOperations.delete(operationId);
          reject(new Error('文件夹下载超时'));
        }, this.transferTimeout);

        // 保存操作回调
        this.fileOperations.set(operationId, {
          resolve: (data) => {
            clearTimeout(timeout);
            resolve(data); // 二进制数据已在handleBinaryMessage中处理
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
          progress: progressCallback,
          type: 'download_folder_binary'
        });

        // 创建下载请求元数据
        const metadata = {
          sessionId: sshSessionId,
          operationId,
          remotePath,
          timestamp: Date.now()
        };

        // 发送二进制下载请求
        if (session.socket && session.socket.readyState === WS_CONSTANTS.OPEN) {
          const messageBuffer = SFTPService._encodeBinaryMessage(
            BINARY_MSG_TYPE.SFTP_DOWNLOAD_FOLDER,
            metadata
          );
          session.socket.send(messageBuffer);
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
   * 下载文件夹（高性能二进制流式ZIP）
   * @param {string} sessionId - SFTP会话ID
   * @param {string} remotePath - 远程文件夹路径
   * @param {function} progressCallback - 进度回调函数
   * @returns {Promise<Object>} - 下载结果对象，包含blob属性
   */
  async downloadFolder(sessionId, remotePath, progressCallback) {
    const result = await this.downloadFolderBinary(sessionId, remotePath, progressCallback);
    return result; // 返回完整的result对象，包含blob属性
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
      log.error(`保存文件内容失败 ${remotePath}:`, error);
      throw new Error(`保存文件内容失败: ${error.message || '未知错误'}`);
    }
  }

  /**
   * 创建空文件
   * @param {string} sessionId - SFTP会话ID
   * @param {string} remotePath - 远程文件路径
   * @returns {Promise<Object>} - 创建结果
   */
  async createFile(sessionId, remotePath) {
    await this._ensureSftpSession(sessionId);

    try {
      // 创建一个空的Blob对象
      const emptyBlob = new Blob([''], { type: 'text/plain' });

      // 创建临时File对象
      const fileName = remotePath.split('/').pop();
      const emptyFile = new File([emptyBlob], fileName, { type: 'text/plain' });

      // 使用uploadFile方法上传空文件
      await this.uploadFile(sessionId, emptyFile, remotePath, () => {});

      return { success: true, message: '文件创建成功' };
    } catch (error) {
      log.error(`创建文件失败 ${remotePath}:`, error);
      throw new Error(`创建文件失败: ${error.message || '未知错误'}`);
    }
  }

  /**
   * 创建目录
   * @param {string} sessionId - SFTP会话ID
   * @param {string} remotePath - 远程目录路径
   * @returns {Promise<Object>} - 创建结果
   */
  async createDirectory(sessionId, remotePath) {
    await this._ensureSftpSession(sessionId);

    return new Promise((resolve, reject) => {
      const operationId = this._nextOperationId();

      try {
        // 获取SSH会话
        const { sshSessionId, session } = this._getSSHSession(sessionId);

        // 设置操作超时
        const timeout = setTimeout(() => {
          this.fileOperations.delete(operationId);
          reject(new Error('创建目录超时'));
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

        // 发送创建目录请求
        if (session.socket && session.socket.readyState === WS_CONSTANTS.OPEN) {
          const mkdirMessage = this._createSftpMessage('sftp_mkdir', {
            sessionId: sshSessionId,
            path: remotePath,
            operationId
          });
          session.socket.send(JSON.stringify(mkdirMessage));
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
   * 删除文件
   * @param {string} sessionId - SFTP会话ID
   * @param {string} remotePath - 远程文件路径
   * @returns {Promise<Object>} - 删除结果
   */
  async deleteFile(sessionId, remotePath) {
    await this._ensureSftpSession(sessionId);

    return new Promise((resolve, reject) => {
      const operationId = this._nextOperationId();

      try {
        // 获取SSH会话
        const { sshSessionId, session } = this._getSSHSession(sessionId);

        // 设置操作超时
        const timeout = setTimeout(() => {
          this.fileOperations.delete(operationId);
          reject(new Error('删除文件超时'));
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

        // 发送删除文件请求
        if (session.socket && session.socket.readyState === WS_CONSTANTS.OPEN) {
          const deleteMessage = this._createSftpMessage('sftp_delete', {
            sessionId: sshSessionId,
            path: remotePath,
            isDirectory: false,
            operationId
          });
          session.socket.send(JSON.stringify(deleteMessage));
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
   * 通用删除方法（支持文件和目录）
   * @param {string} sessionId - SFTP会话ID
   * @param {string} remotePath - 远程路径
   * @param {boolean} isDirectory - 是否为目录
   * @returns {Promise<Object>} - 删除结果
   */
  async delete(sessionId, remotePath, isDirectory = false) {
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
        }, 60000); // 目录删除可能需要更长时间

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
        if (session.socket && session.socket.readyState === WS_CONSTANTS.OPEN) {
          const deleteMessage = this._createSftpMessage('sftp_delete', {
            sessionId: sshSessionId,
            path: remotePath,
            isDirectory: isDirectory,
            operationId
          });
          session.socket.send(JSON.stringify(deleteMessage));
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
   * 快速删除目录
   * @param {string} sessionId - SFTP会话ID
   * @param {string} remotePath - 远程目录路径
   * @returns {Promise<Object>} - 删除结果
   */
  async fastDeleteDirectory(sessionId, remotePath) {
    await this._ensureSftpSession(sessionId);

    return new Promise((resolve, reject) => {
      const operationId = this._nextOperationId();

      try {
        // 获取SSH会话
        const { sshSessionId, session } = this._getSSHSession(sessionId);

        // 设置操作超时
        const timeout = setTimeout(() => {
          this.fileOperations.delete(operationId);
          reject(new Error('快速删除目录超时'));
        }, 120000); // 快速删除可能需要更长时间

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
          type: 'fastDelete'
        });

        // 发送快速删除目录请求
        if (session.socket && session.socket.readyState === WS_CONSTANTS.OPEN) {
          const fastDeleteMessage = this._createSftpMessage('sftp_fast_delete', {
            sessionId: sshSessionId,
            path: remotePath,
            operationId
          });
          session.socket.send(JSON.stringify(fastDeleteMessage));
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
   * 修改文件权限
   * @param {string} sessionId - SFTP会话ID
   * @param {string} remotePath - 远程文件路径
   * @param {number} permissions - 新权限（八进制数字）
   * @returns {Promise<Object>} - 修改结果
   */
  async changePermissions(sessionId, remotePath, permissions) {
    await this._ensureSftpSession(sessionId);

    return new Promise((resolve, reject) => {
      const operationId = this._nextOperationId();

      try {
        // 获取SSH会话
        const { sshSessionId, session } = this._getSSHSession(sessionId);

        // 设置操作超时
        const timeout = setTimeout(() => {
          this.fileOperations.delete(operationId);
          reject(new Error('修改权限超时'));
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
          type: 'chmod'
        });

        // 发送修改权限请求
        if (session.socket && session.socket.readyState === WS_CONSTANTS.OPEN) {
          const chmodMessage = this._createSftpMessage('sftp_chmod', {
            sessionId: sshSessionId,
            path: remotePath,
            permissions,
            operationId
          });
          session.socket.send(JSON.stringify(chmodMessage));
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
   * 重命名文件或目录
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
        if (session.socket && session.socket.readyState === WS_CONSTANTS.OPEN) {
          const renameMessage = this._createSftpMessage('sftp_rename', {
            sessionId: sshSessionId,
            oldPath: oldPath,
            newPath: newPath,
            operationId
          });
          session.socket.send(JSON.stringify(renameMessage));
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
   * 取消上传操作
   * @param {string} sessionId - SFTP会话ID
   * @param {number} operationId - 操作ID
   * @returns {Promise<Object>} - 取消结果
   */
  async cancelUpload(sessionId, operationId) {
    await this._ensureSftpSession(sessionId);

    return new Promise((resolve, reject) => {
      try {
        // 获取SSH会话
        const { sshSessionId, session } = this._getSSHSession(sessionId);

        // 设置操作超时
        const timeout = setTimeout(() => {
          reject(new Error('取消上传操作超时'));
        }, 10000);

        // 发送取消上传请求
        if (session.socket && session.socket.readyState === WS_CONSTANTS.OPEN) {
          session.socket.send(JSON.stringify({
            type: 'sftp_cancel',
            data: {
              sessionId: sshSessionId,
              operationId: operationId
            }
          }));

          // 清理本地操作记录
          if (this.fileOperations.has(operationId)) {
            this.fileOperations.delete(operationId);
          }

          // 清理已取消操作的计数器
          if (this.cancelledOperationCounts) {
            const countKey = `cancelled_${operationId}`;
            if (this.cancelledOperationCounts.has(countKey)) {
              this.cancelledOperationCounts.delete(countKey);
            }
          }

          clearTimeout(timeout);
          resolve({ success: true, message: '上传已取消' });
        } else {
          clearTimeout(timeout);
          reject(new Error('WebSocket连接未就绪'));
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 确保SFTP会话已创建
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
   * @private
   */
  _nextOperationId() {
    return String(++this.operationId);
  }
  
  /**
   * 设置WebSocket二进制消息处理器
   * @param {WebSocket} socket WebSocket连接
   */
  setupBinaryMessageHandler(socket) {
    // 添加二进制消息处理器
    socket.addEventListener('message', (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.handleBinaryMessage(event.data);
      }
    });
  }

  /**
   * 处理二进制WebSocket消息
   * @param {ArrayBuffer} arrayBuffer 二进制数据
   */
  handleBinaryMessage(arrayBuffer) {
    try {
      const message = SFTPService._decodeBinaryMessage(arrayBuffer);
      const { messageType, headerData, payloadData } = message;

      log.debug('收到二进制SFTP消息', {
        type: messageType,
        sessionId: headerData.sessionId,
        operationId: headerData.operationId,
        payloadSize: payloadData ? payloadData.byteLength : 0
      });

      // 根据消息类型处理
      switch (messageType) {
        case BINARY_MSG_TYPE.SFTP_SUCCESS:
          this._handleBinarySuccess(headerData, payloadData);
          break;

        case BINARY_MSG_TYPE.SFTP_ERROR:
          this._handleBinaryError(headerData);
          break;

        case BINARY_MSG_TYPE.SFTP_PROGRESS:
          this._handleBinaryProgress(headerData);
          break;

        case BINARY_MSG_TYPE.SFTP_FILE_DATA:
          this._handleBinaryFileData(headerData, payloadData);
          break;

        case BINARY_MSG_TYPE.SFTP_FOLDER_DATA:
          this._handleBinaryFolderData(headerData, payloadData);
          break;

        default:
          log.warn(`未知的二进制SFTP消息类型: ${messageType}`);
      }
    } catch (error) {
      log.error('处理二进制SFTP消息失败:', error);
    }
  }

  /**
   * 处理二进制成功消息
   * @private
   */
  _handleBinarySuccess(headerData, payloadData) {
    const { operationId } = headerData;
    const operation = this.fileOperations.get(operationId);

    if (operation && operation.resolve) {
      operation.resolve({ headerData, payloadData });
      this.fileOperations.delete(operationId);
    }
  }

  /**
   * 处理二进制错误消息
   * @private
   */
  _handleBinaryError(headerData) {
    const { operationId, errorMessage } = headerData;
    const operation = this.fileOperations.get(operationId);

    if (operation && operation.reject) {
      operation.reject(new Error(errorMessage || '未知二进制SFTP错误'));
      this.fileOperations.delete(operationId);
    }
  }

  /**
   * 处理二进制进度消息
   * @private
   */
  _handleBinaryProgress(headerData) {
    const { operationId, progress } = headerData;
    const operation = this.fileOperations.get(operationId);

    if (operation && operation.progress && typeof operation.progress === 'function') {
      operation.progress(progress);
    }
  }

  /**
   * 处理二进制文件数据消息
   * @private
   */
  _handleBinaryFileData(headerData, payloadData) {
    const { operationId } = headerData;
    const operation = this.fileOperations.get(operationId);

    if (operation && operation.resolve) {
      try {
        // 确保payloadData是正确的格式
        let blobData;
        if (payloadData instanceof ArrayBuffer) {
          blobData = new Uint8Array(payloadData);
        } else if (payloadData instanceof Uint8Array) {
          blobData = payloadData;
        } else {
          blobData = new Uint8Array(payloadData);
        }

        // 创建文件Blob
        const blob = new Blob([blobData], {
          type: headerData.mimeType || 'application/octet-stream'
        });

        log.debug('文件下载数据处理完成', {
          filename: headerData.filename,
          size: `${(blob.size / 1024).toFixed(1)}KB`
        });

        const result = {
          blob,
          filename: headerData.filename,
          size: headerData.size,
          checksum: headerData.checksum
        };

        operation.resolve(result);
        this.fileOperations.delete(operationId);
      } catch (error) {
        log.error('处理二进制文件数据失败:', error);
        if (operation.reject) {
          operation.reject(new Error(`处理文件数据失败: ${error.message}`));
          this.fileOperations.delete(operationId);
        }
      }
    }
  }

  /**
   * 处理二进制文件夹数据消息
   * @private
   */
  _handleBinaryFolderData(headerData, payloadData) {
    const { operationId } = headerData;
    const operation = this.fileOperations.get(operationId);

    if (operation && operation.resolve) {
      try {
        // 确保payloadData是正确的格式
        let blobData;
        if (payloadData instanceof ArrayBuffer) {
          blobData = new Uint8Array(payloadData);
        } else if (payloadData instanceof Uint8Array) {
          blobData = payloadData;
        } else {
          // 如果是其他类型，尝试转换
          blobData = new Uint8Array(payloadData);
        }

        // 创建ZIP Blob
        const blob = new Blob([blobData], { type: 'application/zip' });

        // 验证Blob对象
        if (!(blob instanceof Blob) || typeof blob.size !== 'number' || blob.size <= 0) {
          throw new Error(`创建的Blob对象无效: instanceof=${blob instanceof Blob}, size=${blob.size}`);
        }

        log.debug('文件夹下载数据处理完成', {
          filename: headerData.filename,
          size: `${(blob.size / 1024 / 1024).toFixed(2)}MB`,
          fileCount: headerData.summary?.totalFiles || 'unknown'
        });

        const result = {
          blob,
          filename: headerData.filename,
          summary: headerData.summary,
          skippedFiles: headerData.skippedFiles || [],
          errorFiles: headerData.errorFiles || []
        };

        operation.resolve(result);
        this.fileOperations.delete(operationId);
      } catch (error) {
        log.error('处理二进制文件夹数据失败:', error);
        if (operation.reject) {
          operation.reject(new Error(`处理文件夹数据失败: ${error.message}`));
          this.fileOperations.delete(operationId);
        }
      }
    }
  }

  /**
   * 处理来自服务器的SFTP消息 (兼容旧版JSON方式)
   */
  handleSftpMessage(message) {
    if (!message || !message.data) {
      log.warn('收到无效的SFTP消息:', message);
      return;
    }

    // 特殊处理：某些SFTP消息可能没有operationId
    if (message.type === 'sftp_success' && message.data && message.data.message &&
        (message.data.message.includes('SFTP会话已关闭') ||
         message.data.message.includes('SFTP会话已建立')) &&
        !message.data.operationId) {
      return; // 这些消息由专门的处理器处理，无需产生警告
    }

    if (!message.data.operationId) {
      log.warn('收到无效的SFTP消息:', message);
      return;
    }

    const { operationId } = message.data;

    // 用于跟踪已取消操作的进度消息计数，避免日志刷屏
    if (!this.cancelledOperationCounts) {
      this.cancelledOperationCounts = new Map();
    }

    // 查找对应的操作
    if (!this.fileOperations.has(operationId)) {
      // 特殊处理一些可能的服务器端自动操作
      if (typeof operationId === 'string' && operationId.includes('_refresh')) {
        log.debug(`收到服务器端刷新操作响应: ${operationId}, 消息类型: ${message.type}`);
        return; // 静默处理刷新操作
      }

      // 对于sftp_success消息，如果操作不存在，可能是延迟响应，记录但不处理
      if (message.type === 'sftp_success') {
        log.debug(`收到延迟的操作响应: ${operationId}, 消息类型: ${message.type}`);
        return; // 静默处理延迟响应
      }

      // 特殊处理已取消操作的进度消息
      if (message.type === 'sftp_progress') {
        // 获取或初始化计数器
        const countKey = `cancelled_${operationId}`;
        const count = this.cancelledOperationCounts.get(countKey) || 0;
        this.cancelledOperationCounts.set(countKey, count + 1);

        // 只在第一次记录日志，后续完全静默
        if (count === 0) {
          log.debug(`已取消操作 ${operationId}，忽略后续进度消息`);
        }

        return; // 静默处理已取消操作的进度消息
      }

      log.warn(`未找到SFTP操作: ${operationId}, 消息类型: ${message.type}`);
      return;
    }
    
    const operation = this.fileOperations.get(operationId);
    
    switch (message.type) {
      case 'sftp_progress':
        // 处理进度回调
        if (operation.progress && typeof operation.progress === 'function') {
          operation.progress(message.data.progress);
        }
        break;



      case 'sftp_success':
        // 处理成功回调
        if (operation.resolve && typeof operation.resolve === 'function') {
          // 确保文件列表操作返回的是数组
          if (operation.type === 'list') {
            // 确保返回的文件列表是数组
            let filesList = message.data.files || [];
            
            // 如果不是数组，转换为空数组
            if (!Array.isArray(filesList)) {
              log.warn(`文件列表不是数组，而是 ${typeof filesList}，将转换为空数组`);
              filesList = [];
            }
            
            operation.resolve(filesList);
          } else if (operation.type === 'upload') {
            try {
              // 检查操作是否已经自动完成
              if (operation.autoCompleted) {
                log.debug('文件上传操作已自动完成，跳过处理');
              } else {
                // 直接resolve成功消息
                operation.resolve(message.data);
              }
            } catch (error) {
              log.error(`调用resolve回调时出错: ${error.message}`);
            }
          } else {
            try {
              operation.resolve(message.data);
            } catch (error) {
              log.error(`调用resolve回调时出错: ${error.message}`);
            }
          }
          
          // 从映射中删除操作
          this.fileOperations.delete(operationId);
        }
        break;
        
      case 'sftp_error':
        // 处理错误回调
        log.error(`SFTP操作错误: 类型=${operation.type}, 错误=${message.data.message || '未知SFTP错误'}`);
        
        if (operation.reject && typeof operation.reject === 'function') {
          // 对于列表操作，如果出错返回空数组
          if (operation.type === 'list') {
            log.warn(`列出目录失败: ${message.data.message || '未知SFTP错误'}，返回空数组`);
            operation.resolve([]);
          } else {
            try {
              operation.reject(new Error(message.data.message || '未知SFTP错误'));
            } catch (error) {
              log.error(`调用reject回调时出错: ${error.message}`);
            }
          }
          this.fileOperations.delete(operationId);
        }
        break;
        
      default:
        log.warn(`未知的SFTP消息类型: ${message.type}`);
        break;
    }
  }
}

export default SFTPService; 