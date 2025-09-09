<template>
  <div class="terminal-toolbar-container">
    <div class="terminal-tools" :class="{ 'transparent-bg': hasBackground }">
      <div class="terminal-tools__left">
        <div class="icon-button" @click="handleSftpClick"
               :class="{ 'icon-available': isSshConnected }" ref="sftpButtonRef">
          <ToolbarIcon name="file-manager"
                       :class="{ 'icon-active': isSshConnected }" />
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
              <ToolbarIcon name="network" class="icon-active" />
            </div>
            <div class="network-stats">
              <div class="network-stats-value" :class="rttStatusClass">{{ rttValue }}</div>
              <div class="network-stats-label">RTT</div>
            </div>
          </div>
        </transition>
        
        <div class="icon-button"
          @click.stop="handleMonitoringClick()"
          :class="{ 'icon-available': monitoringServiceInstalled }"
          ref="monitorButtonRef">
          <ToolbarIcon name="monitoring"
                       :class="{ 'icon-active': monitoringServiceInstalled }" />
        </div>
        
        <div class="icon-button"
          @click.stop="handleAiClick()"
          :class="{ 'icon-available': isAiServiceEnabled }"
          ref="aiButtonRef">
          <ToolbarIcon name="ai"
                       :class="{ 'icon-active': showAiInput }" />
        </div>

        <!-- 工具栏监控显示已移除，监控数据现在通过专用的监控面板显示 -->


        
        <!-- 使用teleport将监控工具提示内容传送到body中 -->
        <teleport to="body">
          <!-- 未登录状态提示 -->
          <div v-if="!isLoggedIn && showMonitorTooltip"
               class="sftp-tooltip" :style="monitorTooltipStyle"
               @mouseenter="onMonitorTooltipMouseEnter" @mouseleave="onMonitorTooltipMouseLeave">
            登录后启用
          </div>

          <!-- 已登录且已安装监控服务提示 -->
          <div v-else-if="isLoggedIn && monitoringServiceInstalled && showMonitorTooltip"
               class="sftp-tooltip" :style="monitorTooltipStyle"
               @mouseenter="onMonitorTooltipMouseEnter" @mouseleave="onMonitorTooltipMouseLeave">
            查看系统监控
          </div>

          <!-- 已登录但监控服务未连接提示 - SSH集成版 -->
          <div v-else-if="isLoggedIn && !monitoringServiceInstalled && showMonitorTooltip"
               class="sftp-tooltip" :style="monitorTooltipStyle"
               @mouseenter="onMonitorTooltipMouseEnter" @mouseleave="onMonitorTooltipMouseLeave">
            {{ isSshConnected ? '监控服务初始化中，请稍候...' : '需要SSH连接以启用监控' }}
          </div>
        </teleport>
        
        <!-- AI助手tooltip -->
        <teleport to="body">
          <div v-if="showAiTooltip" class="sftp-tooltip" :style="aiTooltipStyle"
               @mouseenter="onAiTooltipMouseEnter" @mouseleave="onAiTooltipMouseLeave">
            {{ getAiTooltipText() }}
          </div>
        </teleport>
      </div>
    </div>
    
    <!-- 网络状态弹窗 -->
    <teleport to="body">
      <div
        v-if="showNetworkPopup"
        class="network-popup"
        :style="networkPopupStyle"
        v-click-outside="handleClickOutside"
        @keydown.esc="handleEscapeKey"
        tabindex="-1"
      >
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
import { defineComponent, computed, ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useSessionStore } from '../../store/session'
import { useUserStore } from '../../store/user'
import sshService from '../../services/ssh/index'
import monitoringService from '../../services/monitoring'
import { ElMessage } from 'element-plus'
import { useTerminalStore } from '../../store/terminal'
import { LATENCY_EVENTS } from '../../services/constants'
import log from '../../services/log'
import aiService from '../../services/ai/ai-service.js'

// ToolbarMonitoring 组件已移除，监控数据现在通过专用的监控面板显示

import ToolbarIcon from '../common/ToolbarIcon.vue'

