<template>
  <div class="monitor-section network-monitoring-section">
    <div class="monitor-header">
      <div class="monitor-title">
        <MonitoringIcon name="network" :size="16" class="network-icon" />
        <span>网络</span>
      </div>
      <div class="monitor-info">
        <div class="network-speed-info" v-if="hasData">
          <div class="speed-indicator upload">
            <span class="speed-icon">↑</span>
            <span class="speed-value">{{ formatNetworkSpeed(currentSpeed.upload) }}</span>
          </div>
          <div class="speed-indicator download">
            <span class="speed-icon">↓</span>
            <span class="speed-value">{{ formatNetworkSpeed(currentSpeed.download) }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="monitor-chart-container">
      <canvas ref="networkChartRef" class="network-chart"></canvas>
      <div v-if="!hasData" class="monitor-no-data">
        <MonitoringIcon name="loading" :size="16" class="loading-icon" />
        <span>等待网络数据...</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, computed, nextTick, markRaw } from 'vue'
import { Chart, registerables } from 'chart.js'
import { formatBytes, formatNetworkSpeed } from '@/utils/productionFormatters'
import { getNetworkChartConfig, limitDataPoints } from '@/utils/chartConfig'
import MonitoringIcon from './MonitoringIcon.vue'

// 注册Chart.js组件
Chart.register(...registerables)

// Props
const props = defineProps({
  monitoringData: {
    type: Object,
    default: () => ({})
  }
})

// 响应式数据
const networkChartRef = ref(null)
const chartInstance = ref(null)
const historyData = ref({
  upload: [],
  download: []
})
const maxDataPoints = 10 // 限制为10个数据点，符合现代极简设计

// 计算属性
const currentSpeed = computed(() => {
  const network = props.monitoringData?.network || {}

  // 服务器返回的是 KB/s，需要转换为 B/s
  const txSpeedKB = parseFloat(network.total_tx_speed) || 0
  const rxSpeedKB = parseFloat(network.total_rx_speed) || 0

  return {
    upload: txSpeedKB * 1024,   // 转换为 B/s
    download: rxSpeedKB * 1024  // 转换为 B/s
  }
})

const totalTraffic = computed(() => {
  const network = props.monitoringData?.network || {}
  return {
    upload: parseFloat(network.total_tx_bytes) || 0,
    download: parseFloat(network.total_rx_bytes) || 0
  }
})

const hasData = computed(() => {
  return currentSpeed.value.upload > 0 || currentSpeed.value.download > 0 ||
         historyData.value.upload.length > 0 || historyData.value.download.length > 0
})

// 网络监控组件已导入格式化函数，无需重复定义

// 初始化图表
const initChart = async () => {
  await nextTick()

  if (!networkChartRef.value) return

  const ctx = networkChartRef.value.getContext('2d')

  // 销毁现有图表
  if (chartInstance.value) {
    chartInstance.value.destroy()
  }

  // 使用新的配置工具创建网络图表
  const config = getNetworkChartConfig()
  chartInstance.value = markRaw(new Chart(ctx, config))

  // 简单确保数据点隐藏（transition配置会处理动画时的隐藏）
  nextTick(() => {
    if (chartInstance.value && chartInstance.value.data.datasets) {
      chartInstance.value.data.datasets.forEach(dataset => {
        dataset.pointRadius = 0
        dataset.pointHoverRadius = 3
      })
      chartInstance.value.update('none')
    }
  })
}

// 更新图表数据
const updateChart = () => {
  if (!chartInstance.value) return

  try {
    // 检查图表实例是否有效
    if (!chartInstance.value.data || !chartInstance.value.data.datasets || chartInstance.value.data.datasets.length < 2) {
      console.warn('[网络监控] 图表数据结构无效')
      return
    }

    const now = new Date()
    const timeLabel = now.toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })

    // 添加新数据点
    historyData.value.upload.push({
      time: timeLabel,
      value: currentSpeed.value.upload,
      timestamp: now.getTime()
    })

    historyData.value.download.push({
      time: timeLabel,
      value: currentSpeed.value.download,
      timestamp: now.getTime()
    })

    // 使用工具函数限制数据点数量
    historyData.value.upload = limitDataPoints(historyData.value.upload, maxDataPoints)
    historyData.value.download = limitDataPoints(historyData.value.download, maxDataPoints)

    // 更新图表数据
    chartInstance.value.data.labels = historyData.value.upload.map(item => item.time)
    chartInstance.value.data.datasets[0].data = historyData.value.upload.map(item => item.value)
    chartInstance.value.data.datasets[1].data = historyData.value.download.map(item => item.value)

    // 使用自定义transition模式：既有动画又隐藏数据点
    if (!isAnimating) {
      isAnimating = true
      chartInstance.value.update('dataUpdate')
      // 动画完成后重置标记
      setTimeout(() => {
        isAnimating = false
      }, 400) // 与动画时长一致
    }
  } catch (error) {
    console.error('[网络监控] 更新图表失败:', error)
  }
}

// 监听数据变化
let updateTimer = null
// 动画状态标记，避免动画冲突
let isAnimating = false
watch(() => props.monitoringData, (newData, oldData) => {
  // 防抖处理，避免频繁更新
  if (updateTimer) {
    clearTimeout(updateTimer)
  }

  updateTimer = setTimeout(() => {
    // 检查数据是否真的发生了变化
    if (chartInstance.value && newData !== oldData) {
      try {
        updateChart()
      } catch (error) {
        console.error('[网络监控] 更新图表失败:', error)
      }
    }
    updateTimer = null
  }, 100) // 100ms防抖
}, { deep: true })

// 生命周期
onMounted(() => {
  initChart()

  // 添加一个初始数据点来确保图表显示
  setTimeout(() => {
    if (chartInstance.value) {
      updateChart()
    }
  }, 1000)
})

onUnmounted(() => {
  if (updateTimer) {
    clearTimeout(updateTimer)
    updateTimer = null
  }
  if (chartInstance.value) {
    chartInstance.value.destroy()
  }
})
</script>

<style scoped>
/* 导入监控主题样式 */
@import '@/assets/styles/themes/monitoring-theme.css';

/* 网络监控组件继承通用监控组件样式 */

.network-icon {
  color: var(--monitor-info);
}

.network-speed-info {
  display: flex;
  flex-direction: column;
  /* gap: var(--monitor-spacing-xs); */
}

.speed-indicator {
  display: flex;
  align-items: center;
  gap: var(--monitor-spacing-xs);
  padding: var(--monitor-spacing-xs);
  background: var(--monitor-bg-secondary);
  border-radius: var(--monitor-radius-sm);
  font-size: 11px;
}

.speed-indicator.upload .speed-icon {
  color: var(--monitor-network-upload);
}

.speed-indicator.download .speed-icon {
  color: var(--monitor-network-download);
}

.speed-value {
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  font-weight: 500;
  color: var(--monitor-text-primary);
}

.network-chart {
  width: 100%;
  height: var(--monitor-chart-height-md);
}

/* 响应式适配 */
@media (max-width: 768px) {
  .speed-indicator {
    font-size: 10px;
  }
}

@media (max-width: 480px) {
  .network-chart {
    height: var(--monitor-chart-height-xs);
  }
}
</style>
