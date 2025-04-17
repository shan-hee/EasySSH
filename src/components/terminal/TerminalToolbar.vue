<template>
  <div class="terminal-toolbar-container">
    <div class="terminal-tools" :class="{ 'transparent-bg': hasBackground }">
      <div class="terminal-tools__left">
        <button class="icon-button" @click="toggleSftpPanel">
          <img src="@/assets/icons/icon-file-manager.svg" class="ruyi-icon ruyi-icon-ot-file-manager" width="16" height="16" />
        </button>
        
        <transition name="fade">
          <div v-if="showNetworkIcon" class="network-monitor" @click="toggleNetworkPopup">
            <div class="network-icon">
              <img src="@/assets/icons/icon-network.svg" class="ruyi-icon ruyi-icon-ot-network-icon" width="16" height="16" />
            </div>
            <div class="network-stats">
              <div class="network-stats-value" :class="rttStatusClass">{{ rttValue }}</div>
              <div class="network-stats-label">RTT</div>
            </div>
          </div>
        </transition>
        
        <button class="icon-button" type="button" @click.stop="toggleMonitoringPanel($event)">
          <img src="@/assets/icons/icon-monitoring.svg" class="ruyi-icon ruyi-icon-ot-monitoring" width="16" height="16" />
        </button>
      </div>
    </div>
    
    <!-- 网络状态弹窗 -->
    <div v-if="showNetworkPopup" class="network-popup">
      <div class="network-popup-header">
        <span>网络延迟: {{ totalRtt }} ms</span>
      </div>
      <div class="network-popup-content">
        <div class="network-nodes">
          <!-- <div class="network-node">
            <div class="network-node-dot"></div>
            <div class="network-node-label">本地</div>
          </div>
          
          <div class="network-path">
            <div class="network-path-line"></div>
            <div class="network-path-value" :class="getDelayClass(clientDelay)">~ {{ clientDelay }} ms</div>
          </div> -->
          
          <div class="network-node">
            <div class="network-node-dot"></div>
            <div class="network-node-label">EasySSH</div>
          </div>
          
          <div class="network-path">
            <div class="network-path-line"></div>
            <div class="network-path-value" :class="getDelayClass(serverDelay)">~ {{ serverDelay }} ms</div>
          </div>
          
          <div class="network-node">
            <div class="network-node-dot"></div>
            <div class="network-node-label">服务器</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { defineComponent, computed, ref, onMounted, onUnmounted, watch } from 'vue'

export default defineComponent({
  name: 'TerminalToolbar',
  emits: ['toggle-sftp-panel', 'toggle-monitoring-panel'],
  props: {
    hasBackground: {
      type: Boolean,
      default: false
    },
    activeSessionId: {
      type: String,
      default: ''
    }
  },
  
  setup(props, { emit }) {
    const rttValue = ref('--')
    const showNetworkPopup = ref(false)
    const clientDelay = ref(0)
    const serverDelay = ref(0)
    const showNetworkIcon = ref(false)
    
    // 计算总RTT
    const totalRtt = computed(() => {
      return serverDelay.value || 0;
    })
    
    // 根据RTT值计算状态类
    const rttStatusClass = computed(() => {
      const rtt = totalRtt.value;
      if (rtt === 0) return '';
      if (rtt < 100) return 'success';
      if (rtt < 300) return 'warning';
      return 'danger';
    })
    
    // 根据延迟值获取颜色类
    const getDelayClass = (delay) => {
      if (delay === 0) return '';
      if (delay < 50) return 'success';
      if (delay < 150) return 'warning';
      return 'danger';
    }
    
    // 切换网络弹窗显示状态
    const toggleNetworkPopup = (event) => {
      // 阻止事件冒泡，避免触发全局点击处理器
      if (event) {
        event.stopPropagation();
      }
      
      // 如果弹窗已显示，则关闭它；如果未显示，则打开它
      showNetworkPopup.value = !showNetworkPopup.value;
    }
    
    // 切换SFTP面板
    const toggleSftpPanel = () => {
      emit('toggle-sftp-panel');
    }
    
    // 切换监控面板
    const toggleMonitoringPanel = (event) => {
      // 阻止事件冒泡，避免触发全局点击处理器
      if (event) {
        event.stopPropagation();
      }
      
      emit('toggle-monitoring-panel');
    }
    
    // 处理网络延迟更新事件
    const handleNetworkLatencyUpdate = (event) => {
      // 简化处理逻辑，忽略会话ID匹配检查，直接处理任何会话的延迟数据
      // 工具栏只会显示最后接收到的延迟值，无论是哪个会话
      
      const latency = event.detail.latency;
      
      if (latency !== null && latency !== undefined) {
        serverDelay.value = latency;
        rttValue.value = `${latency} ms`;
        console.log(`网络延迟更新: ${latency}ms (会话ID: ${event.detail.sessionId})`);
        
        // 收到了有效的延迟数据，显示网络图标
        if (!showNetworkIcon.value) {
          showNetworkIcon.value = true;
        }
      } else {
        // 如果延迟测量失败
        serverDelay.value = 0;
        rttValue.value = '--';
        console.log(`网络延迟测量失败 (会话ID: ${event.detail.sessionId})`);
      }
    };
    
    // 初始化网络监控
    onMounted(() => {
      // 添加网络延迟更新事件监听器
      window.addEventListener('network-latency-update', handleNetworkLatencyUpdate);
      console.log(`TerminalToolbar已挂载，当前活动会话ID: ${props.activeSessionId}`);
    });
    
    // 监听会话ID变化
    watch(() => props.activeSessionId, (newId, oldId) => {
      console.log(`TerminalToolbar的activeSessionId已更新: ${oldId} -> ${newId}`);
    });
    
    // 清理资源
    onUnmounted(() => {
      // 移除事件监听器
      window.removeEventListener('network-latency-update', handleNetworkLatencyUpdate);
    });

    return {
      rttValue,
      showNetworkPopup,
      clientDelay,
      serverDelay,
      totalRtt,
      rttStatusClass,
      getDelayClass,
      toggleNetworkPopup,
      toggleSftpPanel,
      toggleMonitoringPanel,
      showNetworkIcon
    }
  }
})
</script>

