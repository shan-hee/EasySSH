import log from '../log';
import { WS_CONSTANTS, BINARY_MESSAGE_TYPES } from '../constants';

// 导入统一的二进制协议
import { BINARY_MSG_TYPE } from './binary-protocol';
// 导入二进制消息工具
import { BinaryMessageUtils } from '../binary-message-utils';

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
    // 记录已请求取消的操作ID，阻止继续发送后续分块
    this._canceledOps = new Set();

    // 从环境变量读取传输配置
    this.chunkSize = parseInt(import.meta.env.VITE_SFTP_CHUNK_SIZE) || 1024 * 1024; // 默认1MB
    this.transferTimeout = parseInt(import.meta.env.VITE_SFTP_TRANSFER_TIMEOUT) || 300000; // 默认5分钟

    this.chunkReassembler = new Map(); // 分块重组器
    // 分块文件夹下载的临时缓冲：operationId -> { chunks: Array<Uint8Array>, received: number, filename, mimeType }
    this._folderDownloads = new Map();

    // 进度日志节流状态
    this._progressLogState = new Map(); // operationId -> { lastProgress, lastTs }
    // 进度归一化状态（用于防止进度回退/重置）
    this._progressState = new Map(); // operationId -> { lastProgress }

    // 监听SFTP二进制消息事件
    window.addEventListener('sftp-binary-message', event => {
      this.handleBinaryMessage(event.detail);
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
    const VERSION = 0x02;

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
    const VERSION = 0x02;

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
          log.debug(`找到终端ID ${sessionId} 对应的SSH会话ID: ${sshSessionId}`);
          break;
        }
      }

      // 如果仍然找不到，可能需要使用其他策略
      if (sshSessionId === sessionId) {
        if (this.sshService.sessions.size === 1) {
          sshSessionId = Array.from(this.sshService.sessions.keys())[0];
          log.debug(`未找到终端ID ${sessionId} 的映射，但只有一个SSH会话，使用: ${sshSessionId}`);
        } else {
          log.error(`找不到终端ID ${sessionId} 对应的SSH会话ID`);
        }
      }
    }

    // 检查SSH会话是否存在
    if (!this.sshService.sessions.has(sshSessionId)) {
      log.error(`创建SFTP会话失败: SSH会话 ${sshSessionId} 不存在`);
      log.debug('可用的SSH会话:', Array.from(this.sshService.sessions.keys()));
      throw new Error(`创建SFTP会话失败: SSH会话 ${sshSessionId} 不存在`);
    }

    // 检查是否已存在SFTP会话
    if (this.activeSftpSessions.has(sessionId)) {
      log.debug(`SFTP会话 ${sessionId} 已存在，重用现有会话`);
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
          // 创建二进制SFTP初始化消息处理器
          const handleSftpInitResponse = event => {
            // 检查是否是SFTP初始化成功的二进制消息事件
            if (event.type === 'sftp-binary-message') {
              const { messageType, headerData } = event.detail;

              // 只处理与此会话相关的SFTP成功消息
              if (
                headerData &&
                headerData.sessionId === sshSessionId &&
                messageType === BINARY_MESSAGE_TYPES.SFTP_SUCCESS &&
                headerData.message === 'SFTP会话已建立'
              ) {
                // 移除消息监听器
                window.removeEventListener('sftp-binary-message', handleSftpInitResponse);
                clearTimeout(timeout);

                // 获取SSH会话中的连接信息
                const connectionInfo = session.connectionInfo || {};

                // 创建SFTP会话记录
                this.activeSftpSessions.set(sessionId, {
                  id: sessionId,
                  sshSessionId,
                  currentPath: '/',
                  isActive: true,
                  createdAt: new Date(),
                  host: connectionInfo.host,
                  username: connectionInfo.username,
                  port: connectionInfo.port
                });

                log.debug(`SFTP会话 ${sessionId} 创建成功`);
                resolve(sessionId);
              } else if (
                headerData &&
                headerData.sessionId === sshSessionId &&
                messageType === BINARY_MESSAGE_TYPES.SFTP_ERROR
              ) {
                // 处理SFTP初始化错误
                window.removeEventListener('sftp-binary-message', handleSftpInitResponse);
                clearTimeout(timeout);
                reject(new Error(`SFTP初始化失败: ${headerData.error || 'Unknown error'}`));
              }
            }
          };

          // 添加二进制消息监听器
          window.addEventListener('sftp-binary-message', handleSftpInitResponse);

          // 发送SFTP初始化请求
          const operationId = this._nextOperationId();
          log.debug(`发送SFTP初始化请求: ${sshSessionId}`);
          const initMessage = BinaryMessageUtils.createSftpInitMessage({
            sessionId: sshSessionId,
            operationId
          });
          session.socket.send(initMessage);
        });
      } else {
        throw new Error(
          `创建SFTP会话失败: WebSocket连接未就绪，当前状态: ${session.socket ? session.socket.readyState : 'null'}`
        );
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
        const operationId = this._nextOperationId();
        const closeMessage = BinaryMessageUtils.createSftpCloseMessage({
          sessionId: sshSessionId,
          operationId
        });
        session.socket.send(closeMessage);
      }

      // 无论服务器是否响应，都清理本地会话
      this.activeSftpSessions.delete(sessionId);
      log.debug(`SFTP会话 ${sessionId} 已关闭`);

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
        resolve: data => {
          clearTimeout(timeout);

          try {
            // 处理二进制响应数据
            let files = [];
            if (data.payloadData && data.payloadData.byteLength > 0) {
              // 解析payload中的JSON数据
              const payloadText = new TextDecoder().decode(data.payloadData);
              const responseData = JSON.parse(payloadText);
              files = responseData.files || [];
            } else if (data.headerData && data.headerData.files) {
              // 兼容header中的数据（旧格式）
              files = data.headerData.files;
            } else if (Array.isArray(data)) {
              // 兼容直接返回数组的格式
              files = data;
            }

            // 更新当前路径
            if (this.activeSftpSessions.has(sessionId)) {
              const sftpSession = this.activeSftpSessions.get(sessionId);
              // 只有当请求的是绝对路径时才更新当前路径
              if (path.startsWith('/')) {
                sftpSession.currentPath = path;
              }
            }

            resolve(files);
          } catch (parseError) {
          log.error('解析SFTP目录数据失败', parseError);
            reject(new Error(`解析目录数据失败: ${parseError.message}`));
          }
        },
        reject: error => {
          clearTimeout(timeout);
          reject(error);
        },
        type: 'list'
      });

      // 发送列目录请求
      if (session.socket && session.socket.readyState === WS_CONSTANTS.OPEN) {
        const listMessage = BinaryMessageUtils.createSftpListMessage({
          sessionId: sshSessionId,
          path,
          operationId
        });
        session.socket.send(listMessage);
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
  async uploadFileBinary(sessionId, file, remotePath, progressCallback, options = {}) {
    await this._ensureSftpSession(sessionId);

    return new Promise((resolve, reject) => {
      const operationId = this._nextOperationId();

      try {
        const { sshSessionId, session } = this._getSSHSession(sessionId);

        // 设置滑动操作超时：从环境或默认transferTimeout，进度时重置
        const baseTimeoutMs = this.transferTimeout || 300000; // 默认5分钟
        let timeout = null;
        const resetTimeout = () => {
          if (timeout) clearTimeout(timeout);
          timeout = setTimeout(() => {
            this.fileOperations.delete(operationId);
            reject(new Error('文件上传超时'));
          }, baseTimeoutMs);
        };
        resetTimeout();

        // 保存操作回调
        this.fileOperations.set(operationId, {
          resolve: data => {
            if (timeout) clearTimeout(timeout);
            resolve(data);
          },
          reject: error => {
            if (timeout) clearTimeout(timeout);
            reject(error);
          },
          progress: (progress, headerData) => {
            // 进度回调扩展：附带元数据（operationId/bytesTransferred/totalBytes），且滑动重置超时
            resetTimeout();
            if (typeof progressCallback === 'function') {
              try {
                const meta = headerData && typeof headerData === 'object' ? { ...headerData } : {};
                if (!meta.operationId) meta.operationId = operationId;
                progressCallback(progress, meta);
              } catch (e) {
                /* no-op */
              }
            }
          },
          type: 'upload_binary',
          meta: { filename: file.name, remotePath }
        });

        // 绑定可选的AbortController信号用于取消
        const { signal } = options || {};
        if (signal) {
          if (signal.aborted) {
            try { this._canceledOps.add(operationId); } catch (_) {}
          } else {
            const onAbort = () => {
              try { this._canceledOps.add(operationId); } catch (_) {}
              try { this.cancelOperation(operationId); } catch (_) {}
            };
            try { signal.addEventListener('abort', onAbort, { once: true }); } catch (_) {}
          }
        }

        // 提前一拍将 operationId 暴露给调用方，便于用户立即取消
        try {
          if (typeof progressCallback === 'function') {
            progressCallback(0, { operationId });
          }
        } catch (_) {}

        // 读取文件为ArrayBuffer
        const reader = new FileReader();
        reader.onload = async event => {
          try {
            let fileBuffer = event.target.result;

            // 处理空文件情况
            if (!fileBuffer || fileBuffer.byteLength === 0) {
              fileBuffer = new ArrayBuffer(0);
              log.debug('处理空文件上传', { operationId, remotePath, size: file.size });
            }

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
              await this._uploadFileInChunks(session, metadata, fileBuffer, progressCallback, options?.signal);
            } else {
              // 单块传输（发送前检查是否已被取消）
              metadata.chunkIndex = 0;
              metadata.totalChunks = 1;
              metadata.isChunked = false;

              if ((options?.signal && options.signal.aborted) || (this._canceledOps && this._canceledOps.has(operationId))) {
                throw new Error('操作已取消');
              }

              const messageBuffer = SFTPService._encodeBinaryMessage(
                BINARY_MSG_TYPE.SFTP_UPLOAD,
                metadata,
                fileBuffer
              );

              session.socket.send(messageBuffer);
            }
          } catch (error) {
            if (timeout) clearTimeout(timeout);
            this.fileOperations.delete(operationId);
            reject(new Error(`处理文件失败: ${error.message}`));
          }
        };

        reader.onerror = () => {
          if (timeout) clearTimeout(timeout);
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
  async _uploadFileInChunks(session, baseMetadata, fileBuffer, _progressCallback, signal) {
    const totalChunks = Math.ceil(fileBuffer.byteLength / this.chunkSize);

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      // 若外部abort信号或本地取消，停止继续发送分块
      if ((signal && signal.aborted) || (this._canceledOps && this._canceledOps.has(baseMetadata.operationId))) {
        break;
      }
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
  async uploadFile(sessionId, file, remotePath, progressCallback, options = {}) {
    return this.uploadFileBinary(sessionId, file, remotePath, progressCallback, options);
  }

  /**
   * 二进制下载文件
   * @param {string} sessionId - SFTP会话ID
   * @param {string} remotePath - 远程文件路径
   * @param {function} progressCallback - 进度回调函数
   * @returns {Promise<Blob>} - 文件Blob对象
   */
  async downloadFileBinary(sessionId, remotePath, progressCallback, options = {}) {
    await this._ensureSftpSession(sessionId);

    const operationId = this._nextOperationId();
    const promise = new Promise((resolve, reject) => {
      try {
        const { sshSessionId, session } = this._getSSHSession(sessionId);

        // 设置操作超时
        const timeout = setTimeout(
          () => {
            this.fileOperations.delete(operationId);
            reject(new Error('文件下载超时'));
          },
          10 * 60 * 1000
        );

        // 保存操作回调
        this.fileOperations.set(operationId, {
          resolve: data => {
            clearTimeout(timeout);

            // 处理二进制数据
            try {
              log.debug('处理下载的文件数据', {
                operationId,
                hasHeaderData: !!data.headerData,
                hasPayloadData: !!data.payloadData,
                payloadSize: data.payloadData ? data.payloadData.byteLength : 0,
                headerData: data.headerData
              });

              let blob;
              if (!data.payloadData) {
                // 允许空文件：当服务端返回size=0时，创建空Blob
                const size = data.headerData?.size || 0;
                if (size === 0) {
                  blob = new Blob([], {
                    type: data.headerData?.mimeType || 'application/octet-stream'
                  });
                } else {
                  reject(new Error('没有接收到文件数据'));
                  return;
                }
              } else {
                blob = new Blob([data.payloadData], {
                  type: data.headerData.mimeType || 'application/octet-stream'
                });
              }

              log.debug('成功创建文件Blob', {
                blobSize: blob.size,
                blobType: blob.type
              });

              resolve({
                blob,
                filename: data.headerData.filename,
                size: data.headerData.size,
                checksum: data.headerData.checksum
              });
            } catch (error) {
              log.error('处理下载数据失败:', error);
              reject(new Error(`处理下载数据失败: ${error.message}`));
            }
          },
          reject: error => {
            clearTimeout(timeout);
            reject(error);
          },
          progress: progressCallback,
          type: 'download_binary',
          meta: { remotePath },
          sshSessionId
        });

        // 绑定AbortController用于取消
        const { signal } = options || {};
        if (signal) {
          if (signal.aborted) {
            try { this.cancelOperation(operationId); } catch (_) {}
          } else {
            const onAbort = () => { try { this.cancelOperation(operationId); } catch (_) {} };
            try { signal.addEventListener('abort', onAbort, { once: true }); } catch (_) {}
          }
        }

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
    // 暴露operationId以便外部取消
    promise.operationId = operationId;
    return promise;
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
      log.debug('开始获取文件内容', { remotePath });

      // 获取文件为Blob
      const fileBlob = await this.downloadFile(sessionId, remotePath, () => {});

      log.debug('文件下载完成，准备读取内容', {
        blobSize: fileBlob.size,
        blobType: fileBlob.type
      });

      // 读取Blob内容为文本，使用UTF-8编码
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => {
          try {
            // 确保结果是字符串
            const content = e.target.result;
            log.debug('文件内容读取完成', {
              contentType: typeof content,
              contentLength: content ? content.length : 0,
              preview: content ? `${content.substring(0, 100)}...` : 'empty'
            });

            if (typeof content === 'string') {
              resolve(content);
            } else {
              // 如果不是字符串，尝试转换
              resolve(String(content || ''));
            }
          } catch (error) {
            log.error('处理文件内容失败:', error);
            reject(new Error(`处理文件内容失败: ${error.message}`));
          }
        };
        reader.onerror = error => {
          log.error('FileReader错误:', error);
          reject(new Error('读取文件内容失败'));
        };

        // 使用UTF-8编码读取文本
        reader.readAsText(fileBlob, 'UTF-8');
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
  async downloadFolderBinary(sessionId, remotePath, progressCallback, options = {}) {
    await this._ensureSftpSession(sessionId);

    const operationId = this._nextOperationId();
    const promise = new Promise((resolve, reject) => {
      try {
        const { sshSessionId, session } = this._getSSHSession(sessionId);

        // 设置“滑动”操作超时：收到进度就重置计时，避免长时间大文件夹误判超时
        const baseTimeoutMs = this.transferTimeout || 300000; // 默认5分钟
        let timeout = null;
        const resetTimeout = () => {
          if (timeout) clearTimeout(timeout);
          timeout = setTimeout(() => {
            this.fileOperations.delete(operationId);
            reject(new Error('文件夹下载超时'));
          }, baseTimeoutMs);
        };
        resetTimeout();

        // 保存操作回调
        this.fileOperations.set(operationId, {
          resolve: data => {
            if (timeout) clearTimeout(timeout);
            resolve(data); // 二进制数据已在handleBinaryMessage中处理
          },
          reject: error => {
            if (timeout) clearTimeout(timeout);
            reject(error);
          },
          progress: (progress, meta) => {
            // 进度回调时刷新超时
            resetTimeout();
            if (typeof progressCallback === 'function') {
              try {
                progressCallback(progress, meta);
              } catch (_) {
                /* no-op */
              }
            }
          },
          type: 'download_folder_binary',
          sshSessionId
        });

        // 绑定AbortController用于取消
        const { signal } = options || {};
        if (signal) {
          if (signal.aborted) {
            try { this.cancelOperation(operationId); } catch (_) {}
          } else {
            const onAbort = () => { try { this.cancelOperation(operationId); } catch (_) {} };
            try { signal.addEventListener('abort', onAbort, { once: true }); } catch (_) {}
          }
        }

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
          if (timeout) clearTimeout(timeout);
          this.fileOperations.delete(operationId);
          reject(new Error('WebSocket连接未就绪'));
        }
      } catch (error) {
        this.fileOperations.delete(operationId);
        reject(error);
      }
    });
    // 暴露operationId以便外部取消
    promise.operationId = operationId;
    return promise;
  }

  /**
   * 下载文件夹（高性能二进制流式ZIP）
   * @param {string} sessionId - SFTP会话ID
   * @param {string} remotePath - 远程文件夹路径
   * @param {function} progressCallback - 进度回调函数
   * @returns {Promise<Object>} - 下载结果对象，包含blob属性
   */
  async downloadFolder(sessionId, remotePath, progressCallback, options = {}) {
    const result = await this.downloadFolderBinary(sessionId, remotePath, progressCallback, options);
    return result; // 返回完整的result对象，包含blob属性
  }

  /**
   * 取消进行中的二进制SFTP操作
   * @param {string} operationId
   */
  cancelOperation(operationId) {
    const op = this.fileOperations.get(operationId);
    if (!op) return;
    // 本地标记取消，阻止继续发送分块
    try { this._canceledOps.add(operationId); } catch (_) {}
    try {
      // 尝试发送取消消息给后端
      const { sshSessionId } = op;
      const session = this.sshService.sessions.get(sshSessionId);
      if (session && session.socket && session.socket.readyState === WS_CONSTANTS.OPEN) {
        const header = { sessionId: sshSessionId, operationId };
        const buf = SFTPService._encodeBinaryMessage(BINARY_MSG_TYPE.SFTP_CANCEL, header);
        session.socket.send(buf);
      }
    } catch (e) {
      // 忽略发送取消的错误
    }
    // 主动拒绝并清理
    if (op.reject) {
      op.reject(new Error('操作已取消'));
    }
    this.fileOperations.delete(operationId);
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

    return new Promise((resolve, reject) => {
      const operationId = this._nextOperationId();

      try {
        // 获取SSH会话
        const { sshSessionId, session } = this._getSSHSession(sessionId);

        // 设置较短的超时时间，创建空文件应该很快
        const timeout = setTimeout(() => {
          this.fileOperations.delete(operationId);
          reject(new Error('创建文件超时'));
        }, 10000); // 10秒超时

        // 保存操作回调
        this.fileOperations.set(operationId, {
          resolve: data => {
            clearTimeout(timeout);
            resolve(data);
          },
          reject: error => {
            clearTimeout(timeout);
            reject(error);
          },
          type: 'create_file'
        });

        // 创建空文件的元数据
        const metadata = {
          sessionId: sshSessionId,
          operationId,
          filename: remotePath.split('/').pop(),
          remotePath,
          fileSize: 0,
          mimeType: 'text/plain',
          checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', // SHA256 of empty string
          timestamp: Date.now()
        };

        // 发送创建空文件的二进制消息
        if (session.socket && session.socket.readyState === WS_CONSTANTS.OPEN) {
          const messageBuffer = SFTPService._encodeBinaryMessage(
            BINARY_MSG_TYPE.SFTP_UPLOAD,
            metadata,
            new ArrayBuffer(0) // 空的payload
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
          resolve: data => {
            clearTimeout(timeout);
            resolve(data);
          },
          reject: error => {
            clearTimeout(timeout);
            reject(error);
          },
          type: 'mkdir'
        });

        // 发送创建目录请求
        if (session.socket && session.socket.readyState === WS_CONSTANTS.OPEN) {
          const mkdirMessage = BinaryMessageUtils.createSftpMkdirMessage({
            sessionId: sshSessionId,
            path: remotePath,
            operationId
          });
          session.socket.send(mkdirMessage);
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
          resolve: data => {
            clearTimeout(timeout);
            resolve(data);
          },
          reject: error => {
            clearTimeout(timeout);
            reject(error);
          },
          type: 'delete'
        });

        // 发送删除文件请求
        if (session.socket && session.socket.readyState === WS_CONSTANTS.OPEN) {
          const deleteMessage = BinaryMessageUtils.createSftpDeleteMessage({
            sessionId: sshSessionId,
            path: remotePath,
            isDirectory: false,
            operationId
          });
          session.socket.send(deleteMessage);
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
          resolve: data => {
            clearTimeout(timeout);
            resolve(data);
          },
          reject: error => {
            clearTimeout(timeout);
            reject(error);
          },
          type: 'delete'
        });

        // 发送删除请求
        if (session.socket && session.socket.readyState === WS_CONSTANTS.OPEN) {
          const deleteMessage = BinaryMessageUtils.createSftpDeleteMessage({
            sessionId: sshSessionId,
            path: remotePath,
            isDirectory,
            operationId
          });
          session.socket.send(deleteMessage);
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
          resolve: data => {
            clearTimeout(timeout);
            resolve(data);
          },
          reject: error => {
            clearTimeout(timeout);
            reject(error);
          },
          type: 'fastDelete'
        });

        // 发送快速删除目录请求
        if (session.socket && session.socket.readyState === WS_CONSTANTS.OPEN) {
          const fastDeleteMessage = BinaryMessageUtils.createSftpDeleteMessage({
            sessionId: sshSessionId,
            path: remotePath,
            isDirectory: true, // 快速删除通常用于目录
            operationId
          });
          session.socket.send(fastDeleteMessage);
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
          resolve: data => {
            clearTimeout(timeout);
            resolve(data);
          },
          reject: error => {
            clearTimeout(timeout);
            reject(error);
          },
          type: 'chmod'
        });

        // 发送修改权限请求
        if (session.socket && session.socket.readyState === WS_CONSTANTS.OPEN) {
          const chmodMessage = BinaryMessageUtils.createSftpChmodMessage({
            sessionId: sshSessionId,
            path: remotePath,
            permissions,
            operationId
          });
          session.socket.send(chmodMessage);
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
          resolve: data => {
            clearTimeout(timeout);
            resolve(data);
          },
          reject: error => {
            clearTimeout(timeout);
            reject(error);
          },
          type: 'rename'
        });

        // 发送重命名请求
        if (session.socket && session.socket.readyState === WS_CONSTANTS.OPEN) {
          const renameMessage = BinaryMessageUtils.createSftpRenameMessage({
            sessionId: sshSessionId,
            oldPath,
            newPath,
            operationId
          });
          session.socket.send(renameMessage);
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
          const cancelMessage = BinaryMessageUtils.createSftpCancelMessage({
            sessionId: sshSessionId,
            operationId
          });
          session.socket.send(cancelMessage);

          // 本地标记取消，阻止继续发送后续分块
          try { this._canceledOps.add(operationId); } catch (_) {}

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
    socket.addEventListener('message', event => {
      if (event.data instanceof ArrayBuffer) {
        this.handleBinaryMessage(event.data);
      }
    });
  }

  /**
   * 处理二进制WebSocket消息
   * @param {Object} messageDetail - 消息详情包含messageType, headerData, payloadData
   */
  handleBinaryMessage(messageDetail) {
    try {
      const { messageType, headerData, payloadData } = messageDetail;

      // 降低日志噪音：仅在开启详细模式时记录非进度类二进制消息
      const VERBOSE_BINARY = String(import.meta.env.VITE_SFTP_VERBOSE_BINARY) === 'true';
      if (VERBOSE_BINARY && messageType !== BINARY_MSG_TYPE.SFTP_PROGRESS) {
        log.debug('收到二进制SFTP消息', {
          type: messageType.toString ? messageType.toString(16) : messageType,
          sessionId: headerData.sessionId,
          operationId: headerData.operationId,
          payloadSize: payloadData ? payloadData.byteLength : 0
        });
      }

      // 根据消息类型处理
      switch (messageType) {
        case BINARY_MSG_TYPE.SUCCESS:
        case BINARY_MSG_TYPE.SFTP_SUCCESS:
          // 只有带有实际文件数据的消息才当作下载成功
          // 进度消息没有 payloadData，所以会被过滤掉
          if (payloadData && payloadData.byteLength > 0) {
            this._handleBinarySuccess(headerData, payloadData);
          } else if (headerData.message || headerData.responseType) {
            // 如果没有文件数据但有成功消息，也当作成功处理（如文件创建成功）
            this._handleBinarySuccess(headerData, payloadData);
          }
          break;

        case BINARY_MSG_TYPE.SFTP_ERROR:
          this._handleBinaryError(headerData);
          break;

        case BINARY_MSG_TYPE.SFTP_PROGRESS:
          this._handleBinaryProgress(headerData);
          // 节流记录关键进度（默认每2秒或提升>=15% 或达到100%），并标注方向
          try {
            const { operationId, progress, bytesTransferred, totalBytes } = headerData;
            const now = Date.now();
            const state = this._progressLogState.get(operationId) || {
              lastProgress: -1,
              lastTs: 0
            };

            const LOG_INTERVAL = parseInt(import.meta.env.VITE_SFTP_PROGRESS_LOG_INTERVAL_MS) || 2000;
            const LOG_STEP = parseInt(import.meta.env.VITE_SFTP_PROGRESS_LOG_STEP) || 15;

            const progressedEnough =
              state.lastProgress < 0 ||
              (typeof progress === 'number' && progress >= 100) ||
              (typeof progress === 'number' &&
                state.lastProgress >= 0 &&
                progress - state.lastProgress >= LOG_STEP);
            const timeEnough = now - state.lastTs >= LOG_INTERVAL;
            if (progressedEnough || timeEnough) {
              // 友好格式化字节
              const fmt = n => {
                if (typeof n !== 'number' || isNaN(n)) return undefined;
                if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(2)}GB`;
                if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)}MB`;
                if (n >= 1024) return `${(n / 1024).toFixed(0)}KB`;
                return `${n}B`;
              };

              let direction = '传输';
              let name;
              let path;
              try {
                const op = this.fileOperations.get(operationId);
                if (op && op.type) {
                  direction = op.type.includes('upload') ? '上传' : (op.type.includes('download') ? '下载' : '传输');
                  if (op.meta) {
                    name = op.meta.filename;
                    path = op.meta.remotePath;
                  }
                }
              } catch (_) {}

              const detail = {
                direction,
                operationId,
                progress,
                transferred: fmt(bytesTransferred),
                total: fmt(totalBytes),
                filename: name,
                remotePath: path
              };
              log.debug('SFTP传输进度', detail);
              this._progressLogState.set(operationId, {
                lastProgress: typeof progress === 'number' ? progress : state.lastProgress,
                lastTs: now
              });
            }
          } catch (e) {
            // 忾略进度日志错误
          }
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

    if (!operation) return;

    // 若服务端返回取消成功，不当作正常成功，改为reject以中断上层流程
    if (headerData && (headerData.message === '操作已取消' || headerData.canceled === true)) {
      if (operation.reject) operation.reject(new Error('操作已取消'));
      this.fileOperations.delete(operationId);
      return;
    }

    if (operation.resolve) {
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
    const { operationId } = headerData;
    const { progress } = headerData;

    // 归一化进度，处理total为0/未知的情况，且保证单调不减
    try {
      const bytes =
        typeof headerData.bytesTransferred === 'number' ? headerData.bytesTransferred : undefined;
      const total = typeof headerData.totalBytes === 'number' ? headerData.totalBytes : undefined;
      const est =
        typeof headerData.estimatedSize === 'number' ? headerData.estimatedSize : undefined;
      const phase = headerData.phase;

      const clampPct = (v, completed) => {
        if (typeof v !== 'number' || isNaN(v)) return 0;
        let p = Math.max(0, Math.min(100, Math.floor(v)));
        if (!completed && p >= 100) p = 99;
        return p;
      };

      let derived;
      if (typeof bytes === 'number' && bytes >= 0) {
        if (typeof est === 'number' && est > 0) {
          derived = (bytes / est) * 100;
        } else if (typeof total === 'number' && total > 0) {
          derived = (bytes / total) * 100;
        }
      }

      const completed = phase === 'completed' || progress === 100;
      let safeProgress =
        derived !== undefined ? clampPct(derived, completed) : clampPct(progress, completed);

      const st = this._progressState.get(operationId) || { lastProgress: -1 };
      if (st.lastProgress >= 0 && safeProgress < st.lastProgress) {
        safeProgress = st.lastProgress;
      }
      this._progressState.set(operationId, { lastProgress: safeProgress });

      headerData.progress = safeProgress; // 回写用于后续日志
    } catch (_) {
      /* no-op */
    }

    const operation = this.fileOperations.get(operationId);

    if (operation && operation.progress && typeof operation.progress === 'function') {
      // 兼容：第一个参数保留百分比；第二个参数传递完整元数据（包含bytesTransferred/totalBytes）
      operation.progress(headerData.progress, headerData);
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
        // 支持分块模式与一次性模式
        if (headerData && headerData.isChunked) {
          // 分块传输
          if (headerData.final) {
            // 最终元信息帧：拼接已有分块并resolve
            const state = this._folderDownloads.get(operationId);
            if (!state || !state.chunks || state.chunks.length === 0) {
              throw new Error('缺少已接收的分块数据');
            }
            const blob = new Blob(state.chunks, {
              type: headerData.mimeType || state.mimeType || 'application/octet-stream'
            });
            log.debug('文件夹下载数据处理完成', {
              filename: headerData.filename || state.filename,
              size: `${(blob.size / 1024 / 1024).toFixed(2)}MB`,
              fileCount: headerData.summary?.totalFiles || 'unknown'
            });
            const result = {
              blob,
              filename: headerData.filename || state.filename,
              summary: headerData.summary,
              skippedFiles: headerData.skippedFiles || [],
              errorFiles: headerData.errorFiles || [],
              checksum: headerData.checksum,
              size: headerData.size
            };
            this._folderDownloads.delete(operationId);
            operation.resolve(result);
            this.fileOperations.delete(operationId);
          } else {
            // 中间分块：缓存，不resolve
            if (!payloadData) return; // 可能是空的控制帧
            let chunk;
            if (payloadData instanceof ArrayBuffer) {
              chunk = new Uint8Array(payloadData);
            } else if (payloadData instanceof Uint8Array) {
              chunk = payloadData;
            } else {
              chunk = new Uint8Array(payloadData);
            }
            let state = this._folderDownloads.get(operationId);
            if (!state) {
              state = {
                chunks: [],
                received: 0,
                filename: headerData.filename,
                mimeType: headerData.mimeType
              };
              this._folderDownloads.set(operationId, state);
            }
            state.chunks.push(chunk);
            state.received += chunk.byteLength || chunk.length || 0;
            // 不在这里写入进度，统一由SFTP_PROGRESS事件处理
          }
        } else {
          // 一次性整包（兼容旧路径）
          let blobData;
          if (payloadData instanceof ArrayBuffer) {
            blobData = new Uint8Array(payloadData);
          } else if (payloadData instanceof Uint8Array) {
            blobData = payloadData;
          } else {
            // 如果是其他类型，尝试转换
            blobData = new Uint8Array(payloadData);
          }

          // 根据服务器提供的MIME类型创建Blob（兼容zip/tar.gz等）
          const blob = new Blob([blobData], {
            type: headerData.mimeType || 'application/octet-stream'
          });

          // 验证Blob对象
          if (!(blob instanceof Blob) || typeof blob.size !== 'number' || blob.size <= 0) {
            throw new Error(
              `创建的Blob对象无效: instanceof=${blob instanceof Blob}, size=${blob.size}`
            );
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
        }
      } catch (error) {
        log.error('处理二进制文件夹数据失败:', error);
        if (operation.reject) {
          operation.reject(new Error(`处理文件夹数据失败: ${error.message}`));
          this.fileOperations.delete(operationId);
        }
      }
    }
  }
}

export default SFTPService;
