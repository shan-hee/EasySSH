/**
 * 统一监控服务 - SSH集成版
 * 基于SSH的监控WebSocket客户端服务
 */

import log from './log';

/**
 * 监控实例类
 */
class MonitoringInstance {
  constructor(terminalId) {
    this.terminalId = terminalId;
    this.websocket = null;
    this.state = {
      connected: false,
      connecting: false,
      targetHost: null,
      error: null,
      stats: {
        messagesReceived: 0,
        messagesSent: 0
      },
      lastActivity: null,
      monitorData: {
        cpu: { usage: 0, cores: 0, model: '' },
        memory: { total: 0, used: 0, free: 0, usedPercentage: 0 },
        swap: { total: 0, used: 0, free: 0, usedPercentage: 0 },
        disk: { total: 0, used: 0, free: 0, usedPercentage: 0 },
        network: {},
        os: {}
      },
      // 历史数据存储（全局持久化）
      historyData: {
        cpu: Array(20).fill(0),
        memory: Array(20).fill(0),
        disk: Array(20).fill(0),
        network: {
          upload: Array(20).fill(0),
          download: Array(20).fill(0)
        }
      }
    };
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    this._lastDataHash = null; // 防重复处理的数据哈希
    this._lastStatusHash = null; // 防重复处理的状态哈希
    this._staticDataCache = null; // 静态数据缓存（用于差量更新）
    this.reconnectDelay = 2000;
    this._manualDisconnect = false; // 标记是否为主动断开
  }

