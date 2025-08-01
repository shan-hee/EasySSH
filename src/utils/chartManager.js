/**
 * 优化的图表管理器
 * 提供高性能的图表创建、更新和管理功能
 */

import { Chart, registerables } from 'chart.js';
import { PANEL_CONFIG, PANEL_UTILS } from '@/config/monitoringPanel';

// 注册Chart.js组件
Chart.register(...registerables);

class ChartManager {
  constructor() {
    this.charts = new Map(); // chartId -> Chart instance
    this.dataBuffers = new Map(); // chartId -> data buffer
    this.updateTimers = new Map(); // chartId -> update timer
    this.config = PANEL_CONFIG;
    
    // 性能优化配置
    this.performanceConfig = {
      maxDataPoints: this.config.dataPoints.maxPoints,
      updateInterval: this.config.dataPoints.updateInterval,
      renderThrottle: this.config.performance.renderThrottle,
      enableCaching: this.config.performance.chartCaching
    };
    
    // 绑定方法
    this.throttledUpdate = this.throttle(this.updateChart.bind(this), this.performanceConfig.renderThrottle);
  }

  /**
   * 创建图表
   * @param {string} chartId 图表ID
   * @param {HTMLCanvasElement} canvas 画布元素
   * @param {string} type 图表类型
   * @param {Object} options 图表选项
   * @returns {Chart} 图表实例
   */
  createChart(chartId, canvas, type = 'line', options = {}) {
    // 如果图表已存在，先销毁
    if (this.charts.has(chartId)) {
      this.destroyChart(chartId);
    }

    // 获取主题配置
    const theme = PANEL_UTILS.getThemeConfig();
    
    // 合并配置
    const chartConfig = this.buildChartConfig(type, options, theme);
    
    // 创建图表实例
    const chart = new Chart(canvas, chartConfig);
    
    // 存储图表实例和数据缓冲区
    this.charts.set(chartId, chart);
    this.dataBuffers.set(chartId, []);
    
    console.log(`图表 ${chartId} 创建成功`);
    return chart;
  }

  /**
   * 构建图表配置
   * @param {string} type 图表类型
   * @param {Object} options 自定义选项
   * @param {Object} theme 主题配置
   * @returns {Object} 图表配置
   */
  buildChartConfig(type, options, theme) {
    const baseConfig = {
      type,
      data: {
        labels: [],
        datasets: []
      },
      options: {
        ...this.config.charts.common,
        plugins: {
          ...this.config.charts.common.plugins,
          tooltip: {
            ...this.config.charts.common.plugins.tooltip,
            backgroundColor: theme.surface,
            titleColor: theme.text,
            bodyColor: theme.text,
            borderColor: theme.border
          }
        },
        scales: {
          ...this.config.charts.common.scales,
          y: {
            ...this.config.charts.common.scales.y,
            ticks: {
              color: theme.textSecondary,
              font: {
                size: 10
              }
            },
            grid: {
              color: theme.border,
              lineWidth: 0.5
            }
          }
        }
      }
    };

    // 深度合并自定义选项
    return this.deepMerge(baseConfig, options);
  }

  /**
   * 更新图表数据
   * @param {string} chartId 图表ID
   * @param {number} value 新数据值
   * @param {string} label 数据标签
   */
  updateChartData(chartId, value, label = null) {
    const chart = this.charts.get(chartId);
    if (!chart) {
      console.warn(`图表 ${chartId} 不存在`);
      return;
    }

    // 添加到数据缓冲区
    const buffer = this.dataBuffers.get(chartId);
    buffer.push({ value, label: label || new Date().toLocaleTimeString(), timestamp: Date.now() });

    // 限制数据点数量
    if (buffer.length > this.performanceConfig.maxDataPoints) {
      buffer.shift();
    }

    // 节流更新
    this.throttledUpdate(chartId);
  }

  /**
   * 实际更新图表
   * @param {string} chartId 图表ID
   */
  updateChart(chartId) {
    const chart = this.charts.get(chartId);
    const buffer = this.dataBuffers.get(chartId);
    
    if (!chart || !buffer) return;

    // 更新图表数据
    chart.data.labels = buffer.map(item => item.label);
    
    if (chart.data.datasets.length > 0) {
      chart.data.datasets[0].data = buffer.map(item => item.value);
    }

    // 更新图表
    chart.update('none'); // 使用 'none' 模式以提高性能
  }

