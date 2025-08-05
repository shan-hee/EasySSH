<template>
  <div class="memory-monitoring-section">
    <!-- 内存监控标题 -->
    <div class="section-header">
      <div class="section-title">
        <i class="fas fa-memory memory-icon"></i>
        <span>内存</span>
      </div>
      <div class="section-info">
        <div class="memory-info" v-if="memoryInfo.total">
          <span class="info-text">{{ formatBytes(memoryInfo.used) }} / {{ formatBytes(memoryInfo.total) }}</span>
        </div>
        <div class="swap-info" v-if="swapInfo.total && swapInfo.total > 0">
          <span class="info-text">Swap: {{ formatBytes(swapInfo.used) }} / {{ formatBytes(swapInfo.total) }}</span>
        </div>
      </div>
    </div>

    <div class="memory-display">
      <div v-if="!hasData" class="no-data-message">
        <i class="loading-icon">⏳</i>
        <span>等待内存数据...</span>
      </div>

      <div v-if="hasData" class="memory-info">
        <div class="memory-usage">
          <div class="usage-bar-container">
            <div class="usage-bar">
              <div class="usage-fill" :style="{ width: memoryUsage + '%' }" :class="getUsageClass(memoryUsage)"></div>
            </div>
            <div class="usage-text">
              <span class="usage-percentage">{{ formatPercentage(memoryUsage) }}</span>
              <span class="usage-label">内存使用率</span>
            </div>
          </div>
        </div>

        <div class="memory-details">
          <div class="detail-item">
            <span class="detail-label">物理内存</span>
            <span class="detail-value">{{ formatBytes(memoryInfo.used) }} / {{ formatBytes(memoryInfo.total) }}</span>
          </div>
          <div class="detail-item" v-if="hasSwap">
            <span class="detail-label">交换分区</span>
            <span class="detail-value">{{ formatBytes(swapInfo.used) }} / {{ formatBytes(swapInfo.total) }}</span>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, computed, nextTick } from 'vue'
import { Chart, registerables } from 'chart.js'
import { formatBytes, formatPercentage } from '@/utils/productionFormatters'

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
const memoryChartRef = ref(null)
const swapChartRef = ref(null)
const memoryChartInstance = ref(null)
const swapChartInstance = ref(null)

// 计算属性
const memoryInfo = computed(() => {
  const memory = props.monitoringData?.memory || {}

  // 兼容不同的数据格式，内存数据通常以MB为单位
  const total = memory.total || 0
  const used = memory.used || 0
  const free = memory.free || memory.available || 0
  const cached = memory.cached || 0

  return {
    total: total * 1024 * 1024, // 转换为字节
    used: used * 1024 * 1024,   // 转换为字节
    free: free * 1024 * 1024,   // 转换为字节
    cached: cached * 1024 * 1024, // 转换为字节
    usedPercentage: memory.usedPercentage || (total > 0 ? (used / total) * 100 : 0)
  }
})

const swapInfo = computed(() => {
  const swap = props.monitoringData?.swap || {}

  // 兼容不同的数据格式，交换分区数据通常以MB为单位
  const total = swap.total || 0
  const used = swap.used || 0
  const free = swap.free || 0

  return {
    total: total * 1024 * 1024, // 转换为字节
    used: used * 1024 * 1024,   // 转换为字节
    free: free * 1024 * 1024,   // 转换为字节
    usedPercentage: swap.usedPercentage || (total > 0 ? (used / total) * 100 : 0)
  }
})

const memoryUsage = computed(() => {
  return memoryInfo.value.usedPercentage || 0
})

const swapUsage = computed(() => {
  return swapInfo.value.usedPercentage || 0
})

const hasSwap = computed(() => {
  return swapInfo.value.total > 0
})

const hasData = computed(() => {
  return memoryInfo.value.total > 0
})

// 获取使用率样式类
const getUsageClass = (usage) => {
  if (usage >= 95) return 'critical'
  if (usage >= 80) return 'warning'
  return 'normal'
}

// 获取使用率颜色
const getUsageColor = (usage) => {
  if (usage >= 95) return '#ef4444'
  if (usage >= 80) return '#f59e0b'
  return '#10b981'
}