  /**
   * 连接到远程主机
   * @param {string} host - 主机地址
   * @returns {Promise<boolean>} 连接结果
   */
  async connect(host) {
    if (this.state.connecting || this.state.connected) {
      return this.state.connected;
    }

    this.state.connecting = true;
    this.state.targetHost = host;
    this.state.error = null;
    this._manualDisconnect = false; // 重置主动断开标志

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsHost = window.location.host;
      const wsUrl = `${protocol}//${wsHost}/monitor?subscribe=${encodeURIComponent(host)}`;

      this.websocket = new WebSocket(wsUrl);

      this.websocket.onopen = () => {
        this.state.connected = true;
        this.state.connecting = false;
        this.reconnectAttempts = 0;
        // 优化：移除此处的日志，由main.js统一记录终端特定的连接成功日志
        // log.info(`[监控] 连接成功: ${host}`);

        // 触发连接成功事件
        this._emitEvent('monitoring-connected', {
          terminalId: this.terminalId,
          host
        });
      };

      this.websocket.onmessage = event => {
        this._handleMessage(event.data);
      };

      this.websocket.onclose = () => {
        this.state.connected = false;
        this.state.connecting = false;

        // 触发断开连接事件
        this._emitEvent('monitoring-disconnected', {
          terminalId: this.terminalId,
          host
        });

        // 只有在非主动断开时才尝试重连
        if (!this._manualDisconnect) {
          this._attemptReconnect();
        } else {
          log.debug(`[监控] 主动断开连接，不进行重连: ${host}`);
        }
      };

      this.websocket.onerror = error => {
        this.state.error = error;
        this.state.connecting = false;
        log.error(`[监控] 连接错误: ${host}`, error);
      };

      // 等待连接建立
      return new Promise(resolve => {
        const checkConnection = () => {
          if (this.state.connected) {
            resolve(true);
          } else if (!this.state.connecting) {
            resolve(false);
          } else {
            setTimeout(checkConnection, 100);
          }
        };
        checkConnection();
      });
    } catch (error) {
      this.state.connecting = false;
      this.state.error = error;
      log.error(`[监控] 连接失败: ${host}`, error);
      return false;
    }
  }

  /**
   * 断开连接
   */
  disconnect() {
    this._manualDisconnect = true; // 标记为主动断开

    if (this.websocket) {
      const ws = this.websocket;
      this.websocket = null;

      try {
        const noop = () => {};
        const readyState = ws.readyState;

        ws.addEventListener('error', noop, { once: true });
        ws.addEventListener('close', noop, { once: true });

        // 尝试通过JSON abort请求优雅取消订阅并让服务端停止对应采集
        const sendAbort = () => {
          try {
            const serverId = this.state?.targetHost || null;
            if (serverId && ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: 'abort',
                  payload: { serverId, terminalId: this.terminalId }
                })
              );
            }
          } catch (e) {
            /* no-op */
          }
        };

        if (readyState === WebSocket.OPEN) {
          sendAbort();
          // 轻微延迟后关闭，给服务器处理时间
          setTimeout(() => {
            try { ws.close(1000, 'client_close'); } catch (_) {}
          }, 50);
        } else if (readyState === WebSocket.CONNECTING) {
          ws.addEventListener(
            'open',
            () => {
              sendAbort();
              try { ws.close(1000, 'client_close'); } catch (closeError) { log.debug('[监控] 延迟关闭WebSocket失败', closeError); }
            },
            { once: true }
          );
        } else {
          // CLOSING/CLOSED 直接吞掉
          try { ws.close(1000, 'client_close'); } catch (_) {}
        }
      } catch (error) {
        log.debug('[监控] 关闭WebSocket失败', error);
      }
    }
    this.state.connected = false;
    this.state.connecting = false;
    this.reconnectAttempts = 0;

    log.debug(`[监控] 主动断开连接: ${this.state.targetHost}`);
  }

  /**
   * 请求系统统计信息
   */
  requestSystemStats() {
    if (this.state.connected && this.websocket) {
      this.websocket.send(
        JSON.stringify({
          type: 'request_stats'
        })
      );
      this.state.stats.messagesSent++;
    }
  }

  /**
   * 处理WebSocket消息
   * @param {string} data - 消息数据
   * @private
   */
  _handleMessage(data) {
    try {
      const message = JSON.parse(data);
      this.state.stats.messagesReceived++;

      switch (message.type) {
        case 'monitoring_data':
          this._handleMonitoringData(message.data);
          this.state.lastActivity = Date.now();
          break;
        case 'system_stats':
          this._handleMonitoringData(message.payload);
          this.state.lastActivity = Date.now();
          break;
        case 'batch':
          this._handleBatchMessage(message);
          break;
        case 'delta':
          this._handleDeltaMessage(message);
          break;
        case 'monitoring_status':
          this._handleMonitoringStatus(message);
          break;
        case 'monitoring_disconnected':
          // 处理监控断开连接消息
          this._handleMonitoringDisconnected(message);
          break;
        case 'session_created':
        case 'subscribe_ack':
        case 'monitoring_data_updated':
        case 'ping':
        case 'pong':
          // 确认消息和心跳响应，无需处理
          break;
        case 'error': {
          const errorMsg = message.message || message.data?.message || message.error || '未知错误';
          log.error(`[监控] 服务器错误: ${errorMsg}`);
          break;
        }
        default:
          log.warn(`[监控] 未知消息类型: ${message.type}`);
          break;
      }
    } catch (error) {
      log.error('[监控] 消息解析失败', error);
    }
  }

  /**
   * 处理批量消息
   * @param {Object} batchMessage - 批量消息
   * @private
   */
  _handleBatchMessage(batchMessage) {
    if (!batchMessage.items || !Array.isArray(batchMessage.items)) {
      return;
    }

    // 逐个处理批量消息中的每个项目
    batchMessage.items.forEach(item => {
      try {
        switch (item.type) {
          case 'monitoring_data':
            this._handleMonitoringData(item.data);
            break;
          case 'system_stats': {
            // 处理新的差量格式
            const payload = item.payload || item.delta?.payload || item.delta;
            if (payload) {
              this._handleMonitoringData(payload);
            }
            break;
          }
          case 'monitoring_status':
            this._handleMonitoringStatus(item);
            break;
        }
      } catch (error) {
        log.error(`[监控] 处理批量消息项目失败: ${error.message}`, { item });
      }
    });

    this.state.lastActivity = Date.now();
  }

  /**
   * 处理差量更新消息
   * @param {Object} message - 差量消息
   * @private
   */
  _handleDeltaMessage(message) {
    try {
      // 重构完整数据
      const fullData = this._reconstructDeltaData(message);
      if (fullData) {
        this._handleMonitoringData(fullData);
      }
    } catch (error) {
      log.error('[监控] 差量消息处理失败:', error);
    }
  }

  /**
   * 重构差量数据为完整数据
   * @param {Object} deltaMessage - 差量消息
   * @returns {Object|null} 完整数据
   * @private
   */
  _reconstructDeltaData(deltaMessage) {
    const { staticVersion, delta, staticFields } = deltaMessage;

    // 如果有静态字段更新，保存到缓存
    if (staticFields) {
      this._staticDataCache = {
        version: staticVersion,
        data: staticFields
      };
    }

    // 如果没有缓存的静态数据，无法重构
    if (!this._staticDataCache) {
      return null;
    }

    // 合并静态数据和差量数据
    const fullData = {
      ...this._staticDataCache.data,
      ...delta,
      timestamp: deltaMessage.timestamp
    };

    return fullData;
  }

  /**
   * 处理监控数据
   * @param {Object} data - 监控数据
   * @private
   */
  _handleMonitoringData(data) {
    // 处理监控数据（日志已移除，用户可在WebSocket中查看）

    if (data && this._isValidMonitoringData(data)) {
      // 防止重复处理相同的数据（排除时间戳字段）
      const { timestamp: _timestamp, ...dataWithoutTimestamp } = data;
      const dataHash = JSON.stringify(dataWithoutTimestamp);
      if (this._lastDataHash === dataHash) {
        log.debug('[监控] 跳过重复数据');
        return;
      }
      this._lastDataHash = dataHash;

      this.state.monitorData = { ...this.state.monitorData, ...data };

      // 监控数据已更新（日志已移除，用户可在WebSocket中查看）

      // 更新历史数据（后台持续收集）
      this._updateHistoryData(data);

      // 触发数据更新事件
      this._emitEvent('monitoring-data-received', {
        terminalId: this.terminalId,
        host: this.state.targetHost,
        data,
        source: 'websocket'
      });
    } else {
      log.warn('[监控] 监控数据无效或为空', {
        data,
        terminalId: this.terminalId
      });
    }
  }

  /**
   * 更新历史数据
   * @param {Object} data - 监控数据
   * @private
   */
  _updateHistoryData(data) {
    try {
      // 更新CPU历史数据
      if (data.cpu?.usage !== undefined) {
        const cpuData = this.state.historyData.cpu;
        cpuData.push(data.cpu.usage);
        if (cpuData.length > 20) {
          cpuData.shift();
        }
      }

      // 更新内存历史数据
      if (data.memory?.usedPercentage !== undefined) {
        const memoryData = this.state.historyData.memory;
        memoryData.push(data.memory.usedPercentage);
        if (memoryData.length > 20) {
          memoryData.shift();
        }
      }

      // 更新磁盘历史数据
      if (data.disk?.usedPercentage !== undefined) {
        const diskData = this.state.historyData.disk;
        diskData.push(data.disk.usedPercentage);
        if (diskData.length > 20) {
          diskData.shift();
        }
      }

      // 更新网络历史数据
      if (data.network) {
        const uploadData = this.state.historyData.network.upload;
        const downloadData = this.state.historyData.network.download;

        // 处理不同的网络数据格式
        let txSpeedKB = 0;
        let rxSpeedKB = 0;

        if (data.network.upload !== undefined && data.network.download !== undefined) {
          // 如果已经有 upload/download 字段（来自工具栏转换）
          txSpeedKB = parseFloat(data.network.upload) || 0;
          rxSpeedKB = parseFloat(data.network.download) || 0;
        } else if (
          data.network.total_tx_speed !== undefined &&
          data.network.total_rx_speed !== undefined
        ) {
          // 如果是服务器原始数据格式（total_tx_speed/total_rx_speed）
          txSpeedKB = parseFloat(data.network.total_tx_speed) || 0;
          rxSpeedKB = parseFloat(data.network.total_rx_speed) || 0;
        }

        // 转换为 B/s 以保持与工具栏一致
        const txSpeedBytes = txSpeedKB * 1024;
        const rxSpeedBytes = rxSpeedKB * 1024;

        uploadData.push(txSpeedBytes);
        downloadData.push(rxSpeedBytes);
        if (uploadData.length > 20) {
          uploadData.shift();
          downloadData.shift();
        }
      }
    } catch (error) {
      log.warn('[监控] 更新历史数据失败:', error);
    }
  }

  /**
   * 验证监控数据是否有效
   * @param {Object} data - 监控数据
   * @returns {boolean} 是否有效
   * @private
   */
  _isValidMonitoringData(data) {
    if (!data || typeof data !== 'object') {
      return false;
    }

    // 检查是否有任何有意义的监控数据
    return !!(
      (data.cpu && Object.keys(data.cpu).length > 0) ||
      (data.memory && Object.keys(data.memory).length > 0) ||
      (data.disk && Object.keys(data.disk).length > 0) ||
      (data.network && Object.keys(data.network).length > 0) ||
      (data.os && Object.keys(data.os).length > 0) ||
      (data.swap && Object.keys(data.swap).length > 0) ||
      (data.psi && Object.keys(data.psi).length > 0) ||
      (data.container && Object.keys(data.container).length > 0) ||
      (data.ip && Object.keys(data.ip).length > 0) ||
      (data.hostId && typeof data.hostId === 'string') ||
      (data.timestamp && typeof data.timestamp === 'number')
    );
  }

  /**
   * 处理监控状态
   * @param {Object} message - 状态消息
   * @private
   */
  _handleMonitoringStatus(message) {
    // 处理新的差量更新格式
    let data = message.data || message.delta?.data || message;

    // 如果是嵌套的差量格式，提取实际数据
    if (data.delta && data.delta.data) {
      data = data.delta.data;
    }

    const { status, available, hostId } = data;

    // 判断监控数据是否可用（SSH方案中status为'installed'表示数据可用）
    const installed = status === 'installed';

    // 处理状态消息（日志已移除，用户可在WebSocket中查看）

    // 防止重复处理相同的状态
    const statusKey = `${installed}-${available}-${hostId}`;
    if (this._lastStatusHash === statusKey) {
      return;
    }
    this._lastStatusHash = statusKey;

    // 触发状态变更事件
    this._emitEvent('monitoring-status-change', {
      terminalId: this.terminalId,
      hostname: this.state.targetHost,
      hostId,
      installed,
      available,
      source: 'websocket'
    });
  }

  /**
   * 处理监控断开连接
   * @param {Object} message - 断开连接消息
   * @private
   */
  _handleMonitoringDisconnected(message) {
    const data = message.data || {};
    const { hostId, reason } = data;

    log.debug(
      `[监控] 收到断开连接通知: ${hostId || this.state.targetHost}`,
      reason ? { reason } : {}
    );

    // 触发断开连接事件
    this._emitEvent('monitoring-disconnected', {
      terminalId: this.terminalId,
      host: hostId || this.state.targetHost,
      reason: reason || '服务器断开连接'
    });
  }

  /**
   * 尝试重连
   * @private
   */
  _attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts && this.state.targetHost) {
      this.reconnectAttempts++;
      setTimeout(() => {
        log.debug(
          `[监控] 尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts}): ${this.state.targetHost}`
        );
        this.connect(this.state.targetHost);
      }, this.reconnectDelay * this.reconnectAttempts);
    }
  }

  /**
   * 获取历史数据
   * @returns {Object} 历史数据
   */
  getHistoryData() {
    return {
      cpu: [...this.state.historyData.cpu],
      memory: [...this.state.historyData.memory],
      disk: [...this.state.historyData.disk],
      network: {
        upload: [...this.state.historyData.network.upload],
        download: [...this.state.historyData.network.download]
      }
    };
  }

  /**
   * 清空历史数据
   */
  clearHistoryData() {
    this.state.historyData = {
      cpu: Array(20).fill(0),
      memory: Array(20).fill(0),
      disk: Array(20).fill(0),
      network: {
        upload: Array(20).fill(0),
        download: Array(20).fill(0)
      }
    };
  }

  /**
   * 触发事件
   * @param {string} eventName - 事件名称
   * @param {Object} detail - 事件详情
   * @private
   */
  _emitEvent(eventName, detail) {
    window.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}

