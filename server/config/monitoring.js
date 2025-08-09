/**
 * 监控系统配置
 */

const config = {
  // SSH监控收集器配置
  collector: {
    // 数据收集间隔（毫秒）- 默认1秒，可通过设置界面调整
    defaultInterval: 1000,

    // 间隔范围限制
    minInterval: 500,    // 最小0.5秒
    maxInterval: 10000,  // 最大10秒

    // 命令执行超时（毫秒）
    commandTimeout: 8000,

    // 流式采集配置
    streaming: {
      enabled: true,              // 启用流式采集
      preferStreaming: true,      // 优先使用流式采集
      adaptiveInterval: {
        enabled: true,            // 启用自适应间隔
        cpuHighWatermark: 80,     // CPU高水位阈值
        scale: [1.0, 1.5, 2.0]    // 间隔缩放因子
      },
      enablePSI: true,            // 启用PSI压力指标
      containerAwareness: true    // 启用容器感知
    },

    // 错误处理配置
    errorHandling: {
      maxRetries: 3,
      maxConsecutiveErrors: 5,    // 流式采集最大连续错误数
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
    },

    // WebSocket增强配置
    ws: {
      perMessageDeflate: true,           // 启用原生压缩
      binaryCodec: 'json',               // 编码格式: 'json' | 'msgpack'
      backpressureBytes: 1000000,        // 背压阈值 (1MB)
      dropPolicy: 'oldest'               // 丢弃策略: 'oldest' | 'current'
    },

    // 差量更新配置
    delta: {
      enabled: true,                     // 启用差量更新
      staticFieldsTTL: 300000           // 静态字段TTL (5分钟)
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
    enableCompression: false // 禁用应用层压缩，使用WebSocket层的perMessageDeflate
  }
};

module.exports = config;
