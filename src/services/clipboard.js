/**
 * 剪贴板服务模块，提供跨浏览器的剪贴板操作功能
 */

// 导入日志服务
import log from './log';

/**
 * 防抖函数，限制函数调用频率
 * @param {Function} func - 要执行的函数
 * @param {number} wait - 等待时间（毫秒）
 * @returns {Function} - 防抖处理后的函数
 */
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * 权限管理器，处理剪贴板权限
 */
class PermissionManager {
  constructor() {
    this.permissions = new Map();
  }

  /**
   * 检查剪贴板权限
   * @param {string} type - 权限类型（read/write）
   * @returns {Promise<boolean>} - 是否拥有权限
   */
  async checkPermission(type) {
    try {
      // 尝试使用Permissions API查询权限
      if (navigator.permissions && navigator.permissions.query) {
        const permission = await navigator.permissions.query({ name: `clipboard-${type}` });
        this.permissions.set(type, permission.state);
        return permission.state === 'granted';
      }
      // 如果不支持Permissions API，假设有权限
      return true;
    } catch (error) {
      console.error(`权限检查失败: ${error.message}`);
      return true; // 默认假设有权限，让用户操作决定
    }
  }

  /**
   * 请求剪贴板权限
   * @param {string} type - 权限类型（read/write）
   * @returns {Promise<boolean>} - 是否获得权限
   */
  async requestPermission(type) {
    try {
      return await this.checkPermission(type);
    } catch (error) {
      console.error(`权限请求失败: ${error.message}`);
      return false;
    }
  }
}

/**
 * 历史记录管理器，处理剪贴板历史
 */
class HistoryManager {
  constructor(maxItems = 10) {
    this.maxItems = maxItems;
    this.key = 'easyssh_clipboard_history';
  }

  /**
   * 获取历史记录
   * @returns {Array} - 历史记录数组
   */
  getHistory() {
    try {
      return JSON.parse(localStorage.getItem(this.key)) || [];
    } catch (error) {
      console.error(`读取历史记录失败: ${error.message}`);
      return [];
    }
  }

  /**
   * 添加内容到历史记录
   * @param {string} content - 要添加的内容
   */
  addToHistory(content) {
    try {
      if (!content || content.trim().length === 0) return;
      
      let history = this.getHistory();
      // 删除重复项
      history = history.filter(item => item !== content);
      // 添加到开头
      history.unshift(content);
      // 限制长度
      history = history.slice(0, this.maxItems);
      localStorage.setItem(this.key, JSON.stringify(history));
    } catch (error) {
      console.error(`添加历史记录失败: ${error.message}`);
    }
  }

  /**
   * 清除历史记录
   */
  clearHistory() {
    try {
      localStorage.removeItem(this.key);
    } catch (error) {
      console.error(`清除历史记录失败: ${error.message}`);
    }
  }
}

/**
 * 内容处理策略
 */
const ContentHandlers = {
  'text/plain': {
    validate: (content) => typeof content === 'string' && content.length <= 1024 * 1024,
    process: (content) => content.trim()
  },
  'text/html': {
    validate: (content) => content.length <= 2 * 1024 * 1024,
    process: (content) => {
      const div = document.createElement('div');
      div.innerHTML = content;
      return div.innerText;
    }
  }
};

/**
 * 基础剪贴板管理器
 */
class ClipboardManager {
  constructor() {
    this.permissionManager = new PermissionManager();
    this.historyManager = new HistoryManager();
    this.initialized = false;
  }

