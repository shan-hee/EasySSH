/**
 * SSH 模块
 * 用于处理SSH连接和WebSocket通信
 */

const ssh2 = require('ssh2');
const WebSocket = require('ws');
const crypto = require('crypto');
const os = require('os');
const net = require('net');
const { exec } = require('child_process');
const logger = require('../utils/logger');

// 导入工具模块
const utils = require('./utils');
const { MSG_TYPE, sendMessage, sendError, validateSshSession, safeExec, recordActivity, logMessage } = utils;

// 导入统一二进制协议
const { 
  BINARY_MSG_TYPE, 
  BinaryMessageDecoder, 
  BinaryMessageSender,
  validateSession,
  safeExec: binarySafeExec
} = require('./binary-protocol');

// 导入监控桥接服务
const monitoringBridge = require('../services/monitoringBridge');

// 存储活动的SSH连接
const sessions = new Map();

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
    
    // 连接超时设置 - 与readyTimeout保持一致
    const timeout = setTimeout(() => {
      conn.end();
      reject(new Error('连接超时'));
    }, 25000); // 比readyTimeout多5秒，确保SSH2库的超时先触发
    
    conn.on('ready', () => {
      clearTimeout(timeout);
      logger.info('SSH连接成功', {
        address: config.address,
        port: config.port,
        username: config.username
      });
      resolve(conn);
    });
    
    conn.on('error', (err) => {
      clearTimeout(timeout);

      // 分类处理SSH连接错误
      let errorType = 'unknown';
      let userMessage = err.message;

      if (err.code === 'ECONNREFUSED') {
        errorType = 'connection_refused';
        userMessage = '连接被拒绝，请检查服务器地址和端口';
      } else if (err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET') {
        errorType = 'network_timeout';
        userMessage = '网络超时，请检查网络连接';
      } else if (err.message.includes('Authentication')) {
        errorType = 'auth_failed';
        userMessage = '认证失败，请检查用户名和密码';
      } else if (err.message.includes('Host key verification failed')) {
        errorType = 'host_key_failed';
        userMessage = '主机密钥验证失败';
      }

      logger.error('SSH连接错误', {
        address: config.address,
        port: config.port,
        username: config.username,
        errorType,
        error: err.message,
        code: err.code
      });

      // 创建增强的错误对象
      const enhancedError = new Error(userMessage);
      enhancedError.type = errorType;
      enhancedError.originalError = err;

      reject(enhancedError);
    });
    
    const sshConfig = {
      host: config.address,
      port: config.port || 22,
      username: config.username,
      readyTimeout: 20000,        // 增加连接超时时间，适应高延迟网络
      keepaliveInterval: 15000,   // 15秒发送一次keepalive
      keepaliveCountMax: 3,       // 最多3次keepalive失败后断开
      algorithms: {               // 优化算法选择
        kex: [
          'diffie-hellman-group14-sha256',
          'diffie-hellman-group16-sha512',
          'ecdh-sha2-nistp256',
          'ecdh-sha2-nistp384',
          'ecdh-sha2-nistp521'
        ],
        cipher: [
          'aes128-ctr',
          'aes192-ctr',
          'aes256-ctr',
          'aes128-gcm',
          'aes256-gcm'
        ],
        hmac: [
          'hmac-sha2-256',
          'hmac-sha2-512',
          'hmac-sha1'
        ]
      }
    };
    
    // 记录安全的连接日志
    logger.info('尝试SSH连接', {
      host: sshConfig.host,
      port: sshConfig.port,
      username: sshConfig.username,
      authType: config.authType || 'password'
    });
    
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
 * 智能选择延迟测量方法
 * @param {string} host 目标主机IP
 * @param {number} port 目标端口
 * @returns {Promise<{method: string, latency: number}>}
 */
