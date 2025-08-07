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
        <div class="monitoring-sections">
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
import { ref, onMounted, onUnmounted, watch } from 'vue'
import SystemInfo from './SystemInfo.vue'
import CpuMonitoring from './CpuMonitoring.vue'
import MemoryMonitoring from './MemoryMonitoring.vue'
import NetworkMonitoring from './NetworkMonitoring.vue'
import DiskMonitoring from './DiskMonitoring.vue'

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

// 检测屏幕尺寸
const checkScreenSize = () => {
  isMobile.value = window.innerWidth < 768
}



// 窗口大小变化监听器
let resizeObserver = null

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

/* 响应式设计 */
@media (max-width: 1024px) {
  .monitoring-sections {
    gap: 0; /* 保持无间距 */
    padding: 0; /* 保持无容器内边距 */
  }

  .monitoring-section {
    min-height: 110px; /* 稍微减小最小高度 */
    max-height: 160px; /* 平板端默认最大高度 */
    padding: 0 var(--monitor-spacing-sm); /* 减小左右padding */
  }

  /* 平板端特定模块的高度调整 */
  .monitoring-section:has([class*="memory"]) {
    max-height: 140px; /* 内存模块：140px */
  }

  .monitoring-section:has([class*="system"]) {
    max-height: 180px; /* 系统信息模块：180px */
  }

  /* 第一个模块：上padding + 左右padding */
  .monitoring-section:first-child {
    padding: var(--monitor-spacing-sm) var(--monitor-spacing-sm) 0 var(--monitor-spacing-sm);
  }

  /* 最后一个模块：下padding + 左右padding */
  .monitoring-section:last-child {
    padding: 0 var(--monitor-spacing-sm) var(--monitor-spacing-sm) var(--monitor-spacing-sm);
  }

  /* 如果只有一个模块，则保留完整padding */
  .monitoring-section:only-child {
    padding: var(--monitor-spacing-sm);
  }
}

@media (max-width: 768px) {
  .responsive-monitoring-panel {
    border-radius: 0; /* 移除圆角 */
  }

  .monitoring-sections {
    gap: 0; /* 保持无间距 */
    padding: 0; /* 保持无容器内边距 */
  }

  .monitoring-section {
    min-height: 100px; /* 移动端减小最小高度 */
    max-height: 140px; /* 移动端默认最大高度 */
    padding: 0 var(--monitor-spacing-sm); /* 移动端左右padding */
  }

  /* 移动端特定模块的高度调整 */
  .monitoring-section:has([class*="memory"]) {
    max-height: 120px; /* 内存模块：120px */
  }

  .monitoring-section:has([class*="system"]) {
    max-height: 160px; /* 系统信息模块：160px */
  }

  /* 第一个模块：上padding + 左右padding */
  .monitoring-section:first-child {
    padding: var(--monitor-spacing-sm) var(--monitor-spacing-sm) 0 var(--monitor-spacing-sm);
  }

  /* 最后一个模块：下padding + 左右padding */
  .monitoring-section:last-child {
    padding: 0 var(--monitor-spacing-sm) var(--monitor-spacing-sm) var(--monitor-spacing-sm);
  }

  /* 如果只有一个模块，则保留完整padding */
  .monitoring-section:only-child {
    padding: var(--monitor-spacing-sm);
  }
}

@media (max-width: 480px) {
  .monitoring-sections {
    gap: 0; /* 保持无间距 */
    padding: 0; /* 保持无容器内边距 */
  }

  .monitoring-section {
    min-height: 90px; /* 小屏幕进一步减小最小高度 */
    max-height: 120px; /* 小屏幕默认最大高度 */
    padding: 0 var(--monitor-spacing-xs); /* 小屏幕最小左右padding */
  }

  /* 小屏幕特定模块的高度调整 */
  .monitoring-section:has([class*="memory"]) {
    max-height: 110px; /* 内存模块：110px */
  }

  .monitoring-section:has([class*="system"]) {
    max-height: 140px; /* 系统信息模块：140px */
  }

  /* 第一个模块：上padding + 左右padding */
  .monitoring-section:first-child {
    padding: var(--monitor-spacing-xs) var(--monitor-spacing-xs) 0 var(--monitor-spacing-xs);
  }

  /* 最后一个模块：下padding + 左右padding */
  .monitoring-section:last-child {
    padding: 0 var(--monitor-spacing-xs) var(--monitor-spacing-xs) var(--monitor-spacing-xs);
  }

  /* 如果只有一个模块，则保留完整padding */
  .monitoring-section:only-child {
    padding: var(--monitor-spacing-xs);
  }

  .panel-header {
    padding: 6px 12px;
  }

  .monitoring-sections {
    padding: 0; /* 移除内边距 */
  }

  .panel-content {
    height: calc(100% - 40px);
  }
}

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