  /**
   * 初始化剪贴板服务
   * @returns {Promise<boolean>} - 是否初始化成功
   */
  async init() {
    // 避免重复初始化
    if (this.initialized) {
      log.debug('剪贴板服务已初始化');
      return Promise.resolve(true);
    }
    
    log.debug('初始化剪贴板服务...');

    try {
      // 确保在浏览器环境中运行
      if (typeof navigator === 'undefined') {
        log.warn('非浏览器环境，剪贴板服务将降级运行');
        this.initialized = true;
        return Promise.resolve(true);
      }
      
      // 检查是否支持 Clipboard API
      this.useClipboardAPI = !!navigator.clipboard;
      
      if (!this.useClipboardAPI) {
        log.warn('浏览器不支持Clipboard API，使用备用方式');
      }
      
      // 监听粘贴事件 - 只在document存在的情况下添加
      if (typeof document !== 'undefined') {
        try {
          document.addEventListener('paste', (event) => {
            // 简单的空函数，避免直接绑定到可能不存在的方法
            if (typeof this._handlePaste === 'function') {
              this._handlePaste(event);
            } else {
              // 降级处理
              this.handlePaste(event);
            }
          });
        } catch (e) {
          log.warn('添加粘贴事件监听失败，将使用降级方法');
        }
      }
      
      this.initialized = true;
      log.debug('剪贴板服务初始化完成');
      return Promise.resolve(true);
    } catch (error) {
      log.error('剪贴板服务初始化失败', error);
      
      // 即使失败也将服务标记为已初始化，以避免重复尝试
      this.initialized = true;
      
      // 降级支持，仍然返回成功
      return Promise.resolve(true);
    }
  }

  /**
   * 处理粘贴事件
   * @param {ClipboardEvent} event - 粘贴事件
   */
  _handlePaste(event) {
    // 简单实现，避免错误
    try {
      const clipboardData = event.clipboardData || window.clipboardData;
      if (clipboardData) {
        const text = clipboardData.getData('text/plain');
        if (text) {
          log.debug('已处理粘贴事件', { length: text.length });
        }
      }
    } catch (e) {
      log.debug('处理粘贴事件出错', e);
    }
  }

  /**
   * 设置事件监听器
   */
  setupEventListeners() {
    if (typeof document !== 'undefined') {
      document.addEventListener('paste', debounce(this.handlePaste.bind(this), 300));
    }
  }

  /**
   * 处理粘贴事件
   * @param {ClipboardEvent} event - 粘贴事件
   * @returns {string|null} - 粘贴的内容
   */
  async handlePaste(event) {
    try {
      // 权限检查放宽松，避免阻止用户操作
      const clipboardData = event.clipboardData || window.clipboardData;
      if (!clipboardData) return null;
      
      const content = clipboardData.getData('text/plain');
      if (content && this.validateContent(content)) {
        this.historyManager.addToHistory(content);
        return content;
      }
      return null;
    } catch (error) {
      console.error(`粘贴处理失败: ${error.message}`);
      return null;
    }
  }

  /**
   * 验证内容
   * @param {string} content - 要验证的内容
   * @param {string} type - 内容类型
   * @returns {boolean} - 内容是否有效
   */
  validateContent(content, type = 'text/plain') {
    try {
      const handler = ContentHandlers[type];
      if (!handler) return false;
      return handler.validate(content);
    } catch (error) {
      return false;
    }
  }

  /**
   * 复制内容到剪贴板
   * @param {string} text - 要复制的文本
   * @returns {Promise<boolean>} - 是否复制成功
   */
  async copyToClipboard(text) {
    if (!text) return false;
    
    try {
      // 使用现代Clipboard API
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        this.historyManager.addToHistory(text);
        return true;
      } 
      
      // 回退方案：使用document.execCommand
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      
      const result = document.execCommand('copy');
      document.body.removeChild(textarea);
      
      if (result) {
        this.historyManager.addToHistory(text);
      }
      
      return result;
    } catch (error) {
      console.error(`复制操作失败: ${error.message}`);
      return false;
    }
  }

  /**
   * 兼容terminal.js的复制方法
   * @param {string} text - 要复制的文本
   * @param {Object} options - 选项
   * @returns {Promise<boolean>} - 是否复制成功
   */
  async copyText(text, options = {}) {
    const result = await this.copyToClipboard(text);
    if (result && !options.silent) {
      // 可以在这里添加复制成功的提示
    }
    return result;
  }

  /**
   * 从剪贴板读取文本
   * @returns {Promise<string>} - 读取的文本
   */
  async readText() {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        return await navigator.clipboard.readText();
      }
      throw new Error('不支持的操作');
    } catch (error) {
      console.error(`读取操作失败: ${error.message}`);
      return '';
    }
  }
}