async function smartLatencyMeasurement(host, port = 22) {
  // 优先级策略：
  // 1. 尝试系统ping（如果可用且有权限）
  // 2. 降级到TCP连接测试
  // 3. 记录使用的方法以便监控和优化

  try {
    // 首先检查ping命令是否可用
    const pingAvailable = await checkPingAvailability();

    if (pingAvailable) {
      //logger.debug('使用系统ping测量延迟', { host, method: 'icmp_ping' });
      return await measureWithSystemPing(host);
    } else {
      //logger.debug('ping不可用，使用TCP连接测量延迟', { host, port, method: 'tcp_connect' });
      return await measureWithTCP(host, port);
    }
  } catch (error) {
    logger.warn('延迟测量失败，使用TCP备选方案', { host, port, error: error.message });
    return await measureWithTCP(host, port);
  }
}

/**
 * 检查ping命令可用性
 * @returns {Promise<boolean>}
 */
function checkPingAvailability() {
  return new Promise((resolve) => {
    const isWindows = os.platform() === 'win32';
    const testCmd = isWindows ? 'ping -n 1 127.0.0.1' : 'ping -c 1 127.0.0.1';

    exec(testCmd, { timeout: 2000 }, (error) => {
      resolve(!error);
    });
  });
}

/**
 * 使用系统ping测量延迟
 * @param {string} host 目标主机IP
 * @returns {Promise<{method: string, latency: number}>}
 */
function measureWithSystemPing(host) {
  return new Promise((resolve) => {
    const isWindows = os.platform() === 'win32';
    const pingCmd = isWindows ? `ping -n 1 ${host}` : `ping -c 1 ${host}`;

    exec(pingCmd, { timeout: 5000 }, (error, stdout, stderr) => {
      if (error) {
        logger.debug('系统ping失败', { host, error: error.message });
        resolve({ method: 'ping_failed', latency: 0 });
        return;
      }

      // 解析ping输出
      const latency = parsePingOutput(stdout);
      resolve({ method: 'icmp_ping', latency });
    });
  });
}

/**
 * 使用TCP连接测量延迟
 * @param {string} host 目标主机IP
 * @param {number} port 目标端口
 * @returns {Promise<{method: string, latency: number}>}
 */
function measureWithTCP(host, port = 22) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const socket = new net.Socket();

    socket.setTimeout(3000);

    socket.on('connect', () => {
      const latency = Date.now() - startTime;
      socket.destroy();
      resolve({ method: 'tcp_connect', latency });
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({ method: 'tcp_timeout', latency: 0 });
    });

    socket.on('error', () => {
      socket.destroy();
      resolve({ method: 'tcp_error', latency: 0 });
    });

    try {
      socket.connect(port, host);
    } catch (error) {
      resolve({ method: 'tcp_connect_error', latency: 0 });
    }
  });
}

/**
 * 解析ping命令输出
 * @param {string} stdout ping命令输出
 * @returns {number} 延迟时间（毫秒）
 */
function parsePingOutput(stdout) {
  const patterns = [
    // Windows中文格式: 平均 = 159ms
    /平均\s*=\s*(\d+)ms/,
    // Windows英文格式: Average = 159ms
    /Average\s*=\s*(\d+)ms/,
    // Linux/macOS格式: min/avg/max/mdev = 20.455/20.455/20.455/0.000 ms
    /min\/avg\/max\/mdev\s*=\s*[\d.]+\/([\d.]+)\/[\d.]+\/[\d.]+\s+ms/,
    // Linux/macOS另一种格式: time=20.455 ms
    /time=([\d.]+)\s+ms/,
    // 通用格式
    /([\d.]+)\s*(?:ms|毫秒)/i
  ];

  for (const pattern of patterns) {
    const match = stdout.match(pattern);
    if (match && match[1]) {
      return Math.round(parseFloat(match[1]));
    }
  }

  return 0;
}

/**
 * 在保活机制中内联测量服务器延迟
 * @param {string} host 目标主机IP
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {number} webSocketLatency WebSocket延迟（前端到EasySSH）
 */
