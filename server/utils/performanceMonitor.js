/**
 * 生产级性能监控系统
 * 监控应用性能指标，优化资源使用，确保生产环境稳定性
 * 
 * @author EasySSH Team
 * @version 2.0.0
 * @since 2025-08-01
 */

import { EventEmitter } from 'events';
import { performance, PerformanceObserver } from 'perf_hooks';
import logger from './logger.js';

/**
 * 性能指标类型
 */
export const METRIC_TYPES = {
  // 系统指标
  MEMORY_USAGE: 'memory_usage',
  CPU_USAGE: 'cpu_usage',
  EVENT_LOOP_LAG: 'event_loop_lag',
  
  // 应用指标
  REQUEST_DURATION: 'request_duration',
  WEBSOCKET_CONNECTIONS: 'websocket_connections',
  SSH_CONNECTIONS: 'ssh_connections',
  MONITORING_COLLECTION_TIME: 'monitoring_collection_time',
  
  // 业务指标
  DATA_TRANSMISSION_RATE: 'data_transmission_rate',
  ERROR_RATE: 'error_rate',
  THROUGHPUT: 'throughput'
};

/**
 * 性能阈值配置
 */
const PERFORMANCE_THRESHOLDS = {
  [METRIC_TYPES.MEMORY_USAGE]: {
    warning: 80, // 80% 内存使用率
    critical: 95 // 95% 内存使用率
  },
  [METRIC_TYPES.EVENT_LOOP_LAG]: {
    warning: 100, // 100ms 事件循环延迟
    critical: 500 // 500ms 事件循环延迟
  },
  [METRIC_TYPES.REQUEST_DURATION]: {
    warning: 1000, // 1秒请求时间
    critical: 5000 // 5秒请求时间
  },
  [METRIC_TYPES.MONITORING_COLLECTION_TIME]: {
    warning: 3000, // 3秒收集时间
    critical: 10000 // 10秒收集时间
  },
  [METRIC_TYPES.ERROR_RATE]: {
    warning: 5, // 5% 错误率
    critical: 15 // 15% 错误率
  }
};

/**
 * 生产级性能监控器
 */
