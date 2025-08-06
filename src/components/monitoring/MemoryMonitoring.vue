<template>
  <div class="monitor-section memory-monitoring-section">
    <div class="monitor-header">
      <div class="monitor-title">
        <MonitoringIcon name="memory" :size="16" class="memory-icon" />
        <span>内存</span>
      </div>
    </div>

    <div class="monitor-chart-container">
      <div class="memory-chart-layout">
        <!-- 左侧：双圆环嵌套图 -->
        <div class="chart-section">
          <canvas ref="memoryChartRef" class="memory-nested-chart"></canvas>
        </div>

        <!-- 右侧：文本和图例 -->
        <div class="info-section">
          <div class="memory-info-item">
            <div class="info-indicator memory-indicator"></div>
            <div class="info-content">
              <div class="info-label">物理内存</div>
              <div class="info-value">{{ formatPercentage(memoryUsage) }}</div>
              <div class="info-detail">{{ formatBytes(memoryInfo.used) }} / {{ formatBytes(memoryInfo.total) }}</div>
            </div>
          </div>

          <div v-if="hasSwap" class="memory-info-item">
            <div class="info-indicator swap-indicator"></div>
            <div class="info-content">
              <div class="info-label">交换分区</div>
              <div class="info-value">{{ formatPercentage(swapUsage) }}</div>
              <div class="info-detail">{{ formatBytes(swapInfo.used) }} / {{ formatBytes(swapInfo.total) }}</div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="!hasData" class="monitor-no-data">
        <MonitoringIcon name="loading" :size="16" class="loading-icon" />
        <span>等待内存数据...</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, computed, nextTick, markRaw } from 'vue'
import { Chart, registerables } from 'chart.js'
import { formatBytes, formatPercentage } from '@/utils/productionFormatters'
import { getStatusColors } from '@/utils/chartConfig'
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
const memoryChartRef = ref(null)
const memoryChartInstance = ref(null)

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



// 创建双圆环嵌套图表配置
const createNestedDoughnutConfig = () => {
  const memoryColors = getStatusColors(memoryUsage.value)
  const swapColors = getStatusColors(swapUsage.value)

  return {
    type: 'doughnut',
    data: {
      datasets: [
        // 外圈 - 内存
        {
          data: [memoryUsage.value, 100 - memoryUsage.value],
          backgroundColor: [memoryColors.primary, memoryColors.background],
          borderWidth: 0,
          cutout: '50%',  // 调整为50%，为内圈留出空间
          radius: '100%', // 外圈占满整个区域
          label: '内存'
        },
        // 内圈 - 交换分区
        {
          data: hasSwap.value ? [swapUsage.value, 100 - swapUsage.value] : [0, 100],
          backgroundColor: hasSwap.value ? [swapColors.primary, swapColors.background] : ['transparent', 'transparent'],
          borderWidth: 0,
          cutout: '50%',  // 内圈的内径
          radius: '100%',  // 内圈的外径，与外圈的内径相同，消除间隙
          label: '交换分区'
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
          enabled: true,
          callbacks: {
            label: function(context) {
              const datasetLabel = context.dataset.label
              const value = context.parsed
              return `${datasetLabel}: ${value.toFixed(1)}%`
            }
          }
        }
      },
      animation: {
        duration: 300,
        easing: 'easeInOutQuart'
      }
    }
  }
}

// 初始化双圆环图表
const initMemoryChart = async () => {
  await nextTick()

  if (!memoryChartRef.value) return

  const ctx = memoryChartRef.value.getContext('2d')

  if (memoryChartInstance.value) {
    memoryChartInstance.value.destroy()
  }

  // 创建双圆环嵌套图表
  const config = createNestedDoughnutConfig()
  memoryChartInstance.value = markRaw(new Chart(ctx, config))
}



