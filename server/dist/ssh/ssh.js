"use strict";
// 移除 ts-nocheck：逐步补充类型标注
/**
 * SSH 模块
 * 用于处理SSH连接和WebSocket通信
 */
Object.defineProperty(exports, "__esModule", { value: true });
const ssh2 = require('ssh2');
const WebSocket = require('ws');
const crypto = require('crypto');
const os = require('os');
const net = require('net');
const { exec } = require('child_process');
const logger = require('../utils/logger');
// 导入工具模块
const utils = require('./utils');
const { MSG_TYPE, sendMessage, sendError, validateSshSession, safeExec, recordActivity, logMessage, sendBinaryPong, sendBinaryConnected, sendBinaryNetworkLatency } = utils;
// 导入统一二进制协议
const { BINARY_MSG_TYPE, BinaryMessageDecoder, BinaryMessageSender, validateSession, safeExec: binarySafeExec } = require('./binary-protocol');
// 导入监控桥接服务
const monitoringBridge = require('../services/monitoringBridge');
const sessionLifecycle = require('../services/sessionLifecycleService');
// 存储活动的SSH连接
const sessions = new Map();
function toAbortError(reason, fallback = '操作已取消') {
    if (reason instanceof Error) {
        if (reason.name !== 'AbortError') {
            reason.name = 'AbortError';
        }
        return reason;
    }
    const message = typeof reason === 'string' && reason.trim() ? reason : fallback;
    const error = new Error(message);
    error.name = 'AbortError';
    error.reason = reason;
    error.code = 'ABORT_ERR';
    return error;
}
function throwIfAborted(signal, fallbackMessage = '操作已取消') {
    if (signal?.aborted) {
        throw toAbortError(signal.reason, fallbackMessage);
    }
}
function notifyClientOnAbort(session, reason, detail = {}) {
    if (!session || !session.ws) {
        return;
    }
    const ws = session.ws;
    if (ws.readyState !== WebSocket.OPEN) {
        return;
    }
    if (detail.notifyClient === false) {
        if (detail.closeWebSocket) {
            try {
                ws.close(detail.closeCode || 1000);
            }
            catch (error) {
                logger.debug('关闭WebSocket失败', {
                    sessionId: session.id,
                    reason,
                    error: error.message
                });
            }
        }
        return;
    }
    try {
        const notification = detail.notification;
        if (notification?.kind === 'error') {
            sendError(ws, notification.message || String(reason || '发生未知错误'), session.id);
        }
        else if (notification?.kind === 'message') {
            const payload = {
                sessionId: session.id,
                reason,
                ...(notification.data || {})
            };
            const type = notification.type || MSG_TYPE.DISCONNECTED;
            sendMessage(ws, type, payload);
        }
        else {
            sendMessage(ws, MSG_TYPE.DISCONNECTED, {
                sessionId: session.id,
                reason
            });
        }
    }
    catch (error) {
        logger.warn('发送取消通知失败', {
            sessionId: session.id,
            reason,
            error: error.message
        });
    }
    if (detail.closeWebSocket) {
        try {
            ws.close(detail.closeCode || 1000);
        }
        catch (error) {
            logger.debug('关闭WebSocket失败', {
                sessionId: session.id,
                reason,
                error: error.message
            });
        }
    }
}
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
function createSSHConnection(config, options = {}) {
    const { signal } = options;
    return new Promise((resolve, reject) => {
        const conn = new ssh2.Client();
        let completed = false;
        const handleAbort = () => {
            if (completed) {
                return;
            }
            completed = true;
            const abortError = toAbortError(signal?.reason || 'SSH连接已取消');
            try {
                conn.end();
            }
            catch (error) {
                logger.debug('Abort关闭SSH连接失败', {
                    error: error.message
                });
            }
            cleanup();
            reject(abortError);
        };
        // 连接超时设置 - 与readyTimeout保持一致
        const timeout = setTimeout(() => {
            if (completed) {
                return;
            }
            completed = true;
            try {
                conn.end();
            }
            catch (error) {
                logger.debug('连接超时关闭SSH失败', { error: error.message });
            }
            cleanup();
            reject(new Error('连接超时'));
        }, 25000); // 比readyTimeout多5秒，确保SSH2库的超时先触发
        const cleanup = () => {
            clearTimeout(timeout);
            if (signal && typeof signal.removeEventListener === 'function' && abortListener) {
                signal.removeEventListener('abort', abortListener);
            }
        };
        let abortListener = null;
        if (signal) {
            if (signal.aborted) {
                handleAbort();
                return;
            }
            abortListener = handleAbort;
            signal.addEventListener('abort', abortListener, { once: true });
        }
        conn.on('ready', () => {
            if (completed) {
                return;
            }
            completed = true;
            cleanup();
            logger.debug('SSH连接成功', {
                address: config.address,
                port: config.port,
                username: config.username
            });
            resolve(conn);
        });
        conn.on('error', (err) => {
            if (completed) {
                return;
            }
            completed = true;
            cleanup();
            // 分类处理SSH连接错误
            let errorType = 'unknown';
            let userMessage = err.message;
            if (err.code === 'ECONNREFUSED') {
                errorType = 'connection_refused';
                userMessage = '连接被拒绝，请检查服务器地址和端口';
            }
            else if (err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET') {
                errorType = 'network_timeout';
                userMessage = '网络超时，请检查网络连接';
            }
            else if (err.message.includes('Authentication')) {
                errorType = 'auth_failed';
                userMessage = '认证失败，请检查用户名和密码';
            }
            else if (err.message.includes('Host key verification failed')) {
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
            readyTimeout: 20000, // 增加连接超时时间，适应高延迟网络
            keepaliveInterval: 15000, // 15秒发送一次keepalive
            keepaliveCountMax: 3, // 最多3次keepalive失败后断开
            algorithms: {
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
        logger.debug('尝试SSH连接', {
            host: sshConfig.host,
            port: sshConfig.port,
            username: sshConfig.username,
            authType: config.authType || 'password'
        });
        // 根据认证方式设置配置
        if (config.authType === 'password') {
            sshConfig.password = config.password;
        }
        else if (config.authType === 'privateKey') {
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
        }
        else {
            //logger.debug('ping不可用，使用TCP连接测量延迟', { host, port, method: 'tcp_connect' });
            return await measureWithTCP(host, port);
        }
    }
    catch (error) {
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
                logger.debug(`ping失败: ${host}`, { error: error.message });
                resolve({ method: 'ping_failed', latency: 0 });
                return;
            }
            // 解析ping输出
            const latency = parsePingOutput(stdout);
            if (latency > 0) {
            }
            else {
                logger.warn(`ping解析失败: ${host}`, { output: stdout.substring(0, 100) });
            }
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
        }
        catch (error) {
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
    if (!stdout)
        return 0;
    const patterns = [
        // Linux/macOS格式: time=20.455 ms 或 time=20.455ms (最优先匹配)
        /time=([0-9.]+)\s*ms/i,
        // Windows中文格式: 平均 = 159ms
        /平均\s*=\s*([0-9]+)ms/i,
        // Windows英文格式: Average = 159ms
        /Average\s*=\s*([0-9]+)ms/i,
        // Linux/macOS统计格式: min/avg/max/mdev = 20.455/20.455/20.455/0.000 ms
        /min\/avg\/max\/mdev\s*=\s*[0-9.]+\/([0-9.]+)\/[0-9.]+\/[0-9.]+\s+ms/i,
        // RTT统计格式: rtt min/avg/max/mdev = 0.072/0.072/0.072/0.000 ms
        /rtt\s+min\/avg\/max\/mdev\s*=\s*[0-9.]+\/([0-9.]+)\/[0-9.]+\/[0-9.]+\s+ms/i,
        // 更宽泛的通用格式
        /([0-9.]+)\s*(?:ms|毫秒)/i
    ];
    for (let i = 0; i < patterns.length; i++) {
        const pattern = patterns[i];
        const match = stdout.match(pattern);
        if (match && match[1]) {
            const latency = parseFloat(match[1]);
            if (!isNaN(latency) && latency >= 0) {
                // 对于小于1ms的延迟，保留1ms作为最小值
                const roundedLatency = latency < 1 ? (latency > 0 ? 1 : 0) : Math.round(latency);
                return roundedLatency;
            }
        }
    }
    return 0;
}
/**
 * 并行ping测量：同时ping客户端和SSH主机
 * @param {string} clientIP 客户端IP地址
 * @param {string} sshHost SSH主机IP
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {string} requestId ping请求ID
 */
async function measureLatencyWithParallelPing(clientIP, sshHost, ws, sessionId, requestId) {
    try {
        // 验证输入参数
        if (!sshHost) {
            logger.warn('SSH主机地址为空，跳过延迟测量', { sessionId });
            sendCombinedLatencyResult(ws, sessionId, 0, 0);
            return;
        }
        // 并行执行两个ping测量，无论客户端IP是什么类型
        const [clientResult, serverResult] = await Promise.all([
            smartLatencyMeasurement(clientIP, 22).catch(error => {
                logger.warn('客户端延迟测量失败', { clientIP, error: error.message });
                return { method: 'client_error', latency: 0 };
            }),
            smartLatencyMeasurement(sshHost, 22).catch(error => {
                logger.warn('服务器延迟测量失败', { sshHost, error: error.message });
                return { method: 'server_error', latency: 0 };
            })
        ]);
        const clientLatency = clientResult.latency;
        const serverLatency = serverResult.latency;
        const clientMethod = clientResult.method;
        const serverMethod = serverResult.method;
        //logger.debug(`延迟测试完成: 客户端：${clientLatency} 服务器：${serverLatency} 总延迟：${clientLatency + serverLatency}ms`);
        // 保存延迟数据到会话中
        if (sessions.has(sessionId)) {
            const session = sessions.get(sessionId);
            session.lastPingLatency = serverLatency;
            session.lastClientLatency = clientLatency;
            session.lastPingLatencyTime = new Date();
            session.lastPingMethod = `client:${clientMethod}, server:${serverMethod}`;
            session.lastPingError = (clientLatency === 0 || serverLatency === 0) ?
                `测量失败: client(${clientMethod}), server(${serverMethod})` : null;
        }
        // 发送统一的完整延迟数据
        sendCombinedLatencyResult(ws, sessionId, clientLatency, serverLatency);
    }
    catch (error) {
        logger.error('并行ping测量出错', {
            error: error.message,
            stack: error.stack,
            clientIP,
            sshHost,
            sessionId,
            requestId
        });
        // 出错时发送0延迟
        sendCombinedLatencyResult(ws, sessionId, 0, 0);
    }
}
/**
 * 获取客户端IP地址
 * @param {Object} wsOrRequest WebSocket对象或HTTP请求对象
 * @returns {string} 客户端IP地址
 */
function getClientIP(wsOrRequest) {
    try {
        // 处理WebSocket对象
        if (wsOrRequest._socket) {
            const socket = wsOrRequest._socket;
            const remoteAddress = socket.remoteAddress;
            if (remoteAddress) {
                // 处理IPv6映射的IPv4地址
                if (remoteAddress.startsWith('::ffff:')) {
                    return remoteAddress.substring(7);
                }
                return remoteAddress;
            }
        }
        // 处理HTTP请求对象
        if (wsOrRequest.headers) {
            const forwardedFor = wsOrRequest.headers['x-forwarded-for'];
            const realIP = wsOrRequest.headers['x-real-ip'];
            const remoteAddress = wsOrRequest.connection?.remoteAddress || wsOrRequest.socket?.remoteAddress;
            if (forwardedFor) {
                // X-Forwarded-For可能包含多个IP，取第一个
                return forwardedFor.split(',')[0].trim();
            }
            if (realIP) {
                return realIP;
            }
            if (remoteAddress) {
                // 处理IPv6映射的IPv4地址
                if (remoteAddress.startsWith('::ffff:')) {
                    return remoteAddress.substring(7);
                }
                return remoteAddress;
            }
        }
        // 尝试直接访问connection/socket属性
        const remoteAddress = wsOrRequest.connection?.remoteAddress ||
            wsOrRequest.socket?.remoteAddress ||
            wsOrRequest.remoteAddress;
        if (remoteAddress) {
            // 处理IPv6映射的IPv4地址
            if (remoteAddress.startsWith('::ffff:')) {
                return remoteAddress.substring(7);
            }
            return remoteAddress;
        }
        return '127.0.0.1'; // 默认本地IP
    }
    catch (error) {
        logger.warn('获取客户端IP失败', { error: error.message });
        return '127.0.0.1';
    }
}
/**
 * 发送合并延迟结果到客户端 - 使用二进制协议
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {number} webSocketLatency WebSocket延迟（前端到EasySSH）
 * @param {number} serverLatency 服务器延迟（EasySSH到服务器）
 */
function sendCombinedLatencyResult(ws, sessionId, webSocketLatency, serverLatency) {
    // 计算总延迟
    const totalLatency = Math.round((webSocketLatency || 0) + (serverLatency || 0));
    // 使用二进制协议发送延迟信息到前端
    const latencyData = {
        sessionId,
        clientLatency: Math.round(webSocketLatency || 0), // 前端到EasySSH的延迟（整数毫秒）
        serverLatency: Math.round(serverLatency || 0), // EasySSH到服务器的延迟（整数毫秒）
        totalLatency, // 总延迟（整数毫秒）
        timestamp: Date.now()
    };
    sendBinaryNetworkLatency(ws, latencyData);
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
function cleanupSession(sessionId, reason = 'unknown') {
    if (!sessions.has(sessionId)) {
        sessionLifecycle.finalize(sessionId);
        return;
    }
    const session = sessions.get(sessionId);
    if (session.cleaned) {
        sessionLifecycle.finalize(sessionId);
        return;
    }
    session.cleaned = true;
    logger.info('清理SSH会话', { sessionId, reason });
    if (session.cleanupTimeout) {
        clearTimeout(session.cleanupTimeout);
        session.cleanupTimeout = null;
    }
    if (session.stream) {
        try {
            session.stream.end();
        }
        catch (err) {
            logger.error('关闭SSH流错误', { sessionId, error: err.message });
        }
        session.stream = null;
    }
    if (session.conn) {
        try {
            session.conn.end();
        }
        catch (err) {
            logger.error('关闭SSH连接错误', { sessionId, error: err.message });
        }
        session.conn = null;
    }
    try {
        const stopped = monitoringBridge.stopMonitoring(sessionId, reason || 'session_cleanup');
        if (stopped) {
            logger.debug('SSH会话清理，监控数据收集已停止', { sessionId, reason });
        }
    }
    catch (error) {
        logger.error('SSH会话清理时停止监控数据收集失败', {
            sessionId,
            reason,
            error: error.message,
            stack: error.stack
        });
    }
    if (session.ws) {
        session.ws.sessionId = undefined;
        session.ws.pendingSessionId = undefined;
        session.ws = null;
    }
    sessions.delete(sessionId);
    sessionLifecycle.finalize(sessionId);
    logger.info('SSH会话已清理', { sessionId, reason });
}
/**
 * 处理SSH连接请求
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 连接数据
 */
async function handleConnect(ws, data) {
    return await safeExec(async () => {
        const sessionId = data.sessionId || generateSessionId();
        const connectionId = data.connectionId || sessionId;
        ws.pendingSessionId = sessionId;
        const lifecycleContext = sessionLifecycle.register(sessionId, {
            connectionId,
            metadata: {
                address: data.address,
                port: data.port || 22,
                username: data.username,
                clientIP: data.clientIP,
                protocolVersion: data.protocolVersion || '2.0'
            }
        });
        const { signal } = lifecycleContext;
        const isReconnect = sessions.has(sessionId);
        let pendingAbort = null;
        const abortHandler = (reason, detail) => {
            const session = sessions.get(sessionId);
            if (!session) {
                pendingAbort = { reason, detail };
                if (detail?.closeWebSocket && ws && ws.readyState === WebSocket.OPEN && ws.isClosed !== true) {
                    try {
                        ws.close((detail.closeCode ?? 1000), (detail.closeReason || ''));
                        ws.isClosed = true;
                    }
                    catch (error) {
                        logger.debug('Abort阶段关闭WebSocket失败', {
                            sessionId,
                            error: error.message
                        });
                    }
                }
                return;
            }
            notifyClientOnAbort(session, reason, detail);
            cleanupSession(sessionId, reason || 'aborted');
        };
        if (!isReconnect) {
            sessionLifecycle.addAbortHandler(sessionId, abortHandler, { runIfAborted: true });
        }
        const ensureNotCancelled = (message) => {
            if (signal?.aborted) {
                pendingAbort = pendingAbort || { reason: signal.reason };
            }
            if (pendingAbort) {
                const reason = pendingAbort.reason || 'aborted';
                pendingAbort = null;
                throw toAbortError(reason, message);
            }
            throwIfAborted(signal, message);
        };
        const ensureWebSocketOpen = (message) => {
            if (!ws || ws.readyState !== WebSocket.OPEN || ws.isClosed === true) {
                throw toAbortError('WebSocket连接已断开', message || 'WebSocket连接已断开');
            }
        };
        try {
            ensureNotCancelled('SSH连接请求已取消');
            if (isReconnect) {
                const session = sessions.get(sessionId);
                session.ws = ws;
                session.clientIP = data.clientIP || session.clientIP;
                session.protocolVersion = data.protocolVersion || session.protocolVersion;
                if (session.cleanupTimeout) {
                    clearTimeout(session.cleanupTimeout);
                    session.cleanupTimeout = null;
                }
                ws.sessionId = sessionId;
                ws.pendingSessionId = undefined;
                sendBinaryConnected(ws, {
                    sessionId,
                    connectionId: session.connectionInfo.connectionId,
                    serverInfo: {
                        host: session.connectionInfo.host,
                        port: session.connectionInfo.port,
                        username: session.connectionInfo.username
                    }
                });
                ensureNotCancelled('SSH连接请求已取消');
                try {
                    const hostInfo = {
                        address: session.connectionInfo.host,
                        port: session.connectionInfo.port,
                        username: session.connectionInfo.username
                    };
                    monitoringBridge.startMonitoring(sessionId, session.conn, hostInfo, { signal });
                    logger.debug('SSH重连成功，监控数据收集已重新启动', {
                        sessionId,
                        host: `${hostInfo.username || 'unknown'}@${hostInfo.address || 'unknown'}:${hostInfo.port || 22}`
                    });
                }
                catch (error) {
                    logger.error('SSH重连成功但重新启动监控数据收集失败', {
                        sessionId,
                        error: error.message
                    });
                }
                logger.debug('重新连接到SSH会话', { sessionId });
                return sessionId;
            }
            ensureWebSocketOpen('WebSocket连接已断开，SSH连接已取消');
            logger.debug('开始创建SSH连接', {
                sessionId,
                wsReadyState: ws.readyState,
                host: `${data.username}@${data.address}:${data.port || 22}`
            });
            const conn = await createSSHConnection(data, { signal });
            ensureNotCancelled('SSH连接请求已取消');
            ensureWebSocketOpen('WebSocket连接已断开，SSH连接已关闭');
            const connectionInfo = {
                host: data.address,
                port: data.port || 22,
                username: data.username,
                connectionId
            };
            const session = {
                id: sessionId,
                conn,
                ws,
                stream: null,
                createdAt: new Date(),
                lastActivity: new Date(),
                cleanupTimeout: null,
                connectionInfo,
                clientIP: data.clientIP,
                protocolVersion: data.protocolVersion || '2.0',
                cleaned: false
            };
            sessions.set(sessionId, session);
            ws.sessionId = sessionId;
            ws.pendingSessionId = undefined;
            ensureNotCancelled('SSH连接请求已取消');
            conn.on('close', () => {
                logger.info('SSH连接已断开', { sessionId });
                sessionLifecycle.abort(sessionId, 'ssh_connection_closed', {
                    notification: { kind: 'message', type: MSG_TYPE.DISCONNECTED }
                });
            });
            conn.on('error', (err) => {
                logger.error('SSH连接错误', { sessionId, error: err.message });
                sessionLifecycle.abort(sessionId, 'ssh_connection_error', {
                    notification: { kind: 'error', message: `SSH连接错误: ${err.message}` }
                });
            });
            conn.shell({ term: 'xterm-color' }, (err, stream) => {
                if (err) {
                    sessionLifecycle.abort(sessionId, 'shell_open_failed', {
                        notification: { kind: 'error', message: `创建Shell失败: ${err.message}` }
                    });
                    return;
                }
                if (signal?.aborted || ws.isClosed === true) {
                    try {
                        if (typeof stream.close === 'function') {
                            stream.close();
                        }
                        else {
                            stream.end();
                        }
                    }
                    catch (error) {
                        logger.debug('取消时关闭Shell失败', {
                            sessionId,
                            error: error.message
                        });
                    }
                    sessionLifecycle.abort(sessionId, 'shell_aborted', { notifyClient: false });
                    return;
                }
                session.stream = stream;
                setupStreamWithBackpressure(session, stream, ws, sessionId);
                stream.on('error', (streamErr) => {
                    logger.error('SSH Shell错误', { sessionId, error: streamErr.message });
                    sessionLifecycle.abort(sessionId, 'shell_error', {
                        notification: { kind: 'error', message: `Shell错误: ${streamErr.message}` }
                    });
                });
                stream.on('close', () => {
                    logger.debug('SSH Shell会话已关闭', { sessionId });
                    sessionLifecycle.abort(sessionId, 'shell_closed', {
                        notification: { kind: 'message', type: MSG_TYPE.CLOSED }
                    });
                });
                sendBinaryConnected(ws, {
                    sessionId,
                    connectionId: connectionInfo.connectionId,
                    serverInfo: {
                        host: connectionInfo.host,
                        port: connectionInfo.port,
                        username: connectionInfo.username
                    }
                });
                try {
                    const hostInfo = {
                        address: connectionInfo.host,
                        port: connectionInfo.port,
                        username: connectionInfo.username
                    };
                    monitoringBridge.startMonitoring(sessionId, conn, hostInfo, { signal });
                    logger.info('SSH连接成功，监控数据收集已启动', {
                        sessionId,
                        host: `${hostInfo.username || 'unknown'}@${hostInfo.address || 'unknown'}:${hostInfo.port || 22}`
                    });
                }
                catch (error) {
                    logger.error('SSH连接成功但启动监控数据收集失败', {
                        sessionId,
                        host: `${connectionInfo.username}@${connectionInfo.host}:${connectionInfo.port}`,
                        error: error.message
                    });
                }
                logger.debug('新SSH会话已创建', { sessionId });
            });
            return sessionId;
        }
        catch (error) {
            if (error && error.name === 'AbortError') {
                logger.info('SSH连接请求已取消', {
                    sessionId,
                    reason: error.message
                });
                return sessionId;
            }
            throw error;
        }
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
    session.stream.setWindow(rows, cols);
    recordActivity(session);
}
/**
 * 处理断开连接
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 数据
 */
function handleDisconnect(ws, data) {
    // 与Abort语义统一：断开即为abort的一种
    try {
        handleAbort(ws, { sessionId: data?.sessionId, reason: 'client_disconnect' });
    }
    catch (_) { /* no-op */ }
}
/**
 * 处理会话取消/中断
 * @param {WebSocket} _ws WebSocket连接
 * @param {Object} data 数据 { sessionId, reason, detail }
 */
function handleAbort(_ws, data = {}) {
    const { sessionId, reason = 'client_abort', detail = {} } = data || {};
    if (!sessionId)
        return;
    sessionLifecycle.abort(sessionId, reason, {
        notification: { kind: 'message', type: MSG_TYPE.DISCONNECTED },
        closeWebSocket: false,
        ...detail
    });
}
/**
 * 统一对外的会话中断入口
 * @param {string} sessionId
 * @param {string} reason
 * @param {Object} detail
 * @returns {boolean}
 */
function abortSession(sessionId, reason = 'server_abort', detail = {}) {
    if (!sessionId)
        return false;
    return sessionLifecycle.abort(sessionId, reason, detail);
}
/**
 * 处理保活消息
 * @param {WebSocket} ws WebSocket连接
 * @param {Object} data 数据
 */
function handlePing(ws, data) {
    const { sessionId, webSocketLatency, measureLatency } = data;
    if (!sessionId || !sessions.has(sessionId)) {
        return;
    }
    // 更新最后活动时间
    const session = sessions.get(sessionId);
    recordActivity(session);
    // 使用二进制协议发送简单PONG响应
    const pongData = {
        sessionId,
        timestamp: Date.now()
    };
    sendBinaryPong(ws, pongData);
    // 如果这是来自_triggerImmediatePing的延迟测量请求
    if (measureLatency && webSocketLatency !== undefined && session.connectionInfo && session.connectionInfo.host) {
        // 优先使用会话中保存的客户端IP，然后是WebSocket对象上的IP，最后使用默认值
        const clientIP = session.clientIP || ws.clientIP || '127.0.0.1';
        const sshHost = session.connectionInfo.host;
        // logger.info('触发延迟测量', {
        //   sessionId,
        //   client: clientIP,
        //   server: sshHost
        // });
        // 使用setImmediate确保PONG先发送，然后进行并行ping测量
        setImmediate(() => {
            measureLatencyWithParallelPing(clientIP, sshHost, ws, sessionId, data.requestId);
        });
    }
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
                logger.debug('SSH命令执行完成', { command, exitCode: code });
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
                }
                else if (paused) {
                    // 继续检查
                    setTimeout(checkResume, 100);
                }
            };
            setTimeout(checkResume, 100);
        }
        // 发送数据
        try {
            // 使用统一的二进制协议发送SSH终端数据
            BinaryMessageSender.sendSSHData(ws, sessionId, data);
        }
        catch (error) {
            logger.error('发送SSH数据失败', {
                sessionId,
                error: error.message,
                dataLength: data.length
            });
            throw error; // 抛出错误，不再使用Base64回退
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
        // 使用统一的二进制协议发送SSH终端数据
        BinaryMessageSender.sendSSHData(ws, sessionId, data);
        // 记录传输统计
        if (global.metricsCollector) {
            global.metricsCollector.recordDataTransfer('outbound', 'binary', data.length);
        }
    }
    catch (error) {
        logger.error('发送SSH二进制数据失败', {
            sessionId,
            error: error.message,
            dataLength: data.length
        });
        throw error; // 抛出错误，不再使用Base64回退
    }
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
    }
    catch (error) {
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
    abortSession,
    handleConnect,
    handleData,
    handleDataBinary,
    handleResize,
    handleDisconnect,
    handleAbort,
    handlePing,
    handleSshExec,
    sendBinaryDataWithStats, // 使用统一的二进制数据发送方法
    setupStreamWithBackpressure
};
