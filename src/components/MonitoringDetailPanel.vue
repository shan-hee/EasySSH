<template>
  <transition name="panel-fade" appear>
    <div class="monitoring-detail-panel" v-if="visible">
      <div
        class="panel-container"
        :class="{ minimized: isMinimized }"
        :style="panelStyle"
        ref="panelContainer"
      >
        <!-- 面板头部 - 可拖动区域 -->
        <div
          class="panel-header draggable-header"
          @mousedown="startDrag"
          @dblclick="toggleMaximize"
        >
          <div class="header-info">
            <h3 class="panel-title">
              <i class="fas fa-chart-line"></i>
              系统监控详情
            </h3>
          </div>
          <div class="header-controls">
            <button class="control-btn minimize-btn" @click="minimizePanel" title="最小化">
              <i class="fas fa-minus"></i>
            </button>
            <button class="control-btn maximize-btn" @click="toggleMaximize" title="最大化/还原">
              <i class="fas" :class="isMaximized ? 'fa-compress' : 'fa-expand'"></i>
            </button>
            <button class="control-btn close-btn" @click="closePanel" title="关闭">
              <i class="fas fa-times"></i>
            </button>
          </div>
        </div>

      <!-- 面板内容 -->
      <div class="panel-content">
        <!-- 顶部信息和网络图表区域 -->
        <div class="top-section">
          <!-- 左侧系统信息 -->
          <div class="system-info">
            <!-- 第一行：系统、CPU -->
            <div class="info-line">
              <div class="info-item">
                <span class="label">系统</span>
                <span class="value">{{ monitoringData?.os?.os || monitoringData?.os?.distro || monitoringData?.system?.os || 'Unknown' }}</span>
              </div>
              <div class="info-item cpu-info">
                <span class="label">CPU</span>
                <span class="value">{{ monitoringData?.cpu?.model || 'Unknown' }}</span>
              </div>
            </div>

            <!-- 第二行：CPU核心、架构、内存、磁盘 -->
            <div class="info-line">
              <div class="info-item">
                <span class="label">CPU核心</span>
                <span class="value">{{ monitoringData?.cpu?.cores || monitoringData?.system?.cpu_cores || 'Unknown' }} 核</span>
              </div>
              <div class="info-item">
                <span class="label">架构</span>
                <span class="value">{{ monitoringData?.os?.arch || monitoringData?.system?.arch || 'Unknown' }}</span>
              </div>
              <div class="info-item">
                <span class="label">内存</span>
                <span class="value">{{ formatBytes((monitoringData?.memory?.total || 0) * 1024 * 1024) || 'Unknown' }}</span>
              </div>
              <div class="info-item">
                <span class="label">磁盘</span>
                <span class="value">{{ formatBytes((monitoringData?.disk?.total || 0) * 1024 * 1024 * 1024) || 'Unknown' }}</span>
              </div>
            </div>

            <!-- 第三行：Load、Swap、上传、下载 -->
            <div class="info-line">
              <div class="info-item">
                <span class="label">Load</span>
                <span class="value">{{ (monitoringData?.cpu?.loadAverage?.load1 || 0).toFixed(2) }} / {{ (monitoringData?.cpu?.loadAverage?.load5 || 0).toFixed(2) }} / {{ (monitoringData?.cpu?.loadAverage?.load15 || 0).toFixed(2) }}</span>
              </div>
              <div class="info-item">
                <span class="label">Swap</span>
                <span class="value">{{ formatBytes((monitoringData?.swap?.total || 0) * 1024 * 1024) || '0 B' }}</span>
              </div>
              <div class="info-item">
                <span class="label">上传</span>
                <span class="value">{{ formatBytes(monitoringData?.network?.totalUpload || monitoringData?.network?.total_tx_bytes || 0) || '0 B' }}</span>
              </div>
              <div class="info-item">
                <span class="label">下载</span>
                <span class="value">{{ formatBytes(monitoringData?.network?.totalDownload || monitoringData?.network?.total_rx_bytes || 0) || '0 B' }}</span>
              </div>
            </div>

            <!-- 第四行：启动时间、运行时间 -->
            <div class="info-line">
              <div class="info-item">
                <span class="label">启动时间</span>
                <span class="value">{{ formatDateTime(monitoringData?.os?.bootTime || monitoringData?.system?.bootTime) || 'Unknown' }}</span>
              </div>
              <div class="info-item">
                <span class="label">运行时间</span>
                <span class="value">{{ formatUptime(monitoringData?.os?.uptime || monitoringData?.system?.uptime) || 'Unknown' }}</span>
              </div>
            </div>
          </div>

          <!-- 右侧网络流量图表 -->
          <div class="network-chart-container">
            <div class="chart-card network-chart">
              <div class="chart-container">
                <canvas ref="networkChart" width="300" height="200"></canvas>
              </div>
            </div>
          </div>
        </div>

        <!-- 底部三个图表区域 -->
        <div class="bottom-charts-section">
          <div class="charts-grid">
            <!-- CPU使用率图表 -->
            <div class="chart-card">
              <div class="chart-container">
                <canvas ref="cpuChart" width="300" height="140"></canvas>
              </div>
            </div>

            <!-- 内存使用率图表 -->
            <div class="chart-card">
              <div class="chart-container">
                <canvas ref="memoryChart" width="300" height="140"></canvas>
              </div>
            </div>

            <!-- 硬盘使用率图表 -->
            <div class="chart-card">
              <div class="chart-container">
                <canvas ref="diskChart" width="300" height="140"></canvas>
              </div>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<script>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'

