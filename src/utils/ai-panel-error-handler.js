/**
 * AI面板错误处理工具
 * 提供统一的错误处理、日志记录和用户友好的错误提示
 */

import { ElMessage, ElNotification } from 'element-plus'
import log from '../services/log.js'

/**
 * 错误类型枚举
 */
export const ErrorTypes = {
  PARSE_ERROR: 'parse_error',
  NETWORK_ERROR: 'network_error',
  VALIDATION_ERROR: 'validation_error',
  PERMISSION_ERROR: 'permission_error',
  STORAGE_ERROR: 'storage_error',
  COMPONENT_ERROR: 'component_error',
  UNKNOWN_ERROR: 'unknown_error'
}

/**
 * 错误严重程度枚举
 */
export const ErrorSeverity = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
}

/**
 * AI面板错误处理器
 */
export class AIErrorHandler {
  constructor() {
    this.errorHistory = []
    this.maxHistorySize = 100
    this.errorCounts = {}
  }

  /**
   * 处理错误
   * @param {Error|string} error 错误对象或错误消息
   * @param {Object} context 错误上下文
   * @param {string} severity 错误严重程度
   */
  handleError(error, context = {}, severity = ErrorSeverity.MEDIUM) {
    const errorInfo = this.normalizeError(error, context, severity)
    
    // 记录错误
    this.recordError(errorInfo)
    
    // 根据严重程度决定处理方式
    switch (severity) {
      case ErrorSeverity.CRITICAL:
        this.handleCriticalError(errorInfo)
        break
      case ErrorSeverity.HIGH:
        this.handleHighSeverityError(errorInfo)
        break
      case ErrorSeverity.MEDIUM:
        this.handleMediumSeverityError(errorInfo)
        break
      case ErrorSeverity.LOW:
        this.handleLowSeverityError(errorInfo)
        break
      default:
        this.handleMediumSeverityError(errorInfo)
    }
    
    return errorInfo
  }

  /**
   * 标准化错误信息
   * @param {Error|string} error 错误
   * @param {Object} context 上下文
   * @param {string} severity 严重程度
   * @returns {Object} 标准化的错误信息
   */
  normalizeError(error, context, severity) {
    const timestamp = new Date().toISOString()
    const id = this.generateErrorId()
    
    let message, stack, type
    
    if (error instanceof Error) {
      message = error.message
      stack = error.stack
      type = this.detectErrorType(error)
    } else if (typeof error === 'string') {
      message = error
      stack = new Error().stack
      type = context.type || ErrorTypes.UNKNOWN_ERROR
    } else {
      message = '未知错误'
      stack = new Error().stack
      type = ErrorTypes.UNKNOWN_ERROR
    }
    
    return {
      id,
      timestamp,
      message,
      stack,
      type,
      severity,
      context,
      userAgent: navigator.userAgent,
      url: window.location.href
    }
  }

  /**
   * 检测错误类型
   * @param {Error} error 错误对象
   * @returns {string} 错误类型
   */
  detectErrorType(error) {
    const message = error.message.toLowerCase()
    
    if (message.includes('parse') || message.includes('syntax')) {
      return ErrorTypes.PARSE_ERROR
    }
    if (message.includes('network') || message.includes('fetch')) {
      return ErrorTypes.NETWORK_ERROR
    }
    if (message.includes('permission') || message.includes('unauthorized')) {
      return ErrorTypes.PERMISSION_ERROR
    }
    if (message.includes('storage') || message.includes('quota')) {
      return ErrorTypes.STORAGE_ERROR
    }
    if (message.includes('validation') || message.includes('invalid')) {
      return ErrorTypes.VALIDATION_ERROR
    }
    
    return ErrorTypes.UNKNOWN_ERROR
  }

  /**
   * 记录错误
   * @param {Object} errorInfo 错误信息
   */
  recordError(errorInfo) {
    // 添加到历史记录
    this.errorHistory.push(errorInfo)
    
    // 限制历史记录大小
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory.shift()
    }
    
    // 统计错误次数
    const key = `${errorInfo.type}:${errorInfo.message}`
    this.errorCounts[key] = (this.errorCounts[key] || 0) + 1
    
