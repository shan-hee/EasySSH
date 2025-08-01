/**
 * 优化版SSH监控数据收集器
 * 增强性能、可靠性和错误处理
 */

const logger = require('../utils/logger');
const EventEmitter = require('events');

class OptimizedSSHMonitoringCollector extends EventEmitter {
  constructor(sshConnection, hostInfo) {
    super();
    
    this.sshConnection = sshConnection;
    this.hostInfo = hostInfo;
    this.isCollecting = false;
    this.collectionInterval = null;
    this.hostId = null;
    
    // 性能优化：数据缓存
    this.dataCache = {
      lastNetworkStats: { rx_bytes: 0, tx_bytes: 0, timestamp: Date.now() },
      staticInfo: null, // 缓存不变的系统信息
      lastStaticInfoUpdate: 0,
      staticInfoUpdateInterval: 5 * 60 * 1000 // 静态信息每5分钟更新一次
    };
    
    // IP信息缓存优化
    this.ipCache = {
      internal: null,
      public: null,
      lastInternalUpdate: 0,
      lastPublicUpdate: 0,
      publicUpdateInterval: 10 * 60 * 1000,
      internalUpdateInterval: 60 * 1000 // 优化：内网IP每分钟更新一次
    };
    
    // 错误处理和重试机制
    this.errorStats = {
      consecutiveErrors: 0,
      lastErrorTime: 0,
      maxRetries: 3,
      backoffMultiplier: 1.5,
      baseInterval: 3000
    };
    
    // 命令执行缓存
    this.commandCache = new Map();
    this.commandCacheTimeout = 2000; // 2秒内相同命令使用缓存
  }

  /**
   * 开始监控数据收集
   * @param {Function} dataCallback 数据回调函数
   * @param {number} interval 收集间隔（毫秒）
   */
  startCollection(dataCallback, interval = 3000) {
    if (this.isCollecting) {
      logger.warn('监控数据收集已在进行中', { hostId: this.hostId });
      return;
    }

    this.isCollecting = true;
    this.dataCallback = dataCallback;
    this.baseInterval = interval;

    logger.info('开始优化版SSH监控数据收集', { 
      host: this.hostInfo.address,
      interval: interval + 'ms'
    });

    // 立即收集一次数据
    this.collectSystemInfo();

    // 设置自适应间隔收集
    this.scheduleNextCollection();
  }

  /**
   * 自适应调度下次收集
   */
  scheduleNextCollection() {
    if (!this.isCollecting) return;

    // 根据错误情况调整收集间隔
    let nextInterval = this.baseInterval;
    if (this.errorStats.consecutiveErrors > 0) {
      nextInterval = Math.min(
        this.baseInterval * Math.pow(this.errorStats.backoffMultiplier, this.errorStats.consecutiveErrors),
        30000 // 最大30秒
      );
    }

    this.collectionInterval = setTimeout(() => {
      this.collectSystemInfo();
      this.scheduleNextCollection();
    }, nextInterval);
  }

  /**
   * 停止监控数据收集
   */
  stopCollection() {
    if (!this.isCollecting) {
      logger.debug('监控数据收集已停止，跳过重复停止', { hostId: this.hostId });
      return;
    }

    this.isCollecting = false;

    // 清理定时器
    if (this.collectionInterval) {
      clearTimeout(this.collectionInterval);
      this.collectionInterval = null;
    }

    // 清理缓存
    this.commandCache.clear();

    // 清理SSH连接引用
    this.sshConnection = null;
    this.dataCallback = null;

    logger.info('停止优化版SSH监控数据收集', { hostId: this.hostId });
    this.emit('stopped');
  }

