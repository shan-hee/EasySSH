/**
 * SSH WebSocket服务
 * 用于处理SSH连接和WebSocket通信
 */

const ssh2 = require('ssh2');
const WebSocket = require('ws');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// 存储活动的SSH连接
const sessions = new Map();
// 存储活动的SFTP会话
const sftpSessions = new Map();

/**
 * 生成唯一的会话ID
 * @returns {string} 会话ID
 */
function generateSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * 创建SSH连接
 * @param {Object} config SSH连接配置
 * @returns {Promise<Object>} SSH连接对象
 */
function createSSHConnection(config) {
  return new Promise((resolve, reject) => {
    const conn = new ssh2.Client();
    
    // 连接超时设置
    const timeout = setTimeout(() => {
      conn.end();
      reject(new Error('连接超时'));
    }, 10000);
    
    conn.on('ready', () => {
      clearTimeout(timeout);
      console.log(`SSH连接成功: ${config.address}:${config.port}`);
      resolve(conn);
    });
    
    conn.on('error', (err) => {
      clearTimeout(timeout);
      console.error(`SSH连接错误: ${err.message}`);
      reject(err);
    });
    
    const sshConfig = {
      host: config.address,
      port: config.port || 22,
      username: config.username,
      readyTimeout: 10000,
    };
    
    // 根据认证方式设置配置
    if (config.authType === 'password') {
      sshConfig.password = config.password;
    } else if (config.authType === 'privateKey') {
      sshConfig.privateKey = config.privateKey;
      if (config.passphrase) {
        sshConfig.passphrase = config.passphrase;
      }
    }
    
    conn.connect(sshConfig);
  });
}

/**
 * 初始化WebSocket服务器
 * @param {Object} server HTTP服务器实例
 */
