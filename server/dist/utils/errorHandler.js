"use strict";
/**
 * 统一错误处理工具（TypeScript）
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.globalErrorHandler = exports.ErrorHandler = exports.ErrorTypes = void 0;
exports.handleMonitoringError = handleMonitoringError;
exports.handleSSHError = handleSSHError;
exports.handleWebSocketError = handleWebSocketError;
const logger_1 = __importDefault(require("./logger"));
exports.ErrorTypes = {
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
        this.errorCounts = new Map();
        this.lastErrors = new Map();
    }
    /**
     * 判断是否为连接错误
     */
    isConnectionError(error) {
        const message = typeof error === 'string' ? error : error?.message || '';
        return CONNECTION_ERROR_PATTERNS.some(pattern => message.includes(pattern));
    }
    /**
     * 获取错误类型
     */
    getErrorType(error) {
        if (this.isConnectionError(error)) {
            return exports.ErrorTypes.CONNECTION_ERROR;
        }
        const message = typeof error === 'string' ? error : error?.message || '';
        if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
            return exports.ErrorTypes.TIMEOUT_ERROR;
        }
        if (message.includes('validation') || message.includes('invalid')) {
            return exports.ErrorTypes.VALIDATION_ERROR;
        }
        if (message.includes('system') || message.includes('ENOSYS')) {
            return exports.ErrorTypes.SYSTEM_ERROR;
        }
        return exports.ErrorTypes.UNKNOWN_ERROR;
    }
    /**
     * 处理错误
     */
    handleError(error, context = {}, options = {}) {
        const { sessionId, component = 'unknown', operation = 'unknown' } = context;
        const { maxRetries = 3, shouldStop = false, logLevel = 'error' } = options;
        const errorType = this.getErrorType(error);
        const errorMessage = typeof error === 'string' ? error : error?.message || '未知错误';
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
            logger_1.default.error(`[${component}] ${operation}失败`, logData);
        }
        else if (logLevel === 'warn') {
            logger_1.default.warn(`[${component}] ${operation}警告`, logData);
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
    resetErrorCount(component, sessionId = null) {
        const errorKey = `${component}:${sessionId || 'global'}`;
        this.errorCounts.delete(errorKey);
        this.lastErrors.delete(errorKey);
    }
    /**
     * 获取错误统计
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
     */
    cleanup(maxAge = 24 * 60 * 60 * 1000) {
        const now = Date.now();
        for (const [key, timestamp] of this.lastErrors.entries()) {
            if (now - timestamp > maxAge) {
                this.errorCounts.delete(key);
                this.lastErrors.delete(key);
            }
        }
    }
}
exports.ErrorHandler = ErrorHandler;
// 创建全局错误处理器实例
exports.globalErrorHandler = new ErrorHandler();
// 启动定期清理任务
setInterval(() => {
    exports.globalErrorHandler.cleanup();
}, 60 * 60 * 1000); // 每小时清理一次
/**
 * 便捷的错误处理函数
 */
function handleMonitoringError(error, context = {}, options = {}) {
    return exports.globalErrorHandler.handleError(error, { component: 'monitoring', ...context }, options);
}
function handleSSHError(error, context = {}, options = {}) {
    return exports.globalErrorHandler.handleError(error, { component: 'ssh', ...context }, options);
}
function handleWebSocketError(error, context = {}, options = {}) {
    return exports.globalErrorHandler.handleError(error, { component: 'websocket', ...context }, options);
}
const api = {
    ErrorHandler,
    ErrorTypes: exports.ErrorTypes,
    globalErrorHandler: exports.globalErrorHandler,
    handleMonitoringError,
    handleSSHError,
    handleWebSocketError
};
// CommonJS 兼容导出
module.exports = api;
exports.default = api;
