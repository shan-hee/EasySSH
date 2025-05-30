/**
 * SSH WebSocket服务
 * 用于处理SSH连接和WebSocket通信
 */

const WebSocket = require('ws');
const url = require('url');

// 导入SSH、SFTP和工具模块
const ssh = require('./ssh');
const sftp = require('./sftp');
const utils = require('./utils');

// 存储临时连接配置的映射
const pendingConnections = new Map();

// 清理过期的连接配置的定时任务
setInterval(() => {
  const now = Date.now();
  const expirationTime = 30 * 60 * 1000; // 30分钟过期
  
  for (const [id, data] of pendingConnections.entries()) {
    if (now - data.timestamp > expirationTime) {
      pendingConnections.delete(id);
      console.log(utils.logMessage('清理过期连接ID', id));
    }
  }
}, 15 * 60 * 1000); // 每15分钟执行一次清理

/**
 * 从HTTP请求中获取客户端真实IP地址
 * @param {Object} request HTTP请求对象
 * @returns {string|null} 客户端IP地址或null
 */
function getClientIP(request) {
  if (!request) return null;
  
  // 尝试从各种可能的请求头中获取IP
  const clientIP = request.headers['x-forwarded-for'] || 
                   request.headers['x-real-ip'] || 
                   request.connection.remoteAddress ||
                   request.socket.remoteAddress ||
                   (request.connection.socket ? request.connection.socket.remoteAddress : null);
  
  // 处理IPv6格式 (::ffff:127.0.0.1)
  if (clientIP && clientIP.indexOf('::ffff:') === 0) {
    return clientIP.substring(7);
  }
  
  return clientIP;
}

/**
 * 初始化WebSocket服务器
 * @param {Object} server HTTP服务器实例
 */
