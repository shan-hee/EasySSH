type ThemeMode = 'dark' | 'light';
type ColorSet = { primary: string; light: string; background: string };
import type { Chart, ChartOptions } from 'chart.js';
type ChartOptionsLike = ChartOptions; // generic Chart.js options
type ChartInstanceLike = Chart;       // Chart.js instance type
import log from '@/services/log';
import { EVENTS } from '@/services/events';
/**
 * chartConfig.js - Chart.js 统一配置工具
 * 现代极简风格监控图表配置
 * 支持响应式设计和主题切换
 * 集成性能优化和错误处理
 */

/**
 * 获取CSS变量值
 * @param {string} varName - CSS变量名
 * @returns {string} CSS变量值
 */
export function getCSSVar(varName: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

/**
 * 检测当前主题
 * @returns {string} 'dark' | 'light'
 */
export function getCurrentTheme(): ThemeMode {
  // 首先尊重终端表面模式（由设置服务写入），用于监控面板/终端区域的配色基准
  const surfaceMode = getCSSVar('--terminal-surface-mode');
  if (surfaceMode === 'dark' || surfaceMode === 'light') return surfaceMode;

  const theme = document.documentElement.getAttribute('data-theme');
  if (theme === 'dark' || theme === 'light') return theme;

  // 检查class
  if (document.documentElement.classList.contains('dark-theme')) return 'dark';
  if (document.documentElement.classList.contains('light-theme')) return 'light';

  // 默认检查系统偏好
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * 获取主题感知的颜色
 * @param {string} darkColor - 深色主题颜色
 * @param {string} lightColor - 浅色主题颜色
 * @returns {string} 当前主题对应的颜色
 */
export function getThemeColor(darkColor: string, lightColor: string): string {
  return getCurrentTheme() === 'dark' ? darkColor : lightColor;
}

/**
 * 将任意颜色转换为带透明度的 rgba 颜色
 * 支持: #RGB, #RRGGBB, rgb(), rgba()
 */
export function toRgba(color: string, alpha: number = 1): string {
  if (!color) return `rgba(0,0,0,${alpha})`;
  const c = color.trim();
  if (c.startsWith('#')) {
    let r, g, b;
    if (c.length === 4) {
      r = parseInt(c[1] + c[1], 16);
      g = parseInt(c[2] + c[2], 16);
      b = parseInt(c[3] + c[3], 16);
    } else if (c.length === 7) {
      r = parseInt(c.slice(1, 3), 16);
      g = parseInt(c.slice(3, 5), 16);
      b = parseInt(c.slice(5, 7), 16);
    } else {
      return `rgba(0,0,0,${alpha})`;
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (c.startsWith('rgb')) {
    // rgb or rgba
    const nums = c
      .replace(/rgba?\(/, '')
      .replace(/\)/, '')
      .split(',')
      .map(v => v.trim());
    const r = parseFloat(nums[0]) || 0;
    const g = parseFloat(nums[1]) || 0;
    const b = parseFloat(nums[2]) || 0;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return `rgba(0,0,0,${alpha})`;
}

/**
 * 获取主题感知的背景颜色（用于图表未使用部分）
 * @returns {string} 当前主题对应的背景颜色
 */
export function getThemeBackgroundColor(): string {
  return getCurrentTheme() === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
}

/**
 * 创建渐变色
 * @param {CanvasRenderingContext2D} ctx - Canvas上下文
 * @param {string} startColor - 起始颜色
 * @param {string} endColor - 结束颜色
 * @param {number} height - 渐变高度
 * @returns {CanvasGradient} 渐变对象
 */
export function createGradient(
  ctx: CanvasRenderingContext2D,
  startColor: string,
  endColor: string,
  height: number = 200
): CanvasGradient {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, startColor);
  gradient.addColorStop(1, endColor);
  return gradient;
}

/**
 * 获取状态颜色 - 通用版本（保持向后兼容）
 * @param {number} value - 数值
 * @param {Object} thresholds - 阈值配置
 * @returns {Object} 颜色配置
 */
export function getStatusColors(
  value: number,
  thresholds: { warning: number; critical: number } = { warning: 80, critical: 95 }
): ColorSet {
  if (value >= thresholds.critical) {
    return {
      primary: getCSSVar('--monitor-error'),
      light: `${getCSSVar('--monitor-error')}20`,
      background: 'rgba(255, 255, 255, 0.1)'
    };
  } else if (value >= thresholds.warning) {
    return {
      primary: getCSSVar('--monitor-warning'),
      light: `${getCSSVar('--monitor-warning')}20`,
      background: 'rgba(255, 255, 255, 0.1)'
    };
  }
  return {
    primary: getCSSVar('--monitor-success'),
    light: `${getCSSVar('--monitor-success')}20`,
    background: 'rgba(255, 255, 255, 0.1)'
  };
}

/**
 * 获取监控组件专属颜色 - 新版本，支持组件主题
 * @param {number} value - 数值
 * @param {string} componentType - 组件类型 ('cpu', 'memory', 'disk', 'network')
 * @param {Object} thresholds - 阈值配置
 * @returns {Object} 颜色配置
 */
export function getMonitoringColors(
  value: number,
  componentType: 'cpu' | 'memory' | 'memory-swap' | 'disk' | 'network-upload' | 'network-download' | string,
  thresholds: { warning: number; critical: number } = { warning: 80, critical: 95 }
): ColorSet {
  // 危险状态：使用红色
  if (value >= thresholds.critical) {
    return {
      primary: getCSSVar('--monitor-error'),
      light: `${getCSSVar('--monitor-error')}20`,
      background: 'rgba(255, 255, 255, 0.1)'
    };
  }

  // 警告状态：使用黄色
  if (value >= thresholds.warning) {
    return {
      primary: getCSSVar('--monitor-warning'),
      light: `${getCSSVar('--monitor-warning')}20`,
      background: 'rgba(255, 255, 255, 0.1)'
    };
  }

  // 正常状态：使用组件专属颜色
  switch (componentType) {
    case 'cpu':
      return {
        primary: getCSSVar('--monitor-cpu-primary'),
        light: `${getCSSVar('--monitor-cpu-primary')}20`,
        background: 'rgba(255, 255, 255, 0.1)'
      };
    case 'memory':
      return {
        primary: getCSSVar('--monitor-memory-primary'),
        light: `${getCSSVar('--monitor-memory-primary')}20`,
        background: 'rgba(255, 255, 255, 0.1)'
      };
    case 'memory-swap':
      return {
        primary: getCSSVar('--monitor-memory-swap'),
        light: `${getCSSVar('--monitor-memory-swap')}20`,
        background: 'rgba(255, 255, 255, 0.1)'
      };
    case 'disk':
      return {
        primary: getCSSVar('--monitor-disk-primary'),
        light: `${getCSSVar('--monitor-disk-primary')}20`,
        background: 'rgba(255, 255, 255, 0.1)'
      };
    case 'network-upload':
      return {
        primary: getCSSVar('--monitor-network-upload'),
        light: `${getCSSVar('--monitor-network-upload')}20`,
        background: 'rgba(255, 255, 255, 0.1)'
      };
    case 'network-download':
      return {
        primary: getCSSVar('--monitor-network-download'),
        light: `${getCSSVar('--monitor-network-download')}20`,
        background: 'rgba(255, 255, 255, 0.1)'
      };
    default:
      // 默认使用成功色（绿色）
      return {
        primary: getCSSVar('--monitor-success'),
        light: `${getCSSVar('--monitor-success')}20`,
        background: 'rgba(255, 255, 255, 0.1)'
      };
  }
}

/**
 * 获取主题感知的图表配置
 * @returns {Object} Chart.js配置对象
 */
export function getThemeAwareChartOptions(): ChartOptionsLike {
  const themeMode = getCurrentTheme();
  const isDark = themeMode === 'dark';
  const textPrimary =
    getCSSVar('--terminal-surface-text-color') ||
    getCSSVar('--monitor-text-primary') ||
    (isDark ? getCSSVar('--fallback-text-on-dark') : getCSSVar('--fallback-text-on-light')) ||
    (isDark ? '#e5e5e5' : '#303133');
  const textSecondary =
    getCSSVar('--terminal-surface-text-secondary') ||
    getCSSVar('--monitor-text-secondary') ||
    (isDark
      ? getCSSVar('--fallback-text-secondary-on-dark')
      : getCSSVar('--fallback-text-secondary-on-light')) ||
    (isDark ? '#b0b0b0' : '#606266');
  const gridColor = toRgba(textPrimary, 0.14);
  const tickColor = textSecondary || toRgba(textPrimary, 0.56);

  return {
    responsive: true,
    maintainAspectRatio: false,
    resizeDelay: 0,
    interaction: {
      intersect: false,
      mode: 'index'
    },
    plugins: {
      legend: {
        display: false,
        labels: {
          color: textSecondary
        }
      },
      tooltip: {
        enabled: true,
        backgroundColor: isDark ? 'rgba(0, 0, 0, 0.9)' : 'rgba(255, 255, 255, 0.95)',
        titleColor: textPrimary,
        bodyColor: textPrimary,
        borderColor: isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)',
        borderWidth: 1,
        cornerRadius: 6,
        padding: 8,
        displayColors: false,
          titleFont: {
          size: 12,
          weight: 600
        },
        bodyFont: {
          size: 11
        }
      },
      title: {
        display: false,
        color: textPrimary
      }
    },
    scales: {
      x: {
        display: true,
        grid: {
          display: true,
          color: gridColor,
          lineWidth: 1
        },
        ticks: {
          display: true,
          color: tickColor,
          font: {
            size: 10
          },
          maxTicksLimit: 6
        },
        border: {
          display: false
        }
      },
      y: {
        display: true,
        grid: {
          display: true,
          color: gridColor,
          lineWidth: 1
        },
        ticks: {
          display: true,
          color: tickColor,
          font: {
            size: 10
          },
          maxTicksLimit: 5
        },
        border: {
          display: false
        }
      }
    },
    animation: {
      duration: 300,
      easing: 'easeOutQuart'
    },
    elements: {
      point: {
        radius: 0,
        hoverRadius: 4
      },
      line: {
        tension: 0.4
      }
    }
  };
}

/**
 * 通用图表配置 - 向后兼容
 * @deprecated 请使用 getThemeAwareChartOptions() 获取主题感知配置
 */
export const commonChartOptions = getThemeAwareChartOptions();

/**
 * CPU监控图表配置 - 主题感知版本
 * @returns {Object} Chart.js配置
 */
export function getCpuChartConfig(): Record<string, unknown> {
  const themeMode = getCurrentTheme();
  const isDark = themeMode === 'dark';
  const textPrimary =
    getCSSVar('--terminal-surface-text-color') ||
    (isDark ? getCSSVar('--fallback-text-on-dark') : getCSSVar('--fallback-text-on-light')) ||
    (isDark ? '#e5e5e5' : '#303133');
  const textSecondary =
    getCSSVar('--terminal-surface-text-secondary') ||
    (isDark
      ? getCSSVar('--fallback-text-secondary-on-dark')
      : getCSSVar('--fallback-text-secondary-on-light')) ||
    (isDark ? '#b0b0b0' : '#606266');
  const tickColor = textSecondary || toRgba(textPrimary, 0.56);
  const gridColor = toRgba(textPrimary, 0.14);
  const pointBorderColor = isDark ? '#ffffff' : '#000000';

  return {
    type: 'line',
    data: {
      labels: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
      datasets: [
        {
          label: 'CPU使用率',
          data: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.2)',
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 3,
          pointBackgroundColor: '#3b82f6',
          pointBorderColor,
          pointBorderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: 'index'
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          enabled: true,
          backgroundColor: isDark ? 'rgba(0, 0, 0, 0.9)' : 'rgba(255, 255, 255, 0.95)',
          titleColor: textPrimary,
          bodyColor: textPrimary,
          borderColor: isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)',
          borderWidth: 1,
          cornerRadius: 6,
          padding: 8,
          displayColors: false,
          titleFont: {
            size: 12,
            weight: 600
          },
          bodyFont: {
            size: 11
          },
          callbacks: {
            title(context: any[]) {
              return `时间: ${context[0].label}`;
            },
            label(context: any) {
              return `CPU使用率: ${context.parsed.y.toFixed(1)}%`;
            }
          }
        }
      },
      scales: {
        x: {
          display: true,
          grid: {
            display: false
          },
          ticks: {
            color: tickColor,
            font: {
              size: 10
            },
            maxTicksLimit: 5
            // Note: Do NOT override tick callback here.
            // For a category scale, Chart.js will display the actual label by default.
            // A custom callback returning the tick value shows the index (0..n), which caused numeric axes.
          }
        },
        y: {
          min: 0,
          max: 100,
          grid: {
            color: gridColor
          },
          ticks: {
            color: tickColor,
            callback(value: any) {
              return `${value}%`;
            }
          }
        }
      },
      animation: {
        duration: 400, // 减少动画时长，更流畅
        easing: 'easeOutQuart'
      },
      transitions: {
        active: {
          animation: {
            duration: 300,
            easing: 'easeOutQuart'
          }
        },
        // 自定义transition模式：保持动画但隐藏数据点
        dataUpdate: {
          animation: {
            duration: 400,
            easing: 'easeOutQuart'
          },
          animations: {
            // 确保数据点始终保持隐藏
            radius: {
              type: 'number',
              properties: ['pointRadius'],
              to: 0,
              duration: 0
            }
          }
        }
      },
      elements: {
        point: {
          radius: 0, // 默认不显示数据点
          hoverRadius: 3, // 悬浮时显示小数据点
          borderWidth: 1,
          hoverBorderWidth: 1
        },
        line: {
          tension: 0.4
        }
      }
    }
  };
}

/**
 * 内存监控图表配置 - 简化版本
 * @returns {Object} Chart.js配置
 */
export function getMemoryChartConfig(): Record<string, unknown> {
  const themeMode = getCurrentTheme();
  const isDark = themeMode === 'dark';
  const textPrimary =
    getCSSVar('--terminal-surface-text-color') ||
    (isDark ? getCSSVar('--fallback-text-on-dark') : getCSSVar('--fallback-text-on-light')) ||
    (isDark ? '#e5e5e5' : '#303133');
  return {
    type: 'doughnut',
    data: {
      labels: ['已使用', '可用'],
      datasets: [
        {
          data: [0, 100],
          backgroundColor: ['#8b5cf6', 'rgba(255, 255, 255, 0.1)'],
          borderWidth: 0,
          cutout: '70%'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: isDark ? 'rgba(0, 0, 0, 0.9)' : 'rgba(255, 255, 255, 0.95)',
          titleColor: textPrimary,
          bodyColor: textPrimary,
          callbacks: {
            label(context: any) {
              const label = context.label || '';
              const value = context.parsed;
              return `${label}: ${value.toFixed(1)}%`;
            }
          }
        }
      },
      animation: {
        duration: 0 // 禁用动画
      }
    }
  };
}

/**
 * 网络监控图表配置 - 简化版本
 * @returns {Object} Chart.js配置
 */
export function getNetworkChartConfig(): Record<string, unknown> {
  const themeMode = getCurrentTheme();
  const isDark = themeMode === 'dark';
  const textPrimary =
    getCSSVar('--terminal-surface-text-color') ||
    (isDark ? getCSSVar('--fallback-text-on-dark') : getCSSVar('--fallback-text-on-light')) ||
    (isDark ? '#e5e5e5' : '#303133');
  const textSecondary =
    getCSSVar('--terminal-surface-text-secondary') ||
    (isDark
      ? getCSSVar('--fallback-text-secondary-on-dark')
      : getCSSVar('--fallback-text-secondary-on-light')) ||
    (isDark ? '#b0b0b0' : '#606266');
  const tickColor = textSecondary || toRgba(textPrimary, 0.56);
  const gridColor = toRgba(textPrimary, 0.14);
  const pointBorderColor = isDark ? '#ffffff' : '#000000';

  return {
    type: 'line',
    data: {
      labels: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
      datasets: [
        {
          label: '上传速度',
          data: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          borderColor: '#ef4444',
          backgroundColor: 'transparent',
          borderWidth: 2,
          fill: false,
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 3,
          pointBackgroundColor: '#ef4444',
          pointBorderColor,
          pointBorderWidth: 1
        },
        {
          label: '下载速度',
          data: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          borderColor: '#10b981',
          backgroundColor: 'transparent',
          borderWidth: 2,
          fill: false,
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 3,
          pointBackgroundColor: '#10b981',
          pointBorderColor,
          pointBorderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: 'index'
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          enabled: true,
          backgroundColor: isDark ? 'rgba(0, 0, 0, 0.9)' : 'rgba(255, 255, 255, 0.95)',
          titleColor: textPrimary,
          bodyColor: textPrimary,
          borderColor: isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)',
          borderWidth: 1,
          cornerRadius: 6,
          padding: 8,
          displayColors: true,
          titleFont: {
            size: 12,
            weight: 600
          },
          bodyFont: {
            size: 11
          },
          callbacks: {
            title(context: any[]) {
              return `时间: ${context[0].label}`;
            },
            label(context: any) {
              // 动态格式化网络速度，需要导入formatNetworkSpeed函数
              const speed = Number(context.parsed?.y ?? 0);
              const label = String(context.dataset?.label ?? '');

              // 简单的速度格式化逻辑
              let formattedSpeed;
              if (speed >= 1024 * 1024) {
                formattedSpeed = `${(speed / (1024 * 1024)).toFixed(1)} MB/s`;
              } else if (speed >= 1024) {
                formattedSpeed = `${(speed / 1024).toFixed(1)} KB/s`;
              } else {
                formattedSpeed = `${speed.toFixed(0)} B/s`;
              }

              return `${label}: ${formattedSpeed}`;
            }
          }
        }
      },
      scales: {
        x: {
          display: true,
          grid: {
            display: false
          },
          ticks: {
            color: tickColor,
            font: {
              size: 10
            },
            maxTicksLimit: 5
            // Note: keep default tick rendering so time labels (HH:mm:ss) appear correctly.
          }
        },
        y: {
          min: 0,
          grid: {
            color: gridColor
          },
          ticks: {
            color: tickColor,
            callback(value: any) {
              // 动态格式化Y轴标签
              const v = Number(value) || 0;
              if (v >= 1024 * 1024) {
                return `${(v / (1024 * 1024)).toFixed(1)}M`;
              } else if (v >= 1024) {
                return `${(v / 1024).toFixed(1)}K`;
              } else {
                return `${v.toFixed(0)}B`;
              }
            }
          }
        }
      },
      animation: {
        duration: 400, // 减少动画时长，更流畅
        easing: 'easeOutQuart'
      },
      transitions: {
        active: {
          animation: {
            duration: 300,
            easing: 'easeOutQuart'
          }
        },
        // 自定义transition模式：保持动画但隐藏数据点
        dataUpdate: {
          animation: {
            duration: 400,
            easing: 'easeOutQuart'
          },
          animations: {
            // 确保数据点始终保持隐藏
            radius: {
              type: 'number',
              properties: ['pointRadius'],
              to: 0,
              duration: 0
            }
          }
        }
      },
      elements: {
        point: {
          radius: 0,
          hoverRadius: 3,
          borderWidth: 1,
          hoverBorderWidth: 1
        },
        line: {
          borderWidth: 2
        }
      }
    }
  };
}

