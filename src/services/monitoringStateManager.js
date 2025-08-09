/**
 * 监控状态管理器
 * 统一管理所有监控组件的加载状态，提供一致的用户体验
 */

import { reactive } from 'vue'
import log from '@/services/log'

// 加载状态枚举
export const LoadingState = {
  INITIAL: 'initial',        // 初始状态
  CONNECTING: 'connecting',  // 连接中
  LOADING: 'loading',        // 数据加载中
  LOADED: 'loaded',          // 已加载
  ERROR: 'error',            // 错误状态
  RECONNECTING: 'reconnecting' // 重连中
}

// 监控组件类型
export const MonitoringComponent = {
  SYSTEM_INFO: 'system_info',
  CPU: 'cpu',
  MEMORY: 'memory',
  NETWORK: 'network',
  DISK: 'disk'
}

class MonitoringStateManager {
  constructor(terminalId = null, hostId = null) {
    // 实例绑定的终端ID和主机ID
    this.boundTerminalId = terminalId
    this.boundHostId = hostId

    // 全局状态
    this.globalState = reactive({
      connectionState: LoadingState.INITIAL,
      lastActivity: null,
      errorMessage: null,
      terminalId: terminalId,
      hostId: hostId
    })

    // 各组件的状态
    this.componentStates = reactive({
      [MonitoringComponent.SYSTEM_INFO]: {
        state: LoadingState.INITIAL,
        hasData: false,
        lastUpdate: null,
        error: null
      },
      [MonitoringComponent.CPU]: {
        state: LoadingState.INITIAL,
        hasData: false,
        lastUpdate: null,
        error: null
      },
      [MonitoringComponent.MEMORY]: {
        state: LoadingState.INITIAL,
        hasData: false,
        lastUpdate: null,
        error: null
      },
      [MonitoringComponent.NETWORK]: {
        state: LoadingState.INITIAL,
        hasData: false,
        lastUpdate: null,
        error: null
      },
      [MonitoringComponent.DISK]: {
        state: LoadingState.INITIAL,
        hasData: false,
        lastUpdate: null,
        error: null
      }
    })

    // 监控数据缓存
    this.monitoringData = reactive({})

    // 事件监听器
    this.eventListeners = new Map()

    // 初始化事件监听
    this._initEventListeners()

    log.debug('[监控状态管理器] 已初始化')
  }

  /**
   * 初始化事件监听器
   * @private
   */
  _initEventListeners() {
    // 监听监控连接状态变化
    const connectionHandler = (event) => {
      const { terminalId } = event.detail
      // 只处理绑定终端的事件，如果没有绑定则处理所有事件（向后兼容）
      if (this._shouldHandleEvent(terminalId)) {
        this._handleConnectionStateChange(LoadingState.LOADED)
      }
    }

    const disconnectionHandler = (event) => {
      const { terminalId } = event.detail
      // 只处理绑定终端的事件，避免其他终端的断开事件影响当前实例
      if (this._shouldHandleEvent(terminalId)) {
        this._handleConnectionStateChange(LoadingState.ERROR, '连接已断开')
      }
    }

    // 统一的监控数据处理器 - 处理实时数据和同步数据
    const unifiedDataHandler = (event) => {
      const { terminalId, data } = event.detail
      if (this._shouldHandleEvent(terminalId)) {
        this._handleMonitoringData(data)
      }
    }

    // 监听监控状态变化
    const statusHandler = (event) => {
      const { terminalId, installed, available } = event.detail
      if (this._shouldHandleEvent(terminalId)) {
        this._handleMonitoringStatus(installed, available)
      }
    }

    // 注册事件监听器
    window.addEventListener('monitoring-connected', connectionHandler)
    window.addEventListener('monitoring-disconnected', disconnectionHandler)
    window.addEventListener('monitoring-data-received', unifiedDataHandler)
    window.addEventListener('monitoring-data-synced', unifiedDataHandler)
    window.addEventListener('monitoring-status-change', statusHandler)

    // 保存监听器引用以便清理
    this.eventListeners.set('connection', connectionHandler)
    this.eventListeners.set('disconnection', disconnectionHandler)
    this.eventListeners.set('data', unifiedDataHandler)
    this.eventListeners.set('sync', unifiedDataHandler)
    this.eventListeners.set('status', statusHandler)
  }

  /**
   * 设置当前终端ID
   * @param {string} terminalId 终端ID
   * @param {string} hostId 主机ID
   */
  setTerminal(terminalId, hostId = null) {
    if (this.globalState.terminalId !== terminalId) {
      log.debug('[监控状态管理器] 切换终端', { from: this.globalState.terminalId, to: terminalId })

      // 重置状态
      this._resetStates()

      this.globalState.terminalId = terminalId
      this.globalState.hostId = hostId
      // 保持 INITIAL 状态，等待监控服务主动连接
      this.globalState.connectionState = LoadingState.INITIAL
    }
  }

