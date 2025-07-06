import log from '../log';
import { WS_CONSTANTS } from '../constants';

/**
 * SFTP文件传输功能实现
 * 负责处理SFTP文件列表、上传、下载等操作
 */
class SFTPService {
  constructor(sshService) {
    this.sshService = sshService;
    this.activeSftpSessions = new Map(); // 存储活动的SFTP会话
    this.fileOperations = new Map(); // 存储文件操作任务
    this.operationId = 0; // 操作ID计数器
    log.debug('SFTP服务初始化完成');
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
                if (message.type === 'sftp_ready') {
                  // 移除消息监听器
                  session.socket.removeEventListener('message', handleSftpInitResponse);
                  clearTimeout(timeout);
                  
                  // 获取SSH会话中的连接信息
                  const connectionInfo = session.connectionInfo || {};
                  
                  // 创建SFTP会话记录
                  this.activeSftpSessions.set(sessionId, {
                    id: sessionId,
                    sshSessionId: sshSessionId, // 保存SSH会话ID
                    currentPath: message.data.path || '/',
                    isActive: true,
                    createdAt: new Date(),
                    // 保存连接信息
                    host: connectionInfo.host,
                    username: connectionInfo.username,
                    port: connectionInfo.port
                  });
                  
                  log.info(`SFTP会话 ${sessionId} 创建成功，初始路径: ${message.data.path || '/'}`);
                  resolve(sessionId);
                } else if (message.type === 'error' && message.data.source === 'sftp') {
                  // 处理SFTP初始化错误
                  session.socket.removeEventListener('message', handleSftpInitResponse);
                  clearTimeout(timeout);
                  reject(new Error(`SFTP初始化失败: ${message.data.message}`));
                }
              }
            } catch (error) {
              log.error('处理SFTP初始化响应失败:', error);
            }
          };
          
          // 添加消息监听器
          session.socket.addEventListener('message', handleSftpInitResponse);
          
          // 发送SFTP初始化请求
          log.info(`发送SFTP初始化请求: ${sshSessionId}`);
          session.socket.send(JSON.stringify({
            type: 'sftp_init',
            data: {
              sessionId: sshSessionId
            }
          }));
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
        session.socket.send(JSON.stringify({
          type: 'sftp_list',
          data: {
            sessionId: sshSessionId,
            path,
            operationId
          }
        }));
      } else {
        clearTimeout(timeout);
        this.fileOperations.delete(operationId);
        reject(new Error('WebSocket连接未就绪'));
      }
    });
  }
  
  /**
   * 上传文件
   * @param {string} sessionId - SFTP会话ID
   * @param {File} file - 文件对象
   * @param {string} remotePath - 远程路径
   * @param {function} progressCallback - 进度回调
   * @returns {Promise<Object>} - 上传结果
   */
  async uploadFile(sessionId, file, remotePath, progressCallback) {
    await this._ensureSftpSession(sessionId);
    
    return new Promise((resolve, reject) => {
      const operationId = this._nextOperationId();
      
      try {
        // 获取SSH会话
        const { sshSessionId, session } = this._getSSHSession(sessionId);
        
        // 设置操作超时
        const timeout = setTimeout(() => {
          this.fileOperations.delete(operationId);
          reject(new Error('文件上传超时'));
        }, 60 * 1000);
        
        // 标记是否自动完成
        let autoCompletedFlag = false;
        let progressCompleted = false; // 防止重复触发100%进度

        // 保存操作回调
        this.fileOperations.set(operationId, {
          resolve: (data) => {
            clearTimeout(timeout);
            if (!autoCompletedFlag) {
              resolve(data);
            }
          },
          reject: (error) => {
            clearTimeout(timeout);
            if (!autoCompletedFlag) {
              reject(error);
            }
          },
          progress: (progress) => {
            if (progressCallback && typeof progressCallback === 'function') {
              progressCallback(progress, operationId);

              // 收到100%进度时，立即完成，但只处理一次
              if (progress === 100 && !autoCompletedFlag && !progressCompleted) {
                progressCompleted = true;
                autoCompletedFlag = true;
                clearTimeout(timeout);
                resolve({ success: true, message: '上传完成' });
              }
            }
          },
          type: 'upload'
        });
        
        // 读取文件内容
        const reader = new FileReader();
        reader.onload = (event) => {
          let fileContent = event.target.result;

          // 处理空文件的情况
          if (!fileContent || file.size === 0) {
            fileContent = 'data:application/octet-stream;base64,';
          }

          // 使用 setTimeout 避免阻塞UI线程
          setTimeout(() => {
            try {
              // 发送上传请求
              if (session.socket && session.socket.readyState === WS_CONSTANTS.OPEN) {
                session.socket.send(JSON.stringify({
                  type: 'sftp_upload',
                  data: {
                    sessionId: sshSessionId,
                    filename: file.name,
                    path: remotePath,
                    size: file.size,
                    content: fileContent,
                    operationId
                  }
                }));
              } else {
                clearTimeout(timeout);
                this.fileOperations.delete(operationId);
                reject(new Error('WebSocket连接未就绪'));
              }
            } catch (error) {
              clearTimeout(timeout);
              this.fileOperations.delete(operationId);
              reject(new Error(`发送上传请求失败: ${error.message}`));
            }
          }, 10); // 10ms延迟，让UI有时间更新
        };
        
        reader.onerror = (error) => {
          clearTimeout(timeout);
          this.fileOperations.delete(operationId);
          reject(new Error(`读取文件失败: ${error.message || '未知错误'}`));
        };
        
        // 开始读取文件
        if (file.size === 0) {
          // 对于空文件，直接生成空的data URL
          setTimeout(() => {
            try {
              // 发送上传请求
              if (session.socket && session.socket.readyState === WS_CONSTANTS.OPEN) {
                session.socket.send(JSON.stringify({
                  type: 'sftp_upload',
                  data: {
                    sessionId: sshSessionId,
                    filename: file.name,
                    path: remotePath,
                    size: file.size,
                    content: 'data:application/octet-stream;base64,',
                    operationId
                  }
                }));
              } else {
                clearTimeout(timeout);
                this.fileOperations.delete(operationId);
                reject(new Error('WebSocket连接未就绪'));
              }
            } catch (error) {
              clearTimeout(timeout);
              this.fileOperations.delete(operationId);
              reject(new Error(`发送上传请求失败: ${error.message}`));
            }
          }, 10);
        } else {
          reader.readAsDataURL(file);
        }
      } catch (error) {
        this.fileOperations.delete(operationId);
        reject(error);
      }
    });
  }
  
  /**
   * 下载文件
   * @param {string} sessionId - SFTP会话ID
   * @param {string} remotePath - 远程文件路径
   * @param {function} progressCallback - 进度回调函数
   * @returns {Promise<Blob>} - 文件Blob对象
   */
  async downloadFile(sessionId, remotePath, progressCallback) {
    await this._ensureSftpSession(sessionId);
    
    return new Promise((resolve, reject) => {
      const operationId = this._nextOperationId();
      
      try {
        // 获取SSH会话
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
            
            // 将base64数据转换为Blob
            try {
              const byteString = atob(data.content.split(',')[1]);
              const mimeType = data.mimeType || 'application/octet-stream';
              
              const arrayBuffer = new ArrayBuffer(byteString.length);
              const uint8Array = new Uint8Array(arrayBuffer);
              
              for (let i = 0; i < byteString.length; i++) {
                uint8Array[i] = byteString.charCodeAt(i);
              }
              
              const blob = new Blob([arrayBuffer], { type: mimeType });
              resolve(blob);
            } catch (error) {
              reject(new Error(`处理下载数据失败: ${error.message}`));
            }
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
          progress: progressCallback,
          type: 'download'
        });
        
        // 发送下载请求
        if (session.socket && session.socket.readyState === WS_CONSTANTS.OPEN) {
          session.socket.send(JSON.stringify({
            type: 'sftp_download',
            data: {
              sessionId: sshSessionId,
              path: remotePath,
              operationId
            }
          }));
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
   * 下载文件夹（流式ZIP）
   * @param {string} sessionId - SFTP会话ID
   * @param {string} remotePath - 远程文件夹路径
   * @param {function} progressCallback - 进度回调函数
   * @returns {Promise<Blob>} - ZIP文件Blob对象
   */
  async downloadFolder(sessionId, remotePath, progressCallback) {
    await this._ensureSftpSession(sessionId);

    return new Promise((resolve, reject) => {
      const operationId = this._nextOperationId();

      try {
        // 获取SSH会话
        const { sshSessionId, session } = this._getSSHSession(sessionId);

        // 设置超时 - 文件夹下载可能需要更长时间
        const timeout = setTimeout(() => {
          this.fileOperations.delete(operationId);
          reject(new Error('文件夹下载超时'));
        }, 300000); // 5分钟超时

        // 保存操作回调
        this.fileOperations.set(operationId, {
          resolve: (data) => {
            clearTimeout(timeout);

            // 优化的Base64解码处理
            try {
              const base64Data = data.content.split(',')[1];
              const mimeType = 'application/zip';

              // 使用更高效的方式处理Base64数据
              const binaryString = atob(base64Data);
              const bytes = new Uint8Array(binaryString.length);

              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }

              const blob = new Blob([bytes], { type: mimeType });

              log.info(`文件夹下载完成: ${data.filename}, 大小: ${blob.size} 字节`);
              log.debug('下载数据详情:', {
                summary: data.summary,
                skippedCount: data.skippedFiles?.length || 0,
                errorCount: data.errorFiles?.length || 0
              });

              // 返回包含blob和详细信息的对象
              resolve({
                blob: blob,
                filename: data.filename,
                summary: data.summary,
                skippedFiles: data.skippedFiles || [],
                errorFiles: data.errorFiles || []
              });
            } catch (error) {
              log.error('处理ZIP数据失败:', error);
              reject(new Error(`处理ZIP数据失败: ${error.message}`));
            }
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
          progress: progressCallback,
          type: 'folder_download'
        });

        // 发送文件夹下载请求
        if (session.socket && session.socket.readyState === WS_CONSTANTS.OPEN) {
          session.socket.send(JSON.stringify({
            type: 'sftp_download_folder',
            data: {
              sessionId: sshSessionId,
              path: remotePath,
              operationId
            }
          }));
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
          session.socket.send(JSON.stringify({
            type: 'sftp_mkdir',
            data: {
              sessionId: sshSessionId,
              path: remotePath,
              operationId
            }
          }));
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
          session.socket.send(JSON.stringify({
            type: 'sftp_delete',
            data: {
              sessionId: sshSessionId,
              path: remotePath,
              isDirectory: false,
              operationId
            }
          }));
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
          session.socket.send(JSON.stringify({
            type: 'sftp_delete',
            data: {
              sessionId: sshSessionId,
              path: remotePath,
              isDirectory: isDirectory,
              operationId
            }
          }));
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
          session.socket.send(JSON.stringify({
            type: 'sftp_fast_delete',
            data: {
              sessionId: sshSessionId,
              path: remotePath,
              operationId
            }
          }));
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
          session.socket.send(JSON.stringify({
            type: 'sftp_rename',
            data: {
              sessionId: sshSessionId,
              oldPath: oldPath,
              newPath: newPath,
              operationId
            }
          }));
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
    return ++this.operationId;
  }
  
  /**
   * 处理来自服务器的SFTP消息
   */
  handleSftpMessage(message) {
    if (!message || !message.data) {
      log.warn('收到无效的SFTP消息:', message);
      return;
    }

    // 特殊处理SFTP会话关闭确认消息
    if (message.type === 'sftp_success' && message.data && message.data.message &&
        message.data.message.includes('SFTP会话已关闭') && !message.data.operationId) {
      return; // 无需产生警告，静默处理
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

      // 特殊处理可能已完成的操作
      if (message.type === 'sftp_success') {
        log.debug(`收到已完成操作的响应: ${operationId}, 消息类型: ${message.type}`);
        return; // 静默处理已完成的操作
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