function initWebSocketServer(server) {
  const wss = new WebSocket.Server({ 
    server,
    path: '/ssh'
  });
  
  wss.on('connection', (ws) => {
    console.log('新的WebSocket连接');
    let sessionId = null;
    let session = null;
    
    ws.on('message', async (message) => {
      try {
        const msg = JSON.parse(message);
        const { type, data } = msg;
        
        switch (type) {
          case 'connect':
            // 处理连接请求
            handleConnect(ws, data);
            break;
            
          case 'data':
            // 处理数据传输
            handleData(ws, data);
            break;
            
          case 'resize':
            // 处理终端调整大小
            handleResize(ws, data);
            break;
            
          case 'disconnect':
            // 处理断开连接
            handleDisconnect(ws, data);
            break;
            
          case 'ping':
            // 处理保活消息
            handlePing(ws, data);
            break;
            
          case 'sftp_init':
            // 处理SFTP初始化
            handleSftpInit(ws, data);
            break;
            
          case 'sftp_list':
            // 处理SFTP列表目录
            handleSftpList(ws, data);
            break;
            
          case 'sftp_upload':
            // 处理SFTP上传
            handleSftpUpload(ws, data);
            break;
            
          case 'sftp_download':
            // 处理SFTP下载
            handleSftpDownload(ws, data);
            break;
            
          case 'sftp_mkdir':
            // 处理SFTP创建目录
            handleSftpMkdir(ws, data);
            break;
            
          case 'sftp_delete':
            // 处理SFTP删除
            handleSftpDelete(ws, data);
            break;
            
          case 'sftp_rename':
            // 处理SFTP重命名
            handleSftpRename(ws, data);
            break;
            
          case 'sftp_close':
            // 处理SFTP关闭
            handleSftpClose(ws, data);
            break;
            
          case 'ssh_exec':
            // 处理SSH命令执行请求
            handleSshExec(ws, data);
            break;
            
          default:
            sendError(ws, '未知的消息类型');
        }
      } catch (err) {
        console.error('处理消息错误:', err);
        sendError(ws, `处理消息错误: ${err.message}`);
      }
    });
    
    ws.on('close', () => {
      console.log('WebSocket连接关闭');
      
      // 清理资源
      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId);
        session.ws = null;
        
        // 如果客户端意外断开，先保留SSH连接一段时间
        // 允许客户端重新连接，延长保留时间到24小时
        clearTimeout(session.cleanupTimeout);
        session.cleanupTimeout = setTimeout(() => {
          if (sessions.has(sessionId) && !sessions.get(sessionId).ws) {
            cleanupSession(sessionId);
          }
        }, 24 * 60 * 60 * 1000); // 24小时后清理，实际上几乎相当于永久保留
      }
    });
    
    ws.on('error', (err) => {
      console.error('WebSocket错误:', err);
    });
    
    /**
     * 处理连接请求
     * @param {WebSocket} ws WebSocket连接
     * @param {Object} data 连接数据
     */
    async function handleConnect(ws, data) {
      try {
        sessionId = data.sessionId || generateSessionId();
        
        // 检查是否是重新连接到现有会话
        if (sessions.has(sessionId)) {
          session = sessions.get(sessionId);
          
          // 更新WebSocket连接
          session.ws = ws;
          clearTimeout(session.cleanupTimeout);
          
          // 通知客户端连接成功
          ws.send(JSON.stringify({
            type: 'connected',
            data: { sessionId }
          }));
          
          console.log(`重新连接到会话: ${sessionId}`);
          return;
        }
        
        // 创建新的SSH连接
        const conn = await createSSHConnection(data);
        
        // 保存连接信息
        const connectionInfo = {
          host: data.address,
          port: data.port || 22,
          username: data.username
        };
        
        // 创建新的会话
        session = {
          id: sessionId,
          conn,
          ws,
          stream: null,
          createdAt: new Date(),
          lastActivity: new Date(),
          cleanupTimeout: null,
          connectionInfo // 保存连接信息
        };
        
        sessions.set(sessionId, session);
        
        // 创建SSH Shell
        conn.shell({ term: 'xterm-color' }, (err, stream) => {
          if (err) {
            cleanupSession(sessionId);
            sendError(ws, `创建Shell失败: ${err.message}`);
            return;
          }
          
          session.stream = stream;
          
          // 处理SSH数据
          stream.on('data', (data) => {
            if (session.ws && session.ws.readyState === WebSocket.OPEN) {
              session.ws.send(JSON.stringify({
                type: 'data',
                data: {
                  sessionId,
                  data: data.toString('base64')
                }
              }));
            }
            
            session.lastActivity = new Date();
          });
          
          stream.on('close', () => {
            console.log(`SSH流关闭: ${sessionId}`);
            
            if (session.ws && session.ws.readyState === WebSocket.OPEN) {
              session.ws.send(JSON.stringify({
                type: 'closed',
                data: { sessionId }
              }));
            }
            
            cleanupSession(sessionId);
          });
          
          // 通知客户端连接成功
          ws.send(JSON.stringify({
            type: 'connected',
            data: { sessionId }
          }));
          
          console.log(`会话已创建: ${sessionId}`);
        });
      } catch (err) {
        console.error('创建SSH连接失败:', err);
        sendError(ws, `创建SSH连接失败: ${err.message}`);
      }
    }
    
    /**
     * 处理数据传输
     * @param {WebSocket} ws WebSocket连接
     * @param {Object} data 数据
     */
    function handleData(ws, data) {
      const { sessionId, data: sshData } = data;
      
      if (!sessionId || !sessions.has(sessionId)) {
        sendError(ws, '无效的会话ID');
        return;
      }
      
      const session = sessions.get(sessionId);
      
      if (!session.stream) {
        sendError(ws, 'SSH流未创建');
        return;
      }
      
      // 将数据发送到SSH流
      const buffer = Buffer.from(sshData, 'utf8');
      session.stream.write(buffer);
      session.lastActivity = new Date();
    }
    
    /**
     * 处理终端调整大小
     * @param {WebSocket} ws WebSocket连接
     * @param {Object} data 数据
     */
    function handleResize(ws, data) {
      const { sessionId, cols, rows } = data;
      
      if (!sessionId || !sessions.has(sessionId)) {
        sendError(ws, '无效的会话ID');
        return;
      }
      
      const session = sessions.get(sessionId);
      
      if (!session.stream) {
        sendError(ws, 'SSH流未创建');
        return;
      }
      
      // 调整终端大小
      session.stream.setWindow(rows, cols);
      session.lastActivity = new Date();
    }
    
    /**
     * 处理断开连接
     * @param {WebSocket} ws WebSocket连接
     * @param {Object} data 断开连接数据
     */
    function handleDisconnect(ws, data) {
      if (!sessionId) return;
      
      console.log(`断开会话连接: ${sessionId}`);
      
      cleanupSession(sessionId);
      
      ws.send(JSON.stringify({
        type: 'disconnected',
        data: { sessionId }
      }));
    }
    
    /**
     * 处理保活消息
     * @param {WebSocket} ws WebSocket连接
     * @param {Object} data 数据
     */
    function handlePing(ws, data) {
      const { sessionId } = data;
      
      if (!sessionId || !sessions.has(sessionId)) {
        // 如果会话不存在，可能是已经被清理，通知客户端重新连接
        ws.send(JSON.stringify({
          type: 'error',
          data: { message: '会话已失效，请重新连接', code: 'SESSION_EXPIRED' }
        }));
        return;
      }
      
      const session = sessions.get(sessionId);
      
      // 更新最后活动时间
      session.lastActivity = new Date();
      
      // 发送响应给客户端
      ws.send(JSON.stringify({
        type: 'pong',
        data: { 
          sessionId,
          timestamp: new Date().toISOString(),
          server: 'easyssh-server'
        }
      }));
    }
  });
  
  return wss;
}

