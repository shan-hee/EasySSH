/**
 * 生产级错误处理系统
 * 提供统一的错误处理、日志记录和监控告警机制
 * 
 * @author EasySSH Team
 * @version 2.0.0
 * @since 2025-08-01
 */

import { EventEmitter } from 'events';
import logger from './logger.js';

/**
 * 错误类型定义
 */
export const ERROR_TYPES = {
  // 系统错误
  SYSTEM_ERROR: 'SYSTEM_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  
  // SSH相关错误
  SSH_CONNECTION_ERROR: 'SSH_CONNECTION_ERROR',
  SSH_AUTHENTICATION_ERROR: 'SSH_AUTHENTICATION_ERROR',
  SSH_COMMAND_ERROR: 'SSH_COMMAND_ERROR',
  SSH_TIMEOUT_ERROR: 'SSH_TIMEOUT_ERROR',
  
  // 监控相关错误
  MONITORING_COLLECTION_ERROR: 'MONITORING_COLLECTION_ERROR',
  MONITORING_PARSE_ERROR: 'MONITORING_PARSE_ERROR',
  MONITORING_TRANSPORT_ERROR: 'MONITORING_TRANSPORT_ERROR',
  
  // WebSocket相关错误
  WEBSOCKET_CONNECTION_ERROR: 'WEBSOCKET_CONNECTION_ERROR',
  WEBSOCKET_MESSAGE_ERROR: 'WEBSOCKET_MESSAGE_ERROR',
  
  // 业务逻辑错误
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  
  // 配置错误
  CONFIG_ERROR: 'CONFIG_ERROR',
  ENVIRONMENT_ERROR: 'ENVIRONMENT_ERROR'
};

/**
 * 错误严重级别
 */
export const ERROR_SEVERITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
};

/**
 * 自定义错误类
 */
export class ProductionError extends Error {
  constructor(message, type = ERROR_TYPES.SYSTEM_ERROR, severity = ERROR_SEVERITY.MEDIUM, context = {}) {
    super(message);
    this.name = 'ProductionError';
    this.type = type;
    this.severity = severity;
    this.context = context;
    this.timestamp = Date.now();
    this.id = this.generateErrorId();
    
    // 保持堆栈跟踪
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ProductionError);
    }
  }

  /**
   * 生成错误ID
   */
  generateErrorId() {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 转换为JSON对象
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      message: this.message,
      type: this.type,
      severity: this.severity,
      context: this.context,
      timestamp: this.timestamp,
      stack: this.stack
    };
  }

  /**
   * 获取用户友好的错误消息
   */
  getUserMessage() {
    const userMessages = {
      [ERROR_TYPES.SSH_CONNECTION_ERROR]: '无法连接到服务器，请检查网络连接和服务器状态',
      [ERROR_TYPES.SSH_AUTHENTICATION_ERROR]: '身份验证失败，请检查用户名和密码',
      [ERROR_TYPES.SSH_TIMEOUT_ERROR]: '连接超时，请稍后重试',
      [ERROR_TYPES.MONITORING_COLLECTION_ERROR]: '监控数据收集失败，请检查服务器状态',
      [ERROR_TYPES.WEBSOCKET_CONNECTION_ERROR]: '实时连接中断，正在尝试重新连接',
      [ERROR_TYPES.VALIDATION_ERROR]: '输入数据格式不正确',
      [ERROR_TYPES.AUTHORIZATION_ERROR]: '权限不足，请联系管理员',
      [ERROR_TYPES.RESOURCE_NOT_FOUND]: '请求的资源不存在'
    };

    return userMessages[this.type] || '系统发生未知错误，请稍后重试';
  }
}

/**
 * 生产级错误处理器
 */
