<template>
  <div class="monitoring-detail-panel" :class="{ 'is-loading': isLoading }">
    <!-- 面板头部 -->
    <div class="panel-header">
      <div class="panel-title">
        <i class="icon-monitor"></i>
        <span>系统监控详情</span>
        <span class="server-info">{{ serverInfo.hostname || 'Unknown' }} {{ serverInfo.ip || '192.168.10.10' }}</span>
      </div>
      <div class="panel-controls">
        <button @click="refreshData" :disabled="isLoading" class="refresh-btn" title="刷新数据">
          <i class="icon-refresh" :class="{ 'spinning': isLoading }"></i>
        </button>
        <button @click="$emit('close')" class="close-btn" title="关闭面板">
          <i class="icon-close"></i>
        </button>
      </div>
    </div>

    <!-- 错误提示 -->
    <div v-if="chartError" class="error-banner">
      <i class="icon-warning"></i>
      <span>{{ chartError }}</span>
      <button @click="retryInit" class="retry-btn">重试</button>
    </div>

    <!-- 加载状态 -->
    <div v-if="isLoading && !chartError" class="loading-overlay">
      <div class="loading-spinner"></div>
      <span>加载中...</span>
    </div>

    <!-- 面板内容 -->
    <div class="panel-content" v-show="!isLoading || chartError">
      <!-- 顶部区域 - 系统信息和网络图表 -->
      <div class="top-section">
        <!-- 系统信息 -->
        <div class="system-info">
          <div class="info-line">
            <div class="info-item">
              <span class="label">运行时间</span>
              <span class="value">{{ serverInfo.uptime || 'Unknown' }}</span>
            </div>
            <div class="info-item">
              <span class="label">架构</span>
              <span class="value">{{ serverInfo.arch || 'x86_64' }}</span>
            </div>
            <div class="info-item">
              <span class="label">内存</span>
              <span class="value">{{ serverInfo.memory || '3.82 GB' }}</span>
            </div>
            <div class="info-item">
              <span class="label">磁盘</span>
              <span class="value">{{ serverInfo.disk || '38 GB' }}</span>
            </div>
          </div>
          <div class="info-line">
            <div class="info-item">
              <span class="label">系统</span>
              <span class="value">{{ serverInfo.os || 'Unknown' }}</span>
            </div>
            <div class="info-item">
              <span class="label">CPU</span>
              <span class="value">{{ serverInfo.cpu || 'QEMU Virtual CPU version 2.5+ 2 Virtual Core' }}</span>
            </div>
          </div>
          <div class="info-line">
            <div class="info-item">
              <span class="label">Load</span>
              <span class="value">{{ serverInfo.load || '0 / 0.02 / 0' }}</span>
            </div>
            <div class="info-item">
              <span class="label">上传</span>
              <span class="value">{{ serverInfo.upload || '1.98 GB' }}</span>
            </div>
            <div class="info-item">
              <span class="label">下载</span>
              <span class="value">{{ serverInfo.download || '1.26 GB' }}</span>
            </div>
          </div>
          <div class="info-line">
            <div class="info-item">
              <span class="label">启动时间</span>
              <span class="value">{{ formatDateTime(serverInfo.bootTime) }}</span>
            </div>
            <div class="info-item">
              <span class="label">最后上线时间</span>
              <span class="value">{{ formatDateTime(serverInfo.lastOnline) }}</span>
            </div>
          </div>
        </div>

        <!-- 网络图表 -->
        <div class="network-chart-container">
          <div class="network-chart">
            <canvas ref="networkChart"></canvas>
          </div>
        </div>
      </div>

      <!-- 底部图表区域 -->
      <div class="bottom-charts-section">
        <div class="charts-grid">
          <div class="chart-card">
            <canvas ref="cpuChart"></canvas>
          </div>
          <div class="chart-card">
            <canvas ref="memoryChart"></canvas>
          </div>
          <div class="chart-card">
            <canvas ref="diskChart"></canvas>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'