/**
 * 统一监控服务类
 * 简化的监控服务，整合了原有的代理和工厂模式
 */
class MonitoringService {
  constructor() {
    // 实例映射 - 存储每个终端ID对应的监控实例
    this.instances = new Map();

    // 主机级别的监控连接映射 - 存储每个主机的主监控实例
    this.hostConnections = new Map();

    // 终端到主机的映射
    this.terminalToHost = new Map();

    // 主机到终端列表的映射
    this.hostToTerminals = new Map();

    // 全局状态（向后兼容）
    this.state = {
      connected: false,
      connecting: false,
      sessionId: null,
      error: null,
      stats: {
        messagesReceived: 0,
        messagesSent: 0
      },
      lastActivity: null,
      targetHost: null,
      serverHost: null,
      systemInfo: null,
      monitorData: {
        cpu: { usage: 0, cores: 0, model: '' },
        memory: { total: 0, used: 0, free: 0, usedPercentage: 0 },
        swap: { total: 0, used: 0, free: 0, usedPercentage: 0 },
        disk: { total: 0, used: 0, free: 0, usedPercentage: 0 },
        network: {},
        os: {}
      }
    };

    // 跟踪所有尝试连接的终端，用于强制清理
    this.attemptedConnections = new Set();

    this.initialized = false;
  }

