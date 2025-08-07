<template>
  <!-- 纯净的监控容器 -->
  <div v-if="visible" class="mobile-monitoring-drawer">
    <!-- 系统信息 -->
    <SystemInfo
      :monitoring-data="monitoringData"
    />

    <!-- CPU监控 -->
    <CpuMonitoring
      :monitoring-data="monitoringData"
    />

    <!-- 内存监控 -->
    <MemoryMonitoring
      :monitoring-data="monitoringData"
    />

    <!-- 网络监控 -->
    <NetworkMonitoring
      :monitoring-data="monitoringData"
    />

    <!-- 硬盘监控 -->
    <DiskMonitoring
      :monitoring-data="monitoringData"
    />
  </div>
</template>

<script setup>
// 移除未使用的Vue导入
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

// Emits
const emit = defineEmits(['close', 'update:visible'])

// 纯净的监控容器，无任何交互逻辑
</script>

<style scoped>
/* 左侧抽屉样式 - 从工具栏下方开始 */
.mobile-monitoring-drawer {
  position: fixed;
  top: 45px; /* 工具栏高度 */
  left: 0;
  width: 80vw; /* 占屏幕宽度的80% */
  max-width: 400px; /* 最大宽度限制 */
  height: calc(100vh - 45px); /* 减去工具栏高度 */
  background: rgba(0, 0, 0, 0.95);
  border-right: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 4px 0 20px rgba(0, 0, 0, 0.3);
  z-index: 9999;
  overflow-y: auto;
}
</style>
