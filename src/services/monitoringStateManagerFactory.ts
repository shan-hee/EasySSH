/**
 * 监控状态管理器工厂
 * 管理多个监控状态管理器实例，为每个终端提供独立的状态管理
 */

import { MonitoringStateManager } from './monitoringStateManager';
import log from '@/services/log';
import { EVENTS } from '@/services/events';

class MonitoringStateManagerFactory {
  private instances: Map<string, MonitoringStateManager>;
  private instanceCreationTime: Map<string, number>;
  private instanceLastActivity: Map<string, number>;
  private cleanupTimer: number | null;
  private _terminalDestroyHandler?: (event: Event) => void;
  private config: { maxIdleTime: number; cleanupInterval: number; maxInstances: number };

  constructor() {
    // 终端ID到状态管理器实例的映射
    this.instances = new Map();

    // 实例创建时间记录（用于清理策略）
    this.instanceCreationTime = new Map();

    // 实例最后活动时间记录
    this.instanceLastActivity = new Map();

    // 清理定时器
    this.cleanupTimer = null;

    // 配置参数
    this.config = {
      // 实例最大空闲时间（毫秒）- 30分钟
      maxIdleTime: 30 * 60 * 1000,
      // 清理检查间隔（毫秒）- 5分钟
      cleanupInterval: 5 * 60 * 1000,
      // 最大实例数量
      maxInstances: 50
    };

    // 启动清理定时器
    this._startCleanupTimer();

    // 监听终端销毁事件，立即清理对应的监控状态管理器实例
    this._setupTerminalDestroyListener();

    log.debug('[监控状态管理器工厂] 已初始化');
  }

  /**
   * 设置终端销毁事件监听器
   * @private
   */
  _setupTerminalDestroyListener(): void {
    const terminalDestroyHandler = (event: Event) => {
      const { terminalId } = (event as CustomEvent<any>).detail || {};
      if (terminalId && this.hasInstance(terminalId)) {
        log.info(`[监控状态管理器工厂] 响应终端销毁事件，立即清理实例: ${terminalId}`);
        this.destroyInstance(terminalId);
      }
    };

    window.addEventListener(EVENTS.TERMINAL_DESTROYED, terminalDestroyHandler);
    
    // 保存事件监听器引用，便于清理时移除
    this._terminalDestroyHandler = terminalDestroyHandler;
  }

  /**
   * 获取或创建指定终端的状态管理器实例
   * @param {string} terminalId - 终端ID
   * @param {string} hostId - 主机ID（可选）
   * @returns {MonitoringStateManager} 状态管理器实例
   */
  getInstance(terminalId: string, hostId: string | null = null): MonitoringStateManager | null {
    if (!terminalId) {
      log.warn('[监控状态管理器工厂] 终端ID不能为空');
      return null;
    }

    // 检查是否已存在实例
    if (this.instances.has(terminalId)) {
      const instance = this.instances.get(terminalId);
      // 更新最后活动时间
      this._updateLastActivity(terminalId);
      log.debug(`[监控状态管理器工厂] 返回现有实例: ${terminalId}`);
      return (instance as MonitoringStateManager) || null;
    }

    // 检查实例数量限制
    if (this.instances.size >= this.config.maxInstances) {
      log.warn(
        `[监控状态管理器工厂] 实例数量已达上限 (${this.config.maxInstances})，尝试清理旧实例`
      );
      this._forceCleanupOldInstances();

      // 如果清理后仍然超限，拒绝创建新实例
      if (this.instances.size >= this.config.maxInstances) {
        log.error('[监控状态管理器工厂] 无法创建新实例，实例数量超限');
        return null;
      }
    }

    // 创建新实例
    const instance = new (MonitoringStateManager as any)();

    // 如果提供了hostId，设置终端和主机信息
    if (hostId) {
      (instance as any).bindTerminal(terminalId, hostId);
    }

    // 存储实例和相关信息
    this.instances.set(terminalId, instance);
    this.instanceCreationTime.set(terminalId, Date.now());
    this._updateLastActivity(terminalId);

    log.info(`[监控状态管理器工厂] 创建新实例: ${terminalId}${hostId ? ` (主机: ${hostId})` : ''}`);

    return instance;
  }

