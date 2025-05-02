/**
 * 监控WebSocket客户端服务
 * 用于连接到服务器的监控WebSocket
 */

import { reactive } from 'vue'
import { ElMessage } from 'element-plus'
import { wsServerConfig } from '../config/app-config'
import log from './log'
import axios from 'axios'

/**
 * 监控服务类
 * 负责与远程监控服务建立WebSocket连接，发送和接收消息
 */
class MonitoringService {
  constructor() {
    this.state = reactive({
      connected: false,
      connecting: false,
      sessionId: null,
      error: null,
      stats: {
        messagesReceived: 0,
        messagesSent: 0
      },
      lastActivity: null,
      targetHost: null, // 存储远程服务器地址（仅用于标识）
      serverHost: null,  // 项目服务器地址
      systemInfo: null, // 存储最新的系统信息
      monitorData: {
        cpu: { usage: 0, cores: 0, model: '' },
        memory: { total: 0, used: 0, free: 0, usedPercentage: 0 },
        swap: { total: 0, used: 0, free: 0, usedPercentage: 0 },
        disk: { total: 0, used: 0, free: 0, usedPercentage: 0 },
        network: {},
        os: {}
      }
    })
    
    this.ws = null
    this.messageListeners = new Map()
    this.reconnectTimeout = null
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = 5
    this.reconnectDelay = 3000 // 3秒
    this.keepAliveInterval = null
    this.keepAliveTimeout = 30000 // 30秒
    
    // 获取配置中的端口
    const { port } = wsServerConfig
    this.port = port
    
    // 使用当前网页的服务器地址（项目服务器）
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.hostname
    this.serverHost = host
    this.serverPort = window.location.port || port

    // 初始化标志
    this.initialized = false

    // 添加终端ID与监控状态的映射
    this.terminalMonitoringStatus = new Map();
    
    // 初始化连接
    this.initializeConnection()
  }

  /**
   * 初始化连接
   * 添加全局事件监听器和自动连接逻辑
   */
  initializeConnection() {
    // 监听全局触发连接事件
    window.addEventListener('monitoring-connect', (event) => {
      if (event.detail && event.detail.host) {
        this.connect(event.detail.host)
      }
    })

    // 监听全局触发断开事件
    window.addEventListener('monitoring-disconnect', () => {
      this.disconnect()
    })
    
    // 监听切换监控面板事件
    window.addEventListener('toggle-monitoring-panel', (event) => {
      log.info('[监控服务] 收到切换监控面板事件')
      
      // 检查监控面板是否已显示
      const monitoringPanelExists = document.querySelector('.monitoring-panel-container')
      if (monitoringPanelExists) {
        log.info('[监控服务] 监控面板已显示，不重复触发')
        return
      }
      
      // 如果已经连接且有目标主机，触发显示监控面板事件
      if (this.state.connected && this.state.targetHost) {
        // 触发显示监控面板事件
        window.dispatchEvent(new CustomEvent('show-monitoring-panel', { 
          detail: { 
            host: this.state.targetHost,
            installed: true
          }
        }))
      } else {
        // 如果未连接，尝试获取当前主机
        const currentHost = this._getCurrentHost()
        if (currentHost) {
          // 尝试连接
          this.connect(currentHost).then(connected => {
            // 连接成功后触发显示面板事件
            window.dispatchEvent(new CustomEvent('show-monitoring-panel', { 
              detail: { 
                host: currentHost,
                installed: connected
              }
            }))
          })
        }
      }
    })
    
    // 服务初始化时，尝试自动连接
    this.autoConnect()
  }
  
  /**
   * 自动连接
   * 尝试从存储中恢复上次的连接
   */
  async autoConnect() {
    try {
      // 从sessionStorage中获取上次连接的主机
      const lastTarget = sessionStorage.getItem('monitoring_last_target')
      if (lastTarget) {
        log.info(`[监控服务] 尝试自动连接到上次的监控目标: ${lastTarget}`)
        
        // 直接尝试连接，不再执行健康检查
        this.connect(lastTarget).then(connected => {
          if (connected) {
            log.info(`[监控服务] 成功连接到监控目标: ${lastTarget}`)
            
            // 通知系统监控服务已连接
            window.dispatchEvent(new CustomEvent('monitoring-status-change', { 
              detail: { installed: true, host: lastTarget }
            }))
          } else {
            log.info(`[监控服务] 连接到监控目标失败: ${lastTarget}`)
          }
        })
      }
    } catch (error) {
      log.error('[监控服务] 自动连接失败:', error)
    }
  }

