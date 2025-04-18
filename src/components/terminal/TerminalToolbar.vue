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
        
        <div class="icon-button tooltip-container" 
          @click.stop="monitoringServiceInstalled ? toggleMonitoringPanel($event) : null" 
          :class="{ 'icon-disabled': !monitoringServiceInstalled }">
          <img src="@/assets/icons/icon-monitoring.svg" class="ruyi-icon ruyi-icon-ot-monitoring" width="16" height="16" 
               :class="{ 'icon-gray': !monitoringServiceInstalled, 'icon-white': monitoringServiceInstalled }" />
          <div v-if="monitoringServiceInstalled" class="tooltip-content">查看系统监控</div>
          <div v-else class="tooltip-content">
            未安装监控脚本，点击<span class="install-link" @click.stop="installMonitoring">一键安装</span>
          </div>
        </div>
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
import { defineComponent, computed, ref, onMounted, onUnmounted, watch, inject } from 'vue'
import { useSessionStore } from '../../store/session'
import axios from 'axios'
import sshService from '../../services/ssh'

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
    const monitoringServiceInstalled = ref(false)
    const sessionStore = useSessionStore()
    const lastProcessedSessionId = ref(null)
    
    // 添加延迟数据缓存，key为终端ID，value为{latency, timestamp}
    const latencyCache = ref({})
    
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
      
      // 触发监控面板打开事件，无论是否安装都传递状态信息
      emit('toggle-monitoring-panel', { installed: monitoringServiceInstalled.value });
    }
    
    // 安装监控服务
    const installMonitoring = (event) => {
      if (event) {
        event.stopPropagation();
      }
      
      // 获取当前会话ID
      const sessionId = props.activeSessionId || sessionStore.getActiveSession();
      if (!sessionId) {
        console.error('没有活动的会话，无法执行安装命令');
        return;
      }
      
      console.log('准备安装监控服务，会话ID:', sessionId);
      
      // 将安装事件和会话ID传递给父组件
      emit('toggle-monitoring-panel', { 
        installed: monitoringServiceInstalled.value,
        install: true,
        sessionId: sessionId
      });
    };
    
    // 处理网络延迟更新事件
    const handleNetworkLatencyUpdate = (event) => {
      // 获取事件中的会话ID（SSH会话ID，格式如 ssh_xxx）
      const sshSessionId = event.detail.sessionId;
      
      if (!sshSessionId || !sshService || !sshService.sessions) {
        console.warn('无效的会话ID或SSH服务实例不可用');
        return;
      }
      
      // 获取SSH会话对象
      const session = sshService.sessions.get(sshSessionId);
      if (!session || !session.terminalId) {
        console.log(`SSH会话 ${sshSessionId} 不存在或未绑定终端ID，忽略延迟数据`);
        return;
      }
      
      // 获取会话绑定的终端ID
      const terminalId = session.terminalId;
      
      // 获取当前活动的终端ID
      const activeTerminalId = props.activeSessionId || sessionStore.getActiveSession();
      
      // 处理接收到的延迟数据
      const latency = event.detail.latency;
      
      if (latency !== null && latency !== undefined) {
        // 缓存该终端的延迟数据
        latencyCache.value[terminalId] = {
          latency,
          timestamp: Date.now(),
          sshSessionId
        };
        
        // 检查是否为当前活动终端
        const isActiveTerminal = terminalId === activeTerminalId;
        
        if (isActiveTerminal) {
          // 如果是当前活动终端，直接更新UI显示
          serverDelay.value = latency;
          rttValue.value = `${latency} ms`;
          showNetworkIcon.value = true;
          
          // 更新最后处理的会话ID
          lastProcessedSessionId.value = terminalId;
          
          console.log(`网络延迟更新: ${latency}ms (SSH会话ID: ${sshSessionId}, 终端ID: ${terminalId})`);
        } else {
          // 如果不是当前活动终端，只缓存不更新UI
          console.log(`缓存非活动终端延迟数据: ${latency}ms (终端ID: ${terminalId}, 当前活动终端: ${activeTerminalId})`);
        }
      } else {
        // 如果延迟测量失败，也缓存这个结果
        latencyCache.value[terminalId] = {
          latency: 0,
          timestamp: Date.now(),
          error: true,
          sshSessionId
        };
        
        // 检查是否为当前活动终端
        if (terminalId === activeTerminalId) {
          // 如果是当前活动终端，更新UI显示
          serverDelay.value = 0;
          rttValue.value = '--';
          console.log(`网络延迟测量失败 (SSH会话ID: ${sshSessionId}, 终端ID: ${terminalId})`);
        }
      }
    };
    
    // 检查监控服务状态
    const checkMonitoringServiceStatus = async () => {
      try {
        // 获取当前活动会话
        const sessionId = props.activeSessionId || sessionStore.getActiveSession();
        if (!sessionId) return;
        
        // 获取会话信息
        const session = sessionStore.getSession(sessionId);
        if (!session || !session.connection) return;
        
        // 检查监控服务状态
        const response = await axios.post('/api/monitor/check-status', {
          host: session.connection.host
        });
        
        // 更新监控服务安装状态
        monitoringServiceInstalled.value = response.data.success && response.data.status === 'running';
        
        console.log(`监控服务状态检查: ${monitoringServiceInstalled.value ? '已安装' : '未安装'}`);
      } catch (error) {
        console.error('检查监控服务状态失败:', error);
        monitoringServiceInstalled.value = false;
      }
    };
    
    // 监听会话变化
    watch(() => props.activeSessionId, (newId, oldId) => {
      if (newId) {
        // 会话变化时重新检查监控服务状态
        checkMonitoringServiceStatus();
        
        // 如果切换了终端，查找该终端的缓存延迟数据
        if (newId !== lastProcessedSessionId.value) {
          console.log(`终端切换: ${oldId} -> ${newId}`);
          
          // 查找缓存的延迟数据
          const cachedData = latencyCache.value[newId];
          if (cachedData && cachedData.latency > 0) {
            // 显示缓存的延迟数据
            serverDelay.value = cachedData.latency;
            rttValue.value = `${cachedData.latency} ms`;
            showNetworkIcon.value = true;
            console.log(`显示终端 ${newId} 缓存的延迟数据: ${cachedData.latency}ms`);
          } else {
            // 如果没有缓存数据，重置显示
            console.log(`终端 ${newId} 无缓存延迟数据，等待新数据`);
            // 不重置显示，继续使用上一个终端的数据直到收到新数据
          }
          
          lastProcessedSessionId.value = newId;
        }
      }
    });
    
    // 监听全局监控状态事件
    const handleMonitoringStatusChange = (event) => {
      if (event && event.detail) {
        monitoringServiceInstalled.value = event.detail.installed;
      }
    };
    
    // 初始化网络监控
    onMounted(() => {
      // 添加网络延迟更新事件监听器
      window.addEventListener('network-latency-update', handleNetworkLatencyUpdate);
      // 添加监控状态变化事件监听
      window.addEventListener('monitoring-status-change', handleMonitoringStatusChange);
      
      // 初始检查监控服务状态
      checkMonitoringServiceStatus();
      
      // 主动触发一次延迟测量
      const currentId = props.activeSessionId || sessionStore.getActiveSession();
      if (currentId && sshService) {
        console.log('尝试为当前活动终端触发延迟测量:', currentId);
        
        // 这里查找当前活动终端对应的SSH会话，并触发测量
        setTimeout(() => {
          try {
            for (const [sshId, session] of sshService.sessions.entries()) {
              if (session.terminalId === currentId) {
                // 找到了匹配的会话，触发延迟测量
                console.log(`找到匹配的SSH会话: ${sshId}，终端ID: ${currentId}`);
                
                // 设置为当前活动会话ID，确保后续接收到的延迟数据能够正确显示
                lastProcessedSessionId.value = currentId;
                
                // 注意：重要！同步更新SessionStore中的活动会话ID
                sessionStore.setActiveSession(currentId);
                break;
              }
            }
          } catch (error) {
            console.error('触发延迟测量失败:', error);
          }
        }, 1000);
      }
      
      console.log(`TerminalToolbar已挂载，当前活动会话ID: ${props.activeSessionId || sessionStore.getActiveSession()}`);
    });
    
    // 监听会话ID变化
    watch(() => props.activeSessionId, (newId, oldId) => {
      console.log(`TerminalToolbar的activeSessionId已更新: ${oldId} -> ${newId}`);
    });
    
    // 清理资源
    onUnmounted(() => {
      // 移除事件监听器
      window.removeEventListener('network-latency-update', handleNetworkLatencyUpdate);
      window.removeEventListener('monitoring-status-change', handleMonitoringStatusChange);
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
      showNetworkIcon,
      monitoringServiceInstalled,
      installMonitoring
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

/* 禁用状态的图标按钮 */
.icon-button.icon-disabled {
  cursor: not-allowed !important;
}

/* 灰色图标样式 */
.icon-gray {
  filter: grayscale(100%) opacity(0.5);
}

/* 白色图标样式 */
.icon-white {
  filter: brightness(1.1);
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

/* 自定义tooltip样式 */
.tooltip-container {
  position: relative;
  /* 添加与icon-button相同的样式确保外观一致 */
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background-color: transparent;
  border-radius: 4px;
  cursor: pointer;
  color: #e0e0e0;
  padding: 0;
  transition: background-color 0.2s ease;
}

.tooltip-container:hover {
  background-color: rgba(255, 255, 255, 0.2);
}

.tooltip-content {
  display: none;
  position: absolute;
  left: 50%;
  top: 100%;
  transform: translateX(-50%);
  background-color: #333;
  color: #e0e0e0;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 13px;
  white-space: nowrap;
  margin-top: 10px;
  z-index: 9000;
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.4);
  pointer-events: all;
}

/* 显示tooltip，不仅当hover容器时，也在hover内容时 */
.tooltip-container:hover .tooltip-content,
.tooltip-content:hover {
  display: block;
}

/* 添加padding确保鼠标到达tooltip时不会有空隙 */
.tooltip-content::before {
  content: "";
  position: absolute;
  top: -10px;
  left: 0;
  width: 100%;
  height: 10px;
}

/* 添加箭头样式 */
.tooltip-container:hover::before {
  content: "";
  position: absolute;
  left: 50%;
  top: 100%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-bottom: 5px solid #333;
  z-index: 9100;
  pointer-events: none;
}

/* 一键安装链接样式 */
.install-link {
  color: #409EFF;
  cursor: pointer;
  text-decoration: none;
  font-weight: bold;
}

.install-link:hover {
  opacity: 0.8;
}

/* 禁用状态的tooltip容器 */
.tooltip-container.icon-disabled {
  cursor: not-allowed !important;
}
</style> 