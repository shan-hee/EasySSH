/**
 * 日志服务模块
 * 提供统一的日志记录、过滤、格式化和存储功能
 */
class LogService {
  constructor() {
    this.isInitialized = false;
    this.logLevel = 'warn'; // 默认日志级别
    this.enableConsole = true;
    this.logs = [];
    this.maxLogs = 1000;
    this.logLevels = Object.freeze({
      debug: 0,
      info: 1,
      warn: 2,
      error: 3
    });

    // 忽略特定的错误消息列表
    this.ignoredErrors = new Set([
      '未知的消息类型',
      'WebSocket连接错误',
      '收到无类型WebSocket消息',
      '解析WebSocket消息失败'
    ]);

    // 错误消息计数器，用于限制重复错误日志
    this.errorCounts = new Map();

    // 上次显示的错误日志消息
    this.lastErrorMessage = '';
    this.lastErrorTimestamp = 0;
    this.errorThrottleTime = 5000; // 5秒内相同错误只显示一次

    // 性能优化：使用循环缓冲区
    this.logIndex = 0;

    // 配置常量
    this.CONFIG_KEYS = Object.freeze({
      LOG_LEVEL: 'easyssh_log_level',
      ENABLE_CONSOLE: 'easyssh_enable_console'
    });
  }

  /**
   * 初始化日志服务
   * @returns {Promise<boolean>} 是否初始化成功
   */
  async init() {
    try {
      if (this.isInitialized) {
        return true;
      }

      // 优化配置加载逻辑
      this._loadConfiguration();

      // 初始化日志存储
      this._initializeLogStorage();

      this.isInitialized = true;
      this.info('日志服务初始化完成', {
        level: this.logLevel,
        console: this.enableConsole,
        maxLogs: this.maxLogs
      });
      return true;
    } catch (error) {
      console.error('日志服务初始化失败', error);
      return false;
    }
  }

  /**
   * 加载配置
   * @private
   */
  _loadConfiguration() {
    // 优先级：localStorage > 环境变量 > 默认值
    const savedLogLevel = this._getStorageItem(this.CONFIG_KEYS.LOG_LEVEL);
    if (savedLogLevel && this._isValidLogLevel(savedLogLevel)) {
      this.logLevel = savedLogLevel;
    } else if (
      import.meta.env.VITE_LOG_LEVEL &&
      this._isValidLogLevel(import.meta.env.VITE_LOG_LEVEL)
    ) {
      this.logLevel = import.meta.env.VITE_LOG_LEVEL;
    }

    // 控制台日志配置
    const enableConsole = this._getStorageItem(this.CONFIG_KEYS.ENABLE_CONSOLE);
    if (enableConsole !== null) {
      this.enableConsole = enableConsole === 'true';
    }
  }

  /**
   * 初始化日志存储
   * @private
   */
  _initializeLogStorage() {
    // 预分配数组空间以提高性能
    this.logs = new Array(this.maxLogs);
    this.logIndex = 0;
  }

  /**
   * 验证日志级别是否有效
   * @param {string} level - 日志级别
   * @returns {boolean}
   * @private
   */
  _isValidLogLevel(level) {
    return typeof level === 'string' && this.logLevels.hasOwnProperty(level);
  }

