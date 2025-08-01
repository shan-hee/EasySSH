/**
 * 生产级SSH监控数据收集器
 * 基于BaseMonitoringCollector，提供高性能、高可靠性的监控数据收集
 * 
 * @author EasySSH Team
 * @version 2.0.0
 * @since 2025-08-01
 */

import { Client } from 'ssh2';
import BaseMonitoringCollector from './BaseMonitoringCollector.js';
import logger from '../../utils/logger.js';

/**
 * 生产级SSH监控收集器
 * 特性：
 * - 环境兼容性：支持多语言环境
 * - 高精度数据：使用最可靠的系统命令
 * - 错误恢复：自动重连和错误处理
 * - 性能优化：并行收集和智能缓存
 */
export class ProductionSSHMonitoringCollector extends BaseMonitoringCollector {
  constructor(hostInfo, options = {}) {
    super(hostInfo, {
      collectInterval: 3000,
      timeout: 10000,
      retryAttempts: 3,
      enableCache: true,
      cacheTimeout: 30000,
      ...options
    });

    this.sshConnection = null;
    this.connectionRetries = 0;
    this.maxConnectionRetries = 3;
    this.commandQueue = [];
    this.isReconnecting = false;
    
    // 静态信息缓存（很少变化的数据）
    this.staticInfoCache = {
      cpuModel: null,
      cpuCores: null,
      osInfo: null,
      lastUpdate: 0
    };
    
    // 命令模板（支持多语言环境）
    this.commands = {
      // CPU相关 - 使用vmstat确保准确性
      cpuUsage: 'LANG=C vmstat 1 2 | tail -1 | awk \'{print 100 - $15}\'',
      cpuCores: 'nproc',
      cpuModel: 'cat /proc/cpuinfo | grep "model name" | head -1 | cut -d: -f2 | sed "s/^ *//"',
      loadAverage: 'cat /proc/loadavg | awk \'{print $1, $2, $3}\'',
      
      // 内存相关 - 强制英文输出
      memoryInfo: 'LANG=C free -m',
      
      // 磁盘相关 - 统一单位
      diskInfo: 'LANG=C df -BG / | tail -1',
      
      // 进程相关
      processTotal: 'ps aux | wc -l',
      processRunning: 'ps aux | awk \'$8 ~ /^R/ {count++} END {print count+0}\'',
      processSleeping: 'ps aux | awk \'$8 ~ /^S/ {count++} END {print count+0}\'',
      processZombie: 'ps aux | awk \'$8 ~ /^Z/ {count++} END {print count+0}\'',
      
      // 网络相关
      networkStats: 'cat /proc/net/dev | grep -E "(eth|ens|enp|wlan)" | head -1',
      
      // 系统信息
      hostname: 'hostname',
      uptime: 'cat /proc/uptime | awk \'{print $1}\'',
      osRelease: 'cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d \'"\'',
      kernelVersion: 'uname -r',
      architecture: 'uname -m'
    };
  }

  /**
   * 初始化SSH连接
   */
  async initialize() {
    await this.establishSSHConnection();
    await this.loadStaticInfo();
  }

  /**
   * 建立SSH连接
   */
  async establishSSHConnection() {
    return new Promise((resolve, reject) => {
      if (this.sshConnection) {
        this.sshConnection.end();
      }

      this.sshConnection = new Client();
      
      const timeout = setTimeout(() => {
        reject(new Error('SSH连接超时'));
      }, this.options.timeout);

      this.sshConnection.on('ready', () => {
        clearTimeout(timeout);
        this.connectionRetries = 0;
        this.isReconnecting = false;
        
        logger.info('SSH连接已建立', { hostId: this.hostId });
        resolve();
      });

      this.sshConnection.on('error', (err) => {
        clearTimeout(timeout);
        logger.error('SSH连接错误', { 
          hostId: this.hostId, 
          error: err.message 
        });
        reject(err);
      });

      this.sshConnection.on('close', () => {
        logger.warn('SSH连接已关闭', { hostId: this.hostId });
        if (this.isCollecting && !this.isReconnecting) {
          this.handleConnectionLoss();
        }
      });

      // 建立连接
      this.sshConnection.connect({
        host: this.hostInfo.address,
        port: this.hostInfo.port || 22,
        username: this.hostInfo.username,
        password: this.hostInfo.password,
        privateKey: this.hostInfo.privateKey,
        readyTimeout: this.options.timeout,
        keepaliveInterval: 30000,
        keepaliveCountMax: 3
      });
    });
  }