    // 记录到日志
    log.error('AI面板错误', {
      id: errorInfo.id,
      type: errorInfo.type,
      message: errorInfo.message,
      severity: errorInfo.severity,
      context: errorInfo.context,
      count: this.errorCounts[key]
    })
  }

  /**
   * 处理严重错误
   * @param {Object} errorInfo 错误信息
   */
  handleCriticalError(errorInfo) {
    ElNotification({
      title: '严重错误',
      message: `AI面板遇到严重错误：${this.getUserFriendlyMessage(errorInfo)}`,
      type: 'error',
      duration: 0, // 不自动关闭
      showClose: true
    })
    
    // 可能需要重置AI面板状态
    this.suggestRecovery(errorInfo)
  }

  /**
   * 处理高严重程度错误
   * @param {Object} errorInfo 错误信息
   */
  handleHighSeverityError(errorInfo) {
    ElNotification({
      title: '错误',
      message: this.getUserFriendlyMessage(errorInfo),
      type: 'error',
      duration: 8000
    })
  }

  /**
   * 处理中等严重程度错误
   * @param {Object} errorInfo 错误信息
   */
  handleMediumSeverityError(errorInfo) {
    ElMessage({
      message: this.getUserFriendlyMessage(errorInfo),
      type: 'error',
      duration: 5000
    })
  }

  /**
   * 处理低严重程度错误
   * @param {Object} errorInfo 错误信息
   */
  handleLowSeverityError(errorInfo) {
    ElMessage({
      message: this.getUserFriendlyMessage(errorInfo),
      type: 'warning',
      duration: 3000
    })
  }

  /**
   * 获取用户友好的错误消息
   * @param {Object} errorInfo 错误信息
   * @returns {string} 用户友好的消息
   */
  getUserFriendlyMessage(errorInfo) {
    const friendlyMessages = {
      [ErrorTypes.PARSE_ERROR]: '消息解析失败，请检查消息格式',
      [ErrorTypes.NETWORK_ERROR]: '网络连接异常，请检查网络设置',
      [ErrorTypes.VALIDATION_ERROR]: '输入数据无效，请检查输入内容',
      [ErrorTypes.PERMISSION_ERROR]: '权限不足，请联系管理员',
      [ErrorTypes.STORAGE_ERROR]: '存储空间不足或访问受限',
      [ErrorTypes.COMPONENT_ERROR]: 'AI面板组件异常，正在尝试恢复',
      [ErrorTypes.UNKNOWN_ERROR]: '发生未知错误，请稍后重试'
    }
    
    return friendlyMessages[errorInfo.type] || errorInfo.message
  }

  /**
   * 建议恢复操作
   * @param {Object} errorInfo 错误信息
   */
  suggestRecovery(errorInfo) {
    const recoveryActions = {
      [ErrorTypes.STORAGE_ERROR]: () => {
        ElNotification({
          title: '恢复建议',
          message: '建议清理AI面板历史记录以释放存储空间',
          type: 'info',
          duration: 10000
        })
      },
      [ErrorTypes.COMPONENT_ERROR]: () => {
        ElNotification({
          title: '恢复建议',
          message: '建议刷新页面以重置AI面板状态',
          type: 'info',
          duration: 10000
        })
      }
    }
    
    const action = recoveryActions[errorInfo.type]
    if (action) {
      setTimeout(action, 1000)
    }
  }

  /**
   * 生成错误ID
   * @returns {string} 错误ID
   */
  generateErrorId() {
    return `ai_error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 获取错误统计
   * @returns {Object} 错误统计信息
   */
  getErrorStats() {
    const totalErrors = this.errorHistory.length
    const errorsByType = {}
    const errorsBySeverity = {}
    const recentErrors = this.errorHistory.slice(-10)
    
    this.errorHistory.forEach(error => {
      errorsByType[error.type] = (errorsByType[error.type] || 0) + 1
      errorsBySeverity[error.severity] = (errorsBySeverity[error.severity] || 0) + 1
    })
    
    return {
      totalErrors,
      errorsByType,
      errorsBySeverity,
      recentErrors,
      mostFrequentErrors: this.getMostFrequentErrors()
    }
  }

  /**
   * 获取最频繁的错误
   * @returns {Array} 最频繁的错误列表
   */
  getMostFrequentErrors() {
    const sorted = Object.entries(this.errorCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([key, count]) => ({ key, count }))
    
    return sorted
  }

  /**
   * 清理错误历史
   */
  clearErrorHistory() {
    this.errorHistory = []
    this.errorCounts = {}
    log.info('AI面板错误历史已清理')
  }

  /**
   * 导出错误报告
   * @returns {string} 错误报告JSON字符串
   */
  exportErrorReport() {
    const report = {
      timestamp: new Date().toISOString(),
      stats: this.getErrorStats(),
      history: this.errorHistory,
      userAgent: navigator.userAgent,
      url: window.location.href
    }
    
    return JSON.stringify(report, null, 2)
  }
}

// 创建全局错误处理器实例
export const aiErrorHandler = new AIErrorHandler()

/**
 * 包装函数，自动处理异步函数的错误
 * @param {Function} fn 要包装的异步函数
 * @param {Object} context 错误上下文
 * @param {string} severity 错误严重程度
 * @returns {Function} 包装后的函数
 */
export function withErrorHandling(fn, context = {}, severity = ErrorSeverity.MEDIUM) {
  return async (...args) => {
    try {
      return await fn(...args)
    } catch (error) {
      aiErrorHandler.handleError(error, context, severity)
      throw error // 重新抛出错误，让调用者决定如何处理
    }
  }
}

/**
 * 安全执行函数，捕获并处理所有错误
 * @param {Function} fn 要执行的函数
 * @param {*} fallback 出错时的回退值
 * @param {Object} context 错误上下文
 * @returns {*} 函数结果或回退值
 */
export function safeExecute(fn, fallback = null, context = {}) {
  try {
    return fn()
  } catch (error) {
    aiErrorHandler.handleError(error, context, ErrorSeverity.LOW)
    return fallback
  }
}

// 全局错误监听器
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    aiErrorHandler.handleError(event.error, {
      type: ErrorTypes.COMPONENT_ERROR,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno
    }, ErrorSeverity.HIGH)
  })
  
  window.addEventListener('unhandledrejection', (event) => {
    aiErrorHandler.handleError(event.reason, {
      type: ErrorTypes.UNKNOWN_ERROR,
      promise: true
    }, ErrorSeverity.HIGH)
  })
  
  // 添加到全局对象以便调试
  window.aiErrorHandler = aiErrorHandler
}

export default {
  AIErrorHandler,
  ErrorTypes,
  ErrorSeverity,
  aiErrorHandler,
  withErrorHandling,
  safeExecute
}
