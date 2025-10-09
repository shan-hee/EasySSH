/**
 * 监控状态管理器
 * 统一管理所有监控组件的加载状态，提供一致的用户体验
 */

import { reactive } from 'vue';
import log from '@/services/log';
import { EVENTS } from '@/services/events';

// 加载状态枚举
export const LoadingState = {
  INITIAL: 'initial', // 初始状态
  CONNECTING: 'connecting', // 连接中
  LOADING: 'loading', // 数据加载中
  LOADED: 'loaded', // 已加载
  ERROR: 'error', // 错误状态
  RECONNECTING: 'reconnecting' // 重连中
};

// 监控组件类型
export const MonitoringComponent = {
  SYSTEM_INFO: 'system_info',
  CPU: 'cpu',
  MEMORY: 'memory',
  NETWORK: 'network',
  DISK: 'disk'
};

type LoadingStateKey = keyof typeof LoadingState;
type LoadingStateValue = typeof LoadingState[LoadingStateKey];
type MonitoringComponentKey = keyof typeof MonitoringComponent;
type MonitoringComponentValue = typeof MonitoringComponent[MonitoringComponentKey];

class MonitoringStateManager {
  private boundTerminalId: string | null;
  private boundHostId: string | null;
  public globalState: any;
  public componentStates: Record<string, { state: LoadingStateValue; hasData: boolean; lastUpdate: number | null; error: string | null }>;
  public monitoringData: Record<string, any>;
  private eventListeners: Map<string, (e: Event) => void>;
  private _lastDataHash: string | null;
  private _hasReceivedData: boolean;
  private _lastEventTerminalId: string | null;

  constructor(terminalId: string | null = null, hostId: string | null = null) {
    // 实例绑定的终端ID和主机ID
    this.boundTerminalId = terminalId;
    this.boundHostId = hostId;

    // 全局状态
    this.globalState = reactive({
      connectionState: LoadingState.CONNECTING,
      lastActivity: Date.now(),
      errorMessage: null,
      terminalId,
      hostId
    });

    // 各组件的状态
    this.componentStates = reactive({
      [MonitoringComponent.SYSTEM_INFO]: {
        state: LoadingState.LOADING,
        hasData: false,
        lastUpdate: null,
        error: null
      },
      [MonitoringComponent.CPU]: {
        state: LoadingState.LOADING,
        hasData: false,
        lastUpdate: null,
        error: null
      },
      [MonitoringComponent.MEMORY]: {
        state: LoadingState.LOADING,
        hasData: false,
        lastUpdate: null,
        error: null
      },
      [MonitoringComponent.NETWORK]: {
        state: LoadingState.LOADING,
        hasData: false,
        lastUpdate: null,
        error: null
      },
      [MonitoringComponent.DISK]: {
        state: LoadingState.LOADING,
        hasData: false,
        lastUpdate: null,
        error: null
      }
    });

    // 监控数据缓存
    this.monitoringData = reactive({});

    // 事件监听器
    this.eventListeners = new Map();

    // 日志优化相关状态
    this._lastDataHash = null;
    this._hasReceivedData = false;
    this._lastEventTerminalId = null;

    // 初始化事件监听
    this._initEventListeners();

    // 监控状态管理器已初始化
  }

