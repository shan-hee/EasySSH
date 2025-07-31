/**
 * SSH监控数据收集器
 * 通过SSH连接执行系统命令获取监控数据，无需安装额外组件
 */

const logger = require('../utils/logger');

class SSHMonitoringCollector {
  constructor(sshConnection, hostInfo) {
    this.sshConnection = sshConnection;
    this.hostInfo = hostInfo; // { address, port, username }
    this.isCollecting = false;
    this.collectionInterval = null;
    this.lastNetworkStats = { rx_bytes: 0, tx_bytes: 0, timestamp: Date.now() };
    this.hostId = null;
    this.ipCache = {
      internal: null,
      public: null,
      lastInternalUpdate: 0,
      lastPublicUpdate: 0,
      publicUpdateInterval: 10 * 60 * 1000, // 公网IP每10分钟更新一次
      internalUpdateInterval: 30 * 1000     // 内网IP每30秒更新一次
    };
  }

  /**
   * 开始监控数据收集
   * @param {Function} dataCallback 数据回调函数
   * @param {number} interval 收集间隔（毫秒），默认3秒
   */
  startCollection(dataCallback, interval = 3000) {
    if (this.isCollecting) {
      logger.warn('监控数据收集已在进行中', { hostId: this.hostId });
      return;
    }

    this.isCollecting = true;
    this.dataCallback = dataCallback;

    logger.info('开始SSH监控数据收集', { 
      host: this.hostInfo.address,
      interval: interval + 'ms'
    });

    // 立即收集一次数据
    this.collectSystemInfo();

    // 设置定时收集
    this.collectionInterval = setInterval(() => {
      this.collectSystemInfo();
    }, interval);
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
      clearInterval(this.collectionInterval);
      this.collectionInterval = null;
    }

    // 清理SSH连接引用，防止继续使用
    this.sshConnection = null;
    this.dataCallback = null;

