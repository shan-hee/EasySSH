// @ts-nocheck
/**
 * 流式SSH监控收集器 - 优化版
 * 使用单会话长连接，直接读取 /proc 和 /sys，NDJSON流式输出
 */

const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

class StreamingSSHMonitoringCollector extends EventEmitter {
  constructor(sshConnection, hostInfo) {
    super();

    this.sshConnection = sshConnection;
    this.hostInfo = hostInfo;
    this.isCollecting = false;
    this.stream = null;
    this.hostId = null;

    // 数据缓存和状态
    this.dataCache = {
      lastData: null,
      staticInfo: null,
      lastStaticUpdate: 0
    };

    // 基本状态跟踪（保留必要的错误处理）
    this.errorStats = {
      consecutiveErrors: 0,
      maxConsecutiveErrors: 5,
      lastErrorTime: 0
    };

    // 生成唯一主机标识符
    this.generateHostId();
  }

  /**
   * 生成主机标识符
   */
  generateHostId() {
    if (this.hostInfo.address) {
      // 使用 hostname@ip 格式，如果有hostname的话
      this.hostId = this.hostInfo.hostname ?
        `${this.hostInfo.hostname}@${this.hostInfo.address}` :
        this.hostInfo.address;
    } else {
      this.hostId = `unknown_${Date.now()}`;
    }
  }

  /**
   * 开始流式监控数据收集
   * @param {Function} dataCallback 数据回调函数
   * @param {number} interval 收集间隔（毫秒）
   */
  startCollection(dataCallback, interval = 1000) {
    if (this.isCollecting) {
      logger.warn('流式监控数据收集已在进行中', { hostId: this.hostId });
      return;
    }

    this.isCollecting = true;
    this.dataCallback = dataCallback;
    this.interval = interval;

    logger.debug('开始流式SSH监控数据收集', {
      hostId: this.hostId,
      interval: `${interval}ms`,
      host: `${this.hostInfo.username}@${this.hostInfo.address}:${this.hostInfo.port}`
    });

    this.startStreamingCollection();
  }

