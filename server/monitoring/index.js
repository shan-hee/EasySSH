/**
 * EasySSH监控WebSocket服务 - 重构版
 * 专门处理监控客户端主动连接的WebSocket服务
 * 移除了主动连接模式，简化为纯被动接收架构
 */

const WebSocket = require('ws');

// 存储监控客户端会话（远程服务器连接）
const monitoringClientSessions = new Map();
// 存储前端会话（浏览器连接）
const frontendSessions = new Map();
// 存储主机信息到监控客户端会话ID的映射，用于前端查询
const hostToSessionMap = new Map();
// 存储服务器订阅关系：serverId -> Set<frontendSessionId>
const serverSubscriptions = new Map();

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
    const url = new URL(request.url, `http://${request.headers.host}`);
    const pathname = url.pathname;

    // 只处理监控路径的WebSocket请求
    if (pathname === '/monitor') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  // 监听连接事件
  wss.on('connection', (ws, req) => {
    console.log(`收到WebSocket连接请求，URL: ${req.url}`);

    const url = new URL(req.url, `http://${req.headers.host}`);
    const connectionType = url.searchParams.get('type') || 'monitoring_client';
    const subscribeServer = url.searchParams.get('subscribe');

    console.log(`连接类型: ${connectionType}, 订阅服务器: ${subscribeServer}`);
    console.log(`新的${connectionType === 'frontend' ? '前端' : '监控客户端'}连接已建立`);

    // 生成唯一的会话ID
    const sessionId = generateSessionId();
    const clientIp = getClientIP(req);

    if (connectionType === 'frontend') {
      // 前端连接处理
      handleFrontendConnection(ws, sessionId, clientIp, subscribeServer);
    } else {
      // 监控客户端连接处理
      handleMonitoringClientConnection(ws, sessionId, clientIp);
    }
  });

  // 定期清理长时间不活跃的连接（每5分钟）
  setInterval(() => {
    const now = Date.now();

    // 清理不活跃的监控客户端会话
    monitoringClientSessions.forEach((session, id) => {
      // 超过10分钟不活跃则清理
      if (now - session.lastActivity > 10 * 60 * 1000) {
        console.log(`清理不活跃的监控客户端会话: ${id}`);
        if (session.ws && session.ws.readyState === WebSocket.OPEN) {
          session.ws.close();
        }
        cleanupMonitoringClientSession(id);
      }
    });

    // 清理不活跃的前端会话
    frontendSessions.forEach((session, id) => {
      // 超过30分钟不活跃则清理
      if (now - session.lastActivity > 30 * 60 * 1000) {
        console.log(`清理不活跃的前端会话: ${id}`);
        if (session.ws && session.ws.readyState === WebSocket.OPEN) {
          session.ws.close();
        }
        cleanupFrontendSession(id);
      }
    });
  }, 5 * 60 * 1000);

  return wss;
}

/**
 * 处理前端连接
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {string} clientIp 客户端IP
 * @param {string} subscribeServer 要订阅的服务器
 */
function handleFrontendConnection(ws, sessionId, clientIp, subscribeServer) {
  // 存储前端会话信息
  frontendSessions.set(sessionId, {
    id: sessionId,
    ws,
    connectedAt: new Date(),
    clientIp,
    lastActivity: Date.now(),
    stats: {
      messagesReceived: 0,
      messagesSent: 0
    },
    subscribedServers: new Set() // 订阅的服务器列表
  });

  console.log(`前端会话已创建: ${sessionId}, 客户端IP: ${clientIp}`);

  // 发送会话确认
  sendMessage(ws, {
    type: 'session_created',
    data: {
      sessionId,
      timestamp: Date.now(),
      connectionType: 'frontend'
    }
  });

  // 如果指定了要订阅的服务器，立即订阅
  if (subscribeServer) {
    subscribeToServer(sessionId, subscribeServer);
  }

  // 处理接收到的消息
  ws.on('message', (message) => {
    try {
      const session = frontendSessions.get(sessionId);
      if (session) {
        session.lastActivity = Date.now();
        session.stats.messagesReceived++;
      }

      const data = JSON.parse(message);
      handleFrontendMessage(ws, sessionId, data);
    } catch (err) {
      console.error('处理前端消息出错:', err.message);
      sendError(ws, '消息处理错误', sessionId);
    }
  });

  // 处理连接关闭
  ws.on('close', () => {
    console.log(`前端连接已关闭: ${sessionId}`);
    cleanupFrontendSession(sessionId);
  });

  // 处理错误
  ws.on('error', (err) => {
    console.error(`前端WebSocket错误: ${err.message}`);
    cleanupFrontendSession(sessionId);
  });
}

