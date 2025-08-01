/**
 * 监控面板配置
 */

export const PANEL_CONFIG = {
  // 面板默认配置
  defaults: {
    width: 1000,
    height: 600,
    minWidth: 600,
    minHeight: 400,
    position: 'center', // 'center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'
    theme: 'auto' // 'light', 'dark', 'auto'
  },

  // 图表配置
  charts: {
    // 通用图表配置
    common: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 750,
        easing: 'easeInOutQuart'
      },
      elements: {
        point: {
          radius: 0,
          hoverRadius: 4
        },
        line: {
          tension: 0.4,
          borderWidth: 2
        }
      },
      scales: {
        x: {
          display: false,
          grid: {
            display: false
          }
        },
        y: {
          display: false,
          grid: {
            display: false
          },
          beginAtZero: true
        }
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          enabled: true,
          mode: 'index',
          intersect: false,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          titleColor: '#fff',
          bodyColor: '#fff',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          cornerRadius: 6,
          displayColors: false
        }
      }
    },

    // CPU图表配置
    cpu: {
      color: '#3b82f6',
      gradient: {
        start: 'rgba(59, 130, 246, 0.3)',
        end: 'rgba(59, 130, 246, 0.05)'
      },
      thresholds: {
        warning: 70,
        critical: 90
      }
    },

    // 内存图表配置
    memory: {
      color: '#10b981',
      gradient: {
        start: 'rgba(16, 185, 129, 0.3)',
        end: 'rgba(16, 185, 129, 0.05)'
      },
      thresholds: {
        warning: 80,
        critical: 95
      }
    },

    // 磁盘图表配置
    disk: {
      color: '#f59e0b',
      gradient: {
        start: 'rgba(245, 158, 11, 0.3)',
        end: 'rgba(245, 158, 11, 0.05)'
      },
      thresholds: {
        warning: 80,
        critical: 95
      }
    },

    // 网络图表配置
    network: {
      upload: {
        color: '#ef4444',
        gradient: {
          start: 'rgba(239, 68, 68, 0.3)',
          end: 'rgba(239, 68, 68, 0.05)'
        }
      },
      download: {
        color: '#8b5cf6',
        gradient: {
          start: 'rgba(139, 92, 246, 0.3)',
          end: 'rgba(139, 92, 246, 0.05)'
        }
      }
    }
  },

  // 数据点配置
  dataPoints: {
    maxPoints: 60, // 最大数据点数量
    updateInterval: 1000, // 更新间隔（毫秒）
    smoothing: true // 是否启用数据平滑
  },

  // 响应式断点
  breakpoints: {
    mobile: 768,
    tablet: 1024,
    desktop: 1200
  },

  // 动画配置
  animations: {
    panelOpen: {
      duration: 300,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
    },
    panelClose: {
      duration: 200,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
    },
    chartUpdate: {
      duration: 750,
      easing: 'easeInOutQuart'
    }
  },

  // 性能优化配置
  performance: {
    // 是否启用虚拟滚动
    virtualScrolling: false,
    
    // 是否启用图表缓存
    chartCaching: true,
    
    // 是否启用数据压缩
    dataCompression: true,
    
    // 渲染节流间隔（毫秒）
    renderThrottle: 16, // ~60fps
    
    // 是否启用WebGL加速
    webglAcceleration: false
  },

  // 主题配置
  themes: {
    light: {
      background: '#ffffff',
      surface: '#f8fafc',
      primary: '#3b82f6',
      secondary: '#64748b',
      text: '#1e293b',
      textSecondary: '#64748b',
      border: '#e2e8f0',
      shadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
      gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
    },
    dark: {
      background: '#0f172a',
      surface: '#1e293b',
      primary: '#60a5fa',
      secondary: '#94a3b8',
      text: '#f1f5f9',
      textSecondary: '#94a3b8',
      border: '#334155',
      shadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3)',
      gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
    }
  },

  // 国际化配置
  i18n: {
    zh: {
      title: '系统监控详情',
      cpu: 'CPU使用率',
      memory: '内存使用率',
      disk: '磁盘使用率',
      network: '网络流量',
      upload: '上传',
      download: '下载',
      minimize: '最小化',
      maximize: '最大化',
      restore: '还原',
      close: '关闭',
      loading: '加载中...',
      noData: '暂无数据',
      error: '数据加载失败'
    },
    en: {
      title: 'System Monitoring Details',
      cpu: 'CPU Usage',
      memory: 'Memory Usage',
      disk: 'Disk Usage',
      network: 'Network Traffic',
      upload: 'Upload',
      download: 'Download',
      minimize: 'Minimize',
      maximize: 'Maximize',
      restore: 'Restore',
      close: 'Close',
      loading: 'Loading...',
      noData: 'No Data',
      error: 'Failed to load data'
    }
  }
};

