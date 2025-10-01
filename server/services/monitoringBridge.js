/**
 * 监控数据桥接服务
 * 连接SSH监控数据收集器和监控WebSocket服务
 */

const logger = require('../utils/logger');
const monitoringConfig = require('../config/monitoring');

class MonitoringBridge {
  constructor() {
    this.collectors = new Map(); // sessionId -> SSHMonitoringCollector
    this.collectorStates = new Map(); // sessionId -> state (starting, running, stopping, stopped)
    this.monitoringService = null;
    this.cleanupTaskStarted = false; // 标记清理任务是否已启动，避免重复日志
    this.cleanupTimer = null; // 确保定时器引用被初始化
    this.abortCleanups = new Map(); // sessionId -> () => void

    // host 级去重与共享采集
    this.hostCollectors = new Map(); // hostId -> { collector, primarySessionId, refCount, sessions: Map<sessionId, { sshConnection, hostInfo }> }
    this.sessionToHost = new Map(); // sessionId -> hostId
    this.inFlightStarts = new Set(); // hostId 正在启动采集器
    this.failoverHosts = new Set(); // hostId 正在进行主会话故障切换
    this.primaryLastSwitchAt = new Map(); // hostId -> timestamp
    this.lastFailoverAt = new Map(); // hostId -> timestamp
    this.lastDataAtByHost = new Map(); // hostId -> timestamp

    // 读取防抖配置
    const election = monitoringConfig?.collector?.election || {};
    this.holdDownMs = typeof election.primaryHoldDownMs === 'number' ? election.primaryHoldDownMs : 2500;
    this.failoverCoolDownMs = typeof election.failoverCoolDownMs === 'number' ? election.failoverCoolDownMs : 500;
    this.jitterMs = typeof election.jitterMs === 'number' ? election.jitterMs : 150;
    this.noDataTimeoutMs = typeof election.noDataTimeoutMs === 'number' ? election.noDataTimeoutMs : 3000;

    // 针对相同主机的去重：每个主机只选择一个会话作为“主”数据源
    // hostId -> primarySessionId
    this.primarySessionByHost = new Map();

    // 启动定期清理任务
    this.startCleanupTask();
  }

