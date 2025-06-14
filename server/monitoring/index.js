/**
 * EasySSH监控WebSocket服务 - 重构版
 * 专门处理监控客户端主动连接的WebSocket服务
 * 移除了主动连接模式，简化为纯被动接收架构
 */

const WebSocket = require('ws');

// 存储所有活跃的监控会话
const monitoringSessions = new Map();
// 存储主机信息到会话ID的映射，用于前端查询
const hostToSessionMap = new Map();

/**
 * 初始化监控WebSocket服务器 - 重构版
 * 专门处理监控客户端主动连接，不再支持主动连接模式
 * @param {Object} server HTTP服务器实例，用于集成到主服务器
 */
function initMonitoringWebSocketServer(server) {
  // 创建不绑定到特定端口的WebSocket服务器，集成到主HTTP服务器
  const wss = new WebSocket.Server({
    noServer: true
  });

  console.log('监控WebSocket服务器已初始化，等待客户端连接到 /monitor 路径');

  // 监听HTTP服务器的upgrade事件
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

    // 只处理监控路径的WebSocket请求
    if (pathname === '/monitor') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  // 监听连接事件
  wss.on('connection', (ws, req) => {
    console.log('新的监控客户端连接已建立');

    // 生成唯一的会话ID
    const sessionId = generateSessionId();
    const clientIp = getClientIP(req);

    // 存储会话信息
    monitoringSessions.set(sessionId, {
      id: sessionId,
      ws,
      connectedAt: new Date(),
      clientIp,
      lastActivity: Date.now(),
      stats: {
        messagesReceived: 0,
        messagesSent: 0
      },
      hostInfo: null // 将在客户端发送系统信息时填充
    });

    console.log(`监控会话已创建: ${sessionId}, 客户端IP: ${clientIp}`);

    // 发送会话确认
    sendMessage(ws, {
      type: 'session_created',
      data: {
        sessionId,
        timestamp: Date.now()
      }
    });
    
    // 处理接收到的消息
    ws.on('message', (message) => {
      try {
        const session = monitoringSessions.get(sessionId);
        if (session) {
          session.lastActivity = Date.now();
          session.stats.messagesReceived++;
        }

        const data = JSON.parse(message);
        handleMonitoringMessage(ws, sessionId, data);
      } catch (err) {
        console.error('处理监控消息出错:', err.message);
        sendError(ws, '消息处理错误', sessionId);
      }
    });

    // 处理连接关闭
    ws.on('close', () => {
      console.log(`监控客户端连接已关闭: ${sessionId}`);
      cleanupSession(sessionId);
    });

    // 处理错误
    ws.on('error', (err) => {
      console.error(`监控WebSocket错误: ${err.message}`);
      cleanupSession(sessionId);
    });
  });

  // 定期清理长时间不活跃的连接（每5分钟）
  setInterval(() => {
    const now = Date.now();
    monitoringSessions.forEach((session, id) => {
      // 超过10分钟不活跃则清理
      if (now - session.lastActivity > 10 * 60 * 1000) {
        console.log(`清理不活跃的监控会话: ${id}`);
        if (session.ws && session.ws.readyState === WebSocket.OPEN) {
          session.ws.close();
        }
        cleanupSession(id);
      }
    });
  }, 5 * 60 * 1000);

  return wss;
}



/**
 * 处理监控消息 - 重构版
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {Object} data 消息数据
 */
function handleMonitoringMessage(ws, sessionId, data) {
  const { type } = data;

  switch (type) {
    case 'system_stats':
      // 处理系统统计信息
      handleSystemStats(ws, sessionId, data.payload);
      break;

    case 'ping':
      // 处理心跳消息
      sendMessage(ws, {
        type: 'pong',
        data: {
          timestamp: Date.now(),
          sessionId
        }
      });
      break;

    case 'pong':
      // 处理心跳响应
      console.log(`收到客户端心跳响应: ${sessionId}`);
      break;

    default:
      console.warn(`收到未知类型的监控消息: ${type}`);
      sendError(ws, '未知的消息类型', sessionId);
  }
}

/**
 * 获取客户端IP地址
 * @param {Object} req 请求对象
 * @returns {string} 客户端IP地址
 */
function getClientIP(req) {
  return req.headers['x-forwarded-for'] ||
         req.headers['x-real-ip'] ||
         req.socket.remoteAddress ||
         req.connection.remoteAddress ||
         '未知';
}

/**
 * 生成唯一的会话ID
 * @returns {string} 会话ID
 */
function generateSessionId() {
  return 'monitor_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
}

/**
 * 处理系统统计信息 - 重构版
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {Object} stats 系统统计信息
 */