export class ProductionPerformanceMonitor extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      collectInterval: 30000, // 30秒收集间隔
      retentionPeriod: 3600000, // 1小时数据保留
      enableGC: true, // 启用GC监控
      enableDetailedMetrics: true,
      alertThresholds: PERFORMANCE_THRESHOLDS,
      ...options
    };

    this.metrics = new Map();
    this.timeSeries = new Map();
    this.alerts = [];
    this.isMonitoring = false;
    this.startTime = Date.now();
    
    // 性能观察器
    this.performanceObserver = null;
    
    // 计时器
    this.collectTimer = null;
    this.cleanupTimer = null;
    
    // 初始化指标存储
    this.initializeMetrics();
  }

  /**
   * 初始化指标存储
   */
  initializeMetrics() {
    Object.values(METRIC_TYPES).forEach(type => {
      this.metrics.set(type, {
        current: 0,
        min: Infinity,
        max: -Infinity,
        avg: 0,
        count: 0,
        sum: 0,
        lastUpdate: Date.now()
      });
      this.timeSeries.set(type, []);
    });
  }

  /**
   * 开始性能监控
   */
  start() {
    if (this.isMonitoring) {
      logger.warn('性能监控已在运行');
      return;
    }

    this.isMonitoring = true;
    this.startTime = Date.now();
    
    // 设置性能观察器
    this.setupPerformanceObserver();
    
    // 开始定期收集
    this.startPeriodicCollection();
    
    // 开始定期清理
    this.startPeriodicCleanup();
    
    logger.info('性能监控已启动', {
      collectInterval: this.options.collectInterval,
      retentionPeriod: this.options.retentionPeriod
    });
    
    this.emit('started');
  }

  /**
   * 停止性能监控
   */
  stop() {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;
    
    // 清理定时器
    if (this.collectTimer) {
      clearInterval(this.collectTimer);
      this.collectTimer = null;
    }
    
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    // 断开性能观察器
    if (this.performanceObserver) {
      this.performanceObserver.disconnect();
      this.performanceObserver = null;
    }
    
    logger.info('性能监控已停止');
    this.emit('stopped');
  }

  /**
   * 设置性能观察器
   */
  setupPerformanceObserver() {
    if (!this.options.enableDetailedMetrics) {
      return;
    }

    this.performanceObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      entries.forEach(entry => {
        this.recordMetric(METRIC_TYPES.REQUEST_DURATION, entry.duration);
      });
    });

    this.performanceObserver.observe({ entryTypes: ['measure', 'navigation'] });
  }

  /**
   * 开始定期收集
   */
  startPeriodicCollection() {
    this.collectTimer = setInterval(() => {
      this.collectSystemMetrics();
    }, this.options.collectInterval);
    
    // 立即收集一次
    this.collectSystemMetrics();
  }

  /**
   * 开始定期清理
   */
  startPeriodicCleanup() {
    this.cleanupTimer = setInterval(() => {
      this.cleanupOldData();
    }, this.options.retentionPeriod / 4); // 每1/4保留期清理一次
  }

  /**
   * 收集系统指标
   */
  collectSystemMetrics() {
    try {
      // 内存使用情况
      const memoryUsage = process.memoryUsage();
      const memoryPercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
      this.recordMetric(METRIC_TYPES.MEMORY_USAGE, memoryPercent);

      // CPU使用情况（简化实现）
      const cpuUsage = process.cpuUsage();
      this.recordMetric(METRIC_TYPES.CPU_USAGE, cpuUsage.user + cpuUsage.system);

      // 事件循环延迟
      this.measureEventLoopLag();

      // 记录详细内存信息
      this.recordDetailedMemoryMetrics(memoryUsage);

      logger.debug('系统指标收集完成', {
        memoryPercent: Math.round(memoryPercent),
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024)
      });

    } catch (error) {
      logger.error('收集系统指标失败', { error: error.message });
    }
  }

  /**
   * 测量事件循环延迟
   */
  measureEventLoopLag() {
    const start = performance.now();
    setImmediate(() => {
      const lag = performance.now() - start;
      this.recordMetric(METRIC_TYPES.EVENT_LOOP_LAG, lag);
    });
  }

  /**
   * 记录详细内存指标
   */
  recordDetailedMemoryMetrics(memoryUsage) {
    const metrics = {
      heapUsed: memoryUsage.heapUsed,
      heapTotal: memoryUsage.heapTotal,
      external: memoryUsage.external,
      rss: memoryUsage.rss
    };

    // 检查内存泄漏迹象
    const heapGrowth = this.calculateHeapGrowth(memoryUsage.heapUsed);
    if (heapGrowth > 50 * 1024 * 1024) { // 50MB增长
      this.emit('memoryLeak', {
        heapGrowth,
        currentHeap: memoryUsage.heapUsed,
        timestamp: Date.now()
      });
    }
  }

  /**
   * 计算堆内存增长
   */
  calculateHeapGrowth(currentHeap) {
    const memoryMetric = this.metrics.get(METRIC_TYPES.MEMORY_USAGE);
    if (!memoryMetric || !memoryMetric.lastHeapSize) {
      memoryMetric.lastHeapSize = currentHeap;
      return 0;
    }

    const growth = currentHeap - memoryMetric.lastHeapSize;
    memoryMetric.lastHeapSize = currentHeap;
    return growth;
  }

  /**
   * 记录指标
   */
  recordMetric(type, value, timestamp = Date.now()) {
    if (!this.metrics.has(type)) {
      logger.warn('未知的指标类型', { type });
      return;
    }

    const metric = this.metrics.get(type);
    const timeSeries = this.timeSeries.get(type);

    // 更新统计信息
    metric.current = value;
    metric.min = Math.min(metric.min, value);
    metric.max = Math.max(metric.max, value);
    metric.count++;
    metric.sum += value;
    metric.avg = metric.sum / metric.count;
    metric.lastUpdate = timestamp;

    // 添加到时间序列
    timeSeries.push({ value, timestamp });

    // 检查阈值
    this.checkThresholds(type, value);

    // 发出指标事件
    this.emit('metric', { type, value, timestamp });
  }

  /**
   * 检查性能阈值
   */
  checkThresholds(type, value) {
    const thresholds = this.options.alertThresholds[type];
    if (!thresholds) return;

    let alertLevel = null;
    
    if (value >= thresholds.critical) {
      alertLevel = 'critical';
    } else if (value >= thresholds.warning) {
      alertLevel = 'warning';
    }

    if (alertLevel) {
      const alert = {
        id: `perf_alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: 'performance_threshold',
        level: alertLevel,
        metric: type,
        value,
        threshold: thresholds[alertLevel],
        timestamp: Date.now(),
        message: `${type} 超过${alertLevel}阈值: ${value} >= ${thresholds[alertLevel]}`
      };

      this.alerts.push(alert);
      this.emit('alert', alert);
      
      logger.warn('性能阈值告警', alert);
    }
  }

  /**
   * 开始性能测量
   */
  startMeasure(name) {
    performance.mark(`${name}_start`);
    return {
      end: () => this.endMeasure(name)
    };
  }

  /**
   * 结束性能测量
   */
  endMeasure(name) {
    const endMark = `${name}_end`;
    const measureName = `${name}_duration`;
    
    performance.mark(endMark);
    performance.measure(measureName, `${name}_start`, endMark);
    
    const measure = performance.getEntriesByName(measureName)[0];
    if (measure) {
      this.recordMetric(METRIC_TYPES.REQUEST_DURATION, measure.duration);
      
      // 清理标记
      performance.clearMarks(`${name}_start`);
      performance.clearMarks(endMark);
      performance.clearMeasures(measureName);
      
      return measure.duration;
    }
    
    return 0;
  }

  /**
   * 记录业务指标
   */
  recordBusinessMetric(type, value, context = {}) {
    this.recordMetric(type, value);
    
    logger.debug('业务指标记录', {
      type,
      value,
      context,
      timestamp: Date.now()
    });
  }

  /**
   * 获取指标摘要
   */
  getMetricsSummary() {
    const summary = {};
    
    for (const [type, metric] of this.metrics.entries()) {
      summary[type] = {
        current: Math.round(metric.current * 100) / 100,
        min: Math.round(metric.min * 100) / 100,
        max: Math.round(metric.max * 100) / 100,
        avg: Math.round(metric.avg * 100) / 100,
        count: metric.count,
        lastUpdate: metric.lastUpdate
      };
    }
    
    return summary;
  }

  /**
   * 获取时间序列数据
   */
  getTimeSeriesData(type, timeRange = 3600000) { // 默认1小时
    const timeSeries = this.timeSeries.get(type);
    if (!timeSeries) return [];
    
    const cutoff = Date.now() - timeRange;
    return timeSeries.filter(point => point.timestamp >= cutoff);
  }

  /**
   * 获取性能报告
   */
  getPerformanceReport() {
    const uptime = Date.now() - this.startTime;
    const memoryUsage = process.memoryUsage();
    
    return {
      uptime: Math.round(uptime / 1000),
      memoryUsage: {
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        external: Math.round(memoryUsage.external / 1024 / 1024),
        rss: Math.round(memoryUsage.rss / 1024 / 1024)
      },
      metrics: this.getMetricsSummary(),
      recentAlerts: this.alerts.slice(-10),
      isMonitoring: this.isMonitoring,
      generatedAt: Date.now()
    };
  }

  /**
   * 清理旧数据
   */
  cleanupOldData() {
    const cutoff = Date.now() - this.options.retentionPeriod;
    let cleanedCount = 0;
    
    for (const [type, timeSeries] of this.timeSeries.entries()) {
      const originalLength = timeSeries.length;
      const filtered = timeSeries.filter(point => point.timestamp >= cutoff);
      this.timeSeries.set(type, filtered);
      cleanedCount += originalLength - filtered.length;
    }
    
    // 清理旧告警
    this.alerts = this.alerts.filter(alert => alert.timestamp >= cutoff);
    
    if (cleanedCount > 0) {
      logger.debug('性能数据清理完成', { 
        cleanedPoints: cleanedCount,
        retentionPeriod: this.options.retentionPeriod / 1000
      });
    }
  }

  /**
   * 强制垃圾回收（如果可用）
   */
  forceGC() {
    if (global.gc && this.options.enableGC) {
      const before = process.memoryUsage();
      global.gc();
      const after = process.memoryUsage();
      
      const freed = before.heapUsed - after.heapUsed;
      logger.info('强制垃圾回收完成', {
        freedMemory: Math.round(freed / 1024 / 1024),
        heapBefore: Math.round(before.heapUsed / 1024 / 1024),
        heapAfter: Math.round(after.heapUsed / 1024 / 1024)
      });
      
      return freed;
    }
    
    return 0;
  }
}

// 创建全局性能监控器实例
export const globalPerformanceMonitor = new ProductionPerformanceMonitor();

// 便捷方法
export const startMeasure = (name) => globalPerformanceMonitor.startMeasure(name);
export const recordMetric = (type, value, context) => globalPerformanceMonitor.recordBusinessMetric(type, value, context);

export default {
  ProductionPerformanceMonitor,
  METRIC_TYPES,
  PERFORMANCE_THRESHOLDS,
  globalPerformanceMonitor,
  startMeasure,
  recordMetric
};
