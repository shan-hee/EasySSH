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
 * 测量SSH连接延迟
 * @param {Object} session SSH会话对象
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 */
async function measureSSHLatency(session, ws, sessionId) {
  try {
    if (!session.conn || !session.connectionInfo) {
      return;
    }

    const startTime = process.hrtime.bigint();

    // 使用SSH连接发送一个轻量级命令来测量延迟
    // 使用 'echo' 命令，这是最轻量级的测试命令
    session.conn.exec('echo ping', (err, stream) => {
      if (err) {
        logger.debug('SSH延迟测量失败', { sessionId, error: err.message });
        return;
      }

      let responseReceived = false;

      // 监听命令输出
      stream.on('data', (data) => {
        if (!responseReceived && data.toString().trim() === 'ping') {
          responseReceived = true;
          const endTime = process.hrtime.bigint();
          const sshLatency = Number(endTime - startTime) / 1000000; // 转换为毫秒

          // 保存SSH延迟到会话中
          session.lastSSHLatency = sshLatency;
          session.lastSSHLatencyTime = new Date();

          logger.debug('SSH延迟测量完成', {
            sessionId,
            latency: `${Math.round(sshLatency)}ms`
          });
        }
      });

      // 设置超时，避免命令卡住
      const timeout = setTimeout(() => {
        if (!responseReceived) {
          stream.end();
          logger.debug('SSH延迟测量超时', { sessionId });
        }
      }, 5000);

      stream.on('close', () => {
        clearTimeout(timeout);
      });

      stream.on('error', (err) => {
        clearTimeout(timeout);
        logger.debug('SSH延迟测量流错误', { sessionId, error: err.message });
      });
    });
  } catch (error) {
    logger.debug('SSH延迟测量异常', { sessionId, error: error.message });
  }
}

/**
 * 测量网络延迟（保留原有函数作为备用）
 * @param {string} host 目标主机IP
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 */
async function measureNetworkLatency(host, ws, sessionId) {
  try {
    // 根据操作系统使用不同的ping命令参数
    const isWindows = os.platform() === 'win32';
    const pingCmd = isWindows ? `ping -n 1 ${host}` : `ping -c 1 ${host}`;

    // 获取用户的真实IP地址
    // 如果无法直接从WebSocket获取，尝试从会话中获取（在连接建立时保存）
    let clientIP = null;
    if (sessions.has(sessionId)) {
      const session = sessions.get(sessionId);
      clientIP = session.clientIP; // 假设在创建会话时已保存用户IP
    }

    // 如果无法获取客户端IP，使用备用方法或记录错误
    if (!clientIP) {
      logger.warn('测量延迟时无法获取客户端IP地址', { sessionId });
      // 我们不使用127.0.0.1，因为那没有意义
      // 如果无法获取真实IP，我们将只测量远程服务器延迟
    }
    
    // 先测量SSH服务器的延迟
    exec(pingCmd, (remoteError, remoteStdout, remoteStderr) => {
      // 解析远程延迟
      let remoteLatency = null;
      
      if (!remoteError) {
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
          const match = remoteStdout.match(pattern);
          if (match && match[1]) {
            remoteLatency = parseFloat(match[1]);
            break;
          }
        }
        
        // 如果所有模式都没匹配到，尝试更宽松的匹配
        if (remoteLatency === null) {
          // 寻找任何看起来像延迟时间的数字
          const timeMatch = remoteStdout.match(/(\d+\.?\d*)\s*(?:ms|毫秒)/);
          if (timeMatch && timeMatch[1]) {
            remoteLatency = parseFloat(timeMatch[1]);
          }
        }
      }
      
      // 如果有客户端IP，测量本地到客户端的延迟
      if (clientIP) {
        const localPingCmd = isWindows ? `ping -n 1 ${clientIP}` : `ping -c 1 ${clientIP}`;
        exec(localPingCmd, (localError, localStdout, localStderr) => {
          // 解析本地延迟
          let localLatency = null;
          
          if (!localError) {
            // 使用相同的模式匹配本地延迟
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
              const match = localStdout.match(pattern);
              if (match && match[1]) {
                localLatency = parseFloat(match[1]);
                break;
              }
            }
            
            // 如果所有模式都没匹配到，尝试更宽松的匹配
            if (localLatency === null) {
              // 寻找任何看起来像延迟时间的数字
              const timeMatch = localStdout.match(/(\d+\.?\d*)\s*(?:ms|毫秒)/);
              if (timeMatch && timeMatch[1]) {
                localLatency = parseFloat(timeMatch[1]);
              }
            }
          }
          
          sendNetworkLatencyResult(ws, sessionId, remoteLatency, localLatency);
        });
      } else {
        // 如果没有客户端IP，只发送远程延迟
        sendNetworkLatencyResult(ws, sessionId, remoteLatency, null);
      }
    });
  } catch (error) {
    // 处理异常，但不打印
    logger.error('测量网络延迟出错', { error: error.message });
  }
}