async function measureServerLatencyInline(host, ws, sessionId, webSocketLatency) {
  try {
    //logger.debug('开始智能延迟测量', { host, sessionId });

    // 使用智能延迟测量
    const result = await smartLatencyMeasurement(host, 22);
    const serverLatency = result.latency;
    const method = result.method;

    // logger.debug('延迟测量完成', {
    //   host,
    //   sessionId,
    //   serverLatency,
    //   method,
    //   webSocketLatency,
    //   totalLatency: (webSocketLatency || 0) + serverLatency
    // });

    // 保存延迟数据到会话中
    if (sessions.has(sessionId)) {
      const session = sessions.get(sessionId);
      session.lastPingLatency = serverLatency;
      session.lastPingLatencyTime = new Date();
      session.lastPingMethod = method;
      session.lastPingError = serverLatency === 0 ? `测量失败: ${method}` : null;
    }

    // 发送合并的延迟数据
    sendCombinedLatencyResult(ws, sessionId, webSocketLatency, serverLatency);
  } catch (error) {
    logger.error('智能延迟测量出错', {
      error: error.message,
      stack: error.stack,
      host,
      sessionId
    });
    // 如果测量失败，仍然发送WebSocket延迟数据
    sendCombinedLatencyResult(ws, sessionId, webSocketLatency, 0);
  }
}

/**
 * 发送合并延迟结果到客户端
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {number} webSocketLatency WebSocket延迟（前端到EasySSH）
 * @param {number} serverLatency 服务器延迟（EasySSH到服务器）
 */
function sendCombinedLatencyResult(ws, sessionId, webSocketLatency, serverLatency) {
  // 计算总延迟
  const totalLatency = Math.round((webSocketLatency || 0) + (serverLatency || 0));

  // 发送延迟信息到前端
  sendMessage(ws, MSG_TYPE.NETWORK_LATENCY, {
    sessionId,
    clientLatency: Math.round(webSocketLatency || 0),    // 前端到EasySSH的延迟（整数毫秒）
    serverLatency: Math.round(serverLatency || 0),       // EasySSH到服务器的延迟（整数毫秒）
    totalLatency,                                        // 总延迟（整数毫秒）
    timestamp: new Date().toISOString()
  });

  // 记录测量时间
  if (sessions.has(sessionId)) {
    const session = sessions.get(sessionId);
    session.lastLatencyCheck = new Date();
  }
}





/**
 * 清理SSH会话
 * @param {string} sessionId 会话ID
 */
function cleanupSession(sessionId) {
  if (!sessions.has(sessionId)) {
    return;
  }
  
  logger.info('清理SSH会话', { sessionId });
  
  const session = sessions.get(sessionId);
  
  // 定期延迟检查已移除，现在使用保活机制
  
  // 清理清理超时
  if (session.cleanupTimeout) {
    clearTimeout(session.cleanupTimeout);
    session.cleanupTimeout = null;
  }
  
  // 关闭SSH流
  if (session.stream) {
    try {
      session.stream.end();
      session.stream = null;
    } catch (err) {
      logger.error('关闭SSH流错误', { sessionId, error: err.message });
    }
  }
  
  // 关闭SSH连接
  if (session.conn) {
    try {
      session.conn.end();
      session.conn = null;
    } catch (err) {
      logger.error('关闭SSH连接错误', { sessionId, error: err.message });
    }
  }
  
  // 确保监控数据收集已停止（防止重复调用）
  try {
    const stopped = monitoringBridge.stopMonitoring(sessionId, 'session_cleanup');
    // 只在实际停止时记录日志，避免重复日志
    if (stopped) {
      logger.debug('SSH会话清理，监控数据收集已停止', { sessionId });
    }
  } catch (error) {
    logger.error('SSH会话清理时停止监控数据收集失败', {
      sessionId,
      error: error.message,
      stack: error.stack
    });
  }

  // 从会话映射中移除
  sessions.delete(sessionId);

  logger.info('SSH会话已清理', { sessionId });
}

/**
 * 处理SSH连接请求
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 连接数据
 */
