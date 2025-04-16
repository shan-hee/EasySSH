/**
 * 事件发射器模块
 * 提供基本的事件注册、移除和触发功能
 */

/**
 * 事件发射器类
 * 实现基本的发布-订阅模式
 */
export class EventEmitter {
  /**
   * 构造函数
   */
  constructor() {
    // 事件侦听器映射表 { eventName: [listeners] }
    this._events = new Map();
    
    // 只触发一次的事件侦听器映射表 { eventName: [listeners] }
    this._onceEvents = new Map();
    
    // 最大侦听器数量
    this._maxListeners = 10;
  }
  
  /**
   * 设置最大侦听器数量
   * @param {number} n 最大数量
   * @returns {EventEmitter} 当前实例
   */
  setMaxListeners(n) {
    this._maxListeners = n;
    return this;
  }
  
  /**
   * 获取最大侦听器数量
   * @returns {number} 最大数量
   */
  getMaxListeners() {
    return this._maxListeners;
  }
  
  /**
   * 获取事件名称列表
   * @returns {Array<string>} 事件名称列表
   */
  eventNames() {
    const names = new Set([
      ...this._events.keys(),
      ...this._onceEvents.keys()
    ]);
    return Array.from(names);
  }
  
  /**
   * 获取特定事件的所有侦听器
   * @param {string} eventName 事件名称
   * @returns {Array<Function>} 侦听器列表
   */
  listeners(eventName) {
    const events = (this._events.get(eventName) || []).slice();
    const onceEvents = (this._onceEvents.get(eventName) || []).slice();
    return [...events, ...onceEvents];
  }
  
  /**
   * 获取特定事件的侦听器数量
   * @param {string} eventName 事件名称
   * @returns {number} 侦听器数量
   */
  listenerCount(eventName) {
    const events = this._events.get(eventName) || [];
    const onceEvents = this._onceEvents.get(eventName) || [];
    return events.length + onceEvents.length;
  }
  
  /**
   * 添加事件侦听器
   * @param {string} eventName 事件名称
   * @param {Function} listener 侦听器函数
   * @returns {EventEmitter} 当前实例
   */
  on(eventName, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('侦听器必须是函数');
    }
    
    // 获取当前事件的侦听器列表
    if (!this._events.has(eventName)) {
      this._events.set(eventName, []);
    }
    
    const listeners = this._events.get(eventName);
    
    // 检查是否超过最大侦听器数量
    if (this._maxListeners > 0 && listeners.length >= this._maxListeners) {
      console.warn(
        `事件 "${eventName}" 的侦听器数量已超过最大值 ${this._maxListeners}，` +
        '这可能是内存泄漏的征兆。'
      );
    }
    
    // 添加侦听器
    listeners.push(listener);
    
    // 触发newListener事件
    if (eventName !== 'newListener') {
      this.emit('newListener', eventName, listener);
    }
    
