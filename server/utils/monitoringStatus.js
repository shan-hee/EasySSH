/**
 * 监控系统状态检查工具
 * 提供监控系统健康状态检查和诊断功能
 */

const logger = require('./logger');

class MonitoringStatusChecker {
  constructor() {
    this.monitoringBridge = null;
    this.dataTransport = null;
    this.monitoringService = null;
  }

  /**
   * 初始化状态检查器
   */
  init() {
    try {
      this.monitoringBridge = require('../services/monitoringBridge');
      this.dataTransport = require('../services/optimizedDataTransport');
      this.monitoringService = require('../monitoring');
    } catch (error) {
      logger.warn('初始化监控状态检查器失败', { error: error.message });
    }
  }

  /**
   * 获取完整的监控系统状态
   * @returns {Object} 监控系统状态
   */
  getFullStatus() {
    const status = {
      timestamp: new Date().toISOString(),
      bridge: this.getBridgeStatus(),
      transport: this.getTransportStatus(),
      service: this.getServiceStatus(),
      summary: {}
    };

    // 生成状态摘要
    status.summary = this.generateSummary(status);

    return status;
  }

  /**
   * 获取监控桥接状态
   * @returns {Object} 桥接状态
   */
  getBridgeStatus() {
    if (!this.monitoringBridge) {
      return { available: false, error: 'MonitoringBridge not initialized' };
    }

    try {
      const stats = this.monitoringBridge.getStateStats();
      const collectors = Array.from(this.monitoringBridge.collectors.keys());
      
      return {
        available: true,
        collectors: {
          active: stats.activeCollectors,
          total: stats.total,
          states: {
            starting: stats.starting,
            running: stats.running,
            stopping: stats.stopping,
            stopped: stats.stopped
          }
        },
        sessions: collectors,
        health: this.assessBridgeHealth(stats)
      };
    } catch (error) {
      return {
        available: false,
        error: error.message
      };
    }
  }

  /**
   * 获取数据传输状态
   * @returns {Object} 传输状态
   */
  getTransportStatus() {
    if (!this.dataTransport) {
      return { available: false, error: 'DataTransport not initialized' };
    }

    try {
      const stats = this.dataTransport.getStats();
      const connections = this.dataTransport.getAllConnections();
      
      return {
        available: true,
        connections: {
          active: stats.activeConnections,
          total: connections.length
        },
        performance: {
          totalMessages: stats.totalMessages,
          compressedMessages: stats.compressedMessages,
          batchedMessages: stats.batchedMessages,
          compressionRatio: stats.compressionRatio,
          averageLatency: stats.averageLatency
        },
        queues: {
          activeBatchQueues: stats.activeBatchQueues,
          activeHeartbeats: stats.activeHeartbeats
        },
        health: this.assessTransportHealth(stats)
      };
    } catch (error) {
      return {
        available: false,
        error: error.message
      };
    }
  }

  /**
   * 获取监控服务状态
   * @returns {Object} 服务状态
   */
  getServiceStatus() {
    // 这里可以添加监控服务的状态检查
    // 暂时返回基本信息
    return {
      available: true,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage()
    };
  }

  /**
   * 评估桥接健康状态
   * @param {Object} stats 桥接统计信息
   * @returns {Object} 健康状态
   */
  assessBridgeHealth(stats) {
    const health = {
      status: 'healthy',
      issues: [],
      score: 100
    };

    // 检查是否有过多的停止状态收集器
    if (stats.stopped > stats.running * 2) {
      health.issues.push('过多的已停止收集器，可能存在内存泄漏');
      health.score -= 20;
    }

    // 检查是否有长时间处于启动状态的收集器
    if (stats.starting > 0) {
      health.issues.push('存在长时间处于启动状态的收集器');
      health.score -= 10;
    }

    // 检查是否有长时间处于停止状态的收集器
    if (stats.stopping > 0) {
      health.issues.push('存在长时间处于停止状态的收集器');
      health.score -= 10;
    }

    // 根据分数确定状态
    if (health.score >= 80) {
      health.status = 'healthy';
    } else if (health.score >= 60) {
      health.status = 'warning';
    } else {
      health.status = 'critical';
    }

    return health;
  }

