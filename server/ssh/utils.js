/**
 * 通用工具模块
 * 用于提供SSH和SFTP共用的功能
 */

const logger = require('../utils/logger');

/**
 * WebSocket状态常量
 */
const WS_STATE = {
  OPEN: 1
};

/**
 * 消息类型常量
 */
const MSG_TYPE = {
  ERROR: 'error',
  SUCCESS: 'sftp_success',
  ERROR_SFTP: 'sftp_error',
  PROGRESS: 'sftp_progress',
  READY: 'sftp_ready',
  FILE: 'sftp_file',
  CONNECTED: 'connected',
  CLOSED: 'closed',
  DISCONNECTED: 'disconnected',
  DATA: 'data',
  PONG: 'pong',
  NETWORK_LATENCY: 'network_latency',
  CONFIRM: 'sftp_confirm'
};

/**
 * 发送WebSocket消息
 * @param {WebSocket} ws WebSocket连接
 * @param {string} type 消息类型
 * @param {Object} data 消息数据
 */
function sendMessage(ws, type, data) {
  if (ws && ws.readyState === WS_STATE.OPEN) {
    ws.send(JSON.stringify({
      type,
      data
    }));
  }
}

/**
 * 发送错误消息
 * @param {WebSocket} ws WebSocket连接
 * @param {string} message 错误消息
 * @param {string} [sessionId] 会话ID
 * @param {string} [operationId] 操作ID
 * @param {string} [source] 错误源
 */
function sendError(ws, message, sessionId = null, operationId = null, source = null) {
  const data = { message };

  if (sessionId) data.sessionId = sessionId;
  if (operationId) data.operationId = operationId;
  if (source) data.source = source;

  sendMessage(ws, MSG_TYPE.ERROR, data);
}

/**
 * 发送SFTP错误消息
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {string} operationId 操作ID
 * @param {string} message 错误消息
 */
function sendSftpError(ws, sessionId, operationId, message) {
  sendMessage(ws, MSG_TYPE.ERROR_SFTP, {
    sessionId,
    operationId,
    message
  });
}

/**
 * 发送SFTP成功消息
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {string} operationId 操作ID
 * @param {Object} additionalData 附加数据
 */
function sendSftpSuccess(ws, sessionId, operationId, additionalData = {}) {
  const data = {
    sessionId,
    operationId,
    ...additionalData
  };

  // 检查WebSocket状态
  if (!ws || ws.readyState !== WS_STATE.OPEN) {
    logger.error('发送SFTP成功消息失败: WebSocket未就绪');
    return;
  }

  try {
    sendMessage(ws, MSG_TYPE.SUCCESS, data);
  } catch (error) {
    logger.error('发送SFTP成功消息出错', { error: error.message });
  }
}

/**
 * 发送SFTP进度消息
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {string} operationId 操作ID
 * @param {number} progress 进度百分比
 * @param {number} processed 已处理字节数
 * @param {number} total 总字节数
 */
function sendSftpProgress(ws, sessionId, operationId, progress, processed, total) {
  sendMessage(ws, MSG_TYPE.PROGRESS, {
    sessionId,
    operationId,
    progress,
    processed,
    total
  });
}

/**
 * 验证SSH会话是否有效
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {Map} sessions 会话集合
 * @param {string} [operationId] 操作ID
 * @returns {boolean} 会话是否有效
 */
function validateSshSession(ws, sessionId, sessions, operationId = null) {
  if (!sessionId) {
    sendError(ws, '会话ID不能为空', sessionId, operationId);
    return false;
  }

  if (!sessions.has(sessionId)) {
    sendError(ws, '无效的会话ID', sessionId, operationId);
    return false;
  }

  return true;
}

/**
 * 验证SFTP会话是否有效
 * @param {WebSocket} ws WebSocket连接
 * @param {string} sessionId 会话ID
 * @param {Map} sftpSessions SFTP会话集合
 * @param {string} operationId 操作ID
 * @returns {boolean} 会话是否有效
 */
function validateSftpSession(ws, sessionId, sftpSessions, operationId) {
  if (!sessionId) {
    sendSftpError(ws, sessionId, operationId, '会话ID不能为空');
    return false;
  }

  if (!sftpSessions.has(sessionId)) {
    sendSftpError(ws, sessionId, operationId, '无效的SFTP会话');
    return false;
  }

  return true;
}

/**
 * 安全执行函数，包装异常处理
 * @param {function} fn 要执行的函数
 * @param {WebSocket} ws WebSocket连接
 * @param {string} errorPrefix 错误前缀
 * @param {string} sessionId 会话ID
 * @param {string} operationId 操作ID
 * @param {boolean} isSftp 是否是SFTP操作
 */
async function safeExec(fn, ws, errorPrefix, sessionId, operationId, isSftp = true) {
  try {
    return await fn();
  } catch (err) {
    if (isSftp) {
      sendSftpError(ws, sessionId, operationId, `${errorPrefix}: ${err.message}`);
    } else {
      sendError(ws, `${errorPrefix}: ${err.message}`, sessionId);
    }

    return null;
  }
}

/**
 * 记录操作活动
 * @param {Object} session 会话对象
 */
function recordActivity(session) {
  if (session) {
    session.lastActivity = new Date();
  }
}

/**
 * 构建标准日志消息
 * @param {string} action 操作名称
 * @param {string} target 操作目标
 * @param {string} [result='成功'] 操作结果
 * @param {string} [details=''] 详细信息
 * @returns {string} 格式化的日志消息
 */
function logMessage(action, target, result = '成功', details = '') {
  return `${action} ${target} ${result}${details ? `: ${details}` : ''}`;
}

// 导出所有函数和常量
module.exports = {
  WS_STATE,
  MSG_TYPE,
  sendMessage,
  sendError,
  sendSftpError,
  sendSftpSuccess,
  sendSftpProgress,
  validateSshSession,
  validateSftpSession,
  safeExec,
  recordActivity,
  logMessage
};