    logger.info('停止SSH监控数据收集', { hostId: this.hostId });
  }

  /**
   * 收集系统信息
   */
  async collectSystemInfo() {
    // 检查收集状态和SSH连接
    if (!this.isCollecting) {
      logger.debug('监控数据收集已停止，跳过数据收集', { hostId: this.hostId });
      return;
    }

    if (!this.sshConnection) {
      logger.debug('SSH连接不可用，停止监控数据收集', { hostId: this.hostId });
      this.stopCollection();
      return;
    }

    try {
      const systemInfo = {
        timestamp: Date.now(),
        machineId: await this.getMachineId(),
        cpu: await this.getCpuInfo(),
        memory: await this.getMemoryInfo(),
        swap: await this.getSwapInfo(),
        disk: await this.getDiskInfo(),
        network: await this.getNetworkInfo(),
        os: await this.getOsInfo(),
        ip: await this.getIpInfo(),
        location: await this.getLocationInfo()
      };

      // 生成hostId
      if (!this.hostId) {
        const hostname = systemInfo.os.hostname;
        const publicIp = systemInfo.ip.public;
        const internalIp = systemInfo.ip.internal;

        // 优先使用公网IP，如果公网IP无效则使用内网IP
        let ipAddress = internalIp;
        if (publicIp && publicIp !== '获取失败' && publicIp !== 'null' && publicIp.trim() !== '') {
          ipAddress = publicIp;
        }

        this.hostId = `${hostname}@${ipAddress}`;
        logger.info('生成主机标识符', { hostId: this.hostId });
      }

      // 添加hostId到系统信息
      systemInfo.hostId = this.hostId;

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

    } catch (error) {
      logger.error('收集系统信息失败', {
        error: error.message,
        host: this.hostInfo.address,
        hostId: this.hostId
      });

      // 如果是连接相关错误，自动停止收集
      if (error.message.includes('SSH连接') ||
          error.message.includes('Not connected') ||
          error.message.includes('Unable to exec') ||
          error.message.includes('监控数据收集已停止')) {
        logger.info('检测到SSH连接问题，自动停止监控数据收集', {
          hostId: this.hostId,
          error: error.message
        });
        this.stopCollection();
      }
    }
  }

  /**
   * 执行SSH命令
   * @param {string} command 要执行的命令
   * @returns {Promise<string>} 命令输出
   */
  executeCommand(command) {
    return new Promise((resolve, reject) => {
      // 检查收集状态和SSH连接
      if (!this.isCollecting) {
        reject(new Error('监控数据收集已停止'));
        return;
      }

      if (!this.sshConnection) {
        reject(new Error('SSH连接不可用'));
        return;
      }

      this.sshConnection.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        let output = '';
        let errorOutput = '';

        stream.on('close', (code) => {
          if (code === 0) {
            resolve(output.trim());
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

        // 设置超时
        setTimeout(() => {
          stream.close();
          reject(new Error('命令执行超时'));
        }, 10000);
      });
    });
  }

  /**
   * 获取机器唯一标识
   */
  async getMachineId() {
    try {
      const result = await this.executeCommand('cat /etc/machine-id 2>/dev/null || cat /var/lib/dbus/machine-id 2>/dev/null || echo ""');
      if (result && result.trim()) {
        return result.trim();
      }

      // 备用方案：使用hostname和CPU信息
      const hostname = await this.executeCommand('hostname');
      const cpuModel = await this.executeCommand('cat /proc/cpuinfo | grep "model name" | head -1 | cut -d: -f2 | sed "s/^ *//" | sed "s/ /-/g"');
      return `${hostname.trim()}-${cpuModel.trim()}`;
    } catch (error) {
      logger.warn('获取机器ID失败', { error: error.message });
      return `${this.hostInfo.address}-unknown`;
    }
  }

  /**
   * 获取CPU信息
   */
  async getCpuInfo() {
    try {
      // 获取CPU使用率
      const cpuUsage = await this.executeCommand('top -bn1 | grep "Cpu(s)" | sed "s/.*, *\\([0-9.]*\\)%* id.*/\\1/" | awk \'{print 100 - $1}\'');

      // 获取CPU核心数和型号
      const cpuCores = await this.executeCommand('nproc');
      const cpuModel = await this.executeCommand('cat /proc/cpuinfo | grep "model name" | head -1 | cut -d: -f2 | sed "s/^ *//"');

      return {
        usage: Math.round(parseFloat(cpuUsage) * 100) / 100 || 0,
        cores: parseInt(cpuCores) || 1,
        model: cpuModel || 'Unknown'
      };
    } catch (error) {
      logger.warn('获取CPU信息失败', { error: error.message });
      return { usage: 0, cores: 1, model: 'Unknown' };
    }
  }

  /**
   * 获取内存信息
   */
  async getMemoryInfo() {
    try {
      const memInfo = await this.executeCommand('free -m');
      const lines = memInfo.trim().split('\n');
      const memLine = lines.find(line => line.startsWith('Mem:'));

      if (memLine) {
        const parts = memLine.split(/\s+/);
        const total = parseInt(parts[1]) || 0;
        const used = parseInt(parts[2]) || 0;
        const free = parseInt(parts[3]) || 0;

        return {
          total,
          used,
          free,
          usedPercentage: total > 0 ? Math.round((used / total) * 100 * 100) / 100 : 0
        };
      }

      return { total: 0, used: 0, free: 0, usedPercentage: 0 };
    } catch (error) {
      logger.warn('获取内存信息失败', { error: error.message });
      return { total: 0, used: 0, free: 0, usedPercentage: 0 };
    }
  }

  /**
   * 获取交换分区信息
   */
  async getSwapInfo() {
    try {
      const memInfo = await this.executeCommand('free -m');
      const lines = memInfo.trim().split('\n');
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
          usedPercentage: total > 0 ? Math.round((used / total) * 100 * 100) / 100 : 0
        };
      }

      return { total: 0, used: 0, free: 0, usedPercentage: 0 };
    } catch (error) {
      logger.warn('获取交换分区信息失败', { error: error.message });
      return { total: 0, used: 0, free: 0, usedPercentage: 0 };
    }
  }

  /**
   * 获取磁盘信息
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
   * 获取网络信息
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

      const timeDiff = (currentTime - this.lastNetworkStats.timestamp) / 1000;
      let rxSpeed = 0;
      let txSpeed = 0;

      if (timeDiff > 0 && this.lastNetworkStats.rx_bytes > 0) {
        rxSpeed = (totalRxBytes - this.lastNetworkStats.rx_bytes) / timeDiff;
        txSpeed = (totalTxBytes - this.lastNetworkStats.tx_bytes) / timeDiff;
      }

      // 更新缓存
      this.lastNetworkStats = {
        rx_bytes: totalRxBytes,
        tx_bytes: totalTxBytes,
        timestamp: currentTime
      };

      return {
        connections: 0, // 暂不实现连接数统计
        total_rx_speed: (rxSpeed / 1024).toFixed(2), // KB/s
        total_tx_speed: (txSpeed / 1024).toFixed(2)  // KB/s
      };
    } catch (error) {
      logger.warn('获取网络信息失败', { error: error.message });
      return { connections: 0, total_rx_speed: "0.00", total_tx_speed: "0.00" };
    }
  }

  /**
   * 获取操作系统信息
   */
  async getOsInfo() {
    try {
      const hostname = await this.executeCommand('hostname');
      const platform = await this.executeCommand('uname -s');
      const release = await this.executeCommand('uname -r');
      const arch = await this.executeCommand('uname -m');

      // 尝试获取发行版信息
      let distro = 'Unknown';
      try {
        distro = await this.executeCommand('cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | sed \'s/"//g\'');
      } catch (e) {
        try {
          distro = await this.executeCommand('lsb_release -d | cut -f2');
        } catch (e2) {
          // 使用默认值
        }
      }

      return {
        hostname: hostname || 'unknown',
        platform: platform || 'Linux',
        release: release || 'unknown',
        arch: arch || 'unknown',
        distro: distro || 'Unknown Linux'
      };
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
   * 获取IP信息
   */
  async getIpInfo() {
    const now = Date.now();

    // 更新内网IP（每30秒更新一次）
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
        const publicIp = await this.executeCommand('curl -s --max-time 5 ifconfig.me || curl -s --max-time 5 ipinfo.io/ip || echo "获取失败"');
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
   * 获取位置信息
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
}

module.exports = SSHMonitoringCollector;