  /**
   * 重置所有状态
   * @private
   */
  _resetStates() {
    this.globalState.connectionState = LoadingState.INITIAL
    this.globalState.lastActivity = null
    this.globalState.errorMessage = null

    Object.keys(this.componentStates).forEach(component => {
      this.componentStates[component] = {
        state: LoadingState.INITIAL,
        hasData: false,
        lastUpdate: null,
        error: null
      }
    })

    // 清空监控数据缓存
    Object.keys(this.monitoringData).forEach(key => {
      delete this.monitoringData[key]
    })
  }

  /**
   * 处理连接状态变化
   * @param {string} state 新状态
   * @param {string} errorMessage 错误消息
   * @private
   */
  _handleConnectionStateChange(state, errorMessage = null) {
    this.globalState.connectionState = state
    this.globalState.errorMessage = errorMessage
    this.globalState.lastActivity = Date.now()

    if (state === LoadingState.LOADED) {
      // 连接成功，设置所有组件为加载中状态
      Object.keys(this.componentStates).forEach(component => {
        if (this.componentStates[component].state === LoadingState.INITIAL) {
          this.componentStates[component].state = LoadingState.LOADING
        }
      })
    } else if (state === LoadingState.ERROR) {
      // 连接失败，设置所有组件为错误状态
      Object.keys(this.componentStates).forEach(component => {
        this.componentStates[component].state = LoadingState.ERROR
        this.componentStates[component].error = errorMessage
      })
    }

    log.debug('[监控状态管理器] 连接状态变化', { state, errorMessage })
  }

  /**
   * 处理监控数据
   * @param {Object} data 监控数据
   * @private
   */
  _handleMonitoringData(data) {
    if (!data) return

    // 防止重复处理相同的数据（排除时间戳字段，基于实际监控数据内容）
    const { timestamp, ...dataWithoutTimestamp } = data
    const dataHash = JSON.stringify(dataWithoutTimestamp)

    if (this._lastDataHash === dataHash) {
      return
    }

    this._lastDataHash = dataHash

    this.globalState.lastActivity = Date.now()

    // 更新监控数据缓存
    Object.assign(this.monitoringData, data)

    // 根据数据内容更新各组件状态
    this._updateComponentStates(data)

    // 监控数据更新日志已简化，减少日志噪音
  }

  /**
   * 处理监控状态
   * @param {boolean} installed 是否已安装
   * @param {boolean} available 是否可用
   * @private
   */
  _handleMonitoringStatus(installed, available) {
    if (installed && available) {
      this.globalState.connectionState = LoadingState.LOADED
      this.globalState.errorMessage = null
    } else {
      this.globalState.connectionState = LoadingState.ERROR
      this.globalState.errorMessage = '监控服务不可用'
    }

    log.debug('[监控状态管理器] 监控状态变化', { installed, available })
  }

  /**
   * 根据数据内容更新组件状态
   * @param {Object} data 监控数据
   * @private
   */
  _updateComponentStates(data) {
    const now = Date.now()

    // 系统信息 - 检测更多可能的系统信息字段
    const hasSystemInfo = data.system || data.hostname || data.uptime || data.machineId ||
        data.os || data.timestamp || data.bootTime || data.loadAverage ||
        (data.cpu && data.cpu.model)

    if (hasSystemInfo) {
      this._updateComponentState(MonitoringComponent.SYSTEM_INFO, true, now)
      // 系统信息数据检测日志已移除，减少日志噪音
    }

    // CPU数据
    if (data.cpu && (data.cpu.usage !== undefined || data.cpu.usedPercentage !== undefined)) {
      this._updateComponentState(MonitoringComponent.CPU, true, now)
    }

    // 内存数据
    if (data.memory && (data.memory.used !== undefined || data.memory.total !== undefined)) {
      this._updateComponentState(MonitoringComponent.MEMORY, true, now)
    }

    // 网络数据
    if (data.network && (data.network.total_tx_speed !== undefined || data.network.total_rx_speed !== undefined)) {
      this._updateComponentState(MonitoringComponent.NETWORK, true, now)
    }

    // 硬盘数据
    if (data.disk && (data.disk.used !== undefined || data.disk.total !== undefined)) {
      this._updateComponentState(MonitoringComponent.DISK, true, now)
    }
  }

  /**
   * 更新单个组件状态
   * @param {string} component 组件类型
   * @param {boolean} hasData 是否有数据
   * @param {number} timestamp 时间戳
   * @private
   */
  _updateComponentState(component, hasData, timestamp) {
    if (this.componentStates[component]) {
      this.componentStates[component].hasData = hasData
      this.componentStates[component].lastUpdate = timestamp
      this.componentStates[component].state = hasData ? LoadingState.LOADED : LoadingState.LOADING
      this.componentStates[component].error = null
    }
  }