/**
 * 硬盘监控图表配置 - 堆叠柱形图版本
 * @returns {Object} Chart.js配置
 */
export function getDiskChartConfig(): Record<string, unknown> {
  const themeMode = getCurrentTheme();
  const isDark = themeMode === 'dark';
  const textPrimary =
    getCSSVar('--terminal-surface-text-color') ||
    (isDark ? getCSSVar('--fallback-text-on-dark') : getCSSVar('--fallback-text-on-light')) ||
    (isDark ? '#e5e5e5' : '#303133');
  const tickColor = toRgba(textPrimary, 0.52);

  return {
    type: 'bar',
    data: {
      labels: ['硬盘使用情况'],
      datasets: [
        {
          label: '已使用',
          data: [0],
          backgroundColor: '#f97316',
          borderColor: '#f97316',
          borderWidth: 0,
          borderRadius: 4,
          borderSkipped: false,
          stack: 'disk'
        },
        {
          label: '可用空间',
          data: [100],
          backgroundColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
          borderColor: isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)',
          borderWidth: 0,
          borderRadius: 4,
          borderSkipped: false,
          stack: 'disk'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y', // 水平柱形图
      interaction: {
        intersect: true,
        mode: 'dataset'
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          enabled: true,
          backgroundColor: isDark ? 'rgba(0, 0, 0, 0.9)' : 'rgba(255, 255, 255, 0.95)',
          titleColor: textPrimary,
          bodyColor: textPrimary,
          borderColor: isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)',
          borderWidth: 1,
          cornerRadius: 6,
          padding: 10,
          displayColors: true,
          titleFont: {
            size: 12,
            weight: 600
          },
          bodyFont: {
            size: 11
          },
          // 修复tooltip位置问题 - 确保不被遮挡
          position: 'nearest',
          xAlign: 'center',
          yAlign: 'top', // 显示在图表上方
          caretPadding: 10,
          filter(_tooltipItem: any) {
            // 只显示当前鼠标悬浮的数据集，避免显示多个tooltip项
            return true;
          },
          callbacks: {
            title() {
              return '硬盘使用情况';
            },
            label(context: any) {
              // 根据数据集索引判断悬浮的区域
              const datasetIndex = context.datasetIndex;
              const value = context.parsed.x;

              if (datasetIndex === 0) {
                // 悬浮在已用区域 - 显示已用信息
                return `已用：${value.toFixed(1)}%`;
              } else if (datasetIndex === 1) {
                // 悬浮在可用区域 - 显示可用信息
                return `可用：${value.toFixed(1)}%`;
              }

              return null;
            },
            afterBody(_context: any) {
              // 这里会在组件中动态更新，显示实际的空间大小
              // 返回空数组，因为容量信息会在组件中通过动态更新tooltip来显示
              return [];
            }
          }
        }
      },
      scales: {
        x: {
          display: true,
          stacked: true,
          min: 0,
          max: 100,
          grid: {
            display: false
          },
          ticks: {
            display: true,
            color: tickColor,
            font: {
              size: 10
            },
            maxTicksLimit: 6,
            callback(value: any) {
              return `${value}%`;
            }
          },
          border: {
            display: false
          }
        },
        y: {
          display: false,
          stacked: true,
          grid: {
            display: false
          },
          ticks: {
            display: false
          },
          border: {
            display: false
          }
        }
      },
      animation: {
        duration: 400,
        easing: 'easeOutQuart'
      },
      transitions: {
        active: {
          animation: {
            duration: 300,
            easing: 'easeOutQuart'
          }
        },
        // 自定义transition模式：保持动画
        dataUpdate: {
          animation: {
            duration: 400,
            easing: 'easeOutQuart'
          }
        }
      },
      elements: {
        bar: {
          borderWidth: 0
        }
      }
    }
  };
}