export default {
  name: 'MonitoringDetailPanel',
  props: {
    visible: {
      type: Boolean,
      default: false
    },
    monitoringData: {
      type: Object,
      default: () => ({})
    },
    serverInfo: {
      type: Object,
      default: () => ({})
    },
    terminalId: {
      type: String,
      default: ''
    }
  },
  emits: ['close'],
  setup(props, { emit }) {

    // 图表引用
    const cpuChart = ref(null)
    const memoryChart = ref(null)
    const diskChart = ref(null)
    const networkChart = ref(null)
    const panelContainer = ref(null)

    // 窗口状态
    const isMaximized = ref(false)
    const isMinimized = ref(false)
    const isDragging = ref(false)

    // 窗口位置和大小
    const panelPosition = ref({ x: 0, y: 0 })
    const panelSize = ref({ width: 1000, height: 600 })
    const originalSize = ref({ width: 1000, height: 600 })
    const originalPosition = ref({ x: 0, y: 0 })

    // 拖动相关
    const dragStart = ref({ x: 0, y: 0 })
    const dragOffset = ref({ x: 0, y: 0 })

    // ResizeObserver 用于监听面板大小变化
    let resizeObserver = null



    // 计算面板样式
    const panelStyle = computed(() => {
      if (isMaximized.value) {
        return {
          position: 'fixed',
          top: '0px',
          left: '0px',
          width: '100vw',
          height: '100vh',
          maxWidth: 'none',
          maxHeight: 'none',
          transform: 'none',
          zIndex: 10000
        }
      }

      if (isMinimized.value) {
        return {
          position: 'fixed',
          top: `${panelPosition.value.y}px`,
          left: `${panelPosition.value.x}px`,
          width: '600px',
          height: '280px',
          maxWidth: 'none',
          maxHeight: 'none',
          transform: 'none',
          zIndex: 10000
        }
      }

      // 正常状态：只控制位置，让CSS控制大小
      return {
        position: 'fixed',
        top: `${panelPosition.value.y}px`,
        left: `${panelPosition.value.x}px`,
        maxWidth: 'none',
        maxHeight: 'none',
        transform: 'none',
        zIndex: 10000
      }
    })

    // 图表实例
    let cpuChartInstance = null
    let memoryChartInstance = null
    let diskChartInstance = null
    let networkChartInstance = null

    // 历史数据存储（从全局监控服务获取）
    const historyData = ref({
      cpu: Array(20).fill(0),
      memory: Array(20).fill(0),
      disk: Array(20).fill(0),
      network: {
        upload: Array(20).fill(0),
        download: Array(20).fill(0)
      }
    })

    // 从全局监控服务加载历史数据
    const loadHistoryDataFromService = () => {
      try {
        // 使用传入的终端ID
        const currentTerminalId = props.terminalId;
        if (!currentTerminalId) {
          console.warn('[监控面板] 无法获取终端ID');
          return;
        }

        // 从全局监控服务获取历史数据
        const globalHistoryData = window.monitoringAPI?.getHistoryData?.(currentTerminalId);
        if (globalHistoryData) {
          historyData.value = {
            cpu: [...globalHistoryData.cpu],
            memory: [...globalHistoryData.memory],
            disk: [...globalHistoryData.disk],
            network: {
              upload: [...globalHistoryData.network.upload],
              download: [...globalHistoryData.network.download]
            }
          };
        } else {
          console.warn('[监控面板] 无法从全局服务获取历史数据');
        }
      } catch (error) {
        console.error('[监控面板] 加载历史数据失败:', error);
      }
    }

    // 初始化面板位置
    const initPanelPosition = () => {
      const windowWidth = window.innerWidth
      const windowHeight = window.innerHeight

      if (isMinimized.value) {
        // 最小化状态：设置到右下角
        panelPosition.value = {
          x: windowWidth - 600,
          y: windowHeight - 280 - 120 
        }
      } else {
        // 正常状态：居中显示
        // 获取面板的实际大小
        let actualWidth = panelSize.value.width
        let actualHeight = panelSize.value.height

        if (panelContainer.value) {
          const rect = panelContainer.value.getBoundingClientRect()
          actualWidth = rect.width
          actualHeight = rect.height
        }

        panelPosition.value = {
          x: Math.max(0, (windowWidth - actualWidth) / 2),
          y: Math.max(0, (windowHeight - actualHeight) / 2)
        }
      }
    }

    // 初始化ResizeObserver
    const initResizeObserver = () => {
      if (!panelContainer.value) return

      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect
          // 只有在非最大化和非最小化状态下才更新大小记录
          if (!isMaximized.value && !isMinimized.value) {
            panelSize.value = { width, height }
          }

          // 响应式布局控制
          updateResponsiveLayout(width)
        }
      })

      resizeObserver.observe(panelContainer.value)
    }

    // 响应式布局控制
    const updateResponsiveLayout = (containerWidth) => {
      if (!panelContainer.value) return

      const topSection = panelContainer.value.querySelector('.top-section')
      if (!topSection) return

      // 当容器宽度小于850px时，让图表换行，确保系统信息有足够空间
      if (containerWidth < 850) {
        topSection.style.flexDirection = 'column'
        topSection.style.gap = '16px'
        // 确保系统信息区域有足够的最小宽度
        const systemInfo = topSection.querySelector('.system-info')
        if (systemInfo) {
          systemInfo.style.minWidth = '350px'
        }
      } else {
        topSection.style.flexDirection = 'row'
        topSection.style.gap = '18px'
        // 恢复系统信息区域的最小宽度
        const systemInfo = topSection.querySelector('.system-info')
        if (systemInfo) {
          systemInfo.style.minWidth = '350px'
        }
      }
    }

    // 清理ResizeObserver
    const cleanupResizeObserver = () => {
      if (resizeObserver) {
        resizeObserver.disconnect()
        resizeObserver = null
      }
    }

    // 开始拖动
    const startDrag = (event) => {
      if (isMaximized.value) return

      isDragging.value = true
      dragStart.value = { x: event.clientX, y: event.clientY }
      dragOffset.value = {
        x: event.clientX - panelPosition.value.x,
        y: event.clientY - panelPosition.value.y
      }

      document.addEventListener('mousemove', onDrag)
      document.addEventListener('mouseup', stopDrag)
      event.preventDefault()
    }

    // 拖动中
    const onDrag = (event) => {
      if (!isDragging.value) return

      const newX = event.clientX - dragOffset.value.x
      const newY = event.clientY - dragOffset.value.y

      // 获取面板的实际大小
      let actualWidth = panelSize.value.width
      let actualHeight = panelSize.value.height

      if (panelContainer.value) {
        const rect = panelContainer.value.getBoundingClientRect()
        actualWidth = rect.width
        actualHeight = rect.height
      }

      // 限制在窗口范围内
      const maxX = window.innerWidth - actualWidth
      const maxY = window.innerHeight - actualHeight

      panelPosition.value = {
        x: Math.max(0, Math.min(maxX, newX)),
        y: Math.max(0, Math.min(maxY, newY))
      }
    }

    // 停止拖动
    const stopDrag = () => {
      isDragging.value = false
      document.removeEventListener('mousemove', onDrag)
      document.removeEventListener('mouseup', stopDrag)
    }

    // 最大化/还原
    const toggleMaximize = () => {
      if (isMaximized.value) {
        // 还原
        isMaximized.value = false
        panelPosition.value = { ...originalPosition.value }
        panelSize.value = { ...originalSize.value }
      } else {
        // 最大化
        originalPosition.value = { ...panelPosition.value }
        originalSize.value = { ...panelSize.value }
        isMaximized.value = true
      }
      isMinimized.value = false
    }

    // 最小化
    const minimizePanel = () => {
      if (!isMinimized.value) {
        // 保存当前位置和大小
        originalPosition.value = { ...panelPosition.value }
        originalSize.value = { ...panelSize.value }

        // 设置最小化默认位置到右下角
        panelPosition.value = {
          x: window.innerWidth - 600 ,  // 600px宽度 + 20px边距
          y: window.innerHeight - 280 - 120  // 280px高度 + 20px边距
        }

        isMinimized.value = true
      } else {
        // 还原时恢复原位置
        panelPosition.value = { ...originalPosition.value }
        panelSize.value = { ...originalSize.value }
        isMinimized.value = false
      }
      isMaximized.value = false
    }

    // 关闭面板
    const closePanel = () => {
      emit('close')
    }

    // 格式化百分比
    const formatPercentage = (value) => {
      if (typeof value !== 'number') return '0%'
      return `${Math.round(value)}%`
    }

    // 格式化字节
    const formatBytes = (bytes) => {
      try {
        // 处理无效值
        if (bytes === undefined || bytes === null || isNaN(bytes) || bytes < 0 || !isFinite(bytes)) {
          return '0 B'
        }
        if (bytes === 0) return '0 B'

        const k = 1024
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB']

        // 防止 Math.log 出现问题
        if (bytes <= 0) return '0 B'

        const i = Math.floor(Math.log(bytes) / Math.log(k))

        // 确保索引在有效范围内
        const sizeIndex = Math.max(0, Math.min(i, sizes.length - 1))
        const value = bytes / Math.pow(k, sizeIndex)

        // 确保计算结果是有效数值
        if (!isFinite(value) || isNaN(value)) {
          return '0 B'
        }

        const formattedValue = parseFloat(value.toFixed(2))
        const unit = sizes[sizeIndex]

        // 最终验证
        if (!isFinite(formattedValue) || isNaN(formattedValue) || !unit) {
          return '0 B'
        }

        return formattedValue + ' ' + unit
      } catch (error) {
        console.warn('formatBytes 错误:', error, 'bytes:', bytes)
        return '0 B'
      }
    }

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
      }
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

    // 格式化运行时间
    const formatUptime = (seconds) => {
      if (!seconds) return 'Unknown'
      const days = Math.floor(seconds / 86400)
      const hours = Math.floor((seconds % 86400) / 3600)
      const minutes = Math.floor((seconds % 3600) / 60)
      return `${days}天 ${hours}小时 ${minutes}分钟`
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

    // 生成图例配置（需要Chart实例）
    const createLegendConfig = (ChartClass) => ({
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
          const original = ChartClass.defaults.plugins.legend.labels.generateLabels;
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

    const chartError = ref(null);
    const isLoading = ref(false);
    const retryCount = ref(0);
    const maxRetries = 3;

    // 错误处理函数
    const handleChartError = (error, chartName) => {
      console.error(`Chart error in ${chartName}:`, error);
      chartError.value = `${chartName} 图表加载失败`;

      if (retryCount.value < maxRetries) {
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

    // ==================== 主题监听和更新 ====================

    // 存储图表实例
    const chartInstances = ref({
      cpu: null,
      memory: null,
      disk: null,
      network: null
    });

    // 更新图表主题
    const updateChartsTheme = debounce(() => {
      Object.values(chartInstances.value).forEach(chart => {
        if (chart) {
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
        }
      });
    }, 100);

    // 监听主题变化
    const themeObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' &&
            (mutation.attributeName === 'class' || mutation.attributeName === 'data-theme')) {
          updateChartsTheme();
        }
      });
    });

    // 监听系统主题变化
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = (e) => {
      updateChartsTheme();
    };

    // ==================== 图表初始化 ====================

    // 初始化图表
    const initCharts = async () => {
      if (isLoading.value) return;

      isLoading.value = true;
      resetError();

      try {
        // 首先从全局监控服务加载历史数据
        loadHistoryDataFromService();

        await nextTick()

        if (!cpuChart.value || !memoryChart.value || !diskChart.value || !networkChart.value) {
          throw new Error('图表容器未找到');
        }

        // 先销毁现有图表
        destroyCharts();

        // 动态导入Chart.js
        const { Chart, registerables } = await import('chart.js')
        Chart.register(...registerables)

        // 基础图表配置
        const chartOptions = {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            intersect: false,
            mode: 'index'
          },
          animation: {
            duration: CHART_CONSTANTS.ANIMATION.DURATION,
            easing: CHART_CONSTANTS.ANIMATION.EASING,
            // 数据更新时的动画配置
            onComplete: null,
            onProgress: null
          },
          // 数据更新时的过渡动画
          transitions: {
            active: {
              animation: {
                duration: 900,              // 增加到0.9秒，更慢更丝滑
                easing: 'easeInOutSine'     // 使用最柔和的缓动函数
              }
            },
            resize: {
              animation: {
                duration: 0
              }
            },
            show: {
              animations: {
                x: {
                  from: 0,
                  duration: 1200,          // 增加到1.2秒
                  easing: 'easeOutSine'    // 更柔和的入场动画
                },
                y: {
                  from: 0,
                  duration: 1200,
                  easing: 'easeOutSine'
                }
              }
            },
            hide: {
              animations: {
                x: {
                  to: 0,
                  duration: 600,           // 增加到0.6秒
                  easing: 'easeInSine'     // 更柔和的退场动画
                },
                y: {
                  to: 0,
                  duration: 600,
                  easing: 'easeInSine'
                }
              }
            }
          },
          elements: {
            line: {
              tension: 0.4, // 平滑曲线插值，0为直线，1为最大弯曲
              borderWidth: 2,
              borderCapStyle: 'round',
              borderJoinStyle: 'round'
            },
            point: {
              radius: 0, // 隐藏数据点
              hoverRadius: 4, // 悬停时显示数据点
              hoverBorderWidth: 2,
              hitRadius: 8 // 增大点击区域
            }
          },
          plugins: {
            legend: createLegendConfig(Chart),
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
            displayColors: false,
            titleFont: {
              size: 12,
              weight: 'bold'
            },
            bodyFont: {
              size: 11
            },
            padding: 8,
            callbacks: {
              title: function(context) {
                const dataIndex = context[0].dataIndex;
                const totalPoints = context[0].dataset.data.length;
                const timeAgo = totalPoints - dataIndex - 1;

                // 计算具体时间
                const now = new Date();
                const targetTime = new Date(now.getTime() - timeAgo * 1000);

                // 格式化为 HH:MM:SS
                const hours = targetTime.getHours().toString().padStart(2, '0');
                const minutes = targetTime.getMinutes().toString().padStart(2, '0');
                const seconds = targetTime.getSeconds().toString().padStart(2, '0');

                return `${hours}:${minutes}:${seconds}`;
              },
              label: function(context) {
                const value = context.parsed.y;
                return `使用率: ${value.toFixed(1)}%`;
              }
            }
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
      }

      const networkChartOptions = {
        ...chartOptions,
        scales: {
          x: {
            display: true,
            grid: {
              display: true,
              color: getThemeColor('rgba(0, 0, 0, 0.1)', 'rgba(255, 255, 255, 0.1)'),
              lineWidth: 1
            },
            ticks: {
              display: true,
              color: getThemeColor('rgba(0, 0, 0, 0.6)', 'rgba(255, 255, 255, 0.6)'),
              font: {
                size: 9
              },
              maxTicksLimit: 6,
              callback: function(value, index, values) {
                const totalPoints = values.length;
                const timeAgo = totalPoints - index - 1;
                const now = new Date();
                const targetTime = new Date(now.getTime() - timeAgo * 1000);
                const minutes = targetTime.getMinutes().toString().padStart(2, '0');
                const seconds = targetTime.getSeconds().toString().padStart(2, '0');

                if (timeAgo === 0) {
                  return `${minutes}:${seconds}`;
                } else if (timeAgo <= 5) {
                  return `${minutes}:${seconds}`;
                } else if (timeAgo <= 10) {
                  return `${minutes}:${seconds}`;
                } else if (timeAgo <= 15) {
                  return `${minutes}:${seconds}`;
                } else {
                  return `${minutes}:${seconds}`;
                }
              }
            },
            border: {
              display: true,
              color: getThemeColor('rgba(0, 0, 0, 0.2)', 'rgba(255, 255, 255, 0.2)')
            }
          },
          y: {
            display: true,
            min: 0,
            // 移除固定的max值，让Chart.js根据数据自动调整
            beginAtZero: true,
            grid: {
              display: true,
              color: getThemeColor('rgba(0, 0, 0, 0.1)', 'rgba(255, 255, 255, 0.1)'),
              lineWidth: 1
            },
            ticks: {
              display: true,
              color: getThemeColor('rgba(0, 0, 0, 0.6)', 'rgba(255, 255, 255, 0.6)'),
              font: {
                size: 10
              },
              callback: function(value) {
                try {
                  // 确保 value 是有效数值
                  const numValue = Number(value)
                  if (isNaN(numValue) || numValue < 0 || !isFinite(numValue)) {
                    return '0 B/s'
                  }

                  // 对于非常小的值，直接返回0
                  if (numValue < 0.01) {
                    return '0 B/s'
                  }

                  const formatted = formatBytes(numValue)
                  // 再次验证格式化结果
                  if (!formatted || formatted.includes('undefined') || formatted.includes('NaN')) {
                    return '0 B/s'
                  }

                  return formatted + '/s';
                } catch (error) {
                  console.warn('Y轴格式化错误:', error, 'value:', value)
                  return '0 B/s'
                }
              }
            },
            border: {
              display: true,
              color: getThemeColor('rgba(0, 0, 0, 0.2)', 'rgba(255, 255, 255, 0.2)')
            }
          }
        },
        plugins: {
          ...chartOptions.plugins,
          tooltip: {
            ...chartOptions.plugins.tooltip,
            callbacks: {
              title: function(context) {
                const dataIndex = context[0].dataIndex;
                const totalPoints = context[0].dataset.data.length;
                const timeAgo = totalPoints - dataIndex - 1;

                // 计算具体时间
                const now = new Date();
                const targetTime = new Date(now.getTime() - timeAgo * 1000);

                // 格式化为 HH:MM:SS
                const hours = targetTime.getHours().toString().padStart(2, '0');
                const minutes = targetTime.getMinutes().toString().padStart(2, '0');
                const seconds = targetTime.getSeconds().toString().padStart(2, '0');

                return `${hours}:${minutes}:${seconds}`;
              },
              label: function(context) {
                const value = context.parsed.y;
                const datasetLabel = context.dataset.label;
                return `${datasetLabel}: ${formatBytes(value)}/s`;
              }
            }
          }
        }
      }

      // CPU图表配置
      const cpuChartOptions = {
        ...chartOptions,
        plugins: {
          ...chartOptions.plugins,
          tooltip: {
            ...chartOptions.plugins.tooltip,
            callbacks: {
              ...chartOptions.plugins.tooltip.callbacks,
              label: function(context) {
                const value = context.parsed.y;
                // 获取当前最新的监控数据
                const currentData = props.monitoringData?.cpu || {};
                const cores = currentData.cores || 1;
                return [
                  `CPU使用率: ${value.toFixed(1)}%`,
                  `CPU核心数: ${cores}个`
                ];
              }
            }
          }
        }
      };

      // 历史数据已经在 loadHistoryDataFromService 中初始化，无需再次初始化

      // CPU图表
      const cpuColor = getRandomColor()
      cpuChartInstance = new Chart(cpuChart.value, {
        type: 'line',
        data: {
          labels: Array(20).fill(''),
          datasets: [{
            label: 'CPU使用率',
            data: historyData.value.cpu,
            borderColor: cpuColor,
            backgroundColor: cpuColor + '20',
            fill: true,
            tension: 0.4, // 平滑曲线
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHitRadius: 8,
            borderCapStyle: 'round',
            borderJoinStyle: 'round'
          }]
        },
        options: cpuChartOptions
      })
      chartInstances.value.cpu = cpuChartInstance;

      // 内存图表配置
      const memoryChartOptions = {
        ...chartOptions,
        plugins: {
          ...chartOptions.plugins,
          tooltip: {
            ...chartOptions.plugins.tooltip,
            callbacks: {
              ...chartOptions.plugins.tooltip.callbacks,
              label: function(context) {
                const value = context.parsed.y;
                // 获取当前最新的监控数据
                const currentData = props.monitoringData?.memory || {};
                const total = currentData.total || 0;
                const used = currentData.used || 0;
                const available = currentData.available || 0;
                return [
                  `内存使用率: ${value.toFixed(1)}%`,
                  `已使用: ${formatBytes(used * 1024 * 1024)}`,
                  `可用: ${formatBytes(available * 1024 * 1024)}`,
                  `总计: ${formatBytes(total * 1024 * 1024)}`
                ];
              }
            }
          }
        }
      };

      // 内存图表
      const memoryColor = getRandomColor()
      memoryChartInstance = new Chart(memoryChart.value, {
        type: 'line',
        data: {
          labels: Array(20).fill(''),
          datasets: [{
            label: '内存使用率',
            data: historyData.value.memory,
            borderColor: memoryColor,
            backgroundColor: memoryColor + '20',
            fill: true,
            tension: 0.4, // 平滑曲线
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHitRadius: 8,
            borderCapStyle: 'round',
            borderJoinStyle: 'round'
          }]
        },
        options: memoryChartOptions
      })
      chartInstances.value.memory = memoryChartInstance;

      // 磁盘图表配置
      const diskChartOptions = {
        ...chartOptions,
        plugins: {
          ...chartOptions.plugins,
          tooltip: {
            ...chartOptions.plugins.tooltip,
            callbacks: {
              ...chartOptions.plugins.tooltip.callbacks,
              label: function(context) {
                const value = context.parsed.y;
                // 获取当前最新的监控数据
                const currentData = props.monitoringData?.disk || {};
                const total = currentData.total || 0;
                const used = currentData.used || 0;
                const available = currentData.available || 0;
                return [
                  `磁盘使用率: ${value.toFixed(1)}%`,
                  `已使用: ${formatBytes(used * 1024 * 1024 * 1024)}`,
                  `可用: ${formatBytes(available * 1024 * 1024 * 1024)}`,
                  `总计: ${formatBytes(total * 1024 * 1024 * 1024)}`
                ];
              }
            }
          }
        }
      };

      // 硬盘图表
      const diskColor = getRandomColor()
      diskChartInstance = new Chart(diskChart.value, {
        type: 'line',
        data: {
          labels: Array(20).fill(''),
          datasets: [{
            label: '磁盘使用率',
            data: historyData.value.disk,
            borderColor: diskColor,
            backgroundColor: diskColor + '20',
            fill: true,
            tension: 0.4, // 平滑曲线
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHitRadius: 8,
            borderCapStyle: 'round',
            borderJoinStyle: 'round'
          }]
        },
        options: diskChartOptions
      })
      chartInstances.value.disk = diskChartInstance;

      // 网络图表
      let uploadColor = getRandomColor()
      let downloadColor = getRandomColor()
      // 确保两条线颜色不同
      while (uploadColor === downloadColor) {
        downloadColor = getRandomColor()
      }

      // 网络历史数据已经在 loadHistoryDataFromService 中初始化

      networkChartInstance = new Chart(networkChart.value, {
        type: 'line',
        data: {
          labels: Array(20).fill(''),
          datasets: [{
            label: '上传',
            data: historyData.value.network.upload,
            borderColor: uploadColor,
            backgroundColor: uploadColor + '20',
            fill: false,
            tension: 0.4, // 平滑曲线
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHitRadius: 8,
            borderCapStyle: 'round',
            borderJoinStyle: 'round'
          }, {
            label: '下载',
            data: historyData.value.network.download,
            borderColor: downloadColor,
            backgroundColor: downloadColor + '20',
            fill: false,
            tension: 0.4, // 平滑曲线
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHitRadius: 8,
            borderCapStyle: 'round',
            borderJoinStyle: 'round'
          }]
        },
        options: {
          ...networkChartOptions,
          plugins: {
            ...networkChartOptions.plugins,
            legend: {
              display: true,
              position: 'top',
              labels: {
                usePointStyle: true,
                pointStyle: 'line',
                font: {
                  size: 11
                }
              }
            }
          }
        }
      })
      chartInstances.value.network = networkChartInstance;

      isLoading.value = false;

    } catch (error) {
      isLoading.value = false;
      handleChartError(error, '系统');
    }
  }

    // 平滑更新图表数据
    const updateCharts = throttle(() => {
      if (!props.monitoringData) return

      const data = props.monitoringData

      // 从全局监控服务获取最新的历史数据（历史数据由全局服务维护）
      loadHistoryDataFromService();

      // 使用requestAnimationFrame确保平滑更新
      requestAnimationFrame(() => {
        updateChartWithAnimation(cpuChartInstance, historyData.value.cpu.slice(), 0);
        updateChartWithAnimation(memoryChartInstance, historyData.value.memory.slice(), 0);
        updateChartWithAnimation(diskChartInstance, historyData.value.disk.slice(), 0);

        // 网络图表有两个数据集
        if (networkChartInstance) {
          updateNetworkChartWithAnimation(networkChartInstance,
            historyData.value.network.upload.slice(),
            historyData.value.network.download.slice()
          );
        }
      });
    }, 200); // 200ms节流，配合更慢的动画，让数据更新更从容

    // 单个图表的平滑更新函数
    const updateChartWithAnimation = (chartInstance, newData, datasetIndex = 0) => {
      if (!chartInstance) return;

      const dataset = chartInstance.data.datasets[datasetIndex];
      const oldData = [...dataset.data];

      // 检查是否有新数据点
      if (newData.length > oldData.length) {
        // 新增数据点 - 使用更慢的滑入动画
        dataset.data = newData;
        chartInstance.update({
          duration: 1200,              // 增加到1.2秒，更慢更优雅
          easing: 'easeInOutSine',     // 使用更柔和的缓动函数
          lazy: false
        });
      } else if (newData.length === oldData.length && newData[newData.length - 1] !== oldData[oldData.length - 1]) {
        // 数据更新 - 使用更慢的平滑过渡
        dataset.data = newData;
        chartInstance.update({
          duration: 900,               // 增加到0.9秒
          easing: 'easeInOutSine',     // 更柔和的缓动
          lazy: false
        });
      } else {
        // 数据滑动（移除旧数据，添加新数据）- 使用更慢的滑动效果
        dataset.data = newData;
        chartInstance.update({
          duration: 700,               // 增加到0.7秒
          easing: 'easeInOutSine',     // 最柔和的缓动函数
          lazy: false
        });
      }
    }

    // 网络图表的平滑更新函数（双数据集）
    const updateNetworkChartWithAnimation = (chartInstance, uploadData, downloadData) => {
      if (!chartInstance) return;

      const uploadDataset = chartInstance.data.datasets[0];
      const downloadDataset = chartInstance.data.datasets[1];

      // 更新两个数据集
      uploadDataset.data = uploadData;
      downloadDataset.data = downloadData;

      // 使用更慢更协调的动画更新两条线
      chartInstance.update({
        duration: 800,                // 增加到0.8秒，更慢更丝滑
        easing: 'easeInOutSine',      // 使用最柔和的缓动函数
        lazy: false
      });
    }

    // 销毁图表
    const destroyCharts = () => {
      if (cpuChartInstance) {
        cpuChartInstance.destroy()
        cpuChartInstance = null
      }
      if (memoryChartInstance) {
        memoryChartInstance.destroy()
        memoryChartInstance = null
      }
      if (diskChartInstance) {
        diskChartInstance.destroy()
        diskChartInstance = null
      }
      if (networkChartInstance) {
        networkChartInstance.destroy()
        networkChartInstance = null
      }

      // 清空chartInstances
      chartInstances.value = {
        cpu: null,
        memory: null,
        disk: null,
        network: null
      };
    }

    // 监听面板显示状态
    watch(() => props.visible, async (newVal) => {
      if (newVal) {
        initPanelPosition()
        await nextTick()
        await initCharts()
      } else {
        destroyCharts()
      }
    })

    // 监听监控数据变化
    watch(() => props.monitoringData, updateCharts, { deep: true })

    // 组件挂载时初始化
    onMounted(() => {
      nextTick(() => {
        initPanelPosition()
        initResizeObserver()
      })
    })

    // 组件卸载时清理
    onUnmounted(() => {
      destroyCharts()
      cleanupResizeObserver()
    })

    return {
      cpuChart,
      memoryChart,
      diskChart,
      networkChart,
      panelContainer,
      panelStyle,
      isMaximized,
      isMinimized,
      startDrag,
      toggleMaximize,
      minimizePanel,
      closePanel,
      formatPercentage,
      formatBytes,
      formatUptime,
      formatDateTime,
      loadHistoryDataFromService
    }
  }
}
</script>