    return this;
  }
  
  /**
   * 添加只执行一次的事件侦听器
   * @param {string} eventName 事件名称
   * @param {Function} listener 侦听器函数
   * @returns {EventEmitter} 当前实例
   */
  once(eventName, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('侦听器必须是函数');
    }
    
    // 获取当前事件的one-time侦听器列表
    if (!this._onceEvents.has(eventName)) {
      this._onceEvents.set(eventName, []);
    }
    
    const listeners = this._onceEvents.get(eventName);
    
    // 检查是否超过最大侦听器数量
    const totalCount = this.listenerCount(eventName);
    if (this._maxListeners > 0 && totalCount >= this._maxListeners) {
      console.warn(
        `事件 "${eventName}" 的侦听器数量已超过最大值 ${this._maxListeners}，` +
        '这可能是内存泄漏的征兆。'
      );
    }
    
    // 添加侦听器
    listeners.push(listener);
    
    // 触发newListener事件
    if (eventName !== 'newListener') {
      this.emit('newListener', eventName, listener);
    }
    
    return this;
  }
  
  /**
   * 移除事件侦听器
   * @param {string} eventName 事件名称
   * @param {Function} listener 侦听器函数
   * @returns {EventEmitter} 当前实例
   */
  off(eventName, listener) {
    return this.removeListener(eventName, listener);
  }
  
  /**
   * 移除事件侦听器
   * @param {string} eventName 事件名称
   * @param {Function} listener 侦听器函数
   * @returns {EventEmitter} 当前实例
   */
  removeListener(eventName, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('侦听器必须是函数');
    }
    
    // 从普通事件中移除
    if (this._events.has(eventName)) {
      const listeners = this._events.get(eventName);
      const index = listeners.indexOf(listener);
      
      if (index !== -1) {
        listeners.splice(index, 1);
        
        // 如果侦听器列表为空，移除事件
        if (listeners.length === 0) {
          this._events.delete(eventName);
        }
        
        // 触发removeListener事件
        if (eventName !== 'removeListener') {
          this.emit('removeListener', eventName, listener);
        }
      }
    }
    
    // 从one-time事件中移除
    if (this._onceEvents.has(eventName)) {
      const listeners = this._onceEvents.get(eventName);
      const index = listeners.indexOf(listener);
      
      if (index !== -1) {
        listeners.splice(index, 1);
        
        // 如果侦听器列表为空，移除事件
        if (listeners.length === 0) {
          this._onceEvents.delete(eventName);
        }
        
        // 触发removeListener事件
        if (eventName !== 'removeListener') {
          this.emit('removeListener', eventName, listener);
        }
      }
    }
    
    return this;
  }
  
  /**
   * 移除指定事件的所有侦听器
   * @param {string} [eventName] 事件名称，如果不提供则移除所有事件的所有侦听器
   * @returns {EventEmitter} 当前实例
   */
  removeAllListeners(eventName) {
    // 移除特定事件的所有侦听器
    if (eventName) {
      if (eventName !== 'removeListener') {
        // 处理普通事件
        if (this._events.has(eventName)) {
          const listeners = this._events.get(eventName);
          
          // 触发removeListener事件
          for (const listener of listeners) {
            this.emit('removeListener', eventName, listener);
          }
          
          this._events.delete(eventName);
        }
        
        // 处理once事件
        if (this._onceEvents.has(eventName)) {
          const listeners = this._onceEvents.get(eventName);
          
          // 触发removeListener事件
          for (const listener of listeners) {
            this.emit('removeListener', eventName, listener);
          }
          
          this._onceEvents.delete(eventName);
        }
      } else {
        // 直接移除removeListener事件
        this._events.delete(eventName);
        this._onceEvents.delete(eventName);
      }
    } 
    // 移除所有事件的所有侦听器
    else {
      // 保存removeListener事件的侦听器
      const removeListeners = this.listeners('removeListener');
      
      // 清空所有事件
      this._events.clear();
      this._onceEvents.clear();
      
      // 恢复removeListener事件的侦听器
      if (removeListeners.length > 0) {
        this._events.set('removeListener', removeListeners);
      }
    }
    
    return this;
  }
  
  /**
   * 触发事件
   * @param {string} eventName 事件名称
   * @param {...any} args 传递给侦听器的参数
   * @returns {boolean} 如果有侦听器处理了事件则返回true，否则返回false
   */
  emit(eventName, ...args) {
    let hasListeners = false;
    
    // 处理普通事件侦听器
    if (this._events.has(eventName)) {
      const listeners = this._events.get(eventName).slice();
      hasListeners = listeners.length > 0;
      
      for (const listener of listeners) {
        try {
          listener.apply(this, args);
        } catch (error) {
          console.error(`事件 "${eventName}" 的侦听器执行出错:`, error);
          this.emit('error', error, eventName, args);
        }
      }
    }
    
    // 处理一次性事件侦听器
    if (this._onceEvents.has(eventName)) {
      const listeners = this._onceEvents.get(eventName).slice();
      hasListeners = hasListeners || listeners.length > 0;
      
      // 清空一次性事件侦听器
      this._onceEvents.delete(eventName);
      
      for (const listener of listeners) {
        try {
          listener.apply(this, args);
        } catch (error) {
          console.error(`事件 "${eventName}" 的一次性侦听器执行出错:`, error);
          this.emit('error', error, eventName, args);
        }
      }
    }
    
    // 处理通配符事件 '*'
    if (eventName !== '*' && (this._events.has('*') || this._onceEvents.has('*'))) {
      this.emit('*', eventName, ...args);
    }
    
    return hasListeners;
  }
  
  /**
   * 添加事件侦听器（on的别名）
   * @param {string} eventName 事件名称
   * @param {Function} listener 侦听器函数
   * @returns {EventEmitter} 当前实例
   */
  addListener(eventName, listener) {
    return this.on(eventName, listener);
  }
  
  /**
   * 预置侦听器列表
   * @param {Object} mapping 事件映射 { eventName: listener }
   * @returns {EventEmitter} 当前实例
   */
  configure(mapping) {
    for (const [eventName, listener] of Object.entries(mapping)) {
      if (typeof listener === 'function') {
        this.on(eventName, listener);
      } else if (Array.isArray(listener)) {
        for (const fn of listener) {
          if (typeof fn === 'function') {
            this.on(eventName, fn);
          }
        }
      }
    }
    
    return this;
  }
  
  /**
   * 等待事件触发
   * @param {string} eventName 事件名称
   * @param {Object} [options] 选项
   * @param {number} [options.timeout] 超时时间（毫秒）
   * @param {Function} [options.filter] 过滤函数，返回true表示接受事件
   * @returns {Promise<Array>} 包含事件参数的数组
   */
  waitFor(eventName, options = {}) {
    const { timeout, filter } = options;
    
    return new Promise((resolve, reject) => {
      let timeoutId = null;
      
      // 创建事件处理函数
      const handler = (...args) => {
        // 如果有过滤函数，且过滤结果为false，则继续等待
        if (filter && !filter(...args)) {
          return;
        }
        
        // 清除超时计时器
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
        
        // 移除事件侦听器
        this.off(eventName, handler);
        
        // 解析Promise
        resolve(args);
      };
      
      // 添加一次性事件处理
      this.on(eventName, handler);
      
      // 设置超时
      if (timeout) {
        timeoutId = setTimeout(() => {
          this.off(eventName, handler);
          reject(new Error(`等待事件 "${eventName}" 超时`));
        }, timeout);
      }
    });
  }
}

// 默认事件发射器实例
const defaultEmitter = new EventEmitter();

export default defaultEmitter; 