  /**
   * 收集系统信息（优化版）
   */
  async collectSystemInfo() {
    if (!this.isCollecting || !this.sshConnection) {
      logger.debug('监控数据收集已停止或SSH连接不可用', { hostId: this.hostId });
      return;
    }

    try {
      const startTime = Date.now();
      logger.info('开始收集系统信息', { hostId: this.hostId });
      
      // 并行收集数据以提高性能
      const [
        machineId,
        cpu,
        memory,
        swap,
        disk,
        network,
        processes,
        osInfo,
        ipInfo
      ] = await Promise.allSettled([
        this.getMachineId(),
        this.getCpuInfo(),
        this.getMemoryInfo(),
        this.getSwapInfo(),
        this.getDiskInfo(),
        this.getNetworkInfo(),
        this.getProcessInfo(),
        this.getOsInfo(),
        this.getIpInfo()
      ]);

      const systemInfo = {
        timestamp: Date.now(),
        machineId: this.getSettledValue(machineId, 'unknown'),
        cpu: this.getSettledValue(cpu, { usage: 0, cores: 1, model: 'Unknown', loadAverage: { load1: 0, load5: 0, load15: 0 } }),
        memory: this.getSettledValue(memory, { total: 0, used: 0, free: 0, cached: 0, usedPercentage: 0 }),
        swap: this.getSettledValue(swap, { total: 0, used: 0, free: 0, usedPercentage: 0 }),
        disk: this.getSettledValue(disk, { total: 0, used: 0, free: 0, usedPercentage: 0 }),
        network: this.getSettledValue(network, { connections: 0, total_rx_speed: "0.00", total_tx_speed: "0.00" }),
        processes: this.getSettledValue(processes, { total: 0, running: 0, sleeping: 0, zombie: 0 }),
        os: this.getSettledValue(osInfo, { hostname: this.hostInfo.address, platform: 'Linux', release: 'unknown', arch: 'unknown', distro: 'Unknown Linux' }),
        ip: this.getSettledValue(ipInfo, { internal: this.hostInfo.address, public: '获取失败' }),
        collectionTime: Date.now() - startTime // 添加收集耗时统计
      };

      // 生成或更新hostId
      this.updateHostId(systemInfo);

      // 添加hostId到系统信息
      systemInfo.hostId = this.hostId;

      // 重置错误计数
      this.errorStats.consecutiveErrors = 0;

      // 调用数据回调
      if (this.dataCallback) {
        this.dataCallback({
          type: 'system_stats',
          hostId: this.hostId,
          payload: {
            ...systemInfo,
            hostId: this.hostId
          }
        });
      }

      this.emit('dataCollected', systemInfo);

    } catch (error) {
      this.handleCollectionError(error);
    }
  }

  /**
   * 处理Promise.allSettled的结果
   */
  getSettledValue(settledResult, defaultValue) {
    return settledResult.status === 'fulfilled' ? settledResult.value : defaultValue;
  }

  /**
   * 处理收集错误
   */
  handleCollectionError(error) {
    this.errorStats.consecutiveErrors++;
    this.errorStats.lastErrorTime = Date.now();

    logger.error('收集系统信息失败', {
      error: error.message,
      host: this.hostInfo.address,
      hostId: this.hostId,
      consecutiveErrors: this.errorStats.consecutiveErrors
    });

    // 如果连续错误过多，停止收集
    if (this.errorStats.consecutiveErrors >= this.errorStats.maxRetries) {
      logger.warn('连续错误过多，停止监控数据收集', {
        hostId: this.hostId,
        consecutiveErrors: this.errorStats.consecutiveErrors
      });
      this.stopCollection();
      return;
    }

    // 如果是连接相关错误，自动停止收集
    if (this.isConnectionError(error)) {
      logger.info('检测到SSH连接问题，自动停止监控数据收集', {
        hostId: this.hostId,
        error: error.message
      });
      this.stopCollection();
    }

    this.emit('error', error);
  }

  /**
   * 判断是否为连接错误
   */
  isConnectionError(error) {
    const connectionErrorPatterns = [
      'SSH连接',
      'Not connected',
      'Unable to exec',
      'Connection closed',
      'ECONNRESET',
      'ENOTFOUND'
    ];
    
    return connectionErrorPatterns.some(pattern => 
      error.message.includes(pattern)
    );
  }