/**
 * 更新图表主题
 * @param {Object} chart - Chart.js实例
 * @param {string} _theme - 主题名称（暂未使用）
 */
export function updateChartTheme(chart: ChartInstanceLike, _theme: ThemeMode = 'dark'): void {
  if (!chart) return;

  const options = (chart as any).options || {};

  // 更新网格和坐标轴颜色
  if ((options as any).scales) {
    Object.keys((options as any).scales).forEach(scaleKey => {
      const scale = (options as any).scales[scaleKey] || {};
      if (scale.grid) {
        scale.grid.color = getCSSVar('--monitor-chart-grid');
      }
      if (scale.ticks) {
        scale.ticks.color = getCSSVar('--monitor-chart-axis');
      }
    });
  }

  // 更新提示框颜色
  if ((options as any).plugins && (options as any).plugins.tooltip) {
    const tooltip = (options as any).plugins.tooltip;
    tooltip.backgroundColor = getCSSVar('--monitor-chart-tooltip-bg');
    tooltip.titleColor = getCSSVar('--monitor-text-primary');
    tooltip.bodyColor = getCSSVar('--monitor-text-primary');
    tooltip.borderColor = getCSSVar('--monitor-chart-tooltip-border');
  }

  (chart as any).update?.('none');
}

/**
 * 限制数据点数量（性能优化版本）
 * @param {Array} dataArray - 数据数组
 * @param {number} maxPoints - 最大数据点数量
 * @returns {Array} 处理后的数据数组
 */
