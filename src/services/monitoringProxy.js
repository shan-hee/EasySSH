/**
 * 监控服务代理
 * 提供与旧版监控服务相同的API接口，但内部使用工厂实现多实例隔离
 */

import monitoringFactory from './monitoringFactory';
import log from './log';

/**
 * 监控服务代理类
 * 为了保持兼容性而设计，实际委托给工厂创建的实例
 */
class MonitoringServiceProxy {
  constructor() {
    // 创建一个共享状态对象，用于向后兼容
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
    
    // 终端监控状态映射（向后兼容）
    this.terminalMonitoringStatus = new Map();
    
    // 临时会话存储
    this.tempSessions = new Map();
    
    // 初始化标志
    this.initialized = false;
    
    // 存储订阅ID映射，用于管理订阅
    this.subscriptionMap = new Map();
    
    // 初始化事件监听
    this._initEvents();
  }
  
  /**
   * 初始化事件监听
   * @private
   */
  _initEvents() {
    // 代理监控状态变更事件，将终端特定的状态同步到全局
    window.addEventListener('monitoring-status-change', (event) => {
      if (event.detail && event.detail.terminalId) {
        // 更新特定终端的监控状态
        this.updateTerminalMonitoringStatus(
          event.detail.terminalId, 
          event.detail.installed,
          false // 不触发新事件，避免循环
        );
        
        // 获取当前活动终端ID
        const activeTerminalId = this._getActiveTerminalId();
        
        // 如果是当前活动终端的状态变化，同步到全局状态
        if (activeTerminalId === event.detail.terminalId) {
          this._syncActiveTerminalStatus(activeTerminalId);
        }
      }
    });
    
    // 监听终端切换事件，同步状态
    window.addEventListener('terminal:activated', (event) => {
      if (event.detail && event.detail.terminalId) {
        this._syncActiveTerminalStatus(event.detail.terminalId);
      }
    });
    
    // 监听终端销毁事件，清理临时会话和映射
    window.addEventListener('terminal:destroyed', (event) => {
      if (event.detail && event.detail.terminalId) {
        const terminalId = event.detail.terminalId;
        log.debug(`[监控代理] 终端 ${terminalId} 被销毁，清理相关临时会话和映射`);
        
        // 清理终端监控状态
        if (this.terminalMonitoringStatus.has(terminalId)) {
          this.terminalMonitoringStatus.delete(terminalId);
          log.debug(`[监控代理] 已清理终端 ${terminalId} 的监控状态`);
        }
        
        // 查找并清理关联到该终端的临时会话
        const sessionsToRemove = [];
        this.tempSessions.forEach((session, sessionId) => {
          if (session.terminalId === terminalId) {
            sessionsToRemove.push(sessionId);
          }
        });
        
        sessionsToRemove.forEach(sessionId => {
          this.tempSessions.delete(sessionId);
          log.debug(`[监控代理] 已清理与终端 ${terminalId} 关联的临时会话 ${sessionId}`);
        });
        
        // 如果全局会话ID关联到被销毁的终端，清除它
        if (window.currentMonitoringSessionId) {
          const currentSession = this.tempSessions.get(window.currentMonitoringSessionId);
          if (currentSession && currentSession.terminalId === terminalId) {
            log.debug(`[监控代理] 清除与终端 ${terminalId} 关联的全局会话ID ${window.currentMonitoringSessionId}`);
            window.currentMonitoringSessionId = null;
          }
        }
        
        // 检查是否需要重置全局状态
        if (this.state.connected && !monitoringFactory.instances.size) {
          log.debug('[监控代理] 所有终端实例都已销毁，重置全局状态');
          this.state.connected = false;
          this.state.connecting = false;
          this.state.targetHost = null;
          this.state.sessionId = null;
        }
      }
    });
    
    // 监听全局触发连接事件
    window.addEventListener('monitoring-connect', (event) => {
      if (event.detail && event.detail.host) {
        // 获取当前活动终端ID
        const terminalId = event.detail.terminalId || this._getActiveTerminalId();
        if (terminalId) {
          // 委托给工厂的实例处理
          monitoringFactory.connect(terminalId, event.detail.host);
        }
      }
    });

    // 监听全局触发断开事件
    window.addEventListener('monitoring-disconnect', (event) => {
      if (event.detail && event.detail.terminalId) {
        // 断开特定终端的连接
        monitoringFactory.disconnect(event.detail.terminalId);
      } else {
        // 断开所有终端的连接
        monitoringFactory.disconnectAll();
      }
    });
    
    // 监听SSH连接成功事件，自动连接监控
    window.addEventListener('ssh-connected', (event) => {
      if (event.detail && event.detail.connection && event.detail.connection.host) {
        const host = event.detail.connection.host;
        const terminalId = event.detail.terminalId || this._getActiveTerminalId();
        
        if (terminalId) {
          log.debug(`[监控代理] SSH连接成功，尝试连接终端 ${terminalId} 到监控: ${host}`);
          
          // 连接到相同主机的监控服务
          monitoringFactory.connect(terminalId, host).then(connected => {
            if (connected) {
              log.debug(`[监控代理] 成功连接终端 ${terminalId} 到监控服务: ${host}`);
            }
          }).catch(err => {
            log.debug(`[监控代理] 连接终端 ${terminalId} 到监控服务失败: ${err.message || '未知错误'}`);
          });
        }
      }
    });
    
    // 监听切换监控面板事件
    window.addEventListener('toggle-monitoring-panel', (event) => {
      log.info('[监控代理] 收到切换监控面板事件');
      
      // 检查监控面板是否已显示
      const monitoringPanelExists = document.querySelector('.monitoring-panel-container');
      if (monitoringPanelExists) {
        log.info('[监控代理] 监控面板已显示，不重复触发');
        return;
      }
      
      // 获取事件中的会话ID和连接信息
      const sessionId = event.detail && event.detail.sessionId;
      const connection = event.detail && (event.detail.connection || event.detail.serverInfo);
      
      // 如果事件包含连接信息但没有会话ID，为其生成一个临时会话ID
      const tempSessionId = sessionId || (connection ? `temp_session_${Date.now()}` : null);
      
      // 如果有连接信息，优先处理
      if (connection && connection.host) {
        log.debug(`[监控代理] 检测到连接信息，主机: ${connection.host}`);
        
        // 将会话ID保存到全局，以便其他组件使用
        if (tempSessionId) {
          window.currentMonitoringSessionId = tempSessionId;
          log.debug(`[监控代理] 设置当前监控会话ID: ${tempSessionId}`);
        }
        
        // 检查工厂中是否已有连接到该主机的实例
        const existingConnection = monitoringFactory.findInstanceByHost(connection.host);
        if (existingConnection) {
          log.debug(`[监控代理] 找到已连接到 ${connection.host} 的实例，复用现有连接`);
          
          // 将临时会话ID与现有终端ID关联
          this.tempSessions.set(tempSessionId || 'latest_session', {
            host: connection.host,
            timestamp: Date.now(),
            terminalId: existingConnection.terminalId,
            connected: true
          });
          
          // 立即触发显示监控面板事件
          window.dispatchEvent(new CustomEvent('show-monitoring-panel', { 
            detail: { 
              host: connection.host,
              installed: true,
              terminalId: existingConnection.terminalId,
              sessionId: tempSessionId
            }
          }));
          
          return;
        }
        
        // 没有现有连接，创建一个临时终端实例用于监控连接
        const tempTerminalId = `temp_terminal_${Date.now()}`;
        
        // 记录会话与终端的映射关系
        this.tempSessions.set(tempSessionId || 'latest_session', {
          host: connection.host,
          timestamp: Date.now(),
          terminalId: tempTerminalId
        });
        
        // 连接监控
        monitoringFactory.connect(tempTerminalId, connection.host).then(connected => {
          // 更新临时会话状态
          this.tempSessions.set(tempSessionId || 'latest_session', {
            host: connection.host,
            timestamp: Date.now(),
            terminalId: tempTerminalId,
            connected: connected
          });
          
          // 触发显示监控面板事件
          window.dispatchEvent(new CustomEvent('show-monitoring-panel', { 
            detail: { 
              host: connection.host,
              installed: connected,
              terminalId: tempTerminalId,
              sessionId: tempSessionId
            }
          }));
        });
        
        return;
      }
      
      // 常规流程 - 使用实际终端ID
      const terminalId = (event.detail && event.detail.terminalId) || this._getActiveTerminalId();
      
      if (!terminalId) {
        log.debug('[监控代理] 未找到终端ID，无法显示监控面板');
        return;
      }
      
      // 检查该终端是否已连接到监控
      const instance = monitoringFactory.getInstance(terminalId);
      if (instance && instance.state.connected && instance.state.targetHost) {
        // 触发显示监控面板事件
        window.dispatchEvent(new CustomEvent('show-monitoring-panel', { 
          detail: { 
            host: instance.state.targetHost,
            installed: true,
            terminalId: terminalId
          }
        }));
      } else {
        // 尝试获取当前SSH连接的主机
        const host = this._getHostForTerminal(terminalId);
        if (host) {
          // 尝试连接
          monitoringFactory.connect(terminalId, host).then(connected => {
            // 连接成功后触发显示面板事件
            window.dispatchEvent(new CustomEvent('show-monitoring-panel', { 
              detail: { 
                host: host,
                installed: connected,
                terminalId: terminalId
              }
            }));
          });
        }
      }
    });

    // 监听服务器数据清理事件
    window.addEventListener('server-data-cleared', (event) => {
      if (event.detail && event.detail.serverId) {
        const serverId = event.detail.serverId;
        
        // 清理代理中存储的订阅映射
        if (this.subscriptionMap.has(serverId)) {
          log.debug(`[监控代理] 清理服务器 ${serverId} 的订阅映射`);
          this.subscriptionMap.delete(serverId);
        }
        
        // 如果全局状态关联到该服务器，重置它
        if (this.state.targetHost === serverId) {
          log.debug(`[监控代理] 重置关联到服务器 ${serverId} 的全局状态`);
          this.state.connected = false;
          this.state.connecting = false;
          this.state.targetHost = null;
          this.state.sessionId = null;
        }
      }
    });
  }
  