/**
 * 重试管理器
 */
class RetryManager {
  constructor(maxRetries = 3, delay = 1000) {
    this.maxRetries = maxRetries;
    this.delay = delay;
  }

  /**
   * 重试操作
   * @param {Function} operation - 要重试的操作
   * @returns {Promise<any>} - 操作结果
   */
  async retry(operation) {
    let lastError;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        await new Promise(resolve => setTimeout(resolve, this.delay));
      }
    }
    throw lastError;
  }
}

/**
 * 速率限制器
 */
class RateLimiter {
  constructor(limit = 5, interval = 1000) {
    this.limit = limit;
    this.interval = interval;
    this.tokens = limit;
    this.lastRefill = Date.now();
  }

  /**
   * 检查是否超出限制
   * @returns {Promise<boolean>} - 是否允许操作
   */
  async checkLimit() {
    this.refillTokens();
    if (this.tokens <= 0) {
      throw new Error('操作过于频繁，请稍后再试');
    }
    this.tokens--;
    return true;
  }

  /**
   * 重新填充令牌
   */
  refillTokens() {
    const now = Date.now();
    const timePassed = now - this.lastRefill;
    const refillAmount = Math.floor(timePassed / this.interval) * this.limit;
    this.tokens = Math.min(this.limit, this.tokens + refillAmount);
    this.lastRefill = now;
  }
}

/**
 * 增强版剪贴板管理器，带安全和性能优化
 */
class EnhancedClipboardManager extends ClipboardManager {
  constructor() {
    super();
    this.retryManager = new RetryManager();
    this.rateLimiter = new RateLimiter();
    this.history = new Map();
    this.maxHistorySize = 50;
    this.maxContentSize = 1024 * 1024; // 1MB
  }

  /**
   * 初始化
   */
  async init() {
    if (this.initialized) return true;
    
    await super.init();
    this.loadHistory();
    
    return true;
  }

  /**
   * 设置事件监听器
   */
  setupEventListeners() {
    if (typeof document !== 'undefined') {
      document.addEventListener('paste', this.handlePaste.bind(this));
      window.addEventListener('beforeunload', () => this.persistHistory());
    }
  }

  /**
   * 验证内容
   * @param {string} content - 要验证的内容 
   * @param {string} type - 内容类型
   * @returns {string} - 处理后的内容
   */
  validateContent(content, type = 'text/plain') {
    if (!content) {
      throw new Error('内容不能为空');
    }

    if (content.length > this.maxContentSize) {
      throw new Error('内容大小超出限制');
    }

    // 内容类型验证
    const allowedTypes = ['text/plain', 'text/html'];
    if (!allowedTypes.includes(type)) {
      throw new Error('不支持的内容类型');
    }

    // HTML内容的XSS保护
    if (type === 'text/html') {
      content = content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    }

    return content;
  }

  /**
   * 处理粘贴事件
   */
  async handlePaste(event) {
    try {
      await this.rateLimiter.checkLimit();
      
      const clipboardData = event.clipboardData || window.clipboardData;
      if (!clipboardData) return null;
      
      const content = clipboardData.getData('text/plain');
      
      try {
        const validatedContent = this.validateContent(content);
        await this.addToHistory(validatedContent);
        return validatedContent;
      } catch (error) {
        this.handleError(error);
        return null;
      }
    } catch (error) {
      console.error('粘贴操作失败:', error);
      this.handleError(error);
      return null;
    }
  }

