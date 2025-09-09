<template>
  <div class="system-info-section">
    <!-- 系统信息标题 -->
    <div class="section-header">
      <div class="section-title">
        <monitoring-icon
          name="system-info"
          :size="16"
          class="system-icon"
        />
        <span>系统信息</span>
      </div>
    </div>

    <!-- 统一加载指示器 -->
    <monitoring-loader
      v-if="!componentState.hasData"
      :state="componentState.state"
      :error-message="componentState.error"
      :skeleton-type="'info'"
      :loading-text="'加载系统信息...'"
      @retry="handleRetry"
    />

    <div
      v-show="componentState.hasData"
      class="info-grid"
    >
      <div
        v-if="systemInfo.os"
        class="info-item"
      >
        <span class="info-label">系统类型</span>
        <span class="info-value">{{ systemInfo.os }}</span>
      </div>

      <div
        v-if="systemInfo.hostname"
        class="info-item"
      >
        <span class="info-label">主机名</span>
        <span class="info-value">{{ systemInfo.hostname }}</span>
      </div>

      <div
        v-if="systemInfo.cpuModel"
        class="info-item"
      >
        <span class="info-label">CPU型号</span>
        <span class="info-value">{{ systemInfo.cpuModel }}</span>
      </div>

      <div
        v-if="systemInfo.architecture"
        class="info-item"
      >
        <span class="info-label">系统架构</span>
        <span class="info-value">{{ systemInfo.architecture }}</span>
      </div>

      <!-- CPU核心信息已隐藏 -->

      <div
        v-if="systemInfo.loadAverage"
        class="info-item"
      >
        <span class="info-label">系统负载</span>
        <span class="info-value">{{ formatLoadAverage(systemInfo.loadAverage) }}</span>
      </div>

      <div
        v-if="systemInfo.uptime"
        class="info-item"
      >
        <span class="info-label">运行时间</span>
        <span class="info-value">{{ formatUptime(systemInfo.uptime) }}</span>
      </div>

      <div
        v-if="systemInfo.bootTime"
        class="info-item"
      >
        <span class="info-label">启动时间</span>
        <span class="info-value">{{ formatDateTime(systemInfo.bootTime) }}</span>
      </div>

      <div
        v-if="systemInfo.internalIp"
        class="info-item"
      >
        <span class="info-label">内网IP</span>
        <span class="info-value">{{ systemInfo.internalIp }}</span>
      </div>

      <div
        v-if="systemInfo.publicIp"
        class="info-item"
      >
        <span class="info-label">公网IP</span>
        <span class="info-value">{{ systemInfo.publicIp }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import MonitoringIcon from './MonitoringIcon.vue';
import MonitoringLoader from '../common/MonitoringLoader.vue';
import monitoringStateManager, { MonitoringComponent } from '@/services/monitoringStateManager';

// Props
const props = defineProps({
  monitoringData: {
    type: Object,
    default: () => ({})
  },
  stateManager: {
    type: Object,
    default: null
  }
});

// 使用传入的状态管理器实例，如果没有则使用全局实例（向后兼容）
const currentStateManager = computed(() => props.stateManager || monitoringStateManager);

// 使用当前状态管理器
const componentState = computed(() => {
  return currentStateManager.value.getComponentState(MonitoringComponent.SYSTEM_INFO);
});

// 重试处理
const handleRetry = () => {
  currentStateManager.value.retry();
};

// 系统信息数据
const systemInfo = computed(() => {
  const data = props.monitoringData;

  // 监控数据处理（不输出日志，用户可在WebSocket中查看）

  return {
    // 操作系统信息 - 新格式
    os: data.os?.release || data.os?.platform || data.system?.os || '',
    hostname: data.os?.hostname || data.system?.hostname || '',
    architecture: data.os?.arch || data.system?.arch || data.system?.architecture || '',

    // CPU信息 - 从cpu对象获取
    cpuModel: data.cpu?.model || data.system?.cpu_model || '',
    cpuCores: data.cpu?.cores || data.system?.cpu_cores || '',

    // 系统负载 - 从cpu.loadAverage获取
    loadAverage: data.cpu?.loadAverage || data.system?.load_average || data.system?.loadavg || '',

    // 运行时间和启动时间 - 从os对象获取
    uptime: data.os?.uptime || data.system?.uptime || '',
    bootTime: data.os?.bootTime || data.system?.boot_time || data.system?.bootTime || '',

    // IP地址信息 - 新增
    internalIp: data.ip?.internal || '',
    publicIp: data.ip?.public || ''
  };
});

// 格式化负载平均值
const formatLoadAverage = loadAvg => {
  if (!loadAvg) return '-';

  // 处理对象格式 {load1: 2.5, load5: 0.98, load15: 0.48}
  if (typeof loadAvg === 'object' && !Array.isArray(loadAvg)) {
    const load1 = parseFloat(loadAvg.load1 || 0).toFixed(2);
    const load5 = parseFloat(loadAvg.load5 || 0).toFixed(2);
    const load15 = parseFloat(loadAvg.load15 || 0).toFixed(2);
    return `${load1}, ${load5}, ${load15}`;
  }

  // 处理数组格式
  if (Array.isArray(loadAvg)) {
    return loadAvg
      .slice(0, 3)
      .map(val => parseFloat(val).toFixed(2))
      .join(', ');
  }

  // 处理字符串格式
  if (typeof loadAvg === 'string') {
    return loadAvg;
  }

  // 处理单个数值
  return parseFloat(loadAvg).toFixed(2);
};

// 格式化运行时间
const formatUptime = uptime => {
  if (!uptime) return '-';

  const seconds = parseInt(uptime);
  if (isNaN(seconds)) return uptime;

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}天 ${hours}小时 ${minutes}分钟`;
  } else if (hours > 0) {
    return `${hours}小时 ${minutes}分钟`;
  } else {
    return `${minutes}分钟`;
  }
};

// 格式化日期时间
const formatDateTime = timestamp => {
  if (!timestamp) return '-';

  try {
    const date = new Date(timestamp * 1000); // 假设是Unix时间戳
    if (isNaN(date.getTime())) {
      // 如果不是时间戳，尝试直接解析
      const directDate = new Date(timestamp);
      if (isNaN(directDate.getTime())) return timestamp;
      return directDate.toLocaleString('zh-CN');
    }
    return date.toLocaleString('zh-CN');
  } catch (error) {
    return timestamp;
  }
};
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
  height: 100%; /* 使用父容器的固定高度 */
  overflow: hidden; /* 防止内容溢出 */
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
  color: var(--monitor-text-primary, var(--color-text-primary, #e5e5e5));
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
  font-size: 12px;
  color: var(--monitor-text-secondary, var(--color-text-secondary, #b0b0b0));
  font-weight: 500;
  min-width: 60px;
  flex-shrink: 0;
  line-height: 1.4;
  padding-top: 0;
}

.info-value {
  font-size: 12px;
  color: var(--monitor-text-primary, var(--color-text-primary, #e5e5e5));
  text-align: left;
  flex: 1;
  word-wrap: break-word;
  word-break: break-all;
  line-height: 1.4;
  font-weight: 400;
}

/* 移除所有响应式样式，保持桌面端布局 */

/* 移除480px响应式样式，保持行内布局 */

/* 主题适配 - 使用统一的主题变量 */
:root[data-theme='dark'] .system-info-section,
.dark-theme .system-info-section {
  --monitor-text-primary: #e5e5e5;
  --monitor-text-secondary: #b0b0b0;
}

:root[data-theme='light'] .system-info-section,
.light-theme .system-info-section {
  --monitor-text-primary: #303133;
  --monitor-text-secondary: #606266;
}

/* 系统图标主题适配 */
:root[data-theme='dark'] .system-icon,
.dark-theme .system-icon {
  color: #3b82f6;
}

:root[data-theme='light'] .system-icon,
.light-theme .system-icon {
  color: #1890ff;
}
</style>
