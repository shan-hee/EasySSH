/**
 * 监控状态检查服务 - 重构版
 * 专门处理监控状态的初始化检查，不再阻断WebSocket连接
 * HTTP API用于初始状态获取，WebSocket连接独立处理
 */

import log from './log';

class MonitoringStatusService {
  constructor() {
    this.cache = new Map(); // 缓存检查结果，避免频繁请求
    this.cacheTimeout = 10000; // 缓存10秒（减少缓存时间，提升响应速度）
  }

  /**
   * 检查指定主机的监控数据可用性 - 重构版
   * 不再调用HTTP API，直接返回需要WebSocket验证的状态
   * @param {string} hostname - 主机名或IP地址
   * @returns {Promise<Object>} 检查结果
   */
  async checkMonitoringStatus(hostname) {
    if (!hostname) {
      return {
        success: false,
        installed: false,
        available: false,
        message: '主机名不能为空'
      };
    }

    // 不再调用HTTP API，直接返回需要WebSocket验证的状态
    // 简化逻辑，移除缓存机制，因为状态完全基于WebSocket验证

    const result = {
      success: true,
      installed: false, // 默认为false，实际状态通过WebSocket验证
      available: false, // 默认为false，实际状态通过WebSocket验证
      status: 'requires_websocket_check',
      message: `监控状态需要通过WebSocket连接验证`,
      hostname: hostname,
      dataAge: null,
      lastUpdated: null
    };

    return result;
  }

  /**
   * 批量检查多个主机的监控状态
   * @param {Array<string>} hostnames - 主机名列表
   * @returns {Promise<Array<Object>>} 检查结果列表
   */
  async checkMultipleHosts(hostnames) {
    if (!Array.isArray(hostnames) || hostnames.length === 0) {
      return [];
    }

    const promises = hostnames.map(hostname => this.checkMonitoringStatus(hostname));
    return Promise.all(promises);
  }

  /**
   * 清除指定主机的缓存
   * @param {string} hostname - 主机名
   */
  clearCache(hostname) {
    if (hostname) {
      this.cache.delete(hostname);
      log.debug(`[监控状态] 已清除缓存: ${hostname}`);
    } else {
      this.cache.clear();
      log.debug('[监控状态] 已清除所有缓存');
    }
  }

  /**
   * 获取所有活跃的监控会话
   * @returns {Promise<Object>} 会话信息
   */
  async getAllSessions() {
    try {
      log.debug('[监控状态] 获取所有监控会话');

      // 获取认证token
      const token = localStorage.getItem('auth_token');
      const headers = {
        'Content-Type': 'application/json',
      };

      // 如果有token，添加到请求头
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch('/api/monitor/sessions', {
        method: 'GET',
        headers,
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      log.debug(`[监控状态] 获取到 ${data.count || 0} 个活跃会话`);
      
      return {
        success: data.success || false,
        sessions: data.sessions || [],
        count: data.count || 0,
        message: data.message || ''
      };

    } catch (error) {
      log.warn(`[监控状态] 获取会话失败: ${error.message}`);
      return {
        success: false,
        sessions: [],
        count: 0,
        message: `获取失败: ${error.message}`
      };
    }
  }

  /**
   * 触发监控状态变更事件
   * @param {string} hostname - 主机名
   * @param {boolean} available - 数据是否可用
   * @param {string} terminalId - 终端ID
   * @param {Object} extraData - 额外数据
   */
  emitStatusChangeEvent(hostname, available, terminalId, extraData = {}) {
    const event = new CustomEvent('monitoring-status-change', {
      detail: {
        hostname,
        installed: available, // 保持向后兼容
        available,
        terminalId,
        timestamp: Date.now(),
        ...extraData
      }
    });

    window.dispatchEvent(event);
    log.debug(`[监控状态] 触发状态变更事件: ${hostname} -> 可用: ${available}`);
  }

  /**
   * 仅检查监控状态，不启动WebSocket连接
   * @param {string} hostname - 主机名或IP地址
   * @param {string} terminalId - 终端ID（可选，用于事件）
   * @returns {Promise<Object>} 状态检查结果
   */
  async checkStatusOnly(hostname, terminalId = null) {
    const statusResult = await this.checkMonitoringStatus(hostname);

    // 如果提供了terminalId且监控已安装，触发状态事件
    if (terminalId && statusResult.available) {
      this.emitStatusChangeEvent(hostname, statusResult.available, terminalId, {
        source: 'http_api',
        dataAge: statusResult.dataAge,
        lastUpdated: statusResult.lastUpdated,
        message: 'HTTP API确认监控已安装'
      });
    }

    return statusResult;
  }

  /**
   * 初始化监控状态并启动WebSocket连接 - 重构版
   * HTTP状态检查不再阻断WebSocket连接
   * @param {string} hostname - 主机名或IP地址
   * @param {string} terminalId - 终端ID
   * @returns {Promise<Object>} 初始化结果
   */
  async initializeMonitoring(hostname, terminalId) {
    if (!hostname || !terminalId) {
      return {
        success: false,
        initialized: false,
        message: '参数不完整'
      };
    }

    try {
      // 1. 不再调用HTTP API检查初始状态
      // 监控状态将完全通过WebSocket验证和更新

      // 2. 直接启动WebSocket连接

      // 启动WebSocket连接
      let wsConnected = false;
      try {
        const { default: monitoringFactory } = await import('./monitoringFactory.js');
        wsConnected = await monitoringFactory.connect(terminalId, hostname);

        if (wsConnected) {
          log.info(`[监控状态] WebSocket连接成功: ${hostname}`);
          // 立即请求系统数据，通过WebSocket验证监控状态
          monitoringFactory.requestSystemStats(terminalId);
        } else {
          log.debug(`[监控状态] WebSocket连接失败: ${hostname}`);
        }
      } catch (wsError) {
        log.debug(`[监控状态] WebSocket连接异常: ${wsError.message}`);
      }

      return {
        success: true,
        initialized: true,
        initialStatus: {
          available: false, // 默认为false，实际状态通过WebSocket验证
          installed: false, // 默认为false，实际状态通过WebSocket验证
          message: '监控状态将通过WebSocket验证',
          dataAge: null
        },
        websocketConnected: wsConnected,
        message: '监控初始化完成，状态将通过WebSocket验证'
      };

    } catch (error) {
      log.warn(`[监控状态] 初始化失败: ${hostname} -> ${error.message}`);
      this.emitStatusChangeEvent(hostname, false, terminalId);
      return {
        success: false,
        initialized: false,
        message: `初始化失败: ${error.message}`
      };
    }
  }

  /**
   * 检查监控状态并尝试建立WebSocket连接 - 兼容性方法
   * @deprecated 使用 initializeMonitoring 替代
   * @param {string} hostname - 主机名或IP地址
   * @param {string} terminalId - 终端ID
   * @returns {Promise<Object>} 检查和连接结果
   */
  async checkStatusAndConnect(hostname, terminalId) {
    log.warn('[监控状态] checkStatusAndConnect 方法已废弃，请使用 initializeMonitoring');
    const result = await this.initializeMonitoring(hostname, terminalId);

    // 转换为旧格式以保持兼容性
    return {
      success: result.success,
      installed: result.initialStatus?.installed || false,
      connected: result.websocketConnected || false,
      message: result.message
    };
  }
}

// 创建单例实例
const monitoringStatusService = new MonitoringStatusService();

export default monitoringStatusService;
