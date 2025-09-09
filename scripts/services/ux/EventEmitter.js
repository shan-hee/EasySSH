/**
 * 简单的事件发射器实现
 * 用于键盘管理器和无障碍服务
 */
export class EventEmitter {
  constructor() {
    this._events = {};
  }

  /**
   * 添加事件监听器
   * @param {string} event 事件名称
   * @param {Function} listener 监听器函数
   */
  on(event, listener) {
    if (!this._events[event]) {
      this._events[event] = [];
    }
    this._events[event].push(listener);
    return this;
  }

  /**
   * 添加一次性事件监听器
   * @param {string} event 事件名称
   * @param {Function} listener 监听器函数
   */
  once(event, listener) {
    const onceWrapper = (...args) => {
      this.off(event, onceWrapper);
      listener.apply(this, args);
    };
    this.on(event, onceWrapper);
    return this;
  }

  /**
   * 移除事件监听器
   * @param {string} event 事件名称
   * @param {Function} listener 监听器函数
   */
  off(event, listener) {
    if (!this._events[event]) return this;

    if (!listener) {
      // 如果没有指定监听器，移除所有监听器
      delete this._events[event];
    } else {
      const index = this._events[event].indexOf(listener);
      if (index !== -1) {
        this._events[event].splice(index, 1);
      }

      // 如果没有监听器了，删除事件
      if (this._events[event].length === 0) {
        delete this._events[event];
      }
    }

    return this;
  }

  /**
   * 发射事件
   * @param {string} event 事件名称
   * @param {...any} args 传递给监听器的参数
   */
  emit(event, ...args) {
    if (!this._events[event]) return false;

    // 复制监听器数组，避免在执行过程中被修改
    const listeners = [...this._events[event]];

    for (const listener of listeners) {
      try {
        listener.apply(this, args);
      } catch (error) {
        console.error(`Error in event listener for "${event}":`, error);
      }
    }

    return true;
  }

  /**
   * 获取事件的监听器数量
   * @param {string} event 事件名称
   * @returns {number} 监听器数量
   */
  listenerCount(event) {
    return this._events[event] ? this._events[event].length : 0;
  }

  /**
   * 获取所有事件名称
   * @returns {string[]} 事件名称数组
   */
  eventNames() {
    return Object.keys(this._events);
  }

  /**
   * 移除所有监听器
   */
  removeAllListeners(event) {
    if (event) {
      delete this._events[event];
    } else {
      this._events = {};
    }
    return this;
  }
}

export default EventEmitter;