  /**
   * 初始化监控服务
   */
  init() {
    if (this.initialized) {
      return;
    }

    // 监听全局事件
    this._initEvents();

    // 初始化全局API
    this._initGlobalAPI();

    this.initialized = true;
  }

  /**
   * 初始化事件监听
   * @private
   */
  _initEvents() {
    // 移除所有全局事件监听器，现在由监控状态管理器统一处理
    // 这避免了重复的事件处理和日志输出

    // 监听终端销毁事件，立即断开对应的监控连接
    this._setupTerminalDestroyListener();

    // 添加页面卸载时的清理逻辑
    this._initPageUnloadCleanup();
  }

  /**
   * 设置终端销毁事件监听器
   * @private
   */
  _setupTerminalDestroyListener() {
    const terminalDestroyHandler = (event) => {
      const { terminalId } = event.detail || {};
      if (terminalId) {
        // 强制断开该终端的监控连接，无论SSH是否成功建立
        log.info(`[监控服务] 响应终端销毁事件，强制断开监控连接: ${terminalId}`);
        
        // 从尝试连接的跟踪集合中移除（如果存在）
        const wasAttempted = this.attemptedConnections.has(terminalId);
        if (wasAttempted) {
          this.attemptedConnections.delete(terminalId);
          log.debug(`[监控服务] 从尝试连接跟踪中移除: ${terminalId}`);
        }
        
        // 直接查找并断开该终端的实例，不依赖SSH连接状态
        const instance = this.instances.get(terminalId);
        if (instance) {
          // 找到实例，直接断开
          instance.disconnect();
          this.instances.delete(terminalId);
          
          // 从主机映射中移除
          this._removeTerminalFromHost(terminalId);
          
          // 清理主机连接记录
          const host = instance.state.targetHost;
          if (host && this.hostConnections.get(host) === instance) {
            this.hostConnections.delete(host);
            
            // 查找该主机的其他终端，选择新的主连接记录
            const terminals = this.hostToTerminals.get(host);
            if (terminals && terminals.length > 0) {
              const newMasterTerminal = terminals[0];
              const newMasterInstance = this.instances.get(newMasterTerminal);
              if (newMasterInstance && newMasterInstance.state.connected) {
                this.hostConnections.set(host, newMasterInstance);
                log.debug(`[监控服务] 选择新的主连接记录: 终端 ${newMasterTerminal} -> ${host}`);
              }
            }
          }
          
          log.info(`[监控服务] 已强制断开并清理监控实例: ${terminalId}`);
        } else if (wasAttempted) {
          log.info(`[监控服务] 终端 ${terminalId} 曾尝试连接但无实例，已从跟踪中清理`);
        } else {
          log.debug(`[监控服务] 终端 ${terminalId} 没有对应的监控实例或连接记录，无需清理`);
        }
      }
    };

    window.addEventListener('terminal:destroyed', terminalDestroyHandler);
    
    // 保存事件监听器引用，便于清理时移除
    this._terminalDestroyHandler = terminalDestroyHandler;
  }