// ==================== Props & Emits ====================
const props = defineProps({
  serverInfo: {
    type: Object,
    default: () => ({})
  },
  visible: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close', 'refresh'])

// ==================== 响应式数据 ====================
const cpuChart = ref(null)
const memoryChart = ref(null)
const diskChart = ref(null)
const networkChart = ref(null)

// 状态管理
const isLoading = ref(false)
const chartError = ref(null)
const retryCount = ref(0)

// 图表实例存储
const chartInstances = ref({
  cpu: null,
  memory: null,
  disk: null,
  network: null
})

// 历史数据
const historyData = ref({
  cpu: Array(20).fill(0).map(() => Math.random() * 100),
  memory: Array(20).fill(0).map(() => Math.random() * 100),
  disk: Array(20).fill(0).map(() => Math.random() * 100),
  network: {
    upload: Array(20).fill(0).map(() => Math.random() * 1000000),
    download: Array(20).fill(0).map(() => Math.random() * 5000000)
  }
})

// ==================== 常量定义 ====================
const CHART_CONSTANTS = {
  COLORS: {
    PRIMARY: ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#6366f1'],
    THEME: {
      LIGHT: {
        GRID: 'rgba(0, 0, 0, 0.1)',
        TEXT: 'rgba(0, 0, 0, 0.6)',
        BORDER: 'rgba(0, 0, 0, 0.2)',
        LEGEND: 'rgba(0, 0, 0, 0.8)'
      },
      DARK: {
        GRID: 'rgba(255, 255, 255, 0.1)',
        TEXT: 'rgba(255, 255, 255, 0.6)',
        BORDER: 'rgba(255, 255, 255, 0.2)',
        LEGEND: 'rgba(255, 255, 255, 0.8)'
      }
    }
  },
  SIZES: {
    LEGEND_FONT: 11,
    AXIS_FONT_SMALL: 9,
    AXIS_FONT_MEDIUM: 10,
    LEGEND_PADDING: 8,
    LEGEND_RADIUS: 3,
    LEGEND_BOX_SIZE: 6
  },
  ANIMATION: {
    DURATION: 300,
    EASING: 'easeInOutQuart'
  },
  UPDATE_INTERVAL: 3000,
  MAX_RETRIES: 3
}

// ==================== 工具函数 ====================

// 主题检测
const isDarkTheme = () => {
  return document.documentElement.classList.contains('dark') || 
         document.documentElement.getAttribute('data-theme') === 'dark' ||
         window.matchMedia('(prefers-color-scheme: dark)').matches;
}

// 获取主题适配的颜色
const getThemeColor = (type) => {
  const theme = isDarkTheme() ? 'DARK' : 'LIGHT';
  return CHART_CONSTANTS.COLORS.THEME[theme][type];
}

// 防抖函数
const debounce = (func, wait) => {
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

// 节流函数
const throttle = (func, limit) => {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  }
}

// 格式化字节
const formatBytes = (bytes) => {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// 格式化日期时间
const formatDateTime = (date) => {
  if (!date) return 'Unknown'
  const d = new Date(date)
  const year = d.getFullYear()
  const month = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  const hours = d.getHours().toString().padStart(2, '0')
  const minutes = d.getMinutes().toString().padStart(2, '0')
  const seconds = d.getSeconds().toString().padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

// ==================== 图表配置工厂 ====================

// 生成随机颜色（优化版）
const getRandomColor = () => {
  return CHART_CONSTANTS.COLORS.PRIMARY[Math.floor(Math.random() * CHART_CONSTANTS.COLORS.PRIMARY.length)];
}

// 确保颜色不重复
const getUniqueColors = (count) => {
  const colors = [...CHART_CONSTANTS.COLORS.PRIMARY];
  const result = [];
  for (let i = 0; i < count && colors.length > 0; i++) {
    const index = Math.floor(Math.random() * colors.length);
    result.push(colors.splice(index, 1)[0]);
  }
  return result;
}

// 生成图例配置
const createLegendConfig = () => ({
  display: true,
  position: 'top',
  align: 'start',
  labels: {
    color: getThemeColor('LEGEND'),
    font: {
      size: CHART_CONSTANTS.SIZES.LEGEND_FONT
    },
    padding: CHART_CONSTANTS.SIZES.LEGEND_PADDING,
    usePointStyle: true,
    pointStyle: 'circle',
    pointStyleWidth: CHART_CONSTANTS.SIZES.LEGEND_BOX_SIZE,
    boxWidth: CHART_CONSTANTS.SIZES.LEGEND_BOX_SIZE,
    boxHeight: CHART_CONSTANTS.SIZES.LEGEND_BOX_SIZE,
    generateLabels: function(chart) {
      const original = Chart.defaults.plugins.legend.labels.generateLabels;
      const labels = original.call(this, chart);
      
      labels.forEach(label => {
        label.pointStyle = 'circle';
        label.fillStyle = label.strokeStyle;
        label.strokeStyle = 'transparent';
        label.lineWidth = 0;
        label.radius = CHART_CONSTANTS.SIZES.LEGEND_RADIUS;
      });
      
      return labels;
    }
  }
})

// 生成坐标轴配置
const createAxisConfig = (type = 'default', options = {}) => {
  const baseConfig = {
    display: true,
    grid: {
      display: true,
      color: getThemeColor('GRID'),
      lineWidth: 1
    },
    ticks: {
      display: true,
      color: getThemeColor('TEXT'),
      font: {
        size: type === 'small' ? CHART_CONSTANTS.SIZES.AXIS_FONT_SMALL : CHART_CONSTANTS.SIZES.AXIS_FONT_MEDIUM
      }
    },
    border: {
      display: true,
      color: getThemeColor('BORDER')
    }
  };

  // 深度合并配置
  const mergeConfig = (target, source) => {
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        target[key] = target[key] || {};
        mergeConfig(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
    return target;
  };

  return mergeConfig({ ...baseConfig }, options);
}

// 生成时间格式化回调
const createTimeCallback = () => {
  return function(value, index, values) {
    const totalPoints = values.length;
    const timeAgo = totalPoints - index - 1;
    const now = new Date();
    const targetTime = new Date(now.getTime() - timeAgo * 1000);
    const minutes = targetTime.getMinutes().toString().padStart(2, '0');
    const seconds = targetTime.getSeconds().toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  };
}

// ==================== 错误处理和状态管理 ====================

// 错误处理函数
const handleChartError = (error, chartName) => {
  console.error(`Chart error in ${chartName}:`, error);
  chartError.value = `${chartName} 图表加载失败`;
  
  if (retryCount.value < CHART_CONSTANTS.MAX_RETRIES) {
    retryCount.value++;
    setTimeout(() => {
      initCharts();
    }, 1000 * retryCount.value);
  }
}

// 重置错误状态
const resetError = () => {
  chartError.value = null;
  retryCount.value = 0;
}

// 重试初始化
const retryInit = () => {
  resetError();
  initCharts();
}

// 刷新数据
const refreshData = throttle(() => {
  emit('refresh');
  updateChartsData();
}, 1000);

// ==================== 主题监听和更新 ====================

// 更新图表主题
const updateChartsTheme = debounce(() => {
  Object.values(chartInstances.value).forEach(chart => {
    if (chart) {
      try {
        // 更新图例颜色
        chart.options.plugins.legend.labels.color = getThemeColor('LEGEND');
        
        // 更新坐标轴颜色
        if (chart.options.scales.x) {
          chart.options.scales.x.grid.color = getThemeColor('GRID');
          chart.options.scales.x.ticks.color = getThemeColor('TEXT');
          chart.options.scales.x.border.color = getThemeColor('BORDER');
        }
        if (chart.options.scales.y) {
          chart.options.scales.y.grid.color = getThemeColor('GRID');
          chart.options.scales.y.ticks.color = getThemeColor('TEXT');
          chart.options.scales.y.border.color = getThemeColor('BORDER');
        }
        
        chart.update('none'); // 无动画更新
      } catch (error) {
        console.warn('Failed to update chart theme:', error);
      }
    }
  });
}, 100);

// 监听主题变化
let themeObserver = null;
let mediaQuery = null;

const setupThemeListeners = () => {
  // 监听DOM主题变化
  themeObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes' && 
          (mutation.attributeName === 'class' || mutation.attributeName === 'data-theme')) {
        updateChartsTheme();
      }
    });
  });

  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme']
  });

  // 监听系统主题变化
  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const handleSystemThemeChange = () => {
    updateChartsTheme();
  };
  
  if (mediaQuery.addEventListener) {
    mediaQuery.addEventListener('change', handleSystemThemeChange);
  } else {
    // 兼容旧版浏览器
    mediaQuery.addListener(handleSystemThemeChange);
  }
}

