/**
 * SSH 模块
 * 用于处理SSH连接和WebSocket通信
 */

const ssh2 = require('ssh2');
const WebSocket = require('ws');
const crypto = require('crypto');
const os = require('os');
const { exec } = require('child_process');

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
      console.log(logMessage('SSH连接', `${config.address}:${config.port}`));
      resolve(conn);
    });
    
    conn.on('error', (err) => {
      clearTimeout(timeout);
      console.error(logMessage('SSH连接', `${config.address}:${config.port}`, '错误', err.message));
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
 * 测量网络延迟
 * @param {string} host 目标主机IP
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 */
async function measureNetworkLatency(host, ws, sessionId) {
  try {
    // 根据操作系统使用不同的ping命令参数
    const isWindows = os.platform() === 'win32';
    const pingCmd = isWindows ? `ping -n 1 ${host}` : `ping -c 1 ${host}`;
    
    exec(pingCmd, (error, stdout, stderr) => {
      if (error) {
        // 发送错误消息
        sendMessage(ws, MSG_TYPE.NETWORK_LATENCY, {
          sessionId,
          error: error.message,
          latency: null
        });
        return;
      }
      
      // 解析ping输出，提取延迟值
      let latency = null;
      
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
          latency = parseFloat(match[1]);
          break;
        }
      }
      
      // 如果所有模式都没匹配到，尝试更宽松的匹配
      if (latency === null) {
        // 寻找任何看起来像延迟时间的数字
        const timeMatch = stdout.match(/(\d+\.?\d*)\s*(?:ms|毫秒)/);
        if (timeMatch && timeMatch[1]) {
          latency = parseFloat(timeMatch[1]);
        }
      }
      
      // 发送延迟信息到前端
      sendMessage(ws, MSG_TYPE.NETWORK_LATENCY, {
        sessionId,
        latency
      });
    });
  } catch (error) {
    // 处理异常，但不打印
  }
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
  
  // 设置新的定时器，每10秒执行一次
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
    const INACTIVE_THRESHOLD = 5 * 60 * 1000; // 5分钟
    
    if (inactiveTime > INACTIVE_THRESHOLD) {
      // 如果超过5分钟没有活动，不执行测量
      return;
    }
    
    // 执行网络延迟测量
    measureNetworkLatency(host, ws, sessionId);
  }, 10000); // 10秒间隔
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
  
  console.log(logMessage('清理SSH会话', sessionId));
  
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
      console.error(logMessage('关闭SSH流', sessionId, '错误', err.message));
    }
  }
  
  // 关闭SSH连接
  if (session.conn) {
    try {
      session.conn.end();
      session.conn = null;
    } catch (err) {
      console.error(logMessage('关闭SSH连接', sessionId, '错误', err.message));
    }
  }
  
  // 从会话映射中移除
  sessions.delete(sessionId);
  
  console.log(logMessage('SSH会话已清理', sessionId));
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
      
      console.log(logMessage('重新连接到会话', sessionId));
      
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
      connectionInfo // 保存连接信息
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
        console.error(logMessage('Shell', sessionId, '错误', err.message));
        sendError(ws, `Shell错误: ${err.message}`, sessionId);
      });
      
      // 处理SSH关闭
      stream.on('close', () => {
        console.log(logMessage('Shell会话已关闭', sessionId));
        
        sendMessage(ws, MSG_TYPE.CLOSED, { sessionId });
        
        cleanupSession(sessionId);
      });
      
      // 通知客户端连接成功
      sendMessage(ws, MSG_TYPE.CONNECTED, { sessionId });
      
      console.log(logMessage('新SSH会话已创建', sessionId));
      
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
  const { sessionId } = data;
  
  if (!sessionId || !sessions.has(sessionId)) {
    return;
  }
  
  // 更新最后活动时间
  const session = sessions.get(sessionId);
  recordActivity(session);
  
  // 发送pong响应
  sendMessage(ws, MSG_TYPE.PONG, { 
    sessionId,
    timestamp: new Date().toISOString()
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
        console.error(logMessage('执行命令', command, '失败', err.message));
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
        console.log(logMessage('命令执行', command, '完成', `退出码: ${code}`));
        
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
  handleSshExec
}; 