  /**
   * 获取或创建监控实例
   * @param {string} terminalId - 终端ID
   * @returns {MonitoringInstance} 监控实例
   */
  getInstance(terminalId) {
    if (!terminalId) {
      return null;
    }

    if (!this.instances.has(terminalId)) {
      const instance = new MonitoringInstance(terminalId);
      this.instances.set(terminalId, instance);
    }

    return this.instances.get(terminalId);
  }

  /**
   * 连接到远程主机
   * @param {string} terminalId - 终端ID
   * @param {string} host - 主机地址
   * @returns {Promise<boolean>} 连接结果
   */
  async connect(terminalId, host) {
    if (!terminalId || !host) {
      return false;
    }

    // 立即添加到尝试连接的跟踪集合中，用于后续强制清理
    this.attemptedConnections.add(terminalId);

    // 获取或创建监控实例
    const instance = this.getInstance(terminalId);
    if (!instance) {
      return false;
    }

    // 记录终端到主机的映射
    this._addTerminalToHost(terminalId, host);

    // 每个终端都建立独立的WebSocket连接
    // 这确保了每个终端都能接收到完整的监控数据
    log.info(`[监控] 为终端 ${terminalId} 建立独立连接到 ${host}`);
    const connected = await instance.connect(host);

    if (connected) {
      log.info(`[监控] 终端 ${terminalId} 连接成功: ${host}`);
      // 如果这是该主机的第一个连接，记录为主连接（用于统计）
      if (!this.hostConnections.has(host)) {
        this.hostConnections.set(host, instance);
        log.debug(`[监控] 设置主连接记录: 终端 ${terminalId} -> ${host}`);
      }
    } else {
      const manualClose = instance._manualDisconnect === true;
      const errorMessage = instance.state?.error?.message || instance.state?.error || '';
      const normalizedError = typeof errorMessage === 'string' ? errorMessage.toLowerCase() : '';
      const expectedCancel =
        manualClose ||
        normalizedError.includes('cancelled') ||
        normalizedError.includes('已取消') ||
        normalizedError.includes('frontend_monitor_unsubscribed');

      if (expectedCancel) {
        log.debug(`[监控] 终端 ${terminalId} 取消监控连接: ${host}`);
      } else {
        log.warn(`[监控] 终端 ${terminalId} 连接失败: ${host}`);
      }
    }

    return connected;
  }