// 工具函数
export const PANEL_UTILS = {
  /**
   * 获取响应式配置
   * @param {number} width 窗口宽度
   * @returns {Object} 响应式配置
   */
  getResponsiveConfig(width) {
    if (width < PANEL_CONFIG.breakpoints.mobile) {
      return {
        chartColumns: 1,
        chartHeight: 100,
        fontSize: 'small',
        spacing: 'compact'
      };
    } else if (width < PANEL_CONFIG.breakpoints.tablet) {
      return {
        chartColumns: 2,
        chartHeight: 120,
        fontSize: 'medium',
        spacing: 'normal'
      };
    } else {
      return {
        chartColumns: 2,
        chartHeight: 140,
        fontSize: 'large',
        spacing: 'comfortable'
      };
    }
  },

  /**
   * 获取主题配置
   * @param {string} theme 主题名称
   * @returns {Object} 主题配置
   */
  getThemeConfig(theme = 'auto') {
    if (theme === 'auto') {
      // 检测系统主题
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      theme = prefersDark ? 'dark' : 'light';
    }
    return PANEL_CONFIG.themes[theme] || PANEL_CONFIG.themes.light;
  },

  /**
   * 格式化数值
   * @param {number} value 数值
   * @param {string} unit 单位
   * @param {number} decimals 小数位数
   * @returns {string} 格式化后的字符串
   */
  formatValue(value, unit = '', decimals = 1) {
    if (value === null || value === undefined || isNaN(value)) {
      return '--';
    }
    return `${Number(value).toFixed(decimals)}${unit}`;
  },

  /**
   * 格式化百分比
   * @param {number} value 数值
   * @returns {string} 格式化后的百分比
   */
  formatPercentage(value) {
    return this.formatValue(value, '%', 1);
  },

  /**
   * 格式化字节大小
   * @param {number} bytes 字节数
   * @returns {string} 格式化后的大小
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  },

  /**
   * 格式化网络速度
   * @param {number} speed 速度（字节/秒）
   * @returns {string} 格式化后的速度
   */
  formatNetworkSpeed(speed) {
    const numSpeed = parseFloat(speed) || 0;

    if (numSpeed === 0) {
      return '0 B/s';
    }

    if (numSpeed < 1024) {
      return `${numSpeed.toFixed(1)} B/s`;
    } else if (numSpeed < 1024 * 1024) {
      return `${(numSpeed / 1024).toFixed(1)} KB/s`;
    } else if (numSpeed < 1024 * 1024 * 1024) {
      return `${(numSpeed / (1024 * 1024)).toFixed(1)} MB/s`;
    } else {
      return `${(numSpeed / (1024 * 1024 * 1024)).toFixed(1)} GB/s`;
    }
  },

  /**
   * 获取状态颜色
   * @param {number} value 数值
   * @param {Object} thresholds 阈值配置
   * @returns {string} 状态颜色
   */
  getStatusColor(value, thresholds) {
    if (value >= thresholds.critical) {
      return '#ef4444'; // 红色
    } else if (value >= thresholds.warning) {
      return '#f59e0b'; // 橙色
    } else {
      return '#10b981'; // 绿色
    }
  }
};

export default PANEL_CONFIG;
