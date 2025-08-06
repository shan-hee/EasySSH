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
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
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
  background: var(--monitor-bg-primary);
  border: 1px solid var(--monitor-border);
  border-radius: var(--monitor-radius-lg);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  transition: all var(--monitor-transition-normal);
  overflow: hidden;
  box-shadow: var(--monitor-shadow-lg);
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
  gap: var(--monitor-spacing-md);
  padding: var(--monitor-spacing-md);
  min-height: min-content;
  overflow-y: auto;
}

.monitoring-section {
  min-height: var(--monitor-component-height-md);
}

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
    gap: var(--monitor-spacing-md);
  }
}

@media (max-width: 768px) {
  .responsive-monitoring-panel {
    border-radius: var(--monitor-radius-md);
  }

  .monitoring-sections {
    gap: var(--monitor-spacing-md);
    padding: var(--monitor-spacing-md);
  }

  .monitoring-section {
    min-height: var(--monitor-component-height-sm);
  }
}

@media (max-width: 480px) {
  .monitoring-sections {
    gap: var(--monitor-spacing-sm);
    padding: var(--monitor-spacing-sm);
  }

  .monitoring-section {
    min-height: var(--monitor-component-height-xs);
  }
}

@media (max-width: 480px) {
  .panel-header {
    padding: 6px 12px;
  }
  
  .monitoring-sections {
    padding: 8px;
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
