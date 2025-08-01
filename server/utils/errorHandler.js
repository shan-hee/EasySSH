/**
 * 统一错误处理工具
 */

const logger = require('./logger');

/**
 * 错误类型枚举
 */
const ErrorTypes = {
  CONNECTION_ERROR: 'connection_error',
  VALIDATION_ERROR: 'validation_error',
  TIMEOUT_ERROR: 'timeout_error',
  SYSTEM_ERROR: 'system_error',
  UNKNOWN_ERROR: 'unknown_error'
};

/**
 * 连接错误模式
 */
const CONNECTION_ERROR_PATTERNS = [
  'SSH连接',
  'Not connected',
  'Unable to exec',
  'Connection closed',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'WebSocket',
  'Connection lost'
];

/**
 * 错误处理器类
 */
class ErrorHandler {
  constructor() {
    this.errorCounts = new Map(); // 错误计数
    this.lastErrors = new Map(); // 最后错误时间
  }

  /**
   * 判断是否为连接错误
   * @param {Error|string} error 错误对象或错误消息
   * @returns {boolean} 是否为连接错误
   */
  isConnectionError(error) {
    const message = typeof error === 'string' ? error : error.message || '';
    return CONNECTION_ERROR_PATTERNS.some(pattern => 
      message.includes(pattern)
    );
  }

  /**
   * 获取错误类型
   * @param {Error|string} error 错误对象或错误消息
   * @returns {string} 错误类型
   */
  getErrorType(error) {
    if (this.isConnectionError(error)) {
      return ErrorTypes.CONNECTION_ERROR;
    }

    const message = typeof error === 'string' ? error : error.message || '';
    
    if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
      return ErrorTypes.TIMEOUT_ERROR;
    }
    
    if (message.includes('validation') || message.includes('invalid')) {
      return ErrorTypes.VALIDATION_ERROR;
    }
    
    if (message.includes('system') || message.includes('ENOSYS')) {
      return ErrorTypes.SYSTEM_ERROR;
    }
    
    return ErrorTypes.UNKNOWN_ERROR;
  }

  /**
   * 处理错误
   * @param {Error|string} error 错误对象或错误消息
   * @param {Object} context 错误上下文
   * @param {Object} options 处理选项
   * @returns {Object} 处理结果
   */
  handleError(error, context = {}, options = {}) {
    const {
      sessionId,
      component = 'unknown',
      operation = 'unknown'
    } = context;

    const {
      maxRetries = 3,
      shouldStop = false,
      logLevel = 'error'
    } = options;

    const errorType = this.getErrorType(error);
    const errorMessage = typeof error === 'string' ? error : error.message || '未知错误';
    
    // 更新错误计数
    const errorKey = `${component}:${sessionId || 'global'}`;
    const currentCount = this.errorCounts.get(errorKey) || 0;
    this.errorCounts.set(errorKey, currentCount + 1);
    this.lastErrors.set(errorKey, Date.now());

    // 记录错误日志
    const logData = {
      errorType,
      component,
      operation,
      sessionId,
      errorCount: currentCount + 1,
      message: errorMessage
    };

    if (logLevel === 'error') {
      logger.error(`[${component}] ${operation}失败`, logData);
    } else if (logLevel === 'warn') {
      logger.warn(`[${component}] ${operation}警告`, logData);
    }

    // 判断是否应该停止操作
    const shouldStopOperation = shouldStop || 
      this.isConnectionError(error) || 
      (currentCount + 1) >= maxRetries;

    return {
      errorType,
      errorCount: currentCount + 1,
      shouldStop: shouldStopOperation,
      isConnectionError: this.isConnectionError(error),
      canRetry: !shouldStopOperation && (currentCount + 1) < maxRetries
    };
  }

  /**
   * 重置错误计数
   * @param {string} component 组件名称
   * @param {string} sessionId 会话ID
   */
  resetErrorCount(component, sessionId = null) {
    const errorKey = `${component}:${sessionId || 'global'}`;
    this.errorCounts.delete(errorKey);
    this.lastErrors.delete(errorKey);
  }

  /**
   * 获取错误统计
   * @param {string} component 组件名称
   * @param {string} sessionId 会话ID
   * @returns {Object} 错误统计
   */
  getErrorStats(component, sessionId = null) {
    const errorKey = `${component}:${sessionId || 'global'}`;
    return {
      errorCount: this.errorCounts.get(errorKey) || 0,
      lastErrorTime: this.lastErrors.get(errorKey) || null
    };
  }

  /**
   * 清理过期的错误记录
   * @param {number} maxAge 最大保留时间（毫秒）
   */
  cleanup(maxAge = 24 * 60 * 60 * 1000) { // 默认24小时
    const now = Date.now();
    
    for (const [key, timestamp] of this.lastErrors.entries()) {
      if (now - timestamp > maxAge) {
        this.errorCounts.delete(key);
        this.lastErrors.delete(key);
      }
    }
  }
}

// 创建全局错误处理器实例
const globalErrorHandler = new ErrorHandler();

// 启动定期清理任务
setInterval(() => {
  globalErrorHandler.cleanup();
}, 60 * 60 * 1000); // 每小时清理一次

/**
 * 便捷的错误处理函数
 */
function handleMonitoringError(error, context = {}, options = {}) {
  return globalErrorHandler.handleError(error, {
    component: 'monitoring',
    ...context
  }, options);
}

function handleSSHError(error, context = {}, options = {}) {
  return globalErrorHandler.handleError(error, {
    component: 'ssh',
    ...context
  }, options);
}

function handleWebSocketError(error, context = {}, options = {}) {
  return globalErrorHandler.handleError(error, {
    component: 'websocket',
    ...context
  }, options);
}

module.exports = {
  ErrorHandler,
  ErrorTypes,
  globalErrorHandler,
  handleMonitoringError,
  handleSSHError,
  handleWebSocketError
};