  /**
   * 获取当前活动终端ID
   * @private
   * @returns {string|null} 活动终端ID或null
   */
  _getActiveTerminalId() {
    // 首先检查是否有传递中的临时会话ID
    if (window.currentMonitoringSessionId) {
      // 先检查这个ID是否直接是一个终端ID
      const terminalExists = this.terminalMonitoringStatus.has(window.currentMonitoringSessionId) ||
                      monitoringFactory.instances.has(window.currentMonitoringSessionId);
                      
      if (terminalExists) {
        log.debug(`[监控代理] 使用当前监控会话ID作为终端ID: ${window.currentMonitoringSessionId}`);
        return window.currentMonitoringSessionId;
      }
      
      // 然后检查是否在临时会话映射中
      if (this.tempSessions.has(window.currentMonitoringSessionId)) {
        const session = this.tempSessions.get(window.currentMonitoringSessionId);
        if (session && session.terminalId) {
          log.debug(`[监控代理] 使用临时会话 ${window.currentMonitoringSessionId} 的终端ID: ${session.terminalId}`);
          return session.terminalId;
        }
      }
      
      // 如果存在会话ID但未找到对应的终端ID，创建一个新的临时终端ID并与会话关联
      const tempTerminalId = `temp_terminal_${Date.now()}`;
      log.debug(`[监控代理] 为会话 ${window.currentMonitoringSessionId} 创建临时终端ID: ${tempTerminalId}`);
      
      // 保存映射关系
      this.tempSessions.set(window.currentMonitoringSessionId, {
        terminalId: tempTerminalId,
        timestamp: Date.now()
      });
      
      return tempTerminalId;
    }
    
    // 获取当前活动的终端容器
    const activeTerminal = document.querySelector('.terminal-container.active');
    if (activeTerminal) {
      return activeTerminal.getAttribute('data-terminal-id');
    }
    
    return null;
  }
  