const cleanupThemeListeners = () => {
  if (themeObserver) {
    themeObserver.disconnect();
    themeObserver = null;
  }
  
  if (mediaQuery) {
    const handleSystemThemeChange = () => {
      updateChartsTheme();
    };
    
    if (mediaQuery.removeEventListener) {
      mediaQuery.removeEventListener('change', handleSystemThemeChange);
    } else {
      mediaQuery.removeListener(handleSystemThemeChange);
    }
    mediaQuery = null;
  }
}

// ==================== 图表初始化 ====================

// 销毁所有图表
const destroyCharts = () => {
  Object.values(chartInstances.value).forEach(chart => {
    if (chart) {
      chart.destroy();
    }
  });
  chartInstances.value = {
    cpu: null,
    memory: null,
    disk: null,
    network: null
  };
}

// 初始化图表
const initCharts = async () => {
  if (isLoading.value) return;
  
  isLoading.value = true;
  resetError();
  
  try {
    await nextTick();
    
    if (!cpuChart.value || !memoryChart.value || !diskChart.value || !networkChart.value) {
      throw new Error('图表容器未找到');
    }

    // 销毁现有图表
    destroyCharts();

    // 动态导入Chart.js
    const { Chart, registerables } = await import('chart.js');
    Chart.register(...registerables);

    // 基础图表配置
    const baseChartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: 'index'
      },
      animation: {
        duration: CHART_CONSTANTS.ANIMATION.DURATION,
        easing: CHART_CONSTANTS.ANIMATION.EASING
      },
      plugins: {
        legend: createLegendConfig(),
        tooltip: {
          enabled: true,
          mode: 'index',
          intersect: false,
          backgroundColor: isDarkTheme() ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.9)',
          titleColor: isDarkTheme() ? '#fff' : '#000',
          bodyColor: isDarkTheme() ? '#fff' : '#000',
          borderColor: getThemeColor('BORDER'),
          borderWidth: 1,
          cornerRadius: 6,
          displayColors: true,
          titleFont: {
            size: 12,
            weight: 'bold'
          },
          bodyFont: {
            size: 11
          },
          padding: 8
        }
      },
      scales: {
        x: createAxisConfig('small', {
          ticks: {
            maxTicksLimit: 6,
            callback: createTimeCallback()
          }
        }),
        y: createAxisConfig('default', {
          min: 0,
          max: 100,
          ticks: {
            callback: function(value) {
              return value + '%';
            }
          }
        })
      },
      elements: {
        line: {
          tension: 0.4
        },
        point: {
          radius: 0,
          hoverRadius: 4,
          hoverBorderWidth: 2
        }
      }
    };

    // 创建图表
    await createCharts(Chart, baseChartOptions);
    
    isLoading.value = false;
    
  } catch (error) {
    isLoading.value = false;
    handleChartError(error, '系统');
  }
}

