/**
 * 加载状态服务
 * 管理全局和局部加载状态
 */

import { EventEmitter } from './EventEmitter.js';

/**
 * 加载状态服务类
 */
export class LoadingService extends EventEmitter {
  /**
   * 构造函数
   */
  constructor() {
    super();
    
    // 全局加载状态
    this.isGlobalLoading = false;
    
    // 全局加载计数器(处理嵌套加载请求)
    this.globalCounter = 0;
    
    // 区域加载状态 { key: count }
    this.regionalLoading = new Map();
    
    // 加载状态分组 { groupId: Set<loadingId> }
    this.loadingGroups = new Map();
    
    // 加载任务记录 { id: { start, message, area, group, timeout } }
    this.loadingTasks = new Map();
    
    // 任务ID计数器
    this.idCounter = 0;
  }
  
  /**
   * 生成唯一加载ID
   * @returns {string} 加载ID
   * @private
   */
  _generateId() {
    return `loading-${Date.now()}-${++this.idCounter}`;
  }
  
  /**
   * 检查区域是否正在加载
   * @param {string} area 区域标识
   * @returns {boolean} 是否正在加载
   */
  isAreaLoading(area) {
    return this.regionalLoading.has(area) && this.regionalLoading.get(area) > 0;
  }
  
  /**
   * 检查分组是否正在加载
   * @param {string} groupId 分组ID
   * @returns {boolean} 是否正在加载
   */
  isGroupLoading(groupId) {
    return this.loadingGroups.has(groupId) && this.loadingGroups.get(groupId).size > 0;
  }
  
  /**
   * 获取全局加载状态
   * @returns {boolean} 是否正在全局加载
   */
  isLoading() {
    return this.isGlobalLoading;
  }
  
  /**
   * 启动加载状态
   * @param {Object} options 选项
   * @param {string} [options.message] 加载消息
   * @param {string} [options.area] 区域标识，不提供则为全局
   * @param {string} [options.group] 分组标识
   * @param {number} [options.delay=0] 显示延迟(毫秒)，避免闪烁
   * @param {number} [options.timeout=0] 超时时间(毫秒)，0表示无超时
   * @returns {string} 加载ID，用于停止特定加载
   */
  start(options = {}) {
    const { 
      message = '加载中...', 
      area = null, 
      group = null,
      delay = 0,
      timeout = 0
    } = options;
    
    // 生成加载ID
    const id = this._generateId();
    
    // 记录加载任务
    const task = {
      id,
      start: Date.now(),
      message,
      area,
      group,
      visible: false,
      delayTimer: null,
      timeoutTimer: null
    };
    
    this.loadingTasks.set(id, task);
    
    // 设置显示延迟
    if (delay > 0) {
      task.delayTimer = setTimeout(() => {
        if (this.loadingTasks.has(id)) {
          task.visible = true;
          this._updateLoadingState(id, true);
        }
      }, delay);
    } else {
      task.visible = true;
      this._updateLoadingState(id, true);
    }
    
    // 设置超时
    if (timeout > 0) {
      task.timeoutTimer = setTimeout(() => {
        this.stop(id);
        this.emit('loading:timeout', { id, message, area, group });
      }, timeout);
    }
    
    return id;
  }
  
  /**
   * 停止加载状态
   * @param {string} id 加载ID
   * @returns {boolean} 是否成功停止
   */
  stop(id) {
    if (!this.loadingTasks.has(id)) {
      return false;
    }

    const task = this.loadingTasks.get(id);

    // 清除定时器
    if (task.delayTimer) {
      clearTimeout(task.delayTimer);
    }

    if (task.timeoutTimer) {
      clearTimeout(task.timeoutTimer);
    }

    // 更新加载状态
    if (task.visible) {
      this._updateLoadingState(id, false);
    }

    // 从任务记录中移除
    this.loadingTasks.delete(id);

    return true;
  }

  /**
   * 更新加载消息
   * @param {string} id 加载ID
   * @param {string} message 新的加载消息
   * @returns {boolean} 是否成功更新
   */
  updateMessage(id, message) {
    if (!this.loadingTasks.has(id)) {
      return false;
    }

    const task = this.loadingTasks.get(id);
    task.message = message;

    // 如果任务可见，触发更新事件
    if (task.visible) {
      if (!task.area) {
        // 全局加载状态更新
        this.emit('loading:global', true, message);
      } else {
        // 区域加载状态更新
        this.emit('loading:area', task.area, true, message);
      }

      if (task.group) {
        // 分组加载状态更新
        this.emit('loading:group', task.group, true, message);
      }

      // 触发单个加载状态变化事件
      this.emit('loading:change', id, true, task);
    }

    return true;
  }
  