  /**
   * 初始化监控服务
   */
  init() {
    if (this.initialized) {
      log.debug('监控服务已初始化，跳过重复初始化')
      return true
    }
    
    // 监听SSH连接事件，自动启动监控（保留为兼容旧方式）
    this.initialized = true
    
    // 等待其他服务初始化完成
    window.addEventListener('services:ready', (event) => {
      log.debug('其他服务已就绪，完成监控服务初始化')
      // 可以在这里执行依赖其他服务的操作
    })
    
    log.info('监控服务初始化完成，可通过WebSocket连接到远程系统监控')
    
    // 添加一个方法，可以在创建SSH会话的同时连接监控服务
    // 这个方法可以被SSH服务调用
    this.connectToHostWithStatus = (host) => {
      if (!host) {
        return Promise.resolve(false)
      }
      
      // 静默连接，不输出调试信息
      return this.connect(host).then(connected => {
        // 只在状态变化时触发事件，不输出任何日志
        window.dispatchEvent(new CustomEvent('monitoring-status-change', { 
          detail: { installed: connected, host }
        }))
        
        return connected
      })
      .catch(() => {
        // 静默处理错误，触发状态事件
        window.dispatchEvent(new CustomEvent('monitoring-status-change', { 
          detail: { installed: false, host }
        }))
        
        return false
      })
    }
    
    // 全局API，使SSH会话创建和监控连接同步进行
    window.monitoringAPI = {
      connect: this.connectToHostWithStatus.bind(this),
      getStatus: () => this.state
    }
    
    return true
  }

  /**
   * 从存储中获取当前连接的主机
   * @private
   * @returns {string|null} 主机地址或null
   */
  _getCurrentHost() {
    try {
      // 尝试从各种可能的存储位置获取主机信息
      const sessionData = sessionStorage.getItem('ssh-sessions')
      if (sessionData) {
        const sessions = JSON.parse(sessionData)
        if (sessions && sessions.length > 0) {
          // 获取第一个会话的主机地址
          return sessions[0].host || null
        }
      }

      // 从其他可能的存储位置查找
      const recentHosts = localStorage.getItem('recent-hosts')
      if (recentHosts) {
        const hosts = JSON.parse(recentHosts)
        if (hosts && hosts.length > 0) {
          return hosts[0].host || hosts[0] || null
        }
      }

      return null
    } catch (error) {
      log.error('获取当前主机失败:', error)
      return null
    }
  }

  /**
   * 打印当前监控状态到控制台
   */
  printStatus() {
    log.info('=== 监控连接状态 ===')
    log.info(`连接状态: ${this.state.connected ? '已连接' : (this.state.connecting ? '连接中' : '未连接')}`)
    log.info(`目标主机: ${this.state.targetHost || '无'}`)
    log.info(`会话ID: ${this.state.sessionId || '无'}`)
    log.info(`错误信息: ${this.state.error || '无'}`)
    log.info(`消息统计: 已接收=${this.state.stats.messagesReceived}, 已发送=${this.state.stats.messagesSent}`)
    log.info(`最后活动: ${this.state.lastActivity ? this.state.lastActivity.toISOString() : '无'}`)
    
    if (this.state.systemInfo) {
      log.info('--- 监控数据摘要 ---')
      const data = this.state.monitorData
      log.info(`CPU: ${data.cpu.usage}% (${data.cpu.cores}核心)`)
      log.info(`内存: ${data.memory.used}/${data.memory.total}MB (${data.memory.usedPercentage}%)`)
      log.info(`磁盘: ${data.disk.used}/${data.disk.total}GB (${data.disk.usedPercentage}%)`)
    }
  }

  /**
   * 手动连接监控服务
   * @param {string} host 要监控的主机地址
   */
  connectToHost(host) {
    if (!host) {
      log.error('监控连接失败: 未指定主机地址')
      return false
    }
    
    log.info(`手动连接到监控: ${host}`)
    return this.connect(host)
  }
  
  // 构建WebSocket URL（连接到项目服务器）
  _buildWebSocketUrl(remoteHost) {
    // 使用协议
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    
    // 保存远程主机地址
    if (remoteHost) {
      this.state.targetHost = remoteHost
    }
    
    // 直接连接到远程主机的监控服务
    const remoteUrl = `${protocol}//${this.state.targetHost}:9527/monitor`
    log.info(`构建WebSocket URL: ${remoteUrl} (直接连接到远程主机)`)
    
    return remoteUrl
  }
  
