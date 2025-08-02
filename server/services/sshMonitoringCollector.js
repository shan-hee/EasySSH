/**
 * SSH监控数据收集器
 * 通过SSH连接执行系统命令获取监控数据，无需安装额外组件
 */

const logger = require('../utils/logger');
const { handleMonitoringError } = require('../utils/errorHandler');

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
  startCollection(dataCallback, interval = 1000) {
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
      // 只在首次收集时记录日志
      if (this.collectionCount === 0) {
        logger.info('开始监控数据收集', { hostId: this.hostId });
      }

      const systemInfo = {
        timestamp: Date.now(),
        machineId: await this.getMachineId(),
        cpu: await this.getCpuInfo(),
        memory: await this.getMemoryInfo(),
        swap: await this.getSwapInfo(),
        disk: await this.getDiskInfo(),
        network: await this.getNetworkInfo(),
        processes: await this.getProcessInfo(),
        os: await this.getOsInfo(),
        ip: await this.getIpInfo(),
        location: await this.getLocationInfo()
      };

      // 只记录关键指标，减少日志输出
      if (this.collectionCount % 60 === 0) { // 每分钟记录一次
        logger.info('监控数据摘要', {
          hostId: this.hostId,
          cpu: `${systemInfo.cpu?.usage || 0}%`,
          memory: `${systemInfo.memory?.usedPercentage || 0}%`,
          collections: this.collectionCount + 1
        });
      }

      // 生成hostId
      if (!this.hostId) {
        const hostname = systemInfo.os.hostname;
        const publicIp = systemInfo.ip.public;
        const internalIp = systemInfo.ip.internal;
        const connectionIp = this.hostInfo.address; // 用户连接时使用的IP

        // 始终优先使用连接IP，确保前端订阅能够匹配
        let ipAddress = connectionIp;

        // 如果连接IP无效，才考虑其他选项
        if (!ipAddress || ipAddress === '获取失败' || ipAddress === 'null' || ipAddress.trim() === '') {
          // 优先使用公网IP，最后使用内网IP
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
      const result = handleMonitoringError(error, {
        sessionId: this.hostId,
        operation: '收集系统信息',
        host: this.hostInfo.address
      });

      if (result.shouldStop) {
        logger.info('检测到严重错误，自动停止监控数据收集', {
          hostId: this.hostId,
          errorType: result.errorType,
          errorCount: result.errorCount
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

      logger.debug('执行SSH命令', { command, hostId: this.hostId });
      console.log(`🔧 [DEBUG] 执行SSH命令: ${command}`);

      this.sshConnection.exec(command, (err, stream) => {
        if (err) {
          logger.warn('SSH命令执行失败', { command, error: err.message });
          reject(err);
          return;
        }

        let output = '';
        let errorOutput = '';

        stream.on('close', (code) => {
          if (code === 0) {
            logger.debug('SSH命令执行成功', {
              command,
              outputLength: output.length,
              output: output.substring(0, 100) + (output.length > 100 ? '...' : '')
            });
            resolve(output.trim());
          } else {
            logger.warn('SSH命令执行失败', {
              command,
              exitCode: code,
              error: errorOutput
            });
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
      // 使用更简单的方法获取CPU使用率
      const cpuUsage = await this.executeCommand('sar 1 1 | grep "Average" | awk \'{print 100 - $8}\' || echo "0"');

      // 获取CPU核心数和型号
      const cpuCores = await this.executeCommand('nproc');
      const cpuModel = await this.executeCommand('cat /proc/cpuinfo | grep "model name" | head -1 | cut -d: -f2 | sed "s/^ *//"');

      // 获取负载平均值
      const loadAvg = await this.executeCommand('cat /proc/loadavg | awk \'{print $1, $2, $3}\'');

      // 验证数据
      const usage = parseFloat(cpuUsage) || 0;
      const cores = parseInt(cpuCores) || 1;
      const model = cpuModel || 'Unknown';

      let load1 = 0, load5 = 0, load15 = 0;
      if (loadAvg && loadAvg.trim()) {
        const loads = loadAvg.trim().split(' ').map(Number);
        load1 = loads[0] || 0;
        load5 = loads[1] || 0;
        load15 = loads[2] || 0;
      }

      const result = {
        usage: Math.round(usage * 100) / 100,
        cores,
        model,
        loadAverage: { load1, load5, load15 }
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
   * 获取内存信息
   */
  async getMemoryInfo() {
    try {
      // 使用free命令获取内存信息
      const memInfo = await this.executeCommand('free -m');

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
   * 获取交换分区信息
   */
  async getSwapInfo() {
    try {
      const memInfo = await this.executeCommand('free -m');

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
   * 获取磁盘信息
   */
  async getDiskInfo() {
    try {
      const diskInfo = await this.executeCommand('df -BG / | tail -1');
      const parts = diskInfo.trim().split(/\s+/);

      if (parts.length >= 5) {
        // 解析大小，处理不同单位
        const parseSize = (sizeStr) => {
          const match = sizeStr.match(/^(\d+(?:\.\d+)?)(G|M|K|T)?$/i);
          if (!match) return 0;

          const value = parseFloat(match[1]);
          const unit = (match[2] || 'G').toUpperCase();

          switch (unit) {
            case 'T': return value * 1024;
            case 'G': return value;
            case 'M': return value / 1024;
            case 'K': return value / (1024 * 1024);
            default: return value;
          }
        };

        const total = parseSize(parts[1]);
        const used = parseSize(parts[2]);
        const free = parseSize(parts[3]);
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
        total_tx_speed: (txSpeed / 1024).toFixed(2), // KB/s
        total_rx_bytes: totalRxBytes, // 总接收字节数
        total_tx_bytes: totalTxBytes  // 总发送字节数
      };
    } catch (error) {
      logger.warn('获取网络信息失败', { error: error.message });
      return {
        connections: 0,
        total_rx_speed: "0.00",
        total_tx_speed: "0.00",
        total_rx_bytes: 0,
        total_tx_bytes: 0
      };
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

      // 获取系统启动时间 (从/proc/stat获取btime)
      let bootTime = null;
      try {
        const bootTimeStr = await this.executeCommand('cat /proc/stat | grep btime | awk \'{print $2}\'');
        if (bootTimeStr) {
          bootTime = parseInt(bootTimeStr) * 1000; // 转换为毫秒时间戳
        }
      } catch (e) {
        logger.debug('获取启动时间失败', { error: e.message });
      }

      // 获取系统运行时间
      let uptime = 0;
      try {
        const uptimeStr = await this.executeCommand('cat /proc/uptime | awk \'{print $1}\'');
        if (uptimeStr) {
          uptime = parseFloat(uptimeStr);
        }
      } catch (e) {
        logger.debug('获取运行时间失败', { error: e.message });
      }

      return {
        hostname: hostname || 'unknown',
        platform: platform || 'Linux',
        release: release || 'unknown',
        arch: arch || 'unknown',
        distro: distro || 'Unknown Linux',
        os: distro || 'Unknown Linux', // 添加os字段用于前端显示
        bootTime: bootTime,
        uptime: uptime
      };
    } catch (error) {
      logger.warn('获取操作系统信息失败', { error: error.message });
      return {
        hostname: this.hostInfo.address,
        platform: 'Linux',
        release: 'unknown',
        arch: 'unknown',
        distro: 'Unknown Linux',
        os: 'Unknown Linux',
        bootTime: null,
        uptime: 0
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
   * 获取进程信息
   */
  async getProcessInfo() {
    try {
      // 获取进程总数
      const totalProcesses = await this.executeCommand('ps aux | wc -l');

      // 获取运行中的进程数
      const runningProcesses = await this.executeCommand('ps aux | awk \'$8 ~ /^R/ {count++} END {print count+0}\'');

      // 获取睡眠中的进程数
      const sleepingProcesses = await this.executeCommand('ps aux | awk \'$8 ~ /^S/ {count++} END {print count+0}\'');

      // 获取僵尸进程数
      const zombieProcesses = await this.executeCommand('ps aux | awk \'$8 ~ /^Z/ {count++} END {print count+0}\'');

      return {
        total: parseInt(totalProcesses) - 1 || 0, // 减去标题行
        running: parseInt(runningProcesses) || 0,
        sleeping: parseInt(sleepingProcesses) || 0,
        zombie: parseInt(zombieProcesses) || 0
      };
    } catch (error) {
      logger.warn('获取进程信息失败', { error: error.message });
      return { total: 0, running: 0, sleeping: 0, zombie: 0 };
    }
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

  /**
   * 判断IP是否为私有IP地址
   * @param {string} ip IP地址
   * @returns {boolean} 是否为私有IP
   */
  isPrivateIP(ip) {
    if (!ip || typeof ip !== 'string') return false;

    // 私有IP地址范围：
    // 10.0.0.0 - 10.255.255.255 (10.0.0.0/8)
    // 172.16.0.0 - 172.31.255.255 (172.16.0.0/12)
    // 192.168.0.0 - 192.168.255.255 (192.168.0.0/16)
    // 127.0.0.0 - 127.255.255.255 (localhost)

    const privateRanges = [
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^127\./
    ];

    return privateRanges.some(range => range.test(ip));
  }
}

module.exports = SSHMonitoringCollector;