/**
 * 发送错误消息
 * @param {WebSocket} ws WebSocket连接
 * @param {string} message 错误消息
 */
function sendError(ws, message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'error',
      data: { message }
    }));
  }
}

/**
 * 清理会话资源
 * @param {string} sessionId 会话ID
 */
function cleanupSession(sessionId) {
  if (!sessions.has(sessionId)) return;
  
  const session = sessions.get(sessionId);
  console.log(`清理会话: ${sessionId}`);
  
  try {
    if (session.stream) {
      session.stream.end();
      session.stream = null;
    }
    
    if (session.conn) {
      session.conn.end();
      session.conn = null;
    }
    
    // 清理定时器
    if (session.cleanupTimeout) {
      clearTimeout(session.cleanupTimeout);
    }
    
    // 删除会话
    sessions.delete(sessionId);
  } catch (err) {
    console.error(`清理会话资源错误: ${err.message}`);
  }
}

module.exports = {
  initWebSocketServer
}; 

/**
 * SFTP处理函数 - 初始化SFTP会话
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 请求数据
 */
async function handleSftpInit(ws, data) {
  const { sessionId } = data;
  
  if (!sessionId || !sessions.has(sessionId)) {
    sendError(ws, '无效的会话ID');
    return;
  }
  
  try {
    const session = sessions.get(sessionId);
    
    // 如果SFTP会话已存在，直接返回成功
    if (sftpSessions.has(sessionId)) {
      ws.send(JSON.stringify({
        type: 'sftp_ready',
        data: {
          sessionId,
          path: sftpSessions.get(sessionId).currentPath
        }
      }));
      console.log(`重用现有SFTP会话: ${sessionId}`);
      return;
    }
    
    // 创建新的SFTP会话
    session.conn.sftp((err, sftp) => {
      if (err) {
        console.error(`创建SFTP会话失败: ${err.message}`);
        ws.send(JSON.stringify({
          type: 'error',
          data: {
            sessionId,
            source: 'sftp',
            message: `创建SFTP会话失败: ${err.message}`
          }
        }));
        return;
      }
      
      // 获取当前目录
      sftp.realpath('.', (err, homePath) => {
        if (err) {
          console.error(`获取SFTP当前目录失败: ${err.message}`);
          homePath = '/'; // 默认为根目录
        }
        
        // 保存SFTP会话
        sftpSessions.set(sessionId, {
          sftp,
          currentPath: homePath
        });
        
        // 通知客户端SFTP准备就绪
        ws.send(JSON.stringify({
          type: 'sftp_ready',
          data: {
            sessionId,
            path: homePath
          }
        }));
        
        console.log(`SFTP会话已创建: ${sessionId}, 初始路径: ${homePath}`);
      });
    });
  } catch (err) {
    console.error(`处理SFTP初始化错误: ${err.message}`);
    ws.send(JSON.stringify({
      type: 'error',
      data: {
        sessionId,
        source: 'sftp',
        message: `SFTP初始化错误: ${err.message}`
      }
    }));
  }
}

