<template>
  <div class="cpu-monitoring-section">
    <!-- CPU监控标题 -->
    <div class="section-header">
      <div class="section-title">
        <MonitoringIcon name="cpu" :size="16" class="cpu-icon" />
        <span>CPU</span>
      </div>
      <div class="section-info">
        <div class="cpu-details" v-if="cpuCores || loadAverage">
          <span class="cores-info" v-if="cpuCores">{{ cpuCores }} 核</span>
          <span class="load-info" v-if="loadAverage && loadAverage.load1 !== undefined">
            负载: {{ formatLoadAverage(loadAverage) }}
          </span>
        </div>
      </div>
    </div>

    <div class="cpu-display">
      <div v-if="!hasData" class="no-data-message">
        <MonitoringIcon name="loading" :size="16" class="loading-icon" />
        <span>等待CPU数据...</span>
      </div>

      <div v-if="hasData" class="cpu-info">
        <div class="usage-display">
          <div class="usage-circle" :class="getUsageClass(currentUsage)">
            <span class="usage-text">{{ formatPercentage(currentUsage) }}</span>
          </div>
          <div class="usage-label">CPU使用率</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, computed, nextTick } from 'vue'
import { Chart, registerables } from 'chart.js'
import { formatPercentage } from '@/utils/productionFormatters'
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
const cpuChartRef = ref(null)
const chartInstance = ref(null)
const historyData = ref([])
const maxDataPoints = 50

// 计算属性
const currentUsage = computed(() => {
  const cpu = props.monitoringData?.cpu
  if (!cpu) return 0

  // 兼容不同的数据格式
  return cpu.usage || cpu.usedPercentage || 0
})

const cpuCores = computed(() => {
  const cpu = props.monitoringData?.cpu
  const system = props.monitoringData?.system

  return cpu?.cores || system?.cpu_cores || ''
})

const cpuModel = computed(() => {
  const cpu = props.monitoringData?.cpu
  const system = props.monitoringData?.system

  return cpu?.model || system?.cpu_model || ''
})

const loadAverage = computed(() => {
  const cpu = props.monitoringData?.cpu
  const system = props.monitoringData?.system

  return cpu?.loadAverage || system?.load_average || system?.loadavg || null
})

const hasData = computed(() => {
  return currentUsage.value > 0 || historyData.value.length > 0
})

// 获取使用率样式类
const getUsageClass = (usage) => {
  if (usage >= 95) return 'critical'
  if (usage >= 80) return 'warning'
  return 'normal'
}

// 格式化负载平均值
const formatLoadAverage = (loadAvg) => {
  if (!loadAvg || typeof loadAvg !== 'object') return '--'

  const { load1, load5, load15 } = loadAvg
  if (load1 === undefined) return '--'

  // 只显示1分钟负载，节省空间
  return parseFloat(load1).toFixed(2)
}