async function handleConnect(ws, data) {
  return await safeExec(async () => {
    const sessionId = data.sessionId || generateSessionId();
    
    // 检查是否是重新连接到现有会话
    if (sessions.has(sessionId)) {
      const session = sessions.get(sessionId);

      // 更新WebSocket连接
      session.ws = ws;
      clearTimeout(session.cleanupTimeout);

      // 通知客户端连接成功
      sendMessage(ws, MSG_TYPE.CONNECTED, { sessionId });

      // SSH重连成功后重新启动监控数据收集
      try {
        const hostInfo = {
          address: session.connectionInfo.host,  // 这里已经是正确的
          port: session.connectionInfo.port,
          username: session.connectionInfo.username
        };

        monitoringBridge.startMonitoring(sessionId, session.conn, hostInfo);
        logger.info('SSH重连成功，监控数据收集已重新启动', {
          sessionId,
          host: `${hostInfo.username || 'unknown'}@${hostInfo.address || 'unknown'}:${hostInfo.port || 22}`
        });
      } catch (error) {
        logger.error('SSH重连成功但重新启动监控数据收集失败', {
          sessionId,
          error: error.message
        });
      }

      logger.info('重新连接到SSH会话', { sessionId });

      // 延迟测量现在通过保活机制触发，无需在此处执行

      return sessionId;
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
    const session = {
      id: sessionId,
      conn,
      ws,
      stream: null,
      createdAt: new Date(),
      lastActivity: new Date(),
      cleanupTimeout: null,
      connectionInfo, // 保存连接信息
      clientIP: data.clientIP, // 保存客户端IP地址
      supportsBinary: data.supportsBinary || false, // 客户端是否支持二进制传输
      protocolVersion: data.protocolVersion || '1.0' // 协议版本
    };
    
    sessions.set(sessionId, session);

    // 处理SSH连接断开
    conn.on('close', () => {
      logger.info('SSH连接已断开', { sessionId });

      // SSH连接断开时立即停止监控数据收集
      try {
        const stopped = monitoringBridge.stopMonitoring(sessionId, 'connection_close');
        if (stopped) {
          logger.info('SSH连接断开，监控数据收集已停止', { sessionId });
        }
      } catch (error) {
        logger.warn('停止监控数据收集失败', {
          sessionId,
          error: error.message
        });
      }

      // 通知客户端连接断开
      if (ws && ws.readyState === WebSocket.OPEN) {
        sendMessage(ws, MSG_TYPE.DISCONNECTED, { sessionId });
      }

      // 清理会话
      cleanupSession(sessionId);
    });

    // 处理SSH连接错误
    conn.on('error', (err) => {
      logger.error('SSH连接错误', { sessionId, error: err.message });

      // SSH连接错误时立即停止监控数据收集
      try {
        const stopped = monitoringBridge.stopMonitoring(sessionId, 'connection_error');
        if (stopped) {
          logger.info('SSH连接错误，监控数据收集已停止', { sessionId });
        }
      } catch (error) {
        logger.warn('停止监控数据收集失败', {
          sessionId,
          error: error.message
        });
      }

      // 通知客户端连接错误
      if (ws && ws.readyState === WebSocket.OPEN) {
        sendError(ws, `SSH连接错误: ${err.message}`, sessionId);
      }

      // 清理会话
      cleanupSession(sessionId);
    });

    // 创建SSH Shell
    conn.shell({ term: 'xterm-color' }, (err, stream) => {
      if (err) {
        cleanupSession(sessionId);
        sendError(ws, `创建Shell失败: ${err.message}`, sessionId);
        return;
      }
      
      // 设置会话流
      session.stream = stream;
      
      // 转发SSH数据到WebSocket - 支持二进制传输和背压控制
      setupStreamWithBackpressure(session, stream, ws, sessionId);
      
      // 处理SSH错误
      stream.on('error', (err) => {
        logger.error('SSH Shell错误', { sessionId, error: err.message });

        // SSH Shell错误时立即停止监控数据收集
        try {
          const stopped = monitoringBridge.stopMonitoring(sessionId, 'shell_error');
          if (stopped) {
            logger.info('SSH Shell错误，监控数据收集已停止', { sessionId });
          }
        } catch (error) {
          logger.warn('停止监控数据收集失败', {
            sessionId,
            error: error.message
          });
        }

        sendError(ws, `Shell错误: ${err.message}`, sessionId);
      });
      
      // 处理SSH关闭
      stream.on('close', () => {
        logger.info('SSH Shell会话已关闭', { sessionId });

        // SSH Shell关闭时立即停止监控数据收集
        try {
          const stopped = monitoringBridge.stopMonitoring(sessionId, 'shell_close');
          // 只在实际停止时记录日志，避免重复日志
          if (stopped) {
            logger.debug('SSH Shell关闭，监控数据收集已停止', { sessionId });
          }
        } catch (error) {
          logger.warn('停止监控数据收集失败', {
            sessionId,
            error: error.message
          });
        }

        sendMessage(ws, MSG_TYPE.CLOSED, { sessionId });

        cleanupSession(sessionId);
      });
      
      // 通知客户端连接成功
      sendMessage(ws, MSG_TYPE.CONNECTED, { sessionId });

      // SSH连接成功后立即启动监控数据收集
      try {
        const hostInfo = {
          address: connectionInfo.host,  // 修复：使用 host 而不是 address
          port: connectionInfo.port,
          username: connectionInfo.username
        };

        monitoringBridge.startMonitoring(sessionId, conn, hostInfo);
        logger.info('SSH连接成功，监控数据收集已启动', {
          sessionId,
          host: `${hostInfo.username || 'unknown'}@${hostInfo.address || 'unknown'}:${hostInfo.port || 22}`
        });
      } catch (error) {
        logger.error('SSH连接成功但启动监控数据收集失败', {
          sessionId,
          host: `${connectionInfo.username}@${connectionInfo.address}:${connectionInfo.port}`,
          error: error.message
        });
      }

      logger.info('新SSH会话已创建', { sessionId });

      // 延迟测量现在通过保活机制触发，无需在此处执行
    });
    
    return sessionId;
  }, ws, 'SSH连接失败', data.sessionId, null, false);
}

/**
 * 处理数据传输
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 数据
 */
function handleData(ws, data) {
  const { sessionId, data: sshData } = data;
  
  if (!validateSshSession(ws, sessionId, sessions)) {
    return;
  }
  
  const session = sessions.get(sessionId);
  
  if (!session.stream) {
    sendError(ws, 'SSH流未创建', sessionId);
    return;
  }
  
  // 将数据发送到SSH流
  const buffer = Buffer.from(sshData, 'utf8');
  session.stream.write(buffer);
  recordActivity(session);
}

/**
 * 处理终端调整大小
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 数据
 */
function handleResize(ws, data) {
  const { sessionId, cols, rows } = data;
  
  if (!validateSshSession(ws, sessionId, sessions)) {
    return;
  }
  
  const session = sessions.get(sessionId);
  
  if (!session.stream) {
    sendError(ws, 'SSH流未创建', sessionId);
    return;
  }
  
  // 调整终端大小
  session.stream.setWindow(rows, cols);
  recordActivity(session);
}

/**
 * 处理断开连接
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 数据
 */
function handleDisconnect(ws, data) {
  const { sessionId } = data;
  
  if (!sessionId) {
    return;
  }
  
  cleanupSession(sessionId);
  
  sendMessage(ws, MSG_TYPE.DISCONNECTED, { sessionId });
}

/**
 * 处理保活消息
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 数据
 */
function handlePing(ws, data) {
  const { sessionId, timestamp, requestId, webSocketLatency } = data;

  if (!sessionId || !sessions.has(sessionId)) {
    return;
  }

  // 更新最后活动时间
  const session = sessions.get(sessionId);
  recordActivity(session);

  // 记录服务器接收PING的高精度时间戳
  const serverReceiveTime = process.hrtime.bigint();
  const serverReceiveTimeMs = Number(serverReceiveTime) / 1000000; // 转换为毫秒

  // 如果ping消息包含WebSocket延迟信息，直接执行延迟测量
  if (webSocketLatency !== undefined && session.connectionInfo && session.connectionInfo.host) {
    measureServerLatencyInline(session.connectionInfo.host, ws, sessionId, webSocketLatency);
  }

  // 发送pong响应，包含时间戳信息用于延迟计算
  sendMessage(ws, MSG_TYPE.PONG, {
    sessionId,
    timestamp: new Date().toISOString(),
    originTimestamp: timestamp, // 返回客户端发送的时间戳，用于计算往返延迟
    serverReceiveTime: serverReceiveTimeMs, // 服务器接收时间（高精度）
    serverSendTime: Number(process.hrtime.bigint()) / 1000000, // 服务器发送时间（高精度）
    requestId // 返回请求ID以便客户端匹配
  });
}



/**
 * 处理SSH命令执行请求
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 请求数据
 */
async function handleSshExec(ws, data) {
  const { sessionId, command, operationId } = data;

  if (!validateSshSession(ws, sessionId, sessions)) {
    return;
  }

  await safeExec(async () => {
    const session = sessions.get(sessionId);

    if (!session.conn) {
      throw new Error('SSH连接不可用');
    }

    // 执行命令
    session.conn.exec(command, (err, stream) => {
      if (err) {
        logger.error('SSH执行命令失败', { command, error: err.message });
        utils.sendSftpError(ws, sessionId, operationId, `执行命令失败: ${err.message}`);
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
        logger.info('SSH命令执行完成', { command, exitCode: code });

        // 发送执行结果
        utils.sendSftpSuccess(ws, sessionId, operationId, {
          stdout,
          stderr,
          exitCode: code
        });
      });
    });
  }, ws, 'SSH命令执行错误', sessionId, operationId);
}