/**
 * 处理监控客户端连接
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {string} clientIp 客户端IP
 */
function handleMonitoringClientConnection(ws, sessionId, clientIp) {
  // 存储监控客户端会话信息
  monitoringClientSessions.set(sessionId, {
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

  console.log(`监控客户端会话已创建: ${sessionId}, 客户端IP: ${clientIp}`);

  // 发送会话确认
  sendMessage(ws, {
    type: 'session_created',
    data: {
      sessionId,
      timestamp: Date.now(),
      connectionType: 'monitoring_client'
    }
  });

  // 处理接收到的消息
  ws.on('message', (message) => {
    try {
      const session = monitoringClientSessions.get(sessionId);
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
    cleanupMonitoringClientSession(sessionId);
  });

  // 处理错误
  ws.on('error', (err) => {
    console.error(`监控客户端WebSocket错误: ${err.message}`);
    cleanupMonitoringClientSession(sessionId);
  });
}

/**
 * 处理前端消息
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {Object} data 消息数据
 */
function handleFrontendMessage(ws, sessionId, data) {
  const { type } = data;

  switch (type) {
    case 'subscribe_server':
      // 处理订阅服务器消息
      handleSubscribeServer(ws, sessionId, data.payload);
      break;

    case 'unsubscribe_server':
      // 处理取消订阅服务器消息
      handleUnsubscribeServer(ws, sessionId, data.payload);
      break;

    case 'request_system_stats':
      // 处理系统状态请求（前端请求特定服务器的数据）
      handleSystemStatsRequest(ws, sessionId, data);
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
      console.log(`收到前端心跳响应: ${sessionId}`);
      break;

    default:
      console.warn(`收到未知类型的前端消息: ${type}`);
      sendError(ws, '未知的消息类型', sessionId);
  }
}

/**
 * 订阅服务器数据
 * @param {string} frontendSessionId 前端会话ID
 * @param {string} serverId 服务器ID
 */
function subscribeToServer(frontendSessionId, serverId) {
  if (!serverId) {
    console.warn(`前端会话 ${frontendSessionId} 尝试订阅空的服务器ID`);
    return;
  }

  // 获取前端会话
  const frontendSession = frontendSessions.get(frontendSessionId);
  if (!frontendSession) {
    console.warn(`前端会话不存在: ${frontendSessionId}`);
    return;
  }

  // 添加到前端会话的订阅列表
  frontendSession.subscribedServers.add(serverId);

  // 添加到全局订阅映射
  if (!serverSubscriptions.has(serverId)) {
    serverSubscriptions.set(serverId, new Set());
  }
  serverSubscriptions.get(serverId).add(frontendSessionId);

  console.log(`前端会话 ${frontendSessionId} 已订阅服务器 ${serverId}`);

  // 发送订阅确认
  sendMessage(frontendSession.ws, {
    type: 'subscribe_ack',
    data: {
      serverId,
      sessionId: frontendSessionId,
      timestamp: Date.now()
    }
  });
}

/**
 * 取消订阅服务器数据
 * @param {string} frontendSessionId 前端会话ID
 * @param {string} serverId 服务器ID
 */
function unsubscribeFromServer(frontendSessionId, serverId) {
  // 获取前端会话
  const frontendSession = frontendSessions.get(frontendSessionId);
  if (frontendSession) {
    frontendSession.subscribedServers.delete(serverId);
  }

  // 从全局订阅映射中移除
  if (serverSubscriptions.has(serverId)) {
    serverSubscriptions.get(serverId).delete(frontendSessionId);

    // 如果没有订阅者了，删除服务器映射
    if (serverSubscriptions.get(serverId).size === 0) {
      serverSubscriptions.delete(serverId);
    }
  }

  console.log(`前端会话 ${frontendSessionId} 已取消订阅服务器 ${serverId}`);
}

/**
 * 处理订阅服务器消息
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {Object} payload 消息载荷
 */
function handleSubscribeServer(ws, sessionId, payload) {
  if (!payload || !payload.serverId) {
    sendError(ws, '缺少服务器ID', sessionId);
    return;
  }

  subscribeToServer(sessionId, payload.serverId);
}

/**
 * 处理取消订阅服务器消息
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {Object} payload 消息载荷
 */
function handleUnsubscribeServer(ws, sessionId, payload) {
  if (!payload || !payload.serverId) {
    sendError(ws, '缺少服务器ID', sessionId);
    return;
  }

  unsubscribeFromServer(sessionId, payload.serverId);

  // 发送取消订阅确认
  sendMessage(ws, {
    type: 'unsubscribe_ack',
    data: {
      serverId: payload.serverId,
      sessionId,
      timestamp: Date.now()
    }
  });
}

/**
 * 清理前端会话
 * @param {string} sessionId 会话ID
 */
function cleanupFrontendSession(sessionId) {
  const session = frontendSessions.get(sessionId);
  if (session) {
    console.log(`清理前端会话: ${sessionId}`);

    // 取消所有订阅
    session.subscribedServers.forEach(serverId => {
      unsubscribeFromServer(sessionId, serverId);
    });

    // 关闭WebSocket连接
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.close();
    }

    // 删除会话
    frontendSessions.delete(sessionId);
  }
}

/**
 * 清理监控客户端会话
 * @param {string} sessionId 会话ID
 */
function cleanupMonitoringClientSession(sessionId) {
  const session = monitoringClientSessions.get(sessionId);
  if (session) {
    console.log(`清理监控客户端会话: ${sessionId}`);

    // 清理主机映射
    if (session.hostInfo?.hostname) {
      hostToSessionMap.delete(session.hostInfo.hostname);
    }
    // 清理IP地址映射
    if (session.clientIp) {
      hostToSessionMap.delete(session.clientIp);
    }
    if (session.hostInfo?.ip) {
      hostToSessionMap.delete(session.hostInfo.ip);
    }

    // 关闭WebSocket连接
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.close();
    }

    // 删除会话
    monitoringClientSessions.delete(sessionId);
  }
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

    case 'identify':
      // 处理客户端标识消息
      handleIdentify(ws, sessionId, data.payload);
      break;

    case 'request_system_stats':
      // 处理系统状态请求
      handleSystemStatsRequest(ws, sessionId, data);
      break;

    case 'subscribe_server':
      // 处理订阅服务器消息（前端连接误发到监控客户端处理器）
      console.warn(`监控客户端会话 ${sessionId} 发送了前端订阅消息，可能是连接类型识别错误`);
      sendError(ws, '监控客户端不支持订阅操作', sessionId);
      break;

    case 'unsubscribe_server':
      // 处理取消订阅服务器消息（前端连接误发到监控客户端处理器）
      console.warn(`监控客户端会话 ${sessionId} 发送了前端取消订阅消息，可能是连接类型识别错误`);
      sendError(ws, '监控客户端不支持取消订阅操作', sessionId);
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
 * 处理客户端标识消息
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {Object} payload 标识数据
 */
function handleIdentify(ws, sessionId, payload) {
  if (!payload) {
    console.warn(`收到空的标识数据: ${sessionId}`);
    sendError(ws, '标识数据不能为空', sessionId);
    return;
  }

  const session = monitoringClientSessions.get(sessionId);
  if (!session) {
    console.warn(`监控客户端会话不存在: ${sessionId}`);
    sendError(ws, '会话不存在', sessionId);
    return;
  }

  // 更新会话信息
  session.clientInfo = {
    targetHost: payload.targetHost,
    clientId: payload.clientId,
    timestamp: payload.timestamp || Date.now()
  };

  console.log(`客户端标识已确认: ${sessionId}, 目标主机: ${payload.targetHost}, 客户端ID: ${payload.clientId}`);

  // 发送标识确认
  sendMessage(ws, {
    type: 'identify_ack',
    data: {
      sessionId,
      targetHost: payload.targetHost,
      clientId: payload.clientId,
      timestamp: Date.now()
    }
  });
}

/**
 * 处理系统状态请求
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {Object} data 请求数据
 */
function handleSystemStatsRequest(ws, sessionId, data) {
  // 这个函数现在主要用于前端请求特定服务器的数据
  // 检查是否是前端会话
  const frontendSession = frontendSessions.get(sessionId);
  if (!frontendSession) {
    console.warn(`前端会话不存在: ${sessionId}`);
    sendError(ws, '会话不存在', sessionId);
    return;
  }

  console.log(`收到系统状态请求: ${sessionId}, 主机ID: ${data.hostId}, 终端ID: ${data.terminalId}`);

  // 查找目标主机的监控客户端会话
  let targetSession = null;

  // 首先尝试通过主机信息匹配
  for (const [otherId, otherSession] of monitoringClientSessions) {
    if (otherId !== sessionId &&
        otherSession.hostInfo &&
        (otherSession.hostInfo.hostname || otherSession.clientIp)) {

      // 如果有主机信息，尝试匹配
      if (data.hostId) {
        const targetHost = data.hostId;

        // 直接匹配：hostname, clientIp, 内网IP
        if (otherSession.hostInfo.hostname === targetHost ||
            otherSession.clientIp === targetHost ||
            (otherSession.hostInfo.ip && otherSession.hostInfo.ip === targetHost)) {
          targetSession = otherSession;
          console.log(`找到直接匹配的会话: ${otherId}, 匹配字段: ${targetHost}`);
          break;
        }

        // 如果是哈希ID，尝试通过订阅关系查找
        if (targetHost.startsWith('h_')) {
          // 检查当前前端会话订阅的服务器
          const frontendSession = frontendSessions.get(sessionId);
          if (frontendSession && frontendSession.subscribedServers) {
            for (const subscribedServerId of frontendSession.subscribedServers) {
              // 检查订阅的服务器ID是否与监控客户端匹配
              if (otherSession.hostInfo.hostname === subscribedServerId ||
                  otherSession.clientIp === subscribedServerId ||
                  (otherSession.hostInfo.ip && otherSession.hostInfo.ip === subscribedServerId)) {
                targetSession = otherSession;
                console.log(`通过订阅关系找到匹配的会话: ${otherId}, 订阅服务器: ${subscribedServerId}`);
                break;
              }
            }
          }
        }
      }
    }

    if (targetSession) break;
  }

  if (targetSession) {
    // 请求目标会话发送最新的系统状态
    sendMessage(targetSession.ws, {
      type: 'get_system_stats',
      data: {
        requesterId: sessionId,
        timestamp: Date.now()
      }
    });

    console.log(`已向目标会话请求系统状态更新: ${targetSession.id}`);
  } else {
    // 如果找不到目标会话，发送错误响应
    console.log(`未找到目标主机的监控会话: ${data.hostId || '未知'}`);

    // 添加调试信息
    console.log(`当前活跃的监控客户端会话数量: ${monitoringClientSessions.size}`);
    monitoringClientSessions.forEach((session, id) => {
      console.log(`会话 ${id}: hostname=${session.hostInfo?.hostname}, clientIp=${session.clientIp}, ip=${session.hostInfo?.ip}`);
    });

    // 检查前端会话的订阅信息
    const frontendSession = frontendSessions.get(sessionId);
    if (frontendSession) {
      console.log(`前端会话 ${sessionId} 订阅的服务器:`, Array.from(frontendSession.subscribedServers));
    }

    sendError(ws, '目标主机监控服务未连接', sessionId);
  }
}

/**
 * 处理系统统计信息 - 重构版
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {Object} stats 系统统计信息
 */
function handleSystemStats(ws, sessionId, stats) {
  const session = monitoringClientSessions.get(sessionId);
  if (!session) {
    console.warn(`收到系统统计信息但监控客户端会话不存在: ${sessionId}`);
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

    // 建立主机映射，同时使用hostname和IP作为标识
    const hostKey = stats.os.hostname;
    hostToSessionMap.set(hostKey, sessionId);

    // 同时建立IP地址映射，方便前端通过IP查找
    if (session.clientIp) {
      hostToSessionMap.set(session.clientIp, sessionId);
    }
    if (stats.ip && stats.ip !== session.clientIp) {
      hostToSessionMap.set(stats.ip, sessionId);
    }

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

  // 确定可能的服务器ID列表（用于订阅匹配）
  const possibleServerIds = [];

  // 添加主机名
  if (session.hostInfo?.hostname) {
    possibleServerIds.push(session.hostInfo.hostname);
  }

  // 添加客户端IP
  if (session.clientIp) {
    possibleServerIds.push(session.clientIp);
  }

  // 添加系统报告的IP
  if (stats.ip && stats.ip !== session.clientIp) {
    possibleServerIds.push(stats.ip);
  }

  // 精确路由：检查所有可能的服务器ID，向订阅了任一ID的前端发送数据
  const matchedSubscriptions = new Set(); // 避免重复发送
  let totalSent = 0;

  possibleServerIds.forEach(serverId => {
    if (serverSubscriptions.has(serverId)) {
      const subscribedFrontends = serverSubscriptions.get(serverId);
      subscribedFrontends.forEach(frontendSessionId => {
        // 避免向同一前端会话重复发送
        if (!matchedSubscriptions.has(frontendSessionId)) {
          const frontendSession = frontendSessions.get(frontendSessionId);
          if (frontendSession && frontendSession.ws && frontendSession.ws.readyState === WebSocket.OPEN) {
            sendMessage(frontendSession.ws, {
              type: 'system_stats',
              payload: enrichedStats
            });

            // 更新前端会话统计
            frontendSession.stats.messagesSent++;
            matchedSubscriptions.add(frontendSessionId);
            totalSent++;
          } else {
            // 清理无效的订阅
            subscribedFrontends.delete(frontendSessionId);
          }
        }
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
 * 清理会话 - 重构版（兼容旧版本调用）
 * @param {string} sessionId 会话ID
 */
function cleanupSession(sessionId) {
  // 尝试清理监控客户端会话
  cleanupMonitoringClientSession(sessionId);
  // 尝试清理前端会话
  cleanupFrontendSession(sessionId);
}

/**
 * 获取所有活跃监控客户端会话 - 重构版
 * @returns {Array} 会话列表
 */
function getAllSessions() {
  const sessions = [];
  monitoringClientSessions.forEach((session) => {
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
 * 根据主机名或IP地址查找会话
 * @param {string} hostname 主机名或IP地址
 * @returns {Object|null} 会话对象或null
 */
function getSessionByHostname(hostname) {
  // 首先尝试通过主机名查找
  let sessionId = hostToSessionMap.get(hostname);
  if (sessionId) {
    return monitoringClientSessions.get(sessionId);
  }

  // 如果通过主机名找不到，尝试通过IP地址查找
  for (const [, session] of monitoringClientSessions) {
    if (session.clientIp === hostname ||
        session.hostInfo?.ip === hostname ||
        (session.hostInfo?.ip && session.hostInfo.ip.includes && session.hostInfo.ip.includes(hostname))) {
      return session;
    }
  }

  return null;
}

/**
 * 处理新的监控WebSocket连接 - 供外部调用
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} request HTTP请求对象
 */
function handleConnection(ws, request) {
  // 这个函数保持向后兼容，默认作为监控客户端连接处理
  console.log('新的监控客户端连接已建立（兼容模式）');

  // 生成唯一的会话ID
  const sessionId = generateSessionId();
  const clientIp = getClientIP(request);

  // 直接调用监控客户端连接处理函数
  handleMonitoringClientConnection(ws, sessionId, clientIp);
}

module.exports = {
  initMonitoringWebSocketServer,
  getAllSessions,
  getSessionByHostname,
  handleConnection,
  // 新增的函数
  handleFrontendConnection,
  handleMonitoringClientConnection,
  subscribeToServer,
  unsubscribeFromServer,
  cleanupFrontendSession,
  cleanupMonitoringClientSession
};