  /**
   * 复制到剪贴板
   */
  async copyToClipboard(text) {
    return this.retryManager.retry(async () => {
      await this.rateLimiter.checkLimit();
      
      try {
        const validatedContent = this.validateContent(text);
        
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(validatedContent);
        } else {
          // 回退机制
          const textarea = document.createElement('textarea');
          textarea.value = validatedContent;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          
          const success = document.execCommand('copy');
          document.body.removeChild(textarea);
          
          if (!success) {
            throw new Error('复制失败');
          }
        }
        
        await this.addToHistory(validatedContent);
        return true;
      } catch (error) {
        this.handleError(error);
        throw error;
      }
    });
  }

  /**
   * 添加到历史记录
   */
  async addToHistory(content) {
    const timestamp = Date.now();
    this.history.set(timestamp, content);
    
    // 维持历史记录大小限制
    if (this.history.size > this.maxHistorySize) {
      const oldestKey = Array.from(this.history.keys())[0];
      this.history.delete(oldestKey);
    }
    
    // 持久化到localStorage
    this.persistHistory();
  }

  /**
   * 持久化历史记录
   */
  persistHistory() {
    try {
      const historyArray = Array.from(this.history.entries());
      localStorage.setItem('easyssh_clipboard_history', JSON.stringify(historyArray));
    } catch (error) {
      console.error('持久化历史记录失败:', error);
    }
  }

  /**
   * 加载历史记录
   */
  loadHistory() {
    try {
      const savedHistory = localStorage.getItem('easyssh_clipboard_history');
      if (savedHistory) {
        this.history = new Map(JSON.parse(savedHistory));
      }
    } catch (error) {
      console.error('加载历史记录失败:', error);
    }
  }

  /**
   * 处理错误
   */
  handleError(error) {
    // 记录错误
    console.error('剪贴板操作错误:', error);
    
    // 通知用户
    if (error.message === '操作过于频繁，请稍后再试') {
      console.warn('剪贴板操作过于频繁，请稍后再试');
    } else if (error.message === '内容大小超出限制') {
      console.warn('内容过大，无法复制');
    }
  }

  /**
   * 清除历史记录
   */
  clearHistory() {
    this.history.clear();
    localStorage.removeItem('easyssh_clipboard_history');
  }
  
  /**
   * 兼容terminal.js的复制方法
   */
  async copyText(text, options = {}) {
    try {
      return await this.copyToClipboard(text);
    } catch (error) {
      console.error('复制文本失败:', error);
      return false;
    }
  }
  
  /**
   * 兼容terminal.js的读取方法
   */
  async readText() {
    try {
      await this.rateLimiter.checkLimit();
      if (navigator.clipboard) {
        return await navigator.clipboard.readText();
      } else {
        throw new Error('不支持的操作');
      }
    } catch (error) {
      console.error(`读取操作失败: ${error.message}`);
      this.handleError(error);
      return '';
    }
  }

  /**
   * 在终端中执行粘贴操作
   * @param {HTMLElement} targetElement - 要粘贴到的目标元素
   * @returns {Promise<boolean>} - 粘贴操作是否成功
   */
  async pasteToTerminal(targetElement) {
    try {
      const text = await this.readText();
      if (text) {
        // 派发自定义事件，让终端组件处理粘贴
        if (targetElement) {
          const pasteEvent = new CustomEvent('terminal-paste', {
            detail: { text },
            bubbles: true
          });
          targetElement.dispatchEvent(pasteEvent);
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error('终端粘贴失败:', error);
      return false;
    }
  }
}

// 创建实例
const clipboardManager = new ClipboardManager();

// 创建增强版实例
export const enhancedClipboardManager = new EnhancedClipboardManager();

// 添加到window全局对象（用于调试）
if (typeof window !== 'undefined') {
  window.clipboardManager = clipboardManager;
}

// 默认导出基础版本
export default clipboardManager;