<style scoped>
/* 过渡动画 */
.panel-fade-enter-active,
.panel-fade-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.panel-fade-enter-from .panel-container {
  transform: scale(0.9) translateY(20px);
  opacity: 0;
}

.panel-fade-leave-to .panel-container {
  transform: scale(0.95) translateY(-10px);
  opacity: 0;
}

.monitoring-detail-panel {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9999;
  pointer-events: none;
}

/* 响应式设计 */
@media (max-width: 1200px) {
  .panel-container {
    max-width: 900px;
  }

  .charts-grid {
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 14px;
  }
}

@media (max-width: 900px) {
  .panel-container {
    max-width: 700px;
  }

  .charts-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }
}



.panel-container {
  background: var(--color-bg-container);
  border-radius: 8px;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
  transform: scale(1);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  pointer-events: auto;
  min-width: 600px;
  min-height: 400px;
  resize: both;
  min-width: 600px;
  min-height: 400px;
  /* 设置初始大小 */
  width: 1000px;
  height: 600px;
}

/* 主题适配通过CSS变量自动处理 */

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
  min-height: 48px;
}

.draggable-header {
  cursor: move;
  user-select: none;
}

.draggable-header:active {
  cursor: grabbing;
}

/* 主题适配通过CSS变量自动处理 */