// 初始化内存图表
const initMemoryChart = async () => {
  await nextTick()
  
  if (!memoryChartRef.value) return
  
  const ctx = memoryChartRef.value.getContext('2d')
  
  if (memoryChartInstance.value) {
    memoryChartInstance.value.destroy()
  }
  
  memoryChartInstance.value = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['已使用', '可用'],
      datasets: [{
        data: [0, 100],
        backgroundColor: [
          getUsageColor(memoryUsage.value),
          'rgba(255, 255, 255, 0.1)'
        ],
        borderWidth: 0,
        cutout: '60%'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          titleColor: '#ffffff',
          bodyColor: '#ffffff',
          borderColor: getUsageColor(memoryUsage.value),
          borderWidth: 1,
          cornerRadius: 6,
          callbacks: {
            label: (context) => {
              const label = context.label
              const value = context.parsed
              if (label === '已使用') {
                return `已使用: ${formatBytes(memoryInfo.value.used)} (${value.toFixed(1)}%)`
              } else {
                return `可用: ${formatBytes(memoryInfo.value.free)} (${value.toFixed(1)}%)`
              }
            }
          }
        }
      },
      animation: {
        duration: 1000,
        easing: 'easeInOutQuart'
      }
    }
  })
}

// 初始化Swap图表
const initSwapChart = async () => {
  await nextTick()
  
  if (!swapChartRef.value || !hasSwap.value) return
  
  const ctx = swapChartRef.value.getContext('2d')
  
  if (swapChartInstance.value) {
    swapChartInstance.value.destroy()
  }
  
  swapChartInstance.value = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['已使用', '可用'],
      datasets: [{
        data: [0, 100],
        backgroundColor: [
          getUsageColor(swapUsage.value),
          'rgba(255, 255, 255, 0.1)'
        ],
        borderWidth: 0,
        cutout: '60%'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          titleColor: '#ffffff',
          bodyColor: '#ffffff',
          borderColor: getUsageColor(swapUsage.value),
          borderWidth: 1,
          cornerRadius: 6,
          callbacks: {
            label: (context) => {
              const label = context.label
              const value = context.parsed
              if (label === '已使用') {
                return `已使用: ${formatBytes(swapInfo.value.used)} (${value.toFixed(1)}%)`
              } else {
                return `可用: ${formatBytes(swapInfo.value.free)} (${value.toFixed(1)}%)`
              }
            }
          }
        }
      },
      animation: {
        duration: 1000,
        easing: 'easeInOutQuart'
      }
    }
  })
}