export function limitDataPoints<T>(dataArray: T[], maxPoints: number = 10): T[] {
  if (!Array.isArray(dataArray)) return [] as T[];
  if (dataArray.length <= maxPoints) return dataArray;

  // 使用splice而不是slice，直接修改原数组以节省内存
  const excess = dataArray.length - maxPoints;
  dataArray.splice(0, excess);
  return dataArray;
}

/**
 * 监听主题变化并更新图表
 * @param {Object} chartInstance - Chart.js实例
 * @param {Function} updateCallback - 更新回调函数
 */
export function watchThemeChange(
  chartInstance: ChartInstanceLike,
  updateCallback?: () => void
): { disconnect(): void } | void {
  if (!chartInstance) return;

  const handler = () => {
    if (updateCallback) {
      updateCallback();
    } else {
      const newOptions = getThemeAwareChartOptions();
      (chartInstance as any).options = { ...(chartInstance as any).options, ...newOptions };
      (chartInstance as any).update?.('none');
    }
  };

  // 监听主题属性变化
  const observer = new MutationObserver((mutations: MutationRecord[]) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && (mutation.attributeName === 'data-theme' || mutation.attributeName === 'class')) {
        handler();
      }
    }
  });

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'class']
  });

  // 监听来自设置服务和终端视图的主题事件（UI/终端主题、终端设置变更）
  const eventHandler = () => handler();
  window.addEventListener('theme-changed', eventHandler);
  try {
    window.addEventListener(EVENTS.TERMINAL_THEME_UPDATE, eventHandler);
    window.addEventListener(EVENTS.TERMINAL_SETTINGS_UPDATED, eventHandler);
  } catch (_) {}

  return {
    disconnect() {
      try { observer.disconnect(); } catch (_) {}
      window.removeEventListener('theme-changed', eventHandler);
      try {
        window.removeEventListener(EVENTS.TERMINAL_THEME_UPDATE, eventHandler);
        window.removeEventListener(EVENTS.TERMINAL_SETTINGS_UPDATED, eventHandler);
      } catch (_) {}
    }
  } as { disconnect(): void };
}

