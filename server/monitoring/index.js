/**
 * 系统监控WebSocket服务
 * 处理服务器监控数据的WebSocket连接
 */

const WebSocket = require('ws');
const url = require('url');

// 存储所有活跃的监控连接
const monitoringSessions = new Map();
// 存储远程主机到会话ID的映射，用于反向查找
const hostToSessionMap = new Map();
// 存储远程客户端连接，用于主动连接模式
const remoteClients = new Map();

// 添加主机ID映射存储
const hostIdMap = new Map();  // 主机ID -> 实际主机地址
const reverseHostIdMap = new Map();  // 实际主机地址 -> 主机ID

/**
 * 初始化监控WebSocket服务器
 * @param {number} port WebSocket服务器监听的端口号
 */
function initMonitoringWebSocketServer(port = 9527) {
  // 直接创建监听端口的WebSocket服务器
  const wss = new WebSocket.Server({ 
    port: port,
    path: '/monitor'
  });
  
  console.log(`监控WebSocket服务器已启动，监听端口 ${port}，路径 /monitor`);
  
  // 监听连接事件
  wss.on('connection', (ws, req) => {
    console.log('新的监控WebSocket连接已建立');
    
    // 生成唯一的会话ID
    const sessionId = generateSessionId();
    const remoteAddress = req.socket.remoteAddress;
    
    // 存储会话信息
    monitoringSessions.set(sessionId, {
      id: sessionId,
      ws,
      connectedAt: new Date(),
      clientIp: remoteAddress,
      lastActivity: Date.now(),
      stats: {
        messagesReceived: 0,
        messagesSent: 0
      },
      connectionMode: 'passive' // 默认被动模式
    });
    
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
      console.log(`监控WebSocket连接已关闭: ${sessionId}`);
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
        monitoringSessions.delete(id);
        
        // 同时清理主机映射
        if (session.targetHost) {
          hostToSessionMap.delete(session.targetHost);
        }
      }
    });
    
    // 尝试重新连接到已断开的远程客户端
    remoteClients.forEach((client, host) => {
      if (client.shouldReconnect && !hostToSessionMap.has(host)) {
        console.log(`尝试重新连接到远程监控客户端: ${host}`);
        connectToRemoteClient(host, client.port || 9527);
      }
    });
  }, 5 * 60 * 1000);
  
  return wss;
}

/**
 * 连接到远程客户端的监控服务
 * @param {string} host 主机地址
 * @param {number} port 端口，默认9527
 * @returns {Promise<boolean>} 连接结果
 */
async function connectToRemoteClient(host, port = 9527) {
  return new Promise((resolve) => {
    try {
      console.log(`主动连接到远程监控客户端: ${host}:${port}`);
      
      // 检查是否已经有活跃连接
      if (hostToSessionMap.has(host)) {
        const sessionId = hostToSessionMap.get(host);
        const session = monitoringSessions.get(sessionId);
        
        if (session && session.ws && session.ws.readyState === WebSocket.OPEN) {
          console.log(`远程客户端已有活跃连接，跳过连接: ${host}:${port}`);
          resolve(true);
          return;
        } else {
          // 清理失效的会话
          if (sessionId) {
            cleanupSession(sessionId);
          }
        }
      }
      
      // 直接尝试WebSocket连接
      console.log(`尝试直接连接WebSocket: ws://${host}:${port}/monitor`);
      const ws = new WebSocket(`ws://${host}:${port}/monitor`);
      let connected = false;
      
      ws.on('open', () => {
        console.log(`成功连接到远程监控客户端: ${host}:${port}`);
        connected = true;
        
        // 生成会话ID
        const sessionId = generateSessionId();
        
        // 保存会话信息
        monitoringSessions.set(sessionId, {
          id: sessionId,
          ws,
          connectedAt: new Date(),
          clientIp: host,
          lastActivity: Date.now(),
          targetHost: host,
          stats: {
            messagesReceived: 0,
            messagesSent: 0
          },
          connectionMode: 'active' // 主动模式
        });
        
        // 更新主机到会话的映射
        hostToSessionMap.set(host, sessionId);
        
        // 发送会话确认
        sendMessage(ws, {
          type: 'session_created',
          data: {
            sessionId,
            timestamp: Date.now()
          }
        });
        
        // 保存或更新远程客户端信息
        remoteClients.set(host, {
          host,
          port,
          lastConnected: Date.now(),
          shouldReconnect: true
        });
        
        resolve(true);
      });
      
      ws.on('message', (message) => {
        try {
          const sessionId = hostToSessionMap.get(host);
          if (!sessionId) return;
          
          const session = monitoringSessions.get(sessionId);
          if (session) {
            session.lastActivity = Date.now();
            session.stats.messagesReceived++;
          }
          
          const data = JSON.parse(message);
          
          // 将system-info转换为system_stats格式
          if (data.type === 'system-info') {
            data.type = 'system_stats';
            data.payload = data.data;
            delete data.data;
          }
          
          handleMonitoringMessage(ws, sessionId, data);
        } catch (err) {
          console.error(`处理远程客户端消息出错: ${err.message}`);
        }
      });
      
      ws.on('close', () => {
        console.log(`与远程客户端的连接已关闭: ${host}`);
        const sessionId = hostToSessionMap.get(host);
        if (sessionId) {
          cleanupSession(sessionId);
        }
      });
      
      ws.on('error', (err) => {
        console.error(`与远程客户端的连接错误: ${err.message}`);
        resolve(false);
      });
      
    } catch (err) {
      console.error(`连接到远程客户端出错: ${err.message}`);
      resolve(false);
    }
  });
}