  /**
   * 销毁指定终端的状态管理器实例
   * @param {string} terminalId - 终端ID
   * @returns {boolean} 是否成功销毁
   */
  destroyInstance(terminalId: string): boolean {
    if (!terminalId) {
      return false;
    }

    const instance = this.instances.get(terminalId);
    if (!instance) {
      log.debug(`[监控状态管理器工厂] 实例不存在，无需销毁: ${terminalId}`);
      return false;
    }

    try {
      // 调用实例的清理方法
      if (typeof (instance as any).destroy === 'function') {
        (instance as any).destroy();
      }

      // 从映射中移除
      this.instances.delete(terminalId);
      this.instanceCreationTime.delete(terminalId);
      this.instanceLastActivity.delete(terminalId);

      log.info(`[监控状态管理器工厂] 已销毁实例: ${terminalId}`);
      return true;
    } catch (error) {
      log.error(`[监控状态管理器工厂] 销毁实例失败: ${terminalId}`, error);
      return false;
    }
  }

  /**
   * 检查指定终端是否有状态管理器实例
   * @param {string} terminalId - 终端ID
   * @returns {boolean} 是否存在实例
   */
  hasInstance(terminalId: string): boolean {
    return this.instances.has(terminalId);
  }

  /**
   * 获取所有活动的终端ID列表
   * @returns {string[]} 终端ID列表
   */
  getActiveTerminalIds(): string[] {
    return Array.from(this.instances.keys());
  }

  /**
   * 获取实例统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    const now = Date.now();
    const stats: { totalInstances: number; maxInstances: number; instances: Array<{ terminalId: string; age: number; idleTime: number; connected: boolean }> } = {
      totalInstances: this.instances.size,
      maxInstances: this.config.maxInstances,
      instances: []
    };

    for (const [terminalId, instance] of this.instances) {
      const creationTime = this.instanceCreationTime.get(terminalId) ?? Date.now();
      const lastActivity = this.instanceLastActivity.get(terminalId) ?? Date.now();

      stats.instances.push({
        terminalId,
        age: now - creationTime,
        idleTime: now - lastActivity,
        connected: (instance as any).globalState?.connectionState === 'loaded'
      });
    }

    return stats;
  }

  /**
   * 更新指定终端的最后活动时间
   * @param {string} terminalId - 终端ID
   * @private
   */
  _updateLastActivity(terminalId: string): void {
    this.instanceLastActivity.set(terminalId, Date.now());
  }

  /**
   * 启动清理定时器
   * @private
   */
  _startCleanupTimer(): void {
    if (this.cleanupTimer) {
      window.clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = window.setInterval(() => {
      this._cleanupIdleInstances();
    }, this.config.cleanupInterval);

    log.debug('[监控状态管理器工厂] 清理定时器已启动');
  }

  /**
   * 清理空闲的实例
   * @private
   */
  _cleanupIdleInstances(): void {
    const now = Date.now();
    const toDestroy: string[] = [];

    for (const [terminalId, lastActivity] of this.instanceLastActivity) {
      const idleTime = now - lastActivity;
      if (idleTime > this.config.maxIdleTime) {
        toDestroy.push(terminalId);
      }
    }

    if (toDestroy.length > 0) {
      log.info(`[监控状态管理器工厂] 清理 ${toDestroy.length} 个空闲实例`);
      toDestroy.forEach(terminalId => this.destroyInstance(terminalId));
    }
  }

  /**
   * 强制清理最旧的实例
   * @private
   */
  _forceCleanupOldInstances(): void {
    const instances = Array.from(this.instanceCreationTime.entries())
      .sort((a, b) => a[1] - b[1]) // 按创建时间排序
      .slice(0, Math.floor(this.config.maxInstances * 0.2)); // 清理最旧的20%

    instances.forEach(([terminalId]) => {
      log.info(`[监控状态管理器工厂] 强制清理旧实例: ${terminalId}`);
      this.destroyInstance(terminalId);
    });
  }

  /**
   * 销毁工厂和所有实例
   */
  destroy(): void {
    // 停止清理定时器
    if (this.cleanupTimer) {
      window.clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // 移除终端销毁事件监听器
    if (this._terminalDestroyHandler) {
      window.removeEventListener(EVENTS.TERMINAL_DESTROYED, this._terminalDestroyHandler);
      this._terminalDestroyHandler = undefined;
    }

    // 销毁所有实例
    const terminalIds = Array.from(this.instances.keys());
    terminalIds.forEach(terminalId => this.destroyInstance(terminalId));

    log.info('[监控状态管理器工厂] 已销毁工厂和所有实例');
  }
}

// 创建全局工厂实例
const monitoringStateManagerFactory = new MonitoringStateManagerFactory();

// 页面卸载时清理
window.addEventListener('beforeunload', () => {
  monitoringStateManagerFactory.destroy();
});

export default monitoringStateManagerFactory;
