/**
 * 监控数据桥接服务
 * 连接SSH监控数据收集器和监控WebSocket服务
 */

const logger = require('../utils/logger');

class MonitoringBridge {
  constructor() {
    this.collectors = new Map(); // sessionId -> SSHMonitoringCollector
    this.collectorStates = new Map(); // sessionId -> state (starting, running, stopping, stopped)
    this.monitoringService = null;
    this.cleanupTaskStarted = false; // 标记清理任务是否已启动，避免重复日志

    // 启动定期清理任务
    this.startCleanupTask();
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
    // 检查当前状态
    const currentState = this.collectorStates.get(sessionId);
    if (currentState === 'starting' || currentState === 'running') {
      logger.debug('监控收集器已在运行或启动中，跳过重复启动', {
        sessionId,
        currentState,
        host: hostInfo.address
      });
      return;
    }

    // 设置启动状态
    this.collectorStates.set(sessionId, 'starting');

    // 检查是否已存在收集器
    if (this.collectors.has(sessionId)) {
      const existingCollector = this.collectors.get(sessionId);
      if (existingCollector.isCollecting) {
        logger.debug('监控收集器已在运行，跳过重复启动', {
          sessionId,
          host: hostInfo.address
        });
        this.collectorStates.set(sessionId, 'running');
        return;
      } else {
        // 清理已停止的收集器
        logger.debug('清理已停止的监控收集器', { sessionId });
        this.collectors.delete(sessionId);
      }
    }

    try {
      // 动态导入流式SSH监控收集器（优化版）
      const StreamingSSHMonitoringCollector = require('./streamingSSHMonitoringCollector');

      // 创建流式监控收集器实例
      const collector = new StreamingSSHMonitoringCollector(sshConnection, hostInfo);

      // 设置数据回调函数
      const dataCallback = (monitoringData) => {
        this.handleMonitoringData(sessionId, monitoringData);
      };

      // 设置事件监听器
      collector.on('error', (error) => {
        logger.warn('监控收集器错误', {
          sessionId,
          hostId: collector.hostId,
          error: error.message
        });
      });

      collector.on('stopped', () => {
        logger.info('监控收集器已停止', {
          sessionId,
          hostId: collector.hostId
        });
        // 更新状态并从集合中移除
        this.collectorStates.set(sessionId, 'stopped');
        this.collectors.delete(sessionId);
      });

      // 开始数据收集（使用默认间隔1秒）
      collector.startCollection(dataCallback, 1000);

      // 存储收集器实例
      this.collectors.set(sessionId, collector);

      // 更新状态为运行中
      this.collectorStates.set(sessionId, 'running');

      logger.info('SSH监控数据收集已启动', {
        sessionId,
        host: `${hostInfo.username || 'unknown'}@${hostInfo.address || 'unknown'}:${hostInfo.port || 22}`,
        collectorCount: this.collectors.size
      });

    } catch (error) {
      // 启动失败，重置状态
      this.collectorStates.set(sessionId, 'stopped');
      logger.error('启动SSH监控数据收集失败', {
        sessionId,
        host: `${hostInfo.username}@${hostInfo.address}:${hostInfo.port}`,
        error: error.message
      });
    }
  }

  /**
   * 停止SSH连接的监控数据收集（优化版）
   * @param {string} sessionId SSH会话ID
   * @param {string} reason 停止原因
   */
  stopMonitoring(sessionId, reason = 'unknown') {
    // 检查当前状态，避免重复停止
    const currentState = this.collectorStates.get(sessionId);
    if (currentState === 'stopping' || currentState === 'stopped') {
      // 静默跳过重复操作，不记录日志避免噪音
      return false; // 返回false表示没有执行停止操作
    }

    // 设置停止状态
    this.collectorStates.set(sessionId, 'stopping');

    const collector = this.collectors.get(sessionId);
    if (collector) {
      try {
        // 检查收集器是否正在运行
        if (collector.isCollecting) {
          collector.stopCollection();
        } else {
          logger.debug('监控收集器已停止，直接清理', { sessionId, reason });
        }

        // 清理收集器实例
        this.collectors.delete(sessionId);
        this.collectorStates.set(sessionId, 'stopped');

        // 记录停止信息
        logger.info('SSH监控数据收集已停止', {
          sessionId,
          hostId: collector.hostId,
          reason
        });

        return true; // 返回true表示成功执行停止操作

      } catch (error) {
        logger.error('停止SSH监控数据收集失败', {
          sessionId,
          reason,
          error: error.message,
          stack: error.stack
        });

        // 即使出错也要清理收集器实例
        this.collectors.delete(sessionId);
        this.collectorStates.set(sessionId, 'stopped');
        return false;
      }
    } else {
      // 收集器不存在，但可能状态还在，需要清理状态
      if (currentState && currentState !== 'stopped') {
        logger.debug('清理不存在收集器的状态记录', {
          sessionId,
          previousState: currentState,
          reason
        });
        this.collectorStates.set(sessionId, 'stopped');
      } else {
        logger.debug('监控收集器不存在且状态正常，跳过停止操作', {
          sessionId,
          activeCollectors: this.collectors.size,
          reason
        });
      }
      return false;
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
   * 清理过期状态记录
   */
  cleanupStaleStates() {
    let cleanedCount = 0;

    // 清理已停止且没有对应收集器的状态记录
    this.collectorStates.forEach((state, sessionId) => {
      if (state === 'stopped' && !this.collectors.has(sessionId)) {
        this.collectorStates.delete(sessionId);
        cleanedCount++;
      }
    });

    if (cleanedCount > 0) {
      logger.debug('清理过期状态记录', { cleanedCount });
    }
  }

  /**
   * 获取收集器状态
   * @param {string} sessionId SSH会话ID
   * @returns {string} 收集器状态
   */
  getCollectorState(sessionId) {
    return this.collectorStates.get(sessionId) || 'unknown';
  }


  /**
   * 启动定期清理任务
   */
  startCleanupTask() {
    // 每5分钟执行一次清理
    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleStates();

      // 基本清理，不记录详细统计
    }, 5 * 60 * 1000);

    // 只在首次启动时记录，避免重启时的重复日志
    if (!this.cleanupTaskStarted) {
      logger.debug('监控桥接清理任务已启动');
      this.cleanupTaskStarted = true;
    }
  }

  /**
   * 停止定期清理任务
   */
  stopCleanupTask() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      logger.debug('监控桥接清理任务已停止');
    }
  }

  /**
   * 清理所有监控收集器
   */
  cleanup() {
    logger.info('清理所有监控收集器', {
      count: this.collectors.size
    });

    // 停止清理任务
    this.stopCleanupTask();

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
    this.collectorStates.clear();
  }
}

// 创建单例实例
const monitoringBridge = new MonitoringBridge();

module.exports = monitoringBridge;