export class ProductionErrorHandler extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      enableMetrics: true,
      enableAlerts: true,
      maxErrorHistory: 1000,
      alertThresholds: {
        errorRate: 0.1, // 10%错误率触发告警
        criticalErrors: 5, // 5个严重错误触发告警
        timeWindow: 300000 // 5分钟时间窗口
      },
      ...options
    };

    this.errorHistory = [];
    this.errorMetrics = {
      totalErrors: 0,
      errorsByType: new Map(),
      errorsBySeverity: new Map(),
      recentErrors: [],
      startTime: Date.now()
    };

    // 设置全局错误处理
    this.setupGlobalErrorHandlers();
  }

  /**
   * 设置全局错误处理器
   */
  setupGlobalErrorHandlers() {
    // 处理未捕获的异常
    process.on('uncaughtException', (error) => {
      this.handleError(new ProductionError(
        `未捕获的异常: ${error.message}`,
        ERROR_TYPES.SYSTEM_ERROR,
        ERROR_SEVERITY.CRITICAL,
        { originalError: error.stack }
      ));
      
      // 给应用一些时间来记录错误，然后退出
      setTimeout(() => {
        process.exit(1);
      }, 1000);
    });

    // 处理未处理的Promise拒绝
    process.on('unhandledRejection', (reason, promise) => {
      this.handleError(new ProductionError(
        `未处理的Promise拒绝: ${reason}`,
        ERROR_TYPES.SYSTEM_ERROR,
        ERROR_SEVERITY.HIGH,
        { promise: promise.toString(), reason }
      ));
    });

    // 处理警告
    process.on('warning', (warning) => {
      logger.warn('Node.js警告', {
        name: warning.name,
        message: warning.message,
        stack: warning.stack
      });
    });
  }

  /**
   * 处理错误
   */
  handleError(error, context = {}) {
    let productionError;

    // 确保错误是ProductionError实例
    if (error instanceof ProductionError) {
      productionError = error;
      productionError.context = { ...productionError.context, ...context };
    } else {
      productionError = new ProductionError(
        error.message || '未知错误',
        ERROR_TYPES.SYSTEM_ERROR,
        ERROR_SEVERITY.MEDIUM,
        { originalError: error, ...context }
      );
    }

    // 记录错误
    this.logError(productionError);
    
    // 更新指标
    if (this.options.enableMetrics) {
      this.updateMetrics(productionError);
    }
    
    // 检查告警条件
    if (this.options.enableAlerts) {
      this.checkAlertConditions(productionError);
    }
    
    // 发出错误事件
    this.emit('error', productionError);
    
    return productionError;
  }

  /**
   * 记录错误日志
   */
  logError(error) {
    const logLevel = this.getLogLevel(error.severity);
    
    logger[logLevel]('生产错误', {
      errorId: error.id,
      type: error.type,
      severity: error.severity,
      message: error.message,
      context: error.context,
      timestamp: error.timestamp,
      stack: error.stack
    });

    // 添加到错误历史
    this.errorHistory.push(error);
    
    // 限制历史记录大小
    if (this.errorHistory.length > this.options.maxErrorHistory) {
      this.errorHistory.shift();
    }
  }

  /**
   * 获取日志级别
   */
  getLogLevel(severity) {
    switch (severity) {
      case ERROR_SEVERITY.LOW:
        return 'debug';
      case ERROR_SEVERITY.MEDIUM:
        return 'warn';
      case ERROR_SEVERITY.HIGH:
        return 'error';
      case ERROR_SEVERITY.CRITICAL:
        return 'error';
      default:
        return 'error';
    }
  }

  /**
   * 更新错误指标
   */
  updateMetrics(error) {
    this.errorMetrics.totalErrors++;
    
    // 按类型统计
    const typeCount = this.errorMetrics.errorsByType.get(error.type) || 0;
    this.errorMetrics.errorsByType.set(error.type, typeCount + 1);
    
    // 按严重级别统计
    const severityCount = this.errorMetrics.errorsBySeverity.get(error.severity) || 0;
    this.errorMetrics.errorsBySeverity.set(error.severity, severityCount + 1);
    
    // 添加到最近错误列表
    this.errorMetrics.recentErrors.push({
      id: error.id,
      type: error.type,
      severity: error.severity,
      timestamp: error.timestamp
    });
    
    // 保持最近错误列表大小
    if (this.errorMetrics.recentErrors.length > 100) {
      this.errorMetrics.recentErrors.shift();
    }
  }

  /**
   * 检查告警条件
   */
  checkAlertConditions(error) {
    const now = Date.now();
    const timeWindow = this.options.alertThresholds.timeWindow;
    
    // 检查时间窗口内的错误
    const recentErrors = this.errorHistory.filter(
      err => now - err.timestamp <= timeWindow
    );
    
    // 检查严重错误数量
    const criticalErrors = recentErrors.filter(
      err => err.severity === ERROR_SEVERITY.CRITICAL
    );
    
    if (criticalErrors.length >= this.options.alertThresholds.criticalErrors) {
      this.triggerAlert('CRITICAL_ERROR_THRESHOLD', {
        criticalErrorCount: criticalErrors.length,
        timeWindow: timeWindow / 1000,
        errors: criticalErrors.slice(-5) // 最近5个严重错误
      });
    }
    
    // 检查错误率
    const totalOperations = this.getTotalOperations(timeWindow);
    if (totalOperations > 0) {
      const errorRate = recentErrors.length / totalOperations;
      if (errorRate >= this.options.alertThresholds.errorRate) {
        this.triggerAlert('HIGH_ERROR_RATE', {
          errorRate: Math.round(errorRate * 100),
          errorCount: recentErrors.length,
          totalOperations,
          timeWindow: timeWindow / 1000
        });
      }
    }
  }

  /**
   * 触发告警
   */
  triggerAlert(alertType, data) {
    const alert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: alertType,
      severity: ERROR_SEVERITY.HIGH,
      message: this.getAlertMessage(alertType, data),
      data,
      timestamp: Date.now()
    };

    logger.error('系统告警触发', alert);
    this.emit('alert', alert);
  }

  /**
   * 获取告警消息
   */
  getAlertMessage(alertType, data) {
    switch (alertType) {
      case 'CRITICAL_ERROR_THRESHOLD':
        return `检测到${data.criticalErrorCount}个严重错误在${data.timeWindow}秒内`;
      case 'HIGH_ERROR_RATE':
        return `错误率过高: ${data.errorRate}% (${data.errorCount}/${data.totalOperations})`;
      default:
        return `未知告警类型: ${alertType}`;
    }
  }

  /**
   * 获取总操作数（简化实现）
   */
  getTotalOperations(timeWindow) {
    // 这里应该根据实际业务逻辑来计算
    // 暂时返回一个估算值
    return Math.max(100, this.errorMetrics.totalErrors * 10);
  }

  /**
   * 创建错误恢复策略
   */
  createRecoveryStrategy(errorType) {
    const strategies = {
      [ERROR_TYPES.SSH_CONNECTION_ERROR]: {
        maxRetries: 3,
        retryDelay: 2000,
        backoffFactor: 2,
        action: 'reconnect'
      },
      [ERROR_TYPES.MONITORING_COLLECTION_ERROR]: {
        maxRetries: 5,
        retryDelay: 1000,
        backoffFactor: 1.5,
        action: 'retry_collection'
      },
      [ERROR_TYPES.WEBSOCKET_CONNECTION_ERROR]: {
        maxRetries: 10,
        retryDelay: 1000,
        backoffFactor: 1.2,
        action: 'reconnect_websocket'
      }
    };

    return strategies[errorType] || {
      maxRetries: 1,
      retryDelay: 5000,
      backoffFactor: 1,
      action: 'log_only'
    };
  }

  /**
   * 获取错误统计
   */
  getErrorStats() {
    const uptime = Date.now() - this.errorMetrics.startTime;
    
    return {
      totalErrors: this.errorMetrics.totalErrors,
      errorRate: this.errorMetrics.totalErrors / (uptime / 1000 / 60), // 每分钟错误数
      errorsByType: Object.fromEntries(this.errorMetrics.errorsByType),
      errorsBySeverity: Object.fromEntries(this.errorMetrics.errorsBySeverity),
      recentErrors: this.errorMetrics.recentErrors.slice(-10),
      uptime: Math.round(uptime / 1000),
      historySize: this.errorHistory.length
    };
  }

  /**
   * 清理错误历史
   */
  clearErrorHistory() {
    this.errorHistory = [];
    this.errorMetrics.recentErrors = [];
    logger.info('错误历史已清理');
  }

  /**
   * 导出错误报告
   */
  exportErrorReport(timeRange = 3600000) { // 默认1小时
    const now = Date.now();
    const errors = this.errorHistory.filter(
      error => now - error.timestamp <= timeRange
    );

    return {
      reportId: `report_${Date.now()}`,
      timeRange: timeRange / 1000,
      totalErrors: errors.length,
      errors: errors.map(error => error.toJSON()),
      summary: this.getErrorStats(),
      generatedAt: now
    };
  }
}

// 创建全局错误处理器实例
export const globalErrorHandler = new ProductionErrorHandler();

// 便捷方法
export const handleError = (error, context) => globalErrorHandler.handleError(error, context);
export const createError = (message, type, severity, context) => 
  new ProductionError(message, type, severity, context);

export default {
  ProductionError,
  ProductionErrorHandler,
  ERROR_TYPES,
  ERROR_SEVERITY,
  globalErrorHandler,
  handleError,
  createError
};
