<template>
  <div class="system-info-section">
    <!-- 系统信息标题 -->
    <div class="section-header">
      <div class="section-title">
        <MonitoringIcon name="system-info" :size="16" class="system-icon" />
        <span>系统信息</span>
      </div>
    </div>

    <div class="info-grid">
      <div class="info-item" v-if="systemInfo.os">
        <span class="info-label">系统类型</span>
        <span class="info-value">{{ systemInfo.os }}</span>
      </div>

      <div class="info-item" v-if="systemInfo.hostname">
        <span class="info-label">主机名</span>
        <span class="info-value">{{ systemInfo.hostname }}</span>
      </div>

      <div class="info-item" v-if="systemInfo.cpuModel">
        <span class="info-label">CPU型号</span>
        <span class="info-value">{{ systemInfo.cpuModel }}</span>
      </div>

      <div class="info-item" v-if="systemInfo.architecture">
        <span class="info-label">系统架构</span>
        <span class="info-value">{{ systemInfo.architecture }}</span>
      </div>

      <!-- CPU核心信息已隐藏 -->

      <div class="info-item" v-if="systemInfo.loadAverage">
        <span class="info-label">系统负载</span>
        <span class="info-value">{{ formatLoadAverage(systemInfo.loadAverage) }}</span>
      </div>

      <div class="info-item" v-if="systemInfo.uptime">
        <span class="info-label">运行时间</span>
        <span class="info-value">{{ formatUptime(systemInfo.uptime) }}</span>
      </div>

      <div class="info-item" v-if="systemInfo.bootTime">
        <span class="info-label">启动时间</span>
        <span class="info-value">{{ formatDateTime(systemInfo.bootTime) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import MonitoringIcon from './MonitoringIcon.vue'

// Props
const props = defineProps({
  monitoringData: {
    type: Object,
    default: () => ({})
  }
})

// 系统信息数据
const systemInfo = computed(() => {
  const data = props.monitoringData
  console.log('SystemInfo 监控数据:', data) // 调试日志

  return {
    // 操作系统信息 - 从os对象获取
    os: data.os?.distro || data.os?.platform || data.system?.os || '',
    hostname: data.os?.hostname || data.system?.hostname || '',
    architecture: data.os?.arch || data.system?.arch || data.system?.architecture || '',

    // CPU信息 - 从cpu对象获取
    cpuModel: data.cpu?.model || data.system?.cpu_model || '',
    cpuCores: data.cpu?.cores || data.system?.cpu_cores || '',

    // 系统负载 - 从cpu.loadAverage获取
    loadAverage: data.cpu?.loadAverage || data.system?.load_average || data.system?.loadavg || '',

    // 运行时间和启动时间 - 从os对象获取
    uptime: data.os?.uptime || data.system?.uptime || '',
    bootTime: data.os?.bootTime || data.system?.boot_time || data.system?.bootTime || ''
  }
})

// 格式化负载平均值
const formatLoadAverage = (loadAvg) => {
  if (!loadAvg) return '-'
  if (Array.isArray(loadAvg)) {
    return loadAvg.slice(0, 3).map(val => parseFloat(val).toFixed(2)).join(', ')
  }
  if (typeof loadAvg === 'string') {
    return loadAvg
  }
  return parseFloat(loadAvg).toFixed(2)
}

// 格式化运行时间
const formatUptime = (uptime) => {
  if (!uptime) return '-'
  
  const seconds = parseInt(uptime)
  if (isNaN(seconds)) return uptime
  
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  
  if (days > 0) {
    return `${days}天 ${hours}小时 ${minutes}分钟`
  } else if (hours > 0) {
    return `${hours}小时 ${minutes}分钟`
  } else {
    return `${minutes}分钟`
  }
}

// 格式化日期时间
const formatDateTime = (timestamp) => {
  if (!timestamp) return '-'
  
  try {
    const date = new Date(timestamp * 1000) // 假设是Unix时间戳
    if (isNaN(date.getTime())) {
      // 如果不是时间戳，尝试直接解析
      const directDate = new Date(timestamp)
      if (isNaN(directDate.getTime())) return timestamp
      return directDate.toLocaleString('zh-CN')
    }
    return date.toLocaleString('zh-CN')
  } catch (error) {
    return timestamp
  }
}
</script>

<style scoped>
.system-info-section {
  /* 移除装饰样式，保持简洁 */
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 12px;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
  width: 100%;
  flex-shrink: 0;
  height: auto;
  margin-bottom: 0;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px; /* 减小底部间距 */
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

.system-icon {
  font-size: 16px;
  color: #3b82f6;
}

.info-grid {
  display: flex;
  flex-direction: column;
  /* gap: 3px; */
  flex: 1;
}

.info-item {
  display: flex;
  justify-content: flex-start;
  align-items: flex-start;
  border-radius: 0; /* 移除圆角 */
  flex-shrink: 0;
  min-height: 20px; /* 减小最小高度 */
  margin-bottom: 2px; /* 添加小间距 */
  gap: 8px; /* 添加标签和值之间的间距 */
}

.info-label {
  font-size: 11px; /* 缩小字体 */
  color: var(--monitoring-text-secondary, #b0b0b0);
  font-weight: 500;
  min-width: 60px;
  flex-shrink: 0;
  line-height: 1.3; /* 紧凑行高 */
  padding-top: 0; /* 移除顶部内边距 */
}

.info-value {
  font-size: 11px; /* 缩小字体 */
  color: var(--monitoring-text-primary, #e5e5e5);
  text-align: left;
  flex: 1;
  word-wrap: break-word;
  word-break: break-all;
  line-height: 1.3; /* 紧凑行高 */
}

/* 移除所有响应式样式，保持桌面端布局 */

/* 移除480px响应式样式，保持行内布局 */

/* 深色主题适配 */
@media (prefers-color-scheme: dark) {
  .system-info-section {
    --monitoring-panel-bg: rgba(255, 255, 255, 0.05);
    --monitoring-panel-border: rgba(255, 255, 255, 0.1);
    --monitoring-item-bg: rgba(255, 255, 255, 0.03);
    --monitoring-item-border: rgba(255, 255, 255, 0.05);
    --monitoring-item-hover-bg: rgba(255, 255, 255, 0.08);
    --monitoring-item-hover-border: rgba(255, 255, 255, 0.15);
    --monitoring-text-primary: #e5e5e5;
    --monitoring-text-secondary: #b0b0b0;
  }
}

/* 浅色主题适配 */
@media (prefers-color-scheme: light) {
  .system-info-section {
    --monitoring-panel-bg: rgba(0, 0, 0, 0.05);
    --monitoring-panel-border: rgba(0, 0, 0, 0.1);
    --monitoring-item-bg: rgba(0, 0, 0, 0.03);
    --monitoring-item-border: rgba(0, 0, 0, 0.05);
    --monitoring-item-hover-bg: rgba(0, 0, 0, 0.08);
    --monitoring-item-hover-border: rgba(0, 0, 0, 0.15);
    --monitoring-text-primary: #2c3e50;
    --monitoring-text-secondary: #6c757d;
  }
}
</style>