  /**
   * 连接到监控WebSocket
   * @param {string} remoteHost 远程主机地址，用于标识但不用于连接
   * @returns {Promise<boolean>} 连接结果
   */
  async connect(remoteHost) {
    if (this.state.connected || this.state.connecting) {
      log.debug('监控服务已连接或正在连接中')
      log.info(`监控连接状态: ${this.state.connected ? '已连接' : '正在连接中'}`)
      
      // 如果当前连接的目标主机就是要连接的主机，直接返回true
      if (this.state.targetHost === remoteHost) {
        return this.state.connected
      }
      
      // 如果要连接的主机与当前连接的主机不同，先断开当前连接
      if (this.state.connected && this.state.targetHost !== remoteHost) {
        await this.disconnect()
      } else {
        return this.state.connected
      }
    }
    
    try {
      this.state.connecting = true
      this.state.error = null
      
      // 构建WebSocket URL (连接到项目服务器)
      const url = this._buildWebSocketUrl(remoteHost)
      log.debug(`正在连接到监控WebSocket服务: ${url}`)
      log.info(`正在连接到监控服务: ${url}`)
      
      return new Promise((resolve, reject) => {
        try {
          this.ws = new WebSocket(url)
          
          this.ws.onopen = () => {
            log.debug(`监控WebSocket连接已建立，监控远程主机: ${this.state.targetHost || 'unknown'}`)
            log.info(`监控连接成功: 已连接到 ${this.state.targetHost || 'unknown'}`)
            this.state.connected = true
            this.state.connecting = false
            this.state.lastActivity = new Date()
            this.reconnectAttempts = 0
            
            // 设置保活
            this._setupKeepAlive()
            
            // 如果有远程主机信息，发送一条标识消息
            if (this.state.targetHost) {
              this.sendMessage({
                type: 'identify',
                payload: {
                  targetHost: this.state.targetHost,
                  clientId: `web_${Date.now()}`
                }
              })
            }
            
            // 连接成功后立即请求系统数据
            this.requestSystemStats()
            
            // 存储最后连接的主机
            try {
              sessionStorage.setItem('monitoring_last_target', remoteHost)
            } catch (error) {
              log.error('存储监控目标失败:', error)
            }
            
            // 查找当前活动的终端，并仅更新该终端的状态
            try {
              const activeTerminalElement = document.querySelector('.terminal-container.active')
              if (activeTerminalElement) {
                const terminalId = activeTerminalElement.getAttribute('data-terminal-id')
                if (terminalId) {
                  // 只更新当前活动终端的状态
                  this.updateTerminalMonitoringStatus(terminalId, true)
                  
                  // 确保不影响其他终端的状态
                  log.debug(`仅更新活动终端 ${terminalId} 的监控状态为连接`)
                }
              }
            } catch (err) {
              log.debug('查找活动终端ID失败:', err)
            }
            
            // 全局通知监控服务已连接，但不指定终端ID
            window.dispatchEvent(new CustomEvent('monitoring-status-change', { 
              detail: { installed: true, host: remoteHost }
            }))
            
            resolve(true)
          }
          
          this.ws.onmessage = (event) => {
            this._handleMessage(event)
          }
          
          this.ws.onclose = (event) => {
            // 静默处理连接关闭
            this._handleClose(event)
            // 只输出调试信息
            log.info(`监控连接已关闭: 代码=${event.code}, 原因=${event.reason || '未指定'}`)
            if (this.state.connecting) {
              reject(new Error('连接关闭'))
            }
          }
          
          this.ws.onerror = (error) => {
            // 静默处理WebSocket错误
            log.debug('监控WebSocket错误')
            log.info(`监控连接失败`)
            this.state.error = '连接错误'
            
            if (this.state.connecting) {
              this.state.connecting = false
              reject(error)
            }
          }
        } catch (error) {
          this.state.connecting = false
          log.debug('创建监控WebSocket连接失败')
          log.info(`创建监控连接失败`)
          reject(error)
        }
      })
    } catch (error) {
      this.state.connecting = false
      log.debug('连接到监控WebSocket服务失败')
      log.info(`监控连接失败`)
      return false
    }
  }
  
