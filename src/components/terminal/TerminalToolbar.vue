<template>
  <div class="terminal-toolbar-container">
    <div class="terminal-tools" :class="{ 'transparent-bg': hasBackground }">
      <div class="terminal-tools__left">
        <div class="icon-button tooltip-container" @click="handleSftpClick" 
               :class="{ 'icon-available': isSshConnected }" ref="sftpButtonRef">
          <img src="@/assets/icons/icon-file-manager.svg" class="ruyi-icon ruyi-icon-ot-file-manager" width="16" height="16" 
               :class="{ 'icon-gray': !isSshConnected, 'icon-white': isSshConnected }" />
        </div>
        
        <!-- 使用teleport将tooltip内容传送到body中 -->
        <teleport to="body">
          <div v-if="!isSshConnected && showSftpTooltip" class="sftp-tooltip" :style="sftpTooltipStyle"
               @mouseenter="onTooltipMouseEnter" @mouseleave="onTooltipMouseLeave">
            SSH连接后才能使用
          </div>
          <!-- 添加已连接状态的tooltip -->
          <div v-if="isSshConnected && showConnectedSftpTooltip" class="sftp-tooltip" :style="sftpTooltipStyle"
               @mouseenter="onConnectedTooltipMouseEnter" @mouseleave="onConnectedTooltipMouseLeave">
            SFTP文件管理器
          </div>
        </teleport>
        
        <transition name="fade">
          <div v-if="showNetworkIcon" class="network-monitor" @click="toggleNetworkPopup" ref="networkIconRef">
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
          @click.stop="!isPanelVisible && toggleMonitoringPanel()" 
          :class="{ 'icon-available': monitoringServiceInstalled, 'active': isPanelVisible }"
          ref="monitorButtonRef">
          <img src="@/assets/icons/icon-monitoring.svg" class="ruyi-icon ruyi-icon-ot-monitoring" width="16" height="16" 
               :class="{ 'icon-gray': !monitoringServiceInstalled, 'icon-white': monitoringServiceInstalled }" />
        </div>
        
        <!-- 使用teleport将监控工具提示内容传送到body中 -->
        <teleport to="body">
          <!-- 已安装监控服务提示 -->
          <div v-if="monitoringServiceInstalled && !isPanelVisible && showMonitorTooltip" 
               class="sftp-tooltip" :style="monitorTooltipStyle"
               @mouseenter="onMonitorTooltipMouseEnter" @mouseleave="onMonitorTooltipMouseLeave">
            查看系统监控
          </div>
          
          <!-- 未安装监控服务提示 -->
          <div v-if="!monitoringServiceInstalled && showMonitorTooltip" 
               class="sftp-tooltip" :style="monitorTooltipStyle"
               @mouseenter="onMonitorTooltipMouseEnter" @mouseleave="onMonitorTooltipMouseLeave">
            未连接到监控服务，点击<span class="install-link" @click.stop="installMonitoring">一键安装</span>
          </div>
        </teleport>
      </div>
    </div>
    
    <!-- 网络状态弹窗 -->
    <teleport to="body">
      <div v-if="showNetworkPopup" class="network-popup" :style="networkPopupStyle">
        <div class="network-popup-header">
          <span>网络延迟: {{ totalRtt }} ms</span>
        </div>
        <div class="network-popup-content">
          <div class="network-nodes">
            <div class="network-node">
              <div class="network-node-dot"></div>
              <div class="network-node-label">本地</div>
            </div>
            
            <div class="network-path">
              <div class="network-path-line"></div>
              <div class="network-path-value" :class="getDelayClass(clientDelay)">~ {{ clientDelay }} ms</div>
            </div>
            
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
    </teleport>
  </div>
</template>