  /**
   * 启动流式收集
   */
  async startStreamingCollection() {
    try {
      // 读取监控脚本内容
      const scriptPath = path.join(__dirname, '../scripts/streaming-monitor.sh');
      const scriptExists = fs.existsSync(scriptPath);

      if (!scriptExists) {
        throw new Error(`流式监控脚本不存在: ${scriptPath}`);
      }

      const scriptContent = fs.readFileSync(scriptPath, 'utf8');

      // 计算间隔（转换为秒）
      const intervalSeconds = Math.max(1, Math.floor(this.interval / 1000));

      // 构建执行命令（通过标准输入传输脚本）- 使用sh以兼容ash/dash等shell
      const command = `sh -s ${intervalSeconds} 0`;

      logger.debug('执行流式监控命令', {
        hostId: this.hostId,
        command,
        interval: intervalSeconds,
        scriptSize: scriptContent.length,
        shellType: 'sh (POSIX兼容)'
      });

      // 执行SSH命令
      this.sshConnection.exec(command, (err, stream) => {
        if (err) {
          this.handleError(new Error(`SSH执行失败: ${err.message}`));
          return;
        }

        this.stream = stream;

        // 将脚本内容写入标准输入
        stream.write(scriptContent);
        stream.end();

        this.setupStreamHandlers();
      });

    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * 设置流处理器
   */
  setupStreamHandlers() {
    let buffer = '';

    // 数据接收处理
    this.stream.on('data', (data) => {
      try {
        buffer += data.toString();

        // 按行处理NDJSON数据
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 保留不完整的行

        for (const line of lines) {
          if (line.trim() && !line.startsWith('#')) {
            this.processStreamData(line.trim());
          }
        }
      } catch (error) {
        logger.debug('处理流数据失败', {
          hostId: this.hostId,
          error: error.message
        });
      }
    });

    // 错误处理
    this.stream.stderr.on('data', (data) => {
      const errorMsg = data.toString().trim();
      if (errorMsg && !errorMsg.includes('warning')) {
        // 显示调试信息
        if (errorMsg.includes('NET DEBUG') || errorMsg.includes('流式监控开始')) {
          logger.debug('监控脚本调试信息', { hostId: this.hostId, debug: errorMsg });
        } else {
          logger.debug('SSH流错误输出', {
            hostId: this.hostId,
            stderr: errorMsg
          });
        }
      }
    });

    // 流关闭处理
    this.stream.on('close', (code, signal) => {
      logger.debug('SSH流已关闭', {
        hostId: this.hostId,
        code,
        signal,
        isCollecting: this.isCollecting
      });

      if (this.isCollecting) {
        // 如果是意外关闭，尝试重连
        this.handleStreamClose(code);
      }
    });

    // 流错误处理
    this.stream.on('error', (error) => {
      this.handleError(new Error(`SSH流错误: ${error.message}`));
    });

    logger.debug('SSH流处理器已设置', { hostId: this.hostId });
  }

  /**
   * 处理流数据
   * @param {string} jsonLine NDJSON行数据
   */
  processStreamData(jsonLine) {
    try {
      const data = JSON.parse(jsonLine);

      // 验证数据格式
      if (!data.hasOwnProperty('timestamp') || typeof data.timestamp !== 'number') {
        logger.debug('无效的监控数据格式', { hostId: this.hostId });
        return;
      }

      // 添加主机标识符
      data.hostId = this.hostId;
      data.source = 'streaming_ssh';
      data.collectorVersion = '2.0';

      // 重置错误计数
      if (this.errorStats.consecutiveErrors > 0) {
        this.errorStats.consecutiveErrors = 0;
      }

      // 缓存数据
      this.dataCache.lastData = data;

      // 调用数据回调
      if (this.dataCallback) {
        this.dataCallback(data);
      }

      // 触发数据事件
      this.emit('data', data);

    } catch (error) {
      this.handleError(new Error(`解析监控数据失败: ${error.message}`));
    }
  }


  /**
   * 处理流关闭
   * @param {number} code 退出码
   */
  handleStreamClose(code) {
    if (code !== 0 && this.isCollecting) {
      this.errorStats.consecutiveErrors++;

      if (this.errorStats.consecutiveErrors < this.errorStats.maxConsecutiveErrors) {
        // 尝试重连
        const retryDelay = Math.min(5000, 1000 * Math.pow(2, this.errorStats.consecutiveErrors));

        logger.warn('SSH流意外关闭，准备重连', {
          hostId: this.hostId,
          code,
          retryDelay,
          consecutiveErrors: this.errorStats.consecutiveErrors
        });

        setTimeout(() => {
          if (this.isCollecting) {
            this.startStreamingCollection();
          }
        }, retryDelay);
      } else {
        logger.error('SSH流连续错误过多，停止收集', {
          hostId: this.hostId,
          consecutiveErrors: this.errorStats.consecutiveErrors
        });
        this.stopCollection();
      }
    }
  }

  /**
   * 处理错误
   * @param {Error} error 错误对象
   */
  handleError(error) {
    this.errorStats.consecutiveErrors++;
    this.errorStats.lastErrorTime = Date.now();

    logger.error('流式监控收集错误', {
      hostId: this.hostId,
      error: error.message,
      consecutiveErrors: this.errorStats.consecutiveErrors
    });

    // 对致命错误（连接不可用/命令无法执行）立即停止，交由上层故障切换
    const msg = (error?.message || '').toString();
    const fatalHints = ['Not connected', 'Unable to exec', 'Connection closed', 'ECONNRESET', 'ETIMEDOUT'];
    if (fatalHints.some(k => msg.includes(k))) {
      logger.warn('检测到致命错误，立即停止流式监控收集以触发故障切换', { hostId: this.hostId, message: msg });
      this.stopCollection();
    } else if (this.errorStats.consecutiveErrors >= this.errorStats.maxConsecutiveErrors) {
      logger.warn('连续错误过多，停止流式监控收集', {
        hostId: this.hostId,
        consecutiveErrors: this.errorStats.consecutiveErrors
      });
      this.stopCollection();
    }

    this.emit('error', error);
  }

  /**
   * 停止监控数据收集
   */
  stopCollection() {
    if (!this.isCollecting) {
      logger.debug('流式监控数据收集已停止，跳过重复停止', { hostId: this.hostId });
      return;
    }

    this.isCollecting = false;

    // 关闭SSH流
    if (this.stream) {
      try {
        this.stream.end();
        this.stream = null;
      } catch (error) {
        logger.debug('关闭SSH流失败', {
          hostId: this.hostId,
          error: error.message
        });
      }
    }

    // 清理引用
    this.sshConnection = null;
    this.dataCallback = null;

    logger.debug('停止流式SSH监控数据收集', {
      hostId: this.hostId
    });

    this.emit('stopped');
  }

  /**
   * 获取收集器状态
   * @returns {Object} 状态信息
   */
  getStatus() {
    return {
      hostId: this.hostId,
      isCollecting: this.isCollecting,
      errorStats: { ...this.errorStats },
      hasStream: !!this.stream,
      lastData: this.dataCache.lastData ? {
        timestamp: this.dataCache.lastData.timestamp,
        hasData: true
      } : null
    };
  }
}

module.exports = StreamingSSHMonitoringCollector;