/**
 * SFTP处理函数 - 列出目录
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 请求数据
 */
async function handleSftpList(ws, data) {
  const { sessionId, path: requestedPath, operationId } = data;
  
  if (!sessionId || !sftpSessions.has(sessionId)) {
    sendError(ws, '无效的SFTP会话');
    return;
  }
  
  try {
    const sftpSession = sftpSessions.get(sessionId);
    const sftp = sftpSession.sftp;
    const path = requestedPath || sftpSession.currentPath;
    
    // 读取目录内容
    sftp.readdir(path, (err, list) => {
      if (err) {
        console.error(`读取目录失败 ${path}: ${err.message}`);
        ws.send(JSON.stringify({
          type: 'sftp_error',
          data: {
            sessionId,
            operationId,
            message: `读取目录失败: ${err.message}`
          }
        }));
        return;
      }
      
      // 转换文件列表格式
      const fileList = list.map(item => {
        const isDirectory = item.attrs.isDirectory();
        return {
          name: item.filename,
          isDirectory,
          size: item.attrs.size,
          modifiedTime: new Date(item.attrs.mtime * 1000),
          permissions: item.attrs.mode
        };
      });
      
      // 如果不是根目录，添加上级目录选项
      if (path !== '/') {
        fileList.unshift({
          name: '..',
          isDirectory: true,
          size: 0,
          modifiedTime: new Date(),
          permissions: 0
        });
      }
      
      // 更新当前路径
      sftpSession.currentPath = path;
      
      // 发送目录列表给客户端
      ws.send(JSON.stringify({
        type: 'sftp_success',
        data: {
          sessionId,
          operationId,
          path,
          files: fileList
        }
      }));
      
      console.log(`已列出目录 ${path}, 包含 ${fileList.length} 个文件`);
    });
  } catch (err) {
    console.error(`处理SFTP列表错误: ${err.message}`);
    ws.send(JSON.stringify({
      type: 'sftp_error',
      data: {
        sessionId,
        operationId,
        message: `列出目录错误: ${err.message}`
      }
    }));
  }
}

/**
 * SFTP处理函数 - 上传文件
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 请求数据
 */