.header-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.panel-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  font-family: var(--font-family-base);
  color: var(--color-text);
  display: flex;
  align-items: center;
  gap: 8px;
}

.panel-title i {
  color: var(--primary-color);
}

.server-info {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  font-family: var(--font-family-base);
}

.server-name {
  color: var(--color-text);
  font-weight: 500;
  font-family: var(--font-family-base);
}

.server-address {
  color: var(--color-text-secondary);
  font-family: var(--font-family-base);
}

.header-controls {
  display: flex;
  align-items: center;
  gap: 4px;
}

.control-btn {
  background: var(--color-bg-hover);
  border: 1px solid var(--color-border);
  color: var(--color-text);
  cursor: pointer;
  padding: 6px;
  border-radius: 4px;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  font-size: 12px;
  font-family: var(--font-family-base);
  opacity: 0.8;
}

/* 为每个按键添加默认的颜色提示 - 使用主题变量 */
.minimize-btn {
  background: var(--color-warning-bg);
  border-color: var(--color-warning);
  color: var(--color-warning);
}

.maximize-btn {
  background: var(--color-success-bg);
  border-color: var(--color-success);
  color: var(--color-success);
}

.close-btn {
  background: var(--color-error-bg);
  border-color: var(--color-error);
  color: var(--color-error);
}

