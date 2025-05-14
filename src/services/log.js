/**
 * 日志服务模块
 */
class LogService {
  constructor() {
    this.isInitialized = false
    // this.logLevel = 'info'  // debug, info, warn, error
    this.enableConsole = true
    this.logs = []
    this.maxLogs = 1000
    this.logLevels = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
    }
    
    // 忽略特定的错误消息列表
    this.ignoredErrors = [
      '未知的消息类型', 
      'WebSocket连接错误',
      '收到无类型WebSocket消息',
      '解析WebSocket消息失败'
    ]
    
    // 错误消息计数器，用于限制重复错误日志
    this.errorCounts = {}
    
    // 上次显示的错误日志消息
    this.lastErrorMessage = ''
    this.lastErrorTimestamp = 0
    this.errorThrottleTime = 5000 // 5秒内相同错误只显示一次
  }

  /**
   * 初始化日志服务
   * @returns {Promise<boolean>} 是否初始化成功
   */
  init() {
    try {
      if (this.isInitialized) {
        return Promise.resolve(true)
      }
      
      // 从本地存储或环境变量获取日志级别
      const savedLogLevel = localStorage.getItem('easyssh_log_level')
      // if (savedLogLevel && this.logLevels[savedLogLevel] !== undefined) {
      //   this.logLevel = savedLogLevel
      // } else if (import.meta.env.VITE_LOG_LEVEL) {
      //   this.logLevel = import.meta.env.VITE_LOG_LEVEL
      // }
        this.logLevel = import.meta.env.VITE_LOG_LEVEL  
            
      // 确认是否启用控制台日志
      const enableConsole = localStorage.getItem('easyssh_enable_console')
      if (enableConsole !== null) {
        this.enableConsole = enableConsole === 'true'
      }
      
      this.isInitialized = true
      this.info('日志服务初始化完成', { level: this.logLevel, console: this.enableConsole })
      return Promise.resolve(true)
    } catch (error) {
      console.error('日志服务初始化失败', error)
      return Promise.resolve(false)
    }
  }
  
  /**
   * 设置日志级别
   * @param {string} level - 日志级别
   */
  setLogLevel(level) {
    if (this.logLevels[level] !== undefined) {
      this.logLevel = level
      localStorage.setItem('easyssh_log_level', level)
      this.info(`日志级别已设置为: ${level}`)
    }
  }
  
  /**
   * 启用/禁用控制台日志
   * @param {boolean} enable - 是否启用
   */
  setEnableConsole(enable) {
    this.enableConsole = enable
    localStorage.setItem('easyssh_enable_console', enable.toString())
  }
  
  /**
   * 记录调试日志
   * @param {string} message - 日志消息
   * @param {any} data - 相关数据
   */
  debug(message, data) {
    this._log('debug', message, data)
  }
  
  /**
   * 记录信息日志
   * @param {string} message - 日志消息
   * @param {any} data - 相关数据
   */
  info(message, data) {
    this._log('info', message, data)
  }
  
  /**
   * 记录警告日志
   * @param {string} message - 日志消息
   * @param {any} data - 相关数据
   */
  warn(message, data) {
    this._log('warn', message, data)
  }
  
  /**
   * 记录错误日志，带有去重和限流
   * @param {string} message - 日志消息
   * @param {any} data - 相关数据
   */
  error(message, data) {
    // 检查是否应忽略此错误
    const shouldIgnore = this.ignoredErrors.some(pattern => 
      message.includes(pattern)
    )
    
    if (shouldIgnore) {
      // 将严重级别降为debug
      this.debug(`[已忽略ERROR] ${message}`, data)
      return
    }
    
    // 限制重复错误记录频率
    const now = Date.now()
    const isSameError = message === this.lastErrorMessage
    const isWithinThrottleTime = (now - this.lastErrorTimestamp) < this.errorThrottleTime
    
    if (isSameError && isWithinThrottleTime) {
      // 增加计数但不记录日志
      this.errorCounts[message] = (this.errorCounts[message] || 0) + 1
      return
    }
    
    // 记录此错误并重置状态
    this.lastErrorMessage = message
    this.lastErrorTimestamp = now
    
    // 如果是重复错误，添加计数信息
    if (this.errorCounts[message]) {
      const count = this.errorCounts[message]
      this._log('error', `${message} (重复${count}次)`, data)
      this.errorCounts[message] = 0
    } else {
    this._log('error', message, data)
    }
  }
  
  /**
   * 获取所有日志
   * @returns {Array} - 日志数组
   */
  getLogs() {
    return [...this.logs]
  }
  
  /**
   * 清空日志
   */
  clearLogs() {
    this.logs = []
    if (this.enableConsole) {
      console.clear()
    }
  }
  
  /**
   * 记录日志内部实现
   * @param {string} level - 日志级别
   * @param {string} message - 日志消息
   * @param {any} data - 相关数据
   * @private
   */
  _log(level, message, data) {
    // 确保已初始化
    if (!this.isInitialized) {
      this.init()
    }
    
    // 检查日志级别
    if (this.logLevels[level] < this.logLevels[this.logLevel]) {
      return
    }
    
    const timestamp = new Date().toISOString()
    const logEntry = {
      timestamp,
      level,
      message,
      data
    }
    
    // 添加到日志数组
    this.logs.push(logEntry)
    
    // 限制日志数量
    if (this.logs.length > this.maxLogs) {
      this.logs.shift()
    }
    
    // 输出到控制台
    if (this.enableConsole) {
      // 格式化数据，如果是对象则格式化为更友好的字符串
      let formattedData = ''
      if (data !== undefined) {
        if (typeof data === 'object' && data !== null) {
          try {
            // 尝试将对象转换为字符串
            const simpleObj = this._simplifyObject(data)
            if (Object.keys(simpleObj).length > 0) {
              formattedData = JSON.stringify(simpleObj)
            }
          } catch (err) {
            formattedData = String(data)
          }
        } else {
          formattedData = String(data)
        }
      }
      
      // 确保格式化后的消息简洁明了
      const logMessage = formattedData 
        ? `${message} ${formattedData}`
        : message
        
      switch (level) {
        case 'debug':
          console.debug(`[${timestamp}] [DEBUG] ${logMessage}`)
          break
        case 'info':
          console.info(`[${timestamp}] [INFO] ${logMessage}`)
          break
        case 'warn':
          console.warn(`[${timestamp}] [WARN] ${logMessage}`)
          break
        case 'error':
          console.error(`[${timestamp}] [ERROR] ${logMessage}`)
          break
      }
    }
  }

  /**
   * 处理敏感信息，截断长字符串
   * @param {string} value - 要处理的字符串
   * @param {number} maxLength - 最大长度
   * @returns {string} - 处理后的字符串
   * @private
   */
  _truncateSensitive(value, maxLength = 20) {
    if (typeof value === 'string' && value.length > maxLength) {
      return value.substring(0, maxLength) + '...'
    }
    return value
  }
  
  /**
   * 处理对象中的敏感字段
   * @param {Object} obj - 要处理的对象
   * @returns {Object} - 处理后的对象
   * @private
   */
  _sanitizeData(obj) {
    if (!obj || typeof obj !== 'object') {
      return obj
    }
    
    // 处理数组
    if (Array.isArray(obj)) {
      return obj.map(item => this._sanitizeData(item))
    }
    
    // 处理对象
    const result = {}
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        // 检查是否是敏感字段名
        if (/token|password|secret|key|auth|jwt|authorization/i.test(key)) {
          if (typeof obj[key] === 'string') {
            result[key] = this._truncateSensitive(obj[key])
          } else {
            result[key] = obj[key]
          }
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          // 递归处理嵌套对象
          result[key] = this._sanitizeData(obj[key])
        } else {
          result[key] = obj[key]
        }
      }
    }
    return result
  }

  /**
   * 简化对象，用于日志显示
   * @param {Object} obj - 要简化的对象
   * @param {number} depth - 当前深度
   * @param {number} maxDepth - 最大递归深度
   * @returns {Object} - 简化后的对象
   * @private
   */
  _simplifyObject(obj, depth = 0, maxDepth = 2) {
    // 首先处理敏感信息
    const sanitized = this._sanitizeData(obj)
    
    if (depth >= maxDepth) {
      return typeof sanitized === 'object' && sanitized !== null
        ? '[Object]'
        : sanitized
    }
    
    if (!sanitized || typeof sanitized !== 'object') {
      return sanitized
    }
    
    if (Array.isArray(sanitized)) {
      if (sanitized.length > 10) {
        return `[Array(${sanitized.length})]`
      }
      return sanitized.map(item => this._simplifyObject(item, depth + 1, maxDepth))
    }
    
    const result = {}
    for (const key in sanitized) {
      if (Object.prototype.hasOwnProperty.call(sanitized, key)) {
        // 跳过函数、Symbol等不可序列化的值
        const value = sanitized[key]
        if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
          continue
        }
        
        // 处理嵌套对象
        if (value && typeof value === 'object') {
          result[key] = this._simplifyObject(value, depth + 1, maxDepth)
        } else {
          result[key] = value
        }
      }
    }
    
    return result
  }

  /**
   * 设置是否忽略特定错误
   * @param {string} errorPattern - 错误消息模式
   * @param {boolean} ignore - 是否忽略
   */
  setIgnoreError(errorPattern, ignore) {
    if (ignore && !this.ignoredErrors.includes(errorPattern)) {
      this.ignoredErrors.push(errorPattern)
    } else if (!ignore) {
      this.ignoredErrors = this.ignoredErrors.filter(pattern => pattern !== errorPattern)
    }
  }
}

export default new LogService() 