/**
 * 处理监控消息
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
      
    case 'log_data':
      // 处理日志数据
      handleLogData(ws, sessionId, data.payload);
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

    case 'identify':
      // 处理客户端标识消息
      handleIdentify(ws, sessionId, data.payload);
      break;
      
    case 'request_system_stats':
      // 处理请求系统状态消息 - 支持安全主机ID
      handleRequestSystemStats(ws, sessionId, data);
      break;
      
    default:
      console.warn(`收到未知类型的监控消息: ${type}`);
      sendError(ws, '未知的消息类型', sessionId);
  }
}

/**
 * 处理客户端标识消息
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {Object} data 标识数据
 */
function handleIdentify(ws, sessionId, data) {
  // 获取会话
  const session = monitoringSessions.get(sessionId);
  if (session) {
    // 保存目标主机信息
    session.targetHost = data.targetHost;
    session.clientId = data.clientId;
    
    console.log(`会话 ${sessionId} 已标识为监控 ${data.targetHost}`);
    
    // 更新主机到会话的映射
    hostToSessionMap.set(data.targetHost, sessionId);
    
    // 确认接收
    sendMessage(ws, {
      type: 'identify_ack',
      data: {
        timestamp: Date.now(),
        targetHost: data.targetHost
      }
    });
  }
}

/**
 * 处理系统统计信息
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {Object} stats 系统统计信息
 */
function handleSystemStats(ws, sessionId, stats) {
  // 保存统计信息到会话
  const session = monitoringSessions.get(sessionId);
  if (session) {
    session.systemStats = stats;
    
    // 确保使用安全的主机ID
    let actualHost = null;
    let secureHostId = null;
    
    // 如果有目标主机信息，添加到消息中，但使用安全主机ID
    if (session.targetHost) {
      actualHost = session.targetHost;
      
      // 检查是否已有映射关系
      if (reverseHostIdMap.has(actualHost)) {
        secureHostId = reverseHostIdMap.get(actualHost);
      } else {
        // 创建新的安全主机ID
        secureHostId = `h_${Math.random().toString(36).substring(2, 7)}_${sessionId.substring(0, 5)}`;
        reverseHostIdMap.set(actualHost, secureHostId);
        hostIdMap.set(secureHostId, actualHost);
      }
      
      // 替换实际主机地址为安全主机ID
      stats.hostId = secureHostId;
      
      // 保留原字段，使用安全ID
      if (stats.targetHost) {
        // 如果客户端依赖原始字段，我们在服务器端进行混淆
        stats._targetHost = stats.targetHost; // 保存原始值以备内部使用
        stats.targetHost = secureHostId; // 对外展示使用安全ID
      }
    }
    
    // 广播到所有连接的前端客户端
    monitoringSessions.forEach((otherSession, otherId) => {
      // 跳过非前端连接 (主动连接模式是服务器连接到客户端)
      if (otherId !== sessionId && otherSession.connectionMode !== 'active') {
        sendMessage(otherSession.ws, {
          type: 'system_stats',
          payload: stats
        });
      }
    });
  }
  
  // 确认接收
  sendMessage(ws, {
    type: 'stats_received',
    data: {
      timestamp: Date.now(),
      messageId: stats.messageId
    }
  });
}

/**
 * 处理日志数据
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {Object} logData 日志数据
 */
function handleLogData(ws, sessionId, logData) {
  // 获取会话
  const session = monitoringSessions.get(sessionId);
  
  // 如果有目标主机信息，添加到消息中，但使用安全主机ID
  if (session && session.targetHost) {
    const actualHost = session.targetHost;
    
    // 检查是否已有映射关系
    let secureHostId = null;
    if (reverseHostIdMap.has(actualHost)) {
      secureHostId = reverseHostIdMap.get(actualHost);
    } else {
      // 创建新的安全主机ID
      secureHostId = `h_${Math.random().toString(36).substring(2, 7)}_${sessionId.substring(0, 5)}`;
      reverseHostIdMap.set(actualHost, secureHostId);
      hostIdMap.set(secureHostId, actualHost);
    }
    
    // 替换实际主机地址为安全主机ID
    logData.hostId = secureHostId;
    
    // 保留原字段，使用安全ID
    if (logData.targetHost) {
      // 如果客户端依赖原始字段，我们在服务器端进行混淆
      logData._targetHost = logData.targetHost; // 保存原始值以备内部使用 
      logData.targetHost = secureHostId; // 对外展示使用安全ID
    } else {
      logData.targetHost = secureHostId;
    }
  }
  
  // 广播到所有连接的前端客户端
  monitoringSessions.forEach((otherSession, otherId) => {
    // 跳过非前端连接和自身
    if (otherId !== sessionId && otherSession.connectionMode !== 'active') {
      sendMessage(otherSession.ws, {
        type: 'log_data',
        payload: logData
      });
    }
  });
  
  // 确认接收
  sendMessage(ws, {
    type: 'log_received',
    data: {
      timestamp: Date.now(),
      messageId: logData.messageId
    }
  });
}