  /**
   * 断开与监控WebSocket的连接
   */
  disconnect() {
    if (!this.state.connected && !this.ws) {
      return
    }
    
    log.info('正在断开监控WebSocket连接')
    log.info('正在断开监控连接')
    
    // 清除保活定时器
    this._clearKeepAlive()
    
    // 清除重连定时器
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    
    // 关闭WebSocket连接
    if (this.ws) {
      try {
        this.ws.close()
        log.info('监控连接已成功断开')
      } catch (error) {
        log.error('关闭监控WebSocket连接时出错:', error)
        log.error(`断开监控连接时出错: ${error.message || '未知错误'}`)
      }
      this.ws = null
    }
    
    this.state.connected = false
    this.state.sessionId = null
    
    // 重置状态
    this.state.connecting = false
    this.state.lastActivity = null
    
    // 清除保持连接的定时任务
    this._clearKeepAlive()
    
    // 清除存储的目标主机
    try {
      sessionStorage.removeItem('monitoring_last_target')
    } catch (error) {
      log.error('清除监控目标失败:', error)
    }
    
    // 找出所有与当前目标主机相关的终端，更新它们的状态
    const targetHost = this.state.targetHost
    if (targetHost) {
      try {
        // 查找与当前主机匹配的所有终端状态
        this.terminalMonitoringStatus.forEach((status, terminalId) => {
          if (status.host === targetHost && status.installed) {
            // 更新这些终端的状态为未连接
            this.updateTerminalMonitoringStatus(terminalId, false)
            log.debug(`更新终端 ${terminalId} 的监控状态为断开`)
          }
        })
      } catch (err) {
        log.debug('更新终端监控状态时出错:', err)
      }
    }
    
    // 全局通知监控服务已断开
    window.dispatchEvent(new CustomEvent('monitoring-status-change', { 
      detail: { installed: false, host: this.state.targetHost }
    }))
    
    // 重置目标主机
    this.state.targetHost = null
  }
  
  /**
   * 发送消息到监控WebSocket
   * @param {Object} message 要发送的消息
   * @returns {boolean} 是否发送成功
   */
  sendMessage(message) {
    if (!this.state.connected || !this.ws) {
      log.error('发送监控消息失败: WebSocket未连接')
      return false
    }
    
    try {
      this.ws.send(JSON.stringify(message))
      this.state.stats.messagesSent++
      this.state.lastActivity = new Date()
      return true
    } catch (error) {
      log.error('发送监控消息失败:', error)
      return false
    }
  }
  
  /**
   * 发送系统统计信息
   * @param {Object} stats 系统统计信息
   * @returns {boolean} 是否发送成功
   */
  sendSystemStats(stats) {
    const messageId = Date.now().toString()
    return this.sendMessage({
      type: 'system_stats',
      payload: {
        ...stats,
        messageId,
        timestamp: Date.now()
      }
    })
  }
  
  /**
   * 发送日志数据
   * @param {Object} logData 日志数据
   * @returns {boolean} 是否发送成功
   */
  sendLogData(logData) {
    const messageId = Date.now().toString()
    return this.sendMessage({
      type: 'log_data',
      payload: {
        ...logData,
        messageId,
        timestamp: Date.now()
      }
    })
  }
  
  /**
   * 发送ping消息以测试连接
   * @returns {boolean} 是否发送成功
   */
  sendPing() {
    return this.sendMessage({
      type: 'ping',
      payload: {
        timestamp: Date.now()
      }
    })
  }
  