  /**
   * 断开指定终端的监控连接
   * @param {string} terminalId - 终端ID
   */
  disconnect(terminalId) {
    if (!terminalId) {
      return false;
    }

    const instance = this.getInstance(terminalId);
    if (!instance) {
      return false;
    }

    const host = instance.state.targetHost;

    // 断开连接
    instance.disconnect();

    // 从映射中移除
    this._removeTerminalFromHost(terminalId);

    // 如果这是主连接的记录实例，需要选择新的主连接或清除主机连接
    if (host && this.hostConnections.get(host) === instance) {
      this.hostConnections.delete(host);

      // 查找该主机的其他终端，选择新的主连接记录
      const terminals = this.hostToTerminals.get(host);
      if (terminals && terminals.length > 0) {
        const newMasterTerminal = terminals[0];
        const newMasterInstance = this.getInstance(newMasterTerminal);
        if (newMasterInstance && newMasterInstance.state.connected) {
          this.hostConnections.set(host, newMasterInstance);
          log.debug(`[监控] 选择新的主连接记录: 终端 ${newMasterTerminal} -> ${host}`);
        }
      } else {
        log.debug(`[监控] 主机 ${host} 的所有连接已断开`);
      }
    }

    return true;
  }

  /**
   * 断开所有连接
   */
  disconnectAll() {
    for (const instance of this.instances.values()) {
      instance.disconnect();
    }

    this.instances.clear();
    this.hostConnections.clear();
    this.terminalToHost.clear();
    this.hostToTerminals.clear();
    this.attemptedConnections.clear(); // 清理尝试连接的跟踪

    // 移除终端销毁事件监听器
    if (this._terminalDestroyHandler) {
      window.removeEventListener('terminal:destroyed', this._terminalDestroyHandler);
      this._terminalDestroyHandler = null;
    }
  }

  /**
   * 请求系统统计信息
   * @param {string} terminalId - 终端ID
   * @returns {boolean} 是否成功发送请求
   */
  requestSystemStats(terminalId) {
    const instance = this.getInstance(terminalId);
    if (instance && instance.state.connected) {
      instance.requestSystemStats();
      return true;
    }
    return false;
  }

