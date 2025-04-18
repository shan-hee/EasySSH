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

    <div v-if="!isConnected && !installing" class="panel-not-installed">
      <div class="install-info">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" class="info-icon">
          <path fill="#409eff" d="M11,9H13V7H11M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M11,17H13V11H11V17Z" />
        </svg>
        <h3>未检测到监控服务</h3>
        <p>需要先在远程服务器上安装监控服务才能查看系统状态</p>
        <div class="install-actions">
          <div class="install-link-container">
            <p>请在远程终端中执行以下命令安装监控服务：</p>
            <pre class="install-command-link">curl -sSL {{ getInstallScriptUrl() }} | sudo bash</pre>
            <button class="copy-button" @click="copyInstallCommand">复制命令</button>
          </div>
        </div>
      </div>
      <div v-if="installError" class="install-error">
        <p>{{ installError }}</p>
      </div>
    </div>

    <div v-if="installing" class="panel-installing">
      <div class="installing-info">
        <div class="loading-spinner"></div>
        <h3>正在安装监控服务</h3>
        <p>请稍候，安装过程可能需要几分钟...</p>
        <pre class="install-command">{{ installCommand }}</pre>
      </div>
    </div>

    <div v-if="isConnected" class="panel-content">
      <!-- 系统信息 -->
      <div class="section">
        <h3>系统信息</h3>
        <div class="info-list">
          <div class="info-item">
            <span class="info-label">主机名：</span>
            <span class="info-value">{{ systemInfo.os?.hostname || '获取中...' }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">系统：</span>
            <span class="info-value">{{ formatOsInfo }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">IP地址：</span>
            <span class="info-value">{{ systemInfo.ip?.internal || '获取中...' }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">公网IP：</span>
            <span class="info-value">{{ systemInfo.ip?.public || '获取中...' }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">运行时间：</span>
            <span class="info-value">{{ formatUptime }}</span>
          </div>
        </div>
      </div>

      <!-- CPU使用率 -->
      <div class="section">
        <h3>CPU使用率</h3>
        <div class="info-item cpu-info">
          <span class="info-label">处理器：</span>
          <span class="info-value">{{ systemInfo.cpu?.model || '获取中...' }}</span>
        </div>
        <div class="info-item">
          <span class="info-label">核心数：</span>
          <span class="info-value">{{ systemInfo.cpu?.cores || '获取中...' }}</span>
        </div>
        <div class="progress-container">
          <div class="progress-bar-container">
            <div class="progress-bar" :style="{ width: `${systemInfo.cpu?.usage || 0}%` }" :class="getProgressBarClass(systemInfo.cpu?.usage || 0)"></div>
          </div>
          <div class="progress-value">{{ systemInfo.cpu?.usage || 0 }}%</div>
        </div>
      </div>

      <!-- 内存使用情况 -->
      <div class="section">
        <h3>内存使用情况</h3>
        <div class="progress-container">
          <div class="progress-bar-container">
            <div class="progress-bar" :style="{ width: `${systemInfo.memory?.usedPercentage || 0}%` }" :class="getProgressBarClass(systemInfo.memory?.usedPercentage || 0)"></div>
          </div>
          <div class="progress-value">{{ systemInfo.memory?.usedPercentage || 0 }}%</div>
        </div>
        <div class="memory-detail">
          <div class="memory-item">
            <span class="memory-label">已使用：</span>
            <span class="memory-value">{{ systemInfo.memory?.used || 0 }} MB</span>
          </div>
          <div class="memory-item">
            <span class="memory-label">总内存：</span>
            <span class="memory-value">{{ systemInfo.memory?.total || 0 }} MB</span>
          </div>
          <div class="memory-item">
            <span class="memory-label">可用：</span>
            <span class="memory-value">{{ systemInfo.memory?.free || 0 }} MB</span>
          </div>
        </div>
      </div>

      <!-- 交换分区 -->
      <div class="section">
        <h3>交换分区</h3>
        <div class="progress-container">
          <div class="progress-bar-container">
            <div class="progress-bar" :style="{ width: `${systemInfo.swap?.usedPercentage || 0}%` }" :class="getProgressBarClass(systemInfo.swap?.usedPercentage || 0)"></div>
          </div>
          <div class="progress-value">{{ systemInfo.swap?.usedPercentage || 0 }}%</div>
        </div>
        <div class="memory-detail">
          <div class="memory-item">
            <span class="memory-label">已使用：</span>
            <span class="memory-value">{{ systemInfo.swap?.used || 0 }} MB</span>
          </div>
          <div class="memory-item">
            <span class="memory-label">总大小：</span>
            <span class="memory-value">{{ systemInfo.swap?.total || 0 }} MB</span>
          </div>
          <div class="memory-item">
            <span class="memory-label">可用：</span>
            <span class="memory-value">{{ systemInfo.swap?.free || 0 }} MB</span>
          </div>
        </div>
      </div>

      <!-- 磁盘使用情况 -->
      <div class="section">
        <h3>磁盘使用情况</h3>
        <div class="disk-item">
          <div class="disk-header">
            <span class="disk-name">主分区</span>
            <span class="disk-value">{{ systemInfo.disk?.usedPercentage || 0 }}%</span>
          </div>
          <div class="progress-bar-container">
            <div class="progress-bar" :style="{ width: `${systemInfo.disk?.usedPercentage || 0}%` }" :class="getProgressBarClass(systemInfo.disk?.usedPercentage || 0)"></div>
          </div>
          <div class="disk-detail">
            <span class="disk-detail-item">已用: {{ systemInfo.disk?.used || 0 }} GB</span>
            <span class="disk-detail-item">总容量: {{ systemInfo.disk?.total || 0 }} GB</span>
            <span class="disk-detail-item">可用: {{ systemInfo.disk?.free || 0 }} GB</span>
          </div>
        </div>
      </div>

      <!-- 网络状态 -->
      <div class="section">
        <h3>网络状态</h3>
        <div class="network-stats">
          <div class="network-item">
            <span class="network-label">连接数：</span>
            <span class="network-value">{{ systemInfo.network?.totalConnections || 0 }}</span>
          </div>
          <div class="network-item">
            <span class="network-label">输入流量：</span>
            <span class="network-value">{{ systemInfo.network?.inputBytes || 0 }} bytes</span>
          </div>
          <div class="network-item">
            <span class="network-label">输出流量：</span>
            <span class="network-value">{{ systemInfo.network?.outputBytes || 0 }} bytes</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { defineComponent, ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { io } from 'socket.io-client';
import axios from 'axios';
import { ElMessage } from 'element-plus';

export default defineComponent({
  name: 'MonitoringPanel',
  props: {
    serverId: {
      type: [String, Number],
      required: true
    },
    serverInfo: {
      type: Object,
      required: true
    },
    isInstalled: {
      type: Boolean,
      default: false
    }
  },
  emits: ['close'],
  setup(props, { emit }) {
    // 连接状态
    const isConnected = ref(false);
    const socket = ref(null);
    const isClosing = ref(false);
    const installing = ref(false);
    const installError = ref('');
    const installCommand = ref('');
    
    // 系统信息
    const systemInfo = ref({
      cpu: {},
      memory: {},
      swap: {},
      disk: {},
      network: {},
      os: {},
      ip: {}
    });

    // 获取安装脚本URL
    const getInstallScriptUrl = () => {
      return `/api/monitor/install-script`;
    };

    // 复制安装命令
    const copyInstallCommand = () => {
      const command = `curl -sSL ${window.location.origin}/api/monitor/install-script | sudo bash`;
      navigator.clipboard.writeText(command)
        .then(() => {
          ElMessage.success('安装命令已复制到剪贴板');
        })
        .catch(err => {
          console.error('复制失败:', err);
          ElMessage.error('复制失败，请手动复制命令');
        });
    };

    // 格式化操作系统信息
    const formatOsInfo = computed(() => {
      if (!systemInfo.value.os) return '获取中...';
      return `${systemInfo.value.os.type || ''} ${systemInfo.value.os.platform || ''} ${systemInfo.value.os.release || ''}`;
    });

    // 格式化运行时间
    const formatUptime = computed(() => {
      if (!systemInfo.value.os?.uptime) return '获取中...';
      
      const uptime = systemInfo.value.os.uptime;
      const days = Math.floor(uptime / 86400);
      const hours = Math.floor((uptime % 86400) / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      
      return `${days}天 ${hours}小时 ${minutes}分钟`;
    });

    // 获取进度条样式类
    const getProgressBarClass = (percentage) => {
      if (percentage < 60) return 'progress-normal';
      if (percentage < 80) return 'progress-warning';
      return 'progress-danger';
    };

    // 处理关闭面板
    const closePanel = () => {
      isClosing.value = true;
      
      // 断开Socket连接
      if (socket.value) {
        socket.value.disconnect();
      }
      
      // 等待动画完成后再通知父组件关闭
      setTimeout(() => {
        emit('close');
      }, 300); // 与动画持续时间一致
    };

    // 连接到监控服务
    const connectToMonitorService = () => {
      // 检查当前连接状态
      if (socket.value) {
        socket.value.disconnect();
      }

      // 从服务器信息中获取主机地址
      const host = props.serverInfo.host;
      const port = 9528; // 默认监控服务端口

      try {
        // 创建Socket.IO连接
        socket.value = io(`http://${host}:${port}`, {
          transports: ['websocket', 'polling'],
          reconnectionAttempts: 5,
          timeout: 10000
        });

        // 连接事件处理
        socket.value.on('connect', () => {
          isConnected.value = true;
          installing.value = false;
          installError.value = '';
          
          // 触发状态变更事件
          window.dispatchEvent(new CustomEvent('monitoring-status-change', { 
            detail: { installed: true }
          }));
          
          console.log('已连接到监控服务');
        });

        // 断开连接事件处理
        socket.value.on('disconnect', () => {
          isConnected.value = false;
          console.log('与监控服务断开连接');
        });

        // 连接错误处理
        socket.value.on('connect_error', (error) => {
          console.error('连接监控服务失败:', error);
          // 如果连接失败，可能是服务未启动
          isConnected.value = false;
        });

        // 接收系统信息
        socket.value.on('system-info', (data) => {
          systemInfo.value = data;
        });
      } catch (error) {
        console.error('创建Socket.IO连接时出错:', error);
        isConnected.value = false;
      }
    };

    // 检查监控服务状态
    const checkMonitorStatus = async () => {
      try {
        const response = await axios.post('/api/monitor/check-status', {
          host: props.serverInfo.host
        });

        if (response.data.success && response.data.status === 'running') {
          // 服务已安装且正在运行，尝试连接
          connectToMonitorService();
          
          // 触发状态变更事件
          window.dispatchEvent(new CustomEvent('monitoring-status-change', { 
            detail: { installed: true }
          }));
        } else {
          // 服务未安装或未运行
          isConnected.value = false;
          
          // 触发状态变更事件
          window.dispatchEvent(new CustomEvent('monitoring-status-change', { 
            detail: { installed: false }
          }));
        }
      } catch (error) {
        console.error('检查监控状态失败:', error);
        isConnected.value = false;
      }
    };

    // 组件挂载时初始化
    onMounted(() => {
      // 如果已知状态，则根据状态决定是否尝试连接
      if (props.isInstalled) {
        connectToMonitorService();
      } else {
        // 如果不确定状态，则检查监控服务状态
        checkMonitorStatus();
      }
    });

    // 监听服务器信息变化
    watch(() => props.serverInfo, () => {
      // 服务器信息变化时，重新检查监控状态
      checkMonitorStatus();
    }, { deep: true });

    // 组件卸载时清理资源
    onUnmounted(() => {
      if (socket.value) {
        socket.value.disconnect();
        socket.value = null;
      }
    });

    return {
      systemInfo,
      isConnected,
      isClosing,
      installing,
      installError,
      installCommand,
      formatOsInfo,
      formatUptime,
      getProgressBarClass,
      closePanel,
      getInstallScriptUrl,
      copyInstallCommand
    };
  }
});
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

/* 新增样式 */
.panel-not-installed, .panel-installing {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 20px;
  text-align: center;
}

.install-info, .installing-info {
  max-width: 360px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.info-icon {
  margin-bottom: 16px;
}

.install-info h3, .installing-info h3 {
  margin-bottom: 12px;
  font-size: 16px;
  font-weight: 500;
}

.install-info p, .installing-info p {
  margin-bottom: 24px;
  color: #aaa;
  line-height: 1.5;
}

.install-actions {
  margin-top: 8px;
}

.install-button {
  display: none; /* 隐藏原有的按钮 */
}

.install-error {
  margin-top: 20px;
  color: #f56c6c;
  max-width: 360px;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(64, 158, 255, 0.3);
  border-radius: 50%;
  border-top-color: #409eff;
  animation: spin 1s linear infinite;
  margin-bottom: 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.install-command {
  background-color: #252525;
  padding: 12px;
  border-radius: 4px;
  width: 100%;
  overflow-x: auto;
  font-family: monospace;
  margin-top: 16px;
  color: #eee;
  text-align: left;
}

.cpu-info {
  margin-bottom: 6px;
}

.network-stats {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.network-item {
  display: flex;
}

.network-label {
  width: 80px;
  color: #aaa;
  flex-shrink: 0;
}

.network-value {
  flex: 1;
}

/* 新增和修改的样式 */
.install-link-container {
  width: 100%;
  text-align: left;
  margin-top: 20px;
}

.install-command-link {
  background-color: #252525;
  padding: 12px;
  border-radius: 4px;
  width: 100%;
  overflow-x: auto;
  font-family: monospace;
  margin: 10px 0;
  color: #eee;
  text-align: left;
  cursor: pointer;
}

.copy-button {
  background-color: #409eff;
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.2s;
  margin-top: 8px;
}

.copy-button:hover {
  background-color: #66b1ff;
}
</style> 