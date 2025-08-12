/**
 * SSH WebSocket服务
 * 用于处理SSH连接和WebSocket通信
 */

const WebSocket = require('ws');
const url = require('url');
const logger = require('../utils/logger');

// 导入SSH、SFTP和工具模块
const ssh = require('./ssh');
const sftp = require('./sftp');
const utils = require('./utils');

// 导入监控处理模块
const monitoring = require('../monitoring');
const aiService = require('../ai');

// 导入消息验证器
const { validateMessage, createErrorResponse, formatValidationErrors, ERROR_CODES } = require('../utils/message-validator');



// 存储临时连接配置的映射
const pendingConnections = new Map();

// 清理过期的连接配置的定时任务
setInterval(() => {
  const now = Date.now();
  const expirationTime = 30 * 60 * 1000; // 30分钟过期
  
  for (const [id, data] of pendingConnections.entries()) {
    if (now - data.timestamp > expirationTime) {
      pendingConnections.delete(id);
      logger.debug('清理过期连接ID', { connectionId: id });
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
 * 初始化WebSocket服务器 - 重构版
 * 统一处理SSH和监控WebSocket连接
 * @param {Object} server HTTP服务器实例
 */
function initWebSocketServer(server) {
  // 获取WebSocket最大消息大小配置
  const maxMessageSize = parseInt(process.env.WS_MAX_MESSAGE_SIZE) || 157286400; // 默认150MB
  const logger = require('../utils/logger');

  // 记录WebSocket配置
  logger.info('WebSocket服务器配置', {
    maxMessageSize: `${(maxMessageSize / (1024 * 1024)).toFixed(0)}MB`,
    maxMessageSizeBytes: maxMessageSize
  });

  // 创建SSH WebSocket服务器 - 优化配置
  const sshWss = new WebSocket.Server({
    noServer: true,
    maxPayload: maxMessageSize, // 设置最大消息大小
    perMessageDeflate: {
      threshold: 1024,        // 仅压缩>1KB的消息
      concurrencyLimit: 10,   // 限制并发压缩
      memLevel: 7,           // 平衡内存和压缩率
      serverMaxWindowBits: 15, // 服务器窗口大小
      clientMaxWindowBits: 15, // 客户端窗口大小
      serverMaxNoContextTakeover: false, // 允许服务器上下文复用
      clientMaxNoContextTakeover: false  // 允许客户端上下文复用
    }
  });

  // 创建监控WebSocket服务器
  const monitorWss = new WebSocket.Server({
    noServer: true,
    maxPayload: 1024 * 1024, // 监控消息较小，1MB足够
    perMessageDeflate: true // 监控数据可以压缩
  });

  // 统一处理HTTP服务器的upgrade事件
  server.on('upgrade', (request, socket, head) => {
    const pathname = url.parse(request.url).pathname;

    if (pathname === '/ssh') {
      // 处理SSH WebSocket连接
      sshWss.handleUpgrade(request, socket, head, (ws) => {
        sshWss.emit('connection', ws, request);
      });
    } else if (pathname === '/monitor') {
      // 处理前端监控WebSocket连接 - 专用前端监控通道
      const requestUrl = new URL(request.url, `http://${request.headers.host}`);
      const subscribeServer = requestUrl.searchParams.get('subscribe');

      logger.debug('收到前端监控WebSocket连接请求', {
        url: request.url,
        subscribeServer
      });

      monitorWss.handleUpgrade(request, socket, head, (ws) => {
        // 生成会话ID并处理前端监控连接
        const sessionId = `monitor_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const clientIp = getClientIP(request);

        // 直接处理为前端监控连接
        monitoring.handleFrontendConnection(ws, sessionId, clientIp, subscribeServer);
      });
    } else if (pathname === '/monitor-client') {
      // 处理监控客户端WebSocket连接 - 专用监控客户端通道
      logger.debug('收到监控客户端WebSocket连接请求', {
        url: request.url,
        clientIp: getClientIP(request)
      });

      monitorWss.handleUpgrade(request, socket, head, (ws) => {
        // 生成会话ID并处理监控客户端连接
        const sessionId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const clientIp = getClientIP(request);

        // 直接处理为监控客户端连接
        monitoring.handleMonitoringClientConnection(ws, sessionId, clientIp);
      });
    } else if (pathname === '/ai') {
      // 处理AI WebSocket连接
      logger.debug('收到AI WebSocket连接请求', {
        url: request.url
      });

      aiService.handleUpgrade(request, socket, head);
    } else {
      // 未知路径，关闭连接
      socket.destroy();
    }
  });

  // 处理SSH WebSocket连接
  sshWss.on('connection', (ws, request) => {
    // 获取客户端IP地址
    const clientIP = getClientIP(request);

    logger.info('新的SSH WebSocket连接已建立', {
      clientIP: clientIP || '未知',
      userAgent: request.headers['user-agent']
    });

    let sessionId = null;

    // 设置原生WebSocket心跳
    ws.isAlive = true;
    ws.connectionTime = Date.now();
    ws.lastPing = 0;

    ws.on('pong', () => {
      ws.isAlive = true;
      const latency = Date.now() - ws.lastPing;

      // 只在延迟异常时记录日志（超过500ms）
      if (latency > 500) {
        logger.debug('收到WebSocket pong - 高延迟', {
          sessionId,
          latency: `${latency}ms`,
          clientIP
        });
      }
    });
    
    ws.on('message', async (message, isBinary) => {
      try {
        if (isBinary) {
          // 处理二进制消息
          handleBinaryMessage(ws, message, sessionId);
          return;
        }

        // 处理JSON消息
        let msg;
        try {
          msg = JSON.parse(message);
        } catch (parseError) {
          logger.warn('JSON解析失败', { error: parseError.message });
          const errorResponse = createErrorResponse(
            ERROR_CODES.INVALID_MESSAGE_FORMAT,
            'JSON格式错误'
          );
          ws.send(JSON.stringify(errorResponse));
          return;
        }

        // 验证消息格式
        const validation = validateMessage(msg);
        if (!validation.isValid) {
          logger.warn('消息验证失败', {
            errorCode: validation.errorCode,
            errorMessage: validation.errorMessage,
            errors: formatValidationErrors(validation.errors)
          });

          const errorResponse = createErrorResponse(
            validation.errorCode,
            validation.errorMessage,
            msg.requestId
          );
          ws.send(JSON.stringify(errorResponse));
          return;
        }

        // 使用验证后的消息
        const { type, data } = validation.sanitizedMessage;
        
        switch (type) {
          case 'connect':
            // 处理连接请求
            if (data) {
              // 添加客户端IP到连接数据
              data.clientIP = clientIP;
              
              // 检查是否使用安全连接ID模式
              if (data.connectionId) {
                logger.debug('收到安全连接ID请求', { connectionId: data.connectionId });
                
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
              logger.debug('处理认证请求', { connectionId: data.connectionId });
              
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
                    logger.info('SSH连接请求（安全模式）', {
                      username: connectionConfig.username,
                      address: connectionConfig.address,
                      port: connectionConfig.port,
                      authType: connectionConfig.authType,
                      clientIP: connectionConfig.clientIP || '未知'
                    });
                    
                    // 建立SSH连接
                    sessionId = await ssh.handleConnect(ws, connectionConfig);
                    
                    // 连接成功后删除临时连接ID
                    pendingConnections.delete(data.connectionId);
                  } catch (decryptError) {
                    logger.error('解密认证载荷失败', { error: decryptError.message });
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

          // latency_update 消息已废弃，现在延迟测量直接在ping中处理

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
            logger.debug('收到SFTP上传请求', {
              sessionId: data.sessionId,
              operationId: data.operationId,
              path: data.path
            });
            sftp.handleSftpUpload(ws, data);
            break;
            
          case 'sftp_download':
            // 处理SFTP下载
            sftp.handleSftpDownload(ws, data);
            break;

          case 'sftp_download_folder':
            // 处理SFTP文件夹下载
            logger.debug('收到SFTP文件夹下载请求', {
              sessionId: data.sessionId,
              operationId: data.operationId,
              path: data.path
            });
            sftp.handleSftpDownloadFolder(ws, data);
            break;

          case 'sftp_mkdir':
            // 处理SFTP创建目录
            sftp.handleSftpMkdir(ws, data);
            break;
            
          case 'sftp_delete':
            // 处理SFTP删除
            sftp.handleSftpDelete(ws, data);
            break;

          case 'sftp_fast_delete':
            // 处理SFTP快速删除
            sftp.handleSftpFastDelete(ws, data);
            break;

          case 'sftp_chmod':
            // 处理SFTP权限修改
            sftp.handleSftpChmod(ws, data);
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
        logger.error('处理SSH WebSocket消息错误', { error: err.message });
        utils.sendError(ws, `处理消息错误: ${err.message}`, sessionId);
      }
    });
    
    ws.on('close', () => {
      logger.info('SSH WebSocket连接已关闭', { sessionId });

      // 立即停止监控数据收集
      if (sessionId) {
        try {
          const monitoringBridge = require('../services/monitoringBridge');
          const stopped = monitoringBridge.stopMonitoring(sessionId, 'websocket_close');
          // 只在实际停止时记录日志，避免重复日志
          if (stopped) {
            logger.debug('SSH WebSocket断开，监控数据收集已停止', { sessionId });
          }
        } catch (error) {
          logger.warn('停止监控数据收集失败', {
            sessionId,
            error: error.message
          });
        }
      }

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
      logger.error('SSH WebSocket错误', { sessionId, error: err.message });

      // WebSocket错误时也停止监控数据收集
      if (sessionId) {
        try {
          const monitoringBridge = require('../services/monitoringBridge');
          monitoringBridge.stopMonitoring(sessionId);
          logger.debug('SSH WebSocket错误，监控数据收集已停止', { sessionId });
        } catch (error) {
          logger.warn('停止监控数据收集失败', {
            sessionId,
            error: error.message
          });
        }
      }
    });
  });

  // 注意：监控WebSocket连接现在直接在upgrade事件中处理，
  // 不再需要单独的connection事件监听器

  // 设置全局WebSocket心跳机制
  setupGlobalHeartbeat(sshWss);

  return { sshWss, monitorWss };
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
    logger.error('解密敏感数据失败', { error: error.message });
    throw error;
  }
}

/**
 * 设置全局WebSocket心跳机制
 * @param {WebSocket.Server} wss WebSocket服务器
 */
function setupGlobalHeartbeat(wss) {
  const HEARTBEAT_INTERVAL = 15000; // 15秒
  const HEARTBEAT_TIMEOUT = 45000;  // 45秒超时

  logger.info('启动WebSocket原生心跳机制', {
    interval: `${HEARTBEAT_INTERVAL / 1000}s`,
    timeout: `${HEARTBEAT_TIMEOUT / 1000}s`
  });

  const interval = setInterval(() => {
    const now = Date.now();
    let activeConnections = 0;
    let terminatedConnections = 0;

    wss.clients.forEach((ws) => {
      // 检查连接是否超时
      const connectionAge = now - ws.connectionTime;
      const timeSinceLastPong = now - (ws.lastPing || ws.connectionTime);

      if (ws.isAlive === false || timeSinceLastPong > HEARTBEAT_TIMEOUT) {
        logger.info('WebSocket连接超时，终止连接', {
          connectionAge: `${Math.round(connectionAge / 1000)}s`,
          timeSinceLastPong: `${Math.round(timeSinceLastPong / 1000)}s`,
          readyState: ws.readyState
        });

        ws.terminate();
        terminatedConnections++;
        return;
      }

      // 发送ping
      ws.isAlive = false;
      ws.lastPing = now;

      try {
        ws.ping();
        activeConnections++;
      } catch (error) {
        logger.warn('发送WebSocket ping失败', { error: error.message });
        ws.terminate();
        terminatedConnections++;
      }
    });

    // 只在有异常连接时记录心跳统计
    if (terminatedConnections > 0) {
      logger.debug('WebSocket心跳统计 - 发现异常连接', {
        activeConnections,
        terminatedConnections,
        totalClients: wss.clients.size
      });
    }
  }, HEARTBEAT_INTERVAL);

  // 服务器关闭时清理心跳
  wss.on('close', () => {
    logger.info('WebSocket服务器关闭，停止心跳机制');
    clearInterval(interval);
  });

  return interval;
}

/**
 * 处理二进制WebSocket消息
 * 消息格式: [type:1][sessionId_len:1][sessionId][payload]
 * @param {WebSocket} ws WebSocket连接
 * @param {Buffer} buffer 二进制数据
 * @param {string} sessionId 当前会话ID
 */
function handleBinaryMessage(ws, buffer, sessionId) {
  try {
    if (buffer.length < 2) {
      logger.warn('二进制消息长度不足', { length: buffer.length });
      return;
    }

    // 移除冗余的原始数据日志，只在出错时记录详细信息

    // 确保正确处理Buffer对象
    let arrayBuffer;
    if (buffer instanceof ArrayBuffer) {
      arrayBuffer = buffer;
    } else if (buffer.buffer instanceof ArrayBuffer) {
      // 对于TypedArray，需要考虑byteOffset和byteLength
      arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    } else {
      // 对于Node.js Buffer，转换为ArrayBuffer
      arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }

    const view = new DataView(arrayBuffer);
    const type = view.getUint8(0);
    const sessionIdLen = view.getUint8(1);

    // 移除冗余的解析日志，只在出错时记录详细信息

    if (buffer.length < 2 + sessionIdLen) {
      logger.warn('二进制消息格式错误', {
        length: buffer.length,
        expectedMinLength: 2 + sessionIdLen,
        type,
        sessionIdLen,
        first8Bytes: Array.from(buffer.slice(0, Math.min(8, buffer.length)))
      });
      return;
    }

    // 提取sessionId和payload
    const sessionIdBytes = new Uint8Array(arrayBuffer, 2, sessionIdLen);
    const extractedSessionId = new TextDecoder().decode(sessionIdBytes);
    const payloadBytes = new Uint8Array(arrayBuffer, 2 + sessionIdLen);
    const payload = new TextDecoder().decode(payloadBytes);

    // 移除冗余的接收日志，正常情况下不记录二进制消息处理

    switch (type) {
      case 0x01: // DATA类型 - 终端输入数据
        ssh.handleDataBinary(ws, {
          sessionId: extractedSessionId,
          payload
        });
        break;

      case 0x03: // RESIZE类型 - 终端大小调整
        if (payload.length >= 8) {
          const resizeView = new DataView(payload.buffer || payload);
          const cols = resizeView.getUint32(0, true); // 小端序
          const rows = resizeView.getUint32(4, true);

          ssh.handleResize(ws, {
            sessionId: extractedSessionId,
            cols,
            rows
          });
        }
        break;

      default:
        logger.warn('未知的二进制消息类型', { type, sessionId: extractedSessionId });
    }
  } catch (error) {
    logger.error('处理二进制消息失败', {
      error: error.message,
      sessionId,
      bufferLength: buffer.length,
      first8Bytes: Array.from(buffer.slice(0, Math.min(8, buffer.length))),
      stack: error.stack
    });
  }
}

module.exports = {
  initWebSocketServer
};
