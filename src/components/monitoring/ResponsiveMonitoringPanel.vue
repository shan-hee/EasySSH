<template>
  <transition name="panel-slide" appear>
    <div 
      v-if="visible" 
      class="responsive-monitoring-panel"
      :class="{
        'panel-mobile': isMobile,
        'panel-desktop': !isMobile
      }"
    >
      <!-- 监控内容区域 -->
      <div class="panel-content">
        <!-- 全局加载状态 -->
        <div v-if="showGlobalLoader" class="global-loader">
          <MonitoringLoader
            :state="globalState.connectionState"
            :error-message="globalState.errorMessage"
            :show-progress="true"
            :progress="loadingProgress"
            :loading-text="getLoadingText()"
            @retry="handleGlobalRetry"
          />
        </div>

        <!-- 监控组件区域 -->
        <div v-else class="monitoring-sections">
          <!-- 系统信息 -->
          <SystemInfo
            :monitoring-data="monitoringData"
            class="monitoring-section"
          />

          <!-- CPU监控 -->
          <CpuMonitoring
            :monitoring-data="monitoringData"
            class="monitoring-section"
          />

          <!-- 内存监控 -->
          <MemoryMonitoring
            :monitoring-data="monitoringData"
            class="monitoring-section"
          />

          <!-- 网络监控 -->
          <NetworkMonitoring
            :monitoring-data="monitoringData"
            class="monitoring-section"
          />

          <!-- 硬盘监控 -->
          <DiskMonitoring
            :monitoring-data="monitoringData"
            class="monitoring-section"
          />
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import SystemInfo from './SystemInfo.vue'
import CpuMonitoring from './CpuMonitoring.vue'
import MemoryMonitoring from './MemoryMonitoring.vue'
import NetworkMonitoring from './NetworkMonitoring.vue'
import DiskMonitoring from './DiskMonitoring.vue'
import MonitoringLoader from '../common/MonitoringLoader.vue'
import monitoringStateManager, { LoadingState } from '@/services/monitoringStateManager'

// Props
const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  monitoringData: {
    type: Object,
    default: () => ({})
  },
  terminalId: {
    type: String,
    default: ''
  }
})

// 响应式数据
const isMobile = ref(false)

// 状态管理
const globalState = computed(() => monitoringStateManager.getGlobalState())
const loadingProgress = computed(() => monitoringStateManager.getLoadingProgress())

// 是否显示全局加载器
const showGlobalLoader = computed(() => {
  const state = globalState.value.connectionState
  return state === LoadingState.INITIAL ||
         state === LoadingState.CONNECTING ||
         state === LoadingState.RECONNECTING ||
         (state === LoadingState.ERROR && !monitoringStateManager.hasAnyData())
})

// 获取加载文本
const getLoadingText = () => {
  const state = globalState.value.connectionState
  switch (state) {
    case LoadingState.INITIAL:
      return '初始化监控服务...'
    case LoadingState.CONNECTING:
      return '连接监控服务...'
    case LoadingState.RECONNECTING:
      return '重新连接中...'
    case LoadingState.ERROR:
      return '连接失败'
    default:
      return '加载监控数据...'
  }
}

// 全局重试处理
const handleGlobalRetry = () => {
  monitoringStateManager.retry()
}

// 检测屏幕尺寸
const checkScreenSize = () => {
  isMobile.value = window.innerWidth < 768
}



// 窗口大小变化监听器
let resizeObserver = null

// 移除重复的状态管理器设置，由 Terminal.vue 统一处理
// 避免多个组件重复调用 setTerminal 导致的重复事件处理

// 生命周期
onMounted(() => {
  checkScreenSize()

  // 监听窗口大小变化
  window.addEventListener('resize', checkScreenSize)

  // 使用ResizeObserver监听更精确的尺寸变化
  if (window.ResizeObserver) {
    resizeObserver = new ResizeObserver(() => {
      checkScreenSize()
    })
    resizeObserver.observe(document.body)
  }

  // 移除重复的状态管理器设置，由 Terminal.vue 统一处理
})

onUnmounted(() => {
  window.removeEventListener('resize', checkScreenSize)
  if (resizeObserver) {
    resizeObserver.disconnect()
  }
})

// 监听面板可见性变化
watch(() => props.visible, (newVisible) => {
  if (newVisible) {
    checkScreenSize()
  }
})
</script>

<style scoped>
/* 导入监控主题样式 */
@import '@/assets/styles/themes/monitoring-theme.css';