  /**
   * 评估传输健康状态
   * @param {Object} stats 传输统计信息
   * @returns {Object} 健康状态
   */
  assessTransportHealth(stats) {
    const health = {
      status: 'healthy',
      issues: [],
      score: 100
    };

    // 检查平均延迟
    if (stats.averageLatency > 1000) {
      health.issues.push('平均延迟过高');
      health.score -= 30;
    } else if (stats.averageLatency > 500) {
      health.issues.push('平均延迟较高');
      health.score -= 15;
    }

    // 检查压缩率
    if (stats.totalMessages > 100 && stats.compressionRatio < 10) {
      health.issues.push('数据压缩效果不佳');
      health.score -= 10;
    }

    // 检查批量传输效果
    if (stats.totalMessages > 100 && stats.batchedMessages / stats.totalMessages < 0.3) {
      health.issues.push('批量传输使用率较低');
      health.score -= 10;
    }

    // 根据分数确定状态
    if (health.score >= 80) {
      health.status = 'healthy';
    } else if (health.score >= 60) {
      health.status = 'warning';
    } else {
      health.status = 'critical';
    }

    return health;
  }

  /**
   * 生成状态摘要
   * @param {Object} status 完整状态
   * @returns {Object} 状态摘要
   */
  generateSummary(status) {
    const summary = {
      overall: 'healthy',
      activeCollectors: 0,
      activeConnections: 0,
      totalIssues: 0,
      criticalIssues: 0
    };

    // 统计活跃组件
    if (status.bridge.available) {
      summary.activeCollectors = status.bridge.collectors.active;
    }

    if (status.transport.available) {
      summary.activeConnections = status.transport.connections.active;
    }

    // 统计问题
    const allHealthChecks = [
      status.bridge.health,
      status.transport.health
    ].filter(h => h);

    allHealthChecks.forEach(health => {
      if (health.issues) {
        summary.totalIssues += health.issues.length;
        if (health.status === 'critical') {
          summary.criticalIssues++;
        }
      }
    });

    // 确定整体状态
    if (summary.criticalIssues > 0) {
      summary.overall = 'critical';
    } else if (summary.totalIssues > 0) {
      summary.overall = 'warning';
    } else {
      summary.overall = 'healthy';
    }

    return summary;
  }

  /**
   * 执行健康检查
   * @returns {Object} 健康检查结果
   */
  healthCheck() {
    const status = this.getFullStatus();
    
    return {
      healthy: status.summary.overall === 'healthy',
      status: status.summary.overall,
      timestamp: status.timestamp,
      details: {
        activeCollectors: status.summary.activeCollectors,
        activeConnections: status.summary.activeConnections,
        totalIssues: status.summary.totalIssues,
        criticalIssues: status.summary.criticalIssues
      },
      issues: this.extractAllIssues(status)
    };
  }

  /**
   * 提取所有问题
   * @param {Object} status 完整状态
   * @returns {Array} 问题列表
   */
  extractAllIssues(status) {
    const issues = [];

    if (status.bridge.health && status.bridge.health.issues) {
      issues.push(...status.bridge.health.issues.map(issue => ({
        component: 'bridge',
        issue,
        severity: status.bridge.health.status
      })));
    }

    if (status.transport.health && status.transport.health.issues) {
      issues.push(...status.transport.health.issues.map(issue => ({
        component: 'transport',
        issue,
        severity: status.transport.health.status
      })));
    }

    return issues;
  }

  /**
   * 记录状态信息
   */
  logStatus() {
    const status = this.getFullStatus();
    
    logger.info('监控系统状态检查', {
      overall: status.summary.overall,
      activeCollectors: status.summary.activeCollectors,
      activeConnections: status.summary.activeConnections,
      totalIssues: status.summary.totalIssues
    });

    if (status.summary.totalIssues > 0) {
      const issues = this.extractAllIssues(status);
      logger.warn('监控系统存在问题', { issues });
    }
  }
}

// 创建单例实例
const monitoringStatusChecker = new MonitoringStatusChecker();

module.exports = monitoringStatusChecker;