async function handleSftpUpload(ws, data) {
  const { sessionId, path: remotePath, filename, content, operationId } = data;
  
  if (!sessionId || !sftpSessions.has(sessionId)) {
    sendError(ws, '无效的SFTP会话');
    return;
  }
  
  try {
    const sftpSession = sftpSessions.get(sessionId);
    const sftp = sftpSession.sftp;
    
    // 解析Base64内容
    const matches = content.match(/^data:(.+);base64,(.+)$/);
    if (!matches) {
      throw new Error('无效的文件内容格式');
    }
    
    const buffer = Buffer.from(matches[2], 'base64');
    const totalSize = buffer.length;
    let uploaded = 0;
    
    // 创建可写流
    const writeStream = sftp.createWriteStream(remotePath);
    
    // 设置事件处理器
    writeStream.on('error', (err) => {
      console.error(`文件上传错误 ${remotePath}: ${err.message}`);
      ws.send(JSON.stringify({
        type: 'sftp_error',
        data: {
          sessionId,
          operationId,
          message: `文件上传错误: ${err.message}`
        }
      }));
    });
    
    writeStream.on('finish', () => {
      // 发送上传成功消息
      ws.send(JSON.stringify({
        type: 'sftp_success',
        data: {
          sessionId,
          operationId,
          path: remotePath,
          size: totalSize
        }
      }));
      
      console.log(`文件上传成功: ${remotePath}, 大小: ${totalSize} 字节`);
    });
    
    // 分块上传，每次发送进度更新
    const chunkSize = 16 * 1024; // 16KB
    let position = 0;
    
    const sendChunk = () => {
      if (position >= totalSize) {
        writeStream.end();
        return;
      }
      
      const end = Math.min(position + chunkSize, totalSize);
      const chunk = buffer.slice(position, end);
      
      writeStream.write(chunk, () => {
        position = end;
        uploaded = position;
        
        // 发送进度更新
        const progress = Math.floor((uploaded / totalSize) * 100);
        ws.send(JSON.stringify({
          type: 'sftp_progress',
          data: {
            sessionId,
            operationId,
            progress
          }
        }));
        
        // 继续发送下一块
        process.nextTick(sendChunk);
      });
    };
    
    // 开始上传
    sendChunk();
  } catch (err) {
    console.error(`处理SFTP上传错误: ${err.message}`);
    ws.send(JSON.stringify({
      type: 'sftp_error',
      data: {
        sessionId,
        operationId,
        message: `文件上传错误: ${err.message}`
      }
    }));
  }
}

/**
 * SFTP处理函数 - 下载文件
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 请求数据
 */
async function handleSftpDownload(ws, data) {
  const { sessionId, path: remotePath, operationId } = data;
  
  if (!sessionId || !sftpSessions.has(sessionId)) {
    sendError(ws, '无效的SFTP会话');
    return;
  }
  
  try {
    const sftpSession = sftpSessions.get(sessionId);
    const sftp = sftpSession.sftp;
    
    // 获取文件信息
    sftp.stat(remotePath, (err, stats) => {
      if (err) {
        console.error(`获取文件信息失败 ${remotePath}: ${err.message}`);
        ws.send(JSON.stringify({
          type: 'sftp_error',
          data: {
            sessionId,
            operationId,
            message: `获取文件信息失败: ${err.message}`
          }
        }));
        return;
      }
      
      // 检查是否是文件
      if (!stats.isFile()) {
        ws.send(JSON.stringify({
          type: 'sftp_error',
          data: {
            sessionId,
            operationId,
            message: '不能下载文件夹，只能下载文件'
          }
        }));
        return;
      }
      
      // 获取文件大小
      const fileSize = stats.size;
      
      // 创建可读流
      const readStream = sftp.createReadStream(remotePath);
      const chunks = [];
      let downloaded = 0;
      
      readStream.on('data', (chunk) => {
        chunks.push(chunk);
        downloaded += chunk.length;
        
        // 计算进度
        const progress = Math.floor((downloaded / fileSize) * 100);
        
        // 发送进度更新
        ws.send(JSON.stringify({
          type: 'sftp_progress',
          data: {
            sessionId,
            operationId,
            progress
          }
        }));
      });
      
      readStream.on('error', (err) => {
        console.error(`文件下载错误 ${remotePath}: ${err.message}`);
        ws.send(JSON.stringify({
          type: 'sftp_error',
          data: {
            sessionId,
            operationId,
            message: `文件下载错误: ${err.message}`
          }
        }));
      });
      
      readStream.on('end', () => {
        // 将所有数据块合并为一个Buffer
        const buffer = Buffer.concat(chunks);
        
        // 将文件内容转换为Base64
        const base64Content = buffer.toString('base64');
        
        // 获取文件MIME类型
        const mime = getMimeType(remotePath);
        
        // 发送下载完成消息
        ws.send(JSON.stringify({
          type: 'sftp_success',
          data: {
            sessionId,
            operationId,
            path: remotePath,
            size: fileSize,
            mimeType: mime,
            content: `data:${mime};base64,${base64Content}`
          }
        }));
        
        console.log(`文件下载成功: ${remotePath}, 大小: ${fileSize} 字节`);
      });
    });
  } catch (err) {
    console.error(`处理SFTP下载错误: ${err.message}`);
    ws.send(JSON.stringify({
      type: 'sftp_error',
      data: {
        sessionId,
        operationId,
        message: `文件下载错误: ${err.message}`
      }
    }));
  }
}