  /**
   * 更新主机标识符
   */
  updateHostId(systemInfo) {
    if (!this.hostId) {
      const hostname = systemInfo.os.hostname;
      const publicIp = systemInfo.ip.public;
      const internalIp = systemInfo.ip.internal;
      const connectionIp = this.hostInfo.address;

      // 始终优先使用连接IP
      let ipAddress = connectionIp;
      
      if (!ipAddress || ipAddress === '获取失败' || ipAddress === 'null' || ipAddress.trim() === '') {
        if (publicIp && publicIp !== '获取失败' && publicIp !== 'null' && publicIp.trim() !== '') {
          ipAddress = publicIp;
        } else {
          ipAddress = internalIp || 'unknown';
        }
      }

      this.hostId = `${hostname}@${ipAddress}`;
      logger.info('生成主机标识符', {
        hostId: this.hostId,
        connectionIp,
        publicIp,
        internalIp,
        selectedIp: ipAddress
      });
    }
  }

  /**
   * 优化的命令执行方法（带缓存）
   */
  async executeCommand(command, useCache = false) {
    // 检查缓存
    if (useCache && this.commandCache.has(command)) {
      const cached = this.commandCache.get(command);
      if (Date.now() - cached.timestamp < this.commandCacheTimeout) {
        return cached.result;
      }
    }

    return new Promise((resolve, reject) => {
      if (!this.isCollecting || !this.sshConnection) {
        reject(new Error('监控数据收集已停止或SSH连接不可用'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('命令执行超时'));
      }, 8000); // 减少超时时间到8秒

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
            
            // 缓存结果
            if (useCache) {
              this.commandCache.set(command, {
                result,
                timestamp: Date.now()
              });
            }
            
            resolve(result);
          } else {
            reject(new Error(`命令执行失败，退出码: ${code}, 错误: ${errorOutput}`));
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
   * 获取机器唯一标识（优化版）
   */
  async getMachineId() {
    try {
      // 使用缓存的静态信息
      if (this.dataCache.staticInfo &&
          Date.now() - this.dataCache.lastStaticInfoUpdate < this.dataCache.staticInfoUpdateInterval) {
        return this.dataCache.staticInfo.machineId;
      }

      const result = await this.executeCommand(
        'cat /etc/machine-id 2>/dev/null || cat /var/lib/dbus/machine-id 2>/dev/null || echo ""',
        true // 使用缓存
      );

      if (result && result.trim()) {
        const machineId = result.trim();
        this.updateStaticInfoCache('machineId', machineId);
        return machineId;
      }

      // 备用方案
      const hostname = await this.executeCommand('hostname', true);
      const cpuModel = await this.executeCommand(
        'cat /proc/cpuinfo | grep "model name" | head -1 | cut -d: -f2 | sed "s/^ *//" | sed "s/ /-/g"',
        true
      );
      const machineId = `${hostname.trim()}-${cpuModel.trim()}`;
      this.updateStaticInfoCache('machineId', machineId);
      return machineId;
    } catch (error) {
      logger.warn('获取机器ID失败', { error: error.message });
      return `${this.hostInfo.address}-unknown`;
    }
  }

  /**
   * 获取CPU信息（优化版）
   */
  async getCpuInfo() {
    try {
      // 并行获取CPU信息
      const [cpuUsage, cpuCores, cpuModel, loadAvg] = await Promise.allSettled([
        this.executeCommand('vmstat 1 2 | tail -1 | awk \'{print 100 - $15}\''), // 使用vmstat获取更准确的CPU使用率
        this.executeCommand('nproc', true), // CPU核心数不变，使用缓存
        this.executeCommand('cat /proc/cpuinfo | grep "model name" | head -1 | cut -d: -f2 | sed "s/^ *//"', true), // CPU型号不变，使用缓存
        this.executeCommand('cat /proc/loadavg | awk \'{print $1, $2, $3}\'')
      ]);

      // 解析负载平均值
      const loadAvgStr = this.getSettledValue(loadAvg, '0 0 0');
      const [load1, load5, load15] = loadAvgStr.split(' ').map(Number);

      const result = {
        usage: Math.round(parseFloat(this.getSettledValue(cpuUsage, '0')) * 100) / 100 || 0,
        cores: parseInt(this.getSettledValue(cpuCores, '1')) || 1,
        model: this.getSettledValue(cpuModel, 'Unknown') || 'Unknown',
        loadAverage: {
          load1: load1 || 0,
          load5: load5 || 0,
          load15: load15 || 0
        }
      };

      logger.debug('CPU信息获取成功', { result });
      return result;
    } catch (error) {
      logger.error('获取CPU信息失败', { error: error.message });
      return {
        usage: 0,
        cores: 1,
        model: 'Unknown',
        loadAverage: { load1: 0, load5: 0, load15: 0 }
      };
    }
  }

  /**
   * 获取内存信息（优化版）
   */
  async getMemoryInfo() {
    try {
      // 使用LANG=C强制英文输出
      const memInfo = await this.executeCommand('LANG=C free -m');

      if (!memInfo || memInfo.trim() === '') {
        logger.error('free命令返回空结果');
        return { total: 0, used: 0, free: 0, cached: 0, usedPercentage: 0 };
      }

      const lines = memInfo.trim().split('\n');
      const memLine = lines.find(line => line.startsWith('Mem:'));

      if (memLine) {
        const parts = memLine.split(/\s+/);
        const total = parseInt(parts[1]) || 0;
        const used = parseInt(parts[2]) || 0;
        const buffCache = parseInt(parts[5]) || 0;
        const available = parseInt(parts[6]) || 0;

        const result = {
          total,
          used,
          free: available, // 使用available作为可用内存
          cached: buffCache,
          usedPercentage: total > 0 ? Math.round((used / total) * 100 * 100) / 100 : 0
        };

        logger.debug('内存信息获取成功', { result });
        return result;
      }

      logger.error('未找到Mem:行', { memInfo, lines: lines.length });
      return { total: 0, used: 0, free: 0, cached: 0, usedPercentage: 0 };
    } catch (error) {
      logger.error('获取内存信息失败', { error: error.message });
      return { total: 0, used: 0, free: 0, cached: 0, usedPercentage: 0 };
    }
  }

  /**
   * 获取交换分区信息（优化版）
   */
  async getSwapInfo() {
    try {
      // 使用LANG=C强制英文输出
      const memInfo = await this.executeCommand('LANG=C free -m');

      if (!memInfo || memInfo.trim() === '') {
        logger.error('free命令返回空结果(swap)');
        return { total: 0, used: 0, free: 0, usedPercentage: 0 };
      }

      const lines = memInfo.trim().split('\n');
      const swapLine = lines.find(line => line.startsWith('Swap:'));

      if (swapLine) {
        const parts = swapLine.split(/\s+/);
        const total = parseInt(parts[1]) || 0;
        const used = parseInt(parts[2]) || 0;
        const free = parseInt(parts[3]) || 0;

        const result = {
          total,
          used,
          free,
          usedPercentage: total > 0 ? Math.round((used / total) * 100 * 100) / 100 : 0
        };

        logger.debug('交换分区信息获取成功', { result });
        return result;
      }

      logger.error('未找到Swap:行', { memInfo, lines: lines.length });
      return { total: 0, used: 0, free: 0, usedPercentage: 0 };
    } catch (error) {
      logger.error('获取交换分区信息失败', { error: error.message });
      return { total: 0, used: 0, free: 0, usedPercentage: 0 };
    }
  }

  /**
   * 获取磁盘信息（优化版）
   */
  async getDiskInfo() {
    try {
      const diskInfo = await this.executeCommand('df -h / | tail -1');
      const parts = diskInfo.trim().split(/\s+/);

      if (parts.length >= 5) {
        const total = parseFloat(parts[1].replace('G', '')) || 0;
        const used = parseFloat(parts[2].replace('G', '')) || 0;
        const free = parseFloat(parts[3].replace('G', '')) || 0;
        const usedPercentage = parseFloat(parts[4].replace('%', '')) || 0;

        return {
          total: Math.round(total * 100) / 100,
          used: Math.round(used * 100) / 100,
          free: Math.round(free * 100) / 100,
          usedPercentage
        };
      }

      return { total: 0, used: 0, free: 0, usedPercentage: 0 };
    } catch (error) {
      logger.warn('获取磁盘信息失败', { error: error.message });
      return { total: 0, used: 0, free: 0, usedPercentage: 0 };
    }
  }

  /**
   * 获取网络信息（优化版）
   */
  async getNetworkInfo() {
    try {
      const netDev = await this.executeCommand('cat /proc/net/dev');
      const lines = netDev.trim().split('\n').slice(2);
      const currentTime = Date.now();
      let totalRxBytes = 0;
      let totalTxBytes = 0;

      lines.forEach(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 10) {
          const interfaceName = parts[0].replace(':', '');
          if (interfaceName !== 'lo') {
            totalRxBytes += parseInt(parts[1]) || 0;
            totalTxBytes += parseInt(parts[9]) || 0;
          }
        }
      });

      const timeDiff = (currentTime - this.dataCache.lastNetworkStats.timestamp) / 1000;
      let rxSpeed = 0;
      let txSpeed = 0;

      if (timeDiff > 0 && this.dataCache.lastNetworkStats.rx_bytes > 0) {
        rxSpeed = (totalRxBytes - this.dataCache.lastNetworkStats.rx_bytes) / timeDiff;
        txSpeed = (totalTxBytes - this.dataCache.lastNetworkStats.tx_bytes) / timeDiff;
      }

      // 更新缓存
      this.dataCache.lastNetworkStats = {
        rx_bytes: totalRxBytes,
        tx_bytes: totalTxBytes,
        timestamp: currentTime
      };

      return {
        connections: 0,
        total_rx_speed: (rxSpeed / 1024).toFixed(2),
        total_tx_speed: (txSpeed / 1024).toFixed(2)
      };
    } catch (error) {
      logger.warn('获取网络信息失败', { error: error.message });
      return { connections: 0, total_rx_speed: "0.00", total_tx_speed: "0.00" };
    }
  }

  /**
   * 获取操作系统信息（优化版）
   */
  async getOsInfo() {
    try {
      // 使用缓存的静态信息
      if (this.dataCache.staticInfo && this.dataCache.staticInfo.osInfo &&
          Date.now() - this.dataCache.lastStaticInfoUpdate < this.dataCache.staticInfoUpdateInterval) {
        return this.dataCache.staticInfo.osInfo;
      }

      const [hostname, platform, release, arch] = await Promise.allSettled([
        this.executeCommand('hostname', true),
        this.executeCommand('uname -s', true),
        this.executeCommand('uname -r', true),
        this.executeCommand('uname -m', true)
      ]);

      // 尝试获取发行版信息
      let distro = 'Unknown';
      try {
        distro = await this.executeCommand(
          'cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | sed \'s/"//g\'',
          true
        );
      } catch (e) {
        try {
          distro = await this.executeCommand('lsb_release -d | cut -f2', true);
        } catch (e2) {
          // 使用默认值
        }
      }

      const osInfo = {
        hostname: this.getSettledValue(hostname, this.hostInfo.address),
        platform: this.getSettledValue(platform, 'Linux'),
        release: this.getSettledValue(release, 'unknown'),
        arch: this.getSettledValue(arch, 'unknown'),
        distro: distro || 'Unknown Linux'
      };

      // 缓存操作系统信息
      this.updateStaticInfoCache('osInfo', osInfo);
      return osInfo;
    } catch (error) {
      logger.warn('获取操作系统信息失败', { error: error.message });
      return {
        hostname: this.hostInfo.address,
        platform: 'Linux',
        release: 'unknown',
        arch: 'unknown',
        distro: 'Unknown Linux'
      };
    }
  }

  /**
   * 获取IP信息（优化版）
   */
  async getIpInfo() {
    const now = Date.now();

    // 更新内网IP（每分钟更新一次）
    if (now - this.ipCache.lastInternalUpdate > this.ipCache.internalUpdateInterval) {
      try {
        const internalIp = await this.executeCommand('hostname -I | awk \'{print $1}\'');
        this.ipCache.internal = internalIp || this.hostInfo.address;
        this.ipCache.lastInternalUpdate = now;
      } catch (error) {
        this.ipCache.internal = this.hostInfo.address;
      }
    }

    // 更新公网IP（每10分钟更新一次）
    if (now - this.ipCache.lastPublicUpdate > this.ipCache.publicUpdateInterval) {
      try {
        const publicIp = await this.executeCommand(
          'timeout 5 curl -s --max-time 3 ifconfig.me || timeout 5 curl -s --max-time 3 ipinfo.io/ip || echo "获取失败"'
        );
        this.ipCache.public = publicIp || '获取失败';
        this.ipCache.lastPublicUpdate = now;
      } catch (error) {
        this.ipCache.public = '获取失败';
      }
    }

    return {
      internal: this.ipCache.internal || this.hostInfo.address,
      public: this.ipCache.public || '获取失败'
    };
  }

  /**
   * 获取位置信息（优化版）
   */
  async getLocationInfo() {
    // 简化实现，返回基本信息
    return {
      country: 'Unknown',
      region: 'Unknown',
      city: 'Unknown',
      timezone: 'Unknown'
    };
  }

  /**
   * 判断IP是否为私有IP地址
   */
  isPrivateIP(ip) {
    if (!ip || typeof ip !== 'string') return false;

    const privateRanges = [
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^127\./
    ];

    return privateRanges.some(range => range.test(ip));
  }

  /**
   * 获取进程信息
   */
  async getProcessInfo() {
    try {
      const [totalProcesses, runningProcesses, sleepingProcesses, zombieProcesses] = await Promise.allSettled([
        this.executeCommand('ps aux | wc -l'),
        this.executeCommand('ps aux | awk \'$8 ~ /^R/ {count++} END {print count+0}\''),
        this.executeCommand('ps aux | awk \'$8 ~ /^S/ {count++} END {print count+0}\''),
        this.executeCommand('ps aux | awk \'$8 ~ /^Z/ {count++} END {print count+0}\'')
      ]);

      const result = {
        total: (parseInt(this.getSettledValue(totalProcesses, '1')) - 1) || 0, // 减去标题行
        running: parseInt(this.getSettledValue(runningProcesses, '0')) || 0,
        sleeping: parseInt(this.getSettledValue(sleepingProcesses, '0')) || 0,
        zombie: parseInt(this.getSettledValue(zombieProcesses, '0')) || 0
      };

      logger.debug('进程信息获取成功', { result });
      return result;
    } catch (error) {
      logger.error('获取进程信息失败', { error: error.message });
      return { total: 0, running: 0, sleeping: 0, zombie: 0 };
    }
  }

  /**
   * 更新静态信息缓存
   */
  updateStaticInfoCache(key, value) {
    if (!this.dataCache.staticInfo) {
      this.dataCache.staticInfo = {};
    }
    this.dataCache.staticInfo[key] = value;
    this.dataCache.lastStaticInfoUpdate = Date.now();
  }

  /**
   * 获取收集器统计信息
   */
  getStats() {
    return {
      isCollecting: this.isCollecting,
      hostId: this.hostId,
      errorStats: { ...this.errorStats },
      cacheStats: {
        commandCacheSize: this.commandCache.size,
        staticInfoCached: !!this.dataCache.staticInfo,
        lastStaticInfoUpdate: this.dataCache.lastStaticInfoUpdate
      }
    };
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.stopCollection();
    this.commandCache.clear();
    this.dataCache.staticInfo = null;
    this.removeAllListeners();
  }
}

module.exports = OptimizedSSHMonitoringCollector;