  /**
   * 初始化事件监听器
   * @private
   */
  _initEventListeners() {
    // 监听监控连接状态变化
    const connectionHandler = (event: Event) => {
      const { terminalId } = (event as CustomEvent<any>).detail || {};
      // 只处理绑定终端的事件，如果没有绑定则处理所有事件（向后兼容）
      if (this._shouldHandleEvent(terminalId)) {
        this._handleConnectionStateChange(LoadingState.LOADED);
      }
    };

    const disconnectionHandler = (event: Event) => {
      const { terminalId } = (event as CustomEvent<any>).detail || {};
      // 只处理绑定终端的事件，避免其他终端的断开事件影响当前实例
      if (this._shouldHandleEvent(terminalId)) {
        this._handleConnectionStateChange(LoadingState.ERROR, '连接已断开');
      }
    };

    // 统一的监控数据处理器 - 处理实时数据和同步数据
    const unifiedDataHandler = (event: Event) => {
      const { terminalId, data } = (event as CustomEvent<any>).detail || {};

      // 处理监控数据事件（日志已移除，用户可在WebSocket中查看）
      if (this._shouldHandleEvent(terminalId)) {
        this._handleMonitoringData(data);
      }
    };

    // 监听监控状态变化
    const statusHandler = (event: Event) => {
      const { terminalId, installed, available } = (event as CustomEvent<any>).detail || {};
      if (this._shouldHandleEvent(terminalId)) {
        this._handleMonitoringStatus(installed, available);
      }
    };

    // 注册事件监听器（常量化）
    window.addEventListener(EVENTS.MONITORING_CONNECTED, connectionHandler);
    window.addEventListener(EVENTS.MONITORING_DISCONNECTED, disconnectionHandler);
    window.addEventListener(EVENTS.MONITORING_DATA_RECEIVED, unifiedDataHandler);
    window.addEventListener(EVENTS.MONITORING_DATA_SYNCED, unifiedDataHandler);
    window.addEventListener(EVENTS.MONITORING_STATUS_CHANGE, statusHandler);

    // 保存监听器引用以便清理
    this.eventListeners.set('connection', connectionHandler);
    this.eventListeners.set('disconnection', disconnectionHandler);
    this.eventListeners.set('data', unifiedDataHandler);
    this.eventListeners.set('sync', unifiedDataHandler);
    this.eventListeners.set('status', statusHandler);
  }

  /**
   * 设置当前终端ID
   * @param {string} terminalId 终端ID
   * @param {string} hostId 主机ID
   */
  setTerminal(terminalId: string, hostId: string | null = null): void {
    if (this.globalState.terminalId !== terminalId) {
      // 切换终端

      // 重置状态
      this._resetStates();

      this.globalState.terminalId = terminalId;
      this.globalState.hostId = hostId;
      // 设置为连接中状态，显示加载指示器
      this.globalState.connectionState = LoadingState.CONNECTING;
      this.globalState.lastActivity = Date.now();
    }
  }

  /**
   * 重置所有状态
   * @private
   */
  _resetStates(): void {
    this.globalState.connectionState = LoadingState.CONNECTING;
    this.globalState.lastActivity = Date.now();
    this.globalState.errorMessage = null;

    Object.keys(this.componentStates).forEach(component => {
      this.componentStates[component] = {
        state: LoadingState.LOADING,
        hasData: false,
        lastUpdate: null,
        error: null
      };
    });

    // 清空监控数据缓存
    Object.keys(this.monitoringData).forEach(key => {
      delete this.monitoringData[key];
    });
  }

  /**
   * 处理连接状态变化
   * @param {string} state 新状态
   * @param {string} errorMessage 错误消息
   * @private
   */
  _handleConnectionStateChange(state: LoadingStateValue, errorMessage: string | null = null): void {
    this.globalState.connectionState = state;
    this.globalState.errorMessage = errorMessage;
    this.globalState.lastActivity = Date.now();

    if (state === LoadingState.LOADED) {
      // 连接成功，设置所有组件为加载中状态
      Object.keys(this.componentStates).forEach(component => {
        if (this.componentStates[component].state === LoadingState.INITIAL) {
          this.componentStates[component].state = LoadingState.LOADING;
        }
      });
    } else if (state === LoadingState.ERROR) {
      // 连接失败，设置所有组件为错误状态
      Object.keys(this.componentStates).forEach(component => {
        this.componentStates[component].state = LoadingState.ERROR;
        this.componentStates[component].error = errorMessage;
      });
    }

    // 连接状态变化
  }

  /**
   * 处理监控数据
   * @param {Object} data 监控数据
   * @private
   */
  _handleMonitoringData(data: any): void {
    if (!data) return;

    // 防止重复处理相同的数据（排除时间戳字段，基于实际监控数据内容）
    const { timestamp: _timestamp, ...dataWithoutTimestamp } = data;
    const dataHash = JSON.stringify(dataWithoutTimestamp);

    if (this._lastDataHash === dataHash) {
      return;
    }

    this._lastDataHash = dataHash;

    this.globalState.lastActivity = Date.now();

    // 更新监控数据缓存
    Object.assign(this.monitoringData, data);

    // 根据数据内容更新各组件状态
    this._updateComponentStates(data);

    // 监控数据更新日志已简化，减少日志噪音
  }