/**
 * SFTP处理函数 - 创建目录
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 请求数据
 */
async function handleSftpMkdir(ws, data) {
  const { sessionId, path: dirPath, operationId } = data;
  
  if (!sessionId || !sftpSessions.has(sessionId)) {
    sendError(ws, '无效的SFTP会话');
    return;
  }
  
  try {
    const sftpSession = sftpSessions.get(sessionId);
    const sftp = sftpSession.sftp;
    
    // 创建目录
    sftp.mkdir(dirPath, (err) => {
      if (err) {
        console.error(`创建目录失败 ${dirPath}: ${err.message}`);
        ws.send(JSON.stringify({
          type: 'sftp_error',
          data: {
            sessionId,
            operationId,
            message: `创建目录失败: ${err.message}`
          }
        }));
        return;
      }
      
      // 发送成功消息
      ws.send(JSON.stringify({
        type: 'sftp_success',
        data: {
          sessionId,
          operationId,
          path: dirPath
        }
      }));
      
      console.log(`目录创建成功: ${dirPath}`);
    });
  } catch (err) {
    console.error(`处理SFTP创建目录错误: ${err.message}`);
    ws.send(JSON.stringify({
      type: 'sftp_error',
      data: {
        sessionId,
        operationId,
        message: `创建目录错误: ${err.message}`
      }
    }));
  }
}

/**
 * SFTP处理函数 - 删除文件或目录
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 请求数据
 */
async function handleSftpDelete(ws, data) {
  const { sessionId, path: targetPath, isDirectory, operationId } = data;
  
  if (!sessionId || !sftpSessions.has(sessionId)) {
    sendError(ws, '无效的SFTP会话');
    return;
  }
  
  try {
    const sftpSession = sftpSessions.get(sessionId);
    const sftp = sftpSession.sftp;
    
    if (isDirectory) {
      // 删除目录
      sftp.rmdir(targetPath, (err) => {
        if (err) {
          console.error(`删除目录失败 ${targetPath}: ${err.message}`);
          ws.send(JSON.stringify({
            type: 'sftp_error',
            data: {
              sessionId,
              operationId,
              message: `删除目录失败: ${err.message}`
            }
          }));
          return;
        }
        
        // 发送成功消息
        ws.send(JSON.stringify({
          type: 'sftp_success',
          data: {
            sessionId,
            operationId,
            path: targetPath
          }
        }));
        
        console.log(`目录删除成功: ${targetPath}`);
      });
    } else {
      // 删除文件
      sftp.unlink(targetPath, (err) => {
        if (err) {
          console.error(`删除文件失败 ${targetPath}: ${err.message}`);
          ws.send(JSON.stringify({
            type: 'sftp_error',
            data: {
              sessionId,
              operationId,
              message: `删除文件失败: ${err.message}`
            }
          }));
          return;
        }
        
        // 发送成功消息
        ws.send(JSON.stringify({
          type: 'sftp_success',
          data: {
            sessionId,
            operationId,
            path: targetPath
          }
        }));
        
        console.log(`文件删除成功: ${targetPath}`);
      });
    }
  } catch (err) {
    console.error(`处理SFTP删除错误: ${err.message}`);
    ws.send(JSON.stringify({
      type: 'sftp_error',
      data: {
        sessionId,
        operationId,
        message: `删除错误: ${err.message}`
      }
    }));
  }
}

/**
 * SFTP处理函数 - 重命名文件或目录
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 请求数据
 */
