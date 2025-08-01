/**
 * 基础监控数据收集器
 * 提供统一的监控数据收集接口和通用功能
 * 
 * @author EasySSH Team
 * @version 2.0.0
 * @since 2025-08-01
 */

import { EventEmitter } from 'events';
import logger from '../../utils/logger.js';

/**
 * 监控数据收集器基类
 * 定义了所有监控收集器的通用接口和行为
 */
export class BaseMonitoringCollector extends EventEmitter {
  constructor(hostInfo, options = {}) {
    super();
    
    this.hostInfo = hostInfo;
    this.hostId = `${hostInfo.username}@${hostInfo.address}`;
    this.options = {
      collectInterval: 3000,
      timeout: 10000,
      retryAttempts: 3,
      enableCache: true,
      cacheTimeout: 30000,
      ...options
    };
    
    this.isCollecting = false;
    this.collectTimer = null;
    this.dataCache = new Map();
    this.lastCollectionTime = 0;
    this.collectionCount = 0;
    this.errorCount = 0;
    
    // 性能统计
    this.performanceStats = {
      totalCollections: 0,
      successfulCollections: 0,
      failedCollections: 0,
      averageCollectionTime: 0,
      lastCollectionDuration: 0
    };
  }

  /**
   * 开始数据收集
   */
  async startCollection() {
    if (this.isCollecting) {
      logger.warn('监控数据收集已在运行', { hostId: this.hostId });
      return;
    }

    try {
      await this.initialize();
      this.isCollecting = true;
      this.scheduleNextCollection();
      
      logger.info('监控数据收集已启动', { 
        hostId: this.hostId,
        interval: this.options.collectInterval
      });
      
      this.emit('started');
    } catch (error) {
      logger.error('启动监控数据收集失败', { 
        hostId: this.hostId, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * 停止数据收集
   */
  async stopCollection() {
    if (!this.isCollecting) {
      return;
    }

    this.isCollecting = false;
    
    if (this.collectTimer) {
      clearTimeout(this.collectTimer);
      this.collectTimer = null;
    }

    try {
      await this.cleanup();
      
      logger.info('监控数据收集已停止', { 
        hostId: this.hostId,
        stats: this.getPerformanceStats()
      });
      
      this.emit('stopped');
    } catch (error) {
      logger.error('停止监控数据收集失败', { 
        hostId: this.hostId, 
        error: error.message 
      });
    }
  }

  /**
   * 调度下一次数据收集
   */
  scheduleNextCollection() {
    if (!this.isCollecting) return;

    this.collectTimer = setTimeout(async () => {
      try {
        await this.performCollection();
      } catch (error) {
        this.handleCollectionError(error);
      } finally {
        this.scheduleNextCollection();
      }
    }, this.options.collectInterval);
  }

  /**
   * 执行数据收集
   */
  async performCollection() {
    const startTime = Date.now();
    this.performanceStats.totalCollections++;

    try {
      const systemInfo = await this.collectSystemInfo();
      
      if (systemInfo) {
        const duration = Date.now() - startTime;
        this.updatePerformanceStats(duration, true);
        
        this.emit('data', systemInfo);
        this.collectionCount++;
        this.lastCollectionTime = Date.now();
        
        logger.debug('监控数据收集成功', {
          hostId: this.hostId,
          duration,
          collectionCount: this.collectionCount
        });
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.updatePerformanceStats(duration, false);
      throw error;
    }
  }

  /**
   * 处理收集错误
   */
  handleCollectionError(error) {
    this.errorCount++;
    this.performanceStats.failedCollections++;
    
    logger.error('监控数据收集失败', {
      hostId: this.hostId,
      error: error.message,
      errorCount: this.errorCount,
      collectionCount: this.collectionCount
    });

    this.emit('error', error);

    // 如果错误率过高，暂停收集
    if (this.errorCount > 5 && this.errorCount / this.collectionCount > 0.5) {
      logger.warn('错误率过高，暂停监控数据收集', {
        hostId: this.hostId,
        errorRate: this.errorCount / this.collectionCount
      });
      this.stopCollection();
    }
  }

  /**
   * 更新性能统计
   */
  updatePerformanceStats(duration, success) {
    this.performanceStats.lastCollectionDuration = duration;
    
    if (success) {
      this.performanceStats.successfulCollections++;
    }
    
    // 计算平均收集时间
    const totalSuccessful = this.performanceStats.successfulCollections;
    if (totalSuccessful > 0) {
      this.performanceStats.averageCollectionTime = 
        (this.performanceStats.averageCollectionTime * (totalSuccessful - 1) + duration) / totalSuccessful;
    }
  }

  /**
   * 获取性能统计信息
   */
  getPerformanceStats() {
    return {
      ...this.performanceStats,
      successRate: this.performanceStats.totalCollections > 0 
        ? this.performanceStats.successfulCollections / this.performanceStats.totalCollections 
        : 0,
      errorRate: this.collectionCount > 0 ? this.errorCount / this.collectionCount : 0,
      uptime: Date.now() - this.lastCollectionTime
    };
  }

  /**
   * 缓存数据
   */
  setCacheData(key, data, ttl = this.options.cacheTimeout) {
    if (!this.options.enableCache) return;
    
    this.dataCache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
  }

  /**
   * 获取缓存数据
   */
  getCacheData(key) {
    if (!this.options.enableCache) return null;
    
    const cached = this.dataCache.get(key);
    if (!cached) return null;
    
    if (Date.now() - cached.timestamp > cached.ttl) {
      this.dataCache.delete(key);
      return null;
    }
    
    return cached.data;
  }

  /**
   * 清理过期缓存
   */
  cleanupCache() {
    const now = Date.now();
    for (const [key, cached] of this.dataCache.entries()) {
      if (now - cached.timestamp > cached.ttl) {
        this.dataCache.delete(key);
      }
    }
  }

  // ========== 抽象方法，子类必须实现 ==========

  /**
   * 初始化收集器
   * @abstract
   */
  async initialize() {
    throw new Error('initialize() method must be implemented by subclass');
  }

  /**
   * 收集系统信息
   * @abstract
   * @returns {Object} 系统信息对象
   */
  async collectSystemInfo() {
    throw new Error('collectSystemInfo() method must be implemented by subclass');
  }

  /**
   * 清理资源
   * @abstract
   */
  async cleanup() {
    throw new Error('cleanup() method must be implemented by subclass');
  }
}

export default BaseMonitoringCollector;