  /**
   * 更新加载状态
   * @param {string} id 加载ID
   * @param {boolean} isStarting 是否开始加载
   * @private
   */
  _updateLoadingState(id, isStarting) {
    const task = this.loadingTasks.get(id);
    
    if (!task) {
      return;
    }
    
    // 更新全局状态
    if (!task.area) {
      if (isStarting) {
        this.globalCounter++;
        
        if (!this.isGlobalLoading && this.globalCounter > 0) {
          this.isGlobalLoading = true;
          this.emit('loading:global', true, task.message);
        }
      } else {
        this.globalCounter = Math.max(0, this.globalCounter - 1);
        
        if (this.isGlobalLoading && this.globalCounter === 0) {
          this.isGlobalLoading = false;
          this.emit('loading:global', false);
        }
      }
    }
    
    // 更新区域状态
    if (task.area) {
      if (isStarting) {
        const count = this.regionalLoading.get(task.area) || 0;
        this.regionalLoading.set(task.area, count + 1);
        
        if (count === 0) {
          this.emit('loading:area', task.area, true, task.message);
        }
      } else {
        const count = this.regionalLoading.get(task.area) || 0;
        this.regionalLoading.set(task.area, Math.max(0, count - 1));
        
        if (count === 1) {
          this.emit('loading:area', task.area, false);
        }
      }
    }
    
    // 更新分组状态
    if (task.group) {
      if (isStarting) {
        if (!this.loadingGroups.has(task.group)) {
          this.loadingGroups.set(task.group, new Set());
        }
        
        const group = this.loadingGroups.get(task.group);
        const wasEmpty = group.size === 0;
        
        group.add(id);
        
        if (wasEmpty) {
          this.emit('loading:group', task.group, true, task.message);
        }
      } else {
        if (this.loadingGroups.has(task.group)) {
          const group = this.loadingGroups.get(task.group);
          group.delete(id);
          
          if (group.size === 0) {
            this.emit('loading:group', task.group, false);
          }
        }
      }
    }
    
    // 触发单个加载状态变化事件
    this.emit('loading:change', id, isStarting, task);
  }
  
  /**
   * 启动全局加载
   * @param {string} message 加载消息
   * @param {Object} options 其他选项
   * @returns {string} 加载ID
   */
  startGlobal(message = '加载中...', options = {}) {
    return this.start({ message, ...options });
  }
  
  /**
   * 启动区域加载
   * @param {string} area 区域标识
   * @param {string} message 加载消息
   * @param {Object} options 其他选项
   * @returns {string} 加载ID
   */
  startArea(area, message = '加载中...', options = {}) {
    return this.start({ area, message, ...options });
  }
  
  /**
   * 停止区域所有加载
   * @param {string} area 区域标识
   */
  stopArea(area) {
    const tasks = Array.from(this.loadingTasks.values())
      .filter(task => task.area === area);
    
    for (const task of tasks) {
      this.stop(task.id);
    }
    
    // 确保区域计数器被重置
    this.regionalLoading.set(area, 0);
    this.emit('loading:area', area, false);
  }
  
  /**
   * 启动分组加载
   * @param {string} group 分组标识
   * @param {string} message 加载消息
   * @param {Object} options 其他选项
   * @returns {string} 加载ID
   */
  startGroup(group, message = '加载中...', options = {}) {
    return this.start({ group, message, ...options });
  }
  
  /**
   * 停止分组所有加载
   * @param {string} group 分组标识
   */
  stopGroup(group) {
    if (this.loadingGroups.has(group)) {
      const loadingIds = Array.from(this.loadingGroups.get(group));
      
      for (const id of loadingIds) {
        this.stop(id);
      }
      
      // 清除分组
      this.loadingGroups.delete(group);
      this.emit('loading:group', group, false);
    }
  }
  
  /**
   * 执行带加载状态的操作
   * @param {Function} fn 要执行的异步函数
   * @param {Object} options 加载选项
   * @returns {Promise<any>} 操作结果
   */
  async withLoading(fn, options = {}) {
    if (typeof fn !== 'function') {
      throw new Error('withLoading 需要一个函数参数');
    }
    
    const loadingId = this.start(options);
    
    try {
      const result = await fn();
      return result;
    } finally {
      this.stop(loadingId);
    }
  }
  
  /**
   * 停止所有加载状态
   */
  stopAll() {
    // 创建副本以避免迭代时修改
    const allTasks = Array.from(this.loadingTasks.keys());
    
    for (const id of allTasks) {
      this.stop(id);
    }
    
    // 重置全局状态
    this.globalCounter = 0;
    this.isGlobalLoading = false;
    this.emit('loading:global', false);
    
    // 重置区域状态
    for (const area of this.regionalLoading.keys()) {
      this.regionalLoading.set(area, 0);
      this.emit('loading:area', area, false);
    }
    
    // 重置分组状态
    for (const group of this.loadingGroups.keys()) {
      this.loadingGroups.delete(group);
      this.emit('loading:group', group, false);
    }
  }
  
  /**
   * 获取当前加载状态信息
   * @returns {Object} 加载状态信息
   */
  getStatus() {
    return {
      global: this.isGlobalLoading,
      areas: Object.fromEntries(
        Array.from(this.regionalLoading.entries())
          .map(([key, value]) => [key, value > 0])
      ),
      groups: Object.fromEntries(
        Array.from(this.loadingGroups.entries())
          .map(([key, value]) => [key, value.size > 0])
      ),
      taskCount: this.loadingTasks.size
    };
  }
  
  /**
   * 单例实例
   */
  static instance = null;
  
  /**
   * 获取服务实例
   * @returns {LoadingService} 加载服务实例
   */
  static getInstance() {
    if (!LoadingService.instance) {
      LoadingService.instance = new LoadingService();
    }
    return LoadingService.instance;
  }
}

// 导出默认实例
export default LoadingService.getInstance(); 