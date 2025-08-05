<template>
  <div class="network-monitoring-section">
    <div class="section-header">
      <div class="section-title">
        <i class="fas fa-network-wired network-icon"></i>
        <span>网络</span>
      </div>
      <div class="section-info">
        <div class="traffic-info" v-if="totalTraffic.upload || totalTraffic.download">
          <span class="info-text">↑ {{ formatBytes(totalTraffic.upload) }}</span>
          <span class="info-text">↓ {{ formatBytes(totalTraffic.download) }}</span>
        </div>
      </div>
    </div>
    
    <div class="chart-container">
      <canvas ref="networkChartRef" class="network-chart"></canvas>
      <div v-if="!hasData" class="no-data-message">
        <i class="loading-icon">⏳</i>
        <span>等待网络数据...</span>
      </div>
    </div>
    
    <div class="current-speed" v-if="hasData">
      <div class="speed-item upload">
        <span class="speed-label">
          <i class="speed-icon">🔼</i>
          上传
        </span>
        <span class="speed-value">{{ formatNetworkSpeed(currentSpeed.upload) }}</span>
      </div>
      <div class="speed-item download">
        <span class="speed-label">
          <i class="speed-icon">🔽</i>
          下载
        </span>
        <span class="speed-value">{{ formatNetworkSpeed(currentSpeed.download) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, computed, nextTick } from 'vue'
import { Chart, registerables } from 'chart.js'
import { formatBytes, formatNetworkSpeed } from '@/utils/productionFormatters'

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
const maxDataPoints = 50

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
  
  chartInstance.value = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: '上传速度',
          data: [],
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          borderWidth: 2,
          fill: false,
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointBackgroundColor: '#ef4444',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2
        },
        {
          label: '下载速度',
          data: [],
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          borderWidth: 2,
          fill: false,
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointBackgroundColor: '#10b981',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2
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
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          titleColor: '#ffffff',
          bodyColor: '#ffffff',
          borderColor: '#3b82f6',
          borderWidth: 1,
          cornerRadius: 6,
          displayColors: true,
          callbacks: {
            title: () => '网络速度',
            label: (context) => {
              const label = context.dataset.label
              const value = context.parsed.y
              return `${label}: ${formatNetworkSpeed(value)}`
            }
          }
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
          min: 0,
          grid: {
            color: 'rgba(255, 255, 255, 0.1)',
            lineWidth: 1
          },
          ticks: {
            color: 'rgba(255, 255, 255, 0.7)',
            font: {
              size: 11
            },
            callback: (value) => formatNetworkSpeed(value)
          }
        }
      },
      animation: {
        duration: 750,
        easing: 'easeInOutQuart'
      }
    }
  })
}

// 更新图表数据
const updateChart = () => {
  if (!chartInstance.value || !hasData.value) return
  
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
  
  // 保持数据点数量限制
  if (historyData.value.upload.length > maxDataPoints) {
    historyData.value.upload.shift()
    historyData.value.download.shift()
  }
  
  // 更新图表
  chartInstance.value.data.labels = historyData.value.upload.map(item => item.time)
  chartInstance.value.data.datasets[0].data = historyData.value.upload.map(item => item.value)
  chartInstance.value.data.datasets[1].data = historyData.value.download.map(item => item.value)
  
  chartInstance.value.update('none')
}

// 暂时禁用图表更新，避免Chart.js循环引用问题
// 监听数据变化
// let updateTimer = null
// watch(() => props.monitoringData, (newData, oldData) => {
//   // 防抖处理，避免频繁更新
//   if (updateTimer) {
//     clearTimeout(updateTimer)
//   }

//   updateTimer = setTimeout(() => {
//     // 检查数据是否真的发生了变化
//     if (hasData.value && chartInstance.value && newData !== oldData) {
//       try {
//         updateChart()
//       } catch (error) {
//         console.error('[网络监控] 更新图表失败:', error)
//       }
//     }
//     updateTimer = null
//   }, 100) // 100ms防抖
// }, { deep: true })

// 生命周期
onMounted(() => {
  initChart()
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
.network-monitoring-section {
  background: var(--monitoring-panel-bg, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--monitoring-panel-border, rgba(255, 255, 255, 0.1));
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
  transition: all 0.3s ease;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--monitoring-text-primary, #e5e5e5);
}

.network-icon {
  font-size: 16px;
  color: #10b981;
}

.section-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.traffic-info {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.info-text {
  font-size: 10px;
  color: var(--monitoring-text-secondary, #b0b0b0);
  background: var(--monitoring-item-bg, rgba(255, 255, 255, 0.1));
  padding: 2px 5px;
  border-radius: 4px;
}

.chart-container {
  position: relative;
  height: 120px;
  margin-bottom: 12px;
}

.network-chart {
  width: 100% !important;
  height: 100% !important;
}

.no-data-message {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--monitoring-text-secondary, #b0b0b0);
  font-size: 14px;
}

.loading-icon {
  animation: spin 2s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.current-speed {
  display: flex;
  gap: 12px;
}

.speed-item {
  flex: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--monitoring-item-bg, rgba(255, 255, 255, 0.03));
  border-radius: 6px;
  border: 1px solid var(--monitoring-item-border, rgba(255, 255, 255, 0.05));
}

.speed-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--monitoring-text-secondary, #b0b0b0);
  font-weight: 500;
}

.speed-icon {
  font-size: 10px;
}

.speed-value {
  font-size: 11px;
}

.speed-item.upload .speed-value {
  color: #ef4444;
}

.speed-item.download .speed-value {
  color: #10b981;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .chart-container {
    height: 100px;
  }
  
  .section-title {
    font-size: 14px;
  }
  
  .network-icon {
    font-size: 16px;
  }
  
  .info-text {
    font-size: 10px;
    padding: 2px 4px;
  }
  
  .speed-value {
    font-size: 12px;
  }
}

@media (max-width: 480px) {
  .network-monitoring-section {
    padding: 12px;
    margin-bottom: 12px;
  }
  
  .chart-container {
    height: 80px;
  }
  
  .current-speed {
    flex-direction: column;
    gap: 8px;
  }
  
  .speed-item {
    padding: 6px 10px;
  }
  
  .section-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  
  .section-info {
    align-self: flex-end;
  }
}

/* 深色主题适配 */
@media (prefers-color-scheme: dark) {
  .network-monitoring-section {
    --monitoring-panel-bg: rgba(255, 255, 255, 0.05);
    --monitoring-panel-border: rgba(255, 255, 255, 0.1);
    --monitoring-item-bg: rgba(255, 255, 255, 0.03);
    --monitoring-item-border: rgba(255, 255, 255, 0.05);
    --monitoring-text-primary: #e5e5e5;
    --monitoring-text-secondary: #b0b0b0;
  }
}

/* 浅色主题适配 */
@media (prefers-color-scheme: light) {
  .network-monitoring-section {
    --monitoring-panel-bg: rgba(0, 0, 0, 0.05);
    --monitoring-panel-border: rgba(0, 0, 0, 0.1);
    --monitoring-item-bg: rgba(0, 0, 0, 0.03);
    --monitoring-item-border: rgba(0, 0, 0, 0.05);
    --monitoring-text-primary: #2c3e50;
    --monitoring-text-secondary: #6c757d;
  }
}
</style>
