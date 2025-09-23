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
    this.overwrites = 0; // 环形缓冲覆盖计数

    // 配置常量
    this.CONFIG_KEYS = Object.freeze({
      LOG_LEVEL: 'easyssh_log_level',
      ENABLE_CONSOLE: 'easyssh_enable_console',
      COMPACT_DOM: 'easyssh_compact_dom'
    });

    // 是否压缩 DOM/HTML 输出，避免打印整段标记
    this.compactDom = true;
    // 全局错误钩子与跨标签同步注册标记
    this.globalErrorHandlersRegistered = false;
    this.storageSyncRegistered = false;
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
      // 在全局环境暴露导出日志方法，方便在控制台直接调用
      this._exposeGlobalExport();
      // 注册全局错误/未处理Promise钩子
      this._registerGlobalErrorHandlers();
      // 注册跨标签 storage 同步
      this._registerStorageSync();
      this.info('日志服务初始化完成', {
        level: this.logLevel,
        console: this.enableConsole,
        maxLogs: this.maxLogs,
        exportMethod: '执行 EasySSH.exportLogs() 将下载easyssh.logs'
      });
      return true;
    } catch (error) {
      console.error('日志服务初始化失败', error);
      return false;
    }
  }

  /**
   * 在全局作用域暴露导出日志方法（仅浏览器环境）
   * @private
   */
  _exposeGlobalExport() {
    try {
      const g = typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null;
      if (!g) return;
      g.EasySSH = g.EasySSH || {};
      if (typeof g.EasySSH.exportLogs !== 'function') {
        g.EasySSH.exportLogs = () => {
          try {
            // 生成导出内容（基于当前日志级别）
            const json = this.exportLogs();
            const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'easyssh.logs';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            console.log('日志已导出为 easyssh.logs');
            return true;
          } catch (e) {
            console.error('导出日志失败', e);
            return false;
          }
        };
      }
    } catch (_) {
      // 忽略暴露失败，避免影响应用
    }
  }

  /**
   * 注册全局错误与未处理Promise拒绝钩子（浏览器环境）
   * @private
   */
  _registerGlobalErrorHandlers() {
    if (this.globalErrorHandlersRegistered) return;
    try {
      const g = typeof window !== 'undefined' ? window : null;
      if (!g || typeof g.addEventListener !== 'function') return;

      g.addEventListener('error', e => {
        try {
          const msg = e?.message || '未知全局错误';
          const src = e?.filename || (e?.target && (e.target.src || e.target.href)) || '';
          const info = {
            type: 'UncaughtError',
            source: src,
            line: e?.lineno,
            column: e?.colno,
            error: e?.error ? { name: e.error.name, message: e.error.message, stack: e.error.stack } : undefined
          };
          this.error(`未捕获错误: ${msg}`, info);
        } catch (_) {
          // 忽略
        }
      });

      g.addEventListener('unhandledrejection', e => {
        try {
          const reason = e?.reason;
          let msg = '未处理的Promise拒绝';
          let details;
          if (reason instanceof Error) {
            msg = `未处理的Promise拒绝: ${reason.message}`;
            details = { name: reason.name, message: reason.message, stack: reason.stack };
          } else {
            details = { reason };
          }
          this.error(msg, { type: 'UnhandledRejection', ...details });
        } catch (_) {
          // 忽略
        }
      });

      this.globalErrorHandlersRegistered = true;
    } catch (_) {
      // 忽略注册失败
    }
  }

  /**
   * 跨标签页同步日志设置（logLevel/enableConsole/compactDom）
   * @private
   */
  _registerStorageSync() {
    if (this.storageSyncRegistered) return;
    try {
      const g = typeof window !== 'undefined' ? window : null;
      if (!g || typeof g.addEventListener !== 'function') return;

      g.addEventListener('storage', e => {
        try {
          if (!e || typeof e.key !== 'string') return;
          if (e.key === this.CONFIG_KEYS.LOG_LEVEL) {
            const nv = e.newValue;
            if (nv && this._isValidLogLevel(nv) && nv !== this.logLevel) {
              const old = this.logLevel;
              this.logLevel = nv;
              this.info(`检测到跨标签同步：日志级别 ${old} -> ${nv}`);
            }
          } else if (e.key === this.CONFIG_KEYS.ENABLE_CONSOLE) {
            const nv = e.newValue === 'true';
            if (nv !== this.enableConsole) {
              const old = this.enableConsole;
              this.enableConsole = nv;
              this.info(`检测到跨标签同步：控制台日志 ${old ? '启用' : '禁用'} -> ${nv ? '启用' : '禁用'}`);
            }
          } else if (e.key === this.CONFIG_KEYS.COMPACT_DOM) {
            const nv = e.newValue === 'true';
            if (nv !== this.compactDom) {
              const old = this.compactDom;
              this.compactDom = nv;
              this.info(`检测到跨标签同步：DOM压缩 ${old ? '开启' : '关闭'} -> ${nv ? '开启' : '关闭'}`);
            }
          }
        } catch (_) {
          // 忽略同步处理中的异常
        }
      });

      this.storageSyncRegistered = true;
    } catch (_) {
      // 忽略注册失败，避免影响应用
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

    // DOM 压缩配置
    const compactDom = this._getStorageItem(this.CONFIG_KEYS.COMPACT_DOM);
    if (compactDom !== null) {
      this.compactDom = compactDom === 'true';
    } else if (typeof import.meta.env.VITE_LOG_COMPACT_DOM !== 'undefined') {
      this.compactDom = String(import.meta.env.VITE_LOG_COMPACT_DOM) !== 'false';
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
    this.overwrites = 0;
  }

  /**
   * 验证日志级别是否有效
   * @param {string} level - 日志级别
   * @returns {boolean}
   * @private
   */
  _isValidLogLevel(level) {
    return typeof level === 'string' && Object.hasOwn(this.logLevels, level);
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
    this.overwrites = 0;
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
      newestLog: null,
      overwrites: this.overwrites,
      bufferSize: this.maxLogs
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

    const now = new Date();
    const timestamp = now.toISOString();
    const logEntry = {
      timestamp,
      level,
      message: String(message),
      data: data !== undefined ? this._sanitizeData(data) : undefined,
      id: this._generateLogId()
    };

    // 使用循环缓冲区提高性能
    if (this.logs[this.logIndex] !== undefined) {
      this.overwrites++;
    }
    this.logs[this.logIndex] = logEntry;
    this.logIndex = (this.logIndex + 1) % this.maxLogs;

    // 输出到控制台
    if (this.enableConsole) {
      const localTimestamp = this._formatLocalTime(now);
      this._outputToConsole(level, localTimestamp, message, data);
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
    // 格式化数据（避免输出大段 HTML/DOM）
    let formattedData = '';
    const MAX_PRINT_LEN = 1200;

    // 消息本身若是超长 HTML，也做简化
    let finalMessage = this._redactSensitiveInString(String(message));
    if (this.compactDom && this._looksLikeHtml(finalMessage) && finalMessage.length > MAX_PRINT_LEN) {
      finalMessage = this._summarizeHtmlString(finalMessage, MAX_PRINT_LEN);
    }
    if (data !== undefined) {
      try {
        // DOM 节点输出精简信息
        if (this.compactDom && this._isDomNode(data)) {
          formattedData = JSON.stringify(this._summarizeDomNode(data));
        } else if (typeof data === 'object' && data !== null) {
          const simpleObj = this._simplifyObject(data);
          if (Object.keys(simpleObj).length > 0) {
            formattedData = JSON.stringify(simpleObj, null, 2);
          }
        } else {
          formattedData = this._redactSensitiveInString(String(data));
        }
      } catch (err) {
        formattedData = '[无法序列化的数据]';
      }
    }

    // 超长字符串截断，避免刷屏
    if (formattedData && formattedData.length > MAX_PRINT_LEN) {
      const omitted = formattedData.length - MAX_PRINT_LEN;
      formattedData = `${formattedData.slice(0, MAX_PRINT_LEN)}... [已截断 ${omitted} 字符]`;
    }

    // 构建日志消息
    const logMessage = formattedData ? `${finalMessage}\n${formattedData}` : finalMessage;

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
   * 将日期格式化为本地时区的易读字符串
   * 形如：2025-09-23 20:15:30.123 GMT+08:00
   * @param {Date} date
   * @returns {string}
   * @private
   */
  _formatLocalTime(date) {
    try {
      const pad = (n, w = 2) => String(n).padStart(w, '0');
      const Y = date.getFullYear();
      const M = pad(date.getMonth() + 1);
      const D = pad(date.getDate());
      const h = pad(date.getHours());
      const m = pad(date.getMinutes());
      const s = pad(date.getSeconds());
      const ms = pad(date.getMilliseconds(), 3);
      const tzMin = -date.getTimezoneOffset();
      const sign = tzMin >= 0 ? '+' : '-';
      const tzH = pad(Math.floor(Math.abs(tzMin) / 60));
      const tzM = pad(Math.abs(tzMin) % 60);
      return `${Y}-${M}-${D} ${h}:${m}:${s}.${ms} GMT${sign}${tzH}:${tzM}`;
    } catch (_) {
      // 兜底：若格式化出错则退回浏览器本地格式
      return date.toLocaleString();
    }
  }

  /**
   * 在字符串内容中按模式打码敏感信息（值级脱敏）
   * @param {string} str
   * @returns {string}
   * @private
   */
  _redactSensitiveInString(str) {
    try {
      let s = String(str);
      // Bearer Token
      s = s.replace(/Bearer\s+[A-Za-z0-9._-]{20,}/gi, 'Bearer [REDACTED]');
      // JWT（三段式，至少每段8个字符）
      s = s.replace(/\b([A-Za-z0-9_-]{8,})\.([A-Za-z0-9_-]{8,})\.([A-Za-z0-9_-]{8,})\b/g, '***.***.***');
      // OpenAI/其他 sk- 开头的密钥
      s = s.replace(/\bsk-[A-Za-z0-9]{16,}\b/g, 'sk-[REDACTED]');
      // AWS 访问密钥（简单掩码）
      s = s.replace(/\bAKIA[0-9A-Z]{16}\b/g, 'AKIA[REDACTED]');
      // 长 Hex 字符串（32~64位）
      s = s.replace(/\b[0-9a-fA-F]{32,64}\b/g, '[HEX_REDACTED]');
      // Base64 长块
      s = s.replace(/\b[A-Za-z0-9+/]{100,}={0,2}\b/g, '[BASE64_REDACTED]');
      // Basic xxx（凭证）
      s = s.replace(/Basic\s+[A-Za-z0-9+/=]{10,}/gi, 'Basic [REDACTED]');
      return s;
    } catch (_) {
      return String(str);
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
      // 非对象：如为字符串也做值级脱敏
      if (typeof obj === 'string') return this._redactSensitiveInString(obj);
      return obj;
    }

    // DOM 节点：返回摘要而非完整结构/HTML
    if (this.compactDom && this._isDomNode(obj)) {
      return this._summarizeDomNode(obj);
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
            result[key] = this._truncateSensitive(this._redactSensitiveInString(obj[key]));
          } else {
            result[key] = obj[key];
          }
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          // 递归处理嵌套对象
          result[key] = this._sanitizeData(obj[key]);
        } else {
          result[key] = typeof obj[key] === 'string' ? this._redactSensitiveInString(obj[key]) : obj[key];
        }
      }
    }
    return result;
  }

  /**
   * 判断是否为 DOM 节点
   * @param {any} v
   * @returns {boolean}
   * @private
   */
  _isDomNode(v) {
    return !!(v && typeof v === 'object' && v.nodeType === 1 && typeof v.tagName === 'string');
  }

  /**
   * 精简输出 DOM 节点信息，避免打印 outerHTML
   * @param {HTMLElement} el
   * @returns {Object}
   * @private
   */
  _summarizeDomNode(el) {
    try {
      const attrs = Array.from(el.attributes || [])
        .slice(0, 6)
        .map(a => `${a.name}="${a.value}"`);
      const childCanvas = el.querySelectorAll ? el.querySelectorAll('canvas').length : undefined;
      return {
        node: 'HTMLElement',
        tag: el.tagName,
        id: el.id || undefined,
        class: el.className || undefined,
        dataset: el.dataset ? { ...el.dataset } : undefined,
        attrs,
        childCanvas
      };
    } catch (_) {
      return { node: 'HTMLElement' };
    }
  }

  /**
   * 侦测字符串是否像 HTML
   */
  _looksLikeHtml(str) {
    return /<\w+[\s>]/.test(str) && /<\/.+>/.test(str);
  }

  /**
   * 压缩 HTML 字符串为摘要输出
   */
  _summarizeHtmlString(str, maxLen) {
    const head = str.slice(0, maxLen);
    const tagMatch = head.match(/<([a-zA-Z0-9-]+)(\s|>)/);
    const tag = tagMatch ? tagMatch[1] : 'HTML';
    const omitted = str.length - head.length;
    return `[${tag}] ${head}... [已截断 ${omitted} 字符]`;
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
    // 忽略传入的 level，导出“当前日志级别及以上”的日志
    const { level: _ignored, ...rest } = options || {};
    const logsRaw = this.getLogs({ level: this.logLevel, ...rest });

    // 将时间统一转换为本地时区字符串
    const logs = logsRaw.map(item => ({
      ...item,
      // 导出时对消息做值级脱敏
      message: typeof item.message === 'string' ? this._redactSensitiveInString(item.message) : item.message,
      // 本地可读时间
      timestamp: this._formatLocalTime(new Date(item.timestamp)),
      // 机器可解析的 ISO 时间
      timestampISO: item.timestamp
    }));

    // 统计信息也统一转为本地时间
    const stats = this.getLogStats();
    if (stats && stats.oldestLog) stats.oldestLog = this._formatLocalTime(new Date(stats.oldestLog));
    if (stats && stats.newestLog) stats.newestLog = this._formatLocalTime(new Date(stats.newestLog));

    const exportData = {
      exportTime: this._formatLocalTime(new Date()),
      logCount: logs.length,
      stats,
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