  /**
   * 批量更新多个图表
   * @param {Object} updates 更新数据 { chartId: value }
   */
  batchUpdate(updates) {
    const timestamp = Date.now();
    const label = new Date().toLocaleTimeString();

    // 批量添加数据到缓冲区
    Object.entries(updates).forEach(([chartId, value]) => {
      const buffer = this.dataBuffers.get(chartId);
      if (buffer) {
        buffer.push({ value, label, timestamp });
        
        // 限制数据点数量
        if (buffer.length > this.performanceConfig.maxDataPoints) {
          buffer.shift();
        }
      }
    });

    // 批量更新图表
    Object.keys(updates).forEach(chartId => {
      this.throttledUpdate(chartId);
    });
  }

  /**
   * 设置图表数据集配置
   * @param {string} chartId 图表ID
   * @param {Object} datasetConfig 数据集配置
   */
  setDatasetConfig(chartId, datasetConfig) {
    const chart = this.charts.get(chartId);
    if (!chart) return;

    // 创建渐变色
    const canvas = chart.canvas;
    const ctx = canvas.getContext('2d');
    
    if (datasetConfig.gradient) {
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      gradient.addColorStop(0, datasetConfig.gradient.start);
      gradient.addColorStop(1, datasetConfig.gradient.end);
      datasetConfig.backgroundColor = gradient;
    }

    // 更新或创建数据集
    if (chart.data.datasets.length === 0) {
      chart.data.datasets.push({
        label: datasetConfig.label || '',
        data: [],
        borderColor: datasetConfig.color,
        backgroundColor: datasetConfig.backgroundColor || datasetConfig.color,
        fill: datasetConfig.fill !== false,
        ...datasetConfig
      });
    } else {
      Object.assign(chart.data.datasets[0], datasetConfig);
    }

    chart.update();
  }

  /**
   * 获取图表实例
   * @param {string} chartId 图表ID
   * @returns {Chart|null} 图表实例
   */
  getChart(chartId) {
    return this.charts.get(chartId) || null;
  }

  /**
   * 销毁图表
   * @param {string} chartId 图表ID
   */
  destroyChart(chartId) {
    const chart = this.charts.get(chartId);
    if (chart) {
      chart.destroy();
      this.charts.delete(chartId);
    }

    // 清理数据缓冲区
    this.dataBuffers.delete(chartId);
    
    // 清理更新定时器
    const timer = this.updateTimers.get(chartId);
    if (timer) {
      clearTimeout(timer);
      this.updateTimers.delete(chartId);
    }

    console.log(`图表 ${chartId} 已销毁`);
  }

  /**
   * 销毁所有图表
   */
  destroyAllCharts() {
    this.charts.forEach((chart, chartId) => {
      this.destroyChart(chartId);
    });
    
    console.log('所有图表已销毁');
  }

  /**
   * 调整图表大小
   * @param {string} chartId 图表ID
   */
  resizeChart(chartId) {
    const chart = this.charts.get(chartId);
    if (chart) {
      chart.resize();
    }
  }

  /**
   * 调整所有图表大小
   */
  resizeAllCharts() {
    this.charts.forEach(chart => {
      chart.resize();
    });
  }

  /**
   * 节流函数
   * @param {Function} func 要节流的函数
   * @param {number} delay 延迟时间
   * @returns {Function} 节流后的函数
   */
  throttle(func, delay) {
    let timeoutId;
    let lastExecTime = 0;
    
    return function (...args) {
      const currentTime = Date.now();
      
      if (currentTime - lastExecTime > delay) {
        func.apply(this, args);
        lastExecTime = currentTime;
      } else {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          func.apply(this, args);
          lastExecTime = Date.now();
        }, delay - (currentTime - lastExecTime));
      }
    };
  }

  /**
   * 深度合并对象
   * @param {Object} target 目标对象
   * @param {Object} source 源对象
   * @returns {Object} 合并后的对象
   */
  deepMerge(target, source) {
    const result = { ...target };
    
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    
    return result;
  }

  /**
   * 获取管理器统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    return {
      totalCharts: this.charts.size,
      totalDataPoints: Array.from(this.dataBuffers.values()).reduce((sum, buffer) => sum + buffer.length, 0),
      activeTimers: this.updateTimers.size,
      memoryUsage: this.estimateMemoryUsage()
    };
  }

  /**
   * 估算内存使用量
   * @returns {number} 估算的内存使用量（字节）
   */
  estimateMemoryUsage() {
    let totalSize = 0;
    
    this.dataBuffers.forEach(buffer => {
      totalSize += buffer.length * 64; // 估算每个数据点64字节
    });
    
    return totalSize;
  }
}

// 创建单例实例
const chartManager = new ChartManager();

export default chartManager;
