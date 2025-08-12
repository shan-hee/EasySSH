<template>
  <transition name="panel-slide" appear>
    <div
      v-show="visible"
      class="responsive-monitoring-panel"
      :class="{
        'panel-mobile': isMobile,
        'panel-desktop': !isMobile
      }"
      role="complementary"
      :aria-label="isMobile ? '移动端监控面板' : '桌面端监控面板'"
      :aria-hidden="!visible"
      tabindex="-1"
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
            :state-manager="currentStateManager"
            class="monitoring-section"
          />

          <!-- CPU监控 -->
          <CpuMonitoring
            :monitoring-data="monitoringData"
            :state-manager="currentStateManager"
            class="monitoring-section"
          />

          <!-- 内存监控 -->
          <MemoryMonitoring
            :monitoring-data="monitoringData"
            :state-manager="currentStateManager"
            class="monitoring-section"
          />

          <!-- 网络监控 -->
          <NetworkMonitoring
            :monitoring-data="monitoringData"
            :state-manager="currentStateManager"
            class="monitoring-section"
          />

          <!-- 硬盘监控 -->
          <DiskMonitoring
            :monitoring-data="monitoringData"
            :state-manager="currentStateManager"
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
  },
  stateManager: {
    type: Object,
    default: null
  }
})

// 响应式数据
const isMobile = ref(false)

// 状态管理 - 使用传入的状态管理器实例，如果没有则使用全局实例（向后兼容）
const currentStateManager = computed(() => props.stateManager || monitoringStateManager)
const globalState = computed(() => currentStateManager.value.getGlobalState())
const loadingProgress = computed(() => currentStateManager.value.getLoadingProgress())

// 是否显示全局加载器
const showGlobalLoader = computed(() => {
  const globalStateValue = globalState.value
  if (!globalStateValue) return true

  const state = globalStateValue.connectionState
  return state === LoadingState.INITIAL ||
         state === LoadingState.CONNECTING ||
         state === LoadingState.RECONNECTING ||
         (state === LoadingState.ERROR && !currentStateManager.value.hasAnyData())
})





// 获取加载文本
const getLoadingText = () => {
  const globalStateValue = globalState.value
  if (!globalStateValue) return '加载中...'

  const state = globalStateValue.connectionState
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
  currentStateManager.value.retry()
}

// 检测屏幕尺寸
const checkScreenSize = () => {
  isMobile.value = window.innerWidth < 768 ||
                   /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
}



// 窗口大小变化监听器
let resizeObserver = null

// 移除重复的状态管理器设置，由 Terminal.vue 统一处理
// 避免多个组件重复调用 setTerminal 导致的重复事件处理

// 生命周期
// 防抖的resize处理函数
let resizeTimer = null
const debouncedCheckScreenSize = () => {
  if (resizeTimer) clearTimeout(resizeTimer)
  resizeTimer = setTimeout(checkScreenSize, 150)
}

onMounted(() => {
  checkScreenSize()
  window.addEventListener('resize', debouncedCheckScreenSize, { passive: true })

  // 使用ResizeObserver监听更精确的尺寸变化
  if (window.ResizeObserver) {
    resizeObserver = new ResizeObserver(debouncedCheckScreenSize)
    resizeObserver.observe(document.body)
  }
})

onUnmounted(() => {
  if (resizeTimer) {
    clearTimeout(resizeTimer)
    resizeTimer = null
  }

  window.removeEventListener('resize', debouncedCheckScreenSize)

  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
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
  flex: none; /* 移除自动分配空间，使用固定高度 */
  display: flex;
  flex-direction: column;
  overflow: hidden; /* 防止内容溢出 */
  padding: 0 var(--monitor-spacing-md); /* 默认只有左右padding */
}

/* 监控组件基础样式 */
.monitoring-section {
  overflow: hidden;
  transform: translateZ(0);
  contain: layout style paint;
}

/* 固定各组件高度 */
.monitoring-section:nth-child(1) { height: 200px; } /* 系统信息 */
.monitoring-section:nth-child(2) { height: 180px; } /* CPU */
.monitoring-section:nth-child(3) { height: 150px; } /* 内存 */
.monitoring-section:nth-child(4) { height: 180px; } /* 网络 */
.monitoring-section:nth-child(5) { height: 120px; } /* 硬盘 */

/* 移动端适配 */
.panel-mobile .monitoring-section {
  border-bottom: 1px solid var(--monitoring-panel-border, rgba(255, 255, 255, 0.1));
}

/* 监控面板滑入滑出动画 - 只在visible状态变化时触发 */
.panel-slide-enter-active {
  transition: transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94),
              opacity 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  /* 启用硬件加速 */
  will-change: transform, opacity;
  transform: translateZ(0);
  backface-visibility: hidden;
}

.panel-slide-leave-active {
  transition: transform 0.3s cubic-bezier(0.55, 0.055, 0.675, 0.19),
              opacity 0.3s cubic-bezier(0.55, 0.055, 0.675, 0.19);
  /* 启用硬件加速 */
  will-change: transform, opacity;
  transform: translateZ(0);
  backface-visibility: hidden;
}

/* 桌面端从左侧滑入 */
.panel-desktop.panel-slide-enter-from {
  transform: translate3d(-100%, 0, 0);
  opacity: 0;
}

.panel-desktop.panel-slide-leave-to {
  transform: translate3d(-100%, 0, 0);
  opacity: 0;
}

/* 移动端从下方滑入（如果需要不同效果） */
.panel-mobile.panel-slide-enter-from {
  transform: translate3d(0, 100%, 0);
  opacity: 0;
}

.panel-mobile.panel-slide-leave-to {
  transform: translate3d(0, 100%, 0);
  opacity: 0;
}

/* 动画完成后清理will-change */
.panel-slide-enter-to,
.panel-slide-leave-from {
  will-change: auto;
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

/* 过渡动画已移除，使用简单的显示/隐藏避免切换时重叠 */

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
