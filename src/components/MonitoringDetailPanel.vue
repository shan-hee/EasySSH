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
            <div class="server-info" v-if="serverInfo">
              <span class="server-name">{{ serverInfo.hostname || serverInfo.address }}</span>
              <span class="server-address">{{ serverInfo.address }}</span>
            </div>
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
        <!-- 统计图表区域 -->
        <div class="charts-grid">
          <!-- CPU使用率图表 -->
          <div class="chart-card">
            <div class="chart-header">
              <h4><i class="fas fa-microchip"></i> CPU使用率</h4>
              <span class="chart-value">{{ formatPercentage(monitoringData?.cpu?.usage) }}</span>
            </div>
            <div class="chart-container">
              <canvas ref="cpuChart" width="300" height="120"></canvas>
            </div>
          </div>

          <!-- 内存使用率图表 -->
          <div class="chart-card">
            <div class="chart-header">
              <h4><i class="fas fa-memory"></i> 内存使用率</h4>
              <span class="chart-value">{{ formatPercentage(monitoringData?.memory?.usage) }}</span>
            </div>
            <div class="chart-container">
              <canvas ref="memoryChart" width="300" height="120"></canvas>
            </div>
          </div>

          <!-- 硬盘使用率图表 -->
          <div class="chart-card">
            <div class="chart-header">
              <h4><i class="fas fa-hdd"></i> 硬盘使用率</h4>
              <span class="chart-value">{{ formatPercentage(monitoringData?.disk?.usage) }}</span>
            </div>
            <div class="chart-container">
              <canvas ref="diskChart" width="300" height="120"></canvas>
            </div>
          </div>

          <!-- 网络流量图表 -->
          <div class="chart-card">
            <div class="chart-header">
              <h4><i class="fas fa-network-wired"></i> 网络流量</h4>
              <span class="chart-value">
                ↑{{ formatBytes(monitoringData?.network?.upload) }}/s
                ↓{{ formatBytes(monitoringData?.network?.download) }}/s
              </span>
            </div>
            <div class="chart-container">
              <canvas ref="networkChart" width="300" height="120"></canvas>
            </div>
          </div>
        </div>

        <!-- 详细信息区域 -->
        <div class="details-section">
          <h4><i class="fas fa-info-circle"></i> 详细信息</h4>
          <div class="details-grid">
            <!-- 系统信息 -->
            <div class="detail-group">
              <h5>系统信息</h5>
              <div class="detail-items">
                <div class="detail-item">
                  <span class="label">操作系统:</span>
                  <span class="value">{{ monitoringData?.system?.os || 'Unknown' }}</span>
                </div>
                <div class="detail-item">
                  <span class="label">主机名:</span>
                  <span class="value">{{ monitoringData?.system?.hostname || 'Unknown' }}</span>
                </div>
                <div class="detail-item">
                  <span class="label">运行时间:</span>
                  <span class="value">{{ formatUptime(monitoringData?.system?.uptime) }}</span>
                </div>
                <div class="detail-item">
                  <span class="label">CPU核心数:</span>
                  <span class="value">{{ monitoringData?.cpu?.cores || 'Unknown' }}</span>
                </div>
              </div>
            </div>

            <!-- 内存信息 -->
            <div class="detail-group">
              <h5>内存信息</h5>
              <div class="detail-items">
                <div class="detail-item">
                  <span class="label">总内存:</span>
                  <span class="value">{{ formatBytes(monitoringData?.memory?.total) }}</span>
                </div>
                <div class="detail-item">
                  <span class="label">已使用:</span>
                  <span class="value">{{ formatBytes(monitoringData?.memory?.used) }}</span>
                </div>
                <div class="detail-item">
                  <span class="label">可用内存:</span>
                  <span class="value">{{ formatBytes(monitoringData?.memory?.available) }}</span>
                </div>
                <div class="detail-item">
                  <span class="label">交换分区:</span>
                  <span class="value">{{ formatBytes(monitoringData?.swap?.total) }}</span>
                </div>
              </div>
            </div>

            <!-- 磁盘信息 -->
            <div class="detail-group">
              <h5>磁盘信息</h5>
              <div class="detail-items">
                <div class="detail-item">
                  <span class="label">总容量:</span>
                  <span class="value">{{ formatBytes(monitoringData?.disk?.total) }}</span>
                </div>
                <div class="detail-item">
                  <span class="label">已使用:</span>
                  <span class="value">{{ formatBytes(monitoringData?.disk?.used) }}</span>
                </div>
                <div class="detail-item">
                  <span class="label">可用空间:</span>
                  <span class="value">{{ formatBytes(monitoringData?.disk?.available) }}</span>
                </div>
                <div class="detail-item">
                  <span class="label">文件系统:</span>
                  <span class="value">{{ monitoringData?.disk?.filesystem || 'Unknown' }}</span>
                </div>
              </div>
            </div>

            <!-- 网络信息 -->
            <div class="detail-group">
              <h5>网络信息</h5>
              <div class="detail-items">
                <div class="detail-item">
                  <span class="label">上传速度:</span>
                  <span class="value">{{ formatBytes(monitoringData?.network?.upload) }}/s</span>
                </div>
                <div class="detail-item">
                  <span class="label">下载速度:</span>
                  <span class="value">{{ formatBytes(monitoringData?.network?.download) }}/s</span>
                </div>
                <div class="detail-item">
                  <span class="label">总上传:</span>
                  <span class="value">{{ formatBytes(monitoringData?.network?.totalUpload) }}</span>
                </div>
                <div class="detail-item">
                  <span class="label">总下载:</span>
                  <span class="value">{{ formatBytes(monitoringData?.network?.totalDownload) }}</span>
                </div>
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
          bottom: '20px',
          right: '20px',
          width: '300px',
          height: '40px',
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

    // 历史数据存储（使用普通对象避免响应式问题）
    const historyData = {
      cpu: [],
      memory: [],
      disk: [],
      network: { upload: [], download: [] }
    }

    // 初始化面板位置（居中显示）
    const initPanelPosition = () => {
      const windowWidth = window.innerWidth
      const windowHeight = window.innerHeight

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
        }
      })

      resizeObserver.observe(panelContainer.value)
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
      if (isMaximized.value || isMinimized.value) return

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
        originalPosition.value = { ...panelPosition.value }
        originalSize.value = { ...panelSize.value }
      }
      isMinimized.value = !isMinimized.value
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
      if (!bytes || bytes === 0) return '0 B'
      const k = 1024
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
      const i = Math.floor(Math.log(bytes) / Math.log(k))
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
    }

    // 格式化运行时间
    const formatUptime = (seconds) => {
      if (!seconds) return 'Unknown'
      const days = Math.floor(seconds / 86400)
      const hours = Math.floor((seconds % 86400) / 3600)
      const minutes = Math.floor((seconds % 3600) / 60)
      return `${days}天 ${hours}小时 ${minutes}分钟`
    }

    // 初始化图表
    const initCharts = async () => {
      await nextTick()

      if (!cpuChart.value || !memoryChart.value || !diskChart.value || !networkChart.value) {
        return
      }

      // 动态导入Chart.js
      const { Chart, registerables } = await import('chart.js')
      Chart.register(...registerables)

      const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          x: {
            display: false
          },
          y: {
            display: false,
            min: 0,
            max: 100
          }
        },
        elements: {
          line: {
            tension: 0.4
          },
          point: {
            radius: 0
          }
        }
      }

      const networkChartOptions = {
        ...chartOptions,
        scales: {
          ...chartOptions.scales,
          y: {
            display: false,
            min: 0
          }
        }
      }

      // CPU图表
      cpuChartInstance = new Chart(cpuChart.value, {
        type: 'line',
        data: {
          labels: Array(20).fill(''),
          datasets: [{
            data: historyData.cpu,
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            fill: true
          }]
        },
        options: chartOptions
      })

      // 内存图表
      memoryChartInstance = new Chart(memoryChart.value, {
        type: 'line',
        data: {
          labels: Array(20).fill(''),
          datasets: [{
            data: historyData.memory,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            fill: true
          }]
        },
        options: chartOptions
      })

      // 硬盘图表
      diskChartInstance = new Chart(diskChart.value, {
        type: 'line',
        data: {
          labels: Array(20).fill(''),
          datasets: [{
            data: historyData.disk,
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
            fill: true
          }]
        },
        options: chartOptions
      })

      // 网络图表
      networkChartInstance = new Chart(networkChart.value, {
        type: 'line',
        data: {
          labels: Array(20).fill(''),
          datasets: [{
            label: '上传',
            data: historyData.network.upload,
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            fill: false
          }, {
            label: '下载',
            data: historyData.network.download,
            borderColor: '#8b5cf6',
            backgroundColor: 'rgba(139, 92, 246, 0.1)',
            fill: false
          }]
        },
        options: {
          ...networkChartOptions,
          plugins: {
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
    }

    // 更新图表数据
    const updateCharts = () => {
      if (!props.monitoringData) return

      const data = props.monitoringData

      // 更新历史数据（使用普通数组避免响应式问题）
      if (data.cpu?.usage !== undefined) {
        const cpuData = historyData.cpu
        cpuData.push(data.cpu.usage)
        if (cpuData.length > 20) {
          cpuData.shift()
        }
      }

      if (data.memory?.usage !== undefined) {
        const memoryData = historyData.memory
        memoryData.push(data.memory.usage)
        if (memoryData.length > 20) {
          memoryData.shift()
        }
      }

      if (data.disk?.usage !== undefined) {
        const diskData = historyData.disk
        diskData.push(data.disk.usage)
        if (diskData.length > 20) {
          diskData.shift()
        }
      }

      if (data.network) {
        const uploadData = historyData.network.upload
        const downloadData = historyData.network.download
        uploadData.push(data.network.upload || 0)
        downloadData.push(data.network.download || 0)
        if (uploadData.length > 20) {
          uploadData.shift()
          downloadData.shift()
        }
      }

      // 更新图表（创建新数组避免响应式引用）
      if (cpuChartInstance) {
        cpuChartInstance.data.datasets[0].data = historyData.cpu.slice()
        cpuChartInstance.update('none')
      }

      if (memoryChartInstance) {
        memoryChartInstance.data.datasets[0].data = historyData.memory.slice()
        memoryChartInstance.update('none')
      }

      if (diskChartInstance) {
        diskChartInstance.data.datasets[0].data = historyData.disk.slice()
        diskChartInstance.update('none')
      }

      if (networkChartInstance) {
        networkChartInstance.data.datasets[0].data = historyData.network.upload.slice()
        networkChartInstance.data.datasets[1].data = historyData.network.download.slice()
        networkChartInstance.update('none')
      }
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
      formatUptime
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
}

.server-name {
  color: var(--color-text);
  font-weight: 500;
}

.server-address {
  color: var(--color-text-secondary);
  font-family: 'Fira Code', monospace;
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

/* 最小化状态样式 */
.panel-container.minimized {
  height: 40px !important;
  width: 300px !important;
}

.panel-container.minimized .panel-content {
  display: none;
}

.panel-container.minimized .panel-header {
  border-bottom: none;
  padding: 8px 12px;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.charts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.chart-card {
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 16px;
  transition: all 0.2s ease;
}

/* 主题适配通过CSS变量自动处理 */

.chart-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.chart-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.chart-header h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
  display: flex;
  align-items: center;
  gap: 6px;
}

.chart-header i {
  color: var(--primary-color);
}

.chart-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-primary);
  font-family: 'Fira Code', monospace;
}

.chart-container {
  height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.details-section {
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 20px;
}

/* 主题适配通过CSS变量自动处理 */

.details-section h4 {
  margin: 0 0 16px 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text);
  display: flex;
  align-items: center;
  gap: 8px;
}

.details-section h4 i {
  color: var(--color-primary);
}

.details-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 24px;
}

.detail-group h5 {
  margin: 0 0 12px 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color);
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color);
}

/* 主题适配通过CSS变量自动处理 */

.detail-items {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
}

.detail-item .label {
  font-size: 13px;
  color: var(--color-text-secondary);
  min-width: 80px;
}

.detail-item .value {
  font-size: 13px;
  color: var(--color-text);
  font-family: 'Fira Code', monospace;
  font-weight: 500;
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