// 更新图表数据
const updateCharts = () => {
  if (memoryChartInstance.value && hasData.value) {
    const memUsed = memoryUsage.value
    const memFree = 100 - memUsed
    
    memoryChartInstance.value.data.datasets[0].data = [memUsed, memFree]
    memoryChartInstance.value.data.datasets[0].backgroundColor[0] = getUsageColor(memUsed)
    memoryChartInstance.value.update('none')
  }
  
  if (swapChartInstance.value && hasSwap.value) {
    const swapUsed = swapUsage.value
    const swapFree = 100 - swapUsed
    
    swapChartInstance.value.data.datasets[0].data = [swapUsed, swapFree]
    swapChartInstance.value.data.datasets[0].backgroundColor[0] = getUsageColor(swapUsed)
    swapChartInstance.value.update('none')
  }
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
//     if (hasData.value && memoryChartInstance.value && newData !== oldData) {
//       try {
//         updateCharts()
//       } catch (error) {
//         console.error('[内存监控] 更新图表失败:', error)
//       }
//     }
//     updateTimer = null
//   }, 100) // 100ms防抖
// }, { deep: true })

watch(hasSwap, (newVal) => {
  if (newVal) {
    initSwapChart()
  }
})

// 生命周期
onMounted(() => {
  initMemoryChart()
  if (hasSwap.value) {
    initSwapChart()
  }
})

onUnmounted(() => {
  if (updateTimer) {
    clearTimeout(updateTimer)
    updateTimer = null
  }
  if (memoryChartInstance.value) {
    memoryChartInstance.value.destroy()
  }
  if (swapChartInstance.value) {
    swapChartInstance.value.destroy()
  }
})
</script>

<style scoped>
.memory-monitoring-section {
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
  align-items: flex-start;
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

.memory-icon {
  font-size: 16px;
  color: #f59e0b;
}

.section-info {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.memory-info,
.swap-info {
  font-size: 10px;
  color: var(--monitoring-text-secondary, #b0b0b0);
  background: var(--monitoring-item-bg, rgba(255, 255, 255, 0.1));
  padding: 2px 5px;
  border-radius: 4px;
}

.memory-display {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 12px;
}

.memory-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.memory-usage {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.usage-bar-container {
  width: 100%;
  max-width: 200px;
}

.usage-bar {
  width: 100%;
  height: 8px;
  background: var(--monitoring-item-bg, rgba(255, 255, 255, 0.1));
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 6px;
}

.usage-fill {
  height: 100%;
  transition: width 0.3s ease;
  border-radius: 4px;
}

.usage-fill.normal {
  background: #10b981;
}

.usage-fill.warning {
  background: #f59e0b;
}

.usage-fill.critical {
  background: #ef4444;
}

.usage-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.usage-percentage {
  font-size: 16px;
  color: var(--monitoring-text-primary, #e5e5e5);
}

.usage-label {
  font-size: 12px;
  color: var(--monitoring-text-secondary, #b0b0b0);
  text-align: center;
}

.memory-details {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  max-width: 200px;
}

.detail-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 8px;
  background: var(--monitoring-item-bg, rgba(255, 255, 255, 0.03));
  border-radius: 4px;
  border: 1px solid var(--monitoring-item-border, rgba(255, 255, 255, 0.05));
}

.detail-label {
  font-size: 11px;
  color: var(--monitoring-text-secondary, #b0b0b0);
}

.detail-value {
  font-size: 11px;
  color: var(--monitoring-text-primary, #e5e5e5);
}

.chart-container {
  position: relative;
  height: 140px;
  margin-bottom: 12px;
}

.doughnut-charts {
  display: flex;
  justify-content: space-around;
  align-items: center;
  height: 100%;
  gap: 20px;
}

.chart-wrapper {
  position: relative;
  width: 120px;
  height: 120px;
  flex-shrink: 0;
}

.memory-chart,
.swap-chart {
  width: 100% !important;
  height: 100% !important;
}

.chart-center-label {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  pointer-events: none;
}

.center-title {
  font-size: 11px;
  color: var(--monitoring-text-secondary, #b0b0b0);
  font-weight: 500;
  margin-bottom: 2px;
}

.center-value {
  font-size: 14px;
  color: var(--monitoring-text-primary, #e5e5e5);
  font-weight: 700;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
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

.usage-summary {
  display: flex;
  gap: 12px;
}

.usage-item {
  flex: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--monitoring-item-bg, rgba(255, 255, 255, 0.03));
  border-radius: 6px;
  border: 1px solid var(--monitoring-item-border, rgba(255, 255, 255, 0.05));
}

.usage-label {
  font-size: 13px;
  color: var(--monitoring-text-secondary, #b0b0b0);
  font-weight: 500;
}

.usage-value {
  font-size: 14px;
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
    height: 120px;
  }
  
  .chart-wrapper {
    width: 100px;
    height: 100px;
  }
  
  .doughnut-charts {
    gap: 15px;
  }
  
  .section-title {
    font-size: 14px;
  }
  
  .memory-icon {
    font-size: 16px;
  }
  
  .center-value {
    font-size: 12px;
  }
  
  .center-title {
    font-size: 10px;
  }
}

@media (max-width: 480px) {
  .memory-monitoring-section {
    padding: 12px;
    margin-bottom: 12px;
  }
  
  .chart-container {
    height: 100px;
  }
  
  .chart-wrapper {
    width: 80px;
    height: 80px;
  }
  
  .doughnut-charts {
    gap: 10px;
  }
  
  .usage-summary {
    flex-direction: column;
    gap: 8px;
  }
  
  .usage-item {
    padding: 6px 10px;
  }
  
  .section-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  
  .section-info {
    align-items: flex-start;
  }
}

/* 深色主题适配 */
@media (prefers-color-scheme: dark) {
  .memory-monitoring-section {
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
  .memory-monitoring-section {
    --monitoring-panel-bg: rgba(0, 0, 0, 0.05);
    --monitoring-panel-border: rgba(0, 0, 0, 0.1);
    --monitoring-item-bg: rgba(0, 0, 0, 0.03);
    --monitoring-item-border: rgba(0, 0, 0, 0.05);
    --monitoring-text-primary: #2c3e50;
    --monitoring-text-secondary: #6c757d;
  }
}
</style>
