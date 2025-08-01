/**
 * 监控系统配置
 */

const config = {
  // SSH监控收集器配置
  collector: {
    // 数据收集间隔（毫秒）
    defaultInterval: parseInt(process.env.MONITORING_INTERVAL) || 3000,

    // 命令执行超时（毫秒）
    commandTimeout: parseInt(process.env.MONITORING_COMMAND_TIMEOUT) || 8000,

    // 错误处理配置
    errorHandling: {
      maxRetries: 3,
      connectionErrorPatterns: [
        'SSH连接',
        'Not connected',
        'Unable to exec',
        'Connection closed',
        'ECONNRESET',
        'ENOTFOUND',
        'ETIMEDOUT'
      ]
    }
  },
  
  // WebSocket传输配置
  transport: {
    // 数据压缩阈值（字节）
    compressionThreshold: 1024,

    // 批量传输配置
    batch: {
      enabled: true,
      size: 10,
      timeout: 1000
    }
  },
  
  // 前端面板配置
  frontend: {
    // 图表更新间隔（毫秒）
    chartUpdateInterval: 1000,

    // 数据点保留数量
    dataPointsLimit: 60,

    // 面板默认配置
    panel: {
      defaultWidth: 1000,
      defaultHeight: 600,
      minWidth: 600,
      minHeight: 400,
      draggable: true,
      resizable: true
    }
  },
  
  // 性能优化配置
  performance: {
    enableCompression: true
  }
};

module.exports = config;
