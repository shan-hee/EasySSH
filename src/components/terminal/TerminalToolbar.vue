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
          @click.stop="handleMonitoringClick()" 
          :class="{ 'icon-available': monitoringServiceInstalled, 'active': isPanelVisible }"
          ref="monitorButtonRef">
          <img src="@/assets/icons/icon-monitoring.svg" class="ruyi-icon ruyi-icon-ot-monitoring" width="16" height="16" 
               :class="{ 'icon-gray': !monitoringServiceInstalled, 'icon-white': monitoringServiceInstalled }" />
        </div>
        
        <!-- 使用teleport将监控工具提示内容传送到body中 -->
        <teleport to="body">
          <!-- 未登录状态提示 -->
          <div v-if="!isLoggedIn && showMonitorTooltip"
               class="sftp-tooltip" :style="monitorTooltipStyle"
               @mouseenter="onMonitorTooltipMouseEnter" @mouseleave="onMonitorTooltipMouseLeave">
            登录后启用
          </div>

          <!-- 已登录且已安装监控服务提示 -->
          <div v-else-if="isLoggedIn && monitoringServiceInstalled && !isPanelVisible && showMonitorTooltip"
               class="sftp-tooltip" :style="monitorTooltipStyle"
               @mouseenter="onMonitorTooltipMouseEnter" @mouseleave="onMonitorTooltipMouseLeave">
            查看系统监控
          </div>

          <!-- 已登录但未安装监控服务提示 -->
          <div v-else-if="isLoggedIn && !monitoringServiceInstalled && showMonitorTooltip"
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
import { useUserStore } from '../../store/user'
import axios from 'axios'
import sshService from '../../services/ssh/index'
import monitoringService from '../../services/monitoring'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useTerminalStore } from '../../store/terminal'
import { LATENCY_EVENTS } from '../../services/constants'
import log from '../../services/log'

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
    const userStore = useUserStore()
    const lastProcessedSessionId = ref(null)
    const isSshConnected = ref(false)
    const showSftpTooltip = ref(false)
    const sftpButtonRef = ref(null)
    const networkIconRef = ref(null)

    // 用户登录状态
    const isLoggedIn = computed(() => userStore.isLoggedIn)
    
    // 添加按终端ID隔离的状态对象
    const terminalToolbarStates = ref({})
    
    // 在组件setup部分顶部，添加防抖控制变量
    const statusCheckDebounceTimers = ref({})
    
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
      // 只有当监控服务已安装时才能切换面板
      if (monitoringServiceInstalled.value) {
        // 通过事件将当前终端ID传递给父组件
        emit('toggle-monitoring-panel');
      } else {
        // 尝试安装监控服务
        installMonitoring();
      }
      }
      
    // 安装监控服务
    const installMonitoring = async () => {
      try {
        // 检查是否有SSH会话连接或终端
        let connection = null;
        const sessionId = props.activeSessionId;
        
        if (sessionId) {
          // 尝试获取SSH会话
          const session = terminalStore.getSession(sessionId);
          if (session) {
            // 使用获取到的连接信息
            connection = session.connection;
          }
        }
        
        if (connection) {
          log.info('使用现有的连接信息打开监控:', connection.host);
          emit('toggle-monitoring-panel');
        } else {
          // 如果没有找到有效的连接，使用默认方式打开监控
          log.info('未找到有效会话连接信息，使用默认方式打开监控');
          emit('toggle-monitoring-panel');
        }
      } catch (error) {
        ElMessage.error(`安装监控服务失败: ${error.message}`);
      }
    }
    
    // 检查监控服务状态
    const checkMonitoringServiceStatus = () => {
      // 如果用户未登录，直接跳过状态检查
      if (!isLoggedIn.value) {
        monitoringServiceInstalled.value = false;
        return;
      }

      // 静默处理，避免出现任何错误或异常
      try {
        // 获取当前终端ID
        const currentTerminalId = props.activeSessionId;
        if (!currentTerminalId) {
          // 不改变当前状态，保持默认灰色图标
          return;
        }

        // 获取当前终端的状态
        const terminalState = getTerminalToolbarState(currentTerminalId);
        if (!terminalState) {
          // 不改变当前状态，保持默认灰色图标
          return;
        }

        // 优先使用缓存状态，减少对全局监控服务的依赖
        if (terminalState.monitoringInstalled !== undefined) {
          monitoringServiceInstalled.value = terminalState.monitoringInstalled;
          return;
        }
        
        // 如果终端有关联的SSH会话，检查它是否监控了相应的主机
        if (terminalStore && terminalStore.sessions) {
          const sshSessionId = terminalStore.sessions[currentTerminalId];
          if (sshSessionId && sshService && sshService.sessions) {
            const session = sshService.sessions.get(sshSessionId);
            if (session && session.connection) {
              const host = session.connection.host;
              
              // 优先使用monitoringService.isTerminalMonitored方法判断
              if (monitoringService && typeof monitoringService.isTerminalMonitored === 'function') {
                terminalState.monitoringInstalled = monitoringService.isTerminalMonitored(currentTerminalId);
              monitoringServiceInstalled.value = terminalState.monitoringInstalled;
              return;
            }
          
              // 备选方案：检查主机匹配
              if (monitoringService && monitoringService.state) {
                terminalState.monitoringInstalled = 
                  monitoringService.state.connected && 
                  monitoringService.state.targetHost === host;
                monitoringServiceInstalled.value = terminalState.monitoringInstalled;
              }
            }
          }
        }
      } catch (error) {
        console.debug('检查监控服务状态失败:', error);
        // 不改变当前状态，保持默认灰色图标
      }
    };
    
    // 处理网络延迟更新，按会话/终端ID隔离
    const handleNetworkLatencyUpdate = (event) => {
      // 确保事件数据有效
      if (!event || !event.detail) {
        return;
      }
      
      const { sessionId, remoteLatency, localLatency, totalLatency, terminalId: eventTerminalId } = event.detail;
      
      if (!sessionId) {
        // 如果没有会话ID，无法处理
        return;
      }
      
      // 首先使用事件中直接提供的终端ID
      let terminalId = eventTerminalId;
      
      // 如果事件中没有直接提供终端ID，尝试通过SSH服务查找
      if (!terminalId && sessionId.startsWith('ssh_') && sshService) {
        // 优先使用会话-终端映射
        terminalId = sshService.sessionTerminalMap?.get(sessionId);
        
        // 如果映射中没有，尝试从会话对象中获取
        if (!terminalId && sshService.sessions?.has(sessionId)) {
        const session = sshService.sessions.get(sessionId);
          terminalId = session.terminalId;
        }
      } else if (!terminalId) {
        // 如果不是SSH会话ID，可能直接就是终端ID
        terminalId = sessionId;
      }
        
      // 如果找到了终端ID，更新其工具栏状态
      if (terminalId) {
        const terminalState = getTerminalToolbarState(terminalId);
        if (terminalState) {
          terminalState.serverDelay = remoteLatency || 0;
          terminalState.clientDelay = localLatency || 0;
          terminalState.rttValue = totalLatency ? `${totalLatency} ms` : '--';
          terminalState.isSshConnected = true;
      
          // 如果是当前活动终端，直接更新界面状态
          if (terminalId === props.activeSessionId) {
            serverDelay.value = terminalState.serverDelay;
            clientDelay.value = terminalState.clientDelay;
            rttValue.value = terminalState.rttValue;
          showNetworkIcon.value = true;
        }
      }
      }
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
    
    // 监听会话变化，使用debounce避免过多执行
    let sessionChangeTimeout = null;
    watch(() => props.activeSessionId, (newId, oldId) => {
      if (newId === oldId) return; // 避免重复处理相同值
      
      // 清除之前的超时计时器
      if (sessionChangeTimeout) {
        clearTimeout(sessionChangeTimeout);
      }
      
      // 立即记录日志
      log.debug(`终端切换: ${oldId} -> ${newId}`);
      
      // 标签页切换时立即应用新终端的状态，不需要延迟
      if (newId) {
        // 获取或创建该终端的状态
        const terminalState = getTerminalToolbarState(newId);
        
        // 首先清除当前UI状态
        rttValue.value = '--';
        serverDelay.value = 0;
        clientDelay.value = 0;
        showNetworkIcon.value = false; // 默认不显示网络图标，根据下面的条件决定是否显示
        
        // 设置SSH连接状态 - 这决定了SFTP按钮是否可用
        if (terminalState && terminalState.isSshConnected !== undefined) {
          isSshConnected.value = terminalState.isSshConnected;
        } else {
          // 如果没有确定的状态，检查SSH连接
          isSshConnected.value = false;
          checkSshConnectionStatus();
        }
        
        // 设置监控服务状态 - 这决定了监控按钮是否可用
        if (terminalState && terminalState.monitoringInstalled !== undefined) {
          monitoringServiceInstalled.value = terminalState.monitoringInstalled;
        } else {
          // 如果没有确定的状态，检查监控状态
          monitoringServiceInstalled.value = false;
          checkMonitoringServiceStatus();
        }
        
        // 在切换终端标签页时，恢复显示该终端的网络延迟数据
        if (terminalState && 
            typeof terminalState.serverDelay === 'number' &&
            typeof terminalState.clientDelay === 'number' &&
            (terminalState.serverDelay > 0 || terminalState.clientDelay > 0)) {
          showNetworkIcon.value = true;
          rttValue.value = terminalState.rttValue || '--';
          serverDelay.value = terminalState.serverDelay || 0;
          clientDelay.value = terminalState.clientDelay || 0;
        }
        
        // 将会话ID记录为最后处理的ID
        lastProcessedSessionId.value = newId;
        
        // 应用终端状态隔离，确保每个终端状态独立
        nextTick(() => {
          applyInitialStatus();
        });
      }
    }, { immediate: true });
    
    // 监听监控服务状态变化，确保UI及时更新
    watch(() => monitoringService.state, (newState) => {
      if (!newState) return;
      
      // 当监控服务状态变化时，重新应用当前终端的状态
      const currentId = props.activeSessionId;
      if (currentId) {
        log.debug('监控服务状态已变化，重新检查终端状态');
        nextTick(() => {
          applyInitialStatus();
        });
      }
    }, { deep: true });
    
    // 处理监控状态变化事件 - 优化版
    const handleMonitoringStatusChange = (event) => {
      if (!event || !event.detail) {
        return;
      }

      const { installed, terminalId, hostname, status } = event.detail;

      log.debug(`[终端工具栏] 收到监控状态变更事件: 主机=${hostname}, 已安装=${installed}, 终端=${terminalId}`);

      if (terminalId) {
        // 处理特定终端的状态更新
        const terminalState = getTerminalToolbarState(terminalId);

        if (terminalState) {
          // 更新终端状态
          terminalState.monitoringInstalled = installed;

          // 如果是当前活动的终端，同时更新UI
          if (terminalId === props.activeSessionId) {
            monitoringServiceInstalled.value = installed;
            log.debug(`[终端工具栏] 更新当前活动终端[${terminalId}]的监控状态: ${installed}`);

            // 如果监控服务已安装，图标应该变为白色（可点击状态）
            // 如果未安装，图标保持默认状态
            if (installed) {
              log.debug(`[终端工具栏] 监控服务已安装，图标变为白色可点击状态`);
            } else {
              log.debug(`[终端工具栏] 监控服务未安装，图标保持默认状态`);
            }
          }
        }
      } else if (event.detail.sessionId) {
        // 兼容通过SSH会话ID的方式
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
            terminalState.monitoringInstalled = installed;

            // 如果是当前活动终端，更新UI
            if (terminalId === props.activeSessionId) {
              monitoringServiceInstalled.value = installed;
              log.debug(`[终端工具栏] 通过会话ID[${sessionId}]更新终端[${terminalId}]的监控状态: ${installed}`);
            }
          }
        }
      } else if (event.detail.hostAddress || hostname) {
        // 兼容通过主机地址匹配的方式
        const hostAddress = event.detail.hostAddress || hostname;

        // 只更新当前活动终端，如果它连接到这个主机
        if (props.activeSessionId) {
          const sshSessionId = terminalStore.sessions[props.activeSessionId];
          if (sshSessionId && sshService && sshService.sessions) {
            const session = sshService.sessions.get(sshSessionId);
            if (session && session.connection && session.connection.host === hostAddress) {
              // 更新终端状态
              const terminalState = getTerminalToolbarState(props.activeSessionId);
              if (terminalState) {
                terminalState.monitoringInstalled = installed;
                monitoringServiceInstalled.value = installed;
                log.debug(`[终端工具栏] 通过主机地址[${hostAddress}]匹配更新当前终端的监控状态: ${installed}`);
              }
            }
          }
        }
      } else {
        // 全局状态更新（向后兼容）
        monitoringServiceInstalled.value = installed;
        log.debug(`[终端工具栏] 更新全局监控状态: ${installed}`);
      }
    };
    
    // 添加监控连接成功事件处理
    const handleMonitoringConnected = (event) => {
      log.debug('收到监控连接成功事件:', event);
      if (!event || !event.detail) return;
      
      const { hostAddress } = event.detail;
      if (!hostAddress) return;
      
      // 检查当前活动终端是否连接到该主机
      if (props.activeSessionId) {
        const sshSessionId = terminalStore.sessions[props.activeSessionId];
        if (sshSessionId && sshService && sshService.sessions) {
          const session = sshService.sessions.get(sshSessionId);
          if (session && session.connection && session.connection.host === hostAddress) {
            // 更新终端状态
            const terminalState = getTerminalToolbarState(props.activeSessionId);
            if (terminalState) {
              terminalState.monitoringInstalled = true;
              monitoringServiceInstalled.value = true;
              log.debug(`监控连接成功，更新终端[${props.activeSessionId}]的监控状态为已连接`);
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
      if (!currentSessionId) {
        // 如果没有会话ID，确保不显示网络图标
        showNetworkIcon.value = false;
        return;
      }
      
      log.debug(`立即检查当前会话状态: ${currentSessionId}`);
      
      // 先检查是否已有缓存的状态
      const terminalState = getTerminalToolbarState(currentSessionId);
      
      // 如果SSH连接状态未知，检查终端连接状态
      if (terminalState && terminalState.isSshConnected === undefined) {
        if (terminalStore && terminalStore.sessions) {
          const sshSessionId = terminalStore.sessions[currentSessionId];
          if (sshSessionId && terminalStore.isTerminalConnected(currentSessionId)) {
            // 更新状态
            log.debug(`当前会话 ${currentSessionId} 已连接SSH`);
            terminalState.isSshConnected = true;
            isSshConnected.value = true;
          }
        }
      } else if (terminalState && terminalState.isSshConnected) {
        // 使用缓存的状态
        isSshConnected.value = true;
      }
      
      // 检查网络状态 - 先不显示网络图标，只有在有有效的延迟数据时才显示
      if (terminalState && 
          typeof terminalState.serverDelay === 'number' &&
          typeof terminalState.clientDelay === 'number' &&
          (terminalState.serverDelay > 0 || terminalState.clientDelay > 0)) {
        // 使用终端状态中的延迟数据
        showNetworkIcon.value = true;
        rttValue.value = terminalState.rttValue || '--';
        serverDelay.value = terminalState.serverDelay;
        clientDelay.value = terminalState.clientDelay;
      } else {
        // 如果终端状态中没有延迟数据，不显示网络图标
        showNetworkIcon.value = false;
      }
    };
    
    // 处理工具栏状态重置的函数
    const handleToolbarReset = (event) => {
      if (!event.detail || !event.detail.sessionId) return;
      
      const { sessionId } = event.detail;
      log.debug(`收到工具栏重置事件: sessionId=${sessionId}`);
      
      // 只有当当前活动会话是目标会话时才重置UI状态
      if (sessionId === props.activeSessionId) {
        // 清除当前工具栏UI状态
        isSshConnected.value = false;
        showNetworkIcon.value = false; // 默认不显示网络图标，等待有效数据
        rttValue.value = '--';
        serverDelay.value = 0;
        clientDelay.value = 0;
        monitoringServiceInstalled.value = false;
      }
      
      // 重置终端特定状态
      const terminalState = getTerminalToolbarState(sessionId);
      if (terminalState) {
        // 重置该终端的各项状态
        terminalState.isSshConnected = false;
        terminalState.monitoringInstalled = false;
        terminalState.rttValue = '--';
        terminalState.clientDelay = 0;
        terminalState.serverDelay = 0;
        
        // 保留连接中状态以便显示加载动画
        terminalState.isConnecting = true;
      }
      
      // 如果是当前活动终端，立即重新检查各项状态
      if (sessionId === props.activeSessionId) {
        // 延迟一小会再检查状态，因为此时终端可能还在初始化
        setTimeout(() => {
          checkSshConnectionStatus();
          checkMonitoringServiceStatus();
        }, 500);
      }
    };
    
    // 添加已处理的SSH会话集合
    const processedSshSessions = ref(new Set())
    
    // 处理SSH连接成功事件的函数
    const handleSshConnected = (event) => {
      if (!event.detail) return;
      
      const sessionId = event.detail.sessionId;
      let terminalId = event.detail.terminalId;
      
      // 检查是否已经处理过该SSH会话
      if (processedSshSessions.value.has(sessionId)) {
        log.debug(`SSH会话 ${sessionId} 的连接成功事件已处理，跳过重复处理`);
        return;
      }
      
      // 添加到已处理集合
      processedSshSessions.value.add(sessionId);
      
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
      
      log.debug(`收到SSH连接成功事件: 会话ID=${sessionId}, 终端ID=${terminalId || '未知'}`);
      
      if (sessionId) {
        // 保存会话连接状态
        updateConnectionStatus(sessionId, true);
        
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
        
        // 在SSH连接成功时，立即检查监控状态
        checkMonitoringServiceStatus();
      }
    };
    
    // 处理工具栏状态同步事件的函数 - 不会触发加载动画
    const handleToolbarSync = (event) => {
      if (!event.detail || !event.detail.sessionId) return;
      
      const { sessionId } = event.detail;
      log.debug(`收到工具栏同步事件: sessionId=${sessionId}`);
      
      // 只有当当前活动会话是目标会话时才同步UI状态
      if (sessionId === props.activeSessionId) {
        // 获取终端特定状态
        const terminalState = getTerminalToolbarState(sessionId);
        
        // 同步SSH连接状态
        if (terminalState && terminalState.isSshConnected !== undefined) {
          isSshConnected.value = terminalState.isSshConnected;
        } else {
          // 如果没有确定的状态，检查SSH连接
          checkSshConnectionStatus();
        }
        
        // 同步监控服务状态
        if (terminalState && terminalState.monitoringInstalled !== undefined) {
          monitoringServiceInstalled.value = terminalState.monitoringInstalled;
        } else {
          // 如果没有确定的状态，检查监控状态
          checkMonitoringServiceStatus();
        }
        
        // 同步网络信息
        if (terminalState && 
            typeof terminalState.serverDelay === 'number' && 
            typeof terminalState.clientDelay === 'number' &&
            (terminalState.serverDelay > 0 || terminalState.clientDelay > 0)) {
          showNetworkIcon.value = true;
          rttValue.value = terminalState.rttValue || '--';
          serverDelay.value = terminalState.serverDelay || 0;
          clientDelay.value = terminalState.clientDelay || 0;
          } else {
          // 没有有效的延迟数据，不显示网络图标
            showNetworkIcon.value = false;
            rttValue.value = '--';
            clientDelay.value = 0;
            serverDelay.value = 0;
          }
        
        // 确保状态完全隔离
        nextTick(() => {
          applyInitialStatus();
        });
      }
    };
    
    // 处理终端状态刷新事件
    const handleTerminalRefreshStatus = (event) => {
      if (!event.detail || !event.detail.sessionId) return;
      
      const { sessionId } = event.detail;
      log.debug(`收到终端状态刷新事件: ${sessionId}`);
    
      // 只有当当前活动会话是目标会话时才刷新UI状态
      if (sessionId === props.activeSessionId) {
        // 使用更可靠的方法重新检查所有状态
        
        // 1. 获取终端特定状态缓存
        const terminalState = getTerminalToolbarState(sessionId);
        
        // 2. 优先使用缓存的状态值
        if (terminalState) {
          // 恢复SSH连接状态
          if (terminalState.isSshConnected !== undefined) {
            isSshConnected.value = terminalState.isSshConnected;
        } else {
            // 如果没有缓存状态，重新检查
      checkSshConnectionStatus();
          }
      
          // 恢复监控服务状态 - 增强版本
          // 增强监控状态检查，直接使用applyInitialStatus函数
          // 这样确保在刷新状态时使用相同的增强逻辑
          applyInitialStatus();
          
          // 恢复网络延迟数据显示
          if (terminalState.rttValue && 
              typeof terminalState.serverDelay === 'number' && 
              typeof terminalState.clientDelay === 'number' &&
              (terminalState.serverDelay > 0 || terminalState.clientDelay > 0)) {
            showNetworkIcon.value = true;
            rttValue.value = terminalState.rttValue;
            serverDelay.value = terminalState.serverDelay;
            clientDelay.value = terminalState.clientDelay;
          } else {
            // 没有有效的延迟数据时，不显示网络图标
          showNetworkIcon.value = false;
          }
        } else {
          // 如果没有终端状态缓存，重新检查所有状态
          checkSshConnectionStatus();
          // 使用增强版本检查监控状态
          applyInitialStatus();
          showNetworkIcon.value = false;
        }
        
        log.debug(`工具栏状态已刷新: SSH连接=${isSshConnected.value}, 监控服务=${monitoringServiceInstalled.value}, 网络图标=${showNetworkIcon.value}`);
      }
    };
    
    // 修改保存连接状态函数为更新状态函数
    const updateConnectionStatus = (sessionId, isConnected) => {
      // 仅在内存中更新状态
      const terminalState = getTerminalToolbarState(sessionId);
      if (terminalState) {
        terminalState.isSshConnected = isConnected;
        
        // 如果是当前活动终端，更新UI
        if (sessionId === props.activeSessionId) {
          isSshConnected.value = isConnected;
        }
      }
    }
    
    // 添加新会话事件处理函数
    const handleNewSession = (event) => {
      if (!event.detail || !event.detail.sessionId) return;
      
      const { sessionId, isNewCreation } = event.detail;
      log.debug(`工具栏收到新会话事件: ${sessionId}, 是否新创建: ${isNewCreation}`);
      
      if (isNewCreation && sessionId === props.activeSessionId) {
        // 清理当前工具栏状态
        isSshConnected.value = false;
        showNetworkIcon.value = false;
        rttValue.value = '--';
        serverDelay.value = 0;
        clientDelay.value = 0;
        monitoringServiceInstalled.value = false;
        
        // 清理对应终端的工具栏状态
        if (terminalToolbarStates.value[sessionId]) {
          // 创建新的状态对象而不是清理现有状态，保证状态完全隔离
          terminalToolbarStates.value[sessionId] = {
            isInitializing: false,
            isConnecting: true, // 新创建的终端默认处于连接中状态
            isSshConnected: false,
            monitoringInstalled: false,
            rttValue: '--',
            clientDelay: 0,
            serverDelay: 0,
            tooltipVisible: false
          };
          
          log.debug(`已重置工具栏[${sessionId}]状态`);
        }
      }
    };
    
    // 新增处理监控图标点击的函数
    const handleMonitoringClick = () => {
      // 如果用户未登录，显示登录提示
      if (!isLoggedIn.value) {
        updateMonitorTooltipPosition();
        showMonitorTooltip.value = true;
        return;
      }

      // 只有当监控服务已安装且面板未显示时才执行操作
      if (monitoringServiceInstalled.value && !isPanelVisible.value) {
        emit('toggle-monitoring-panel');
      } else {
        // 如果监控未安装或面板已显示，只显示提示信息
        if (!monitoringServiceInstalled.value) {
          // 监控服务未安装时显示tooltip
          updateMonitorTooltipPosition();
          showMonitorTooltip.value = true;
        }
        // 面板已显示状态下不执行任何操作，只返回
        return;
      }
    };
    
    // 添加防抖包装函数
    const debouncedApplyStatus = (terminalId) => {
      // 如果已有相同终端ID的定时器，先清除
      if (statusCheckDebounceTimers.value[terminalId]) {
        clearTimeout(statusCheckDebounceTimers.value[terminalId]);
      }
      
      // 设置新的定时器
      statusCheckDebounceTimers.value[terminalId] = setTimeout(() => {
        // 执行状态隔离检查
        applyInitialStatusInternal(terminalId);
        // 清除定时器引用
        delete statusCheckDebounceTimers.value[terminalId];
      }, 100); // 100ms防抖延迟
    };
    
    // 修改原有的applyInitialStatus函数为包装函数
    const applyInitialStatus = () => {
      const currentId = props.activeSessionId;
      if (!currentId) return;
      debouncedApplyStatus(currentId);
    };
    
    // 内部实际执行的状态隔离函数
    const applyInitialStatusInternal = (currentId) => {
      try {
        if (!currentId) return;
        
        log.debug(`[工具栏] 确保终端状态独立: ${currentId}`);
        
        // 获取当前终端的状态
        const terminalState = getTerminalToolbarState(currentId);
        if (!terminalState) return;
        
        // 1. 检查该终端的SSH连接和主机信息
        if (terminalStore && terminalStore.sessions) {
          const sshSessionId = terminalStore.sessions[currentId];
          if (sshSessionId && sshService && sshService.sessions) {
            const session = sshService.sessions.get(sshSessionId);
            if (session && session.connection) {
              const host = session.connection.host;
              
              // 2. 增强监控服务状态检查逻辑
              if (monitoringService) {
                // 首先检查monitoringService全局状态
                const isGloballyConnected = monitoringService.state && 
                                          monitoringService.state.connected && 
                                          monitoringService.state.targetHost === host;
                
                // 然后检查特定终端的监控状态
                const isTerminalSpecificMonitored = monitoringService.isTerminalMonitored(currentId);
                
                // 综合两种检查结果，只要有一个为true就认为监控已安装
                const monitored = isGloballyConnected || isTerminalSpecificMonitored;
                
                // 3. 明确设置此终端的监控状态（不依赖单一来源）
                terminalState.monitoringInstalled = monitored;
                monitoringServiceInstalled.value = monitored;
                
                log.debug(`已设置终端[${currentId}]的监控状态: ${monitored}, 连接到主机: ${host}, 全局状态=${isGloballyConnected}, 终端特定状态=${isTerminalSpecificMonitored}`);
                
                // 4. 如果监控服务连接到其他主机，确保不影响当前终端
                if (monitoringService.state && 
                    monitoringService.state.connected && 
                    monitoringService.state.targetHost !== host) {
                  log.debug(`监控服务连接到了不同的主机[${monitoringService.state.targetHost}]，` +
                             `与当前终端[${currentId}]的主机[${host}]不匹配，标记为未连接`);
                  monitoringServiceInstalled.value = false;
                }
              }
            }
          }
        }
      } catch (error) {
        log.error('终端状态隔离出错:', error);
      }
    };
    
    // 在组件卸载时清理所有防抖定时器
    onUnmounted(() => {
      // 移除所有事件监听器，使用常量替代硬编码字符串
      window.removeEventListener(LATENCY_EVENTS.TOOLBAR, handleNetworkLatencyUpdate);
      window.removeEventListener('ssh-connected', handleSshConnected);
      window.removeEventListener('monitoring-status-change', handleMonitoringStatusChange);
      window.removeEventListener('terminal:toolbar-reset', handleToolbarReset);
      window.removeEventListener('terminal:toolbar-sync', handleToolbarSync);
      window.removeEventListener('terminal:refresh-status', handleTerminalRefreshStatus);
      window.removeEventListener('monitoring-connected', handleMonitoringConnected);
      window.removeEventListener('resize', updateSftpTooltipPosition);
      window.removeEventListener('resize', handleResize);
      
      // 移除新会话事件监听
      window.removeEventListener('terminal:new-session', handleNewSession);
      
      // 清理所有防抖定时器
      Object.keys(statusCheckDebounceTimers.value).forEach(id => {
        clearTimeout(statusCheckDebounceTimers.value[id]);
      });
    });

    // 在onMounted中添加事件监听
    onMounted(() => {
      // 添加全局事件监听器，使用常量替代硬编码字符串
      window.addEventListener(LATENCY_EVENTS.TOOLBAR, handleNetworkLatencyUpdate);
      window.addEventListener('ssh-connected', handleSshConnected);
      window.addEventListener('monitoring-status-change', handleMonitoringStatusChange);
      window.addEventListener('terminal:toolbar-reset', handleToolbarReset);
      window.addEventListener('terminal:toolbar-sync', handleToolbarSync);
      // 添加终端状态刷新事件监听
      window.addEventListener('terminal:refresh-status', handleTerminalRefreshStatus);
      // 添加监控连接成功事件监听
      window.addEventListener('monitoring-connected', handleMonitoringConnected);
      
      // 立即检查SSH连接状态
      checkSshConnectionStatus();
      // 立即检查监控服务状态
      checkMonitoringServiceStatus();
      
      // 确保工具栏状态严格隔离，避免状态意外共享
      applyInitialStatus();
      
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
      
      // 获取当前终端特定的工具栏状态
      const terminalState = getTerminalToolbarState(props.activeSessionId);
      
      // 如果有缓存数据则同步显示
      if (terminalState) {
        // 同步SSH连接状态
        if (terminalState.isSshConnected !== undefined) {
          isSshConnected.value = terminalState.isSshConnected;
        }
        
        // 同步监控服务状态
        if (terminalState.monitoringInstalled !== undefined) {
          monitoringServiceInstalled.value = terminalState.monitoringInstalled;
        }
        
        // 同步网络数据
        if (terminalState.rttValue && terminalState.rttValue !== '--') {
          rttValue.value = terminalState.rttValue;
          showNetworkIcon.value = true;
        }
        
        if (terminalState.clientDelay > 0 || terminalState.serverDelay > 0) {
          clientDelay.value = terminalState.clientDelay;
          serverDelay.value = terminalState.serverDelay;
          showNetworkIcon.value = true;
        }
      }
      
      // 工具栏初始化完成后触发同步事件
      window.dispatchEvent(new CustomEvent('terminal:toolbar-initialized', {
        detail: { sessionId: props.activeSessionId }
      }));
      
      // 添加新会话事件监听
      window.addEventListener('terminal:new-session', handleNewSession);
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
      networkPopupStyle,
      handleMonitoringClick,
      // 用户状态
      isLoggedIn
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
  /* 固定高度以确保所有终端工具栏一致 */
  height: 40px;
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