function handleSystemStats(ws, sessionId, stats) {
  const session = monitoringSessions.get(sessionId);
  if (!session) {
    console.warn(`收到系统统计信息但会话不存在: ${sessionId}`);
    return;
  }

  // 保存统计信息到会话
  session.systemStats = stats;
  session.lastActivity = Date.now();

  // 从系统信息中提取主机信息
  if (stats.os && stats.os.hostname && !session.hostInfo) {
    session.hostInfo = {
      hostname: stats.os.hostname,
      platform: stats.os.platform,
      arch: stats.os.arch,
      ip: stats.ip
    };

    // 建立主机映射，使用hostname作为标识
    const hostKey = stats.os.hostname;
    hostToSessionMap.set(hostKey, sessionId);

    console.log(`监控客户端已识别: ${hostKey} (${session.clientIp})`);
  }

  // 添加会话信息到统计数据
  const enrichedStats = {
    ...stats,
    sessionId,
    clientIp: session.clientIp,
    connectedAt: session.connectedAt,
    hostKey: session.hostInfo?.hostname || session.clientIp
  };

  // 广播到所有其他监控会话（主要是前端连接）
  monitoringSessions.forEach((otherSession, otherId) => {
    if (otherId !== sessionId && otherSession.ws && otherSession.ws.readyState === WebSocket.OPEN) {
      sendMessage(otherSession.ws, {
        type: 'system_stats',
        payload: enrichedStats
      });
    }
  });

  // 确认接收
  sendMessage(ws, {
    type: 'stats_received',
    data: {
      timestamp: Date.now(),
      sessionId
    }
  });
}



/**
 * 发送消息
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} message 消息对象
 */
function sendMessage(ws, message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(message));
    } catch (err) {
      // 静默处理发送失败
    }
  }
}

/**
 * 发送错误消息
 * @param {WebSocket} ws WebSocket连接
 * @param {string} message 错误消息
 * @param {string} sessionId 会话ID
 */
function sendError(ws, message, sessionId) {
  sendMessage(ws, {
    type: 'error',
    data: {
      message,
      sessionId,
      timestamp: Date.now()
    }
  });
}

/**
 * 清理会话 - 重构版
 * @param {string} sessionId 会话ID
 */
function cleanupSession(sessionId) {
  const session = monitoringSessions.get(sessionId);
  if (session) {
    console.log(`清理监控会话: ${sessionId}`);

    // 清理主机映射
    if (session.hostInfo?.hostname) {
      hostToSessionMap.delete(session.hostInfo.hostname);
    }

    // 关闭WebSocket连接
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.close();
    }

    // 删除会话
    monitoringSessions.delete(sessionId);
  }
}

/**
 * 获取所有活跃监控会话 - 重构版
 * @returns {Array} 会话列表
 */
function getAllSessions() {
  const sessions = [];
  monitoringSessions.forEach((session) => {
    sessions.push({
      id: session.id,
      connectedAt: session.connectedAt,
      clientIp: session.clientIp,
      hostInfo: session.hostInfo,
      lastActivity: session.lastActivity,
      stats: session.stats,
      systemStats: session.systemStats
    });
  });
  return sessions;
}

/**
 * 根据主机名查找会话
 * @param {string} hostname 主机名
 * @returns {Object|null} 会话对象或null
 */
function getSessionByHostname(hostname) {
  const sessionId = hostToSessionMap.get(hostname);
  return sessionId ? monitoringSessions.get(sessionId) : null;
}

/**
 * 处理新的监控WebSocket连接 - 供外部调用
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} request HTTP请求对象
 */
function handleConnection(ws, request) {
  console.log('新的监控客户端连接已建立');

  // 生成唯一的会话ID
  const sessionId = generateSessionId();
  const clientIp = getClientIP(request);

  // 存储会话信息
  monitoringSessions.set(sessionId, {
    id: sessionId,
    ws,
    connectedAt: new Date(),
    clientIp,
    lastActivity: Date.now(),
    stats: {
      messagesReceived: 0,
      messagesSent: 0
    },
    hostInfo: null // 将在客户端发送系统信息时填充
  });

  console.log(`监控会话已创建: ${sessionId}, 客户端IP: ${clientIp}`);

  // 发送会话确认
  sendMessage(ws, {
    type: 'session_created',
    data: {
      sessionId,
      timestamp: Date.now()
    }
  });

  // 处理接收到的消息
  ws.on('message', (message) => {
    try {
      const session = monitoringSessions.get(sessionId);
      if (session) {
        session.lastActivity = Date.now();
        session.stats.messagesReceived++;
      }

      const data = JSON.parse(message);
      handleMonitoringMessage(ws, sessionId, data);
    } catch (err) {
      console.error('处理监控消息出错:', err.message);
      sendError(ws, '消息处理错误', sessionId);
    }
  });

  // 处理连接关闭
  ws.on('close', () => {
    console.log(`监控客户端连接已关闭: ${sessionId}`);
    cleanupSession(sessionId);
  });

  // 处理错误
  ws.on('error', (err) => {
    console.error(`监控WebSocket错误: ${err.message}`);
    cleanupSession(sessionId);
  });
}

module.exports = {
  initMonitoringWebSocketServer,
  getAllSessions,
  getSessionByHostname,
  handleConnection
};