  /**
   * 获取监控状态
   * @param {string} terminalId - 终端ID
   * @returns {Object} 监控状态
   */
  getStatus(terminalId) {
    const instance = this.getInstance(terminalId);
    if (instance) {
      return instance.state;
    }
    return this.state; // 返回全局状态作为后备
  }

  /**
   * 检查指定终端是否正在被监控
   * @param {string} terminalId - 终端ID
   * @returns {boolean} 是否正在被监控
   */
  isTerminalMonitored(terminalId) {
    if (!terminalId) {
      return false;
    }

    // 检查是否有对应的监控实例
    const instance = this.getInstance(terminalId);
    if (!instance) {
      return false;
    }

    // 检查实例是否已连接
    if (!instance.state.connected) {
      return false;
    }

    // 检查终端是否在主机映射中（表示已建立监控关系）
    if (!this.terminalToHost.has(terminalId)) {
      return false;
    }

    // 获取终端对应的主机
    const host = this.terminalToHost.get(terminalId);

    // 检查该主机是否有活跃的监控连接
    if (!this.hostConnections.has(host)) {
      return false;
    }

    const hostInstance = this.hostConnections.get(host);

    // 检查主机的监控实例是否已连接
    if (!hostInstance || !hostInstance.state.connected) {
      return false;
    }

    // 关键检查：验证是否收到过实际的监控数据
    // 仅仅WebSocket连接成功不代表远程主机安装了监控代理
    return this._hasValidMonitoringData(hostInstance);
  }

  /**
   * 检查监控实例是否有有效的监控数据
   * @param {MonitoringInstance} instance - 监控实例
   * @returns {boolean} 是否有有效数据
   * @private
   */
  _hasValidMonitoringData(instance) {
    if (!instance || !instance.state) {
      return false;
    }

    // 检查是否有最近的活动时间
    if (!instance.state.lastActivity) {
      return false;
    }

    // 检查活动时间是否在合理范围内（5分钟内）
    const now = Date.now();
    const timeDiff = now - instance.state.lastActivity;
    if (timeDiff > 5 * 60 * 1000) {
      // 5分钟
      return false;
    }

    // 检查是否收到过有效的监控数据
    const data = instance.state.monitorData;
    if (!data) {
      return false;
    }

    // 验证关键监控数据是否非默认值
    // CPU使用率应该是有意义的数值
    if (data.cpu && typeof data.cpu.usage === 'number' && data.cpu.usage >= 0) {
      return true;
    }

    // 内存数据应该有实际值
    if (data.memory && data.memory.total > 0) {
      return true;
    }

    // 磁盘数据应该有实际值
    if (data.disk && data.disk.total > 0) {
      return true;
    }

    // 如果收到过消息但数据都是默认值，可能是连接成功但没有监控代理
    return false;
  }

  /**
   * 添加终端到主机映射
   * @param {string} terminalId - 终端ID
   * @param {string} host - 主机地址
   * @private
   */
  _addTerminalToHost(terminalId, host) {
    this.terminalToHost.set(terminalId, host);

    if (!this.hostToTerminals.has(host)) {
      this.hostToTerminals.set(host, []);
    }

    const terminals = this.hostToTerminals.get(host);
    if (!terminals.includes(terminalId)) {
      terminals.push(terminalId);
    }
  }

  /**
   * 从主机映射中移除终端
   * @param {string} terminalId - 终端ID
   * @private
   */
  _removeTerminalFromHost(terminalId) {
    const host = this.terminalToHost.get(terminalId);
    if (host) {
      this.terminalToHost.delete(terminalId);

      const terminals = this.hostToTerminals.get(host);
      if (terminals) {
        const index = terminals.indexOf(terminalId);
        if (index > -1) {
          terminals.splice(index, 1);
        }

        if (terminals.length === 0) {
          this.hostToTerminals.delete(host);
        }
      }
    }
  }