/**
 * 发送网络延迟结果到客户端
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {number} webSocketLatency WebSocket延迟（前端到EasySSH）
 * @param {number} sshLatency SSH延迟（EasySSH到服务器）
 */
function sendNetworkLatencyResult(ws, sessionId, webSocketLatency, sshLatency) {
  // 计算总延迟
  const totalLatency = (webSocketLatency || 0) + (sshLatency || 0);

  // 发送延迟信息到前端，使用新的分段延迟格式
  sendMessage(ws, MSG_TYPE.NETWORK_LATENCY, {
    sessionId,
    // 新的分段延迟字段
    clientLatency: webSocketLatency || 0,    // 前端到EasySSH的延迟
    serverLatency: sshLatency || 0,          // EasySSH到服务器的延迟
    totalLatency,                            // 总延迟
    // 保持向后兼容的字段
    remoteLatency: sshLatency || 0,
    localLatency: webSocketLatency || 0,
    latency: sshLatency || 0,
    timestamp: new Date().toISOString()
  });

  // 记录测量时间
  if (sessions.has(sessionId)) {
    const session = sessions.get(sessionId);
    session.lastLatencyCheck = new Date();
  }
}

/**
 * 发送基于保活机制的延迟数据
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {number} webSocketLatency WebSocket往返延迟
 */
function sendKeepAliveLatencyResult(ws, sessionId, webSocketLatency) {
  if (!sessions.has(sessionId)) {
    return;
  }

  const session = sessions.get(sessionId);

  // 获取最近的SSH延迟测量结果
  let sshLatency = 0;
  if (session.lastSSHLatency && session.lastSSHLatencyTime) {
    // 如果SSH延迟测量时间在5分钟内，则使用该值
    const timeDiff = new Date() - session.lastSSHLatencyTime;
    if (timeDiff < 5 * 60 * 1000) { // 5分钟
      sshLatency = session.lastSSHLatency;
    }
  }

  // 发送合并的延迟数据
  sendNetworkLatencyResult(ws, sessionId, webSocketLatency, sshLatency);
}

/**
 * 设置定期测量网络延迟
 * @param {string} host 目标主机IP
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 */
function setupPeriodicLatencyCheck(host, ws, sessionId) {
  if (!host || !ws || !sessionId || !sessions.has(sessionId)) {
    return;
  }
  
  const session = sessions.get(sessionId);
  
  // 清除之前可能存在的定时器
  if (session.latencyCheckInterval) {
    clearInterval(session.latencyCheckInterval);
    session.latencyCheckInterval = null;
  }
  
  // 设置新的定时器，延长到60秒执行一次，减少资源消耗
  // 因为每次保活消息都会测量延迟
  session.latencyCheckInterval = setInterval(() => {
    // 如果WebSocket已关闭，停止测量
    if (!ws || ws.readyState !== utils.WS_STATE.OPEN) {
      clearInterval(session.latencyCheckInterval);
      session.latencyCheckInterval = null;
      return;
    }
    
    // 检查会话是否还存在
    if (!sessions.has(sessionId)) {
      clearInterval(session.latencyCheckInterval);
      return;
    }
    
    // 如果会话最近没有活动，减少测量频率
    const now = new Date();
    const lastActivity = session.lastActivity || now;
    const inactiveTime = now - lastActivity;
    const INACTIVE_THRESHOLD = 10 * 60 * 1000; // 10分钟
    
    if (inactiveTime > INACTIVE_THRESHOLD) {
      // 如果超过10分钟没有活动，不执行测量
      return;
    }
    
    // 检查上次延迟测量时间，如果在30秒内已经测量过（通过保活机制），则跳过
    const lastLatencyCheck = session.lastLatencyCheck || 0;
    if (now - lastLatencyCheck < 30000) {
      return;
    }
    
    // 执行网络延迟测量
    measureNetworkLatency(host, ws, sessionId);
    
    // 记录本次测量时间
    session.lastLatencyCheck = now;
  }, 60000); // 延长到60秒间隔
}