/**
 * 强制隐藏图表数据点的工具函数
 * @param {Object} chartInstance - Chart.js实例
 */
export function forceHideDataPoints(chartInstance: ChartInstanceLike): void {
  if (!chartInstance) return;

  try {
    // 1. 在dataset级别设置
    if ((chartInstance as any).data && (chartInstance as any).data.datasets) {
      (chartInstance as any).data.datasets.forEach((dataset: any) => {
        dataset.pointRadius = 0;
        dataset.pointHoverRadius = 3;
      });
    }

    // 2. 在options.elements级别强制设置
    if (!(chartInstance as any).options.elements) {
      (chartInstance as any).options.elements = {};
    }
    if (!(chartInstance as any).options.elements.point) {
      (chartInstance as any).options.elements.point = {};
    }
    (chartInstance as any).options.elements.point.radius = 0;
    (chartInstance as any).options.elements.point.hoverRadius = 3;

    // 3. 强制更新
    (chartInstance as any).update?.('none');
  } catch (error: any) {
    log.warn('强制隐藏数据点失败', error);
  }
}

/**
 * 防抖函数 - 用于图表更新优化
 * @param {Function} func - 要防抖的函数
 * @param {number} wait - 等待时间（毫秒）
 * @returns {Function} 防抖后的函数
 */
export function debounce<T extends (...args: any[]) => void>(
  func: T,
  wait: number = 100
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      if (timeout) clearTimeout(timeout);
      func(...args);
    };
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * 节流函数 - 用于高频更新优化
 * @param {Function} func - 要节流的函数
 * @param {number} limit - 限制时间（毫秒）
 * @returns {Function} 节流后的函数
 */
export function throttle<T extends (...args: any[]) => void>(
  func: T,
  limit: number = 16
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  return function executedFunction(...args: Parameters<T>) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}
// import kept at top
