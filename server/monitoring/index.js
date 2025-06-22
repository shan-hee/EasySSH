/**
 * EasySSH监控WebSocket服务
 * 处理前端监控数据传输和监控客户端连接
 */

const WebSocket = require('ws');
const logger = require('../utils/logger');

// 存储前端监控会话（浏览器连接）
const frontendSessions = new Map();
// 存储监控客户端会话（服务器上的监控程序连接）
const monitoringClientSessions = new Map();
// 存储服务器订阅关系：serverId -> Set<frontendSessionId>
const serverSubscriptions = new Map();
// 存储监控数据缓存：serverId -> 最新监控数据
const monitoringDataCache = new Map();
// 存储IP到组合标识符的映射：ipAddress -> hostId (hostname@ip)
const ipToHostIdMap = new Map();
// 存储监控客户端到主机ID的映射：sessionId -> hostId
const clientSessionToHostIdMap = new Map();

/**
 * 初始化前端监控WebSocket服务器 - 重构版
 * 专门处理前端监控数据传输，移除监控客户端逻辑
 * @param {Object} server HTTP服务器实例，用于集成到主服务器
 */
function initMonitoringWebSocketServer(server) {
  // 创建不绑定到特定端口的WebSocket服务器，集成到主HTTP服务器
  const wss = new WebSocket.Server({
    noServer: true
  });

  logger.info('前端监控WebSocket服务器已初始化，等待前端连接到 /monitor 路径');

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

  // 监听连接事件 - 现在只处理前端连接，监控客户端连接通过专用路径处理
  wss.on('connection', (ws, req) => {
    logger.debug('收到前端监控WebSocket连接请求', { url: req.url });

    const url = new URL(req.url, `http://${req.headers.host}`);
    const subscribeServer = url.searchParams.get('subscribe');

    // 生成唯一的会话ID
    const sessionId = generateSessionId();
    const clientIp = getClientIP(req);

    logger.info('前端监控WebSocket连接已建立', { subscribeServer, clientIp });
    handleFrontendConnection(ws, sessionId, clientIp, subscribeServer);
  });

  // 定期清理长时间不活跃的连接（每5分钟）
  setInterval(() => {
    const now = Date.now();

    // 清理不活跃的前端会话
    frontendSessions.forEach((session, id) => {
      // 超过30分钟不活跃则清理
      if (now - session.lastActivity > 30 * 60 * 1000) {
        logger.info('清理不活跃的前端会话', { sessionId: id });
        if (session.ws && session.ws.readyState === WebSocket.OPEN) {
          session.ws.close();
        }
        cleanupFrontendSession(id);
      }
    });

    // 清理不活跃的监控客户端会话
    monitoringClientSessions.forEach((session, id) => {
      // 超过10分钟不活跃则清理
      if (now - session.lastActivity > 10 * 60 * 1000) {
        logger.info('清理不活跃的监控客户端会话', { sessionId: id });
        if (session.ws && session.ws.readyState === WebSocket.OPEN) {
          session.ws.close();
        }
        cleanupMonitoringClientSession(id);
      }
    });
  }, 5 * 60 * 1000);

  return wss;
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
    hostId: null, // 将在收到第一条数据时设置
    stats: {
      messagesReceived: 0,
      messagesSent: 0
    }
  });

  logger.info('监控客户端会话已创建', { sessionId, clientIp });

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
      handleMonitoringClientMessage(ws, sessionId, data);
    } catch (err) {
      logger.error('处理监控客户端消息出错', { sessionId, error: err.message });
      sendError(ws, '消息处理错误', sessionId);
    }
  });

  // 处理连接关闭
  ws.on('close', () => {
    logger.info('监控客户端连接已关闭', { sessionId });
    cleanupMonitoringClientSession(sessionId);
  });

  // 处理错误
  ws.on('error', (err) => {
    logger.error('监控客户端WebSocket错误', { sessionId, error: err.message });
    cleanupMonitoringClientSession(sessionId);
  });
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

  logger.info('前端会话已创建', { sessionId, clientIp });

  // 发送会话确认
  sendMessage(ws, {
    type: 'session_created',
    data: {
      sessionId,
      timestamp: Date.now(),
      connectionType: 'frontend'
    }
  });

  // 移除 monitoring_connected 消息发送
  // 前端连接不需要发送连接成功状态
  // 状态完全基于实际监控数据验证

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
      logger.error('处理前端消息出错', { sessionId, error: err.message });
      sendError(ws, '消息处理错误', sessionId);
    }
  });

  // 处理连接关闭
  ws.on('close', () => {
    logger.info('前端连接已关闭', { sessionId });

    // 发送监控断开状态给其他可能的连接
    const session = frontendSessions.get(sessionId);
    if (session && session.subscribedServers) {
      // 通知其他订阅了相同服务器的会话
      session.subscribedServers.forEach(serverId => {
        if (serverSubscriptions.has(serverId)) {
          const subscribedSessions = serverSubscriptions.get(serverId);
          subscribedSessions.forEach(otherSessionId => {
            if (otherSessionId !== sessionId) {
              const otherSession = frontendSessions.get(otherSessionId);
              if (otherSession && otherSession.ws && otherSession.ws.readyState === WebSocket.OPEN) {
                sendMessage(otherSession.ws, {
                  type: 'monitoring_disconnected',
                  data: {
                    serverId,
                    status: 'disconnected',
                    message: '监控WebSocket连接已断开',
                    timestamp: Date.now()
                  }
                });
              }
            }
          });
        }
      });
    }

    cleanupFrontendSession(sessionId);
  });

  // 处理错误
  ws.on('error', (err) => {
    logger.error('前端WebSocket错误', { sessionId, error: err.message });
    cleanupFrontendSession(sessionId);
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

    case 'update_monitoring_data':
      // 处理监控数据更新（从外部API或其他来源）
      handleMonitoringDataUpdate(ws, sessionId, data);
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
      logger.debug('收到前端心跳响应', { sessionId });
      break;

    case 'system_stats':
      // 处理监控数据（可能来自监控客户端或外部API）
      handleMonitoringDataFromClient(ws, sessionId, data);
      break;

    case 'update_monitoring_data':
      // 处理监控数据更新（从外部API或其他来源）
      handleMonitoringDataUpdate(ws, sessionId, data);
      break;

    default:
      logger.warn('收到未知类型的前端消息', { sessionId, messageType: type });
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
    logger.warn('前端会话尝试订阅空的服务器ID', { frontendSessionId });
    return;
  }

  // 获取前端会话
  const frontendSession = frontendSessions.get(frontendSessionId);
  if (!frontendSession) {
    logger.warn('前端会话不存在', { frontendSessionId });
    return;
  }

  // 添加到前端会话的订阅列表
  frontendSession.subscribedServers.add(serverId);

  // 添加到全局订阅映射
  if (!serverSubscriptions.has(serverId)) {
    serverSubscriptions.set(serverId, new Set());
  }
  serverSubscriptions.get(serverId).add(frontendSessionId);

  logger.info('前端会话已订阅服务器', { frontendSessionId, serverId });

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

  logger.info('前端会话已取消订阅服务器', { frontendSessionId, serverId });
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
 * 处理监控客户端消息
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {Object} data 消息数据
 */
function handleMonitoringClientMessage(ws, sessionId, data) {
  const { type } = data;

  switch (type) {
    case 'system_stats':
      // 处理监控数据（来自监控客户端）
      handleMonitoringDataFromClient(ws, sessionId, data);
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
      logger.debug('收到监控客户端心跳响应', { sessionId });
      break;

    default:
      logger.warn('收到未知类型的监控客户端消息', { sessionId, messageType: type });
      sendError(ws, '未知的消息类型', sessionId);
  }
}

/**
 * 清理监控客户端会话
 * @param {string} sessionId 会话ID
 */
function cleanupMonitoringClientSession(sessionId) {
  const session = monitoringClientSessions.get(sessionId);
  if (session) {
    logger.info('清理监控客户端会话', { sessionId });

    // 获取该客户端的主机ID
    const hostId = session.hostId;

    // 关闭WebSocket连接
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.close();
    }

    // 删除会话
    monitoringClientSessions.delete(sessionId);

    // 如果有主机ID，清理相关的监控数据
    if (hostId) {
      logger.info('监控客户端断开，清理监控数据', { sessionId, hostId });

      // 删除监控数据缓存
      monitoringDataCache.delete(hostId);

      // 清理IP映射
      if (hostId.includes('@')) {
        const [, ipAddress] = hostId.split('@');
        if (ipAddress && ipToHostIdMap.get(ipAddress) === hostId) {
          ipToHostIdMap.delete(ipAddress);
          logger.debug('清理IP映射', { ipAddress, hostId });
        }
      }

      // 清理客户端会话到主机ID的映射
      clientSessionToHostIdMap.delete(sessionId);

      // 通知所有订阅该主机的前端会话：监控服务已卸载
      notifyMonitoringStatusChange(hostId, 'not_installed', '监控客户端已断开连接');
    }
  }
}