  /**
   * 获取终端对应的主机地址
   * @private
   * @param {string} terminalId 终端ID
   * @returns {string|null} 主机地址或null
   */
  _getHostForTerminal(terminalId) {
    try {
      // 尝试从全局应用状态中获取主机信息
      if (window.terminalStore && window.terminalStore.sessions) {
        const sshSessionId = window.terminalStore.sessions[terminalId];
        if (sshSessionId && window.sshService && window.sshService.sessions) {
          const session = window.sshService.sessions.get(sshSessionId);
          if (session && session.connection) {
            return session.connection.host;
          }
        }
      }
      
      return null;
    } catch (error) {
      log.error('[监控代理] 获取终端主机信息失败:', error);
      return null;
    }
  }
  
  /**
   * 同步活动终端的状态到全局状态
   * @private
   * @param {string} terminalId 终端ID
   */
  _syncActiveTerminalStatus(terminalId) {
    if (!terminalId) return;
    
    const instance = monitoringFactory.getInstance(terminalId);
    if (!instance) return;
    
    // 更新全局状态，保持向后兼容
    this.state.connected = instance.state.connected;
    this.state.connecting = instance.state.connecting;
    this.state.sessionId = instance.state.sessionId;
    this.state.error = instance.state.error;
    this.state.targetHost = instance.state.targetHost;
    this.state.systemInfo = instance.state.systemInfo;
    this.state.lastActivity = instance.state.lastActivity;
    
    // 更新统计数据
    this.state.stats.messagesReceived = instance.state.stats.messagesReceived;
    this.state.stats.messagesSent = instance.state.stats.messagesSent;
    
    // 更新监控数据
    Object.assign(this.state.monitorData, instance.state.monitorData);
    
    log.debug(`[监控代理] 已同步终端 ${terminalId} 的状态到全局状态`);
  }
  