function initWebSocketServer(server) {
  // 创建不绑定到服务器的WebSocket服务器
  const wss = new WebSocket.Server({ 
    noServer: true
  });
  
  // 监听HTTP服务器的upgrade事件
  server.on('upgrade', (request, socket, head) => {
    const pathname = url.parse(request.url).pathname;
    
    // 只处理SSH路径的WebSocket请求
    if (pathname === '/ssh') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        // 传递请求对象，以便访问客户端IP
        wss.emit('connection', ws, request);
      });
    }
  });
  
  wss.on('connection', (ws, request) => {
    console.log(utils.logMessage('新的WebSocket连接', '已建立'));
    let sessionId = null;
    
    // 获取客户端IP地址
    const clientIP = getClientIP(request);
    console.log(utils.logMessage('客户端IP', clientIP || '未知'));
    
    ws.on('message', async (message) => {
      try {
        const msg = JSON.parse(message);
        const { type, data } = msg;
        
        switch (type) {
          case 'connect':
            // 处理连接请求
            if (data) {
              // 添加客户端IP到连接数据
              data.clientIP = clientIP;
              
              // 检查是否使用安全连接ID模式
              if (data.connectionId) {
                console.log(utils.logMessage('收到安全连接ID请求', data.connectionId));
                
                // 注册连接ID
                if (!pendingConnections.has(data.connectionId)) {
                  pendingConnections.set(data.connectionId, {
                    timestamp: Date.now(),
                    sessionId: data.sessionId
                  });
                  
                  // 通知客户端连接ID已注册，请求认证信息
                  utils.sendMessage(ws, 'connection_id_registered', {
                    connectionId: data.connectionId,
                    sessionId: data.sessionId,
                    status: 'need_auth'
                  });
                } else {
                  // 连接ID已存在，可能是重连
                  const pendingData = pendingConnections.get(data.connectionId);
                  pendingData.timestamp = Date.now(); // 更新时间戳
                  
                  utils.sendMessage(ws, 'connection_id_registered', {
                    connectionId: data.connectionId,
                    sessionId: data.sessionId || pendingData.sessionId,
                    status: 'reconnected' 
                  });
                }
              } else {
                // 传统模式：直接包含所有连接信息
            sessionId = await ssh.handleConnect(ws, data);
              }
            }
            break;
            
          case 'authenticate':
            // 处理认证请求（安全模式）
            if (data && data.connectionId) {
              console.log(utils.logMessage('处理认证请求', data.connectionId));
              
              // 验证连接ID是否存在
              if (pendingConnections.has(data.connectionId)) {
                const pendingData = pendingConnections.get(data.connectionId);
                
                // 获取基本连接信息
                let connectionConfig = {
                  sessionId: pendingData.sessionId || data.sessionId,
                  clientIP: clientIP
                };
                
                // 解密认证载荷
                if (data.encryptedPayload && data.keyId) {
                  try {
                    // 解密完整认证载荷
                    const decryptedPayloadString = decryptSensitiveData(data.encryptedPayload, data.keyId);
                    const authPayload = JSON.parse(decryptedPayloadString);
                    
                    // 将解密的载荷合并到连接配置中
                    connectionConfig = {
                      ...connectionConfig,
                      address: authPayload.address,
                      port: authPayload.port || 22,
                      username: authPayload.username,
                      authType: authPayload.authType || 'password'
                    };
                    
                    // 添加认证凭据
                    if (authPayload.authType === 'password') {
                      connectionConfig.password = authPayload.password;
                    } else if (authPayload.authType === 'privateKey' || authPayload.authType === 'key') {
                      connectionConfig.privateKey = authPayload.privateKey;
                      if (authPayload.passphrase) {
                        connectionConfig.passphrase = authPayload.passphrase;
                      }
                    }
                    
                    // 记录安全日志，不包含敏感信息
                    console.log(utils.logMessage('SSH连接请求（安全模式）', 
                      `用户: ${connectionConfig.username}, 地址: ${connectionConfig.address}:${connectionConfig.port}, ` +
                      `认证方式: ${connectionConfig.authType}, 客户端IP: ${connectionConfig.clientIP || '未知'}`
                    ));
                    
                    // 建立SSH连接
                    sessionId = await ssh.handleConnect(ws, connectionConfig);
                    
                    // 连接成功后删除临时连接ID
                    pendingConnections.delete(data.connectionId);
                  } catch (decryptError) {
                    console.error(utils.logMessage('解密认证载荷失败', decryptError.message));
                    utils.sendError(ws, `认证失败: 无法解密认证信息`, data.sessionId);
                  }
                } else {
                  utils.sendError(ws, '无效的认证信息: 缺少加密数据', data.sessionId);
                }
              } else {
                utils.sendError(ws, '无效的连接ID或已过期', data.sessionId);
              }
            } else {
              utils.sendError(ws, '无效的认证请求', data.sessionId);
            }
            break;
            
          case 'data':
            // 处理数据传输
            ssh.handleData(ws, data);
            break;
            
          case 'resize':
            // 处理终端调整大小
            ssh.handleResize(ws, data);
            break;
            
          case 'disconnect':
            // 处理断开连接
            ssh.handleDisconnect(ws, data);
            break;
            
          case 'ping':
            // 处理保活消息
            ssh.handlePing(ws, data);
            break;
            
          case 'sftp_init':
            // 处理SFTP初始化
            sftp.handleSftpInit(ws, data, ssh.sessions);
            break;
            
          case 'sftp_list':
            // 处理SFTP列表目录
            sftp.handleSftpList(ws, data);
            break;
            
          case 'sftp_upload':
            // 处理SFTP上传
            console.log(`收到sftp_upload请求: 会话=${data.sessionId}, 操作ID=${data.operationId}, 路径=${data.path}`);
            sftp.handleSftpUpload(ws, data);
            break;
            
          case 'sftp_download':
            // 处理SFTP下载
            sftp.handleSftpDownload(ws, data);
            break;
            
          case 'sftp_mkdir':
            // 处理SFTP创建目录
            sftp.handleSftpMkdir(ws, data);
            break;
            
          case 'sftp_delete':
            // 处理SFTP删除
            sftp.handleSftpDelete(ws, data);
            break;
            
          case 'sftp_rename':
            // 处理SFTP重命名
            sftp.handleSftpRename(ws, data);
            break;
            
          case 'sftp_close':
            // 处理SFTP关闭
            sftp.handleSftpClose(ws, data);
            break;
            
          case 'ssh_exec':
            // 处理SSH命令执行请求
            ssh.handleSshExec(ws, data);
            break;
            
          default:
            utils.sendError(ws, '未知的消息类型', sessionId);
        }
      } catch (err) {
        console.error(utils.logMessage('处理消息', 'WebSocket', '错误', err.message));
        utils.sendError(ws, `处理消息错误: ${err.message}`, sessionId);
      }
    });
    
    ws.on('close', () => {
      console.log(utils.logMessage('WebSocket连接', '已关闭'));
      
      // 清理资源
      if (sessionId && ssh.sessions.has(sessionId)) {
        const session = ssh.sessions.get(sessionId);
        session.ws = null;
        
        // 如果客户端意外断开，先保留SSH连接一段时间
        // 允许客户端重新连接，延长保留时间到24小时
        clearTimeout(session.cleanupTimeout);
        session.cleanupTimeout = setTimeout(() => {
          if (ssh.sessions.has(sessionId) && !ssh.sessions.get(sessionId).ws) {
            ssh.cleanupSession(sessionId);
          }
        }, 24 * 60 * 60 * 1000); // 24小时后清理，实际上几乎相当于永久保留
      }
    });
    
    ws.on('error', (err) => {
      console.error(utils.logMessage('WebSocket', '', '错误', err.message));
    });
  });
  
  return wss;
}

/**
 * 解密敏感数据
 * @param {string} encryptedData Base64编码的加密数据
 * @param {string} key 解密密钥
 * @returns {string} 解密后的数据
 */
function decryptSensitiveData(encryptedData, key) {
  try {
    if (!encryptedData) return '';
    
    // 将Base64字符串转换为字节数组
    const encryptedBytes = Buffer.from(encryptedData, 'base64');
    
    // 提取IV（前12字节）和加密数据
    const iv = encryptedBytes.slice(0, 12);
    const dataBytes = encryptedBytes.slice(12);
    
    // 将密钥转换为字节数组
    const keyBytes = Buffer.from(key, 'utf8');
    
    // 使用XOR解密
    const result = Buffer.alloc(dataBytes.length);
    const keyLength = keyBytes.length;
    const ivLength = iv.length;
    
    for (let i = 0; i < dataBytes.length; i++) {
      // 使用XOR运算进行解密（与加密操作相同）
      result[i] = dataBytes[i] ^ keyBytes[i % keyLength] ^ iv[i % ivLength];
    }
    
    // 转换为字符串
    return result.toString('utf8');
  } catch (error) {
    console.error(utils.logMessage('解密敏感数据失败', error.message));
    throw error;
  }
}

module.exports = {
  initWebSocketServer
}; 