  /**
   * 处理监控状态
   * @param {boolean} installed 是否已安装
   * @param {boolean} available 是否可用
   * @private
   */
  _handleMonitoringStatus(installed: boolean, available: boolean): void {
    const newState = installed && available ? LoadingState.LOADED : LoadingState.ERROR;
    const newErrorMessage = installed && available ? null : '监控服务不可用';

    // 避免重复处理相同的状态
    if (
      this.globalState.connectionState === newState &&
      this.globalState.errorMessage === newErrorMessage
    ) {
      return;
    }

    this.globalState.connectionState = newState;
    this.globalState.errorMessage = newErrorMessage;

    if (installed && available) {
      // 更新所有组件状态为已加载
      Object.values(MonitoringComponent).forEach(component => {
        if (this.componentStates[component]) {
          this.componentStates[component].state = LoadingState.LOADED;
          this.componentStates[component].hasData = true;
          this.componentStates[component].error = null;
        }
      });
    }

    // 监控状态变化
  }

  /**
   * 处理监控状态消息（新格式）
   * @param {Object} statusData 状态数据
   * @private
   */
  _handleMonitoringStatusMessage(statusData: any): void {
    // 处理差量更新格式
    let actualData = statusData;
    if (statusData.delta && statusData.delta.data) {
      actualData = statusData.delta.data;
    } else if (statusData.data) {
      actualData = statusData.data;
    }

    const installed = actualData.status === 'installed';
    const available = actualData.available === true;

    // 处理状态消息

    this._handleMonitoringStatus(installed, available);
  }

  /**
   * 根据数据内容更新组件状态
   * @param {Object} data 监控数据
   * @private
   */
  _updateComponentStates(data: any): void {
    const now = Date.now();

    // 系统信息 - 检测更多可能的系统信息字段
    const hasSystemInfo =
      data.system ||
      data.hostname ||
      data.uptime ||
      data.machineId ||
      data.os ||
      data.timestamp ||
      data.bootTime ||
      data.loadAverage ||
      (data.cpu && data.cpu.model);

    if (hasSystemInfo) {
      this._updateComponentState(MonitoringComponent.SYSTEM_INFO, true, now);
      // 系统信息数据检测日志已移除，减少日志噪音
    }

    // CPU数据
    if (data.cpu && (data.cpu.usage !== undefined || data.cpu.usedPercentage !== undefined)) {
      this._updateComponentState(MonitoringComponent.CPU, true, now);
    }

    // 内存数据
    if (data.memory && (data.memory.used !== undefined || data.memory.total !== undefined)) {
      this._updateComponentState(MonitoringComponent.MEMORY, true, now);
    }

    // 网络数据
    if (
      data.network &&
      (data.network.total_tx_speed !== undefined || data.network.total_rx_speed !== undefined)
    ) {
      this._updateComponentState(MonitoringComponent.NETWORK, true, now);
    }

    // 硬盘数据
    if (data.disk && (data.disk.used !== undefined || data.disk.total !== undefined)) {
      this._updateComponentState(MonitoringComponent.DISK, true, now);
    }
  }

  /**
   * 更新单个组件状态
   * @param {string} component 组件类型
   * @param {boolean} hasData 是否有数据
   * @param {number} timestamp 时间戳
   * @private
   */
  _updateComponentState(component: MonitoringComponentValue, hasData: boolean, timestamp: number): void {
    if (this.componentStates[component]) {
      this.componentStates[component].hasData = hasData;
      this.componentStates[component].lastUpdate = timestamp;
      this.componentStates[component].state = hasData ? LoadingState.LOADED : LoadingState.LOADING;
      this.componentStates[component].error = null;
    }
  }

  /**
   * 获取组件状态
   * @param {string} component 组件类型
   * @returns {Object} 组件状态
   */
  getComponentState(component: MonitoringComponentValue) {
    return (
      this.componentStates[component] || {
        state: LoadingState.INITIAL,
        hasData: false,
        lastUpdate: null,
        error: null
      }
    );
  }

  /**
   * 获取全局状态
   * @returns {Object} 全局状态
   */
  getGlobalState() {
    return this.globalState;
  }

  /**
   * 获取监控数据
   * @returns {Object} 监控数据
   */
  getMonitoringData() {
    return this.monitoringData;
  }

