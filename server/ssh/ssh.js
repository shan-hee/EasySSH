/**
 * SSH 模块
 * 用于处理SSH连接和WebSocket通信
 */

const ssh2 = require('ssh2');
const WebSocket = require('ws');
const crypto = require('crypto');
const os = require('os');
const { exec } = require('child_process');
const logger = require('../utils/logger');

// 导入工具模块
const utils = require('./utils');
const { MSG_TYPE, sendMessage, sendError, validateSshSession, safeExec, recordActivity, logMessage } = utils;

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
    
    // 连接超时设置
    const timeout = setTimeout(() => {
      conn.end();
      reject(new Error('连接超时'));
    }, 10000);
    
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
      logger.error('SSH连接错误', {
        address: config.address,
        port: config.port,
        username: config.username,
        error: err.message
      });
      reject(err);
    });
    
    const sshConfig = {
      host: config.address,
      port: config.port || 22,
      username: config.username,
      readyTimeout: 10000,
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
 * 在保活机制中内联测量服务器延迟
 * @param {string} host 目标主机IP
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {number} webSocketLatency WebSocket延迟（前端到EasySSH）
 */
function measureServerLatencyInline(host, ws, sessionId, webSocketLatency) {
  try {
    // 根据操作系统使用不同的ping命令参数
    const isWindows = os.platform() === 'win32';
    const pingCmd = isWindows ? `ping -n 1 ${host}` : `ping -c 1 ${host}`;

    // 测量到目标服务器的延迟
    exec(pingCmd, (error, stdout) => {
      let serverLatency = 0;

      if (!error) {
        // 尝试多种匹配模式，适应不同的操作系统和语言设置
        const patterns = [
          // Windows中文格式: 平均 = 159ms
          /平均\s*=\s*(\d+)ms/,
          // Windows英文格式: Average = 159ms
          /Average\s*=\s*(\d+)ms/,
          // Linux/macOS格式: min/avg/max/mdev = 20.455/20.455/20.455/0.000 ms
          /min\/avg\/max\/mdev\s*=\s*[\d.]+\/([\d.]+)\/[\d.]+\/[\d.]+\s+ms/,
          // Linux/macOS另一种格式: time=20.455 ms
          /time=([\d.]+)\s+ms/,
          // 时间 = XX 毫秒格式
          /时间[=＝为]\s*([\d.]+)\s*(?:毫秒|ms)/i,
          // 任何带有ms或毫秒的数字
          /([\d.]+)\s*(?:ms|毫秒)/i,
          // 仅查找任何数字+ms组合
          /([\d.]+)\s*ms/i
        ];

        for (const pattern of patterns) {
          const match = stdout.match(pattern);
          if (match && match[1]) {
            serverLatency = parseFloat(match[1]);
            break;
          }
        }

        // 如果所有模式都没匹配到，尝试更宽松的匹配
        if (serverLatency === 0) {
          // 寻找任何看起来像延迟时间的数字
          const timeMatch = stdout.match(/(\d+\.?\d*)\s*(?:ms|毫秒)/);
          if (timeMatch && timeMatch[1]) {
            serverLatency = parseFloat(timeMatch[1]);
          }
        }
      }

      // 保存ping延迟到会话中
      if (sessions.has(sessionId)) {
        const session = sessions.get(sessionId);
        session.lastPingLatency = serverLatency;
        session.lastPingLatencyTime = new Date();
      }

      // 发送合并的延迟数据
      sendCombinedLatencyResult(ws, sessionId, webSocketLatency, serverLatency);
    });
  } catch (error) {
    logger.error('内联测量网络延迟出错', { error: error.message });
    // 如果ping失败，仍然发送WebSocket延迟数据
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
      clientIP: data.clientIP // 保存客户端IP地址
    };
    
    sessions.set(sessionId, session);
    
    // 创建SSH Shell
    conn.shell({ term: 'xterm-color' }, (err, stream) => {
      if (err) {
        cleanupSession(sessionId);
        sendError(ws, `创建Shell失败: ${err.message}`, sessionId);
        return;
      }
      
      // 设置会话流
      session.stream = stream;
      
      // 转发SSH数据到WebSocket
      stream.on('data', (data) => {
        if (ws.readyState === utils.WS_STATE.OPEN) {
          sendMessage(ws, MSG_TYPE.DATA, {
            sessionId,
            data: data.toString('base64')
          });
        }
      });
      
      // 处理SSH错误
      stream.on('error', (err) => {
        logger.error('SSH Shell错误', { sessionId, error: err.message });
        sendError(ws, `Shell错误: ${err.message}`, sessionId);
      });
      
      // 处理SSH关闭
      stream.on('close', () => {
        logger.info('SSH Shell会话已关闭', { sessionId });
        
        sendMessage(ws, MSG_TYPE.CLOSED, { sessionId });
        
        cleanupSession(sessionId);
      });
      
      // 通知客户端连接成功
      sendMessage(ws, MSG_TYPE.CONNECTED, { sessionId });
      
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

// 导出函数和对象
module.exports = {
  sessions,
  generateSessionId,
  createSSHConnection,
  sendError,
  cleanupSession,
  handleConnect,
  handleData,
  handleResize,
  handleDisconnect,
  handlePing,
  handleSshExec
};