.responsive-monitoring-panel {
  /* 移除所有装饰样式，保持简洁 */
  background: transparent;
  border: none;
  border-radius: 0;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  transition: all var(--monitor-transition-normal);
  overflow: visible; /* 允许悬浮提示显示 */
  box-shadow: none;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.panel-desktop {
  height: 100%;
}

.panel-mobile {
  height: 100%;
}


.panel-content {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

/* 全局加载器样式 */
.global-loader {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  padding: var(--monitor-spacing-xl);
}

.monitoring-sections {
  display: flex;
  flex-direction: column;
  gap: 0; /* 完全移除组件间距 */
  padding: 0; /* 移除容器内边距 */
  height: auto; /* 改为自动高度，不强制铺满 */
  overflow: visible; /* 允许悬浮提示显示 */
}

.monitoring-section {
  flex: none; /* 移除自动分配空间，使用内容自然高度 */
  min-height: 120px; /* 设置最小高度，确保内容可见 */
  max-height: 180px; /* 默认最大高度 */
  display: flex;
  flex-direction: column;
  overflow: visible; /* 允许悬浮提示显示 */
  padding: 0 var(--monitor-spacing-md); /* 默认只有左右padding */
}

/* 特定模块的高度调整 */
.monitoring-section:has([class*="memory"]) {
  max-height: 160px; /* 内存模块：160px */
}

.monitoring-section:has([class*="system"]) {
  max-height: 200px; /* 系统信息模块：200px */
}

/* 第一个模块：上padding + 左右padding */
.monitoring-section:first-child {
  padding: var(--monitor-spacing-md) var(--monitor-spacing-md) 0 var(--monitor-spacing-md);
}

/* 最后一个模块：下padding + 左右padding */
.monitoring-section:last-child {
  padding: 0 var(--monitor-spacing-md) var(--monitor-spacing-md) var(--monitor-spacing-md);
}

/* 如果只有一个模块，则保留完整padding */
.monitoring-section:only-child {
  padding: var(--monitor-spacing-md);
}

/* 移除特殊组件高度调整，让所有组件使用统一的自然高度 */
/* 如果需要特殊调整，可以在各组件内部处理 */

/* 过渡动画 */
.panel-slide-enter-active,
.panel-slide-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.panel-slide-enter-from {
  opacity: 0;
  transform: translateY(-20px);
  max-height: 0;
}

.panel-slide-leave-to {
  opacity: 0;
  transform: translateY(-20px);
  max-height: 0;
}

/* 移除所有响应式样式，保持桌面端布局 */

/* 已移除所有响应式样式 */

/* 深色主题适配 */
@media (prefers-color-scheme: dark) {
  .responsive-monitoring-panel {
    --monitoring-panel-bg: rgba(0, 0, 0, 0.8);
    --monitoring-panel-border: rgba(255, 255, 255, 0.1);
    --monitoring-header-bg: rgba(255, 255, 255, 0.05);
    --monitoring-header-border: rgba(255, 255, 255, 0.1);
    --monitoring-item-hover-bg: rgba(255, 255, 255, 0.1);
    --monitoring-text-primary: #e5e5e5;
    --monitoring-text-secondary: #b0b0b0;
  }
}

/* 浅色主题适配 */
@media (prefers-color-scheme: light) {
  .responsive-monitoring-panel {
    --monitoring-panel-bg: rgba(255, 255, 255, 0.9);
    --monitoring-panel-border: rgba(0, 0, 0, 0.1);
    --monitoring-header-bg: rgba(0, 0, 0, 0.05);
    --monitoring-header-border: rgba(0, 0, 0, 0.1);
    --monitoring-item-hover-bg: rgba(0, 0, 0, 0.1);
    --monitoring-text-primary: #2c3e50;
    --monitoring-text-secondary: #6c757d;
  }
}

/* 强制主题样式（覆盖系统检测） */
.responsive-monitoring-panel[data-theme="dark"] {
  --monitoring-panel-bg: rgba(0, 0, 0, 0.8);
  --monitoring-panel-border: rgba(255, 255, 255, 0.1);
  --monitoring-header-bg: rgba(255, 255, 255, 0.05);
  --monitoring-header-border: rgba(255, 255, 255, 0.1);
  --monitoring-item-hover-bg: rgba(255, 255, 255, 0.1);
  --monitoring-text-primary: #e5e5e5;
  --monitoring-text-secondary: #b0b0b0;
}

.responsive-monitoring-panel[data-theme="light"] {
  --monitoring-panel-bg: rgba(255, 255, 255, 0.9);
  --monitoring-panel-border: rgba(0, 0, 0, 0.1);
  --monitoring-header-bg: rgba(0, 0, 0, 0.05);
  --monitoring-header-border: rgba(0, 0, 0, 0.1);
  --monitoring-item-hover-bg: rgba(0, 0, 0, 0.1);
  --monitoring-text-primary: #2c3e50;
  --monitoring-text-secondary: #6c757d;
}
</style>