  /**
   * 设置消息监听器
   * @param {string} type 消息类型
   * @param {Function} callback 回调函数
   * @returns {string} 监听器ID
   */
  addMessageListener(type, callback) {
    const id = `${type}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    
    if (!this.messageListeners.has(type)) {
      this.messageListeners.set(type, new Map())
    }
    
    this.messageListeners.get(type).set(id, callback)
    return id
  }
  
  /**
   * 移除消息监听器
   * @param {string} type 消息类型
   * @param {string} id 监听器ID
   */
  removeMessageListener(type, id) {
    if (this.messageListeners.has(type)) {
      this.messageListeners.get(type).delete(id)
      
      if (this.messageListeners.get(type).size === 0) {
        this.messageListeners.delete(type)
      }
    }
  }
  
  /**
   * 处理接收到的消息
   * @private
   * @param {MessageEvent} event 消息事件
   */
  _handleMessage(event) {
    try {
      const message = JSON.parse(event.data)
      this.state.stats.messagesReceived++
      this.state.lastActivity = new Date()
      
      // 处理系统信息消息
      if (message.type === 'system-info' || message.type === 'system_stats') {
        const data = message.data || message.payload
        if (data) {
          // 确保消息有targetHost属性
          if (!message.targetHost && this.state.targetHost) {
            message.targetHost = this.state.targetHost
          }
          
          // 更新系统信息状态
          this.state.systemInfo = data
          this._updateMonitorData(data)
        }
      }
      
      // 处理pong响应
      if (message.type === 'pong') {
        log.debug('收到pong响应:', message)
        log.info('监控连接正常: 收到pong响应')
      }
      
      // 处理session ID
      if (message.type === 'session' && message.payload && message.payload.sessionId) {
        this.state.sessionId = message.payload.sessionId
        log.info(`监控会话ID: ${this.state.sessionId}`)
        log.info(`监控会话已创建, ID: ${this.state.sessionId}`)
      }
      
      // 确保消息有targetHost属性
      if (!message.targetHost && this.state.targetHost) {
        message.targetHost = this.state.targetHost
      }
      
      // 调用相应的监听器
      if (this.messageListeners.has(message.type)) {
        this.messageListeners.get(message.type).forEach(callback => {
          try {
            callback(message)
          } catch (error) {
            log.debug(`执行消息监听器(${message.type})时出错:`, error)
          }
        })
      }
      
      // 调用通用监听器
      if (this.messageListeners.has('*')) {
        this.messageListeners.get('*').forEach(callback => {
          try {
            callback(message)
          } catch (error) {
            log.debug('执行通用消息监听器时出错:', error)
          }
        })
      }
    } catch (error) {
      log.debug('解析监控消息时出错:', error, event.data)
      log.info(`解析监控消息失败: ${error.message || '未知错误'}`)
    }
  }
  
  /**
   * 更新监控数据
   * @private
   * @param {Object} data 系统信息数据
   */
  _updateMonitorData(data) {
    try {
      if (data.cpu) {
        this.state.monitorData.cpu = {
          usage: data.cpu.usage || 0,
          cores: data.cpu.cores || 0,
          model: data.cpu.model || ''
        }
      }
      
      if (data.memory) {
        this.state.monitorData.memory = {
          total: data.memory.total || 0,
          used: data.memory.used || 0,
          free: data.memory.free || 0,
          usedPercentage: data.memory.usedPercentage || 0
        }
      }
      
      if (data.swap) {
        this.state.monitorData.swap = {
          total: data.swap.total || 0,
          used: data.swap.used || 0,
          free: data.swap.free || 0,
          usedPercentage: data.swap.usedPercentage || 0
        }
      }
      
      if (data.disk) {
        this.state.monitorData.disk = {
          total: data.disk.total || 0,
          used: data.disk.used || 0,
          free: data.disk.free || 0,
          usedPercentage: data.disk.usedPercentage || 0
        }
      }
      
      if (data.network) {
        this.state.monitorData.network = data.network
      }
      
      if (data.os) {
        this.state.monitorData.os = data.os
      }
    } catch (error) {
      log.error('更新监控数据时出错:', error)
      log.error(`更新监控数据失败: ${error.message || '未知错误'}`)
    }
  }
  
  /**
   * 处理连接关闭
   * @private
   * @param {CloseEvent} event 关闭事件
   */
  _handleClose(event) {
    const wasConnected = this.state.connected
    this.state.connected = false
    
    log.info(`监控WebSocket连接关闭: ${event.code}`)
    
    // 触发监控状态更新事件（不可用）
    if (wasConnected) {
      window.dispatchEvent(new CustomEvent('monitoring-status-change', { 
        detail: { installed: false, host: this.state.targetHost }
      }))
    }
    
    // 清除保活定时器
    this._clearKeepAlive()
    
    // 如果之前是连接状态，尝试重连
    if (wasConnected) {
      log.info(`监控连接已断开，准备重连`)
      this._reconnect()
    }
  }
  
  /**
   * 尝试重新连接
   * @private
   */
  _reconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
    }
    
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      log.debug(`达到最大重连尝试次数(${this.maxReconnectAttempts})，停止重连`)
      log.info(`监控重连已停止`)
      this.state.error = '重连失败'
      return
    }
    
    this.reconnectAttempts++
    const delay = this.reconnectDelay * this.reconnectAttempts
    
    log.debug(`计划在 ${delay}ms 后进行第 ${this.reconnectAttempts} 次重连`)
    
    this.reconnectTimeout = setTimeout(async () => {
      log.debug(`正在尝试第 ${this.reconnectAttempts} 次重连`)
      try {
        const connected = await this.connect(this.state.targetHost)
        if (connected) {
          log.debug('重连成功')
          this.reconnectAttempts = 0
        } else {
          log.debug('重连未成功完成')
          this._reconnect()
        }
      } catch (error) {
        log.debug('重连过程中出错')
        this._reconnect()
      }
    }, delay)
  }
  
  /**
   * 设置保活定时器
   * @private
   */
  _setupKeepAlive() {
    this._clearKeepAlive()
    
    // 创建新的保活定时器
    this.keepAliveInterval = setInterval(() => {
      if (this.state.connected) {
        // 发送ping消息
        this.sendPing()
        log.info('监控保活: 已发送ping请求')
      }
    }, this.keepAliveTimeout)
  }
  
  /**
   * 清除保活定时器
   * @private
   */
  _clearKeepAlive() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval)
      this.keepAliveInterval = null
    }
  }
  
  /**
   * 获取当前监控数据
   * @returns {Object} 监控数据
   */
  getMonitorData() {
    return this.state.monitorData
  }
  
  /**
   * 获取完整的系统信息
   * @returns {Object|null} 系统信息，如果未连接则返回null
   */
  getSystemInfo() {
    return this.state.systemInfo
  }
  
  /**
   * 请求系统状态数据
   * 向监控服务发送请求获取最新的系统统计信息
   */
  requestSystemStats() {
    if (!this.state.connected || !this.ws) {
      log.info('[监控服务] 无法请求系统数据: 未连接')
      return
    }
    
    // 发送获取系统数据的请求
    this.sendMessage({
      type: 'request_system_stats',
      targetHost: this.state.targetHost,
      timestamp: Date.now()
    })
    
    
    // 如果有监控数据且未触发过监听器，显式触发system_stats事件
    if (this.state.systemInfo) {
      log.info('[监控服务] 使用缓存数据主动触发监听器')
      
      // 尝试调用已注册的系统数据监听器
      if (this.messageListeners.has('system_stats')) {
        this.messageListeners.get('system_stats').forEach(callback => {
          try {
            callback({
              type: 'system_stats',
              targetHost: this.state.targetHost,
              payload: this.state.systemInfo
            })
          } catch (error) {
            log.debug('[监控服务] 触发system_stats监听器出错:', error)
          }
        })
      }
      
      // 同样触发system-info监听器
      if (this.messageListeners.has('system-info')) {
        this.messageListeners.get('system-info').forEach(callback => {
          try {
            callback({
              type: 'system-info',
              targetHost: this.state.targetHost,
              payload: this.state.systemInfo
            })
          } catch (error) {
            log.debug('[监控服务] 触发system-info监听器出错:', error)
          }
        })
      }
    }
  }

  /**
   * 更新特定终端的监控状态
   * @param {string} terminalId 终端ID
   * @param {boolean} status 监控状态
   * @param {boolean} notifyUI 是否通知UI更新
   * @returns {boolean} 更新是否成功
   */
  updateTerminalMonitoringStatus(terminalId, status = null, notifyUI = true) {
    if (!terminalId) return false;
    
    const isConnected = status !== null ? status : this.state.connected;
    
    // 存储该终端的监控状态
    this.terminalMonitoringStatus.set(terminalId, {
      installed: isConnected,
      host: this.state.targetHost,
      timestamp: Date.now()
    });
    
    // 如果需要，触发状态变化事件通知UI
    if (notifyUI) {
      window.dispatchEvent(new CustomEvent('monitoring-status-change', { 
        detail: { 
          installed: isConnected, 
          terminalId: terminalId,
          host: this.state.targetHost
        }
      }));
    }
    
    return true;
  }
  
  /**
   * 获取特定终端的监控状态
   * @param {string} terminalId 终端ID
   * @returns {Object|null} 监控状态对象或null
   */
  getTerminalMonitoringStatus(terminalId) {
    if (!terminalId || !this.terminalMonitoringStatus.has(terminalId)) {
      return null;
    }
    
    return this.terminalMonitoringStatus.get(terminalId);
  }
  
  /**
   * 判断特定终端是否已连接监控
   * @param {string} terminalId 终端ID
   * @param {string} host 主机地址（可选，用于验证）
   * @returns {boolean} 是否已连接
   */
  isTerminalMonitored(terminalId, host = null) {
    const status = this.getTerminalMonitoringStatus(terminalId);
    
    if (!status) {
      return false;
    }
    
    // 如果提供了主机地址，则还需验证主机匹配
    if (host && status.host !== host) {
      return false;
    }
    
    return status.installed;
  }
}

// 创建单例
const monitoringService = new MonitoringService()

export default monitoringService 