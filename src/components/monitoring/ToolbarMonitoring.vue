<template>
  <div class="toolbar-monitoring" v-if="isConnected">
    <!-- CPU指标 -->
    <div class="monitoring-item" :class="{ 'warning': cpuUsage > 80, 'critical': cpuUsage > 95 }">
      <i class="icon-cpu"></i>
      <span class="label">CPU</span>
      <span class="value">{{ cpuUsage }}%</span>
    </div>

    <!-- 内存指标 -->
    <div class="monitoring-item" :class="{ 'warning': memoryUsage > 80, 'critical': memoryUsage > 95 }">
      <i class="icon-memory"></i>
      <span class="label">内存</span>
      <span class="value">{{ memoryUsage }}%</span>
    </div>

    <!-- 交换分区指标 -->
    <div class="monitoring-item" :class="{ 'warning': swapUsage > 50, 'critical': swapUsage > 80 }" v-if="hasSwap">
      <i class="icon-swap"></i>
      <span class="label">交换</span>
      <span class="value">{{ swapUsage }}%</span>
    </div>

    <!-- 磁盘指标 -->
    <div class="monitoring-item" :class="{ 'warning': diskUsage > 80, 'critical': diskUsage > 95 }" v-if="diskUsage > 0">
      <i class="icon-disk"></i>
      <span class="label">磁盘</span>
      <span class="value">{{ diskUsage }}%</span>
    </div>

    <!-- 上传速度 -->
    <div class="monitoring-item" v-if="networkSpeed.tx > 0">
      <i class="icon-upload"></i>
      <span class="label">上传</span>
      <span class="value">{{ formatNetworkSpeed(networkSpeed.tx) }}</span>
    </div>

    <!-- 下载速度 -->
    <div class="monitoring-item" v-if="networkSpeed.rx > 0">
      <i class="icon-download"></i>
      <span class="label">下载</span>
      <span class="value">{{ formatNetworkSpeed(networkSpeed.rx) }}</span>
    </div>


  </div>


</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import log from '../../services/log'

// Props
const props = defineProps({
  terminalId: {
    type: String,
    required: true
  }
})

// 响应式数据
const isConnected = ref(false)
const cpuUsage = ref(0)
const memoryUsage = ref(0)
const diskUsage = ref(0)
const swapUsage = ref(0)
const hasSwap = ref(false)
const networkSpeed = ref({ total: 0, rx: 0, tx: 0 })
const lastUpdateTime = ref(0)



// 监控服务实例
let monitoringService = null

// 事件处理器引用（用于正确移除事件监听器）
let dataEventHandler = null
let statusEventHandler = null