  /**
   * 根据 hostInfo 生成标准 hostId
   */
  _getHostIdFromHostInfo(hostInfo = {}) {
    const address = hostInfo.address || 'unknown';
    const hostname = hostInfo.hostname || null;
    return hostname ? `${hostname}@${address}` : address;
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
  startMonitoring(sessionId, sshConnection, hostInfo, options = {}) {
    const { signal } = options;

    if (signal?.aborted) {
      logger.debug('取消信号已触发，跳过监控启动', {
        sessionId,
        host: `${hostInfo.username || 'unknown'}@${hostInfo.address || 'unknown'}:${hostInfo.port || 22}`
      });
      return;
    }
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

    // host 级共享采集：根据 hostId 做单飞
    const hostId = this._getHostIdFromHostInfo(hostInfo);
    const existingHostGroup = this.hostCollectors.get(hostId);

    if (existingHostGroup) {
      // 已有该主机的采集器：增加引用计数并复用
      existingHostGroup.refCount = (existingHostGroup.refCount || 0) + 1;
      existingHostGroup.sessions.set(sessionId, { sshConnection, hostInfo });
      this.sessionToHost.set(sessionId, hostId);
      this.collectorStates.set(sessionId, 'running');

      // 绑定取消
      if (signal) {
        const abortHandler = () => {
          const abortReason = signal.reason || 'aborted';
          logger.debug('收到会话取消信号（共享采集）', { sessionId, host: hostId, reason: abortReason });
          this.stopMonitoring(sessionId, abortReason);
        };
        signal.addEventListener('abort', abortHandler, { once: true });
        this.abortCleanups.set(sessionId, () => {
          signal.removeEventListener('abort', abortHandler);
        });
      }

      logger.debug('复用现有主机采集器', {
        sessionId,
        host: `${hostInfo.username || 'unknown'}@${hostInfo.address || 'unknown'}:${hostInfo.port || 22}`,
        hostId,
        refCount: existingHostGroup.refCount
      });
      return;
    }

    // 防止并发重复启动
    if (this.inFlightStarts.has(hostId)) {
      logger.debug('主机采集器正在启动，跳过并发启动', { sessionId, hostId });
      this.collectorStates.set(sessionId, 'starting');
      // 记录会话，启动完成后将自动进入运行中
      const placeholderGroup = this.hostCollectors.get(hostId) || { sessions: new Map(), refCount: 0 };
      placeholderGroup.sessions.set(sessionId, { sshConnection, hostInfo });
      placeholderGroup.refCount++;
      this.hostCollectors.set(hostId, placeholderGroup);
      this.sessionToHost.set(sessionId, hostId);

      if (signal) {
        const abortHandler = () => this.stopMonitoring(sessionId, signal.reason || 'aborted');
        signal.addEventListener('abort', abortHandler, { once: true });
        this.abortCleanups.set(sessionId, () => signal.removeEventListener('abort', abortHandler));
      }
      return;
    }

    // 设置启动状态
    this.collectorStates.set(sessionId, 'starting');
    this.inFlightStarts.add(hostId);

    try {
      // 动态导入流式SSH监控收集器（优化版）
      const StreamingSSHMonitoringCollector = require('./streamingSSHMonitoringCollector');

      // 创建流式监控收集器实例
      const collector = new StreamingSSHMonitoringCollector(sshConnection, hostInfo);

      // 设置数据回调函数（带主/备筛选）
      const dataCallback = (monitoringData) => {
        this.handleMonitoringData(sessionId, monitoringData);
      };

      // 设置事件监听器
      collector.on('error', (error) => {
        const hostIdOnError = collector.hostId;
        const msg = error?.message || '';
        logger.warn('监控收集器错误', {
          sessionId,
          hostId: hostIdOnError,
          error: msg
        });

        // 若当前主SSH连接已断导至 "Not connected" / "Connection closed" 等错误，且同主机还有其他连接，主动触发故障切换
        const indicative = ['Not connected', 'Connection closed', 'ECONNRESET', 'ETIMEDOUT', 'Unable to exec'];
        const shouldFailover = indicative.some(k => msg.includes(k));

        if (shouldFailover) {
          const group = this.hostCollectors.get(hostIdOnError);
          if (group && group.sessions.size > 0) {
            if (!this.failoverHosts.has(hostIdOnError)) {
              this.failoverHosts.add(hostIdOnError);
              logger.debug('检测到主连接错误，尝试主会话故障切换', { hostId: hostIdOnError, from: sessionId });
              try {
                // 主动停止当前采集器，进入 stopped 流程，由 stopped 中完成切换
                if (collector.isCollecting) {
                  collector.stopCollection();
                }
              } catch (e) {
                logger.debug('触发故障切换时停止采集器失败(忽略)', { hostId: hostIdOnError, error: e.message });
              }
            }
          }
        }
      });

      collector.on('stopped', () => {
        logger.debug('监控收集器已停止', {
          sessionId,
          hostId: collector.hostId
        });
        // 更新状态并从集合中移除
        this.collectorStates.set(sessionId, 'stopped');
        this.collectors.delete(sessionId);

        // 如果该会话是该主机的主数据源，清理主映射，允许其他会话接管
        try {
          const currentPrimary = this.primarySessionByHost.get(collector.hostId);
          if (currentPrimary === sessionId) {
            this.primarySessionByHost.delete(collector.hostId);
            logger.debug('主监控会话已停止，释放主映射', {
              hostId: collector.hostId,
              sessionId
            });
          }
        } catch (e) {
          // 静默
        }

        // host 级共享采集：尝试主会话故障切换
        const group = this.hostCollectors.get(collector.hostId);
        if (group) {
          // 移除当前主会话映射（如果存在）
          if (group.primarySessionId === sessionId) {
            group.primarySessionId = null;
          }

          if (group.refCount > 0 && group.sessions.size > 0) {
            const doSwitch = () => {
              // 选择一个新的会话接管
              const candidateEntry = Array.from(group.sessions.entries()).find(([sid]) => sid !== sessionId) || Array.from(group.sessions.entries())[0];
              if (candidateEntry) {
                const [newPrimaryId, meta] = candidateEntry;
                try {
                  const ReplacementCollector = require('./streamingSSHMonitoringCollector');
                  const newCollector = new ReplacementCollector(meta.sshConnection, meta.hostInfo);

                  const dataCallback = (monitoringData) => {
                    this.handleMonitoringData(newPrimaryId, monitoringData);
                  };

                  newCollector.on('error', (error) => {
                    logger.warn('监控收集器错误(切换后)', {
                      sessionId: newPrimaryId,
                      hostId: newCollector.hostId,
                      error: error.message
                    });
                  });

                  newCollector.on('stopped', () => {
                    logger.debug('监控收集器已停止(切换后)', {
                      sessionId: newPrimaryId,
                      hostId: newCollector.hostId
                    });
                    this.collectorStates.set(newPrimaryId, 'stopped');
                    this.collectors.delete(newPrimaryId);
                  });

                  newCollector.startCollection(dataCallback, 1000);
                  this.collectors.set(newPrimaryId, newCollector);
                  group.primarySessionId = newPrimaryId;
                  group.collector = newCollector;
                  this.primarySessionByHost.set(newCollector.hostId, newPrimaryId);
                  const nowTs = Date.now();
                  this.primaryLastSwitchAt.set(newCollector.hostId, nowTs);
                  this.lastFailoverAt.set(newCollector.hostId, nowTs);
                  logger.debug('主监控会话已切换', { hostId: newCollector.hostId, from: sessionId, to: newPrimaryId });
                } catch (switchErr) {
                  logger.error('主监控会话切换失败', { hostId: collector.hostId, error: switchErr.message });
                }
              }
              // 释放锁
              this.failoverHosts.delete(collector.hostId);
            };

            const now = Date.now();
            const last = this.lastFailoverAt.get(collector.hostId) || 0;
            const since = now - last;
            const jitter = Math.floor(Math.random() * (this.jitterMs || 0));
            if (since < this.failoverCoolDownMs) {
              const delay = this.failoverCoolDownMs - since + jitter;
              logger.debug('应用故障切换冷却期', { hostId: collector.hostId, delay });
              setTimeout(doSwitch, Math.max(0, delay));
            } else {
              doSwitch();
            }

          } else {
            // 无引用者，清理主机组
            this.hostCollectors.delete(collector.hostId);
            // 释放锁
            this.failoverHosts.delete(collector.hostId);
          }
        }
      });

      // 开始数据收集（使用默认间隔1秒）
      collector.startCollection(dataCallback, 1000);

      // 存储收集器实例
      this.collectors.set(sessionId, collector);

      // 更新状态为运行中
      this.collectorStates.set(sessionId, 'running');

      // host 级共享采集：建立主机组
      const group = this.hostCollectors.get(hostId) || { sessions: new Map(), refCount: 0 };
      group.collector = collector;
      group.primarySessionId = sessionId;
      group.refCount = (group.refCount || 0) + 1;
      group.sessions.set(sessionId, { sshConnection, hostInfo });
      this.hostCollectors.set(hostId, group);
      this.sessionToHost.set(sessionId, hostId);

      // 将该主机下的所有会话标记为运行中
      try {
        for (const [sid] of group.sessions) {
          this.collectorStates.set(sid, 'running');
        }
      } catch (_) {}

      logger.debug('SSH监控数据收集已启动', {
        sessionId,
        host: `${hostInfo.username || 'unknown'}@${hostInfo.address || 'unknown'}:${hostInfo.port || 22}`,
        collectorCount: this.collectors.size,
        hostId,
        hostRefCount: group.refCount
      });

      if (signal) {
        const abortHandler = () => {
          const abortReason = signal.reason || 'aborted';
          logger.debug('收到会话取消信号，停止监控收集器', {
            sessionId,
            host: collector.hostId,
            reason: abortReason
          });
          this.stopMonitoring(sessionId, abortReason);
        };

        signal.addEventListener('abort', abortHandler, { once: true });
        this.abortCleanups.set(sessionId, () => {
          signal.removeEventListener('abort', abortHandler);
        });
      }

    } catch (error) {
      // 启动失败，重置状态
      this.collectorStates.set(sessionId, 'stopped');
      this.inFlightStarts.delete(hostId);
      logger.error('启动SSH监控数据收集失败', {
        sessionId,
        host: `${hostInfo.username}@${hostInfo.address}:${hostInfo.port}`,
        error: error.message
      });
      // 回滚占位
      const placeholder = this.hostCollectors.get(hostId);
      if (placeholder) {
        placeholder.sessions.delete(sessionId);
        placeholder.refCount = Math.max(0, (placeholder.refCount || 0) - 1);
        if (placeholder.refCount === 0) {
          this.hostCollectors.delete(hostId);
        }
      }
    } finally {
      this.inFlightStarts.delete(hostId);
    }
  }

  /**
   * 停止SSH连接的监控数据收集（优化版）
   * @param {string} sessionId SSH会话ID
   * @param {string} reason 停止原因
   */
  stopMonitoring(sessionId, reason = 'unknown') {
    try {
      // 优先走 host 级共享采集的停止流程
      const hostId = this.sessionToHost.get(sessionId);
      if (hostId) {
        const group = this.hostCollectors.get(hostId);
        if (group) {
          // 解除会话引用
          if (group.sessions.has(sessionId)) group.sessions.delete(sessionId);
          group.refCount = Math.max(0, (group.refCount || 0) - 1);
          this.sessionToHost.delete(sessionId);
          this.collectorStates.set(sessionId, 'stopped');

          logger.debug('释放主机采集器引用', { sessionId, hostId, refCount: group.refCount, reason });

          if (group.refCount === 0) {
            // 无任何引用，停止并清理主采集器
            const primaryId = group.primarySessionId;
            const primaryCollector = [...this.collectors.entries()].find(([sid, c]) => sid === primaryId)?.[1] || group.collector;
            try {
              if (primaryCollector?.isCollecting) primaryCollector.stopCollection();
            } catch (e) {
              logger.debug('停止主机采集器失败(忽略)', { hostId, error: e.message });
            }
            this.hostCollectors.delete(hostId);
            if (primaryId) this.collectors.delete(primaryId);
          } else {
            // 仍有其他会话引用：若当前 session 恰好是主会话，主动停止主采集器以便尽快切换
            if (group.primarySessionId === sessionId) {
              try {
                if (group.collector?.isCollecting) group.collector.stopCollection();
              } catch (_) {}
            }
          }

          // 清理 abort 监听
          const abortCleanup = this.abortCleanups.get(sessionId);
          if (abortCleanup) {
            try { abortCleanup(); } catch (_) {}
            this.abortCleanups.delete(sessionId);
          }

          return true;
        }
      }

      // 退回到旧的按 session 的停止逻辑（兼容）
      const currentState = this.collectorStates.get(sessionId);
      if (currentState === 'stopping' || currentState === 'stopped') {
        return false;
      }
      this.collectorStates.set(sessionId, 'stopping');

      const collector = this.collectors.get(sessionId);
      if (collector) {
        try {
          if (collector.isCollecting) {
            collector.stopCollection();
          }
          this.collectors.delete(sessionId);
          this.collectorStates.set(sessionId, 'stopped');

          logger.debug('SSH监控数据收集已停止', {
            sessionId,
            hostId: collector.hostId,
            reason
          });
          return true;
        } catch (error) {
          logger.error('停止SSH监控数据收集失败', { sessionId, reason, error: error.message });
          this.collectors.delete(sessionId);
          this.collectorStates.set(sessionId, 'stopped');
          return false;
        }
      } else {
        if (currentState && currentState !== 'stopped') {
          this.collectorStates.set(sessionId, 'stopped');
        }
        return false;
      }
    } finally {
      // 清理 primarySessionByHost 映射（若指向该 session）
      try {
        const hostId = this.sessionToHost.get(sessionId);
        if (hostId) {
          const currentPrimary = this.primarySessionByHost.get(hostId);
          if (currentPrimary === sessionId) {
            this.primarySessionByHost.delete(hostId);
          }
        }
      } catch (_) {}

      // 清理 abort 监听（兜底）
      const abortCleanup = this.abortCleanups.get(sessionId);
      if (abortCleanup) {
        try { abortCleanup(); } catch (_) {}
        this.abortCleanups.delete(sessionId);
      }
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
      const hostId = monitoringData?.hostId;

      // 如果无法判定主机，直接透传以免丢数据
      if (!hostId) {
        if (typeof this.monitoringService.handleMonitoringDataFromSSH === 'function') {
          this.monitoringService.handleMonitoringDataFromSSH(sessionId, monitoringData);
        }
        return;
      }

      const currentPrimary = this.primarySessionByHost.get(hostId);
      const currentCollector = this.collectors.get(currentPrimary || '');

      // 记录最近一次收到该主机监控数据的时间
      this.lastDataAtByHost.set(hostId, Date.now());

      // 若当前无主会话，或主会话已不存在/已停止，则将当前会话设为主并透传
      const shouldBecomePrimary = !currentPrimary || !currentCollector || currentCollector.isCollecting === false;

      if (shouldBecomePrimary) {
        if (currentPrimary && currentPrimary !== sessionId) {
          logger.debug('主监控会话失效，切换主会话', { hostId, from: currentPrimary, to: sessionId });
        }
        this.primarySessionByHost.set(hostId, sessionId);
        this.primaryLastSwitchAt.set(hostId, Date.now());
      }

      // 仅主会话的数据透传到监控服务，避免同一主机的重复推送
      if (this.primarySessionByHost.get(hostId) === sessionId) {
        if (typeof this.monitoringService.handleMonitoringDataFromSSH === 'function') {
          this.monitoringService.handleMonitoringDataFromSSH(sessionId, monitoringData);
        } else {
          logger.warn('监控服务不支持SSH数据处理方法', { sessionId });
        }
      } else {
        // 抑制重复来源的数据
        // 仅在首次发现重复时记录一次日志以避免噪音
        // 这里不计数，保持轻量
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
    // 如果定时器已存在，先清理
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      logger.warn('清理旧的定期任务定时器');
    }

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
    this.hostCollectors.clear();
    this.sessionToHost.clear();
    this.inFlightStarts.clear();
  }

  /**
   * 获取收集器统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    const stats = {
      totalCollectors: this.collectors.size,
      collectors: {},
      states: {}
    };

    // 收集器信息
    for (const [sessionId, collector] of this.collectors) {
      stats.collectors[sessionId] = {
        hostId: collector.hostId,
        isCollecting: collector.isCollecting,
        targetHost: collector.hostInfo?.address || 'unknown',
        startTime: collector.creationTime || Date.now() // 假设有创建时间
      };
    }

    // 状态信息
    for (const [sessionId, state] of this.collectorStates) {
      stats.states[sessionId] = state;
    }

    return stats;
  }
}

// 创建单例实例
const monitoringBridge = new MonitoringBridge();

module.exports = monitoringBridge;