  /**
   * 检查是否有任何数据
   * @returns {boolean} 是否有数据
   */
  hasAnyData(): boolean {
    return Object.values(this.componentStates).some(state => state.hasData);
  }

  /**
   * 检查是否所有组件都已加载
   * @returns {boolean} 是否全部加载完成
   */
  isAllLoaded(): boolean {
    return Object.values(this.componentStates).every(
      state => state.state === LoadingState.LOADED || state.hasData
    );
  }

  /**
   * 获取整体加载进度
   * @returns {number} 加载进度 (0-100)
   */
  getLoadingProgress(): number {
    const totalComponents = Object.keys(this.componentStates).length;
    const loadedComponents = Object.values(this.componentStates).filter(
      state => state.state === LoadingState.LOADED || state.hasData
    ).length;

    return Math.round((loadedComponents / totalComponents) * 100);
  }

  /**
   * 手动设置组件错误状态
   * @param {string} component 组件类型
   * @param {string} error 错误消息
   */
  setComponentError(component: MonitoringComponentValue, error: string): void {
    if (this.componentStates[component]) {
      this.componentStates[component].state = LoadingState.ERROR;
      this.componentStates[component].error = error;
      this.componentStates[component].hasData = false;
    }
  }

  /**
   * 重试连接
   */
  retry(): void {
    log.info('[监控状态管理器] 重试连接');
    this.globalState.connectionState = LoadingState.RECONNECTING;
    this.globalState.errorMessage = null;

    // 重置组件状态为加载中
    Object.keys(this.componentStates).forEach(component => {
      if (this.componentStates[component].state === LoadingState.ERROR) {
        this.componentStates[component].state = LoadingState.LOADING;
        this.componentStates[component].error = null;
      }
    });
  }

  /**
   * 设置终端绑定
   * @param {string} terminalId - 终端ID
   * @param {string} hostId - 主机ID（可选）
   */
  bindTerminal(terminalId: string, hostId: string | null = null): void {
    // 避免重复绑定相同的终端
    if (this.boundTerminalId === terminalId && this.boundHostId === hostId) {
      return;
    }

    this.boundTerminalId = terminalId;
    this.boundHostId = hostId;
    this.globalState.terminalId = terminalId;
    this.globalState.hostId = hostId;

    // 已绑定终端
  }

  /**
   * 获取绑定的终端ID
   * @returns {string|null} 终端ID
   */
  getBoundTerminalId(): string | null {
    return this.boundTerminalId;
  }

  /**
   * 获取绑定的主机ID
   * @returns {string|null} 主机ID
   */
  getBoundHostId(): string | null {
    return this.boundHostId;
  }

  /**
   * 检查是否应该处理指定终端的事件
   * @param {string} eventTerminalId - 事件中的终端ID
   * @returns {boolean} 是否应该处理
   * @private
   */
  _shouldHandleEvent(eventTerminalId: string): boolean {
    // 如果没有绑定终端，则处理所有事件（向后兼容单例模式）
    if (!this.boundTerminalId) {
      return eventTerminalId === this.globalState.terminalId;
    }

    // 如果有绑定终端，只处理绑定终端的事件
    return eventTerminalId === this.boundTerminalId;
  }

  /**
   * 检查实例是否绑定到指定终端
   * @param {string} terminalId - 终端ID
   * @returns {boolean} 是否绑定
   */
  isBoundTo(terminalId: string): boolean {
    return this.boundTerminalId === terminalId;
  }

  /**
   * 清理资源
   */
  destroy(): void {
    // 移除事件监听器
    this.eventListeners.forEach((handler, eventType) => {
      const eventName = {
        connection: EVENTS.MONITORING_CONNECTED,
        disconnection: EVENTS.MONITORING_DISCONNECTED,
        data: EVENTS.MONITORING_DATA_RECEIVED,
        sync: EVENTS.MONITORING_DATA_SYNCED,
        status: EVENTS.MONITORING_STATUS_CHANGE
      }[eventType];

      if (eventName) {
        window.removeEventListener(eventName, handler);
      }
    });

    this.eventListeners.clear();
    // 已清理资源
  }
}

// 导出类供工厂使用
export { MonitoringStateManager };

// 创建单例实例（向后兼容）
const monitoringStateManager = new MonitoringStateManager();

export default monitoringStateManager;