// 更新双圆环图表数据
const updateCharts = () => {
  try {
    if (memoryChartInstance.value && hasData.value) {
      // 检查图表实例是否有效
      if (!memoryChartInstance.value.data || !memoryChartInstance.value.data.datasets) {
        console.warn('[内存监控] 图表数据结构无效')
        return
      }

      const memUsed = memoryUsage.value
      const memFree = 100 - memUsed
      const swapUsed = swapUsage.value
      const swapFree = 100 - swapUsed

      // 更新外圈（内存）数据
      if (memoryChartInstance.value.data.datasets[0]) {
        const memoryColors = getStatusColors(memUsed)
        memoryChartInstance.value.data.datasets[0].data = [memUsed, memFree]
        memoryChartInstance.value.data.datasets[0].backgroundColor = [memoryColors.primary, memoryColors.background]
      }

      // 更新内圈（交换分区）数据
      if (memoryChartInstance.value.data.datasets[1]) {
        if (hasSwap.value) {
          const swapColors = getStatusColors(swapUsed)
          memoryChartInstance.value.data.datasets[1].data = [swapUsed, swapFree]
          memoryChartInstance.value.data.datasets[1].backgroundColor = [swapColors.primary, swapColors.background]
        } else {
          memoryChartInstance.value.data.datasets[1].data = [0, 100]
          memoryChartInstance.value.data.datasets[1].backgroundColor = ['transparent', 'transparent']
        }
      }

      memoryChartInstance.value.update('none')
    }
  } catch (error) {
    console.error('[内存监控] 更新图表失败:', error)
  }
}

// 暂时禁用自动更新，避免Chart.js错误
// 监听数据变化 - 只监听关键字段避免循环引用
// let updateTimer = null
// watch(() => [props.monitoringData?.memory, props.monitoringData?.swap], ([newMemory, newSwap]) => {
//   // 防抖处理，避免频繁更新
//   if (updateTimer) {
//     clearTimeout(updateTimer)
//   }

//   updateTimer = setTimeout(() => {
//     if ((newMemory || newSwap) && (memoryChartInstance.value || swapChartInstance.value)) {
//       updateCharts()
//     }
//     updateTimer = null
//   }, 100) // 100ms防抖
// }, { deep: true })

// 监听数据变化，重新创建图表以更新双圆环结构
watch(() => [memoryUsage.value, swapUsage.value, hasSwap.value], () => {
  if (memoryChartInstance.value) {
    updateCharts()
  }
}, { immediate: false })

// 生命周期
onMounted(() => {
  initMemoryChart()
})

onUnmounted(() => {
  if (memoryChartInstance.value) {
    memoryChartInstance.value.destroy()
  }
})
</script>

<style scoped>
/* 导入监控主题样式 */
@import '@/assets/styles/themes/monitoring-theme.css';

/* 内存监控组件继承通用监控组件样式 */

.memory-icon {
  color: var(--monitor-memory-primary);
}

.memory-capacity-info {
  font-size: 11px;
  color: var(--monitor-text-secondary);
  padding: var(--monitor-spacing-xs);
  background: var(--monitor-bg-secondary);
  border-radius: var(--monitor-radius-sm);
}

.memory-chart-layout {
  display: flex;
  align-items: center;
  gap: var(--monitor-spacing-lg);
  height: 100%;
}

.chart-section {
  flex-shrink: 0;
  width: 120px;
  height: 120px;
}

.memory-nested-chart {
  width: 100%;
  height: 100%;
}

.info-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--monitor-spacing-md);
}

.memory-info-item {
  display: flex;
  align-items: center;
  gap: var(--monitor-spacing-sm);
}

.info-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.memory-indicator {
  background-color: var(--monitor-memory-primary);
}

.swap-indicator {
  background-color: var(--monitor-disk-primary);
}

.info-content {
  flex: 1;
}

.info-label {
  font-size: 11px;
  color: var(--monitor-text-secondary);
  margin-bottom: 2px;
}

.info-value {
  font-size: 16px;
  font-weight: 700;
  color: var(--monitor-text-primary);
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  margin-bottom: 1px;
}

.info-detail {
  font-size: 10px;
  color: var(--monitor-text-secondary);
  font-family: 'JetBrains Mono', 'Courier New', monospace;
}

/* 响应式适配 */
@media (max-width: 768px) {
  .memory-chart-layout {
    flex-direction: column;
    gap: var(--monitor-spacing-md);
  }

  .chart-section {
    width: 100px;
    height: 100px;
  }

  .info-value {
    font-size: 14px;
  }

  .info-label,
  .info-detail {
    font-size: 10px;
  }
}

@media (max-width: 480px) {
  .chart-section {
    width: 80px;
    height: 80px;
  }

  .info-value {
    font-size: 12px;
  }

  .info-label,
  .info-detail {
    font-size: 9px;
  }

  .memory-chart-layout {
    gap: var(--monitor-spacing-sm);
  }
}
</style>
