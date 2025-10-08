"use strict";
// @ts-nocheck
/**
 * EasySSH监控WebSocket服务
 * 处理前端监控数据传输和监控客户端连接
 */
const WebSocket = require('ws');
const logger = require('../utils/logger');
const monitoringConfig = require('../config/monitoring');
const { handleWebSocketError } = require('../utils/errorHandler');
const monitoringBridge = require('../services/monitoringBridge');
const sessionLifecycle = require('../services/sessionLifecycleService');
const ssh = require('../ssh/ssh');
// 存储前端监控会话（浏览器连接）
const frontendSessions = new Map();
// 存储服务器订阅关系：serverId -> Set<frontendSessionId>
const serverSubscriptions = new Map();
// 存储监控数据缓存：serverId -> 最新监控数据
const monitoringDataCache = new Map();
// 存储IP到组合标识符的映射：ipAddress -> hostId (hostname@ip)
const ipToHostIdMap = new Map();
// 订阅即推缓存：允许的缓存时效（毫秒）
const SUBSCRIBE_CACHE_TTL_MS = 60 * 1000; // 60秒内的缓存视为有效
function toHostDescriptor(value) {
    if (value === undefined || value === null) {
        return null;
    }
    const raw = String(value).trim();
    if (!raw) {
        return null;
    }
    const withoutProtocol = raw.replace(/^(ssh|ws|wss|http|https):\/\//i, '');
    const withoutCredentials = withoutProtocol.includes('@') ? withoutProtocol.split('@').pop() : withoutProtocol;
    const hostPart = withoutCredentials.split(/[/?#]/)[0];
    if (!hostPart) {
        return null;
    }
    const [hostname, port] = hostPart.split(':');
    return {
        raw,
        value: withoutCredentials,
        host: hostPart,
        hostname,
        port: port || null
    };
}
function descriptorsMatch(target, candidate) {
    if (!target || !candidate) {
        return false;
    }
    if (candidate.value === target.value) {
        return true;
    }
    if (candidate.host === target.host) {
        return true;
    }
    if (candidate.hostname && target.hostname && candidate.hostname === target.hostname) {
        return true;
    }
    if (candidate.hostname && target.value.includes(candidate.hostname)) {
        return true;
    }
    if (target.hostname && candidate.value.includes(target.hostname)) {
        return true;
    }
    return false;
}
function collectSessionDescriptors(context) {
    const descriptors = [];
    const metadata = context?.metadata || {};
    const values = new Set();
    const push = (value) => {
        if (value) {
            values.add(String(value));
        }
    };
    push(metadata.address);
    push(metadata.host);
    push(metadata.hostname);
    push(metadata.hostId);
    push(metadata.serverId);
    push(metadata.target);
    push(metadata.remoteAddress);
    push(metadata.clientIP);
    if (metadata.username && metadata.address) {
        push(`${metadata.username}@${metadata.address}`);
        if (metadata.port) {
            push(`${metadata.username}@${metadata.address}:${metadata.port}`);
        }
    }
    if (metadata.address && metadata.port) {
        push(`${metadata.address}:${metadata.port}`);
    }
    if (context?.connectionId) {
        push(context.connectionId);
    }
    if (metadata.hostId && metadata.port) {
        push(`${metadata.hostId}:${metadata.port}`);
    }
    if (metadata.identifier) {
        push(metadata.identifier);
    }
    if (metadata.serverIdentifier) {
        push(metadata.serverIdentifier);
    }
    values.forEach((value) => {
        const descriptor = toHostDescriptor(value);
        if (descriptor) {
            descriptors.push(descriptor);
        }
    });
    return descriptors;
}
function findSessionsByServerId(serverId) {
    const targetDescriptor = toHostDescriptor(serverId);
    if (!targetDescriptor) {
        return [];
    }
    // 同时支持通过 IP 到 hostId 的映射进行匹配
    const implicitHostId = ipToHostIdMap.get(serverId);
    const implicitDescriptor = implicitHostId ? toHostDescriptor(implicitHostId) : null;
    return sessionLifecycle.listActive().filter((context) => {
        const descriptors = collectSessionDescriptors(context);
        if (descriptors.some((candidate) => descriptorsMatch(targetDescriptor, candidate))) {
            return true;
        }
        if (implicitDescriptor) {
            return descriptors.some((candidate) => descriptorsMatch(implicitDescriptor, candidate));
        }
        return false;
    });
}
// 统一的消息发送函数在底部定义，避免重复定义
/**
 * 初始化前端监控WebSocket服务器 - SSH集成版
 * 处理前端监控数据传输，数据来源为SSH收集器
 * @param {Object} server HTTP服务器实例，用于集成到主服务器
 */
function initMonitoringWebSocketServer(server) {
    // 创建支持压缩的WebSocket服务器，集成到主HTTP服务器
    const wss = new WebSocket.Server({
        noServer: true,
        perMessageDeflate: {
            threshold: 1024, // 超过1KB的消息启用压缩
            concurrencyLimit: 10, // 并发压缩限制
            memLevel: 7, // 内存级别 (1-9)
            serverMaxWindowBits: 15, // 服务器窗口大小
            clientMaxWindowBits: 15, // 客户端窗口大小
            serverMaxNoContextTakeover: false, // 服务器上下文接管
            clientMaxNoContextTakeover: false, // 客户端上下文接管
            serverNoContextTakeover: false,
            clientNoContextTakeover: false
        }
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
    // 监听连接事件 - 只处理前端连接，监控数据来源为SSH收集器
    wss.on('connection', (ws, req) => {
        logger.debug('收到前端监控WebSocket连接请求', { url: req.url });
        const url = new URL(req.url, `http://${req.headers.host}`);
        const subscribeServer = url.searchParams.get('subscribe');
        // 生成唯一的会话ID
        const sessionId = generateSessionId();
        const clientIp = getClientIP(req);
        logger.debug('前端监控WebSocket连接已建立', { subscribeServer, clientIp });
        handleFrontendConnection(ws, sessionId, clientIp, subscribeServer);
    });
    // 定期清理长时间不活跃的前端连接（每5分钟）
    setInterval(() => {
        const now = Date.now();
        // 清理不活跃的前端会话
        frontendSessions.forEach((session, id) => {
            // 检查WebSocket连接状态
            if (session.ws && session.ws.readyState !== WebSocket.OPEN) {
                logger.debug('清理已断开的前端监控会话', {
                    sessionId: id,
                    readyState: session.ws.readyState
                });
                cleanupFrontendSession(id);
                return;
            }
            // 超过30分钟不活跃则清理
            if (now - session.lastActivity > 30 * 60 * 1000) {
                logger.debug('清理不活跃的前端监控会话', {
                    sessionId: id,
                    inactiveTime: Math.round((now - session.lastActivity) / 1000) + 's'
                });
                if (session.ws && session.ws.readyState === WebSocket.OPEN) {
                    session.ws.close();
                }
                cleanupFrontendSession(id);
            }
        });
        // 记录当前活跃的前端监控会话数量（仅在有会话时记录）
        if (frontendSessions.size > 0) {
            logger.debug('当前活跃前端监控会话', {
                count: frontendSessions.size,
                sessions: Array.from(frontendSessions.keys()).slice(0, 5) // 只显示前5个会话ID
            });
        }
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
        subscribedServers: new Set(), // 订阅的服务器列表
        // 每个前端会话针对每个hostId的状态缓存，避免重复发送installed/available状态
        statusByHost: new Map()
    });
    logger.debug('前端会话已创建', { sessionId, clientIp });
    // 发送会话确认
    sendMessage(ws, {
        type: 'session_created',
        data: {
            sessionId,
            timestamp: Date.now(),
            connectionType: 'frontend'
        }
    }, { immediate: true });
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
        }
        catch (err) {
            handleWebSocketError(err, { sessionId, operation: '处理前端消息' });
            sendError(ws, '消息处理错误', sessionId);
        }
    });
    // 处理连接关闭
    ws.on('close', (code, reason) => {
        logger.info('前端监控连接已关闭', {
            sessionId,
            code,
            reason: reason?.toString(),
            clientIp
        });
        // 清理会话数据（替代数据传输管理器注销）
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
                                        message: '前端监控WebSocket连接已断开',
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
        handleWebSocketError(err, { sessionId, operation: '前端WebSocket连接' });
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
        case 'abort': {
            // 新语义：仅确认客户端的前端断开请求，不停止服务器端收集器/SSH
            try {
                const serverId = data?.payload?.serverId || data?.serverId || data?.hostId || 'unknown';
                sendMessage(ws, { type: 'abort_ack', data: { serverId, count: 0 } });
            }
            catch (error) {
                handleWebSocketError(error, { sessionId, operation: '处理abort请求' });
                sendError(ws, '处理取消请求失败', sessionId);
            }
            break;
        }
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
    logger.debug('前端会话已订阅服务器', { frontendSessionId, serverId });
    // 发送订阅确认
    sendMessage(frontendSession.ws, {
        type: 'subscribe_ack',
        data: {
            serverId,
            sessionId: frontendSessionId,
            timestamp: Date.now()
        }
    });
    // 订阅即推缓存：如命中缓存且未过期，立即推送一帧数据（含首次状态）
    try {
        const now = Date.now();
        let actualHostId = serverId;
        let cachedData = monitoringDataCache.get(actualHostId);
        if (!cachedData && ipToHostIdMap.has(serverId)) {
            actualHostId = ipToHostIdMap.get(serverId);
            cachedData = monitoringDataCache.get(actualHostId);
        }
        if (cachedData && (now - (cachedData.lastUpdated || 0) <= SUBSCRIBE_CACHE_TTL_MS)) {
            const sent = broadcastMonitoringData(frontendSessionId, actualHostId, cachedData);
            const s = frontendSessions.get(frontendSessionId);
            if (s)
                s.stats.messagesSent += sent;
            logger.debug('订阅即推缓存命中', {
                frontendSessionId,
                serverId,
                actualHostId,
                ageMs: now - (cachedData.lastUpdated || 0)
            });
        }
        else {
            logger.debug('订阅即推缓存未命中或过期', {
                frontendSessionId,
                serverId,
                hasCache: !!cachedData
            });
        }
    }
    catch (e) {
        logger.debug('订阅即推缓存处理失败', { error: e.message, serverId });
    }
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
        const subscribedSessions = serverSubscriptions.get(serverId);
        subscribedSessions.delete(frontendSessionId);
        // 如果没有订阅者了，删除服务器映射并停止SSH监控
        if (subscribedSessions.size === 0) {
            // 无前端订阅者：仅清理订阅映射，不停止收集器，保持其伴随SSH会话生命周期
            serverSubscriptions.delete(serverId);
        }
    }
    logger.debug('前端会话已取消订阅服务器', {
        frontendSessionId,
        serverId,
        remainingSubscribers: serverSubscriptions.get(serverId)?.size || 0
    });
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
        logger.debug('清理前端监控会话', {
            sessionId,
            clientIp: session.clientIp,
            subscribedServers: session.subscribedServers?.size || 0,
            connectedAt: session.connectedAt
        });
        // 取消所有订阅
        if (session.subscribedServers) {
            session.subscribedServers.forEach(serverId => {
                unsubscribeFromServer(sessionId, serverId);
                logger.debug('取消前端会话订阅', { sessionId, serverId });
            });
        }
        // 关闭WebSocket连接
        if (session.ws && session.ws.readyState === WebSocket.OPEN) {
            session.ws.close();
        }
        // 删除会话
        frontendSessions.delete(sessionId);
        logger.debug('前端监控会话已清理', {
            sessionId,
            remainingSessions: frontendSessions.size
        });
    }
    else {
        logger.debug('前端监控会话不存在，跳过清理', { sessionId });
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
    const session = frontendSessions.get(sessionId);
    if (cachedData) {
        // 仅在首次或状态变化时发送 installed
        const last = session?.statusByHost?.get(actualHostId);
        if (last !== 'installed') {
            sendMessage(ws, {
                type: 'monitoring_status',
                data: {
                    hostId: actualHostId,
                    status: 'installed',
                    available: true,
                    message: '监控数据可用（通过SSH收集）',
                    timestamp: Date.now()
                }
            });
            session?.statusByHost?.set(actualHostId, 'installed');
        }
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
    }
    else {
        // 仅在首次或状态变化时发送 not_installed
        const hostKey = requestedHostId || '未知';
        const last = session?.statusByHost?.get(hostKey);
        if (last !== 'not_installed') {
            sendMessage(ws, {
                type: 'monitoring_status',
                data: {
                    hostId: hostKey,
                    status: 'not_installed',
                    available: false,
                    message: '监控数据不可用（需要SSH连接）',
                    timestamp: Date.now()
                }
            });
            session?.statusByHost?.set(hostKey, 'not_installed');
        }
        logger.debug('监控数据不可用', {
            requestedHostId: hostKey,
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
    }
    else if (monitoringData.uniqueHostId) {
        hostId = monitoringData.uniqueHostId;
    }
    else {
        // 兼容旧格式：尝试从hostname构建
        if (monitoringData.os && monitoringData.os.hostname) {
            hostId = monitoringData.os.hostname;
        }
        else if (monitoringData.hostname) {
            hostId = monitoringData.hostname;
        }
    }
    if (!hostId) {
        logger.warn('无法确定监控数据的主机标识', { sessionId });
        return;
    }
    logger.debug('收到SSH监控数据', { hostId, sessionId });
    // 处理监控数据的通用逻辑
    processMonitoringData(sessionId, hostId, monitoringData, 'ssh_collector');
}
/**
 * 标准化监控数据格式
 * @param {Object} rawData 原始监控数据
 * @returns {Object} 标准化后的监控数据
 */
function standardizeMonitoringData(rawData) {
    if (!rawData || typeof rawData !== 'object') {
        return rawData;
    }
    const standardized = { ...rawData };
    // 标准化数值字段的通用函数
    const normalizeNumber = (value, min = 0, max = 100) => {
        const num = parseFloat(value);
        return isNaN(num) ? 0 : Math.max(min, Math.min(max, num));
    };
    // 标准化CPU数据
    if (standardized.cpu) {
        standardized.cpu.usage = normalizeNumber(standardized.cpu.usage);
        standardized.cpu.cores = normalizeNumber(standardized.cpu.cores, 1, 1000);
        if (typeof standardized.cpu.model !== 'string') {
            standardized.cpu.model = 'Unknown';
        }
    }
    // 标准化内存和磁盘数据
    ['memory', 'disk', 'swap'].forEach(type => {
        if (standardized[type]) {
            const data = standardized[type];
            data.total = normalizeNumber(data.total, 0, Number.MAX_SAFE_INTEGER);
            data.used = normalizeNumber(data.used, 0, Number.MAX_SAFE_INTEGER);
            data.free = normalizeNumber(data.free, 0, Number.MAX_SAFE_INTEGER);
            // 计算使用率
            if (data.total > 0) {
                data.usedPercentage = normalizeNumber((data.used / data.total) * 100);
            }
            else {
                data.usedPercentage = 0;
            }
        }
    });
    // 标准化网络数据
    if (standardized.network) {
        standardized.network.total_rx_speed = normalizeNumber(standardized.network.total_rx_speed, 0, Number.MAX_SAFE_INTEGER);
        standardized.network.total_tx_speed = normalizeNumber(standardized.network.total_tx_speed, 0, Number.MAX_SAFE_INTEGER);
    }
    // 添加时间戳
    if (!standardized.timestamp) {
        standardized.timestamp = Date.now();
    }
    return standardized;
}
/**
 * 处理来自SSH的监控数据
 * @param {string} sessionId SSH会话ID
 * @param {Object} data 监控数据
 */
function handleMonitoringDataFromSSH(sessionId, data) {
    const rawMonitoringData = data.payload || data;
    const hostId = data.hostId || rawMonitoringData.hostId;
    if (!hostId) {
        logger.warn('无法确定SSH监控数据的主机标识', { sessionId });
        return;
    }
    // 标准化监控数据格式
    const standardizedData = standardizeMonitoringData(rawMonitoringData);
    // 处理监控数据的通用逻辑
    processMonitoringData(sessionId, hostId, standardizedData, 'ssh_collector');
}
/**
 * 处理监控数据的通用逻辑
 * @param {string} sessionId 会话ID
 * @param {string} hostId 主机标识符
 * @param {Object} monitoringData 监控数据
 * @param {string} source 数据来源
 */
function processMonitoringData(sessionId, hostId, monitoringData, source) {
    // 如果是组合标识符，建立IP映射
    if (hostId.includes('@')) {
        const [hostname, ipAddress] = hostId.split('@');
        if (hostname && ipAddress) {
            // 只在首次建立映射时记录日志
            if (!ipToHostIdMap.has(ipAddress)) {
                logger.debug('建立IP映射', { ipAddress, hostId });
            }
            ipToHostIdMap.set(ipAddress, hostId);
        }
    }
    // 直接使用主机标识符缓存数据
    const cacheData = {
        ...monitoringData,
        lastUpdated: Date.now(),
        sessionId,
        source: source,
        hostId: hostId
    };
    // 使用主机标识符作为缓存key
    monitoringDataCache.set(hostId, cacheData);
    // 向订阅了该主机的前端会话广播数据
    const notifiedSessions = new Set();
    // 检查直接订阅（使用完整hostId）
    if (serverSubscriptions.has(hostId)) {
        const subscribedFrontends = serverSubscriptions.get(hostId);
        subscribedFrontends.forEach(frontendSessionId => {
            if (!notifiedSessions.has(frontendSessionId)) {
                const targetSession = frontendSessions.get(frontendSessionId);
                if (targetSession && targetSession.ws && targetSession.ws.readyState === WebSocket.OPEN) {
                    const sentCount = broadcastMonitoringData(frontendSessionId, hostId, monitoringData);
                    targetSession.stats.messagesSent += sentCount;
                    notifiedSessions.add(frontendSessionId);
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
                        const sentCount = broadcastMonitoringData(frontendSessionId, hostId, monitoringData);
                        targetSession.stats.messagesSent += sentCount;
                        notifiedSessions.add(frontendSessionId);
                    }
                }
            });
        }
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
    // 减少频繁的数据更新日志
    // logger.debug('监控数据已更新', { hostId, sessionId });
}
/**
 * 广播监控数据到前端（优化版）
 * @param {string} sessionId 会话ID
 * @param {string} hostId 主机标识符
 * @param {Object} monitoringData 监控数据
 */
function broadcastMonitoringData(sessionId, hostId, monitoringData) {
    const session = frontendSessions.get(sessionId);
    if (!session || !session.ws) {
        return 0;
    }
    let sent = 0;
    // 仅在首次（或状态变化时）发送“已安装且可用”状态，避免每次重复发送
    const lastStatus = session.statusByHost?.get(hostId);
    if (lastStatus !== 'installed') {
        sendMessage(session.ws, {
            type: 'monitoring_status',
            data: {
                hostId: hostId,
                status: 'installed',
                available: true,
                message: '监控服务已安装且数据可用',
                timestamp: Date.now()
            }
        });
        session.statusByHost?.set(hostId, 'installed');
        sent += 1;
    }
    // 发送监控数据
    sendMessage(session.ws, {
        type: 'system_stats',
        payload: {
            ...monitoringData,
            hostId: hostId,
            timestamp: Date.now()
        }
    });
    sent += 1;
    return sent;
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
        }
        catch (err) {
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
    logger.debug('新的前端监控连接已建立');
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
    // SSH监控数据处理函数
    handleMonitoringDataFromSSH
};