/**
 * 清理定期延迟测量
 * @param {string} sessionId 会话ID
 */
function clearPeriodicLatencyCheck(sessionId) {
  if (!sessionId || !sessions.has(sessionId)) return;
  
  const session = sessions.get(sessionId);
  if (session.latencyCheckInterval) {
    clearInterval(session.latencyCheckInterval);
    session.latencyCheckInterval = null;
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
  
  // 清理定期延迟检查
  clearPeriodicLatencyCheck(sessionId);
  
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
      
      // 执行延迟测量
      if (session.connectionInfo && session.connectionInfo.host) {
        measureNetworkLatency(session.connectionInfo.host, ws, sessionId);
        
        // 设置定期延迟测量
        setupPeriodicLatencyCheck(session.connectionInfo.host, ws, sessionId);
      }
      
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
      
      // 执行网络延迟测量（在SSH连接成功后）
      measureNetworkLatency(connectionInfo.host, ws, sessionId);
      
      // 设置定期延迟测量
      setupPeriodicLatencyCheck(connectionInfo.host, ws, sessionId);
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
  const { sessionId, timestamp, requestId } = data;

  if (!sessionId || !sessions.has(sessionId)) {
    return;
  }

  // 更新最后活动时间
  const session = sessions.get(sessionId);
  recordActivity(session);

  // 记录服务器接收PING的高精度时间戳
  const serverReceiveTime = process.hrtime.bigint();
  const serverReceiveTimeMs = Number(serverReceiveTime) / 1000000; // 转换为毫秒

  // 发送pong响应，包含时间戳信息用于延迟计算
  sendMessage(ws, MSG_TYPE.PONG, {
    sessionId,
    timestamp: new Date().toISOString(),
    originTimestamp: timestamp, // 返回客户端发送的时间戳，用于计算往返延迟
    serverReceiveTime: serverReceiveTimeMs, // 服务器接收时间（高精度）
    serverSendTime: Number(process.hrtime.bigint()) / 1000000, // 服务器发送时间（高精度）
    requestId // 返回请求ID以便客户端匹配
  });

  // 测量SSH连接延迟（如果存在SSH连接）
  if (session.connectionInfo && session.connectionInfo.host && session.conn) {
    measureSSHLatency(session, ws, sessionId);
  }
}

/**
 * 处理延迟更新消息
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 延迟数据
 */
function handleLatencyUpdate(ws, data) {
  const { sessionId, webSocketLatency } = data;

  if (!sessionId || !sessions.has(sessionId)) {
    return;
  }

  const session = sessions.get(sessionId);

  // 获取最近的SSH延迟测量结果
  let sshLatency = 0;
  if (session.lastSSHLatency && session.lastSSHLatencyTime) {
    // 如果SSH延迟测量时间在5分钟内，则使用该值
    const timeDiff = new Date() - session.lastSSHLatencyTime;
    if (timeDiff < 5 * 60 * 1000) { // 5分钟
      sshLatency = session.lastSSHLatency;
    }
  }

  // 发送合并的延迟数据
  sendNetworkLatencyResult(ws, sessionId, webSocketLatency, sshLatency);

  logger.debug('延迟数据已更新', {
    sessionId,
    webSocketLatency: `${Math.round(webSocketLatency)}ms`,
    sshLatency: `${Math.round(sshLatency)}ms`,
    totalLatency: `${Math.round(webSocketLatency + sshLatency)}ms`
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
  measureNetworkLatency,
  setupPeriodicLatencyCheck,
  clearPeriodicLatencyCheck,
  sendError,
  cleanupSession,
  handleConnect,
  handleData,
  handleResize,
  handleDisconnect,
  handlePing,
  handleLatencyUpdate,
  handleSshExec
};