<template>
  <!-- 移动端监控抽屉 -->
  <transition name="drawer-slide" appear>
    <div
      v-show="visible"
      class="mobile-monitoring-drawer"
      role="dialog"
      aria-label="移动端监控抽屉"
      :aria-hidden="!visible"
      tabindex="-1"
      @keydown.esc="onClose"
    >
      <div class="drawer-content">
        <!-- 系统信息 -->
        <div class="mobile-monitoring-section system-section">
          <system-info :monitoring-data="monitoringData" />
        </div>

        <!-- CPU监控 -->
        <div class="mobile-monitoring-section cpu-section">
          <cpu-monitoring :monitoring-data="monitoringData" />
        </div>

        <!-- 内存监控 -->
        <div class="mobile-monitoring-section memory-section">
          <memory-monitoring :monitoring-data="monitoringData" />
        </div>

        <!-- 网络监控 -->
        <div class="mobile-monitoring-section network-section">
          <network-monitoring :monitoring-data="monitoringData" />
        </div>

        <!-- 硬盘监控 -->
        <div class="mobile-monitoring-section disk-section">
          <disk-monitoring :monitoring-data="monitoringData" />
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
// 移除未使用的Vue导入
import SystemInfo from './SystemInfo.vue';
import CpuMonitoring from './CpuMonitoring.vue';
import MemoryMonitoring from './MemoryMonitoring.vue';
import NetworkMonitoring from './NetworkMonitoring.vue';
import DiskMonitoring from './DiskMonitoring.vue';

import { toRefs } from 'vue';
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
});

// Emits
const emit = defineEmits(['close', 'update:visible']);
const { visible } = toRefs(props);
const onClose = () => emit('close');

// 纯净的监控容器，无任何交互逻辑
</script>

<style scoped>
/* 左侧抽屉样式 - 从工具栏下方开始 */
.mobile-monitoring-drawer {
  position: fixed;
  top: var(--layout-header-height);
  left: 0;
  width: var(--monitoring-drawer-width, 80vw);
  max-width: var(--monitoring-drawer-max-width, 400px);
  height: calc(100vh - var(--layout-header-height));
  background: var(--monitoring-drawer-bg, rgba(0, 0, 0, 0.95));
  border-right: 1px solid var(--monitoring-drawer-border, rgba(255, 255, 255, 0.1));
  box-shadow: var(--monitoring-drawer-shadow, 4px 0 20px rgba(0, 0, 0, 0.3));
  z-index: var(--z-overlay);
  overflow: hidden;
  transform: translateZ(0);
  -webkit-overflow-scrolling: touch;
}

.drawer-content {
  height: 100%;
  overflow-y: auto;
  padding: 0;
  display: flex;
  flex-direction: column;
}

/* 移动端监控组件固定高度 */
.mobile-monitoring-section {
  flex-shrink: 0;
  overflow: hidden;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

/* 系统信息：200px */
.mobile-monitoring-section.system-section {
  height: 200px;
}

/* CPU：180px */
.mobile-monitoring-section.cpu-section {
  height: 180px;
}

/* 内存：150px */
.mobile-monitoring-section.memory-section {
  height: 150px;
}

/* 网络：180px */
.mobile-monitoring-section.network-section {
  height: 180px;
}

/* 硬盘：120px */
.mobile-monitoring-section.disk-section {
  height: 120px;
}

/* 抽屉滑入动画 */
.drawer-slide-enter-active,
.drawer-slide-leave-active {
  transition:
    transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    opacity 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  will-change: transform, opacity;
}

.drawer-slide-enter-from,
.drawer-slide-leave-to {
  transform: translate3d(-100%, 0, 0);
  opacity: 0;
}

.drawer-slide-enter-to,
.drawer-slide-leave-from {
  will-change: auto;
}

/* 移动端组件内部样式适配 */
.mobile-monitoring-section :deep(.monitor-section),
.mobile-monitoring-section :deep(.system-info-section) {
  height: 100%;
  margin: 0;
  border: none;
  border-radius: 0;
  background: transparent;
}

.mobile-monitoring-section :deep(.monitor-chart-container) {
  flex: 1;
  min-height: 0;
}
</style>