  /**
   * 安全获取localStorage项
   * @param {string} key - 存储键
   * @returns {string|null}
   * @private
   */
  _getStorageItem(key) {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      this.warn('无法访问localStorage', { key, error: error.message });
      return null;
    }
  }

  /**
   * 设置日志级别
   * @param {string} level - 日志级别
   * @throws {Error} 当日志级别无效时抛出错误
   */
  setLogLevel(level) {
    if (!this._isValidLogLevel(level)) {
      throw new Error(
        `无效的日志级别: ${level}. 有效级别: ${Object.keys(this.logLevels).join(', ')}`
      );
    }

    const oldLevel = this.logLevel;
    this.logLevel = level;

    try {
      localStorage.setItem(this.CONFIG_KEYS.LOG_LEVEL, level);
      this.info(`日志级别已从 ${oldLevel} 更改为: ${level}`);
    } catch (error) {
      this.warn('无法保存日志级别到localStorage', { level, error: error.message });
    }
  }

  /**
   * 启用/禁用控制台日志
   * @param {boolean} enable - 是否启用
   */
  setEnableConsole(enable) {
    if (typeof enable !== 'boolean') {
      throw new Error('enable参数必须是布尔值');
    }

    const oldValue = this.enableConsole;
    this.enableConsole = enable;

    try {
      localStorage.setItem(this.CONFIG_KEYS.ENABLE_CONSOLE, enable.toString());
      this.info(`控制台日志已${enable ? '启用' : '禁用'}`, { oldValue, newValue: enable });
    } catch (error) {
      this.warn('无法保存控制台设置到localStorage', { enable, error: error.message });
    }
  }

  /**
   * 记录调试日志
   * @param {string} message - 日志消息
   * @param {any} data - 相关数据
   */
  debug(message, data) {
    this._log('debug', message, data);
  }

  /**
   * 记录信息日志
   * @param {string} message - 日志消息
   * @param {any} data - 相关数据
   */
  info(message, data) {
    this._log('info', message, data);
  }

  /**
   * 记录警告日志
   * @param {string} message - 日志消息
   * @param {any} data - 相关数据
   */
  warn(message, data) {
    this._log('warn', message, data);
  }

  /**
   * 记录错误日志，带有去重和限流
   * @param {string} message - 日志消息
   * @param {any} data - 相关数据
   */
  error(message, data) {
    if (typeof message !== 'string') {
      message = String(message);
    }

    // 检查是否应忽略此错误
    const shouldIgnore = Array.from(this.ignoredErrors).some(pattern => message.includes(pattern));

    if (shouldIgnore) {
      // 将严重级别降为debug
      this.debug(`[已忽略ERROR] ${message}`, data);
      return;
    }

    // 限制重复错误记录频率
    const now = Date.now();
    const isSameError = message === this.lastErrorMessage;
    const isWithinThrottleTime = now - this.lastErrorTimestamp < this.errorThrottleTime;

    if (isSameError && isWithinThrottleTime) {
      // 增加计数但不记录日志
      const currentCount = this.errorCounts.get(message) || 0;
      this.errorCounts.set(message, currentCount + 1);
      return;
    }

    // 记录此错误并重置状态
    this.lastErrorMessage = message;
    this.lastErrorTimestamp = now;

    // 如果是重复错误，添加计数信息
    const repeatCount = this.errorCounts.get(message);
    if (repeatCount && repeatCount > 0) {
      this._log('error', `${message} (重复${repeatCount}次)`, data);
      this.errorCounts.set(message, 0);
    } else {
      this._log('error', message, data);
    }
  }

  /**
   * 获取所有日志
   * @param {Object} options - 获取选项
   * @param {string} [options.level] - 过滤日志级别
   * @param {number} [options.limit] - 限制返回数量
   * @param {Date} [options.since] - 获取指定时间之后的日志
   * @returns {Array} - 日志数组
   */
  getLogs(options = {}) {
    const { level, limit, since } = options;

    // 获取有效日志（过滤掉undefined项）
    let validLogs = this.logs.filter(log => log !== undefined);

    // 按级别过滤
    if (level && this._isValidLogLevel(level)) {
      const minLevel = this.logLevels[level];
      validLogs = validLogs.filter(log => this.logLevels[log.level] >= minLevel);
    }

    // 按时间过滤
    if (since instanceof Date) {
      validLogs = validLogs.filter(log => new Date(log.timestamp) >= since);
    }

    // 限制数量
    if (typeof limit === 'number' && limit > 0) {
      validLogs = validLogs.slice(-limit);
    }

    return validLogs.map(log => ({ ...log })); // 返回深拷贝
  }

  /**
   * 清空日志
   * @param {boolean} [clearConsole=true] - 是否同时清空控制台
   */
  clearLogs(clearConsole = true) {
    this.logs.fill(undefined);
    this.logIndex = 0;
    this.errorCounts.clear();
    this.lastErrorMessage = '';
    this.lastErrorTimestamp = 0;

    if (clearConsole && this.enableConsole) {
      console.clear();
    }

    this.info('日志已清空');
  }

  /**
   * 获取日志统计信息
   * @returns {Object} - 统计信息
   */
  getLogStats() {
    const validLogs = this.logs.filter(log => log !== undefined);
    const stats = {
      total: validLogs.length,
      byLevel: {},
      errorCounts: Object.fromEntries(this.errorCounts),
      oldestLog: null,
      newestLog: null
    };

    // 按级别统计
    Object.keys(this.logLevels).forEach(level => {
      stats.byLevel[level] = validLogs.filter(log => log.level === level).length;
    });

    // 时间范围
    if (validLogs.length > 0) {
      const timestamps = validLogs.map(log => new Date(log.timestamp));
      stats.oldestLog = new Date(Math.min(...timestamps));
      stats.newestLog = new Date(Math.max(...timestamps));
    }

    return stats;
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
      this.init();
    }

    // 检查日志级别
    if (this.logLevels[level] < this.logLevels[this.logLevel]) {
      return;
    }

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message: String(message),
      data: data !== undefined ? this._sanitizeData(data) : undefined,
      id: this._generateLogId()
    };

    // 使用循环缓冲区提高性能
    this.logs[this.logIndex] = logEntry;
    this.logIndex = (this.logIndex + 1) % this.maxLogs;

    // 输出到控制台
    if (this.enableConsole) {
      this._outputToConsole(level, timestamp, message, data);
    }
  }

  /**
   * 输出日志到控制台
   * @param {string} level - 日志级别
   * @param {string} timestamp - 时间戳
   * @param {string} message - 消息
   * @param {any} data - 数据
   * @private
   */
  _outputToConsole(level, timestamp, message, data) {
    // 格式化数据
    let formattedData = '';
    if (data !== undefined) {
      try {
        if (typeof data === 'object' && data !== null) {
          const simpleObj = this._simplifyObject(data);
          if (Object.keys(simpleObj).length > 0) {
            formattedData = JSON.stringify(simpleObj, null, 2);
          }
        } else {
          formattedData = String(data);
        }
      } catch (err) {
        formattedData = '[无法序列化的数据]';
      }
    }

    // 构建日志消息
    const logMessage = formattedData ? `${message}\n${formattedData}` : message;

    // 使用对应的控制台方法
    const consoleMethod = console[level] || console.log;
    consoleMethod(`[${timestamp}] [${level.toUpperCase()}] ${logMessage}`);
  }

  /**
   * 生成唯一的日志ID
   * @returns {string}
   * @private
   */
  _generateLogId() {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
      return `${value.substring(0, maxLength)}...`;
    }
    return value;
  }

  /**
   * 处理对象中的敏感字段
   * @param {Object} obj - 要处理的对象
   * @returns {Object} - 处理后的对象
   * @private
   */
  _sanitizeData(obj) {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    // 处理数组
    if (Array.isArray(obj)) {
      return obj.map(item => this._sanitizeData(item));
    }

    // 处理对象
    const result = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        // 检查是否是敏感字段名
        if (/token|password|secret|key|auth|jwt|authorization/i.test(key)) {
          if (typeof obj[key] === 'string') {
            result[key] = this._truncateSensitive(obj[key]);
          } else {
            result[key] = obj[key];
          }
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          // 递归处理嵌套对象
          result[key] = this._sanitizeData(obj[key]);
        } else {
          result[key] = obj[key];
        }
      }
    }
    return result;
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
    const sanitized = this._sanitizeData(obj);

    if (depth >= maxDepth) {
      return typeof sanitized === 'object' && sanitized !== null ? '[Object]' : sanitized;
    }

    if (!sanitized || typeof sanitized !== 'object') {
      return sanitized;
    }

    if (Array.isArray(sanitized)) {
      if (sanitized.length > 10) {
        return `[Array(${sanitized.length})]`;
      }
      return sanitized.map(item => this._simplifyObject(item, depth + 1, maxDepth));
    }

    const result = {};
    for (const key in sanitized) {
      if (Object.prototype.hasOwnProperty.call(sanitized, key)) {
        // 跳过函数、Symbol等不可序列化的值
        const value = sanitized[key];
        if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
          continue;
        }

        // 处理嵌套对象
        if (value && typeof value === 'object') {
          result[key] = this._simplifyObject(value, depth + 1, maxDepth);
        } else {
          result[key] = value;
        }
      }
    }

    return result;
  }

  /**
   * 设置是否忽略特定错误
   * @param {string} errorPattern - 错误消息模式
   * @param {boolean} ignore - 是否忽略
   */
  setIgnoreError(errorPattern, ignore) {
    if (typeof errorPattern !== 'string') {
      throw new Error('错误模式必须是字符串');
    }

    if (typeof ignore !== 'boolean') {
      throw new Error('ignore参数必须是布尔值');
    }

    if (ignore) {
      this.ignoredErrors.add(errorPattern);
      this.info(`已添加忽略错误模式: ${errorPattern}`);
    } else {
      const deleted = this.ignoredErrors.delete(errorPattern);
      if (deleted) {
        this.info(`已移除忽略错误模式: ${errorPattern}`);
      }
    }
  }

  /**
   * 获取当前忽略的错误模式列表
   * @returns {Array<string>}
   */
  getIgnoredErrors() {
    return Array.from(this.ignoredErrors);
  }

  /**
   * 导出日志为JSON格式
   * @param {Object} options - 导出选项
   * @returns {string} JSON字符串
   */
  exportLogs(options = {}) {
    const logs = this.getLogs(options);
    const exportData = {
      exportTime: new Date().toISOString(),
      logCount: logs.length,
      stats: this.getLogStats(),
      logs
    };
    return JSON.stringify(exportData, null, 2);
  }

  /**
   * 批量记录日志
   * @param {Array} logEntries - 日志条目数组
   */
  batchLog(logEntries) {
    if (!Array.isArray(logEntries)) {
      throw new Error('logEntries必须是数组');
    }

    logEntries.forEach(entry => {
      const { level, message, data } = entry;
      if (this._isValidLogLevel(level)) {
        this._log(level, message, data);
      }
    });
  }
}

export default new LogService();