  /**
   * 初始化监控服务
   */
  init() {
    if (this.initialized) {
      log.debug('监控服务已初始化，跳过重复初始化');
      return true;
    }
    
    // 设置初始化标志，避免重复初始化
    this.initialized = true;
    
    // 记录初始化日志
    log.info('监控服务初始化完成，已启用多终端隔离');
    
    // 添加一个方法，可以在创建SSH会话的同时连接监控服务 
    this.connectToHostWithStatus = this._createConnectToHostWithStatusMethod();
    
    // 初始化全局API
    this._initGlobalMonitoringAPI();
    
    return true;
  }
  
  /**
   * 创建连接到主机并更新状态的方法
   * @private
   * @returns {Function} 连接方法
   */
  _createConnectToHostWithStatusMethod() {
    return (host, terminalId) => {
      if (!host) {
        return Promise.resolve(false);
      }
      
      // 获取当前活动终端ID
      terminalId = terminalId || this._getActiveTerminalId();
      if (!terminalId) {
        return Promise.resolve(false);
      }
      
      // 委托给工厂实例处理
      return monitoringFactory.connect(terminalId, host).then(connected => {
        // 触发状态事件
        window.dispatchEvent(new CustomEvent('monitoring-status-change', { 
          detail: { installed: connected, host, terminalId }
        }));
        
        return connected;
      })
      .catch(() => {
        // 静默处理错误
        window.dispatchEvent(new CustomEvent('monitoring-status-change', { 
          detail: { installed: false, host, terminalId }
        }));
        
        return false;
      });
    };
  }
  