.control-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text);
  opacity: 1;
  transform: scale(1.05);
}

.minimize-btn:hover {
  background: var(--color-warning);
  color: white;
  border-color: var(--color-warning);
  opacity: 1;
  transform: scale(1.05);
}

.maximize-btn:hover {
  background: var(--color-success);
  color: white;
  border-color: var(--color-success);
  opacity: 1;
  transform: scale(1.05);
}

.close-btn:hover {
  background: var(--color-error);
  color: white;
  border-color: var(--color-error);
  opacity: 1;
  transform: scale(1.05);
}

/* 最小化状态样式 - 使用正常布局 */

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
  align-items: flex-start;
  gap: 18px;
  margin-bottom: 18px;
  flex-wrap: wrap;
}

/* 当容器宽度不足时，自动换行 */
.panel-container[style*="width"] .top-section {
  flex-wrap: wrap;
}

.panel-container[style*="width"] .top-section .system-info {
  min-width: 400px;
  flex: 1 1 400px;
}

.panel-container[style*="width"] .top-section .network-chart-container {
  flex: 1 1 300px;
  max-width: 450px;
}

.system-info {
  flex: 1;
  min-width: 350px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 16px;
}

.info-line {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  margin-bottom: 16px;
  align-items: flex-start;
}

.info-line:last-child {
  margin-bottom: 4px;
}