// 创建所有图表
const createCharts = async (Chart, baseOptions) => {
  const colors = getUniqueColors(4);
  
  // CPU图表
  chartInstances.value.cpu = new Chart(cpuChart.value, {
    type: 'line',
    data: {
      labels: Array(20).fill(''),
      datasets: [{
        label: 'CPU使用率',
        data: historyData.value.cpu,
        borderColor: colors[0],
        backgroundColor: colors[0] + '20',
        fill: true
      }]
    },
    options: baseOptions
  });

  // 内存图表
  chartInstances.value.memory = new Chart(memoryChart.value, {
    type: 'line',
    data: {
      labels: Array(20).fill(''),
      datasets: [{
        label: '内存使用率',
        data: historyData.value.memory,
        borderColor: colors[1],
        backgroundColor: colors[1] + '20',
        fill: true
      }]
    },
    options: baseOptions
  });

  // 磁盘图表
  chartInstances.value.disk = new Chart(diskChart.value, {
    type: 'line',
    data: {
      labels: Array(20).fill(''),
      datasets: [{
        label: '磁盘使用率',
        data: historyData.value.disk,
        borderColor: colors[2],
        backgroundColor: colors[2] + '20',
        fill: true
      }]
    },
    options: baseOptions
  });

  // 网络图表（特殊配置）
  const networkOptions = {
    ...baseOptions,
    scales: {
      x: createAxisConfig('small', {
        ticks: {
          maxTicksLimit: 6,
          callback: createTimeCallback()
        }
      }),
      y: createAxisConfig('default', {
        min: 0,
        ticks: {
          callback: function(value) {
            return formatBytes(value) + '/s';
          }
        }
      })
    }
  };

  chartInstances.value.network = new Chart(networkChart.value, {
    type: 'line',
    data: {
      labels: Array(20).fill(''),
      datasets: [{
        label: '上传',
        data: historyData.value.network.upload,
        borderColor: colors[3],
        backgroundColor: colors[3] + '20',
        fill: false
      }, {
        label: '下载',
        data: historyData.value.network.download,
        borderColor: colors[0], // 确保与上传颜色不同
        backgroundColor: colors[0] + '20',
        fill: false
      }]
    },
    options: networkOptions
  });
}