export default defineComponent({
  name: 'TerminalToolbar',
  components: {
    ToolbarIcon
  },
  emits: ['toggle-sftp-panel', 'toggle-monitoring-panel', 'toggle-ai-input'],
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
    // 生成组件实例唯一标识，用于调试和去重
    const componentInstanceId = `toolbar_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    // 全局组件实例追踪器
    if (!window.terminalToolbarInstances) {
      window.terminalToolbarInstances = new Map()
    }

    // 注册当前实例
    window.terminalToolbarInstances.set(componentInstanceId, {
      activeSessionId: props.activeSessionId,
      createdAt: new Date().toISOString()
    })

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
    const showAiInput = ref(true) // 默认显示AI输入框
    const isAiServiceEnabled = ref(false) // AI服务是否启用
    const aiButtonRef = ref(null)
    const showAiTooltip = ref(false)
    const aiTooltipHover = ref(false)
    const aiTooltipStyle = ref({
      position: 'fixed',
      zIndex: 10000,
      top: '0px',
      left: '0px',
      display: 'none'
    })





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
    
    // 获取当前活动终端的工具栏状态（备用）
    // const activeTerminalState = computed(() => {
    //   return getTerminalToolbarState(props.activeSessionId) || {}
    // })

    // 获取当前终端ID（用于监控组件）
    const terminalId = computed(() => {
      return props.activeSessionId
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
    
    // 统一的关闭网络弹窗函数
    const closeNetworkPopup = () => {
      if (showNetworkPopup.value) {
        showNetworkPopup.value = false;
        // 关闭弹窗后，确保终端保持焦点
        focusActiveTerminal();
        // log.debug('网络弹窗已关闭，终端焦点已恢复');
      }
    }

    // 切换网络弹窗显示状态
    const toggleNetworkPopup = (event) => {
      // 阻止事件冒泡，避免触发全局点击处理器
      if (event) {
        event.stopPropagation();
      }

      if (showNetworkPopup.value) {
        // 弹窗已打开，关闭它
        closeNetworkPopup();
      } else {
        // 弹窗未打开，打开它
        showNetworkPopup.value = true;
        updateNetworkPopupPosition();
        focusActiveTerminal();
        // log.debug('网络弹窗已打开，终端焦点已设置');
      }
    }

    // 处理点击外部关闭弹窗
    const handleClickOutside = () => {
      closeNetworkPopup();
    }

    // 处理ESC键关闭弹窗
    const handleEscapeKey = () => {
      closeNetworkPopup();
    }

    // 聚焦当前活动终端
    const focusActiveTerminal = () => {
      const activeTerminalId = props.activeSessionId;
      if (activeTerminalId && terminalStore.hasTerminal(activeTerminalId)) {
        try {
          // 使用nextTick确保DOM更新完成后再聚焦
          nextTick(() => {
            terminalStore.focusTerminal(activeTerminalId);
            // log.debug(`网络弹窗操作后聚焦终端: ${activeTerminalId}`);
          });
        } catch (error) {
          log.warn(`聚焦终端失败: ${error.message}`);
        }
      }
    }
    
    // 计算并更新网络弹窗的位置
    const updateNetworkPopupPosition = () => {
      if (!networkIconRef.value) return;
      
      const rect = networkIconRef.value.getBoundingClientRect();
      networkPopupStyle.value = {
        position: 'fixed',
        zIndex: 10000,
        backgroundColor: 'var(--color-bg-container)',
        borderRadius: '4px',
        boxShadow: 'var(--shadow-lg)',
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
      // 获取CSS变量值
      const tooltipOffset = getComputedStyle(document.documentElement).getPropertyValue('--tooltip-offset').trim() || '10px'

      sftpTooltipStyle.value = {
        position: 'fixed',
        zIndex: 10000,
        backgroundColor: 'var(--tooltip-bg)',
        color: 'var(--tooltip-color)',
        padding: 'var(--tooltip-padding-vertical) var(--tooltip-padding-horizontal)',
        borderRadius: 'var(--tooltip-border-radius)',
        fontFamily: 'var(--tooltip-font-family)',
        fontSize: 'var(--tooltip-font-size)',
        fontWeight: 'var(--tooltip-font-weight)',
        lineHeight: 'var(--tooltip-line-height)',
        whiteSpace: 'nowrap',
        maxWidth: 'var(--tooltip-max-width)',
        boxShadow: 'var(--tooltip-shadow)',
        transition: 'var(--tooltip-transition)',
        top: `${rect.bottom + parseInt(tooltipOffset)}px`,
        left: `${rect.left + rect.width / 2}px`,
        transform: 'translateX(-50%)'
      }
    }
    
    // 切换AI输入框显示状态
    const handleAiClick = () => {
      showAiInput.value = !showAiInput.value
      emit('toggle-ai-input', showAiInput.value)
    }
    
    // 获取AI助手tooltip文本
    const getAiTooltipText = () => {
      if (!isAiServiceEnabled.value) {
        return '未启用AI助手'
      }
      return 'AI助手'
    }
    
    // 切换监控面板
    const toggleMonitoringPanel = () => {
      // 监控服务基于SSH连接，无需安装
      emit('toggle-monitoring-panel');
    }



    
    // 检查监控服务状态 - SSH集成版
    const checkMonitoringServiceStatus = () => {
      // 如果用户未登录，直接跳过状态检查
      if (!isLoggedIn.value) {
        monitoringServiceInstalled.value = false;
        return;
      }

      const currentTerminalId = props.activeSessionId;
      if (!currentTerminalId) {
        monitoringServiceInstalled.value = false;
        return;
      }

      // 基于SSH连接状态判断监控服务可用性
      if (isSshConnected.value) {
        try {
          // 检查监控服务连接状态
          const status = monitoringService.getStatus(currentTerminalId);
          const isConnected = status && status.connected;

          monitoringServiceInstalled.value = isConnected;

          log.debug(`SSH监控服务状态: ${currentTerminalId} -> ${isConnected}`);
        } catch (error) {
          log.warn('检查SSH监控服务状态失败:', error);
          // SSH连接存在但监控服务未连接，可能正在初始化
          monitoringServiceInstalled.value = false;
        }
      } else {
        // SSH未连接，监控服务不可用
        monitoringServiceInstalled.value = false;
      }
    };
    
    // 处理网络延迟更新，按会话/终端ID隔离
    const handleNetworkLatencyUpdate = (event) => {
      // 确保事件数据有效
      if (!event || !event.detail) {
        return;
      }

      const {
        sessionId,
        remoteLatency,
        localLatency,
        totalLatency,
        clientLatency,
        serverLatency,
        terminalId: eventTerminalId
      } = event.detail;
      

      // 验证延迟数据的有效性
      const hasValidLatencyData = (
        (totalLatency && totalLatency > 0) ||
        (clientLatency && clientLatency > 0) ||
        (serverLatency && serverLatency > 0) ||
        (localLatency && localLatency > 0) ||
        (remoteLatency && remoteLatency > 0)
      );

      if (!sessionId || !hasValidLatencyData) {
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
          // 使用真实延迟数据，四舍五入到整数
          terminalState.clientDelay = clientLatency ? Math.round(clientLatency) : 
                                      (localLatency ? Math.round(localLatency) : undefined);
          terminalState.serverDelay = serverLatency ? Math.round(serverLatency) : 
                                      (remoteLatency ? Math.round(remoteLatency) : undefined);
          terminalState.rttValue = totalLatency ? `${Math.round(totalLatency)} ms` : '--';
          terminalState.isSshConnected = true;
          

          // 如果是当前活动终端，直接更新界面状态
          if (terminalId === props.activeSessionId) {
            clientDelay.value = terminalState.clientDelay;
            serverDelay.value = terminalState.serverDelay;
            rttValue.value = terminalState.rttValue;
            
            // 只有在有真实延迟数据时才显示网络图标
            if (terminalState.clientDelay > 0 || terminalState.serverDelay > 0) {
              showNetworkIcon.value = true;
            } else {
              showNetworkIcon.value = false;
            }
          }
        } else {
          log.warn('无法获取终端状态', { terminalId });
        }
      } else {
        log.warn('无法解析终端ID', { sessionId, eventTerminalId });
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

      // 优化：只在有意义的切换时记录日志（避免undefined -> undefined等无效切换）
      if (oldId && newId && oldId !== newId) {
        log.debug(`终端切换: ${oldId} -> ${newId}`);
      }
      
      // 标签页切换时立即应用新终端的状态，不需要延迟
      if (newId) {
        // 获取或创建该终端的状态
        const terminalState = getTerminalToolbarState(newId);

        // 首先清除当前UI状态
        rttValue.value = '--';
        serverDelay.value = 0;
        clientDelay.value = 0;
        showNetworkIcon.value = false; // 默认不显示网络图标，根据下面的条件决定是否显示

        // 监控数据监听器已移除，现在使用ResponsiveMonitoringPanel
        
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
        
        // 在切换终端标签页时，根据该终端的实际延迟数据决定是否显示网络图标
        if (terminalState && 
            typeof terminalState.serverDelay === 'number' &&
            typeof terminalState.clientDelay === 'number' &&
            (terminalState.serverDelay > 0 || terminalState.clientDelay > 0)) {
          showNetworkIcon.value = true;
          rttValue.value = terminalState.rttValue || '--';
          serverDelay.value = terminalState.serverDelay || 0;
          clientDelay.value = terminalState.clientDelay || 0;
          
          log.debug('切换终端时恢复网络图标显示', {
            terminalId: newId,
            clientDelay: terminalState.clientDelay,
            serverDelay: terminalState.serverDelay,
            rttValue: terminalState.rttValue
          });
        } else {
          // 该终端没有有效的延迟数据，保持图标隐藏
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
    watch(() => monitoringService.state, (newState, oldState) => {
      if (!newState) return;

      // 当监控服务状态变化时，重新应用当前终端的状态
      const currentId = props.activeSessionId;
      if (currentId) {
        // 只在连接状态真正发生变化时记录日志
        if (!oldState || newState.connected !== oldState.connected) {
          log.debug(`监控服务状态变化: ${oldState?.connected ? '已连接' : '未连接'} → ${newState.connected ? '已连接' : '未连接'}`);
        }
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

      const { installed, terminalId, hostname, status, message } = event.detail;

      if (terminalId) {
        // 处理特定终端的状态更新
        const terminalState = getTerminalToolbarState(terminalId);

        if (terminalState) {
          // 更新终端状态
          terminalState.monitoringInstalled = installed;
          // 保存状态详情，用于提供更好的用户反馈
          terminalState.monitoringStatus = status;
          terminalState.monitoringMessage = message;

          // 如果是当前活动的终端，更新UI状态
          if (terminalId === props.activeSessionId) {
            // 只在状态真正发生变化时记录日志
            const previousState = monitoringServiceInstalled.value;
            monitoringServiceInstalled.value = installed;

            if (previousState !== installed) {
              log.debug(`[${componentInstanceId}] 监控状态变更: 终端=${terminalId}, ${previousState ? '已安装' : '未安装'} → ${installed ? '已安装' : '未安装'}`);

              // 只在安装成功时记录INFO级别日志
              if (installed) {
                log.info(`[${componentInstanceId}] 监控服务已安装: ${message || '监控数据可用'}`);
              }
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

            // 如果是当前活动终端，更新UI和记录日志
            if (terminalId === props.activeSessionId) {
              monitoringServiceInstalled.value = installed;
              log.debug(`[${componentInstanceId}] 通过会话ID[${sessionId}]更新终端[${terminalId}]的监控状态: ${installed}`);
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
              // 更新终端状态和记录日志
              const terminalState = getTerminalToolbarState(props.activeSessionId);
              if (terminalState) {
                terminalState.monitoringInstalled = installed;
                monitoringServiceInstalled.value = installed;
                log.debug(`[${componentInstanceId}] 通过主机地址[${hostAddress}]匹配更新当前终端的监控状态: ${installed}`);
              }
            }
          }
        }
      } else {
        // 全局状态更新（向后兼容）- 减少重复日志
        if (props.activeSessionId) {
          const previousState = monitoringServiceInstalled.value;
          monitoringServiceInstalled.value = installed;

          // 只在状态变化时记录日志
          if (previousState !== installed) {
            log.debug(`[${componentInstanceId}] 全局监控状态变更: ${previousState ? '已安装' : '未安装'} → ${installed ? '已安装' : '未安装'}`);
          }
        }
      }
    };
    
    // 移除监控连接成功事件处理
    // WebSocket连接成功不等于监控服务已安装
    // 监控状态应该完全基于 monitoring-status-change 事件
    
    // 处理AI服务状态变化事件
    const handleAiServiceStatusChange = (event) => {
      if (!event || !event.detail) {
        return;
      }
      
      const { status, isEnabled } = event.detail;
      isAiServiceEnabled.value = isEnabled;
      
      log.debug(`[${componentInstanceId}] AI服务状态变更: ${status}, enabled: ${isEnabled}`);
    };
    
    // 检查AI服务状态
    const checkAiServiceStatus = () => {
      try {
        isAiServiceEnabled.value = aiService.isEnabled || false;
        log.debug(`[${componentInstanceId}] AI服务状态检查: ${isAiServiceEnabled.value}`);
      } catch (error) {
        log.warn('检查AI服务状态失败:', error);
        isAiServiceEnabled.value = false;
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
      // 获取CSS变量值
      const tooltipOffset = getComputedStyle(document.documentElement).getPropertyValue('--tooltip-offset').trim() || '10px'

      monitorTooltipStyle.value = {
        position: 'fixed',
        zIndex: 10000,
        backgroundColor: 'var(--tooltip-bg)',
        color: 'var(--tooltip-color)',
        padding: 'var(--tooltip-padding-vertical) var(--tooltip-padding-horizontal)',
        borderRadius: 'var(--tooltip-border-radius)',
        fontFamily: 'var(--tooltip-font-family)',
        fontSize: 'var(--tooltip-font-size)',
        fontWeight: 'var(--tooltip-font-weight)',
        lineHeight: 'var(--tooltip-line-height)',
        whiteSpace: 'nowrap',
        maxWidth: 'var(--tooltip-max-width)',
        boxShadow: 'var(--tooltip-shadow)',
        transition: 'var(--tooltip-transition)',
        top: `${rect.bottom + parseInt(tooltipOffset)}px`,
        left: `${rect.left + rect.width / 2}px`,
        transform: 'translateX(-50%)'
      }
    }
    
    // 计算并更新AI tooltip的位置
    const updateAiTooltipPosition = () => {
      if (!aiButtonRef.value) return

      const rect = aiButtonRef.value.getBoundingClientRect()
      const tooltipOffset = getComputedStyle(document.documentElement).getPropertyValue('--tooltip-offset').trim() || '10px'

      aiTooltipStyle.value = {
        position: 'fixed',
        zIndex: 10000,
        backgroundColor: 'var(--tooltip-bg)',
        color: 'var(--tooltip-color)',
        padding: 'var(--tooltip-padding-vertical) var(--tooltip-padding-horizontal)',
        borderRadius: 'var(--tooltip-border-radius)',
        fontFamily: 'var(--tooltip-font-family)',
        fontSize: 'var(--tooltip-font-size)',
        fontWeight: 'var(--tooltip-font-weight)',
        lineHeight: 'var(--tooltip-line-height)',
        whiteSpace: 'nowrap',
        maxWidth: 'var(--tooltip-max-width)',
        boxShadow: 'var(--tooltip-shadow)',
        transition: 'var(--tooltip-transition)',
        top: `${rect.bottom + parseInt(tooltipOffset)}px`,
        left: `${rect.left + rect.width / 2}px`,
        transform: 'translateX(-50%)'
      }
    }
    
    // AI tooltip鼠标事件处理
    const onAiTooltipMouseEnter = () => {
      aiTooltipHover.value = true
    }
    
    const onAiTooltipMouseLeave = () => {
      aiTooltipHover.value = false
      showAiTooltip.value = false
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
      
      // 同时更新AI提示位置
      if (showAiTooltip.value) {
        updateAiTooltipPosition();
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
      
      // 检查网络状态 - 只有在有有效的延迟数据时才显示网络图标
      if (terminalState && 
          typeof terminalState.serverDelay === 'number' &&
          typeof terminalState.clientDelay === 'number' &&
          (terminalState.serverDelay > 0 || terminalState.clientDelay > 0)) {
        // 使用终端状态中的延迟数据
        showNetworkIcon.value = true;
        rttValue.value = terminalState.rttValue || '--';
        serverDelay.value = terminalState.serverDelay;
        clientDelay.value = terminalState.clientDelay;
        
        log.debug('恢复显示网络图标，基于缓存的延迟数据', {
          clientDelay: terminalState.clientDelay,
          serverDelay: terminalState.serverDelay,
          rttValue: terminalState.rttValue
        });
      } else {
        // 如果终端状态中没有有效的延迟数据，不显示网络图标
        showNetworkIcon.value = false;
        rttValue.value = '--';
        serverDelay.value = 0;
        clientDelay.value = 0;
        
        log.debug('隐藏网络图标，无有效延迟数据');
      }
    };
    
    // 处理工具栏状态重置的函数
    const handleToolbarReset = (event) => {
      if (!event.detail || !event.detail.sessionId) return;

      const { sessionId } = event.detail;

      // 只有当当前活动会话是目标会话时才处理和记录日志
      if (sessionId === props.activeSessionId) {
        log.debug(`[${componentInstanceId}] 收到工具栏重置事件: sessionId=${sessionId}`);

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
      if (!event.detail) {
        log.warn(`[${componentInstanceId}] SSH连接成功事件缺少detail信息`);
        return;
      }

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

      // 关键优化：只有当事件的终端ID与当前组件实例的活动终端ID匹配时才处理
      const isRelevantToThisInstance = terminalId === props.activeSessionId ||
                                       (!terminalId && sessionId === sessionStore.getActiveSession());

      if (!isRelevantToThisInstance) {
        // SSH连接成功事件与当前实例无关，跳过处理
        return;
      }

      // 检查是否已经处理过该SSH会话
      if (processedSshSessions.value.has(sessionId)) {
        log.debug(`[${componentInstanceId}] SSH会话 ${sessionId} 的连接成功事件已处理，跳过重复处理`);
        return;
      }

      // 添加到已处理集合
      processedSshSessions.value.add(sessionId);

      // 处理SSH连接成功事件

      if (sessionId) {
        // 保存会话连接状态
        updateConnectionStatus(sessionId, true);

        // 更新对应终端的状态
        if (terminalId) {
          // 如果没有该终端的状态，先创建
          const terminalState = getTerminalToolbarState(terminalId);
          if (terminalState) {
            terminalState.isSshConnected = true;
            // 已更新终端SSH连接状态

            // 只有是当前活动终端时才更新UI
            if (terminalId === props.activeSessionId) {
              isSshConnected.value = true;
              
              // SSH连接成功后，先不显示网络图标，等待延迟测量结果
              // 移除强制显示延迟图标的逻辑，改为基于实际数据显示
              log.debug('SSH连接成功，等待延迟测量结果...');
            }
          }
        }

        // 额外检查：如果当前没有活动终端但会话ID与当前活动会话匹配，也更新UI
        // 这是为了处理新建连接的情况
        if (!terminalId && sessionId === sessionStore.getActiveSession()) {
          isSshConnected.value = true;
          log.debug(`[${componentInstanceId}] 通过会话存储匹配更新UI状态`);
        }

        // 在SSH连接成功时，立即检查监控状态
        checkMonitoringServiceStatus();
      }
    };
    
    // 处理工具栏状态同步事件的函数 - 不会触发加载动画
    const handleToolbarSync = (event) => {
      if (!event.detail || !event.detail.sessionId) return;

      const { sessionId } = event.detail;

      // 只有当当前活动会话是目标会话时才处理和记录日志
      if (sessionId === props.activeSessionId) {
        log.debug(`[${componentInstanceId}] 收到工具栏同步事件: sessionId=${sessionId}`);

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
        
        // 同步网络信息 - 只在有有效延迟数据时显示图标
        if (terminalState && 
            typeof terminalState.serverDelay === 'number' && 
            typeof terminalState.clientDelay === 'number' &&
            (terminalState.serverDelay > 0 || terminalState.clientDelay > 0)) {
          showNetworkIcon.value = true;
          rttValue.value = terminalState.rttValue || '--';
          serverDelay.value = terminalState.serverDelay || 0;
          clientDelay.value = terminalState.clientDelay || 0;
          
          log.debug('同步显示网络图标，基于有效延迟数据', {
            clientDelay: terminalState.clientDelay,
            serverDelay: terminalState.serverDelay,
            rttValue: terminalState.rttValue
          });
        } else {
          // 没有有效的延迟数据，不显示网络图标
          showNetworkIcon.value = false;
          rttValue.value = '--';
          clientDelay.value = 0;
          serverDelay.value = 0;
          
          log.debug('同步隐藏网络图标，无有效延迟数据');
        }
        
        // 确保状态完全隔离
        nextTick(() => {
          applyInitialStatus();
        });
      }
    };
    
    // 移除重复的事件处理函数 - 工具栏状态由其他机制统一管理
    // const handleTerminalRefreshStatus = (event) => { ... }
    
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

      // 只有当是新创建且是当前活动会话时才处理和记录日志
      if (isNewCreation && sessionId === props.activeSessionId) {
        log.debug(`[${componentInstanceId}] 工具栏收到新会话事件: ${sessionId}, 是否新创建: ${isNewCreation}`);

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





    // 处理监控图标点击的函数 - SSH集成版
    const handleMonitoringClick = () => {
      // 如果用户未登录，显示登录提示
      if (!isLoggedIn.value) {
        ElMessage.info('请先登录以使用监控功能');
        return;
      }

      // 检查SSH连接状态
      if (!isSshConnected.value) {
        ElMessage.info('请先建立SSH连接以启用监控功能');
        return;
      }

      // 触发监控面板切换事件，由父组件处理
      emit('toggle-monitoring-panel');
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
        
        // 降低日志频率 - 只在状态实际发生变化时输出
        // log.debug(`[工具栏] 确保终端状态独立: ${currentId}`);
        
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
                let isTerminalSpecificMonitored = false;
                if (typeof monitoringService.isTerminalMonitored === 'function') {
                  try {
                    isTerminalSpecificMonitored = monitoringService.isTerminalMonitored(currentId);
                  } catch (error) {
                    log.debug('调用 isTerminalMonitored 方法失败:', error);
                    isTerminalSpecificMonitored = false;
                  }
                }
                
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
      // TerminalToolbar组件正在卸载

      // 从全局追踪器中移除当前实例
      if (window.terminalToolbarInstances) {
        window.terminalToolbarInstances.delete(componentInstanceId)
        const remainingCount = window.terminalToolbarInstances.size
        log.debug(`[${componentInstanceId}] 已从全局追踪器移除，剩余 ${remainingCount} 个实例`)
      }

      // 移除所有事件监听器，使用常量替代硬编码字符串
      window.removeEventListener(LATENCY_EVENTS.TOOLBAR, handleNetworkLatencyUpdate);
      window.removeEventListener('ssh-connected', handleSshConnected);
      window.removeEventListener('monitoring-status-change', handleMonitoringStatusChange);
      window.removeEventListener('ai-service-status-change', handleAiServiceStatusChange);
      window.removeEventListener('terminal:toolbar-reset', handleToolbarReset);
      window.removeEventListener('terminal:toolbar-sync', handleToolbarSync);
      // window.removeEventListener('terminal:refresh-status', handleTerminalRefreshStatus);
      // 移除监控连接成功事件监听器（已废弃）
      window.removeEventListener('resize', updateSftpTooltipPosition);
      window.removeEventListener('resize', handleResize);

      // 移除新会话事件监听
      window.removeEventListener('terminal:new-session', handleNewSession);

      // 监控数据事件监听器已移除，现在使用统一的监控状态管理器

      log.debug(`[${componentInstanceId}] 已移除SSH连接成功事件监听器`);

      // 清理所有防抖定时器
      Object.keys(statusCheckDebounceTimers.value).forEach(id => {
        clearTimeout(statusCheckDebounceTimers.value[id]);
      });

      // 清理会话变化的定时器
      if (sessionChangeTimeout) {
        clearTimeout(sessionChangeTimeout);
        sessionChangeTimeout = null;
      }

      // TerminalToolbar组件卸载完成
    });

    // 在onMounted中添加事件监听
    onMounted(() => {
      const instanceCount = window.terminalToolbarInstances.size
      const allInstances = Array.from(window.terminalToolbarInstances.entries()).map(([id, info]) =>
        `${id.split('_')[1]}(${info.activeSessionId})`
      ).join(', ')

      // TerminalToolbar组件已挂载

      // 添加全局事件监听器，使用常量替代硬编码字符串
      window.addEventListener(LATENCY_EVENTS.TOOLBAR, handleNetworkLatencyUpdate);
      window.addEventListener('ssh-connected', handleSshConnected);
      window.addEventListener('monitoring-status-change', handleMonitoringStatusChange);
      window.addEventListener('ai-service-status-change', handleAiServiceStatusChange);
      window.addEventListener('terminal:toolbar-reset', handleToolbarReset);
      window.addEventListener('terminal:toolbar-sync', handleToolbarSync);

      // 立即开始监听监控数据，实现预加载
      // 监控数据监听器已移除，现在使用ResponsiveMonitoringPanel

      // 移除重复的事件监听器 - 工具栏状态由 terminal-status-update 事件统一管理
      // window.addEventListener('terminal:refresh-status', handleTerminalRefreshStatus);
      // 移除监控连接成功事件监听（已废弃）
      // WebSocket连接成功不等于监控服务已安装

      // 已注册SSH连接成功事件监听器

      // 立即检查SSH连接状态
      checkSshConnectionStatus();
      // 立即检查监控服务状态
      checkMonitoringServiceStatus();
      // 立即检查AI服务状态
      checkAiServiceStatus();

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
      
      // AI按钮鼠标悬停事件
      if (aiButtonRef.value) {
        aiButtonRef.value.addEventListener('mouseenter', () => {
          updateAiTooltipPosition();
          showAiTooltip.value = true;
        });
        
        aiButtonRef.value.addEventListener('mouseleave', () => {
          setTimeout(() => {
            if (!aiTooltipHover.value) {
              showAiTooltip.value = false;
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
        
        // 同步网络数据 - 只在有有效延迟数据时显示
        if (terminalState.rttValue && terminalState.rttValue !== '--' &&
            (terminalState.clientDelay > 0 || terminalState.serverDelay > 0)) {
          rttValue.value = terminalState.rttValue;
          clientDelay.value = terminalState.clientDelay;
          serverDelay.value = terminalState.serverDelay;
          showNetworkIcon.value = true;
          
        } else {
          // 没有有效的延迟数据，保持图标隐藏
          showNetworkIcon.value = false;
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
      closeNetworkPopup,
      handleClickOutside,
      handleEscapeKey,
      toggleSftpPanel,
      toggleMonitoringPanel,
      showNetworkIcon,
      monitoringServiceInstalled,
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
      // AI相关
      showAiInput,
      handleAiClick,
      getAiTooltipText,
      isAiServiceEnabled,
      aiButtonRef,
      showAiTooltip,
      aiTooltipStyle,
      onAiTooltipMouseEnter,
      onAiTooltipMouseLeave,
      // 用户状态
      isLoggedIn,
      // 终端ID（用于监控组件）
      terminalId
    }
  }
})
</script>

<style scoped>
/* ===== 终端工具栏样式 - 使用系统设计令牌 ===== */

/* 工具栏容器 */
.terminal-toolbar-container {
  position: relative;
  width: 100%;
  z-index: 3;
  background-color: transparent;
  height: var(--layout-toolbar-height); /* 使用终端工具栏专用高度令牌 */
}

/* 工具栏主体 */
.terminal-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--spacing-md); /* 使用系统间距令牌 */
  height: var(--layout-toolbar-height); /* 使用终端工具栏专用高度令牌 */
  background-color: var(--color-bg-elevated);
  position: relative;
  /* 添加主题过渡效果 */
  transition:
    background-color var(--theme-transition-duration) var(--theme-transition-timing),
    border-color var(--theme-transition-duration) var(--theme-transition-timing);
}

/* 透明背景样式（有背景图时） */
.terminal-tools.transparent-bg {
  background-color: transparent;
}

/* 透明背景的半透明覆盖层 */
.terminal-tools.transparent-bg::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--color-bg-overlay);
  backdrop-filter: blur(2px);
  z-index: -1;
  opacity: 0.5;
  transition: opacity var(--theme-transition-duration) var(--theme-transition-timing);
}

/* 工具栏左侧区域 */
.terminal-tools__left {
  display: flex;
  gap: var(--spacing-sm); /* 使用系统间距令牌 */
  align-items: center;
}

/* 图标按钮基础样式 */
.icon-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background-color: transparent;
  border: none;
  border-radius: var(--radius-md); /* 使用系统圆角令牌 */
  cursor: pointer;
  color: var(--color-text-primary);
  padding: 0;
  /* 使用系统过渡令牌 */
  transition:
    background-color var(--theme-transition-duration) var(--theme-transition-timing),
    color var(--theme-transition-duration) var(--theme-transition-timing),
    transform var(--transition-fast);
}

/* 图标按钮禁用状态 */
.icon-button.icon-disabled {
  cursor: not-allowed !important;
  color: var(--color-text-disabled); /* 使用系统禁用状态令牌 */
  opacity: 0.5;
}

/* ===== 网络监控组件 ===== */

/* 网络监控容器 */
.network-monitor {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs); /* 使用系统间距令牌 */
  cursor: pointer;
  padding: var(--spacing-xs) var(--spacing-xs); /* 使用系统间距令牌 */
  border-radius: var(--radius-md); /* 使用系统圆角令牌 */
  transition:
    background-color var(--theme-transition-duration) var(--theme-transition-timing),
    transform var(--transition-fast);
}


/* 网络图标 */
.network-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-primary);
  transition: color var(--theme-transition-duration) var(--theme-transition-timing);
}

/* 网络统计数据 */
.network-stats {
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1;
}

/* 网络统计值 */
.network-stats-value {
  font-size: var(--font-size-xs); /* 使用系统字体令牌 */
  font-weight: 500;
  transition: color var(--theme-transition-duration) var(--theme-transition-timing);
}

/* 网络状态颜色 */
.network-path-value.success {
  color: var(--color-success);
}

.network-path-value.warning {
  color: var(--color-warning);
}

.network-path-value.danger {
  color: var(--color-error);
}

/* 网络统计标签 */
.network-stats-label {
  font-size: 10px; /* 保持小字体 */
  color: var(--color-text-secondary);
  text-transform: uppercase;
  line-height: 1;
  margin-top: var(--spacing-xs); /* 使用系统间距令牌 */
  transition: color var(--theme-transition-duration) var(--theme-transition-timing);
}

/* ===== 网络监控弹窗 ===== */

/* 弹窗容器 */
.network-popup {
  background-color: var(--color-bg-container);
  border-radius: var(--radius-lg); /* 使用系统圆角令牌 */
  box-shadow: var(--shadow-lg);
  z-index: var(--z-tooltip); /* 使用系统层级令牌 */
  overflow: hidden;
  border: 1px solid var(--color-border-default);
  /* 添加主题过渡效果 */
  transition:
    background-color var(--theme-transition-duration) var(--theme-transition-timing),
    border-color var(--theme-transition-duration) var(--theme-transition-timing),
    box-shadow var(--theme-transition-duration) var(--theme-transition-timing);
}

/* 弹窗箭头 */
.network-popup:after {
  content: '';
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  border-width: 5px;
  border-style: solid;
  border-color: transparent transparent var(--color-bg-container) transparent;
}

/* 弹窗头部 */
.network-popup-header {
  padding: var(--spacing-sm) var(--spacing-md); /* 使用系统间距令牌 */
  font-size: var(--font-size-sm); /* 使用系统字体令牌 */
  font-weight: 500;
  color: var(--color-text-primary);
  background-color: var(--color-bg-muted);
  border-bottom: 1px solid var(--color-border-default);
  text-align: center;
  transition:
    background-color var(--theme-transition-duration) var(--theme-transition-timing),
    border-color var(--theme-transition-duration) var(--theme-transition-timing),
    color var(--theme-transition-duration) var(--theme-transition-timing);
}

/* 弹窗内容 */
.network-popup-content {
  padding: var(--spacing-md) var(--spacing-md); /* 使用系统间距令牌 */
}

/* 网络节点容器 */
.network-nodes {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* 单个网络节点 */
.network-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

/* 网络节点指示点 */
.network-node-dot {
  width: 10px;
  height: 10px;
  border-radius: var(--radius-full); /* 使用系统圆角令牌 */
  background-color: var(--color-text-secondary);
  margin-bottom: var(--spacing-xs); /* 使用系统间距令牌 */
  transition: background-color var(--theme-transition-duration) var(--theme-transition-timing);
}

/* 网络节点标签 */
.network-node-label {
  font-size: var(--font-size-xs); /* 使用系统字体令牌 */
  color: var(--color-text-secondary);
  white-space: nowrap;
  transition: color var(--theme-transition-duration) var(--theme-transition-timing);
}

/* 网络路径 */
.network-path {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: 0 var(--spacing-xs); /* 使用系统间距令牌 */
  position: relative;
}

/* 网络路径连接线 */
.network-path-line {
  width: 100%;
  height: 1px;
  background-color: var(--color-border-default);
  position: relative;
  top: -10px;
  transition: background-color var(--theme-transition-duration) var(--theme-transition-timing);
}

/* 网络路径数值 */
.network-path-value {
  font-size: var(--font-size-xs); /* 使用系统字体令牌 */
  position: relative;
  top: -6px;
  background-color: var(--color-bg-container);
  padding: 0 var(--spacing-xs); /* 使用系统间距令牌 */
  transition:
    color var(--theme-transition-duration) var(--theme-transition-timing),
    background-color var(--theme-transition-duration) var(--theme-transition-timing);
}

/* 网络统计状态颜色 */
.network-stats-value.success {
  color: var(--color-success);
}

.network-stats-value.warning {
  color: var(--color-warning);
}

.network-stats-value.danger {
  color: var(--color-error);
}

/* ===== 动画效果 ===== */

/* 淡入淡出过渡 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--transition-slow); /* 使用系统过渡令牌 */
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* 测量中状态动画 */
.network-stats-value.measuring {
  color: var(--color-info);
  animation: pulse 1.5s infinite;
}

.network-path-value.measuring {
  color: var(--color-info);
  animation: pulse 1.5s infinite;
}

/* 脉冲动画关键帧 */
@keyframes pulse {
  0% { opacity: 0.6; }
  50% { opacity: 1; }
  100% { opacity: 0.6; }
}

/* ===== 交互元素样式 ===== */

/* 一键安装链接 */
.install-link {
  color: var(--color-info);
  cursor: pointer;
  text-decoration: none;
  font-weight: bold;
  transition: opacity var(--transition-fast); /* 使用系统过渡令牌 */
}

.install-link:hover {
  opacity: 0.8;
}

/* 图标状态样式 */
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

/* ===== 统一的 Tooltip 样式 ===== */

/* Tooltip 容器 - 使用系统设计令牌 */
.sftp-tooltip {
  position: fixed;
  z-index: var(--z-tooltip);
  background-color: var(--tooltip-bg);
  color: var(--tooltip-color);
  padding: var(--tooltip-padding-vertical) var(--tooltip-padding-horizontal);
  border-radius: var(--tooltip-border-radius);
  font-family: var(--tooltip-font-family);
  font-size: var(--tooltip-font-size);
  font-weight: var(--tooltip-font-weight);
  line-height: var(--tooltip-line-height);
  white-space: nowrap;
  max-width: var(--tooltip-max-width);
  box-shadow: var(--tooltip-shadow);
  transition: var(--tooltip-transition);
  pointer-events: auto;
}

.sftp-tooltip:after {
  content: '';
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  border-width: var(--tooltip-arrow-size);
  border-style: solid;
  border-color: transparent transparent var(--tooltip-arrow-color) transparent;
}
</style> 