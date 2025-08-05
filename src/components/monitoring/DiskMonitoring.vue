<template>
  <div class="disk-monitoring-section">
    <div class="section-header">
      <div class="section-title">
        <MonitoringIcon name="disk" :size="16" class="disk-icon" />
        <span>硬盘</span>
      </div>
      <div class="section-info" v-if="diskInfo.total">
        <span class="capacity-info">{{ formatBytes(diskInfo.used) }} / {{ formatBytes(diskInfo.total) }}</span>
      </div>
    </div>
    
    <div class="chart-container">
      <div class="disk-visual">
        <!-- 3D圆柱图效果 -->
        <div class="cylinder-container">
          <div class="cylinder">
            <!-- 圆柱顶部 -->
            <div class="cylinder-top"></div>
            <!-- 圆柱主体 -->
            <div class="cylinder-body">
              <div class="usage-fill" :style="{ height: usagePercentage + '%' }"></div>
            </div>
            <!-- 圆柱底部 -->
            <div class="cylinder-bottom"></div>
          </div>
          
          <!-- 使用率标签 -->
          <div class="usage-label">
            <span class="usage-text">{{ formatPercentage(diskUsage) }}</span>
            <span class="usage-desc">已使用</span>
          </div>
        </div>
        
        <!-- 读写速度指示器 -->
        <div class="io-indicators" v-if="hasIOData">
          <div class="io-item read">
            <div class="io-icon">📖</div>
            <div class="io-info">
              <span class="io-label">读取</span>
              <span class="io-value">{{ formatIOSpeed(ioStats.read) }}</span>
            </div>
          </div>
          <div class="io-item write">
            <div class="io-icon">✏️</div>
            <div class="io-info">
              <span class="io-label">写入</span>
              <span class="io-value">{{ formatIOSpeed(ioStats.write) }}</span>
            </div>
          </div>
        </div>
      </div>
      
      <div v-if="!hasData" class="no-data-message">
        <MonitoringIcon name="loading" :size="16" class="loading-icon" />
        <span>等待硬盘数据...</span>
      </div>
    </div>
    
    <div class="disk-summary" v-if="hasData">
      <div class="summary-item">
        <span class="summary-label">可用空间</span>
        <span class="summary-value available">{{ formatBytes(diskInfo.available) }}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">总容量</span>
        <span class="summary-value total">{{ formatBytes(diskInfo.total) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { formatBytes, formatPercentage } from '@/utils/productionFormatters'
import MonitoringIcon from './MonitoringIcon.vue'

// Props
const props = defineProps({
  monitoringData: {
    type: Object,
    default: () => ({})
  }
})

// 计算属性
const diskInfo = computed(() => {
  const disk = props.monitoringData?.disk || {}

  // 硬盘数据通常以GB为单位，需要转换为字节
  const total = disk.total || 0
  const used = disk.used || 0
  const free = disk.free || disk.available || 0

  return {
    total: total * 1024 * 1024 * 1024, // 转换为字节
    used: used * 1024 * 1024 * 1024,   // 转换为字节
    available: free * 1024 * 1024 * 1024, // 转换为字节
    usedPercentage: disk.usedPercentage || (total > 0 ? (used / total) * 100 : 0)
  }
})

const diskUsage = computed(() => {
  return diskInfo.value.usedPercentage || 0
})

const usagePercentage = computed(() => {
  return Math.min(Math.max(diskUsage.value, 0), 100)
})

const ioStats = computed(() => {
  const disk = props.monitoringData?.disk || {}
  return {
    read: disk.read_speed || disk.readSpeed || 0,
    write: disk.write_speed || disk.writeSpeed || 0
  }
})

const hasData = computed(() => {
  return diskInfo.value.total > 0
})

const hasIOData = computed(() => {
  return ioStats.value.read > 0 || ioStats.value.write > 0
})

// 格式化IO速度（使用网络速度格式化函数）
const formatIOSpeed = (bytesPerSecond) => {
  if (!bytesPerSecond || bytesPerSecond === 0) return '0 B/s'

  const k = 1024
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k))

  return parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// 获取使用率颜色
const getUsageColor = (usage) => {
  if (usage >= 95) return '#ef4444'
  if (usage >= 80) return '#f59e0b'
  return '#10b981'
}
</script>

<style scoped>
.disk-monitoring-section {
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

.disk-icon {
  font-size: 16px;
  color: #8b5cf6;
}

.section-info {
  display: flex;
  align-items: center;
}

.capacity-info {
  font-size: 10px;
  color: var(--monitoring-text-secondary, #b0b0b0);
  background: var(--monitoring-item-bg, rgba(255, 255, 255, 0.1));
  padding: 2px 5px;
  border-radius: 4px;
}

.chart-container {
  position: relative;
  height: 140px;
  margin-bottom: 12px;
}

.disk-visual {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 100%;
  gap: 20px;
}

.cylinder-container {
  display: flex;
  align-items: center;
  gap: 20px;
  flex: 1;
}

.cylinder {
  position: relative;
  width: 60px;
  height: 100px;
  margin: 0 auto;
}

.cylinder-top {
  width: 60px;
  height: 20px;
  background: linear-gradient(45deg, #4a5568, #2d3748);
  border-radius: 50%;
  border: 2px solid #718096;
  position: relative;
  z-index: 3;
}

.cylinder-body {
  width: 60px;
  height: 80px;
  background: linear-gradient(to right, #4a5568, #2d3748, #4a5568);
  border-left: 2px solid #718096;
  border-right: 2px solid #718096;
  position: relative;
  overflow: hidden;
}

.cylinder-bottom {
  width: 60px;
  height: 20px;
  background: linear-gradient(225deg, #2d3748, #1a202c);
  border-radius: 50%;
  border: 2px solid #718096;
  position: relative;
  z-index: 1;
  margin-top: -10px;
}

.usage-fill {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  background: linear-gradient(to top, v-bind('getUsageColor(diskUsage)'), rgba(16, 185, 129, 0.7));
  transition: height 0.8s cubic-bezier(0.4, 0, 0.2, 1);
  border-radius: 0 0 4px 4px;
}

.usage-label {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.usage-text {
  font-size: 16px;
  color: v-bind('getUsageColor(diskUsage)');
  margin-bottom: 4px;
}

.usage-desc {
  font-size: 11px;
  color: var(--monitoring-text-secondary, #b0b0b0);
  font-weight: 500;
}

.io-indicators {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 120px;
}

.io-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--monitoring-item-bg, rgba(255, 255, 255, 0.03));
  border-radius: 6px;
  border: 1px solid var(--monitoring-item-border, rgba(255, 255, 255, 0.05));
}

.io-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.io-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.io-label {
  font-size: 10px;
  color: var(--monitoring-text-secondary, #b0b0b0);
  font-weight: 500;
}

.io-value {
  font-size: 11px;
  color: var(--monitoring-text-primary, #e5e5e5);
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

.disk-summary {
  display: flex;
  gap: 12px;
}

.summary-item {
  flex: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--monitoring-item-bg, rgba(255, 255, 255, 0.03));
  border-radius: 6px;
  border: 1px solid var(--monitoring-item-border, rgba(255, 255, 255, 0.05));
}

.summary-label {
  font-size: 13px;
  color: var(--monitoring-text-secondary, #b0b0b0);
  font-weight: 500;
}

.summary-value {
  font-size: 13px;
  font-weight: 700;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
}

.summary-value.available {
  color: #10b981;
}

.summary-value.total {
  color: var(--monitoring-text-primary, #e5e5e5);
}

/* 响应式设计 */
@media (max-width: 768px) {
  .chart-container {
    height: 120px;
  }
  
  .disk-visual {
    gap: 15px;
  }
  
  .cylinder {
    width: 50px;
    height: 80px;
  }
  
  .cylinder-top,
  .cylinder-bottom {
    width: 50px;
    height: 16px;
  }
  
  .cylinder-body {
    width: 50px;
    height: 64px;
  }
  
  .usage-text {
    font-size: 16px;
  }
  
  .section-title {
    font-size: 14px;
  }
  
  .disk-icon {
    font-size: 16px;
  }
  
  .io-indicators {
    min-width: 100px;
    gap: 10px;
  }
}

@media (max-width: 480px) {
  .disk-monitoring-section {
    padding: 12px;
    margin-bottom: 12px;
  }
  
  .chart-container {
    height: 100px;
  }
  
  .disk-visual {
    flex-direction: column;
    gap: 10px;
  }
  
  .cylinder-container {
    gap: 15px;
  }
  
  .cylinder {
    width: 40px;
    height: 60px;
  }
  
  .cylinder-top,
  .cylinder-bottom {
    width: 40px;
    height: 12px;
  }
  
  .cylinder-body {
    width: 40px;
    height: 48px;
  }
  
  .io-indicators {
    flex-direction: row;
    min-width: auto;
    width: 100%;
  }
  
  .io-item {
    flex: 1;
    padding: 4px 8px;
  }
  
  .disk-summary {
    flex-direction: column;
    gap: 8px;
  }
  
  .summary-item {
    padding: 6px 10px;
  }
}

/* 深色主题适配 */
@media (prefers-color-scheme: dark) {
  .disk-monitoring-section {
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
  .disk-monitoring-section {
    --monitoring-panel-bg: rgba(0, 0, 0, 0.05);
    --monitoring-panel-border: rgba(0, 0, 0, 0.1);
    --monitoring-item-bg: rgba(0, 0, 0, 0.03);
    --monitoring-item-border: rgba(0, 0, 0, 0.05);
    --monitoring-text-primary: #2c3e50;
    --monitoring-text-secondary: #6c757d;
  }
  
  .cylinder-top {
    background: linear-gradient(45deg, #e2e8f0, #cbd5e0);
    border-color: #a0aec0;
  }
  
  .cylinder-body {
    background: linear-gradient(to right, #e2e8f0, #cbd5e0, #e2e8f0);
    border-color: #a0aec0;
  }
  
  .cylinder-bottom {
    background: linear-gradient(225deg, #cbd5e0, #a0aec0);
    border-color: #a0aec0;
  }
}
</style>