async function handleSftpRename(ws, data) {
  const { sessionId, oldPath, newPath, operationId } = data;
  
  if (!sessionId || !sftpSessions.has(sessionId)) {
    sendError(ws, '无效的SFTP会话');
    return;
  }
  
  try {
    const sftpSession = sftpSessions.get(sessionId);
    const sftp = sftpSession.sftp;
    
    // 重命名文件/目录
    sftp.rename(oldPath, newPath, (err) => {
      if (err) {
        console.error(`重命名失败 ${oldPath} -> ${newPath}: ${err.message}`);
        ws.send(JSON.stringify({
          type: 'sftp_error',
          data: {
            sessionId,
            operationId,
            message: `重命名失败: ${err.message}`
          }
        }));
        return;
      }
      
      // 发送成功消息
      ws.send(JSON.stringify({
        type: 'sftp_success',
        data: {
          sessionId,
          operationId,
          oldPath,
          newPath
        }
      }));
      
      console.log(`重命名成功: ${oldPath} -> ${newPath}`);
    });
  } catch (err) {
    console.error(`处理SFTP重命名错误: ${err.message}`);
    ws.send(JSON.stringify({
      type: 'sftp_error',
      data: {
        sessionId,
        operationId,
        message: `重命名错误: ${err.message}`
      }
    }));
  }
}

/**
 * SFTP处理函数 - 关闭SFTP会话
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 请求数据
 */
async function handleSftpClose(ws, data) {
  const { sessionId } = data;
  
  if (!sessionId || !sftpSessions.has(sessionId)) {
    // 如果会话不存在，直接返回成功
    ws.send(JSON.stringify({
      type: 'sftp_success',
      data: {
        sessionId,
        message: '会话已关闭'
      }
    }));
    return;
  }
  
  try {
    // 关闭SFTP会话
    const sftpSession = sftpSessions.get(sessionId);
    
    // SFTP没有显式的关闭方法，直接删除引用即可
    sftpSessions.delete(sessionId);
    
    // 发送成功消息
    ws.send(JSON.stringify({
      type: 'sftp_success',
      data: {
        sessionId,
        message: '会话已关闭'
      }
    }));
    
    console.log(`SFTP会话已关闭: ${sessionId}`);
  } catch (err) {
    console.error(`处理SFTP关闭错误: ${err.message}`);
    ws.send(JSON.stringify({
      type: 'sftp_error',
      data: {
        sessionId,
        message: `关闭SFTP会话错误: ${err.message}`
      }
    }));
  }
}

/**
 * 获取文件的MIME类型
 * @param {string} filepath 文件路径
 * @returns {string} MIME类型
 */
function getMimeType(filepath) {
  const ext = path.extname(filepath).toLowerCase();
  
  const mimeTypes = {
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.zip': 'application/zip',
    '.rar': 'application/x-rar-compressed',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.7z': 'application/x-7z-compressed'
  };
  
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * 处理SSH命令执行请求
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 请求数据
 */
async function handleSshExec(ws, data) {
  const { sessionId, command, operationId } = data;
  
  if (!sessionId || !sessions.has(sessionId)) {
    sendError(ws, '无效的会话ID');
    return;
  }
  
  try {
    const session = sessions.get(sessionId);
    
    if (!session.conn) {
      throw new Error('SSH连接不可用');
    }
    
    // 执行命令
    session.conn.exec(command, (err, stream) => {
      if (err) {
        console.error(`执行命令失败: ${err.message}`);
        ws.send(JSON.stringify({
          type: 'sftp_error',
          data: {
            sessionId,
            operationId,
            message: `执行命令失败: ${err.message}`
          }
        }));
        return;
      }
      
      let stdout = '';
      let stderr = '';
      
      stream.on('data', (data) => {
        stdout += data.toString();
      });
      
      stream.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      stream.on('close', (code) => {
        console.log(`命令执行完成，退出码: ${code}`);
        
        // 发送执行结果
        ws.send(JSON.stringify({
          type: 'sftp_success',
          data: {
            sessionId,
            operationId,
            stdout,
            stderr,
            exitCode: code
          }
        }));
      });
    });
  } catch (err) {
    console.error(`SSH命令执行错误: ${err.message}`);
    ws.send(JSON.stringify({
      type: 'sftp_error',
      data: {
        sessionId,
        operationId,
        message: `SSH命令执行错误: ${err.message}`
      }
    }));
  }
} 