<style scoped>
.terminal-toolbar-container {
  position: relative;
  width: 100%;
  z-index: 3;
  background-color: transparent;
}

.terminal-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  height: 40px;
  background-color: #1F1F1F; /* 默认不透明背景 */
  position: relative;
}

/* 当有背景图时应用透明样式 */
.terminal-tools.transparent-bg {
  background-color: transparent;
}

/* 当有背景图时的半透明覆盖层 */
.terminal-tools.transparent-bg::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(31, 31, 31, 0.5);
  backdrop-filter: blur(2px);
  z-index: -1;
}

.terminal-tools__left {
  display: flex;
  gap: 8px;
  align-items: center;
}

.icon-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background-color: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  color: #e0e0e0;
  padding: 0;
  transition: background-color 0.2s ease;
}

.icon-button:hover {
  background-color: rgba(255, 255, 255, 0.2);
}

.network-monitor {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  padding: 3px 6px;
  border-radius: 4px;
}

.network-monitor:hover {
  background-color: rgba(255, 255, 255, 0.1);
}

.network-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #e0e0e0;;
}

.network-stats {
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1;
}

.network-stats-value {
  font-size: 12px;
  font-weight: 500;
}

.network-path-value.success {
  color: #67c23a;
}

.network-path-value.warning {
  color: #e6a23c;
}

.network-path-value.danger {
  color: #f56c6c;
}

.network-stats-label {
  font-size: 10px;
  color: #909399;
  text-transform: uppercase;
  line-height: 1;
  margin-top: 2px;
}

/* 网络监控弹窗 */
.network-popup {
  position: absolute;
  top: 40px;
  left: 16px;
  width: 300px;
  background-color: #242424;
  border-radius: 4px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
  z-index: 1000;
  overflow: hidden;
}

.network-popup-header {
  padding: 10px 12px;
  font-size: 14px;
  font-weight: 500;
  color: #e0e0e0;
  background-color: #1e1e1e;
  border-bottom: 1px solid #333;
  text-align: center;
}

.network-popup-content {
  padding: 16px 12px;
}

.network-nodes {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.network-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}


.network-node-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background-color: #909399;
  margin-bottom: 6px;
}

.network-node-label {
  font-size: 12px;
  color: #909399;
  white-space: nowrap;
}


.network-path {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: 0 5px;
  position: relative;
}

.network-path-line {
  width: 100%;
  height: 1px;
  background-color: #555;
  position: relative;
  top: -10px;
}

.network-path-value {
  font-size: 12px;
  position: relative;
  top: -6px;
  background-color: #242424;
  padding: 0 5px;
}

.network-stats-value.success {
  color: #67c23a;
}

.network-stats-value.warning {
  color: #e6a23c;
}

.network-stats-value.danger {
  color: #f56c6c;
}

/* 淡入淡出动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.5s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.network-stats-value.measuring {
  color: #409eff;
  animation: pulse 1.5s infinite;
}

.network-path-value.measuring {
  color: #409eff;
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0% { opacity: 0.6; }
  50% { opacity: 1; }
  100% { opacity: 0.6; }
}
</style> 