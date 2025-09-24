/**
 * AI面板性能优化工具
 * 提供性能监控、优化建议和内存管理功能
 */

/**
 * 性能监控器
 */
export class AIPerformanceMonitor {
  constructor() {
    this.metrics = {
      messageRenderTime: [],
      panelToggleTime: [],
      commandParseTime: [],
      memoryUsage: []
    };
    this.isMonitoring = false;
  }

  /**
   * 开始监控
   */
  startMonitoring() {
    this.isMonitoring = true;

    // 定期收集内存使用情况
    this.memoryInterval = setInterval(() => {
      if (performance.memory) {
        this.metrics.memoryUsage.push({
          timestamp: Date.now(),
          used: performance.memory.usedJSHeapSize,
          total: performance.memory.totalJSHeapSize,
          limit: performance.memory.jsHeapSizeLimit
        });

        // 只保留最近100条记录
        if (this.metrics.memoryUsage.length > 100) {
          this.metrics.memoryUsage.shift();
        }
      }
    }, 5000); // 每5秒收集一次
  }

  /**
   * 停止监控
   */
  stopMonitoring() {
    this.isMonitoring = false;
    if (this.memoryInterval) {
      clearInterval(this.memoryInterval);
    }
    console.log('⏹️ AI面板性能监控已停止');
  }

  /**
   * 记录消息渲染时间
   * @param {number} duration 渲染时间（毫秒）
   */
  recordMessageRenderTime(duration) {
    if (!this.isMonitoring) return;

    this.metrics.messageRenderTime.push({
      timestamp: Date.now(),
      duration
    });

    // 只保留最近50条记录
    if (this.metrics.messageRenderTime.length > 50) {
      this.metrics.messageRenderTime.shift();
    }
  }

  /**
   * 记录面板切换时间
   * @param {number} duration 切换时间（毫秒）
   */
  recordPanelToggleTime(duration) {
    if (!this.isMonitoring) return;

    this.metrics.panelToggleTime.push({
      timestamp: Date.now(),
      duration
    });

    if (this.metrics.panelToggleTime.length > 50) {
      this.metrics.panelToggleTime.shift();
    }
  }

  /**
   * 记录命令解析时间
   * @param {number} duration 解析时间（毫秒）
   */
  recordCommandParseTime(duration) {
    if (!this.isMonitoring) return;

    this.metrics.commandParseTime.push({
      timestamp: Date.now(),
      duration
    });

    if (this.metrics.commandParseTime.length > 50) {
      this.metrics.commandParseTime.shift();
    }
  }

  /**
   * 获取性能报告
   * @returns {Object} 性能报告
   */
  getPerformanceReport() {
    const report = {
      messageRendering: this.analyzeMetric(this.metrics.messageRenderTime),
      panelToggle: this.analyzeMetric(this.metrics.panelToggleTime),
      commandParsing: this.analyzeMetric(this.metrics.commandParseTime),
      memory: this.analyzeMemoryUsage(),
      recommendations: []
    };

    // 生成优化建议
    report.recommendations = this.generateRecommendations(report);

    return report;
  }

  /**
   * 分析指标数据
   * @param {Array} data 指标数据
   * @returns {Object} 分析结果
   */
  analyzeMetric(data) {
    if (data.length === 0) {
      return {
        count: 0,
        average: 0,
        min: 0,
        max: 0,
        p95: 0
      };
    }

    const durations = data.map(item => item.duration);
    durations.sort((a, b) => a - b);

    return {
      count: data.length,
      average: durations.reduce((sum, d) => sum + d, 0) / durations.length,
      min: durations[0],
      max: durations[durations.length - 1],
      p95: durations[Math.floor(durations.length * 0.95)]
    };
  }

  /**
   * 分析内存使用情况
   * @returns {Object} 内存分析结果
   */
  analyzeMemoryUsage() {
    if (this.metrics.memoryUsage.length === 0) {
      return {
        current: 0,
        peak: 0,
        trend: 'stable'
      };
    }

    const latest = this.metrics.memoryUsage[this.metrics.memoryUsage.length - 1];
    const peak = Math.max(...this.metrics.memoryUsage.map(m => m.used));

    // 分析趋势
    let trend = 'stable';
    if (this.metrics.memoryUsage.length >= 10) {
      const recent = this.metrics.memoryUsage.slice(-10);
      const first = recent[0].used;
      const last = recent[recent.length - 1].used;
      const change = (last - first) / first;

      if (change > 0.1) trend = 'increasing';
      else if (change < -0.1) trend = 'decreasing';
    }

    return {
      current: latest.used,
      peak,
      trend,
      utilization: latest.used / latest.total
    };
  }

