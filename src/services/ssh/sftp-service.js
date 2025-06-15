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
              progressCallback(progress);
              
              // 收到100%进度时，立即完成
              if (progress === 100 && !autoCompletedFlag) {
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
          const fileContent = event.target.result;
          
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
        };
        
        reader.onerror = (error) => {
          clearTimeout(timeout);
          this.fileOperations.delete(operationId);
          reject(new Error(`读取文件失败: ${error.message || '未知错误'}`));
        };
        
        // 开始读取文件
        reader.readAsDataURL(file);
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
        reader.onerror = (e) => reject(new Error('读取文件内容失败'));
        reader.readAsText(fileBlob);
      });
    } catch (error) {
      log.error(`获取文件内容失败 ${remotePath}:`, error);
      throw new Error(`获取文件内容失败: ${error.message || '未知错误'}`);
    }
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
    
    // 查找对应的操作
    if (!this.fileOperations.has(operationId)) {
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