  /**
   * 获取当前活动终端ID
   * @returns {string|null} 终端ID
   * @private
   */
  _getActiveTerminalId() {
    // 尝试从全局状态获取
    if (window.terminalManager && window.terminalManager.getActiveTerminalId) {
      return window.terminalManager.getActiveTerminalId();
    }

    // 后备方案：从DOM获取
    const activeTab = document.querySelector('.terminal-tab.active');
    if (activeTab) {
      return activeTab.dataset.terminalId;
    }

    return null;
  }

  /**
   * 同步活动终端状态
   * @param {string} terminalId - 终端ID
   * @private
   */
  _syncActiveTerminalStatus(terminalId) {
    const instance = this.getInstance(terminalId);
    if (instance) {
      this.state.connected = instance.state.connected;
      this.state.connecting = instance.state.connecting;
      this.state.targetHost = instance.state.targetHost;
      this.state.error = instance.state.error;
      this.state.monitorData = { ...instance.state.monitorData };
      this.state.lastActivity = instance.state.lastActivity;
    }
  }

  /**
   * 同步监控状态到终端
   * @param {string} terminalId - 终端ID
   * @param {string} host - 主机地址
   * @param {MonitoringInstance} masterInstance - 主实例
   * @private
   */
  _syncMonitoringStatusToTerminal(terminalId, host, masterInstance) {
    // 触发数据同步事件 - 使用不同的事件名称避免与实时数据重复处理
    window.dispatchEvent(
      new CustomEvent('monitoring-data-synced', {
        detail: {
          terminalId,
          host,
          data: masterInstance.state.monitorData,
          source: 'sync'
        }
      })
    );
  }

  /**
   * 获取指定终端的历史数据
   * @param {string} terminalId - 终端ID
   * @returns {Object|null} 历史数据
   */
  getHistoryData(terminalId) {
    const instance = this.getInstance(terminalId);
    return instance ? instance.getHistoryData() : null;
  }

  /**
   * 清空指定终端的历史数据
   * @param {string} terminalId - 终端ID
   */
  clearHistoryData(terminalId) {
    const instance = this.getInstance(terminalId);
    if (instance) {
      instance.clearHistoryData();
    }
  }

  /**
   * 初始化全局API
   * @private
   */
  _initGlobalAPI() {
    window.monitoringAPI = {
      connect: this.connect.bind(this),
      disconnect: this.disconnect.bind(this),
      getStatus: this.getStatus.bind(this),
      requestSystemStats: this.requestSystemStats.bind(this),
      getHistoryData: this.getHistoryData.bind(this),
      clearHistoryData: this.clearHistoryData.bind(this)
    };
  }

  /**
   * 获取所有监控实例的统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    const stats = {
      totalInstances: this.instances.size,
      totalHosts: this.hostConnections.size,
      instances: [],
      hosts: []
    };

    // 收集实例信息
    for (const [terminalId, instance] of this.instances) {
      const host = this.terminalToHost.get(terminalId);
      stats.instances.push({
        terminalId,
        host,
        connected: instance.state.connected,
        connecting: instance.state.connecting,
        hasData: this._hasValidMonitoringData(instance),
        lastActivity: instance.state.lastActivity
      });
    }

    // 收集主机信息
    for (const [host, masterInstance] of this.hostConnections) {
      const terminals = this.hostToTerminals.get(host) || [];
      stats.hosts.push({
        host,
        masterTerminal: masterInstance.terminalId,
        connectedTerminals: terminals.length,
        connected: masterInstance.state.connected,
        lastActivity: masterInstance.state.lastActivity
      });
    }

    return stats;
  }

  /**
   * 初始化页面卸载时的清理逻辑
   * @private
   */
  _initPageUnloadCleanup() {
    try {
      // 页面卸载前清理所有监控连接
      window.addEventListener('beforeunload', () => {
        try {
          log.debug('[监控] 页面卸载，清理所有监控连接');
          this.disconnectAll();
        } catch (error) {
          log.error('[监控] 页面卸载清理失败', error);
        }
      });

      // 持续监控模式：移除页面隐藏时的连接断开逻辑
      // 监控连接将始终保持活跃，直到页面真正卸载
    } catch (error) {
      log.error('[监控] 初始化页面卸载清理逻辑失败', error);
    }
  }
}

// 创建服务实例
const monitoringService = new MonitoringService();

// 自动初始化
monitoringService.init();

// 导出服务实例
export default monitoringService;