  /**
   * 生成优化建议
   * @param {Object} report 性能报告
   * @returns {Array} 建议列表
   */
  generateRecommendations(report) {
    const recommendations = [];

    // 消息渲染性能建议
    if (report.messageRendering.average > 100) {
      recommendations.push({
        type: 'performance',
        priority: 'high',
        message: '消息渲染时间过长，建议启用虚拟滚动或限制消息数量'
      });
    }

    // 面板切换性能建议
    if (report.panelToggle.average > 200) {
      recommendations.push({
        type: 'performance',
        priority: 'medium',
        message: '面板切换动画可能过于复杂，建议简化动画效果'
      });
    }

    // 内存使用建议
    if (report.memory.utilization > 0.8) {
      recommendations.push({
        type: 'memory',
        priority: 'high',
        message: '内存使用率过高，建议清理历史消息或减少缓存'
      });
    }

    if (report.memory.trend === 'increasing') {
      recommendations.push({
        type: 'memory',
        priority: 'medium',
        message: '检测到内存泄漏趋势，建议检查事件监听器和定时器清理'
      });
    }

    return recommendations;
  }

  /**
   * 打印性能报告
   */
  printReport() {
    const report = this.getPerformanceReport();

    console.log('\n📊 AI面板性能报告');
    console.log('='.repeat(40));

    console.log('\n🎨 消息渲染性能:');
    console.log(`  平均时间: ${report.messageRendering.average.toFixed(2)}ms`);
    console.log(`  最大时间: ${report.messageRendering.max.toFixed(2)}ms`);
    console.log(`  95%分位: ${report.messageRendering.p95.toFixed(2)}ms`);

    console.log('\n🔄 面板切换性能:');
    console.log(`  平均时间: ${report.panelToggle.average.toFixed(2)}ms`);
    console.log(`  最大时间: ${report.panelToggle.max.toFixed(2)}ms`);

    console.log('\n⚡ 命令解析性能:');
    console.log(`  平均时间: ${report.commandParsing.average.toFixed(2)}ms`);
    console.log(`  最大时间: ${report.commandParsing.max.toFixed(2)}ms`);

    console.log('\n💾 内存使用:');
    console.log(`  当前使用: ${(report.memory.current / 1024 / 1024).toFixed(2)}MB`);
    console.log(`  峰值使用: ${(report.memory.peak / 1024 / 1024).toFixed(2)}MB`);
    console.log(`  使用率: ${(report.memory.utilization * 100).toFixed(1)}%`);
    console.log(`  趋势: ${report.memory.trend}`);

    if (report.recommendations.length > 0) {
      console.log('\n💡 优化建议:');
      report.recommendations.forEach((rec, index) => {
        const priority = rec.priority === 'high' ? '🔴' : rec.priority === 'medium' ? '🟡' : '🟢';
        console.log(`  ${index + 1}. ${priority} ${rec.message}`);
      });
    } else {
      console.log('\n✅ 性能表现良好，无需优化');
    }
  }
}

/**
 * 防抖函数
 * @param {Function} func 要防抖的函数
 * @param {number} wait 等待时间
 * @returns {Function} 防抖后的函数
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * 节流函数
 * @param {Function} func 要节流的函数
 * @param {number} limit 时间限制
 * @returns {Function} 节流后的函数
 */
export function throttle(func, limit) {
  let inThrottle;
  return function executedFunction(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * 内存清理工具
 */
export class MemoryManager {
  /**
   * 清理过期的消息
   * @param {Array} messages 消息数组
   * @param {number} maxAge 最大年龄（毫秒）
   * @returns {Array} 清理后的消息数组
   */
  static cleanupExpiredMessages(messages, maxAge = 24 * 60 * 60 * 1000) {
    const cutoff = Date.now() - maxAge;
    return messages.filter(msg => msg.timestamp > cutoff);
  }

  /**
   * 限制消息数量
   * @param {Array} messages 消息数组
   * @param {number} maxCount 最大数量
   * @returns {Array} 限制后的消息数组
   */
  static limitMessageCount(messages, maxCount = 100) {
    if (messages.length <= maxCount) return messages;
    return messages.slice(-maxCount);
  }

  /**
   * 压缩消息内容
   * @param {Object} message 消息对象
   * @returns {Object} 压缩后的消息对象
   */
  static compressMessage(message) {
    const compressed = { ...message };

    // 压缩长文本内容
    if (compressed.content && compressed.content.length > 1000) {
      compressed.originalContent = compressed.content;
      compressed.content = `${compressed.content.substring(0, 1000)}...`;
      compressed.isCompressed = true;
    }

    return compressed;
  }

  /**
   * 解压缩消息内容
   * @param {Object} message 压缩的消息对象
   * @returns {Object} 解压缩后的消息对象
   */
  static decompressMessage(message) {
    if (message.isCompressed && message.originalContent) {
      return {
        ...message,
        content: message.originalContent,
        isCompressed: false
      };
    }
    return message;
  }
}

// 创建全局性能监控器实例
export const aiPerformanceMonitor = new AIPerformanceMonitor();

// 在开发环境下自动启动监控
if (process.env.NODE_ENV === 'development') {
  aiPerformanceMonitor.startMonitoring();

  // 添加到全局对象以便调试
  if (typeof window !== 'undefined') {
    window.aiPerformanceMonitor = aiPerformanceMonitor;
    console.log('🔍 AI面板性能监控器已启动（开发模式）｜使用 window.aiPerformanceMonitor.printReport() 查看报告');
  }
}

export default {
  AIPerformanceMonitor,
  MemoryManager,
  debounce,
  throttle,
  aiPerformanceMonitor
};