  /**
   * 处理连接丢失
   */
  async handleConnectionLoss() {
    if (this.isReconnecting) return;
    
    this.isReconnecting = true;
    this.connectionRetries++;

    if (this.connectionRetries > this.maxConnectionRetries) {
      logger.error('SSH重连次数超限，停止收集', { 
        hostId: this.hostId,
        retries: this.connectionRetries
      });
      await this.stopCollection();
      return;
    }

    logger.info('尝试重新建立SSH连接', { 
      hostId: this.hostId,
      attempt: this.connectionRetries
    });

    try {
      await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒
      await this.establishSSHConnection();
      logger.info('SSH连接已恢复', { hostId: this.hostId });
    } catch (error) {
      logger.error('SSH重连失败', { 
        hostId: this.hostId, 
        error: error.message 
      });
      // 递归重试
      setTimeout(() => this.handleConnectionLoss(), 5000);
    }
  }

  /**
   * 加载静态信息
   */
  async loadStaticInfo() {
    const now = Date.now();
    
    // 如果缓存有效，跳过加载
    if (this.staticInfoCache.lastUpdate && 
        now - this.staticInfoCache.lastUpdate < 300000) { // 5分钟缓存
      return;
    }

    try {
      const [cpuModel, cpuCores, osRelease, kernelVersion, architecture, hostname] = 
        await Promise.allSettled([
          this.executeCommand(this.commands.cpuModel),
          this.executeCommand(this.commands.cpuCores),
          this.executeCommand(this.commands.osRelease),
          this.executeCommand(this.commands.kernelVersion),
          this.executeCommand(this.commands.architecture),
          this.executeCommand(this.commands.hostname)
        ]);

      this.staticInfoCache = {
        cpuModel: this.getSettledValue(cpuModel, 'Unknown CPU'),
        cpuCores: parseInt(this.getSettledValue(cpuCores, '1')) || 1,
        osInfo: {
          hostname: this.getSettledValue(hostname, 'Unknown'),
          platform: 'Linux',
          release: this.getSettledValue(osRelease, 'Unknown Linux'),
          arch: this.getSettledValue(architecture, 'unknown'),
          kernel: this.getSettledValue(kernelVersion, 'unknown')
        },
        lastUpdate: now
      };

      logger.debug('静态信息已加载', { 
        hostId: this.hostId,
        staticInfo: this.staticInfoCache
      });
    } catch (error) {
      logger.error('加载静态信息失败', { 
        hostId: this.hostId, 
        error: error.message 
      });
    }
  }