// 格式化网络速度
const formatNetworkSpeed = (bytesPerSecond) => {
  if (bytesPerSecond < 1024) {
    return `${bytesPerSecond}B/s`
  } else if (bytesPerSecond < 1024 * 1024) {
    return `${(bytesPerSecond / 1024).toFixed(1)}KB/s`
  } else {
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)}MB/s`
  }
}



// 处理监控数据
const handleMonitoringData = (data) => {
  try {
    // CPU数据处理
    if (data.cpu && typeof data.cpu.usage === 'number' && !isNaN(data.cpu.usage)) {
      cpuUsage.value = Math.round(Math.max(0, Math.min(100, data.cpu.usage)))
    }

    // 内存数据处理
    if (data.memory) {
      if (typeof data.memory.usedPercentage === 'number' && !isNaN(data.memory.usedPercentage)) {
        memoryUsage.value = Math.round(Math.max(0, Math.min(100, data.memory.usedPercentage)))
      } else if (data.memory.total > 0 && typeof data.memory.used === 'number') {
        const percentage = (data.memory.used / data.memory.total) * 100
        memoryUsage.value = Math.round(Math.max(0, Math.min(100, percentage)))
      }
    }

    // 磁盘数据处理
    if (data.disk) {
      if (typeof data.disk.usedPercentage === 'number' && !isNaN(data.disk.usedPercentage)) {
        diskUsage.value = Math.round(Math.max(0, Math.min(100, data.disk.usedPercentage)))
      } else if (data.disk.total > 0 && typeof data.disk.used === 'number') {
        const percentage = (data.disk.used / data.disk.total) * 100
        diskUsage.value = Math.round(Math.max(0, Math.min(100, percentage)))
      }
    }

    // 交换分区数据处理
    if (data.swap) {
      hasSwap.value = true
      if (typeof data.swap.usedPercentage === 'number' && !isNaN(data.swap.usedPercentage)) {
        swapUsage.value = Math.round(Math.max(0, Math.min(100, data.swap.usedPercentage)))
      } else if (data.swap.total > 0 && typeof data.swap.used === 'number') {
        const percentage = (data.swap.used / data.swap.total) * 100
        swapUsage.value = Math.round(Math.max(0, Math.min(100, percentage)))
      }
    }

    // 网络数据处理
    if (data.network && typeof data.network === 'object') {
      const rxSpeed = parseFloat(data.network.total_rx_speed) || 0
      const txSpeed = parseFloat(data.network.total_tx_speed) || 0

      networkSpeed.value = {
        total: rxSpeed + txSpeed,
        rx: rxSpeed,
        tx: txSpeed
      }
    }

    lastUpdateTime.value = Date.now()
  } catch (error) {
    log.error('[工具栏监控] 处理监控数据失败:', error)
  }
}

// 处理监控状态变更
const handleMonitoringStatusChange = (event) => {
  const { terminalId: eventTerminalId, installed, available } = event.detail
  
  if (eventTerminalId === props.terminalId) {
    isConnected.value = installed && available
    log.debug(`[工具栏监控] 状态变更: 终端=${eventTerminalId}, 连接=${isConnected.value}`)
  }
}



// 初始化监控连接
const initMonitoring = async () => {
  try {
    // 动态导入监控服务
    const monitoringModule = await import('../../services/monitoring.js')
    monitoringService = monitoringModule.default
    
    // 检查是否已有连接
    const instance = monitoringService.getInstance(props.terminalId)
    if (instance && instance.state.connected) {
      isConnected.value = true
      log.debug(`[工具栏监控] 发现现有连接: ${props.terminalId}`)
    }
    
    // 创建事件处理器
    dataEventHandler = (event) => {
      if (event.detail.terminalId === props.terminalId) {
        handleMonitoringData(event.detail.data)
      }
    }

    statusEventHandler = handleMonitoringStatusChange

    // 监听监控数据
    window.addEventListener('monitoring-data-received', dataEventHandler)

    // 监听监控状态变更
    window.addEventListener('monitoring-status-change', statusEventHandler)
    
  } catch (error) {
    log.error('[工具栏监控] 初始化失败:', error)
  }
}

// 清理资源
const cleanup = () => {
  if (dataEventHandler) {
    window.removeEventListener('monitoring-data-received', dataEventHandler)
  }
  if (statusEventHandler) {
    window.removeEventListener('monitoring-status-change', statusEventHandler)
  }
}

// 生命周期
onMounted(() => {
  initMonitoring()
})

onUnmounted(() => {
  cleanup()
})
</script>

<style scoped>
.toolbar-monitoring {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 8px;
  font-size: 12px;
  color: #e5e5e5;
  border-left: 1px solid #3a3a3a;
  margin-left: 8px;
  padding-left: 12px;
  border-radius: 6px;
}



.monitoring-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.05);
  transition: all var(--theme-transition-duration) var(--theme-transition-timing);
  min-width: 60px;
}

.monitoring-item:hover {
  background: rgba(255, 255, 255, 0.1);
}

.monitoring-item.warning {
  background: rgba(255, 193, 7, 0.2);
  color: #ffc107;
}

.monitoring-item.critical {
  background: rgba(220, 53, 69, 0.2);
  color: #dc3545;
}

.label {
  font-weight: 500;
  opacity: 0.8;
}

.value {
  font-weight: 600;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
}



/* 图标样式 */
.icon-cpu::before { content: '🖥️'; }
.icon-memory::before { content: '💾'; }
.icon-upload::before { content: '🔼'; }
.icon-download::before { content: '🔽'; }
.icon-swap::before { content: '🔄'; }
.icon-disk::before { content: '💿'; }

/* 响应式设计 */
@media (max-width: 1200px) {
  .toolbar-monitoring {
    gap: 8px;
  }
  
  .monitoring-item {
    min-width: 50px;
  }
  
  .label {
    display: none;
  }
}

@media (max-width: 900px) {
  .toolbar-monitoring {
    gap: 6px;
  }
  
  .monitoring-item {
    min-width: 40px;
    padding: 2px 4px;
  }
}
</style>