/**
 * 设置SSH流的背压控制
 * @param {Object} session 会话对象
 * @param {Stream} stream SSH流
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 */
function setupStreamWithBackpressure(session, stream, ws, sessionId) {
  const BACKPRESSURE_THRESHOLD = 4 * 1024 * 1024; // 4MB
  const BACKPRESSURE_RESUME_THRESHOLD = 2 * 1024 * 1024; // 2MB
  let paused = false;
  let totalBytesSent = 0;
  let lastStatsTime = Date.now();

  // 初始化背压控制状态
  session.backpressure = {
    paused: false,
    totalBytes: 0,
    pauseCount: 0,
    resumeCount: 0
  };

  stream.on('data', (data) => {
    if (ws.readyState !== utils.WS_STATE.OPEN) {
      return;
    }

    totalBytesSent += data.length;
    session.backpressure.totalBytes += data.length;

    // 检查WebSocket缓冲区状态
    const bufferedAmount = ws.bufferedAmount || 0;
    const shouldPause = bufferedAmount > BACKPRESSURE_THRESHOLD;

    if (shouldPause && !paused) {
      // 暂停SSH流
      stream.pause();
      paused = true;
      session.backpressure.paused = true;
      session.backpressure.pauseCount++;

      logger.debug('SSH流已暂停 - WebSocket背压', {
        sessionId,
        bufferedAmount,
        threshold: BACKPRESSURE_THRESHOLD,
        dataSize: data.length
      });

      // 设置恢复检查
      const checkResume = () => {
        const currentBuffered = ws.bufferedAmount || 0;

        if (currentBuffered < BACKPRESSURE_RESUME_THRESHOLD && paused) {
          // 恢复SSH流
          stream.resume();
          paused = false;
          session.backpressure.paused = false;
          session.backpressure.resumeCount++;

          logger.debug('SSH流已恢复', {
            sessionId,
            bufferedAmount: currentBuffered,
            resumeThreshold: BACKPRESSURE_RESUME_THRESHOLD
          });
        } else if (paused) {
          // 继续检查
          setTimeout(checkResume, 100);
        }
      };

      setTimeout(checkResume, 100);
    }

    // 发送数据
    try {
      if (session.supportsBinary) {
        // 使用统一的二进制协议发送SSH终端数据
        BinaryMessageSender.sendSSHData(ws, sessionId, data);
      } else {
        // 向后兼容：使用Base64编码的JSON消息
        sendMessage(ws, MSG_TYPE.DATA, {
          sessionId,
          data: data.toString('base64')
        });
      }
    } catch (error) {
      logger.error('发送SSH数据失败', {
        sessionId,
        error: error.message,
        dataLength: data.length
      });
    }

    // 定期记录统计信息
    const now = Date.now();
    if (now - lastStatsTime > 30000) { // 每30秒记录一次
      const throughput = totalBytesSent / 30; // 字节/秒
      logger.debug('SSH数据传输统计', {
        sessionId,
        throughputBps: Math.round(throughput),
        totalBytes: totalBytesSent,
        pauseCount: session.backpressure.pauseCount,
        resumeCount: session.backpressure.resumeCount,
        currentlyPaused: paused
      });

      totalBytesSent = 0;
      lastStatsTime = now;
    }
  });

  // 处理流错误
  stream.on('error', (err) => {
    logger.error('SSH流错误', { sessionId, error: err.message });

    if (paused) {
      stream.resume();
      paused = false;
      session.backpressure.paused = false;
    }
  });
}

