/**
 * 监控状态检查服务
 * 提供快速检查远程服务器监控服务状态的功能
 */

import log from './log';

class MonitoringStatusService {
  constructor() {
    this.cache = new Map(); // 缓存检查结果，避免频繁请求
    this.cacheTimeout = 30000; // 缓存30秒
  }

  /**
   * 检查指定主机的监控服务状态
   * @param {string} hostname - 主机名或IP地址
   * @returns {Promise<Object>} 检查结果
   */
  async checkMonitoringStatus(hostname) {
    if (!hostname) {
      return {
        success: false,
        installed: false,
        message: '主机名不能为空'
      };
    }

    // 检查缓存
    const cacheKey = hostname;
    const cached = this.cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
      log.debug(`[监控状态] 使用缓存结果: ${hostname} -> ${cached.result.installed}`);
      return cached.result;
    }

    try {
      log.debug(`[监控状态] 检查主机监控状态: ${hostname}`);

      // 获取认证token
      const token = localStorage.getItem('auth_token');
      const headers = {
        'Content-Type': 'application/json',
      };

      // 如果有token，添加到请求头
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`/api/monitor/status?hostname=${encodeURIComponent(hostname)}`, {
        method: 'GET',
        headers,
        credentials: 'include' // 包含认证信息
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      const result = {
        success: data.success || false,
        installed: data.status === 'connected',
        status: data.status,
        message: data.message || '',
        client: data.client || null,
        hostname: hostname
      };

      // 缓存结果
      this.cache.set(cacheKey, {
        result,
        timestamp: Date.now()
      });

      log.debug(`[监控状态] 检查完成: ${hostname} -> 已安装: ${result.installed}`);
      return result;

    } catch (error) {
      log.warn(`[监控状态] 检查失败: ${hostname} -> ${error.message}`);
      
      const result = {
        success: false,
        installed: false,
        status: 'error',
        message: `检查失败: ${error.message}`,
        hostname: hostname
      };

      // 缓存失败结果，但时间较短
      this.cache.set(cacheKey, {
        result,
        timestamp: Date.now()
      });

      return result;
    }
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
   * @param {boolean} installed - 是否已安装
   * @param {string} terminalId - 终端ID
   */
  emitStatusChangeEvent(hostname, installed, terminalId) {
    const event = new CustomEvent('monitoring-status-change', {
      detail: {
        hostname,
        installed,
        terminalId,
        timestamp: Date.now()
      }
    });

    window.dispatchEvent(event);
    log.debug(`[监控状态] 触发状态变更事件: ${hostname} -> ${installed}`);
  }

  /**
   * 检查监控状态并尝试建立WebSocket连接
   * @param {string} hostname - 主机名或IP地址
   * @param {string} terminalId - 终端ID
   * @returns {Promise<Object>} 检查和连接结果
   */
  async checkStatusAndConnect(hostname, terminalId) {
    if (!hostname || !terminalId) {
      return {
        success: false,
        installed: false,
        connected: false,
        message: '参数不完整'
      };
    }

    try {
      // 首先检查API状态
      const statusResult = await this.checkMonitoringStatus(hostname);

      if (!statusResult.installed) {
        log.debug(`[监控状态] 服务未安装，跳过WebSocket连接: ${hostname}`);
        this.emitStatusChangeEvent(hostname, false, terminalId);
        return {
          success: true,
          installed: false,
          connected: false,
          message: statusResult.message
        };
      }

      // API检查成功，立即更新UI状态
      log.debug(`[监控状态] 服务已安装，更新UI状态: ${hostname}`);
      this.emitStatusChangeEvent(hostname, true, terminalId);

      // 尝试建立WebSocket连接获取实时数据
      try {
        const { default: monitoringFactory } = await import('./monitoringFactory.js');
        const connected = await monitoringFactory.connect(terminalId, hostname);

        if (connected) {
          log.info(`[监控状态] WebSocket连接成功: ${hostname}`);
          // 立即请求系统数据
          monitoringFactory.requestSystemStats(terminalId);
        } else {
          log.warn(`[监控状态] WebSocket连接失败，但服务已安装: ${hostname}`);
        }

        return {
          success: true,
          installed: true,
          connected: connected,
          message: connected ? '连接成功' : 'WebSocket连接失败，但服务已安装'
        };

      } catch (wsError) {
        log.warn(`[监控状态] WebSocket连接异常: ${wsError.message}`);
        return {
          success: true,
          installed: true,
          connected: false,
          message: `WebSocket连接失败: ${wsError.message}`
        };
      }

    } catch (error) {
      log.warn(`[监控状态] 检查和连接失败: ${hostname} -> ${error.message}`);
      this.emitStatusChangeEvent(hostname, false, terminalId);
      return {
        success: false,
        installed: false,
        connected: false,
        message: `检查失败: ${error.message}`
      };
    }
  }
}

// 创建单例实例
const monitoringStatusService = new MonitoringStatusService();

export default monitoringStatusService;