  /**
   * 获取组件状态
   * @param {string} component 组件类型
   * @returns {Object} 组件状态
   */
  getComponentState(component) {
    return this.componentStates[component] || {
      state: LoadingState.INITIAL,
      hasData: false,
      lastUpdate: null,
      error: null
    }
  }

  /**
   * 获取全局状态
   * @returns {Object} 全局状态
   */
  getGlobalState() {
    return this.globalState
  }

  /**
   * 获取监控数据
   * @returns {Object} 监控数据
   */
  getMonitoringData() {
    return this.monitoringData
  }

  /**
   * 检查是否有任何数据
   * @returns {boolean} 是否有数据
   */
  hasAnyData() {
    return Object.values(this.componentStates).some(state => state.hasData)
  }

  /**
   * 检查是否所有组件都已加载
   * @returns {boolean} 是否全部加载完成
   */
  isAllLoaded() {
    return Object.values(this.componentStates).every(state =>
      state.state === LoadingState.LOADED || state.hasData
    )
  }

  /**
   * 获取整体加载进度
   * @returns {number} 加载进度 (0-100)
   */
  getLoadingProgress() {
    const totalComponents = Object.keys(this.componentStates).length
    const loadedComponents = Object.values(this.componentStates).filter(state =>
      state.state === LoadingState.LOADED || state.hasData
    ).length

    return Math.round((loadedComponents / totalComponents) * 100)
  }

  /**
   * 手动设置组件错误状态
   * @param {string} component 组件类型
   * @param {string} error 错误消息
   */
  setComponentError(component, error) {
    if (this.componentStates[component]) {
      this.componentStates[component].state = LoadingState.ERROR
      this.componentStates[component].error = error
      this.componentStates[component].hasData = false
    }
  }

  /**
   * 重试连接
   */
  retry() {
    log.info('[监控状态管理器] 重试连接')
    this.globalState.connectionState = LoadingState.RECONNECTING
    this.globalState.errorMessage = null

    // 重置组件状态为加载中
    Object.keys(this.componentStates).forEach(component => {
      if (this.componentStates[component].state === LoadingState.ERROR) {
        this.componentStates[component].state = LoadingState.LOADING
        this.componentStates[component].error = null
      }
    })
  }

  /**
   * 设置终端绑定
   * @param {string} terminalId - 终端ID
   * @param {string} hostId - 主机ID（可选）
   */
  setTerminal(terminalId, hostId = null) {
    this.boundTerminalId = terminalId
    this.boundHostId = hostId
    this.globalState.terminalId = terminalId
    this.globalState.hostId = hostId

    log.debug(`[监控状态管理器] 已绑定终端: ${terminalId}${hostId ? ` (主机: ${hostId})` : ''}`)
  }

  /**
   * 获取绑定的终端ID
   * @returns {string|null} 终端ID
   */
  getBoundTerminalId() {
    return this.boundTerminalId
  }

  /**
   * 获取绑定的主机ID
   * @returns {string|null} 主机ID
   */
  getBoundHostId() {
    return this.boundHostId
  }

  /**
   * 检查是否应该处理指定终端的事件
   * @param {string} eventTerminalId - 事件中的终端ID
   * @returns {boolean} 是否应该处理
   * @private
   */
  _shouldHandleEvent(eventTerminalId) {
    // 如果没有绑定终端，则处理所有事件（向后兼容单例模式）
    if (!this.boundTerminalId) {
      return eventTerminalId === this.globalState.terminalId
    }

    // 如果有绑定终端，只处理绑定终端的事件
    return eventTerminalId === this.boundTerminalId
  }

  /**
   * 检查实例是否绑定到指定终端
   * @param {string} terminalId - 终端ID
   * @returns {boolean} 是否绑定
   */
  isBoundTo(terminalId) {
    return this.boundTerminalId === terminalId
  }

  /**
   * 清理资源
   */
  destroy() {
    // 移除事件监听器
    this.eventListeners.forEach((handler, eventType) => {
      const eventName = {
        'connection': 'monitoring-connected',
        'disconnection': 'monitoring-disconnected',
        'data': 'monitoring-data-received',
        'sync': 'monitoring-data-synced',
        'status': 'monitoring-status-change'
      }[eventType]

      if (eventName) {
        window.removeEventListener(eventName, handler)
      }
    })

    this.eventListeners.clear()
    log.debug(`[监控状态管理器] 已清理资源${this.boundTerminalId ? ` (终端: ${this.boundTerminalId})` : ''}`)
  }
}

// 导出类供工厂使用
export { MonitoringStateManager }

// 创建单例实例（向后兼容）
const monitoringStateManager = new MonitoringStateManager()

export default monitoringStateManager