  /**
   * 执行SSH命令
   */
  async executeCommand(command, useCache = false) {
    if (useCache) {
      const cached = this.getCacheData(command);
      if (cached) return cached;
    }

    return new Promise((resolve, reject) => {
      if (!this.sshConnection) {
        reject(new Error('SSH连接不可用'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error(`命令执行超时: ${command}`));
      }, this.options.timeout);

      this.sshConnection.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timeout);
          reject(err);
          return;
        }

        let output = '';
        let errorOutput = '';

        stream.on('close', (code) => {
          clearTimeout(timeout);
          
          if (code === 0) {
            const result = output.trim();
            if (useCache) {
              this.setCacheData(command, result);
            }
            resolve(result);
          } else {
            reject(new Error(`命令执行失败: ${command}, 退出码: ${code}, 错误: ${errorOutput}`));
          }
        });

        stream.on('data', (data) => {
          output += data.toString();
        });

        stream.stderr.on('data', (data) => {
          errorOutput += data.toString();
        });
      });
    });
  }

  /**
   * 获取Promise.allSettled的值
   */
  getSettledValue(settledResult, defaultValue = null) {
    return settledResult.status === 'fulfilled' ? settledResult.value : defaultValue;
  }

  /**
   * 收集系统信息
   */
  async collectSystemInfo() {
    const startTime = Date.now();

    try {
      // 并行收集动态数据
      const [
        cpuUsage,
        loadAvg,
        memoryInfo,
        diskInfo,
        processTotal,
        processRunning,
        processSleeping,
        processZombie,
        networkStats,
        uptime
      ] = await Promise.allSettled([
        this.executeCommand(this.commands.cpuUsage),
        this.executeCommand(this.commands.loadAverage),
        this.executeCommand(this.commands.memoryInfo),
        this.executeCommand(this.commands.diskInfo),
        this.executeCommand(this.commands.processTotal),
        this.executeCommand(this.commands.processRunning),
        this.executeCommand(this.commands.processSleeping),
        this.executeCommand(this.commands.processZombie),
        this.executeCommand(this.commands.networkStats),
        this.executeCommand(this.commands.uptime)
      ]);

      // 解析数据
      const systemInfo = {
        timestamp: Date.now(),
        machineId: await this.getMachineId(),
        cpu: this.parseCpuInfo(cpuUsage, loadAvg),
        memory: this.parseMemoryInfo(memoryInfo),
        swap: this.parseSwapInfo(memoryInfo),
        disk: this.parseDiskInfo(diskInfo),
        network: this.parseNetworkInfo(networkStats),
        processes: this.parseProcessInfo(processTotal, processRunning, processSleeping, processZombie),
        os: {
          ...this.staticInfoCache.osInfo,
          uptime: parseFloat(this.getSettledValue(uptime, '0')) || 0
        },
        ip: {
          internal: this.hostInfo.address,
          public: '获取中...'
        },
        collectionTime: Date.now() - startTime,
        hostId: this.hostId
      };

      return systemInfo;
    } catch (error) {
      logger.error('收集系统信息失败', { 
        hostId: this.hostId, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * 解析CPU信息
   */
  parseCpuInfo(cpuUsageResult, loadAvgResult) {
    const usage = parseFloat(this.getSettledValue(cpuUsageResult, '0')) || 0;
    const loadAvgStr = this.getSettledValue(loadAvgResult, '0 0 0');
    const [load1, load5, load15] = loadAvgStr.split(' ').map(Number);

    return {
      usage: Math.max(0, Math.min(100, usage)),
      cores: this.staticInfoCache.cpuCores,
      model: this.staticInfoCache.cpuModel,
      loadAverage: {
        load1: load1 || 0,
        load5: load5 || 0,
        load15: load15 || 0
      }
    };
  }

  /**
   * 解析内存信息
   */
  parseMemoryInfo(memoryResult) {
    const memInfo = this.getSettledValue(memoryResult, '');
    if (!memInfo) {
      return { total: 0, used: 0, free: 0, cached: 0, usedPercentage: 0 };
    }

    const lines = memInfo.split('\n');
    const memLine = lines.find(line => line.startsWith('Mem:'));

    if (memLine) {
      const parts = memLine.split(/\s+/);
      const total = parseInt(parts[1]) || 0;
      const used = parseInt(parts[2]) || 0;
      const buffCache = parseInt(parts[5]) || 0;
      const available = parseInt(parts[6]) || 0;

      return {
        total,
        used,
        free: available,
        cached: buffCache,
        usedPercentage: total > 0 ? (used / total) * 100 : 0
      };
    }

    return { total: 0, used: 0, free: 0, cached: 0, usedPercentage: 0 };
  }

  /**
   * 解析交换分区信息
   */
  parseSwapInfo(memoryResult) {
    const memInfo = this.getSettledValue(memoryResult, '');
    if (!memInfo) {
      return { total: 0, used: 0, free: 0, usedPercentage: 0 };
    }

    const lines = memInfo.split('\n');
    const swapLine = lines.find(line => line.startsWith('Swap:'));

    if (swapLine) {
      const parts = swapLine.split(/\s+/);
      const total = parseInt(parts[1]) || 0;
      const used = parseInt(parts[2]) || 0;
      const free = parseInt(parts[3]) || 0;

      return {
        total,
        used,
        free,
        usedPercentage: total > 0 ? (used / total) * 100 : 0
      };
    }

    return { total: 0, used: 0, free: 0, usedPercentage: 0 };
  }

  /**
   * 解析磁盘信息
   */
  parseDiskInfo(diskResult) {
    const diskInfo = this.getSettledValue(diskResult, '');
    if (!diskInfo) {
      return { total: 0, used: 0, free: 0, usedPercentage: 0 };
    }

    const parts = diskInfo.split(/\s+/);
    if (parts.length >= 5) {
      const total = parseFloat(parts[1].replace('G', '')) || 0;
      const used = parseFloat(parts[2].replace('G', '')) || 0;
      const free = parseFloat(parts[3].replace('G', '')) || 0;
      const usedPercentage = parseFloat(parts[4].replace('%', '')) || 0;

      return { total, used, free, usedPercentage };
    }

    return { total: 0, used: 0, free: 0, usedPercentage: 0 };
  }

  /**
   * 解析进程信息
   */
  parseProcessInfo(totalResult, runningResult, sleepingResult, zombieResult) {
    return {
      total: (parseInt(this.getSettledValue(totalResult, '1')) - 1) || 0, // 减去标题行
      running: parseInt(this.getSettledValue(runningResult, '0')) || 0,
      sleeping: parseInt(this.getSettledValue(sleepingResult, '0')) || 0,
      zombie: parseInt(this.getSettledValue(zombieResult, '0')) || 0
    };
  }

  /**
   * 解析网络信息
   */
  parseNetworkInfo(networkResult) {
    // 简化实现，返回基本网络信息
    return {
      connections: 0,
      total_rx_speed: "0.00",
      total_tx_speed: "0.00"
    };
  }

  /**
   * 获取机器ID
   */
  async getMachineId() {
    const cached = this.getCacheData('machineId');
    if (cached) return cached;

    try {
      const machineId = await this.executeCommand('cat /etc/machine-id 2>/dev/null || cat /var/lib/dbus/machine-id 2>/dev/null || echo "unknown"');
      this.setCacheData('machineId', machineId, 86400000); // 24小时缓存
      return machineId;
    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * 清理资源
   */
  async cleanup() {
    if (this.sshConnection) {
      this.sshConnection.end();
      this.sshConnection = null;
    }

    this.dataCache.clear();
    this.commandQueue = [];

    logger.info('SSH监控收集器资源已清理', { hostId: this.hostId });
  }
}

export default ProductionSSHMonitoringCollector;