// 更新图表数据
const updateChartsData = () => {
  // 模拟数据更新
  historyData.value.cpu.shift();
  historyData.value.cpu.push(Math.random() * 100);
  
  historyData.value.memory.shift();
  historyData.value.memory.push(Math.random() * 100);
  
  historyData.value.disk.shift();
  historyData.value.disk.push(Math.random() * 100);
  
  historyData.value.network.upload.shift();
  historyData.value.network.upload.push(Math.random() * 1000000);
  
  historyData.value.network.download.shift();
  historyData.value.network.download.push(Math.random() * 5000000);

  // 更新图表
  Object.entries(chartInstances.value).forEach(([key, chart]) => {
    if (chart && chart.data) {
      if (key === 'network') {
        chart.data.datasets[0].data = [...historyData.value.network.upload];
        chart.data.datasets[1].data = [...historyData.value.network.download];
      } else {
        chart.data.datasets[0].data = [...historyData.value[key]];
      }
      chart.update('none');
    }
  });
}

// ==================== 生命周期管理 ====================

// 数据更新定时器
let updateTimer = null;

const startDataUpdate = () => {
  if (updateTimer) return;
  
  updateTimer = setInterval(() => {
    if (props.visible && !isLoading.value) {
      updateChartsData();
    }
  }, CHART_CONSTANTS.UPDATE_INTERVAL);
}

const stopDataUpdate = () => {
  if (updateTimer) {
    clearInterval(updateTimer);
    updateTimer = null;
  }
}

// 监听可见性变化
watch(() => props.visible, (newVisible) => {
  if (newVisible) {
    nextTick(() => {
      initCharts();
      startDataUpdate();
    });
  } else {
    stopDataUpdate();
  }
});

// 组件挂载
onMounted(() => {
  setupThemeListeners();
  if (props.visible) {
    initCharts();
    startDataUpdate();
  }
});

// 组件卸载
onUnmounted(() => {
  stopDataUpdate();
  destroyCharts();
  cleanupThemeListeners();
});
</script>

