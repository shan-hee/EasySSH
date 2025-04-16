<!--
  系统监控面板组件
  用于展示系统、CPU、内存和硬盘的使用情况
-->
<template>
  <div class="monitoring-panel" :class="{ 'closing': isClosing }">
    <div class="panel-header">
      <h2>系统监控</h2>
      <button class="close-button" @click="closePanel">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18">
          <path fill="#ffffff" d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"></path>
        </svg>
      </button>
    </div>

    <div class="panel-content">
      <!-- 系统信息 -->
      <div class="section">
        <h3>系统信息</h3>
        <div class="info-list">
          <div class="info-item">
            <span class="info-label">主机名：</span>
            <span class="info-value">{{ systemInfo.hostname }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">系统：</span>
            <span class="info-value">{{ systemInfo.platform }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">运行时间：</span>
            <span class="info-value">{{ systemInfo.uptime }}</span>
          </div>
        </div>
      </div>

      <!-- CPU使用率 -->
      <div class="section">
        <h3>CPU使用率</h3>
        <div class="progress-container">
          <div class="progress-bar-container">
            <div class="progress-bar" :style="{ width: `${cpuUsage}%` }" :class="getProgressBarClass(cpuUsage)"></div>
          </div>
          <div class="progress-value">{{ cpuUsage }}%</div>
        </div>
        <div class="core-list">
          <div v-for="(core, index) in cpuCores" :key="index" class="core-item">
            <div class="core-label">核心 {{ index + 1 }}</div>
            <div class="core-progress-container">
              <div class="core-progress-bar" :style="{ width: `${core}%` }" :class="getProgressBarClass(core)"></div>
            </div>
            <div class="core-value">{{ core }}%</div>
          </div>
        </div>
      </div>

      <!-- 内存使用情况 -->
      <div class="section">
        <h3>内存使用情况</h3>
        <div class="progress-container">
          <div class="progress-bar-container">
            <div class="progress-bar" :style="{ width: `${memoryUsage.percentage}%` }" :class="getProgressBarClass(memoryUsage.percentage)"></div>
          </div>
          <div class="progress-value">{{ memoryUsage.percentage }}%</div>
        </div>
        <div class="memory-detail">
          <div class="memory-item">
            <span class="memory-label">已使用：</span>
            <span class="memory-value">{{ memoryUsage.used }}</span>
          </div>
          <div class="memory-item">
            <span class="memory-label">总内存：</span>
            <span class="memory-value">{{ memoryUsage.total }}</span>
          </div>
          <div class="memory-item">
            <span class="memory-label">可用：</span>
            <span class="memory-value">{{ memoryUsage.free }}</span>
          </div>
        </div>
      </div>

      <!-- 磁盘使用情况 -->
      <div class="section">
        <h3>磁盘使用情况</h3>
        <div v-for="(disk, index) in diskUsage" :key="index" class="disk-item">
          <div class="disk-header">
            <span class="disk-name">{{ disk.name }}</span>
            <span class="disk-value">{{ disk.percentage }}%</span>
          </div>
          <div class="progress-bar-container">
            <div class="progress-bar" :style="{ width: `${disk.percentage}%` }" :class="getProgressBarClass(disk.percentage)"></div>
          </div>
          <div class="disk-detail">
            <span class="disk-detail-item">已用: {{ disk.used }}</span>
            <span class="disk-detail-item">总容量: {{ disk.total }}</span>
            <span class="disk-detail-item">可用: {{ disk.free }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { defineComponent, ref, onMounted, onUnmounted } from 'vue'

export default defineComponent({
  name: 'MonitoringPanel',
  emits: ['close'],
  setup(props, { emit }) {
    // 系统信息
    const systemInfo = ref({
      hostname: 'Server001',
      platform: 'Linux CentOS 7.9',
      uptime: '10天 5小时 30分钟'
    })

    // 添加关闭动画状态
    const isClosing = ref(false)

    // 处理关闭面板
    const closePanel = () => {
      isClosing.value = true
      
      // 等待动画完成后再通知父组件关闭
      setTimeout(() => {
        emit('close')
      }, 300) // 与动画持续时间一致
    }

    // CPU使用率
    const cpuUsage = ref(0)
    const cpuCores = ref([])

    // 内存使用情况
    const memoryUsage = ref({
      percentage: 0,
      total: '0 GB',
      used: '0 GB',
      free: '0 GB'
    })

    // 磁盘使用情况
    const diskUsage = ref([])

    // 更新数据定时器
    let updateTimer = null

    // 更新系统信息
    const updateSystemInfo = () => {
      // 在实际应用中，这里应该从后端API获取真实数据
      // 这里使用模拟数据进行演示
      
      // 更新系统运行时间
      const uptimeHours = Math.floor(Math.random() * 24 * 30) // 0-720小时
      const days = Math.floor(uptimeHours / 24)
      const hours = uptimeHours % 24
      const minutes = Math.floor(Math.random() * 60)
      systemInfo.value.uptime = `${days}天 ${hours}小时 ${minutes}分钟`
    }

    // 更新CPU使用率
    const updateCpuUsage = () => {
      // 模拟CPU总体使用率
      cpuUsage.value = Math.floor(Math.random() * 100)
      
      // 模拟CPU各核心使用率
      const coreCount = 8 // 假设8个核心
      const cores = []
      for (let i = 0; i < coreCount; i++) {
        cores.push(Math.floor(Math.random() * 100))
      }
      cpuCores.value = cores
    }

    // 更新内存使用情况
    const updateMemoryUsage = () => {
      const totalMemory = 16 // 假设16GB内存
      const usedPercentage = Math.floor(Math.random() * 100)
      const usedMemory = (totalMemory * usedPercentage / 100).toFixed(2)
      const freeMemory = (totalMemory - usedMemory).toFixed(2)
      
      memoryUsage.value = {
        percentage: usedPercentage,
        total: `${totalMemory} GB`,
        used: `${usedMemory} GB`,
        free: `${freeMemory} GB`
      }
    }

    // 更新磁盘使用情况
    const updateDiskUsage = () => {
      // 模拟多个磁盘数据
      const disks = [
        {
          name: '/ (根目录)',
          total: '500 GB',
          used: '0 GB',
          free: '0 GB',
          percentage: 0
        },
        {
          name: '/home',
          total: '1000 GB',
          used: '0 GB',
          free: '0 GB',
          percentage: 0
        },
        {
          name: '/var',
          total: '250 GB',
          used: '0 GB',
          free: '0 GB',
          percentage: 0
        }
      ]
      
      // 为每个磁盘生成随机使用率
      disks.forEach(disk => {
        const percentage = Math.floor(Math.random() * 100)
        const totalGB = parseInt(disk.total)
        const usedGB = (totalGB * percentage / 100).toFixed(1)
        const freeGB = (totalGB - usedGB).toFixed(1)
        
        disk.percentage = percentage
        disk.used = `${usedGB} GB`
        disk.free = `${freeGB} GB`
      })
      
      diskUsage.value = disks
    }

    // 更新所有数据
    const updateAllData = () => {
      updateSystemInfo()
      updateCpuUsage()
      updateMemoryUsage()
      updateDiskUsage()
    }

    // 获取进度条样式类
    const getProgressBarClass = (percentage) => {
      if (percentage < 60) return 'progress-normal'
      if (percentage < 80) return 'progress-warning'
      return 'progress-danger'
    }

    // 格式化时间戳
    const formatTimestamp = (timestamp) => {
      if (!timestamp) return '未知'
      
      const date = new Date(timestamp)
      const hours = date.getHours().toString().padStart(2, '0')
      const minutes = date.getMinutes().toString().padStart(2, '0')
      const seconds = date.getSeconds().toString().padStart(2, '0')
      
      return `${hours}:${minutes}:${seconds}`
    }

    // 组件挂载时初始化数据并启动定时更新
    onMounted(() => {
      // 初始化数据
      updateAllData()
      
      // 设置定时器，每2秒更新一次数据
      updateTimer = setInterval(updateAllData, 2000)
    })

    // 组件卸载时清除定时器
    onUnmounted(() => {
      if (updateTimer) {
        clearInterval(updateTimer)
        updateTimer = null
      }
    })

    return {
      systemInfo,
      cpuUsage,
      cpuCores,
      memoryUsage,
      diskUsage,
      getProgressBarClass,
      isClosing,
      closePanel,
      formatTimestamp
    }
  }
})
</script>

<style scoped>
.monitoring-panel {
  width: 450px;
  height: 100%;
  background-color: #1e1e1e;
  color: #f0f0f0;
  border-left: 1px solid #333;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: fixed;
  top: 45px; /* 保持在顶部工具栏下方的位置 */
  right: 0;
  bottom: 0;
  z-index: 9999; /* 高z-index确保在最上层 */
  box-shadow: -2px 0 10px rgba(0, 0, 0, 0.3);
  animation: slide-in 0.3s ease-out forwards;
  pointer-events: auto; /* 确保可以接收点击事件 */
}

@keyframes slide-in {
  from {
    transform: translateX(100%);
  }
  to {
    transform: translateX(0);
  }
}

@keyframes slide-out {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(100%);
  }
}

.monitoring-panel.closing {
  animation: slide-out 0.3s ease-out forwards;
}

.panel-header {
  padding: 10px 16px;
  border-bottom: 1px solid #333;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: #252525;
}

.panel-header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 500;
}

.close-button {
  background: none;
  border: none;
  cursor: pointer;
  color: #fff;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin-right: -6px;
  transition: background-color 0.2s ease;
}

.close-button:hover {
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 0 16px 16px;
  scrollbar-width: thin;
  scrollbar-color: #444 #1e1e1e;
}

.panel-content::-webkit-scrollbar {
  width: 8px;
}

.panel-content::-webkit-scrollbar-track {
  background: #1e1e1e;
}

.panel-content::-webkit-scrollbar-thumb {
  background-color: #444;
  border-radius: 4px;
}

.section {
  margin-top: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid #333;
}

.section:last-child {
  border-bottom: none;
}

.section h3 {
  margin: 0 0 12px 0;
  font-size: 14px;
  font-weight: 500;
  color: #bbb;
}

/* 系统信息样式 */
.info-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.info-item {
  display: flex;
}

.info-label {
  width: 80px;
  color: #aaa;
  flex-shrink: 0;
}

.info-value {
  flex: 1;
}

/* 进度条样式 */
.progress-container {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.progress-bar-container {
  flex: 1;
  height: 8px;
  background-color: #333;
  border-radius: 4px;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
}

.progress-normal {
  background-color: #409eff;
}

.progress-warning {
  background-color: #e6a23c;
}

.progress-danger {
  background-color: #f56c6c;
}

.progress-value {
  width: 45px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* CPU核心列表样式 */
.core-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.core-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.core-label {
  width: 60px;
  font-size: 12px;
  color: #aaa;
  flex-shrink: 0;
}

.core-progress-container {
  flex: 1;
  height: 6px;
  background-color: #333;
  border-radius: 3px;
  overflow: hidden;
}

.core-progress-bar {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
}

.core-value {
  width: 40px;
  text-align: right;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

/* 内存详情样式 */
.memory-detail {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.memory-item {
  flex: 1;
  min-width: calc(50% - 5px);
  display: flex;
}

.memory-label {
  color: #aaa;
  font-size: 12px;
}

.memory-value {
  margin-left: 4px;
  font-size: 12px;
}

/* 磁盘使用情况样式 */
.disk-item {
  margin-bottom: 16px;
}

.disk-item:last-child {
  margin-bottom: 0;
}

.disk-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
}

.disk-name {
  font-size: 13px;
}

.disk-value {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.disk-detail {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 6px;
  font-size: 12px;
}

.disk-detail-item {
  color: #aaa;
}
</style> 