.info-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 95px;
}

.info-item .label {
  font-size: 11px;
  color: var(--color-text-secondary);
  font-weight: 400;
  font-family: var(--font-family-base);
  margin-bottom: 1px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.info-item .value {
  font-size: 13px;
  color: var(--color-text);
  font-family: var(--font-family-base);
  font-weight: 500;
  line-height: 1.2;
}

.network-chart-container {
  width: 450px;
  flex-shrink: 1;
  min-width: 300px;
}

.network-chart {
  height: auto;
  min-height: 200px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 16px;
}

.network-chart .chart-container {
  background: var(--color-bg-elevated);
  border: none;
  height: 180px;
  border-radius: 4px;
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

.chart-container {
  height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-elevated);
  border-radius: 4px;
  border: 1px solid var(--color-border);
}

/* 响应式设计 */
/* 中等屏幕 - 当面板宽度不足时图表换行 */
@media (max-width: 900px) {
  .top-section {
    flex-direction: column;
    gap: 16px;
  }

  .network-chart-container {
    width: 100%;
    min-width: unset;
  }

  .system-info {
    min-width: unset;
  }
}

/* 小屏幕优化 */
@media (max-width: 768px) {
  .network-chart-container {
    width: 100%;
  }

  .info-line {
    flex-direction: column;
    gap: 12px;
    align-items: flex-start;
  }

  .info-item {
    min-width: auto;
    width: 100%;
  }

  .charts-grid {
    grid-template-columns: 1fr;
  }

  .panel-content {
    padding: 16px;
    gap: 16px;
  }

  .bottom-charts-section {
    padding: 16px;
  }
}

@media (max-width: 480px) {
  .info-line {
    gap: 16px;
  }

  .info-item {
    min-width: auto;
    width: 100%;
  }

  .info-item .value {
    text-align: left;
  }

  .info-item.cpu-info .value {
    font-size: 12px;
  }
}

/* 响应式设计 */
@media (max-width: 768px) {
  .panel-container {
    min-width: 320px !important;
    min-height: 300px !important;
  }

  .panel-container:not(.minimized) {
    width: calc(100vw - 20px) !important;
    height: calc(100vh - 20px) !important;
    top: 10px !important;
    left: 10px !important;
  }

  .charts-grid {
    grid-template-columns: 1fr;
  }

  .details-grid {
    grid-template-columns: 1fr;
  }

  .panel-content {
    padding: 16px;
  }

  .draggable-header {
    cursor: default;
  }
}
</style>