/**
 * 清理前端会话
 * @param {string} sessionId 会话ID
 */
function cleanupFrontendSession(sessionId) {
  const session = frontendSessions.get(sessionId);
  if (session) {
    logger.info('清理前端会话', { sessionId });

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
 * 通知前端监控状态变化
 * @param {string} hostId 主机标识符
 * @param {string} status 状态（installed/not_installed）
 * @param {string} message 状态消息
 */
function notifyMonitoringStatusChange(hostId, status, message) {
  const statusMessage = {
    type: 'monitoring_status',
    data: {
      hostId: hostId,
      status: status,
      available: status === 'installed',
      message: message,
      timestamp: Date.now()
    }
  };

  let notifiedCount = 0;

  // 通知直接订阅该主机的前端会话
  if (serverSubscriptions.has(hostId)) {
    const subscribedFrontends = serverSubscriptions.get(hostId);
    subscribedFrontends.forEach(frontendSessionId => {
      const targetSession = frontendSessions.get(frontendSessionId);
      if (targetSession && targetSession.ws && targetSession.ws.readyState === WebSocket.OPEN) {
        sendMessage(targetSession.ws, statusMessage);
        notifiedCount++;
      }
    });
  }

  // 如果是组合标识符，还要通知订阅IP地址的前端会话
  if (hostId.includes('@')) {
    const [, ipAddress] = hostId.split('@');
    if (ipAddress && serverSubscriptions.has(ipAddress)) {
      const subscribedFrontends = serverSubscriptions.get(ipAddress);
      subscribedFrontends.forEach(frontendSessionId => {
        const targetSession = frontendSessions.get(frontendSessionId);
        if (targetSession && targetSession.ws && targetSession.ws.readyState === WebSocket.OPEN) {
          sendMessage(targetSession.ws, statusMessage);
          notifiedCount++;
        }
      });
    }
  }

  if (notifiedCount > 0) {
    logger.info('已通知前端监控状态变化', {
      hostId,
      status,
      notifiedCount
    });
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
 * 处理系统状态请求 - 重构版
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {Object} data 请求数据
 */
function handleSystemStatsRequest(ws, sessionId, data) {
  // 检查是否是前端会话
  const frontendSession = frontendSessions.get(sessionId);
  if (!frontendSession) {
    logger.warn('前端会话不存在', { sessionId });
    sendError(ws, '会话不存在', sessionId);
    return;
  }

  logger.debug('收到系统状态请求', {
    sessionId,
    hostId: data.hostId,
    terminalId: data.terminalId
  });

  // 优化：快速检查缓存中是否有监控数据
  const requestedHostId = data.hostId;
  let cachedData = null;
  let actualHostId = requestedHostId;

  if (requestedHostId) {
    // 直接查找
    cachedData = monitoringDataCache.get(requestedHostId);

    // 通过IP映射查找（如果直接查找失败）
    if (!cachedData && ipToHostIdMap.has(requestedHostId)) {
      actualHostId = ipToHostIdMap.get(requestedHostId);
      cachedData = monitoringDataCache.get(actualHostId);
    }
  }

  if (cachedData) {
    // 发送监控服务已安装状态
    sendMessage(ws, {
      type: 'monitoring_status',
      data: {
        hostId: actualHostId,
        status: 'installed',
        available: true,
        message: '监控服务已安装且数据可用',
        timestamp: Date.now()
      }
    });

    // 发送缓存的监控数据
    sendMessage(ws, {
      type: 'system_stats',
      payload: {
        ...cachedData,
        cached: true,
        timestamp: Date.now()
      }
    });

    logger.debug('发送缓存的监控数据', {
      requestedHostId,
      sessionId
    });
  } else {
    // 发送监控服务未安装状态
    sendMessage(ws, {
      type: 'monitoring_status',
      data: {
        hostId: requestedHostId || '未知',
        status: 'not_installed',
        available: false,
        message: '监控服务未安装或数据不可用',
        timestamp: Date.now()
      }
    });

    logger.debug('监控服务未安装', {
      requestedHostId: requestedHostId || '未知',
      sessionId
    });
  }
}

/**
 * 处理来自监控客户端的监控数据
 * @param {WebSocket} _ws WebSocket连接（未使用）
 * @param {string} sessionId 会话ID
 * @param {Object} data 监控数据
 */
function handleMonitoringDataFromClient(_ws, sessionId, data) {
  logger.debug('收到监控客户端数据', { sessionId, type: data.type });

  // 从payload中提取监控数据
  const monitoringData = data.payload || data;

  // 直接从客户端数据中获取唯一主机标识符
  let hostId = null;

  // 优先使用客户端提供的组合标识符
  if (monitoringData.hostId) {
    hostId = monitoringData.hostId;
  } else if (monitoringData.uniqueHostId) {
    hostId = monitoringData.uniqueHostId;
  } else {
    // 兼容旧格式：尝试从hostname构建
    if (monitoringData.os && monitoringData.os.hostname) {
      hostId = monitoringData.os.hostname;
    } else if (monitoringData.hostname) {
      hostId = monitoringData.hostname;
    }
  }

  if (!hostId) {
    logger.warn('无法确定监控数据的主机标识', { sessionId });
    return;
  }

  logger.debug('收到监控数据', { hostId, sessionId });

  // 记录监控客户端会话的主机ID
  const clientSession = monitoringClientSessions.get(sessionId);
  if (clientSession && !clientSession.hostId) {
    clientSession.hostId = hostId;
    clientSessionToHostIdMap.set(sessionId, hostId);
    logger.info('监控客户端主机ID已记录', { sessionId, hostId });
  }

  // 如果是组合标识符，建立IP映射
  if (hostId.includes('@')) {
    const [hostname, ipAddress] = hostId.split('@');
    if (hostname && ipAddress) {
      ipToHostIdMap.set(ipAddress, hostId);
      logger.debug('建立IP映射', { ipAddress, hostId });
    }
  }

  // 直接使用客户端提供的主机标识符缓存数据
  const cacheData = {
    ...monitoringData,
    lastUpdated: Date.now(),
    sessionId,
    source: 'monitoring_client',
    hostId: hostId
  };

  // 使用客户端提供的标识符作为缓存key
  monitoringDataCache.set(hostId, cacheData);

  logger.debug('监控数据已更新', {
    hostId,
    sessionId,
    source: 'monitoring_client'
  });

  // 向订阅了该主机的前端会话广播数据
  let broadcastCount = 0;
  const notifiedSessions = new Set(); // 避免重复通知

  // 检查直接订阅（使用完整hostId）
  if (serverSubscriptions.has(hostId)) {
    const subscribedFrontends = serverSubscriptions.get(hostId);

    subscribedFrontends.forEach(frontendSessionId => {
      if (!notifiedSessions.has(frontendSessionId)) {
        const targetSession = frontendSessions.get(frontendSessionId);
        if (targetSession && targetSession.ws && targetSession.ws.readyState === WebSocket.OPEN) {
          broadcastMonitoringData(targetSession.ws, hostId, monitoringData);
          targetSession.stats.messagesSent += 2; // 发送了两条消息
          notifiedSessions.add(frontendSessionId);
          broadcastCount++;
        }
      }
    });
  }

  // 如果是组合标识符，还要检查IP地址订阅
  if (hostId.includes('@')) {
    const [, ipAddress] = hostId.split('@');
    if (ipAddress && serverSubscriptions.has(ipAddress)) {
      const subscribedFrontends = serverSubscriptions.get(ipAddress);

      subscribedFrontends.forEach(frontendSessionId => {
        if (!notifiedSessions.has(frontendSessionId)) {
          const targetSession = frontendSessions.get(frontendSessionId);
          if (targetSession && targetSession.ws && targetSession.ws.readyState === WebSocket.OPEN) {
            broadcastMonitoringData(targetSession.ws, hostId, monitoringData);
            targetSession.stats.messagesSent += 2; // 发送了两条消息
            notifiedSessions.add(frontendSessionId);
            broadcastCount++;
          }
        }
      });
    }
  }

  if (broadcastCount > 0) {
    logger.debug('监控数据已广播', {
      hostId,
      broadcastCount,
      sessionId
    });
  } else {
    logger.debug('没有前端订阅该主机', {
      hostId,
      sessionId
    });
  }
}

/**
 * 处理监控数据更新
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {Object} data 监控数据
 */
function handleMonitoringDataUpdate(ws, sessionId, data) {
  // 检查是否是前端会话
  const frontendSession = frontendSessions.get(sessionId);
  if (!frontendSession) {
    logger.warn('前端会话不存在', { sessionId });
    sendError(ws, '会话不存在', sessionId);
    return;
  }

  const { hostId, monitoringData } = data;
  if (!hostId || !monitoringData) {
    sendError(ws, '缺少必要的监控数据参数', sessionId);
    return;
  }

  // 更新监控数据缓存
  monitoringDataCache.set(hostId, {
    ...monitoringData,
    lastUpdated: Date.now(),
    sessionId
  });

  // 向订阅了该主机的所有前端会话广播数据
  if (serverSubscriptions.has(hostId)) {
    const subscribedFrontends = serverSubscriptions.get(hostId);
    subscribedFrontends.forEach(frontendSessionId => {
      const targetSession = frontendSessions.get(frontendSessionId);
      if (targetSession && targetSession.ws && targetSession.ws.readyState === WebSocket.OPEN) {
        sendMessage(targetSession.ws, {
          type: 'system_stats',
          payload: {
            ...monitoringData,
            hostId,
            timestamp: Date.now()
          }
        });
        targetSession.stats.messagesSent++;
      }
    });
  }

  // 发送确认
  sendMessage(ws, {
    type: 'monitoring_data_updated',
    data: {
      hostId,
      timestamp: Date.now(),
      sessionId
    }
  });

  logger.debug('监控数据已更新', { hostId, sessionId });
}







/**
 * 广播监控数据到前端
 * @param {WebSocket} ws WebSocket连接
 * @param {string} hostId 主机标识符
 * @param {Object} monitoringData 监控数据
 */
function broadcastMonitoringData(ws, hostId, monitoringData) {
  // 发送监控状态更新（数据可用）
  sendMessage(ws, {
    type: 'monitoring_status',
    data: {
      hostId: hostId,
      status: 'installed',
      available: true,
      message: '监控服务已安装且数据可用',
      timestamp: Date.now()
    }
  });

  // 发送实际的监控数据
  sendMessage(ws, {
    type: 'system_stats',
    payload: {
      ...monitoringData,
      hostId: hostId,
      timestamp: Date.now()
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
 * 获取所有活跃前端会话 - 重构版
 * @returns {Array} 会话列表
 */
function getAllSessions() {
  const sessions = [];
  frontendSessions.forEach((session) => {
    sessions.push({
      id: session.id,
      connectedAt: session.connectedAt,
      clientIp: session.clientIp,
      lastActivity: session.lastActivity,
      stats: session.stats,
      subscribedServers: Array.from(session.subscribedServers)
    });
  });
  return sessions;
}

/**
 * 根据主机名或IP地址查找缓存的监控数据
 * @param {string} hostname 主机名或IP地址
 * @returns {Object|null} 监控数据或null
 */
function getSessionByHostname(hostname) {
  // 返回缓存的监控数据
  return monitoringDataCache.get(hostname) || null;
}

/**
 * 处理新的前端监控WebSocket连接 - 供外部调用
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} request HTTP请求对象
 */
function handleConnection(ws, request) {
  logger.info('新的前端监控连接已建立');

  // 生成唯一的会话ID
  const sessionId = generateSessionId();
  const clientIp = getClientIP(request);

  // 直接调用前端连接处理函数
  handleFrontendConnection(ws, sessionId, clientIp, null);
}

module.exports = {
  initMonitoringWebSocketServer,
  getAllSessions,
  getSessionByHostname,
  handleConnection,
  // 前端监控相关函数
  handleFrontendConnection,
  subscribeToServer,
  unsubscribeFromServer,
  cleanupFrontendSession,
  // 监控客户端相关函数
  handleMonitoringClientConnection
};