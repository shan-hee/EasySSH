/**
 * 监控数据桥接服务
 * 连接SSH监控数据收集器和监控WebSocket服务
 */

const logger = require('../utils/logger');

class MonitoringBridge {
  constructor() {
    this.collectors = new Map(); // sessionId -> SSHMonitoringCollector
    this.monitoringService = null;
  }

  /**
   * 设置监控WebSocket服务引用
   * @param {Object} monitoringService 监控WebSocket服务实例
   */
  setMonitoringService(monitoringService) {
    this.monitoringService = monitoringService;
  }

  /**
   * 为SSH连接启动监控数据收集
   * @param {string} sessionId SSH会话ID
   * @param {Object} sshConnection SSH连接实例
   * @param {Object} hostInfo 主机信息 { address, port, username }
   */
  startMonitoring(sessionId, sshConnection, hostInfo) {
    // 检查是否已存在收集器
    if (this.collectors.has(sessionId)) {
      const existingCollector = this.collectors.get(sessionId);
      if (existingCollector.isCollecting) {
        logger.debug('监控收集器已在运行，跳过重复启动', {
          sessionId,
          host: hostInfo.address
        });
        return;
      } else {
        // 清理已停止的收集器
        logger.debug('清理已停止的监控收集器', { sessionId });
        this.collectors.delete(sessionId);
      }
    }

    try {
      // 动态导入SSH监控收集器
      const SSHMonitoringCollector = require('./sshMonitoringCollector');

      // 创建监控收集器实例
      const collector = new SSHMonitoringCollector(sshConnection, hostInfo);

      // 设置数据回调函数
      const dataCallback = (monitoringData) => {
        this.handleMonitoringData(sessionId, monitoringData);
      };

      // 开始数据收集
      collector.startCollection(dataCallback);

      // 存储收集器实例
      this.collectors.set(sessionId, collector);

      logger.info('SSH监控数据收集已启动', {
        sessionId,
        host: `${hostInfo.username || 'unknown'}@${hostInfo.address || 'unknown'}:${hostInfo.port || 22}`,
        collectorCount: this.collectors.size
      });

    } catch (error) {
      logger.error('启动SSH监控数据收集失败', {
        sessionId,
        host: `${hostInfo.username}@${hostInfo.address}:${hostInfo.port}`,
        error: error.message
      });
    }
  }

  /**
   * 停止SSH连接的监控数据收集
   * @param {string} sessionId SSH会话ID
   */
  stopMonitoring(sessionId) {
    const collector = this.collectors.get(sessionId);
    if (collector) {
      try {
        // 检查收集器是否正在运行
        if (collector.isCollecting) {
          collector.stopCollection();
          logger.info('SSH监控数据收集已停止', {
            sessionId,
            hostId: collector.hostId,
            remainingCollectors: this.collectors.size - 1
          });
        } else {
          logger.debug('监控收集器已停止，跳过重复停止', { sessionId });
        }

        // 清理收集器实例
        this.collectors.delete(sessionId);

      } catch (error) {
        logger.error('停止SSH监控数据收集失败', {
          sessionId,
          error: error.message,
          stack: error.stack
        });

        // 即使出错也要清理收集器实例
        this.collectors.delete(sessionId);
      }
    } else {
      logger.debug('监控收集器不存在，跳过停止操作', {
        sessionId,
        activeCollectors: this.collectors.size
      });
    }
  }

  /**
   * 处理监控数据
   * @param {string} sessionId SSH会话ID
   * @param {Object} monitoringData 监控数据
   */
  handleMonitoringData(sessionId, monitoringData) {
    if (!this.monitoringService) {
      logger.warn('监控WebSocket服务未设置', { sessionId });
      return;
    }

    try {
      // 调用监控WebSocket服务的数据处理方法
      // 模拟监控客户端发送数据的格式
      if (typeof this.monitoringService.handleMonitoringDataFromSSH === 'function') {
        this.monitoringService.handleMonitoringDataFromSSH(sessionId, monitoringData);
      } else {
        logger.warn('监控服务不支持SSH数据处理方法', { sessionId });
      }

    } catch (error) {
      logger.error('处理监控数据失败', {
        sessionId,
        error: error.message
      });
    }
  }

  /**
   * 获取活跃的监控收集器数量
   * @returns {number} 活跃收集器数量
   */
  getActiveCollectorsCount() {
    return this.collectors.size;
  }



  /**
   * 获取指定会话的监控收集器状态
   * @param {string} sessionId SSH会话ID
   * @returns {Object|null} 收集器状态信息
   */
  getCollectorStatus(sessionId) {
    const collector = this.collectors.get(sessionId);
    if (!collector) {
      return null;
    }

    return {
      sessionId,
      isCollecting: collector.isCollecting,
      hostId: collector.hostId,
      hostInfo: collector.hostInfo
    };
  }

  /**
   * 获取所有监控收集器状态
   * @returns {Array} 所有收集器状态数组
   */
  getAllCollectorStatus() {
    const statuses = [];
    for (const [sessionId, collector] of this.collectors) {
      statuses.push({
        sessionId,
        isCollecting: collector.isCollecting,
        hostId: collector.hostId,
        hostInfo: collector.hostInfo
      });
    }
    return statuses;
  }

  /**
   * 获取所有活跃收集器的状态
   * @returns {Array} 收集器状态列表
   */
  getAllCollectorStatus() {
    const statuses = [];
    this.collectors.forEach((collector, sessionId) => {
      statuses.push({
        sessionId,
        isCollecting: collector.isCollecting,
        hostId: collector.hostId,
        hostInfo: collector.hostInfo
      });
    });
    return statuses;
  }

  /**
   * 清理所有监控收集器
   */
  cleanup() {
    logger.info('清理所有监控收集器', { count: this.collectors.size });
    
    this.collectors.forEach((collector, sessionId) => {
      try {
        collector.stopCollection();
      } catch (error) {
        logger.error('清理监控收集器失败', { 
          sessionId, 
          error: error.message 
        });
      }
    });
    
    this.collectors.clear();
  }
}

// 创建单例实例
const monitoringBridge = new MonitoringBridge();

module.exports = monitoringBridge;