<style scoped>
/* ==================== 基础样式 ==================== */
.monitoring-detail-panel {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 90vw;
  max-width: 1200px;
  height: 80vh;
  max-height: 800px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
  display: flex;
  flex-direction: column;
  z-index: 1000;
  overflow: hidden;
  transition: all 0.3s ease;
}

.monitoring-detail-panel.is-loading {
  pointer-events: none;
}

/* ==================== 面板头部 ==================== */
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-muted);
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text);
}

.server-info {
  font-size: 12px;
  color: var(--color-text-secondary);
  font-weight: 400;
  margin-left: 12px;
}

.panel-controls {
  display: flex;
  gap: 8px;
}

.refresh-btn, .close-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 6px;
  background: var(--color-bg-container);
  color: var(--color-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.refresh-btn:hover, .close-btn:hover {
  background: var(--color-bg-elevated);
  color: var(--color-text);
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.icon-refresh.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* ==================== 错误和加载状态 ==================== */
.error-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  background: var(--color-danger-bg);
  border-bottom: 1px solid var(--color-danger-border);
  color: var(--color-danger-text);
  font-size: 14px;
}

.retry-btn {
  margin-left: auto;
  padding: 4px 8px;
  border: 1px solid var(--color-danger-border);
  border-radius: 4px;
  background: transparent;
  color: var(--color-danger-text);
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s ease;
}

.retry-btn:hover {
  background: var(--color-danger-text);
  color: var(--color-danger-bg);
}

.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: white;
  font-size: 14px;
  z-index: 10;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(255, 255, 255, 0.3);
  border-top: 3px solid white;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

/* ==================== 面板内容 ==================== */
.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 顶部区域 - 系统信息和网络图表 */
.top-section {
  display: flex;
  gap: 18px;
  margin-bottom: 18px;
}

.system-info {
  flex: 1;
  min-width: 0;
}

.info-line {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-bottom: 8px;
  align-items: center;
}

.info-line:last-child {
  margin-bottom: 0;
}

.info-item {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 95px;
}

.info-item .label {
  font-size: 12px;
  color: var(--color-text-secondary);
  font-weight: 400;
  min-width: 45px;
}

.info-item .value {
  font-size: 12px;
  color: var(--color-text);
  font-family: 'Fira Code', monospace;
  font-weight: 500;
}

/* 网络图表 */
.network-chart-container {
  width: 450px;
  flex-shrink: 0;
}

.network-chart {
  height: 200px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 12px;
}

/* 底部图表区域 */
.bottom-charts-section {
  padding: 12px 0 0 0;
}

.charts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 12px;
}

.chart-card {
  padding: 12px;
}

.chart-card canvas {
  height: 180px !important;
}

/* ==================== 响应式设计 ==================== */
@media (max-width: 768px) {
  .monitoring-detail-panel {
    width: 95vw;
    height: 90vh;
  }
  
  .top-section {
    flex-direction: column;
    gap: 16px;
  }
  
  .network-chart-container {
    width: 100%;
  }
  
  .info-line {
    flex-direction: column;
    gap: 12px;
    align-items: flex-start;
  }
  
  .charts-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 480px) {
  .panel-header {
    padding: 12px 16px;
  }
  
  .panel-content {
    padding: 12px;
  }
  
  .panel-title {
    font-size: 14px;
  }
  
  .server-info {
    display: none;
  }
}

/* ==================== 主题适配 ==================== */
@media (prefers-color-scheme: dark) {
  .monitoring-detail-panel {
    background: var(--color-bg-elevated, #1f2937);
    border-color: var(--color-border, #374151);
  }
}

/* ==================== 可访问性 ==================== */
.monitoring-detail-panel:focus-within {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.refresh-btn:focus,
.close-btn:focus,
.retry-btn:focus {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

/* 减少动画（用户偏好） */
@media (prefers-reduced-motion: reduce) {
  .monitoring-detail-panel,
  .refresh-btn,
  .close-btn,
  .retry-btn {
    transition: none;
  }
  
  .icon-refresh.spinning,
  .loading-spinner {
    animation: none;
  }
}
</style>
