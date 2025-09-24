/**
 * 智能防抖工具
 * 支持动态延迟、优先级队列和智能取消
 */

export class SmartDebounce {
  constructor(options = {}) {
    this.defaultDelay = options.defaultDelay || 300;
    this.minDelay = options.minDelay || 0;
    this.maxDelay = options.maxDelay || 1000;
    this.enablePriority = options.enablePriority !== false;
    this.enableAdaptive = options.enableAdaptive !== false;

    // 内部状态
    this.timers = new Map();
    this.priorities = new Map();
    this.executionHistory = new Map();
    this.adaptiveDelays = new Map();
  }

  /**
   * 创建防抖函数
   * @param {Function} fn - 要防抖的函数
   * @param {Object} options - 配置选项
   * @returns {Function} 防抖后的函数
   */
  create(fn, options = {}) {
    const key = options.key || fn.name || 'default';
    const delay = options.delay || this.defaultDelay;
    const priority = options.priority || 0;
    const immediate = options.immediate || false;
    const adaptive = options.adaptive !== false && this.enableAdaptive;

    return (...args) => {
      const now = Date.now();

      // 计算实际延迟
      const actualDelay = adaptive ? this.getAdaptiveDelay(key, delay) : delay;

      // 处理优先级
      if (this.enablePriority && this.shouldPreempt(key, priority)) {
        this.cancelExisting(key);
      }

      // 清除现有定时器
      if (this.timers.has(key)) {
        clearTimeout(this.timers.get(key));
      }

      // 记录优先级
      this.priorities.set(key, priority);

      // 立即执行模式
      if (immediate && !this.timers.has(key)) {
        this.execute(fn, args, key, now);
        return;
      }

      // 设置新的定时器
      const timer = setTimeout(() => {
        this.execute(fn, args, key, now);
      }, actualDelay);

      this.timers.set(key, timer);
    };
  }

  /**
   * 执行函数并记录统计信息
   */
  execute(fn, args, key, startTime) {
    try {
      const result = fn.apply(null, args);

      // 记录执行历史
      const executionTime = Date.now() - startTime;
      this.recordExecution(key, executionTime);

      // 清理
      this.timers.delete(key);
      this.priorities.delete(key);

      return result;
    } catch (error) {
      import('@/services/log').then(m => m.default.error('SmartDebounce execution error', error));
      this.timers.delete(key);
      this.priorities.delete(key);
      throw error;
    }
  }

  /**
   * 记录执行历史用于自适应调整
   */
  recordExecution(key, executionTime) {
    if (!this.executionHistory.has(key)) {
      this.executionHistory.set(key, []);
    }

    const history = this.executionHistory.get(key);
    history.push({
      timestamp: Date.now(),
      executionTime
    });

    // 保持历史记录在合理范围内
    if (history.length > 10) {
      history.shift();
    }

    // 更新自适应延迟
    this.updateAdaptiveDelay(key);
  }

  /**
   * 计算自适应延迟
   */
  getAdaptiveDelay(key, baseDelay) {
    if (!this.adaptiveDelays.has(key)) {
      return baseDelay;
    }

    const adaptiveDelay = this.adaptiveDelays.get(key);
    return Math.max(this.minDelay, Math.min(this.maxDelay, adaptiveDelay));
  }

  /**
   * 更新自适应延迟
   */
  updateAdaptiveDelay(key) {
    const history = this.executionHistory.get(key);
    if (!history || history.length < 3) return;

    // 计算平均执行时间
    const avgExecutionTime =
      history.reduce((sum, record) => sum + record.executionTime, 0) / history.length;

    // 计算调用频率
    const timeSpan = history[history.length - 1].timestamp - history[0].timestamp;
    const frequency = history.length / (timeSpan / 1000); // 每秒调用次数

    // 自适应调整策略 - 优化版本
    let adaptiveDelay = this.defaultDelay;

    // 如果执行时间长，适度增加延迟
    if (avgExecutionTime > 100) {
      adaptiveDelay *= 1.3; // 降低倍数
    }

    // 如果调用频率高，适度增加延迟；频率低时更积极地减少延迟
    if (frequency > 8) {
      // 提高阈值
      adaptiveDelay *= 1.1; // 降低倍数
    } else if (frequency < 2) {
      // 提高阈值
      adaptiveDelay *= 0.7; // 更积极地减少延迟
    }

    this.adaptiveDelays.set(key, adaptiveDelay);
  }

  /**
   * 检查是否应该抢占现有任务
   */
  shouldPreempt(key, newPriority) {
    if (!this.timers.has(key)) return false;

    const currentPriority = this.priorities.get(key) || 0;
    return newPriority > currentPriority;
  }

  /**
   * 取消现有的防抖任务
   */
  cancelExisting(key) {
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
      this.priorities.delete(key);
    }
  }

  /**
   * 取消所有防抖任务
   */
  cancelAll() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.priorities.clear();
  }

  /**
   * 立即执行指定的防抖任务
   */
  flush(key) {
    if (this.timers.has(key)) {
      const timer = this.timers.get(key);
      clearTimeout(timer);
      // 这里需要保存原始函数和参数才能立即执行
      // 在实际使用中，可以通过闭包或其他方式实现
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      activeTasks: this.timers.size,
      totalKeys: this.executionHistory.size,
      adaptiveDelays: Object.fromEntries(this.adaptiveDelays),
      executionHistory: Object.fromEntries(
        Array.from(this.executionHistory.entries()).map(([key, history]) => [
          key,
          {
            count: history.length,
            avgExecutionTime: history.reduce((sum, r) => sum + r.executionTime, 0) / history.length
          }
        ])
      )
    };
  }

  /**
   * 清理资源
   */
  destroy() {
    this.cancelAll();
    this.executionHistory.clear();
    this.adaptiveDelays.clear();
  }
}

// 创建默认实例
export const smartDebounce = new SmartDebounce();

// 便捷函数
export function createSmartDebounce(fn, options = {}) {
  return smartDebounce.create(fn, options);
}

export default SmartDebounce;