/**
 * 处理请求系统状态的消息
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {Object} data 请求数据
 */
function handleRequestSystemStats(ws, sessionId, data) {
  const session = monitoringSessions.get(sessionId);
  if (!session) {
    sendError(ws, '会话不存在', sessionId);
    return;
  }
  
  let targetHost = null;
  
  // 检查是否使用安全主机ID
  if (data.hostId) {
    // 从主机ID映射中获取实际主机地址
    targetHost = hostIdMap.get(data.hostId);
    
    // 如果没有找到映射关系，但存在会话的目标主机，使用会话的目标主机
    if (!targetHost && session.targetHost) {
      targetHost = session.targetHost;
      
      // 创建映射关系，以便后续使用
      if (!reverseHostIdMap.has(targetHost)) {
        reverseHostIdMap.set(targetHost, data.hostId);
        hostIdMap.set(data.hostId, targetHost);
      }
    }
  } else if (data.targetHost) {
    // 向后兼容：如果直接传递了目标主机地址
    targetHost = data.targetHost;
    
    // 创建主机ID映射关系
    if (!reverseHostIdMap.has(targetHost)) {
      const hostId = `h_${Math.random().toString(36).substring(2, 7)}_${sessionId.substring(0, 5)}`;
      reverseHostIdMap.set(targetHost, hostId);
      hostIdMap.set(hostId, targetHost);
    }
  }
  
  if (!targetHost) {
    sendError(ws, '无法确定目标主机', sessionId);
    return;
  }
  
  // 查找已连接的会话
  let targetSessionId = hostToSessionMap.get(targetHost);
  let targetSession = null;
  
  if (targetSessionId) {
    targetSession = monitoringSessions.get(targetSessionId);
  }
  
  if (targetSession && targetSession.ws) {
    // 请求系统状态
    sendMessage(targetSession.ws, {
      type: 'get_system_stats',
      data: {
        timestamp: Date.now(),
        requestId: data.timestamp || Date.now()
      }
    });
    console.log(`向主机 ${targetHost} 请求系统状态`);
  } else {
    // 尝试连接到目标主机
    connectToHost(targetHost).then(connected => {
      if (connected) {
        // 连接成功，再次尝试请求系统状态
        const newSessionId = hostToSessionMap.get(targetHost);
        const newSession = monitoringSessions.get(newSessionId);
        
        if (newSession && newSession.ws) {
          sendMessage(newSession.ws, {
            type: 'get_system_stats',
            data: {
              timestamp: Date.now(),
              requestId: data.timestamp || Date.now()
            }
          });
          console.log(`向新连接的主机 ${targetHost} 请求系统状态`);
        }
      } else {
        sendError(ws, `无法连接到主机 ${targetHost}`, sessionId);
      }
    });
  }
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
      console.error(`发送消息失败: ${err.message}`);
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
 * 清理会话
 * @param {string} sessionId 会话ID
 */
function cleanupSession(sessionId) {
  const session = monitoringSessions.get(sessionId);
  if (session) {
    // 如果有目标主机，清理映射
    if (session.targetHost) {
      hostToSessionMap.delete(session.targetHost);
    }
    
    monitoringSessions.delete(sessionId);
  }
}

/**
 * 生成唯一会话ID
 * @returns {string} 会话ID
 */
function generateSessionId() {
  return `monitor_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

/**
 * 获取所有活跃监控会话
 * @returns {Array} 会话列表
 */
function getAllSessions() {
  const sessions = [];
  monitoringSessions.forEach((session) => {
    sessions.push({
      id: session.id,
      connectedAt: session.connectedAt,
      clientIp: session.clientIp,
      targetHost: session.targetHost,
      lastActivity: session.lastActivity,
      connectionMode: session.connectionMode,
      stats: session.stats,
      systemStats: session.systemStats
    });
  });
  return sessions;
}

/**
 * 主动连接到指定主机的监控服务
 * @param {string} host 主机地址
 * @param {number} port 端口号，默认9527
 * @returns {Promise<boolean>} 连接结果
 */
async function connectToHost(host, port = 9527) {
  // 检查是否已有连接
  if (hostToSessionMap.has(host)) {
    const sessionId = hostToSessionMap.get(host);
    const session = monitoringSessions.get(sessionId);
    
    if (session && session.ws && session.ws.readyState === WebSocket.OPEN) {
      console.log(`已存在到主机 ${host} 的活跃连接，跳过连接`);
      return true;
    }
  }
  
  return connectToRemoteClient(host, port);
}

module.exports = {
  initMonitoringWebSocketServer,
  getAllSessions,
  connectToHost
}; 