<script>
import { defineComponent, computed, ref, onMounted, onUnmounted, watch, inject, nextTick } from 'vue'
import { useSessionStore } from '../../store/session'
import axios from 'axios'
import sshService from '../../services/ssh'
import monitoringService from '../../services/monitoring'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useTerminalStore } from '../../store/terminal'

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
    const terminalStore = useTerminalStore()
    const lastProcessedSessionId = ref(null)
    const isSshConnected = ref(false)
    const showSftpTooltip = ref(false)
    const sftpButtonRef = ref(null)
    const networkIconRef = ref(null)
    
    // 添加按终端ID隔离的状态对象
    const terminalToolbarStates = ref({})
    
    // 获取或创建特定终端ID的工具栏状态
    const getTerminalToolbarState = (terminalId) => {
      if (!terminalId) return null
      
      // 如果该终端ID的状态不存在，则创建初始状态
      if (!terminalToolbarStates.value[terminalId]) {
        terminalToolbarStates.value[terminalId] = {
          isInitializing: false,         // 防止重复初始化
          isConnecting: false,           // 连接状态
          isSshConnected: false,         // SSH连接状态
          monitoringInstalled: false,    // 监控服务安装状态
          rttValue: '--',                // RTT值
          clientDelay: 0,                // 客户端延迟
          serverDelay: 0,                // 服务器延迟
          lastNetworkUpdate: null,       // 最后网络更新时间
          tooltipVisible: false          // 提示可见状态
        }
      }
      
      return terminalToolbarStates.value[terminalId]
    }
    
    // 获取当前活动终端的工具栏状态
    const activeTerminalState = computed(() => {
      return getTerminalToolbarState(props.activeSessionId) || {}
    })
    
    const sftpTooltipStyle = ref({
      position: 'fixed',
      zIndex: 10000,
      top: '0px',
      left: '0px',
      display: 'none'
    })
    const showConnectedSftpTooltip = ref(false)
    const connectedTooltipHover = ref(false)
    const networkPopupStyle = ref({
      position: 'fixed',
      zIndex: 10000,
      top: '0px',
      left: '0px',
      width: '280px',
    })
    
    // 添加监控面板可见性状态
    const isPanelVisible = computed(() => {
      return !!document.querySelector('.monitoring-panel-container');
    });
    
    // 添加延迟数据缓存，将被持久化到localStorage
    const latencyCache = ref({})
    
    // 初始加载缓存的延迟数据
    const loadCachedLatencyData = () => {
      try {
        const cachedData = localStorage.getItem('easyssh_latency_cache')
        if (cachedData) {
          latencyCache.value = JSON.parse(cachedData)
          console.debug('已从本地存储加载延迟数据缓存')
        }
      } catch (e) {
        console.warn('加载延迟数据缓存失败:', e)
      }
    }
    
    // 保存延迟数据到localStorage
    const saveLatencyCache = () => {
      try {
        // 清理过期数据 (超过1小时的数据)
        const now = Date.now()
        const expireTime = 60 * 60 * 1000 // 1小时
        for (const key in latencyCache.value) {
          if (latencyCache.value[key].timestamp && 
              now - latencyCache.value[key].timestamp > expireTime) {
            delete latencyCache.value[key]
          }
        }
        
        localStorage.setItem('easyssh_latency_cache', JSON.stringify(latencyCache.value))
      } catch (e) {
        console.warn('保存延迟数据缓存失败:', e)
      }
    }
    
    // 持久化SSH连接状态
    const loadConnectionStatus = () => {
      try {
        const status = localStorage.getItem('easyssh_connection_status')
        if (status) {
          const parsedStatus = JSON.parse(status)
          if (parsedStatus && typeof parsedStatus === 'object') {
            // 只更新当前会话ID的状态，如果它存在
            if (props.activeSessionId && parsedStatus[props.activeSessionId]) {
              isSshConnected.value = parsedStatus[props.activeSessionId].connected === true
              console.debug(`从缓存恢复会话 ${props.activeSessionId} 连接状态: ${isSshConnected.value}`)
            }
          }
        }
      } catch (e) {
        console.warn('加载连接状态缓存失败:', e)
      }
    }
    
    // 保存连接状态
    const saveConnectionStatus = (sessionId, isConnected) => {
      try {
        let status = {}
        try {
          const cachedStatus = localStorage.getItem('easyssh_connection_status')
          if (cachedStatus) {
            status = JSON.parse(cachedStatus)
          }
        } catch (e) {
          // 如果解析失败，使用空对象
          status = {}
        }
        
        // 更新指定会话的状态
        status[sessionId] = {
          connected: isConnected,
          timestamp: Date.now()
        }
        
        // 清理超过1小时的数据
        const now = Date.now()
        const expireTime = 60 * 60 * 1000 // 1小时
        for (const key in status) {
          if (status[key].timestamp && now - status[key].timestamp > expireTime) {
            delete status[key]
          }
        }
        
        localStorage.setItem('easyssh_connection_status', JSON.stringify(status))
      } catch (e) {
        console.warn('保存连接状态失败:', e)
      }
    }
    
    // 计算总RTT
    const totalRtt = computed(() => {
      return (serverDelay.value || 0) + (clientDelay.value || 0);
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
      
      // 更新弹窗位置
      if (showNetworkPopup.value) {
        updateNetworkPopupPosition();
      }
    }
    
    // 计算并更新网络弹窗的位置
    const updateNetworkPopupPosition = () => {
      if (!networkIconRef.value) return;
      
      const rect = networkIconRef.value.getBoundingClientRect();
      networkPopupStyle.value = {
        position: 'fixed',
        zIndex: 10000,
        backgroundColor: '#242424',
        borderRadius: '4px',
        boxShadow: '0 2px 12px rgba(0, 0, 0, 0.3)',
        overflow: 'hidden',
        width: '280px',
        top: `${rect.bottom + 5}px`,
        left: `${rect.left + rect.width}px`,
        transform: 'translateX(-50%)'
      };
    }
    
    // 切换SFTP面板
    const toggleSftpPanel = () => {
      if (isSshConnected.value) {
        emit('toggle-sftp-panel');
      }
    }
    
    // 处理SFTP点击事件
    const handleSftpClick = () => {
      if (isSshConnected.value) {
        emit('toggle-sftp-panel');
      } else {
        // 点击时显示tooltip
        updateSftpTooltipPosition()
        showSftpTooltip.value = true
      }
    }
    
    // 计算并更新SFTP tooltip的位置
    const updateSftpTooltipPosition = () => {
      if (!sftpButtonRef.value) return
      
      const rect = sftpButtonRef.value.getBoundingClientRect()
      sftpTooltipStyle.value = {
        position: 'fixed',
        zIndex: 10000,
        backgroundColor: '#333',
        color: '#e0e0e0',
        padding: '8px 12px',
        borderRadius: '4px',
        fontSize: '13px',
        whiteSpace: 'nowrap',
        boxShadow: '0 3px 12px rgba(0, 0, 0, 0.4)',
        top: `${rect.bottom + 10}px`,
        left: `${rect.left + rect.width / 2}px`,
        transform: 'translateX(-50%)'
      }
    }
    
    // 切换监控面板
    const toggleMonitoringPanel = () => {
      // 优雅处理监控不可用的情况
      if (!monitoringServiceInstalled.value) {
        // 使用更友好的提示，不提示错误
        ElMessage({
          message: '监控服务未连接，您可以继续使用其他功能',
          type: 'info',
          duration: 3000
        });
        return;
      }
      
      // 检查监控面板是否已显示 - 这部分可以移除因为已经在HTML中处理
      if (isPanelVisible.value) {
        return;
      }
      
      // 获取当前终端会话信息
      const currentTerminalId = props.activeSessionId;
      if (currentTerminalId && terminalStore && terminalStore.sessions) {
        const sshSessionId = terminalStore.sessions[currentTerminalId];
        if (sshSessionId && sshService && sshService.sessions) {
          const session = sshService.sessions.get(sshSessionId);
          if (session && session.connection) {
            // 找到有效的会话连接信息，直接使用
            const connection = session.connection;
            // 使用事件通信，传递连接信息避免创建临时会话
            const event = new CustomEvent('toggle-monitoring-panel', {
              detail: { 
                sessionId: currentTerminalId,
                connection: connection,
                useExistingConnection: true
              }
            });
            window.dispatchEvent(event);
            console.log('使用现有的连接信息打开监控:', connection.host);
            return;
          }
        }
      }
      
      // 如果没有找到有效的会话连接信息，使用普通方式触发
      console.log('未找到有效会话连接信息，使用默认方式打开监控');
      const event = new CustomEvent('toggle-monitoring-panel', {
        detail: { 
          sessionId: props.activeSessionId 
        }
      });
      window.dispatchEvent(event);
    }
    
    // 检查监控服务状态
    const checkMonitoringServiceStatus = () => {
      // 静默处理，避免出现任何错误或异常
      try {
        // 获取当前终端ID
        const currentTerminalId = props.activeSessionId;
        if (!currentTerminalId) {
          monitoringServiceInstalled.value = false;
          return;
        }
        
        // 获取当前终端的状态
        const terminalState = getTerminalToolbarState(currentTerminalId);
        if (!terminalState) {
          monitoringServiceInstalled.value = false;
          return;
        }
        
        // 如果终端已经有明确的监控状态，直接使用该状态
        if (terminalState.monitoringInstalled !== undefined) {
          monitoringServiceInstalled.value = terminalState.monitoringInstalled;
          return;
        }
        
        // 当终端没有明确状态时，检查监控服务的全局状态
        if (monitoringService && monitoringService.state) {
          // 对于没有明确状态的终端，我们需要检查它是否应该连接到监控
          const sshSessionId = terminalStore.sessions[currentTerminalId];
          if (sshSessionId && sshService && sshService.sessions) {
            const session = sshService.sessions.get(sshSessionId);
            if (session && session.connection) {
              // 检查该终端的主机是否与监控服务连接的主机相同
              const isCurrentHostMonitored = session.connection.host === monitoringService.state.targetHost;
              
              // 只有当主机匹配时才设置为已连接
              terminalState.monitoringInstalled = isCurrentHostMonitored && monitoringService.state.connected;
              monitoringServiceInstalled.value = terminalState.monitoringInstalled;
              return;
            }
          }
          
          // 如果无法确定终端对应的主机，则默认为未安装
          terminalState.monitoringInstalled = false;
          monitoringServiceInstalled.value = false;
        }
      } catch (error) {
        console.debug('检查监控服务状态失败:', error);
        monitoringServiceInstalled.value = false;
      }
    };
    
    // 处理网络延迟更新，按会话/终端ID隔离
    const handleNetworkLatencyUpdate = (event) => {
      // 确保事件数据有效
      if (!event || !event.detail) {
        return;
      }
      
      const { sessionId, remoteLatency, localLatency, totalLatency } = event.detail;
      
      if (!sessionId) {
        // 如果没有会话ID，无法处理
        return;
      }
      
      // 以下缓存所有接收到的延迟数据
      latencyCache.value[sessionId] = {
        remoteLatency,
        localLatency,
        totalLatency,
        timestamp: Date.now()
      };
      
      // 首先检查是不是SSH会话ID，尝试查找对应的终端ID
      let terminalId = null;
      if (sessionId.startsWith('ssh_') && sshService && sshService.sessions) {
        const session = sshService.sessions.get(sessionId);
        if (session && session.terminalId) {
          terminalId = session.terminalId;
          
          // 也缓存到终端ID下
          latencyCache.value[terminalId] = {
            remoteLatency,
            localLatency,
            totalLatency,
            timestamp: Date.now(),
            sourceSession: sessionId
          };
          
          // 更新该终端的工具栏状态
          const terminalState = getTerminalToolbarState(terminalId);
          if (terminalState) {
            terminalState.serverDelay = remoteLatency || 0;
            terminalState.clientDelay = localLatency || 0;
            terminalState.rttValue = totalLatency ? `${totalLatency} ms` : '--';
            terminalState.lastNetworkUpdate = Date.now();
            terminalState.isSshConnected = true;
          }
        }
      } else {
        // 如果不是SSH会话ID，可能直接就是终端ID
        terminalId = sessionId;
        
        // 同样更新该终端的工具栏状态
        const terminalState = getTerminalToolbarState(terminalId);
        if (terminalState) {
          terminalState.serverDelay = remoteLatency || 0;
          terminalState.clientDelay = localLatency || 0;
          terminalState.rttValue = totalLatency ? `${totalLatency} ms` : '--';
          terminalState.lastNetworkUpdate = Date.now();
          terminalState.isSshConnected = true;
        }
      }
      
      // 检查是否是当前活动终端，只有是当前活动终端才更新UI显示
      if (terminalId === props.activeSessionId || sessionId === props.activeSessionId) {
        // 更新当前显示的延迟值
        serverDelay.value = remoteLatency || 0;
        clientDelay.value = localLatency || 0;
        rttValue.value = totalLatency ? `${totalLatency} ms` : '--';
        showNetworkIcon.value = true;
        
        // SSH连接成功，可以使用SFTP功能
        isSshConnected.value = true;
      }
      
      // 保存连接状态到本地存储
      saveConnectionStatus(terminalId || sessionId, true);
      
      // 定期保存延迟缓存到localStorage
      saveLatencyCache();
    };

    // 检查SSH连接状态
    const checkSshConnectionStatus = () => {
      const terminalId = props.activeSessionId;
      if (!terminalId) {
        isSshConnected.value = false;
        return;
      }
      
      // 获取终端特定状态
      const terminalState = getTerminalToolbarState(terminalId);
      
      // 如果已经有确定的状态，直接使用
      if (terminalState && terminalState.isSshConnected !== undefined) {
        isSshConnected.value = terminalState.isSshConnected;
        return;
      }
      
      // 使用terminalStore查找对应的SSH会话
      if (terminalStore && terminalStore.sessions) {
        const sshSessionId = terminalStore.sessions[terminalId];
        if (sshSessionId && sshService && sshService.sessions) {
          const session = sshService.sessions.get(sshSessionId);
          if (session && session.connectionState && session.connectionState.status === 'connected') {
            // 更新全局状态和终端特定状态
            isSshConnected.value = true;
            if (terminalState) {
              terminalState.isSshConnected = true;
            }
            return;
          }
        }
      }
      
      // 如果没有找到有效的SSH会话，则设为未连接
      isSshConnected.value = false;
      if (terminalState) {
        terminalState.isSshConnected = false;
      }
    };

    // 安装监控服务
    const installMonitoring = () => {
      try {
        const terminalId = props.activeSessionId;
        if (!terminalId) {
          // 静默处理，不显示错误消息
          console.debug('无法安装监控：未找到活动会话');
          return;
        }
        
        // 获取终端特定状态
        const terminalState = getTerminalToolbarState(terminalId);
        
        // 检查是否已经在初始化中
        if (terminalState && terminalState.isInitializing) {
          console.debug('监控服务正在初始化中，请等待...');
          return;
        }
        
        // 检查SSH服务会话
        if (!terminalStore || !terminalStore.sessions) {
          console.debug('无法安装监控：终端存储不可用');
          return;
        }
        
        const sshSessionId = terminalStore.sessions[terminalId];
        if (!sshSessionId) {
          // 静默处理，不显示错误消息
          console.debug('无法安装监控：未找到对应的SSH会话');
          return;
        }
        
        if (!sshService || !sshService.sessions) {
          console.debug('无法安装监控：SSH服务不可用');
          return;
        }
        
        const session = sshService.sessions.get(sshSessionId);
        if (!session) {
          // 静默处理，不显示错误消息
          console.debug('无法安装监控：SSH会话不存在');
          return;
        }
        
        // 获取主机信息
        const host = session.connection.host;
        ElMessageBox.confirm(
          `是否要在远程主机 ${host} 上安装监控服务？`,
          '安装监控服务',
          {
            confirmButtonText: '安装',
            cancelButtonText: '取消',
            type: 'info'
          }
        )
        .then(() => {
          // 设置当前终端的初始化状态
          if (terminalState) {
            terminalState.isInitializing = true;
          }
          
          toggleMonitoringPanel();
          
          // 操作完成后重置状态
          setTimeout(() => {
            if (terminalState) {
              terminalState.isInitializing = false;
            }
          }, 1000);
        })
        .catch(() => {
          // 用户取消，无需处理
          if (terminalState) {
            terminalState.isInitializing = false;
          }
        });
      } catch (error) {
        // 出现任何错误都静默处理，只在控制台输出调试信息
        console.debug('安装监控服务时出现错误，默认设为未连接');
        
        // 确保重置初始化状态
        const terminalState = getTerminalToolbarState(props.activeSessionId);
        if (terminalState) {
          terminalState.isInitializing = false;
        }
      }
    };
    
    // 监听会话变化，使用debounce避免过多执行
    let sessionChangeTimeout = null;
    watch(() => props.activeSessionId, (newId, oldId) => {
      if (newId === oldId) return; // 避免重复处理相同值
      
      // 清除之前的超时计时器
      if (sessionChangeTimeout) {
        clearTimeout(sessionChangeTimeout);
      }
      
      // 延迟处理以合并短时间内多次变化
      sessionChangeTimeout = setTimeout(() => {
        if (newId) {
          console.log(`终端切换: ${oldId} -> ${newId}`);
          
          // 获取或创建该终端的状态
          const terminalState = getTerminalToolbarState(newId);
          
          // 完全重置当前UI状态，确保显示干净
          monitoringServiceInstalled.value = false;
          showNetworkIcon.value = false;
          rttValue.value = '--';
          serverDelay.value = 0;
          clientDelay.value = 0;
          isSshConnected.value = false;
          
          // 如果有新终端的状态，完全应用该状态
          if (terminalState) {
            // 从终端特定状态恢复所有状态
            monitoringServiceInstalled.value = !!terminalState.monitoringInstalled;
            isSshConnected.value = !!terminalState.isSshConnected;
            
            // 恢复网络信息
            if (terminalState.lastNetworkUpdate) {
              showNetworkIcon.value = true;
              rttValue.value = terminalState.rttValue || '--';
              serverDelay.value = terminalState.serverDelay || 0;
              clientDelay.value = terminalState.clientDelay || 0;
            }
          }
          
          // 会话变化时重新检查状态（只在状态不确定时）
          if (!terminalState || 
              terminalState.isSshConnected === undefined || 
              terminalState.monitoringInstalled === undefined) {
            checkSshConnectionStatus();
            checkMonitoringServiceStatus();
          }
          
          lastProcessedSessionId.value = newId;
        }
      }, 150); // 150ms的防抖延迟
    }, { immediate: true });
    
    // 监听处理监控状态变化事件
    const handleMonitoringStatusChange = (event) => {
      if (event && event.detail) {
        if (event.detail.terminalId) {
          // 处理特定终端的状态更新
          const terminalId = event.detail.terminalId;
          const terminalState = getTerminalToolbarState(terminalId);
          
          if (terminalState) {
            // 只更新特定终端的状态
            terminalState.monitoringInstalled = event.detail.installed;
            
            // 如果是当前活动的终端，同时更新UI
            if (terminalId === props.activeSessionId) {
              monitoringServiceInstalled.value = event.detail.installed;
            }
          }
        } else if (event.detail.sessionId) {
          // 尝试通过SSH会话ID找到对应的终端ID
          const sessionId = event.detail.sessionId;
          let terminalId = null;
          
          // 在terminalStore中查找关联的终端ID
          for (const [tId, sId] of Object.entries(terminalStore.sessions)) {
            if (sId === sessionId) {
              terminalId = tId;
              break;
            }
          }
          
          if (terminalId) {
            const terminalState = getTerminalToolbarState(terminalId);
            if (terminalState) {
              terminalState.monitoringInstalled = event.detail.installed;
              
              // 如果是当前活动终端，更新UI
              if (terminalId === props.activeSessionId) {
                monitoringServiceInstalled.value = event.detail.installed;
              }
            }
          }
        } else {
          // 无特定终端ID的全局状态更新（保留兼容性）
          // 只更新当前活动终端
          if (props.activeSessionId) {
            const terminalState = getTerminalToolbarState(props.activeSessionId);
            if (terminalState) {
              terminalState.monitoringInstalled = event.detail.installed;
              monitoringServiceInstalled.value = event.detail.installed;
            }
          }
        }
      }
    };
    
    // 添加一个变量跟踪鼠标是否在tooltip上
    const tooltipHover = ref(false)
    
    // 鼠标进入tooltip事件处理函数
    const onTooltipMouseEnter = () => {
      tooltipHover.value = true
    }
    
    // 鼠标离开tooltip事件处理函数
    const onTooltipMouseLeave = () => {
      tooltipHover.value = false
      showSftpTooltip.value = false
    }
    
    // 为已连接状态添加鼠标处理函数
    const onConnectedTooltipMouseEnter = () => {
      connectedTooltipHover.value = true
    }
    
    const onConnectedTooltipMouseLeave = () => {
      connectedTooltipHover.value = false
      showConnectedSftpTooltip.value = false
    }
    
    // 添加监控按钮tooltip相关状态
    const monitorButtonRef = ref(null)
    const showMonitorTooltip = ref(false)
    const monitorTooltipHover = ref(false)
    const monitorTooltipStyle = ref({
      position: 'fixed',
      zIndex: 10000,
      top: '0px',
      left: '0px',
      display: 'none'
    })
    
    // 计算并更新tooltip的位置
    const updateMonitorTooltipPosition = () => {
      if (!monitorButtonRef.value) return
      
      const rect = monitorButtonRef.value.getBoundingClientRect()
      monitorTooltipStyle.value = {
        position: 'fixed',
        zIndex: 10000,
        backgroundColor: '#333',
        color: '#e0e0e0',
        padding: '8px 12px',
        borderRadius: '4px',
        fontSize: '13px',
        whiteSpace: 'nowrap',
        boxShadow: '0 3px 12px rgba(0, 0, 0, 0.4)',
        top: `${rect.bottom + 10}px`,
        left: `${rect.left + rect.width / 2}px`,
        transform: 'translateX(-50%)'
      }
    }
    
    // 监控tooltip鼠标事件处理
    const onMonitorTooltipMouseEnter = () => {
      monitorTooltipHover.value = true
    }
    
    const onMonitorTooltipMouseLeave = () => {
      monitorTooltipHover.value = false
      showMonitorTooltip.value = false
    }
    
    // 网络延迟弹窗位置自适应函数
    const handleResize = () => {
      if (showNetworkPopup.value) {
        updateNetworkPopupPosition();
      }
      
      // 同时更新SFTP提示位置
      if (showSftpTooltip.value || showConnectedSftpTooltip.value) {
        updateSftpTooltipPosition();
      }
    };
    
    // 立即检查当前会话的状态（在mounted中调用）
    const checkCurrentSessionStatus = () => {
      const currentSessionId = props.activeSessionId;
      if (!currentSessionId) return;
      
      console.log(`立即检查当前会话状态: ${currentSessionId}`);
      
      // 先检查是否已有缓存的状态
      const terminalState = getTerminalToolbarState(currentSessionId);
      
      // 如果SSH连接状态未知，检查终端连接状态
      if (terminalState && terminalState.isSshConnected === undefined) {
        if (terminalStore && terminalStore.sessions) {
          const sshSessionId = terminalStore.sessions[currentSessionId];
          if (sshSessionId && terminalStore.isTerminalConnected(currentSessionId)) {
            // 更新状态
            console.log(`当前会话 ${currentSessionId} 已连接SSH`);
            terminalState.isSshConnected = true;
            isSshConnected.value = true;
          }
        }
      } else if (terminalState && terminalState.isSshConnected) {
        // 使用缓存的状态
        isSshConnected.value = true;
      }
      
      // 检查网络状态
      if (terminalState && !terminalState.lastNetworkUpdate) {
        // 尝试从缓存获取
        const cachedLatency = latencyCache.value[currentSessionId];
        if (cachedLatency && cachedLatency.totalLatency) {
          showNetworkIcon.value = true;
          rttValue.value = `${cachedLatency.totalLatency} ms`;
          clientDelay.value = cachedLatency.localLatency || 0;
          serverDelay.value = cachedLatency.remoteLatency || 0;
          
          // 更新终端状态
          terminalState.rttValue = rttValue.value;
          terminalState.clientDelay = clientDelay.value;
          terminalState.serverDelay = serverDelay.value;
          terminalState.lastNetworkUpdate = Date.now();
        }
      }
    };
    
    // 初始化网络监控
    onMounted(() => {
      // 加载缓存的延迟数据和连接状态
      loadCachedLatencyData();
      loadConnectionStatus();
      
      // 立即检查当前会话状态
      checkCurrentSessionStatus();
      
      // 检查当前SSH连接状态
      checkSshConnectionStatus();
      
      // 添加网络延迟更新事件监听器
      window.addEventListener('network-latency-update', handleNetworkLatencyUpdate);
      
      // 添加SSH连接成功事件监听器
      window.addEventListener('ssh-connected', (event) => {
        if (!event.detail) return;
        
        const sessionId = event.detail.sessionId;
        let terminalId = event.detail.terminalId;
        
        // 尝试从SSH会话ID获取终端ID（以防上面的修改未生效或向后兼容）
        if (!terminalId && sessionId && terminalStore && terminalStore.sessions) {
          // 通过反向查找获取终端ID
          for (const [tId, sId] of Object.entries(terminalStore.sessions)) {
            if (sId === sessionId) {
              terminalId = tId;
              break;
            }
          }
        }
        
        console.log(`收到SSH连接成功事件: 会话ID=${sessionId}, 终端ID=${terminalId || '未知'}`);
        
        if (sessionId) {
          // 保存会话连接状态
          saveConnectionStatus(sessionId, true);
          
          // 更新对应终端的状态
          if (terminalId) {
            // 如果没有该终端的状态，先创建
            const terminalState = getTerminalToolbarState(terminalId);
            if (terminalState) {
              terminalState.isSshConnected = true;
              
              // 只有是当前活动终端时才更新UI
              if (terminalId === props.activeSessionId) {
                isSshConnected.value = true;
              }
            }
          }
          
          // 额外检查：如果当前没有活动终端但会话ID与当前活动会话匹配，也更新UI
          // 这是为了处理新建连接的情况
          if (!terminalId && sessionId === sessionStore.getActiveSession()) {
            isSshConnected.value = true;
          }
        }
      });
      
      // 添加监控状态变化事件监听
      window.addEventListener('monitoring-status-change', handleMonitoringStatusChange);
      
      // 初始检查监控服务状态
      checkMonitoringServiceStatus();
      
      // SFTP按钮鼠标事件监听
      if (sftpButtonRef.value) {
        sftpButtonRef.value.addEventListener('mouseenter', () => {
          if (!isSshConnected.value) {
            updateSftpTooltipPosition();
            showSftpTooltip.value = true;
          } else {
            // 已连接状态下显示不同的tooltip
            updateSftpTooltipPosition();
            showConnectedSftpTooltip.value = true;
          }
        });
        
        sftpButtonRef.value.addEventListener('mouseleave', () => {
          // 当鼠标离开按钮时不立即隐藏，给用户时间移动到tooltip上
          setTimeout(() => {
            // 延迟检查是否仍然应该显示tooltip
            if (!tooltipHover.value) {
              showSftpTooltip.value = false;
            }
            if (!connectedTooltipHover.value) {
              showConnectedSftpTooltip.value = false;
            }
          }, 100);
        });
      }
      
      // 监控按钮鼠标悬停事件
      if (monitorButtonRef.value) {
        monitorButtonRef.value.addEventListener('mouseenter', () => {
          updateMonitorTooltipPosition();
          showMonitorTooltip.value = true;
        });
        
        monitorButtonRef.value.addEventListener('mouseleave', () => {
          setTimeout(() => {
            if (!monitorTooltipHover.value) {
              showMonitorTooltip.value = false;
            }
          }, 100);
        });
      }
      
      // 处理窗口大小变化，更新提示框位置
      window.addEventListener('resize', handleResize);
      
      // 定期保存延迟缓存到localStorage (每10分钟)
      const saveInterval = setInterval(() => {
        saveLatencyCache();
      }, 10 * 60 * 1000);
      
      // 组件卸载时清除定时器
      onUnmounted(() => {
        clearInterval(saveInterval);
      });
    });
    
    // 清理资源
    onUnmounted(() => {
      // 保存最终状态到缓存
      saveLatencyCache();
      
      // 移除所有事件监听器
      window.removeEventListener('network-latency-update', handleNetworkLatencyUpdate);
      window.removeEventListener('ssh-connected', () => {
        isSshConnected.value = true;
      });
      window.removeEventListener('monitoring-status-change', handleMonitoringStatusChange);
      window.removeEventListener('resize', updateSftpTooltipPosition);
      window.removeEventListener('resize', handleResize);
      
      // 清除会话变化的计时器
      if (sessionChangeTimeout) {
        clearTimeout(sessionChangeTimeout);
      }
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
      installMonitoring,
      isPanelVisible,
      isSshConnected,
      handleSftpClick,
      sftpButtonRef,
      showSftpTooltip,
      showConnectedSftpTooltip,
      sftpTooltipStyle,
      onTooltipMouseEnter,
      onTooltipMouseLeave,
      onConnectedTooltipMouseEnter,
      onConnectedTooltipMouseLeave,
      // 监控相关
      monitorButtonRef,
      showMonitorTooltip,
      monitorTooltipStyle,
      onMonitorTooltipMouseEnter,
      onMonitorTooltipMouseLeave,
      networkIconRef,
      updateNetworkPopupPosition,
      networkPopupStyle
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
  opacity: 0.5;
  filter: grayscale(100%);
}

/* 白色图标样式 */
.icon-white {
  opacity: 1;
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
  background-color: #242424;
  border-radius: 4px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
  z-index: 10000;
  overflow: hidden;
}

.network-popup:after {
  content: '';
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  border-width: 5px;
  border-style: solid;
  border-color: transparent transparent #1e1e1e transparent;
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

.icon-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.icon-available {
  cursor: pointer;
}

.icon-button:not(.icon-available) {
  cursor: not-allowed;
}

/* SFTP tooltip样式 */
.sftp-tooltip {
  position: fixed;
  z-index: 10000;
  background-color: #333;
  color: #e0e0e0;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 13px;
  white-space: nowrap;
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.4);
}

.sftp-tooltip:after {
  content: '';
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  border-width: 5px;
  border-style: solid;
  border-color: transparent transparent #333 transparent;
}
</style> 