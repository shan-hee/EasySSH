/**
 * 统一错误处理工具（TypeScript）
 */

import logger from './logger';

/**
 * 错误类型枚举
 */
export type ErrorType =
  | 'connection_error'
  | 'validation_error'
  | 'timeout_error'
  | 'system_error'
  | 'unknown_error';

export const ErrorTypes = {
  CONNECTION_ERROR: 'connection_error',
  VALIDATION_ERROR: 'validation_error',
  TIMEOUT_ERROR: 'timeout_error',
  SYSTEM_ERROR: 'system_error',
  UNKNOWN_ERROR: 'unknown_error'
} as const;

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
export class ErrorHandler {
  private errorCounts: Map<string, number>; // 错误计数
  private lastErrors: Map<string, number>; // 最后错误时间戳（ms）

  constructor() {
    this.errorCounts = new Map();
    this.lastErrors = new Map();
  }

  /**
   * 判断是否为连接错误
   */
  isConnectionError(error: unknown): boolean {
    const message = typeof error === 'string' ? error : (error as Error)?.message || '';
    return CONNECTION_ERROR_PATTERNS.some(pattern => message.includes(pattern));
  }

  /**
   * 获取错误类型
   */
  getErrorType(error: unknown): ErrorType {
    if (this.isConnectionError(error)) {
      return ErrorTypes.CONNECTION_ERROR;
    }

    const message = typeof error === 'string' ? error : (error as Error)?.message || '';

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
   */
  handleError(
    error: unknown,
    context: { sessionId?: string; component?: string; operation?: string } = {},
    options: { maxRetries?: number; shouldStop?: boolean; logLevel?: 'error' | 'warn' } = {}
  ) {
    const { sessionId, component = 'unknown', operation = 'unknown' } = context;

    const { maxRetries = 3, shouldStop = false, logLevel = 'error' } = options;

    const errorType = this.getErrorType(error);
    const errorMessage = typeof error === 'string' ? error : (error as Error)?.message || '未知错误';

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
    const shouldStopOperation = shouldStop || this.isConnectionError(error) || currentCount + 1 >= maxRetries;

    return {
      errorType,
      errorCount: currentCount + 1,
      shouldStop: shouldStopOperation,
      isConnectionError: this.isConnectionError(error),
      canRetry: !shouldStopOperation && currentCount + 1 < maxRetries
    };
  }

  /**
   * 重置错误计数
   */
  resetErrorCount(component: string, sessionId: string | null = null): void {
    const errorKey = `${component}:${sessionId || 'global'}`;
    this.errorCounts.delete(errorKey);
    this.lastErrors.delete(errorKey);
  }

  /**
   * 获取错误统计
   */
  getErrorStats(component: string, sessionId: string | null = null) {
    const errorKey = `${component}:${sessionId || 'global'}`;
    return {
      errorCount: this.errorCounts.get(errorKey) || 0,
      lastErrorTime: this.lastErrors.get(errorKey) || null
    };
  }

  /**
   * 清理过期的错误记录
   */
  cleanup(maxAge = 24 * 60 * 60 * 1000): void {
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
export const globalErrorHandler = new ErrorHandler();

// 启动定期清理任务
setInterval(() => {
  globalErrorHandler.cleanup();
}, 60 * 60 * 1000); // 每小时清理一次

/**
 * 便捷的错误处理函数
 */
export function handleMonitoringError(
  error: unknown,
  context: { sessionId?: string; operation?: string } = {},
  options: { maxRetries?: number; shouldStop?: boolean; logLevel?: 'error' | 'warn' } = {}
) {
  return globalErrorHandler.handleError(error, { component: 'monitoring', ...context }, options);
}

export function handleSSHError(
  error: unknown,
  context: { sessionId?: string; operation?: string } = {},
  options: { maxRetries?: number; shouldStop?: boolean; logLevel?: 'error' | 'warn' } = {}
) {
  return globalErrorHandler.handleError(error, { component: 'ssh', ...context }, options);
}

export function handleWebSocketError(
  error: unknown,
  context: { sessionId?: string; operation?: string } = {},
  options: { maxRetries?: number; shouldStop?: boolean; logLevel?: 'error' | 'warn' } = {}
) {
  return globalErrorHandler.handleError(error, { component: 'websocket', ...context }, options);
}

const api = {
  ErrorHandler,
  ErrorTypes,
  globalErrorHandler,
  handleMonitoringError,
  handleSSHError,
  handleWebSocketError
};

// CommonJS 兼容导出
module.exports = api;
export default api;