  /**
   * 初始化全局监控API
   * @private
   */
  _initGlobalMonitoringAPI() {
    // 全局API，使SSH会话创建和监控连接同步进行
    window.monitoringAPI = {
      connect: this.connectToHostWithStatus.bind(this),
      getStatus: (terminalId) => {
        terminalId = terminalId || this._getActiveTerminalId();
        if (terminalId) {
          return monitoringFactory.getStatus(terminalId);
        }
        return this.state;
      }
    };
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
    
    // 获取终端的监控实例
    const instance = monitoringFactory.getInstance(terminalId);
    const isConnected = status !== null ? status : (instance ? instance.state.connected : false);
    const targetHost = instance ? instance.state.targetHost : null;
    
    // 存储该终端的监控状态（保持向后兼容）
    this.terminalMonitoringStatus.set(terminalId, {
      installed: isConnected,
      host: targetHost,
      timestamp: Date.now()
    });
    
    // 如果需要，触发状态变化事件通知UI
    if (notifyUI) {
      window.dispatchEvent(new CustomEvent('monitoring-status-change', { 
        detail: { 
          installed: isConnected, 
          terminalId: terminalId,
          host: targetHost
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
    if (!terminalId) {
      return null;
    }
    
    // 优先从新的工厂获取状态
    const instance = monitoringFactory.getInstance(terminalId);
    if (instance) {
      return {
        installed: instance.state.connected,
        host: instance.state.targetHost,
        timestamp: instance.state.lastActivity ? instance.state.lastActivity.getTime() : Date.now()
      };
    }
    
    // 兼容方式：从本地映射获取状态
    if (!this.terminalMonitoringStatus.has(terminalId)) {
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
    // 直接委托给工厂实例
    const instance = monitoringFactory.getInstance(terminalId);
    if (instance) {
      // 如果提供了主机地址，则还需验证主机匹配
      if (host && instance.state.targetHost !== host) {
        return false;
      }
      
      return instance.state.connected;
    }
    
    // 兼容方式：使用本地状态映射
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
  
  /**
   * 连接到监控WebSocket
   * @param {string|Object} remoteHost 远程主机地址或主机信息对象
   * @param {string} terminalId 可选的终端ID
   * @returns {Promise<boolean>} 连接结果
   */
  async connect(remoteHost, terminalId = null) {
    // 获取终端ID，如果未提供则使用当前活动终端
    terminalId = terminalId || this._getActiveTerminalId();
    
    // 处理对象类型的主机信息
    let hostAddress = remoteHost;
    if (typeof remoteHost === 'object' && remoteHost !== null) {
      hostAddress = remoteHost.host || remoteHost.hostname || remoteHost.address;
    }
    
    if (!hostAddress) {
      log.error('[监控代理] 连接失败: 无效的主机地址');
      return false;
    }
    
    // 检查是否已有连接到同一主机的实例，避免创建重复连接
    const existingConnection = monitoringFactory.findInstanceByHost(hostAddress);
    if (existingConnection) {
      log.debug(`[监控代理] 发现已有终端(${existingConnection.terminalId})连接到 ${hostAddress}，避免重复连接`);
      
      // 如果当前会话ID存在，更新映射关系
      if (window.currentMonitoringSessionId) {
        this.tempSessions.set(window.currentMonitoringSessionId, {
          host: hostAddress,
          timestamp: Date.now(),
          terminalId: existingConnection.terminalId,
          connected: true
        });
        
        log.debug(`[监控代理] 已将会话 ${window.currentMonitoringSessionId} 映射到现有终端 ${existingConnection.terminalId}`);
      }
      
      // 如果当前终端是活动终端，同步状态到全局
      this._syncActiveTerminalStatus(existingConnection.terminalId);
      
      return true;
    }
    
    if (!terminalId) {
      log.error('[监控代理] 连接失败: 未找到活动终端');
      
      // 尝试查找已有的临时会话
      if (window.currentMonitoringSessionId) {
        // 为当前会话创建一个临时终端实例
        terminalId = `temp_terminal_${Date.now()}`;
        log.info(`[监控代理] 为会话 ${window.currentMonitoringSessionId} 创建临时终端实例: ${terminalId}`);
        
        // 保存会话与终端的映射关系
        this.tempSessions.set(window.currentMonitoringSessionId, {
          host: hostAddress,
          timestamp: Date.now(),
          terminalId: terminalId
        });
      } else {
        // 创建一个临时终端实例以支持没有活动终端的情况
        terminalId = `temp_terminal_${Date.now()}`;
        log.info(`[监控代理] 创建临时终端实例: ${terminalId}`);
      }
    }
    
    // 委托给工厂实例
    const result = await monitoringFactory.connect(terminalId, hostAddress);
    
    // 如果连接成功且存在临时会话ID，更新会话状态
    if (result && window.currentMonitoringSessionId) {
      this.tempSessions.set(window.currentMonitoringSessionId, {
        host: hostAddress,
        timestamp: Date.now(),
        terminalId: terminalId,
        connected: true
      });
      
      log.debug(`[监控代理] 临时会话 ${window.currentMonitoringSessionId} 已连接到 ${hostAddress}，使用终端 ${terminalId}`);
    }
    
    // 如果当前终端是活动终端，同步状态到全局
    if (terminalId === this._getActiveTerminalId()) {
      this._syncActiveTerminalStatus(terminalId);
    }
    
    return result;
  }
  
  /**
   * 断开与监控WebSocket的连接
   * @param {string} terminalId 可选的终端ID
   */
  disconnect(terminalId = null) {
    // 获取终端ID，如果未提供则使用当前活动终端
    terminalId = terminalId || this._getActiveTerminalId();
    if (!terminalId) {
      // 断开所有连接
      monitoringFactory.disconnectAll();
      return;
    }
    
    // 断开特定终端的连接
    monitoringFactory.disconnect(terminalId);
    
    // 更新全局状态，如果断开的是当前活动终端
    if (terminalId === this._getActiveTerminalId()) {
      this.state.connected = false;
      this.state.sessionId = null;
      this.state.targetHost = null;
    }
  }
  
  /**
   * 发送消息到监控WebSocket
   * @param {Object} message 要发送的消息
   * @param {string} terminalId 可选的终端ID
   * @returns {boolean} 是否发送成功
   */
  sendMessage(message, terminalId = null) {
    // 获取终端ID，如果未提供则使用当前活动终端
    terminalId = terminalId || this._getActiveTerminalId();
    if (!terminalId) {
      log.error('[监控代理] 发送消息失败: 未找到活动终端');
      return false;
    }
    
    // 获取终端实例
    const instance = monitoringFactory.getInstance(terminalId);
    if (!instance || !instance.state.connected) {
      log.error(`[监控代理] 发送消息失败: 终端 ${terminalId} 未连接`);
      return false;
    }
    
    // 添加终端ID到消息
    if (!message.terminalId) {
      message.terminalId = terminalId;
    }
    
    // 委托给实例发送
    return instance.sendMessage(message);
  }
  
  /**
   * 发送ping消息以测试连接
   * @param {string} terminalId 可选的终端ID
   * @returns {boolean} 是否发送成功
   */
  sendPing(terminalId = null) {
    // 获取终端ID，如果未提供则使用当前活动终端
    terminalId = terminalId || this._getActiveTerminalId();
    if (!terminalId) {
      return false;
    }
    
    // 获取终端实例
    const instance = monitoringFactory.getInstance(terminalId);
    if (!instance) {
      return false;
    }
    
    return instance.sendPing();
  }
  
  /**
   * 添加消息监听器
   * @param {string} type 消息类型
   * @param {Function} callback 回调函数
   * @param {string} terminalId 可选的终端ID
   * @returns {string} 监听器ID
   */
  addMessageListener(type, callback, terminalId = null) {
    // 获取终端ID，如果未提供则使用当前活动终端
    terminalId = terminalId || this._getActiveTerminalId();
    
    if (!terminalId) {
      log.error('[监控代理] 添加消息监听器失败: 未找到活动终端');
      
      // 如果没有活动终端，但当前有临时会话，尝试使用其中已创建的终端实例
      const tempSessions = Array.from(this.tempSessions.values());
      const recentSession = tempSessions.sort((a, b) => b.timestamp - a.timestamp)[0];
      
      if (recentSession && recentSession.terminalId) {
        terminalId = recentSession.terminalId;
        log.info(`[监控代理] 使用最近的临时会话终端ID: ${terminalId}`);
      } else {
        // 如果还是没有，创建一个新的临时终端实例
        terminalId = `temp_terminal_${Date.now()}`;
        log.info(`[监控代理] 创建临时终端实例用于监听器: ${terminalId}`);
      }
    }
    
    return monitoringFactory.addMessageListener(terminalId, type, callback);
  }
  
  /**
   * 移除消息监听器
   * @param {string} type 消息类型
   * @param {string} id 监听器ID
   * @param {string} terminalId 可选的终端ID
   */
  removeMessageListener(type, id, terminalId = null) {
    // 获取终端ID，如果未提供则使用当前活动终端
    terminalId = terminalId || this._getActiveTerminalId();
    if (!terminalId) {
      return;
    }
    
    monitoringFactory.removeMessageListener(terminalId, type, id);
  }
  
  /**
   * 打印当前监控状态到控制台
   * @param {string} terminalId 可选的终端ID
   */
  printStatus(terminalId = null) {
    // 获取终端ID，如果未提供则使用当前活动终端
    terminalId = terminalId || this._getActiveTerminalId();
    if (!terminalId) {
      log.info('=== 监控连接状态（全局） ===');
      log.info(`连接状态: ${this.state.connected ? '已连接' : (this.state.connecting ? '连接中' : '未连接')}`);
      log.info(`目标主机: ${this.state.targetHost || '无'}`);
      return;
    }
    
    // 获取终端实例
    const instance = monitoringFactory.getInstance(terminalId);
    if (!instance) {
      log.info(`=== 终端 ${terminalId} 监控状态 ===`);
      log.info('未找到监控实例');
      return;
    }
    
    log.info(`=== 终端 ${terminalId} 监控状态 ===`);
    log.info(`连接状态: ${instance.state.connected ? '已连接' : (instance.state.connecting ? '连接中' : '未连接')}`);
    log.info(`目标主机: ${instance.state.targetHost || '无'}`);
    log.info(`会话ID: ${instance.state.sessionId || '无'}`);
    log.info(`错误信息: ${instance.state.error || '无'}`);
    
    if (instance.state.systemInfo) {
      log.info('--- 监控数据摘要 ---');
      const data = instance.state.monitorData;
      log.info(`CPU: ${data.cpu.usage}% (${data.cpu.cores}核心)`);
      log.info(`内存: ${data.memory.used}/${data.memory.total}MB (${data.memory.usedPercentage}%)`);
      log.info(`磁盘: ${data.disk.used}/${data.disk.total}GB (${data.disk.usedPercentage}%)`);
    }
  }
  
  /**
   * 手动连接监控服务
   * @param {string|Object} host 要监控的主机地址或主机信息对象
   * @param {string} terminalId 可选的终端ID或会话ID
   */
  connectToHost(host, terminalId = null) {
    if (!host) {
      log.error('监控连接失败: 未指定主机地址');
      return false;
    }
    
    log.info(`手动连接到监控: ${host}`);
    
    // 如果传入的是会话ID而非终端ID，需要特殊处理
    let sessionId = null;
    if (terminalId && (terminalId.startsWith('session_') || terminalId.startsWith('temp_session_'))) {
      // 这是一个会话ID，记录下来以便在连接后进行关联
      sessionId = terminalId;
      // 如果未设置全局会话ID，则设置它
      if (!window.currentMonitoringSessionId) {
        window.currentMonitoringSessionId = sessionId;
      }
      
      // 从临时会话映射中获取对应的终端ID
      if (this.tempSessions.has(sessionId)) {
        const session = this.tempSessions.get(sessionId);
        if (session && session.terminalId) {
          terminalId = session.terminalId;
        } else {
          terminalId = null;
        }
      } else {
        terminalId = null;
      }
    }
    
    return this.connect(host, terminalId);
  }
  
  /**
   * 获取当前监控数据
   * @param {string} terminalId 可选的终端ID
   * @returns {Object} 监控数据
   */
  getMonitorData(terminalId = null) {
    // 获取终端ID，如果未提供则使用当前活动终端
    terminalId = terminalId || this._getActiveTerminalId();
    if (!terminalId) {
      return this.state.monitorData;
    }
    
    const data = monitoringFactory.getMonitorData(terminalId);
    return data || this.state.monitorData;
  }
  
  /**
   * 获取完整的系统信息
   * @param {string} terminalId 可选的终端ID
   * @returns {Object|null} 系统信息，如果未连接则返回null
   */
  getSystemInfo(terminalId = null) {
    // 获取终端ID，如果未提供则使用当前活动终端
    terminalId = terminalId || this._getActiveTerminalId();
    if (!terminalId) {
      return this.state.systemInfo;
    }
    
    return monitoringFactory.getSystemInfo(terminalId) || this.state.systemInfo;
  }
  
  /**
   * 请求系统状态数据
   * @param {string} terminalId 可选的终端ID
   */
  requestSystemStats(terminalId = null) {
    // 获取终端ID，如果未提供则使用当前活动终端
    terminalId = terminalId || this._getActiveTerminalId();
    
    if (!terminalId) {
      log.info('[监控代理] 无法请求系统数据: 未找到活动终端');
      
      // 如果没有活动终端，但有临时会话，使用临时会话的终端ID
      const tempSessions = Array.from(this.tempSessions.values());
      const recentSession = tempSessions.sort((a, b) => b.timestamp - a.timestamp)[0];
      
      if (recentSession && recentSession.terminalId) {
        terminalId = recentSession.terminalId;
        log.info(`[监控代理] 使用最近的临时会话终端ID: ${terminalId}`);
      } else {
        return;
      }
    }
    
    monitoringFactory.requestSystemStats(terminalId);
  }
  
  /**
   * 获取服务器的最新监控数据
   * @param {string} serverId 服务器ID或主机地址
   * @returns {object} 监控数据
   */
  getServerData(serverId) {
    return monitoringFactory.getServerData(serverId);
  }
  
  /**
   * 获取服务器的历史数据
   * @param {string} serverId 服务器ID或主机地址
   * @returns {object} 历史数据
   */
  getServerHistoryData(serverId) {
    return monitoringFactory.getServerHistoryData(serverId);
  }
  
  /**
   * 订阅服务器数据更新
   * @param {string} serverId 服务器ID或主机地址
   * @param {function} callback 回调函数，接收数据更新
   * @returns {string} 订阅ID
   */
  subscribeToServer(serverId, callback) {
    if (!serverId) {
      log.warn('[监控代理] 订阅服务器数据失败：未提供服务器ID');
      return null;
    }
    
    const subscriptionId = monitoringFactory.subscribeToServer(serverId, callback);
    
    if (subscriptionId) {
      // 保存订阅ID映射，方便后续管理
      if (!this.subscriptionMap.has(serverId)) {
        this.subscriptionMap.set(serverId, new Set());
      }
      this.subscriptionMap.get(serverId).add(subscriptionId);
      
      log.debug(`[监控代理] 已订阅服务器 ${serverId} 的数据更新，订阅ID: ${subscriptionId}`);
    }
    
    return subscriptionId;
  }
  
  /**
   * 取消订阅服务器数据更新
   * @param {string} serverId 服务器ID或主机地址
   * @param {string} subscriptionId 订阅ID
   * @returns {boolean} 是否成功取消
   */
  unsubscribeFromServer(serverId, subscriptionId) {
    const result = monitoringFactory.unsubscribeFromServer(serverId, subscriptionId);
    
    if (result && this.subscriptionMap.has(serverId)) {
      this.subscriptionMap.get(serverId).delete(subscriptionId);
      
      // 如果该服务器没有订阅了，删除整个映射
      if (this.subscriptionMap.get(serverId).size === 0) {
        this.subscriptionMap.delete(serverId);
      }
      
      log.debug(`[监控代理] 已取消服务器 ${serverId} 的数据订阅，订阅ID: ${subscriptionId}`);
    }
    
    return result;
  }
  
  /**
   * 获取服务器列表
   * @returns {Array} 服务器ID列表
   */
  getServerList() {
    // 返回所有有监控数据的服务器ID
    return Array.from(monitoringFactory.serverStatsMap.keys());
  }
  
  /**
   * 检查服务器是否有监控数据
   * @param {string} serverId 服务器ID或主机地址
   * @returns {boolean} 是否有数据
   */
  hasServerData(serverId) {
    return monitoringFactory.serverStatsMap.has(serverId);
  }
  
  /**
   * 获取全部服务器数据（慎用）
   * @returns {Map} 所有服务器的数据映射
   */
  getAllServerData() {
    return monitoringFactory.serverStatsMap;
  }
  
  /**
   * 请求特定服务器的系统数据刷新
   * @param {string} serverId 服务器ID或主机地址
   * @returns {Promise<boolean>} 是否成功发送请求
   */
  async requestServerData(serverId) {
    if (!serverId) {
      return false;
    }
    
    // 查找连接到该服务器的所有终端
    const connectedTerminals = [];
    
    // 遍历所有实例，找到连接到指定服务器的终端
    monitoringFactory.instances.forEach((instance, terminalId) => {
      if (instance.state.targetHost === serverId && instance.state.connected) {
        connectedTerminals.push(terminalId);
      }
    });
    
    // 如果没有连接的终端，尝试找到之前的映射关系
    if (connectedTerminals.length === 0) {
      // 查找临时会话中的映射
      this.tempSessions.forEach((session, sessionId) => {
        if (session.host === serverId && session.terminalId) {
          const instance = monitoringFactory.getInstance(session.terminalId);
          if (instance && instance.state.connected) {
            connectedTerminals.push(session.terminalId);
          }
        }
      });
    }
    
    // 如果有连接的终端，请求数据
    if (connectedTerminals.length > 0) {
      // 使用第一个找到的终端请求数据
      return monitoringFactory.requestSystemStats(connectedTerminals[0]);
    }
    
    return false;
  }
}

// 创建代理单例
const monitoringServiceProxy = new MonitoringServiceProxy();

export default monitoringServiceProxy; 