/**
 * 发送二进制数据到WebSocket（带统计）
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {Buffer} data 要发送的数据
 */
function sendBinaryDataWithStats(ws, sessionId, data) {
  try {
    const sessionIdBytes = Buffer.from(sessionId, 'utf8');
    const header = Buffer.from([0x02, sessionIdBytes.length]); // 0x02: 服务器到客户端数据
    const frame = Buffer.concat([header, sessionIdBytes, data]);

    ws.send(frame, { binary: true });

    // 记录传输统计
    if (global.metricsCollector) {
      global.metricsCollector.recordDataTransfer('outbound', 'binary', frame.length);
    }
  } catch (error) {
    logger.error('发送二进制数据失败', {
      sessionId,
      error: error.message,
      dataLength: data.length
    });

    // 回退到JSON发送
    sendMessage(ws, MSG_TYPE.DATA, {
      sessionId,
      data: data.toString('base64')
    });
  }
}

/**
 * 发送二进制数据到WebSocket
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {Buffer} data 要发送的数据
 */
function sendBinaryData(ws, sessionId, data) {
  return sendBinaryDataWithStats(ws, sessionId, data);
}

/**
 * 处理二进制数据输入
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 包含sessionId和payload的对象
 */
function handleDataBinary(ws, data) {
  const { sessionId, payload } = data;

  if (!validateSshSession(ws, sessionId, sessions)) {
    return;
  }

  const session = sessions.get(sessionId);

  if (!session.stream) {
    sendError(ws, 'SSH流未创建', sessionId);
    return;
  }

  try {
    // 直接写入二进制数据，无需Base64解码
    session.stream.write(payload);
    recordActivity(session);

    // 记录传输统计
    if (global.metricsCollector) {
      global.metricsCollector.recordDataTransfer('inbound', 'binary', payload.length);
    }
  } catch (error) {
    logger.error('写入SSH流失败', {
      sessionId,
      error: error.message,
      payloadLength: payload.length
    });
    sendError(ws, `数据传输失败: ${error.message}`, sessionId);
  }
}

// 导出函数和对象
module.exports = {
  sessions,
  generateSessionId,
  createSSHConnection,
  sendError,
  cleanupSession,
  handleConnect,
  handleData,
  handleDataBinary,
  handleResize,
  handleDisconnect,
  handlePing,
  handleSshExec,
  sendBinaryData,
  setupStreamWithBackpressure
};