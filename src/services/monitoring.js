/**
 * 统一监控服务
 * 简化的监控WebSocket客户端服务，整合了原有的代理和工厂模式
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
      }
    };
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    this.reconnectDelay = 2000;
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

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsHost = window.location.host;
      const wsUrl = `${protocol}//${wsHost}/monitor?subscribe=${encodeURIComponent(host)}`;

      this.websocket = new WebSocket(wsUrl);

      this.websocket.onopen = () => {
        this.state.connected = true;
        this.state.connecting = false;
        this.reconnectAttempts = 0;
        log.info(`[监控] 连接成功: ${host}`);

        // 触发连接成功事件
        this._emitEvent('monitoring-connected', {
          terminalId: this.terminalId,
          host: host
        });
      };

      this.websocket.onmessage = (event) => {
        this._handleMessage(event.data);
      };

      this.websocket.onclose = () => {
        this.state.connected = false;
        this.state.connecting = false;

        // 触发断开连接事件
        this._emitEvent('monitoring-disconnected', {
          terminalId: this.terminalId,
          host: host
        });

        // 尝试重连
        this._attemptReconnect();
      };

      this.websocket.onerror = (error) => {
        this.state.error = error;
        this.state.connecting = false;
        log.error(`[监控] 连接错误: ${host}`, error);
      };

      // 等待连接建立
      return new Promise((resolve) => {
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
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }
    this.state.connected = false;
    this.state.connecting = false;
    this.reconnectAttempts = 0;
  }

  /**
   * 请求系统统计信息
   */
  requestSystemStats() {
    if (this.state.connected && this.websocket) {
      this.websocket.send(JSON.stringify({
        type: 'request_stats'
      }));
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
          // 收到监控数据时更新活动时间
          this.state.lastActivity = Date.now();
          break;
        case 'system_stats':
          // 处理系统统计数据
          this._handleMonitoringData(message.payload);
          // 收到系统统计数据时更新活动时间
          this.state.lastActivity = Date.now();
          break;
        case 'monitoring_status':
          this._handleMonitoringStatus(message);
          break;
        case 'session_created':
          // 会话创建确认，无需额外处理
          break;
        case 'subscribe_ack':
          // 订阅确认，无需额外处理
          break;
        case 'error':
          const errorMsg = message.message || message.data?.message || message.error || '未知错误';
          log.error(`[监控] 服务器错误: ${errorMsg}`);
          break;
        default:
          // 未知消息类型，静默忽略
          break;
      }
    } catch (error) {
      log.error('[监控] 消息解析失败', error);
    }
  }

  /**
   * 处理监控数据
   * @param {Object} data - 监控数据
   * @private
   */
  _handleMonitoringData(data) {
    if (data && this._isValidMonitoringData(data)) {
      this.state.monitorData = { ...this.state.monitorData, ...data };

      // 触发数据更新事件
      this._emitEvent('monitoring-data-received', {
        terminalId: this.terminalId,
        host: this.state.targetHost,
        data: data,
        source: 'websocket'
      });
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
    const hasCpuData = data.cpu && (
      typeof data.cpu.usage === 'number' ||
      typeof data.cpu.cores === 'number' ||
      data.cpu.model
    );

    const hasMemoryData = data.memory && (
      typeof data.memory.total === 'number' && data.memory.total > 0 ||
      typeof data.memory.used === 'number' ||
      typeof data.memory.usedPercentage === 'number'
    );

    const hasDiskData = data.disk && (
      typeof data.disk.total === 'number' && data.disk.total > 0 ||
      typeof data.disk.used === 'number' ||
      typeof data.disk.usedPercentage === 'number'
    );

    const hasNetworkData = data.network && Object.keys(data.network).length > 0;

    const hasOsData = data.os && Object.keys(data.os).length > 0;

    // 至少要有一种类型的有效数据
    return hasCpuData || hasMemoryData || hasDiskData || hasNetworkData || hasOsData;
  }

  /**
   * 处理监控状态
   * @param {Object} message - 状态消息
   * @private
   */
  _handleMonitoringStatus(message) {
    const data = message.data || {};
    const { status, available, hostId } = data;

    // 判断是否已安装
    const installed = status === 'installed';

    // 触发状态变更事件
    this._emitEvent('monitoring-status-change', {
      terminalId: this.terminalId,
      hostname: this.state.targetHost,
      hostId: hostId,
      installed: installed,
      available: available,
      source: 'websocket'
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
        log.debug(`[监控] 尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts}): ${this.state.targetHost}`);
        this.connect(this.state.targetHost);
      }, this.reconnectDelay * this.reconnectAttempts);
    }
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
    // 监听监控数据接收事件，同步到全局状态
    window.addEventListener('monitoring-data-received', (event) => {
      const { terminalId, data } = event.detail;

      // 如果是当前活动终端，更新全局状态
      if (terminalId === this._getActiveTerminalId()) {
        this.state.monitorData = { ...this.state.monitorData, ...data };
        this.state.lastActivity = Date.now();

        // 更新统计信息
        this.state.stats.messagesReceived++;
      }
    });

    // 监听连接状态变化
    window.addEventListener('monitoring-connected', (event) => {
      const { terminalId, host } = event.detail;

      if (terminalId === this._getActiveTerminalId()) {
        this.state.connected = true;
        this.state.connecting = false;
        this.state.targetHost = host;
        this.state.error = null;
      }
    });

    window.addEventListener('monitoring-disconnected', (event) => {
      const { terminalId } = event.detail;

      if (terminalId === this._getActiveTerminalId()) {
        this.state.connected = false;
        this.state.connecting = false;
      }
    });

    // 监听终端切换事件
    window.addEventListener('terminal:activated', (event) => {
      if (event.detail && event.detail.terminalId) {
        this._syncActiveTerminalStatus(event.detail.terminalId);
      }
    });
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

    // 检查是否已有到该主机的连接
    if (this.hostConnections.has(host)) {
      const masterInstance = this.hostConnections.get(host);

      // 将当前终端添加到主机的终端列表
      this._addTerminalToHost(terminalId, host);

      // 如果主连接已连接，立即同步状态到新终端
      if (masterInstance.state.connected) {
        this._syncMonitoringStatusToTerminal(terminalId, host, masterInstance);
      }

      return true;
    }

    // 获取或创建监控实例
    const instance = this.getInstance(terminalId);
    if (!instance) {
      return false;
    }

    // 将此实例设为该主机的主连接
    this.hostConnections.set(host, instance);
    this._addTerminalToHost(terminalId, host);

    // 建立实际的WebSocket连接
    return await instance.connect(host);
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

    // 如果这是主连接，需要选择新的主连接或清除主机连接
    if (host && this.hostConnections.get(host) === instance) {
      this.hostConnections.delete(host);

      // 查找该主机的其他终端，选择新的主连接
      const terminals = this.hostToTerminals.get(host);
      if (terminals && terminals.length > 0) {
        const newMasterTerminal = terminals[0];
        const newMasterInstance = this.getInstance(newMasterTerminal);
        if (newMasterInstance && newMasterInstance.state.connected) {
          this.hostConnections.set(host, newMasterInstance);
          log.debug(`选择新的主监控连接: 终端 ${newMasterTerminal} -> ${host}`);
        }
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
    if (timeDiff > 5 * 60 * 1000) { // 5分钟
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
    // 触发数据同步事件
    window.dispatchEvent(new CustomEvent('monitoring-data-received', {
      detail: {
        terminalId: terminalId,
        host: host,
        data: masterInstance.state.monitorData,
        source: 'sync'
      }
    }));
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
      requestSystemStats: this.requestSystemStats.bind(this)
    };
  }
}

// 创建服务实例
const monitoringService = new MonitoringService();

// 自动初始化
monitoringService.init();

// 导出服务实例
export default monitoringService;