// 初始化图表
const initChart = async () => {
  await nextTick()
  
  if (!cpuChartRef.value) return
  
  const ctx = cpuChartRef.value.getContext('2d')
  
  // 销毁现有图表
  if (chartInstance.value) {
    chartInstance.value.destroy()
  }
  
  chartInstance.value = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'CPU使用率',
        data: [],
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointBackgroundColor: '#3b82f6',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2
      }]
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
          displayColors: false,
          callbacks: {
            title: () => 'CPU使用率',
            label: (context) => `${context.parsed.y.toFixed(1)}%`
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
          max: 100,
          grid: {
            color: 'rgba(255, 255, 255, 0.1)',
            lineWidth: 1
          },
          ticks: {
            color: 'rgba(255, 255, 255, 0.7)',
            font: {
              size: 11
            },
            callback: (value) => `${value}%`
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
  historyData.value.push({
    time: timeLabel,
    value: currentUsage.value,
    timestamp: now.getTime()
  })
  
  // 保持数据点数量限制
  if (historyData.value.length > maxDataPoints) {
    historyData.value.shift()
  }
  
  // 更新图表
  chartInstance.value.data.labels = historyData.value.map(item => item.time)
  chartInstance.value.data.datasets[0].data = historyData.value.map(item => item.value)
  
  // 动态调整颜色
  const latestUsage = currentUsage.value
  let borderColor = '#3b82f6'
  let backgroundColor = 'rgba(59, 130, 246, 0.1)'
  
  if (latestUsage >= 95) {
    borderColor = '#ef4444'
    backgroundColor = 'rgba(239, 68, 68, 0.1)'
  } else if (latestUsage >= 80) {
    borderColor = '#f59e0b'
    backgroundColor = 'rgba(245, 158, 11, 0.1)'
  }
  
  chartInstance.value.data.datasets[0].borderColor = borderColor
  chartInstance.value.data.datasets[0].backgroundColor = backgroundColor
  chartInstance.value.data.datasets[0].pointBackgroundColor = borderColor
  
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
//         console.error('[CPU监控] 更新图表失败:', error)
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
.cpu-monitoring-section {
  background: var(--monitoring-panel-bg, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--monitoring-panel-border, rgba(255, 255, 255, 0.1));
  border-radius: 8px;
  padding: 12px;
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  flex-shrink: 0;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--monitoring-text-primary, #e5e5e5);
}

.cpu-icon {
  font-size: 16px;
  color: #3b82f6;
}

.section-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cpu-details {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  /* gap: 4px; */
}

.cores-info,
.load-info {
  font-size: 10px;
  color: var(--monitoring-text-secondary, #b0b0b0);
  background: var(--monitoring-item-bg, rgba(255, 255, 255, 0.1));
  padding: 2px 6px;
  border-radius: 4px;
}

.cpu-display {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.cpu-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  width: 100%;
}

.usage-display {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.usage-circle {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 4px solid;
  transition: all 0.3s ease;
}

.usage-circle.normal {
  border-color: #3b82f6;
  background: rgba(59, 130, 246, 0.1);
}

.usage-circle.warning {
  border-color: #f59e0b;
  background: rgba(245, 158, 11, 0.1);
}

.usage-circle.critical {
  border-color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
}

.usage-text {
  font-size: 16px;
  color: var(--monitoring-text-primary, #e5e5e5);
}

.usage-label {
  font-size: 12px;
  color: var(--monitoring-text-secondary, #b0b0b0);
  text-align: center;
}

.cpu-details {
  display: flex;
  /* gap: 16px; */
  width: 100%;
  justify-content: center;
}

.detail-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  background: var(--monitoring-item-bg, rgba(255, 255, 255, 0.03));
  border-radius: 6px;
  border: 1px solid var(--monitoring-item-border, rgba(255, 255, 255, 0.05));
}

.detail-label {
  font-size: 12px;
  color: var(--monitoring-text-secondary, #b0b0b0);
}

.detail-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--monitoring-text-primary, #e5e5e5);
  font-family: 'JetBrains Mono', 'Courier New', monospace;
}

.no-data-message {
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

.usage-value {
  font-size: 16px;
  font-weight: 700;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
}

.usage-value.normal {
  color: #10b981;
}

.usage-value.warning {
  color: #f59e0b;
}

.usage-value.critical {
  color: #ef4444;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .chart-container {
    height: 100px;
  }
  
  .section-title {
    font-size: 14px;
  }
  
  .cpu-icon {
    font-size: 16px;
  }
  
  .cores-info,
  .load-info {
    font-size: 10px;
    padding: 2px 4px;
  }

  .cpu-details {
    align-items: flex-start;
  }
  
  .usage-value {
    font-size: 14px;
  }
}

@media (max-width: 480px) {
  .cpu-monitoring-section {
    padding: 12px;
    margin-bottom: 12px;
  }
  
  .chart-container {
    height: 80px;
  }
  
  .current-usage {
    padding: 6px 10px;
  }
  
  .usage-label,
  .usage-value {
    font-size: 12px;
  }
}

/* 深色主题适配 */
@media (prefers-color-scheme: dark) {
  .cpu-monitoring-section {
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
  .cpu-monitoring-section {
    --monitoring-panel-bg: rgba(0, 0, 0, 0.05);
    --monitoring-panel-border: rgba(0, 0, 0, 0.1);
    --monitoring-item-bg: rgba(0, 0, 0, 0.03);
    --monitoring-item-border: rgba(0, 0, 0, 0.05);
    --monitoring-text-primary: #2c3e50;
    --monitoring-text-secondary: #6c757d;
  }
}
</style>
