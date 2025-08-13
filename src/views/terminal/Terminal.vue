<template>
  <div class="terminal-container">
    <!-- 多终端容器 - 每个终端都有自己的容器，通过z-index和opacity控制显示/隐藏 -->
    <div class="terminals-wrapper">
      <!-- 为每个终端创建独立容器 -->
      <div
        v-for="termId in terminalIds"
        :key="termId"
        class="terminal-content-wrapper"
        :class="{
          'terminal-active': isActiveTerminal(termId),
          'terminal-ready': terminalInitialized[termId]
        }"
        :style="getTerminalStyle(termId)"
      >
        <!-- 为每个终端添加独立的加载动画 -->
        <div
          v-show="shouldShowTerminalConnectingAnimation(termId)"
          class="connecting-overlay"
          :class="{'fade-out': !shouldShowTerminalConnectingAnimation(termId)}"
        >
          <RocketLoader
            :phase="getTerminalRocketPhase(termId)"
            @animation-complete="() => handleTerminalAnimationComplete(termId)"
          />
        </div>

        <!-- 为每个终端添加独立的工具栏 -->
        <div class="terminal-individual-toolbar">
          <TerminalToolbar
            :has-background="terminalHasBackground"
            :active-session-id="termId"
            @toggle-sftp-panel="toggleSftpPanel"
            @toggle-monitoring-panel="toggleMonitoringPanel"
          />
        </div>

        <!-- 终端主体区域：监控面板 + 终端内容 + AI输入栏 -->
        <div class="terminal-main-area">
          <!-- 桌面端监控面板 - 左侧 -->
          <div class="terminal-monitoring-panel"
               v-show="shouldShowDesktopMonitoringPanel(termId) && isActiveTerminal(termId)">
            <ResponsiveMonitoringPanel
              :visible="isMonitoringPanelVisible(termId)"
              :monitoring-data="getMonitoringData(termId)"
              :terminal-id="termId"
              :state-manager="getTerminalStateManager(termId)"
            />
          </div>

          <!-- 右侧内容区域：终端 + AI输入栏 -->
          <div class="terminal-right-area" :class="{ 'with-monitoring-panel': shouldShowDesktopMonitoringPanel(termId) }">
            <!-- 终端内容区域 -->
            <div class="terminal-content-padding">
              <div
                :ref="el => setTerminalRef(el, termId)"
                class="terminal-content"
                :data-terminal-id="termId"
              ></div>
            </div>

            <!-- AI输入栏 -->
            <div class="terminal-ai-input-area" v-if="shouldShowAIInputBar(termId) && isActiveTerminal(termId)">
              <AIInputBar
                :terminal-id="termId"
                :ai-service="getAIService()"
                :is-mobile="isMobile()"
                @ai-response="handleAIResponse"
                @mode-change="handleAIModeChange"
                @input-focus="handleAIInputFocus"
                @input-blur="handleAIInputBlur"
                @execute-command="handleExecuteCommand"
              />
            </div>
          </div>
        </div>

        <!-- 移动端监控抽屉 -->
        <MobileMonitoringDrawer
          :visible="shouldShowMobileMonitoringDrawer(termId) && isActiveTerminal(termId)"
          :monitoring-data="getMonitoringData(termId)"
          :terminal-id="termId"
          @close="hideMobileMonitoringDrawer(termId)"
          @update:visible="updateMobileDrawerVisibility(termId, $event)"
        />
      </div>
    </div>

    <!-- 终端自动完成组件 -->
    <TerminalAutocomplete
      :visible="autocomplete.visible"
      :suggestions="autocomplete.suggestions"
      :position="autocomplete.position"
      @select="handleAutocompleteSelect"
      @close="handleAutocompleteClose"
      ref="autocompleteRef"
    />
  </div>
</template>

<script>
import { ref, onMounted, onBeforeUnmount, nextTick, watch, computed, onActivated, onDeactivated } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useConnectionStore } from '../../store/connection'
import { useLocalConnectionsStore } from '../../store/localConnections'
import { useUserStore } from '../../store/user'
import { useTabStore } from '../../store/tab'
import { useTerminalStore } from '../../store/terminal'

import sshService from '../../services/ssh/index'
import RocketLoader from '../../components/common/RocketLoader.vue'
import settingsService from '../../services/settings'
// 导入终端工具栏组件
import TerminalToolbar from '../../components/terminal/TerminalToolbar.vue'
// 导入终端自动完成组件
import TerminalAutocomplete from '../../components/terminal/TerminalAutocomplete.vue'
// 导入终端自动完成服务
import terminalAutocompleteService from '../../services/terminal-autocomplete'
// 导入日志服务
import log from '../../services/log'
// 导入响应式监控面板组件
import ResponsiveMonitoringPanel from '../../components/monitoring/ResponsiveMonitoringPanel.vue'
// 导入移动端监控抽屉组件
import MobileMonitoringDrawer from '../../components/monitoring/MobileMonitoringDrawer.vue'
// 导入AI输入栏组件
import AIInputBar from '../../components/ai/AIInputBar.vue'

// 导入会话存储
import { useSessionStore } from '../../store/session'

// 在import部分添加字体加载器导入
import { waitForFontsLoaded } from '../../utils/fontLoader'

// 导入监控状态管理器
import monitoringStateManager from '../../services/monitoringStateManager'
// 导入监控状态管理器工厂
import monitoringStateManagerFactory from '../../services/monitoringStateManagerFactory'
// 导入AI服务
import aiService from '../../services/ai/ai-service.js'

export default {
  name: 'Terminal',
  components: {
    RocketLoader,
    TerminalToolbar, // 注册工具栏组件
    TerminalAutocomplete, // 注册自动完成组件
    ResponsiveMonitoringPanel, // 注册响应式监控面板组件
    MobileMonitoringDrawer, // 注册移动端监控抽屉组件
    AIInputBar // 注册AI输入栏组件
  },
  props: {
    id: {
      type: String,
      required: false,
      default: null
    }
  },
  setup(props) {
    const route = useRoute()
    const router = useRouter()
    const connectionStore = useConnectionStore()
    const localConnectionsStore = useLocalConnectionsStore()
    const userStore = useUserStore()
    const tabStore = useTabStore()
    const terminalStore = useTerminalStore()

    const sessionStore = useSessionStore() // 添加会话存储
    
    // 终端引用映射，key为连接ID，value为DOM元素
    const terminalRefs = ref({})
    // 终端初始化状态，key为连接ID，value为是否已初始化
    const terminalInitialized = ref({})
    // 当前所有打开的终端ID列表
    const terminalIds = ref([])
    
    const title = ref('终端')
    const status = ref('正在连接...')
    // 将isConnecting从普通的响应式变量改为每个终端的连接状态跟踪
    const terminalConnectingStates = ref({}) // 每个终端的连接状态
    const isConnectingInProgress = ref(false) // 添加连接进行中标志，避免并发请求
    // 添加终端背景状态变量
    const terminalHasBackground = ref(false)

    // 替换全局初始化标志为每个终端的初始化状态映射
    const terminalInitializingStates = ref({})

    // 监控面板相关状态
    const monitoringPanelStates = ref({}) // 每个终端的监控面板显示状态
    const monitoringDataCache = ref({})   // 每个终端的监控数据缓存
    const terminalStateManagers = ref({}) // 每个终端的状态管理器实例映射
    let cleanupMonitoringListener = null  // 监控数据监听器清理函数

    // AI输入栏相关状态
    const aiInputBarStates = ref({}) // 每个终端的AI输入栏显示状态

    // 每个终端的火箭动画阶段状态
    const terminalRocketPhases = ref({})

    // 获取指定终端的火箭动画阶段
    const getTerminalRocketPhase = (termId) => {
      return terminalRocketPhases.value[termId] || 'connecting'
    }

    // 设置指定终端的火箭动画阶段
    const setTerminalRocketPhase = (termId, phase) => {
      terminalRocketPhases.value[termId] = phase
    }

    // 处理指定终端的动画完成事件
    const handleTerminalAnimationComplete = (termId) => {
      // 动画完成后，确保加载覆盖层隐藏
      // 重置火箭动画状态，为下次连接做准备
      setTimeout(() => {
        setTerminalRocketPhase(termId, 'connecting');
      }, 200); // 缩短延迟时间，与新的动画时间保持一致
    }

    // 检查指定终端是否应该显示连接动画
    const shouldShowTerminalConnectingAnimation = (termId) => {
      if (!termId) return false;

      // 检查终端是否正在连接中
      if (terminalConnectingStates.value[termId]) {
        if (getTerminalRocketPhase(termId) !== 'connecting') {
          setTerminalRocketPhase(termId, 'connecting');
        }
        return true;
      }

      // 检查终端是否在初始化中
      if (terminalInitializingStates.value[termId]) {
        if (getTerminalRocketPhase(termId) !== 'connecting') {
          setTerminalRocketPhase(termId, 'connecting');
        }
        return true;
      }

      // 检查终端是否已初始化
      if (!terminalInitialized.value[termId]) {
        if (getTerminalRocketPhase(termId) !== 'connecting') {
          setTerminalRocketPhase(termId, 'connecting');
        }
        return true;
      }

      // 如果终端已经初始化，开始完成阶段动画
      if (terminalInitialized.value[termId] && getTerminalRocketPhase(termId) === 'connecting') {
        setTerminalRocketPhase(termId, 'connected');
        // 立即开始完成动画
        setTimeout(() => {
          if (getTerminalRocketPhase(termId) === 'connected') {
            setTerminalRocketPhase(termId, 'completing');
          }
        }, 100); // 很短的延迟，只是为了确保状态更新
        return true;
      }

      const currentPhase = getTerminalRocketPhase(termId);
      return currentPhase === 'connected' || currentPhase === 'completing';
    }
    
    // 终端背景设置
    const terminalBg = ref({
      enabled: false,
      url: '',
      opacity: 0.5,
      mode: 'cover'
    })

    // 自动完成状态
    const autocomplete = ref({
      visible: false,
      suggestions: [],
      position: { x: 0, y: 0 }
    })

    // 自动完成组件引用
    const autocompleteRef = ref(null)
    
    // 计算属性：是否应该显示火箭加载动画
    const shouldShowConnectingAnimation = computed(() => {
      const activeId = activeConnectionId.value;
      if (!activeId) {
        if (rocketAnimationPhase.value !== 'connecting') {
          rocketAnimationPhase.value = 'connecting';
        }
        return true; // 如果没有活动连接ID，则显示加载动画
      }

      // 检查活动终端是否正在连接中
      if (terminalConnectingStates.value[activeId]) {
        if (rocketAnimationPhase.value !== 'connecting') {
          rocketAnimationPhase.value = 'connecting';
        }
        return true;
      }

      // 检查活动终端是否在初始化中
      if (terminalInitializingStates.value[activeId]) {
        if (rocketAnimationPhase.value !== 'connecting') {
          rocketAnimationPhase.value = 'connecting';
        }
        return true;
      }

      // 检查活动终端是否已初始化
      if (!terminalInitialized.value[activeId]) {
        if (rocketAnimationPhase.value !== 'connecting') {
          rocketAnimationPhase.value = 'connecting';
        }
        return true;
      }

      // 如果终端已经初始化，开始完成阶段动画
      if (terminalInitialized.value[activeId] && rocketAnimationPhase.value === 'connecting') {
        rocketAnimationPhase.value = 'connected';
        // 立即开始完成动画
        setTimeout(() => {
          if (rocketAnimationPhase.value === 'connected') {
            rocketAnimationPhase.value = 'completing';
          }
        }, 100); // 很短的延迟，只是为了确保状态更新
        return true;
      }

      return rocketAnimationPhase.value === 'connected' || rocketAnimationPhase.value === 'completing';
    })
    
    // 计算终端背景样式
    const terminalBgStyle = computed(() => {
      if (!terminalBg.value.enabled || !terminalBg.value.url) {
        return {}
      }
      
      let backgroundSize = 'cover'
      if (terminalBg.value.mode === 'contain') {
        backgroundSize = 'contain'
      } else if (terminalBg.value.mode === 'fill') {
        backgroundSize = '100% 100%'
      } else if (terminalBg.value.mode === 'none') {
        backgroundSize = 'auto'
      } else if (terminalBg.value.mode === 'repeat') {
        backgroundSize = 'auto'
      }
      
      return {
        backgroundImage: `url(${terminalBg.value.url})`,
        backgroundSize: backgroundSize,
        backgroundRepeat: terminalBg.value.mode === 'repeat' ? 'repeat' : 'no-repeat',
        backgroundPosition: 'center center',
        opacity: terminalBg.value.opacity,
      }
    })
    
    // 计算当前连接ID，优先使用props中的ID，如果没有则使用路由参数或会话存储
    const activeConnectionId = computed(() => {
      // 优先使用props中的ID
      if (props.id) {
        return props.id
      }

      // 其次使用路由参数
      if (route.params.id) {
        return route.params.id
      }

      // 最后使用会话存储中的活动会话
      return sessionStore.getActiveSession()
    })

    // 监听活动终端变化，更新状态管理器
    watch(activeConnectionId, (newTerminalId, oldTerminalId) => {
      if (newTerminalId && newTerminalId !== oldTerminalId) {
        // 获取主机信息
        const session = terminalStore.sessions[newTerminalId]
        const hostId = session?.host || newTerminalId

        // 设置状态管理器的当前终端
        monitoringStateManager.setTerminal(newTerminalId, hostId)

        log.debug(`[终端] 状态管理器已切换到终端: ${newTerminalId}`)
      }
    }, { immediate: true })
    
    // 检查终端是否为当前活动终端
    const isActiveTerminal = (termId) => {
      return termId === activeConnectionId.value
    }
    
    // 获取终端样式，控制显示/隐藏
    const getTerminalStyle = (termId) => {
      // 不再通过内联样式控制可见性，改为通过CSS类控制
      // 返回空对象，让CSS类处理所有样式变化
      return {}
    }
    
    // 设置终端引用
    const setTerminalRef = (el, termId) => {
      if (el && !terminalRefs.value[termId]) {
        terminalRefs.value[termId] = el
        // 如果终端ID在列表中但尚未初始化，则初始化
        if (!terminalInitialized.value[termId]) {
          initTerminal(termId, el)
        }
      }
    }
    
    // 初始化特定ID的终端 - 使用统一初始化流程，避免重复逻辑
    const initTerminal = async (termId, container) => {
      try {
        if (!termId || !container) {
          log.error('初始化终端失败: 缺少ID或容器')
          return false
        }

        // 确保字体已经加载完成
        await waitForFontsLoaded()
        
        // 清理错误状态的连接
        if (terminalStore.getTerminalStatus(termId) === 'error') {
          delete terminalInitialized.value[termId]
          delete terminalInitializingStates.value[termId]
          delete terminalConnectingStates.value[termId]

          if (sessionStore.getSession(termId)) {
            sessionStore.setActiveSession(null)
          }
        }

        // 检查终端状态
        const hasTerminal = terminalStore.hasTerminal(termId)
        const hasSession = terminalStore.hasTerminalSession(termId)
        const isCreating = terminalStore.isSessionCreating(termId)
        
        // 如果终端或会话不存在，且不在创建中，才尝试初始化
        if ((!hasTerminal || !hasSession) && !isCreating) {
          // 调用统一初始化流程
          const success = await terminalStore.initTerminal(termId, container)
          return success
        } else if (hasTerminal && hasSession) {
          // 终端和会话都存在，直接标记为已初始化
          terminalInitialized.value[termId] = true
          terminalConnectingStates.value[termId] = false
          terminalInitializingStates.value[termId] = false
          return true
        } else if (isCreating) {
          // 正在创建中，标记状态
          terminalInitializingStates.value[termId] = true
          terminalConnectingStates.value[termId] = true
          return false
        }
        
        // 未满足初始化条件
        return false
      } catch (error) {
        log.error(`终端初始化错误: ${error.message}`, error)
        return false
      }
    }

    // 应用终端设置
    const applyTerminalSettings = (termId) => {
      try {
        // 获取终端实例
        const terminalInstance = terminalStore.getTerminal(termId)
        
        if (!terminalStore.hasTerminalSession(termId)) {
          log.warn(`跳过应用设置：终端 ${termId} 不存在`)
          return false
        }
        
        if (!terminalInstance) {
          log.warn(`跳过应用设置：无法获取终端 ${termId} 实例`)
          return false
        }
        
        // 根据终端store的实现，存储的是直接的xterm.js实例
        const terminal = terminalInstance
        const settings = settingsService.getTerminalSettings()
        let hasChanges = false

        // 应用字体大小
        if (settings.fontSize && terminal.options.fontSize !== settings.fontSize) {
          log.debug(`终端 ${termId}: 更新字体大小 ${terminal.options.fontSize} -> ${settings.fontSize}`)
          terminal.options.fontSize = settings.fontSize
          hasChanges = true
        }

        // 应用字体系列
        if (settings.fontFamily && terminal.options.fontFamily !== settings.fontFamily) {
          log.debug(`终端 ${termId}: 更新字体系列 ${terminal.options.fontFamily} -> ${settings.fontFamily}`)
          terminal.options.fontFamily = settings.fontFamily
          hasChanges = true
        }

        // 应用光标样式
        if (settings.cursorStyle && terminal.options.cursorStyle !== settings.cursorStyle) {
          log.debug(`终端 ${termId}: 更新光标样式 ${terminal.options.cursorStyle} -> ${settings.cursorStyle}`)
          terminal.options.cursorStyle = settings.cursorStyle

          // 立即应用光标样式到终端实例
          if (terminal.setOption) {
            terminal.setOption('cursorStyle', settings.cursorStyle)
          }
          hasChanges = true
        }

        // 应用光标闪烁
        if (settings.cursorBlink !== undefined && terminal.options.cursorBlink !== settings.cursorBlink) {
          log.debug(`终端 ${termId}: 更新光标闪烁 ${terminal.options.cursorBlink} -> ${settings.cursorBlink}`)
          terminal.options.cursorBlink = settings.cursorBlink

          // 立即应用光标闪烁到终端实例
          if (terminal.setOption) {
            terminal.setOption('cursorBlink', settings.cursorBlink)
          }
          hasChanges = true
        }
        
        // 应用其他可配置项...
        
        // 应用主题设置
        try {
          if (settings.theme) {
            const themeConfig = settingsService.getTerminalTheme(settings.theme)

            // 比较当前主题和新主题
            const currentBg = terminal.options.theme?.background
            const newBg = themeConfig.background

            if (currentBg !== newBg) {
              log.debug(`终端 ${termId}: 更新主题 ${currentBg} -> ${newBg}`)

              // 应用新主题到xterm.js实例
              terminal.options.theme = themeConfig

              // 使用setOption方法立即应用主题
              if (terminal.setOption) {
                terminal.setOption('theme', themeConfig)
              }

              hasChanges = true
            }
          }
        } catch (error) {
          log.error(`应用终端 ${termId} 主题失败:`, error)
        }
        
        // 应用调整大小
            try {
          terminal.fit()
            } catch (e) {
          log.warn(`调整终端 ${termId} 大小失败:`, e)
            }
          
        if (hasChanges) {
          log.debug(`终端 ${termId}: 设置已成功应用`)
        } else {
          log.debug(`终端 ${termId}: 没有需要应用的设置变更`)
        }
        
        return true
      } catch (error) {
        log.error(`应用终端 ${termId} 设置失败:`, error)
        return false
      }
    }
    
    // 加载终端背景设置
    const loadTerminalBgSettings = () => {
      try {
        const savedBgSettings = localStorage.getItem('easyssh_terminal_bg')
        if (savedBgSettings) {
          const parsedSettings = JSON.parse(savedBgSettings)
          terminalBg.value = { ...parsedSettings }
          
          // 更新本地背景状态
          terminalHasBackground.value = parsedSettings.enabled
          
          // 发送背景图状态事件
          window.dispatchEvent(new CustomEvent('terminal-bg-status', {
            detail: {
              enabled: terminalBg.value.enabled,
              bgSettings: terminalBg.value
            }
          }))
          
          // 更新CSS变量以供AppLayout使用
          updateCssVariables()
        }
      } catch (error) {
        log.error('加载终端背景设置失败:', error)
      }
    }
    
    // 更新CSS变量以供AppLayout使用
    const updateCssVariables = () => {
      if (terminalBg.value.enabled && terminalBg.value.url) {
        document.documentElement.style.setProperty('--terminal-bg-image', `url(${terminalBg.value.url})`)
        document.documentElement.style.setProperty('--terminal-bg-opacity', terminalBg.value.opacity.toString())
        
        // 设置背景尺寸
        let backgroundSize = 'cover'
        if (terminalBg.value.mode === 'contain') {
          backgroundSize = 'contain'
        } else if (terminalBg.value.mode === 'fill') {
          backgroundSize = '100% 100%'
        } else if (terminalBg.value.mode === 'none') {
          backgroundSize = 'auto'
        } else if (terminalBg.value.mode === 'repeat') {
          backgroundSize = 'auto'
        }
        document.documentElement.style.setProperty('--terminal-bg-size', backgroundSize)
        
        // 设置背景重复
        const backgroundRepeat = terminalBg.value.mode === 'repeat' ? 'repeat' : 'no-repeat'
        document.documentElement.style.setProperty('--terminal-bg-repeat', backgroundRepeat)
      } else {
        document.documentElement.style.removeProperty('--terminal-bg-image')
        document.documentElement.style.removeProperty('--terminal-bg-opacity')
        document.documentElement.style.removeProperty('--terminal-bg-size')
        document.documentElement.style.removeProperty('--terminal-bg-repeat')
      }
    }
    
    // 监听终端背景设置变化事件（使用命名函数以便正确移除）
    let bgChangeHandler = null
    const listenForBgChanges = () => {
      // 创建命名的处理函数
      bgChangeHandler = (event) => {
        if (event.detail) {
          terminalBg.value = { ...event.detail }
          
          // 更新本地背景状态
          terminalHasBackground.value = event.detail.enabled
          
          // 发送背景图状态变更事件
          window.dispatchEvent(new CustomEvent('terminal-bg-status', {
            detail: {
              enabled: terminalBg.value.enabled,
              bgSettings: terminalBg.value
            }
          }))
          
          // 更新CSS变量
          updateCssVariables()
        }
      }
      
      // 使用命名函数添加监听器
      window.addEventListener('terminal-bg-changed', bgChangeHandler)
    }
    
    // 添加防抖计时器
    const updateIdListDebounceTimer = ref(null)
    
    // 监听打开的终端标签页，更新终端ID列表
    const updateTerminalIds = () => {
      // 添加防抖处理
      if (updateIdListDebounceTimer.value) {
        clearTimeout(updateIdListDebounceTimer.value)
      }
      
      updateIdListDebounceTimer.value = setTimeout(() => {
        // 获取所有终端类型的标签页
        const terminalTabs = tabStore.tabs.filter(tab => 
          tab.type === 'terminal' && 
          tab.data && 
          tab.data.connectionId
        )
        
        // 提取所有终端ID
        const newIds = [...new Set(terminalTabs.map(tab => tab.data.connectionId))]
        
        // 查找要删除的ID
        const idsToRemove = terminalIds.value.filter(id => !newIds.includes(id));
        
        if (idsToRemove.length > 0) {
          log.debug(`发现${idsToRemove.length}个不在标签页中的终端ID，准备移除:`, idsToRemove);
          
          // 清理不在标签页中的终端ID及其相关状态
          for (const idToRemove of idsToRemove) {
            // 清理终端状态
            delete terminalInitialized.value[idToRemove];
            delete terminalInitializingStates.value[idToRemove];
            delete terminalConnectingStates.value[idToRemove];
            delete terminalSized.value[idToRemove];
            
            // 清理定时器
            if (resizeDebounceTimers.value[idToRemove]) {
              clearTimeout(resizeDebounceTimers.value[idToRemove]);
              delete resizeDebounceTimers.value[idToRemove];
            }
            
            // 清理引用
            if (terminalRefs.value[idToRemove]) {
              terminalRefs.value[idToRemove] = null;
              delete terminalRefs.value[idToRemove];
            }
          }
        }
        
        // 比较新旧ID列表，只有当内容不同时才更新和记录日志
        const currentIds = terminalIds.value
        const hasChanged = newIds.length !== currentIds.length || 
                           newIds.some(id => !currentIds.includes(id)) ||
                           currentIds.some(id => !newIds.includes(id))
        
        if (hasChanged) {
          // 更新ID列表
          terminalIds.value = newIds
          log.debug('更新终端ID列表:', terminalIds.value)
        }
        
        updateIdListDebounceTimer.value = null
      }, 50) // 50ms防抖延迟
    }
    
    // 添加防抖控制
    const resizeDebounceTimers = ref({})
    
    // 添加终端尺寸已调整标志
    const terminalSized = ref({})
    
    // 调整终端大小（添加防抖逻辑和尺寸状态跟踪）
    const resizeTerminal = (termId = null) => {
      // 防抖函数 - 避免短时间内多次调整同一终端
      const debouncedResize = (id) => {
        // 如果已有定时器，先清除
        if (resizeDebounceTimers.value[id]) {
          clearTimeout(resizeDebounceTimers.value[id])
        }
        
        // 设置新的定时器
        resizeDebounceTimers.value[id] = setTimeout(() => {
          if (!terminalStore.hasTerminal(id)) return
          
          try {
            // 移除重复的调整日志 - 由 terminalStore.fitTerminal 统一输出
            terminalStore.fitTerminal(id)
            // 标记终端尺寸已调整
            terminalSized.value[id] = true
            // 清除定时器引用
            delete resizeDebounceTimers.value[id]
          } catch (error) {
            log.error(`调整终端 ${id} 大小失败:`, error)
          }
        }, 50) // 短延迟防抖
      }
      
      // 如果指定了ID，只调整该终端大小
      if (termId) {
        // 仅当终端未被调整过大小时才进行调整
        if (!terminalSized.value[termId]) {
          debouncedResize(termId)
        } else {
          log.debug(`终端 ${termId} 已调整过大小，跳过调整`)
        }
        return
      }
      
      // 否则调整所有终端大小，优先调整活动终端
      const activeId = activeConnectionId.value
      if (activeId && terminalStore.hasTerminal(activeId) && !terminalSized.value[activeId]) {
        debouncedResize(activeId)
      }
      
      // 然后调整其它未调整过大小的终端
      terminalIds.value.forEach(id => {
        if (id !== activeId && terminalStore.hasTerminal(id) && !terminalSized.value[id]) {
          debouncedResize(id)
        }
      })
    }
    
    // 为组件添加最后聚焦的终端ID跟踪
    const lastFocusedTerminalId = ref(null)

    // 强制应用光标样式的函数
    const forceCursorStyle = (termId) => {
      if (!termId || !terminalStore.hasTerminal(termId)) return

      try {
        const terminal = terminalStore.getTerminal(termId)
        const settings = settingsService.getTerminalSettings()

        if (terminal && settings) {
          // 根据终端store的实现，terminal直接是xterm.js实例

          // 立即应用光标样式
          if (settings.cursorStyle && terminal.setOption) {
            terminal.setOption('cursorStyle', settings.cursorStyle)
          }
          if (settings.cursorBlink !== undefined && terminal.setOption) {
            terminal.setOption('cursorBlink', settings.cursorBlink)
          }

          // 强制刷新终端显示
          if (terminal.refresh) {
            terminal.refresh(terminal.buffer.active.cursorY, terminal.buffer.active.cursorY)
          }
        }
      } catch (error) {
        log.warn(`强制应用光标样式失败: ${error.message}`)
      }
    }

    // 修改聚焦逻辑，跟踪焦点状态并立即应用光标样式
    const focusTerminal = (termId) => {
      if (!termId || !terminalStore.hasTerminal(termId)) return false

      try {
        // 先强制应用光标样式
        // 这样可以避免终端切换时光标样式从默认滑块样式转换到用户设置样式的闪烁问题
        forceCursorStyle(termId)

        // 然后聚焦终端
        terminalStore.focusTerminal(termId)
        lastFocusedTerminalId.value = termId

        // 聚焦后立即再次强制应用光标样式
        nextTick(() => {
          forceCursorStyle(termId)
        })

        return true
      } catch (error) {
        log.error(`聚焦终端 ${termId} 失败:`, error)
        return false
      }
    }
    
    // 切换终端函数
    const switchToTerminal = async (termId) => {
      if (!termId || !terminalStore.hasTerminal(termId)) return

      // 取消所有正在进行的大小调整
      Object.keys(resizeDebounceTimers.value).forEach(id => {
        clearTimeout(resizeDebounceTimers.value[id])
        delete resizeDebounceTimers.value[id]
      })

      // 使用nextTick确保DOM更新
      nextTick(() => {
        if (terminalStore.hasTerminal(termId)) {
          // 仅当终端未调整过大小时才调整
          if (!terminalSized.value[termId]) {
            resizeTerminal(termId)
          }
          focusTerminal(termId)
        }
      })
    }
    
    // 监听标签页状态变化，更新终端ID列表
    watch(
      () => tabStore.tabs,
      (newTabs, oldTabs) => {
        // 检测已关闭的终端标签
        if (oldTabs && oldTabs.length > newTabs.length) {
          // 查找已关闭的终端标签
          const closedTabs = oldTabs.filter(oldTab => 
            !newTabs.some(newTab => 
              newTab.data && oldTab.data && newTab.data.connectionId === oldTab.data.connectionId
            ) && 
            oldTab.type === 'terminal' && 
            oldTab.data && 
            oldTab.data.connectionId
          );
          
          // 处理已关闭的终端标签
          if (closedTabs.length > 0) {
            for (const closedTab of closedTabs) {
              const closedId = closedTab.data.connectionId;
              log.debug(`检测到标签页关闭，移除终端ID: ${closedId}`);
              
              // 从终端ID列表中移除
              terminalIds.value = terminalIds.value.filter(id => id !== closedId);
              
              // 清理与此终端相关的所有状态
              delete terminalInitialized.value[closedId];
              delete terminalInitializingStates.value[closedId];
              delete terminalConnectingStates.value[closedId];
              delete terminalSized.value[closedId];
              
              if (resizeDebounceTimers.value[closedId]) {
                clearTimeout(resizeDebounceTimers.value[closedId]);
                delete resizeDebounceTimers.value[closedId];
              }
              
              // 清理引用
              if (terminalRefs.value[closedId]) {
                terminalRefs.value[closedId] = null;
                delete terminalRefs.value[closedId];
              }
            }
          }
        }
        
        updateTerminalIds();
      },
      { deep: true, immediate: true }
    )
    
    // 监听会话切换，确保工具栏同步和终端切换
    const handleSessionChange = (event) => {
      if (!event?.detail?.sessionId) return;

      const { sessionId, isTabSwitch } = event.detail;

      // 如果终端ID不在列表中，添加到列表
      if (!terminalIds.value.includes(sessionId)) {
        terminalIds.value.push(sessionId);
      }

      // 为新终端初始化监控面板默认状态
      if (monitoringPanelStates.value[sessionId] === undefined) {
        monitoringPanelStates.value[sessionId] = isDesktop(); // 桌面端默认显示
        log.debug(`[终端] 新终端监控面板默认状态: ${sessionId}, 显示: ${isDesktop()}`);
      }

      // 为新终端创建状态管理器实例
      if (!terminalStateManagers.value[sessionId]) {
        getTerminalStateManager(sessionId);
      }
      
      // 检查是否是标签切换模式
      if (!isTabSwitch) {
        // 重置该终端的火箭动画状态为连接中
        setTerminalRocketPhase(sessionId, 'connecting');

        // 无论终端是否已存在，都将其状态设置为正在连接
        // 这确保了火箭动画能正常显示，即使是已有终端
        terminalConnectingStates.value[sessionId] = true;

        // 告知工具栏重置状态 - 发送工具栏状态重置事件
        window.dispatchEvent(new CustomEvent('terminal:toolbar-reset', {
          detail: { sessionId }
        }));

        // 如果终端已经存在，延迟更新连接状态
        if (terminalStore.hasTerminal(sessionId)) {
          setTimeout(() => {
            terminalConnectingStates.value[sessionId] = false;
          }, 1000);
        }
      } else {
        // 标签切换，不显示连接动画
        terminalConnectingStates.value[sessionId] = false;

        // 发送工具栏同步事件
        window.dispatchEvent(new CustomEvent('terminal:toolbar-sync', {
          detail: { sessionId }
        }));
      }

      // 延迟切换以确保终端初始化完成
      setTimeout(() => {
        switchToTerminal(sessionId);
        if (terminalStore.hasTerminal(sessionId)) {
          forceCursorStyle(sessionId);
        }
      }, 100);
    };
    
    // 修改watch函数，添加连接中状态检查
    watch(
      () => route.path,
      (newPath) => {
        // 当路径变为'/terminal'（无参数）时，从会话存储获取会话ID
        if (newPath === '/terminal' && !isConnectingInProgress.value && !Object.values(terminalInitializingStates.value).some(state => state)) {
          const currentSessionId = sessionStore.getActiveSession()
          if (currentSessionId) {
            log.debug(`检测到终端路径变更，使用会话存储ID: ${currentSessionId}`)
            updateTerminalIds()
          }
        }
      },
      { immediate: true }
    )
    
    // 定义处理键盘快捷键事件的函数
    const handleKeyboardAction = (action) => {
      if (action === 'terminal.clear') {
        clearTerminal()
      }
    }

    // 处理终端主题更新事件 - 优化为同步批量更新
    const handleTerminalThemeUpdate = async (event) => {
      log.info('收到终端主题更新事件:', event.detail)
      log.info('当前终端ID列表:', terminalIds.value)

      // 直接获取当前UI主题对应的终端主题
      const uiTheme = event.detail?.uiTheme || 'dark'
      const terminalThemeName = uiTheme === 'light' ? 'light' : 'dark'
      const themeConfig = settingsService.getTerminalTheme(terminalThemeName)
      log.info('获取到的新主题配置:', themeConfig)

      // 使用applySettingsToAllTerminals方法批量更新所有终端的主题
      try {
        log.info(`开始批量更新所有终端主题为: ${terminalThemeName}`)
        const results = await terminalStore.applySettingsToAllTerminals({
          theme: terminalThemeName
        })
        log.info(`批量更新终端主题完成:`, results)

        // 统计成功和失败的数量
        const successCount = Object.values(results).filter(success => success).length
        const totalCount = Object.keys(results).length
        log.info(`主题更新结果: ${successCount}/${totalCount} 个终端更新成功`)
      } catch (error) {
        log.error('批量更新终端主题失败:', error)
      }
    }

    // 处理终端设置更新事件
    const handleTerminalSettingsUpdate = async (event) => {
      if (event.detail && event.detail.settings) {
        log.info('收到终端设置更新事件，应用到所有活动终端')

        // 更新设置服务中的设置（确保同步）
        try {
          const newSettings = event.detail.settings
          if (settingsService.isInitialized) {
            // 更新设置服务中的终端设置
            Object.keys(newSettings).forEach(key => {
              if (newSettings[key] !== undefined) {
                settingsService.set(`terminal.${key}`, newSettings[key])
              }
            })
            log.debug('设置服务中的终端设置已同步更新')
          }
        } catch (error) {
          log.error('同步设置服务失败:', error)
        }

        // 使用terminalStore的批量更新方法应用设置到所有终端
        try {
          log.info('开始批量更新所有终端设置')
          const results = await terminalStore.applySettingsToAllTerminals(event.detail.settings)
          log.info('批量更新终端设置完成:', results)

          // 统计成功和失败的数量
          const successCount = Object.values(results).filter(success => success).length
          const totalCount = Object.keys(results).length
          log.info(`设置更新结果: ${successCount}/${totalCount} 个终端更新成功`)
        } catch (error) {
          log.error('批量更新终端设置失败:', error)
        }
      }
    }

    // 监听外部工具栏事件
    const setupToolbarListeners = () => {
      window.addEventListener('terminal:send-command', sendTerminalCommand)
      window.addEventListener('terminal:clear', clearTerminal)
      window.addEventListener('terminal:disconnect', disconnectTerminal)
      window.addEventListener('terminal:execute-command', executeTerminalCommand)
      
      // 全局键盘管理器服务可用时绑定事件
      if (window.services?.keyboardManager) {
        window.services.keyboardManager.on('action', handleKeyboardAction)
      }
      
      // 监听服务就绪事件，以便在服务加载后绑定
      window.addEventListener('services:ready', () => {
        if (window.services?.keyboardManager) {
          window.services.keyboardManager.on('action', handleKeyboardAction)
        }
      }, { once: true })
    }
    
    // 移除外部工具栏事件监听
    const removeToolbarListeners = () => {
      window.removeEventListener('terminal:send-command', sendTerminalCommand)
      window.removeEventListener('terminal:clear', clearTerminal)
      window.removeEventListener('terminal:disconnect', disconnectTerminal)
      window.removeEventListener('terminal:execute-command', executeTerminalCommand)
      
      // 移除键盘快捷键事件监听
      if (window.services?.keyboardManager) {
        window.services.keyboardManager.off('action', handleKeyboardAction)
      }
    }
    
    // 清空当前活动终端
    const clearTerminal = () => {
      const id = activeConnectionId.value
      if (id && terminalStore.hasTerminal(id)) {
        terminalStore.clearTerminal(id)
      }
    }
    
    // 发送命令到当前活动终端
    const sendTerminalCommand = () => {
      try {
        ElMessageBox.prompt('请输入要执行的命令', '发送命令', {
          confirmButtonText: '发送',
          cancelButtonText: '取消',
          inputPattern: /.+/,
          inputErrorMessage: '命令不能为空'
        }).then(({ value }) => {
          const id = activeConnectionId.value
          if (id) {
            terminalStore.sendCommand(id, value)
          }
        }).catch(() => {
          // 用户取消输入，不做处理
        })
      } catch (error) {
        log.error('发送命令失败:', error)
      }
    }
    
    // 执行指定命令到终端
    const executeTerminalCommand = (event) => {
      if (event.detail && event.detail.command) {
        const id = event.detail.sessionId || activeConnectionId.value
        if (id && terminalStore.hasTerminal(id)) {
          // 先发送换行符确保在新行开始命令
          terminalStore.sendCommand(id, "")
          // 延迟一小段时间后再发送实际命令
          setTimeout(() => {
            terminalStore.sendCommand(id, event.detail.command)
          }, 100)
          
          log.debug(`执行命令到终端 ${id}: ${event.detail.command}`)
        } else {
          log.error('无法执行命令：终端不存在或无效')
        }
      }
    }
    
    // 处理SSH错误
    const handleSSHError = (event) => {
      if (event.detail && activeConnectionId.value) {
        const sessionId = terminalStore.sessions[activeConnectionId.value]
        if (sessionId && event.detail.sessionId === sessionId) {
          ElMessage.error(`连接失败: ${event.detail.message || '服务器无响应'}`)
          status.value = '连接错误'
          
          // 直接清理本地状态，避免断开时找不到会话ID的问题
          delete terminalInitialized.value[activeConnectionId.value]
          delete terminalInitializingStates.value[activeConnectionId.value]
          delete terminalConnectingStates.value[activeConnectionId.value]
          
          // 从终端ID列表中移除
          terminalIds.value = terminalIds.value.filter(id => id !== activeConnectionId.value)
          
          // 清理会话存储中的状态
          if (sessionStore.getSession(activeConnectionId.value)) {
            sessionStore.setActiveSession(null)
          }
          
          // 仅在会话实际存在的情况下尝试断开连接
          if (terminalStore.hasTerminalSession(activeConnectionId.value)) {
            terminalStore.disconnectTerminal(activeConnectionId.value)
              .finally(() => {
                // 导航回连接配置界面
                router.push('/connections/new')
              })
          } else {
            // 如果会话不存在，直接返回连接配置界面
            router.push('/connections/new')
          }
        }
      }
    }
    
    // 断开当前活动终端连接
    const disconnectTerminal = async () => {
      ElMessageBox.confirm('确定要断开此连接吗？', '断开连接', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }).then(() => {
        disconnectSession()
      }).catch(() => {
        // 用户取消，不执行任何操作
      })
    }
    
    // 断开会话函数
    const disconnectSession = async () => {
      const id = activeConnectionId.value
      if (id) {
        const success = await terminalStore.disconnectTerminal(id)
        if (success) {
          log.info(`终端 ${id} 已断开`)
          
          // 从终端ID列表中移除
          terminalIds.value = terminalIds.value.filter(termId => termId !== id)
          // 移除终端初始化状态标记
          delete terminalInitialized.value[id]
          delete terminalInitializingStates.value[id]
          delete terminalConnectingStates.value[id]
          
          // 检查是否所有终端都已完成连接
          const anyConnecting = Object.values(terminalConnectingStates.value).some(state => state === true)
          isConnectingInProgress.value = anyConnecting
          
          // 找到对应标签页关闭
          const tabIndex = tabStore.tabs.findIndex(tab => 
            tab.type === 'terminal' && 
            tab.data && 
            tab.data.connectionId === id
          )
          
          if (tabIndex >= 0) {
            tabStore.closeTab(tabIndex)
          }
        }
      }
    }
    
    // 创建全局的窗口大小变化处理函数，防止多个匿名函数导致无法正确移除
    let windowResizeTimer = null
    const handleWindowResize = () => {
      // 使用定时器防抖
      if (windowResizeTimer) {
        clearTimeout(windowResizeTimer)
      }
      
      windowResizeTimer = setTimeout(() => {
        log.debug('窗口大小变化，重置所有终端尺寸状态')
        // 清空已调整标记，让所有终端都能重新调整
        terminalSized.value = {}
        // 调整所有终端大小
        resizeTerminal()

        // 处理监控面板响应式状态
        handleMonitoringPanelResize()

        windowResizeTimer = null
      }, 100) // 100ms防抖
    }
    
    // 在变量声明部分添加sftpPanelWidth
    const sftpPanelWidth = ref(600) // 默认SFTP面板宽度
    
    // 添加SFTP和监控面板相关方法
    const toggleSftpPanel = () => {
      // 通过事件将当前终端ID传递给父组件
      window.dispatchEvent(new CustomEvent('request-toggle-sftp-panel', {
        detail: { sessionId: activeConnectionId.value }
      }));
    }

    const toggleMonitoringPanel = async () => {
      const sessionId = activeConnectionId.value;
      if (!sessionId) {
        log.warn('[终端] 无法切换监控面板：没有活动会话');
        return;
      }

      try {
        // 切换当前活动终端的监控面板显示状态
        const currentState = monitoringPanelStates.value[sessionId] || false;
        monitoringPanelStates.value[sessionId] = !currentState;

        // 管理用户偏好
        if (!currentState) {
          // 用户手动显示面板，清除隐藏偏好
          localStorage.removeItem(`monitoring-panel-user-hidden-${sessionId}`);
        } else {
          // 用户手动隐藏面板，记录偏好
          localStorage.setItem(`monitoring-panel-user-hidden-${sessionId}`, 'true');
        }

        log.info(`[终端] 监控面板已${!currentState ? '显示' : '隐藏'}: ${sessionId}`);

      } catch (error) {
        log.error(`[终端] 切换监控面板失败: ${error.message}`);
        ElMessage.error(`切换监控面板失败: ${error.message}`);
      }
    }

    // 检测是否为桌面端
    const isDesktop = () => {
      return window.innerWidth >= 768;
    }

    // 检测是否为移动端
    const isMobile = () => {
      return window.innerWidth < 768;
    }



    // 监控面板相关方法
    const shouldShowMonitoringPanel = (termId) => {
      // 如果没有设置过状态，则根据屏幕尺寸设置默认值
      if (monitoringPanelStates.value[termId] === undefined) {
        monitoringPanelStates.value[termId] = isDesktop(); // 桌面端默认显示，移动端默认隐藏
      }
      return monitoringPanelStates.value[termId] || false;
    }

    // 桌面端监控面板显示逻辑
    const shouldShowDesktopMonitoringPanel = (termId) => {
      return isDesktop() && shouldShowMonitoringPanel(termId);
    }

    // 移动端监控抽屉显示逻辑
    const shouldShowMobileMonitoringDrawer = (termId) => {
      return isMobile() && shouldShowMonitoringPanel(termId);
    }

    const isMonitoringPanelVisible = (termId) => {
      return monitoringPanelStates.value[termId] || false;
    }

    const getMonitoringData = (termId) => {
      return monitoringDataCache.value[termId] || {};
    }

    // 获取或创建指定终端的状态管理器实例
    const getTerminalStateManager = (termId) => {
      if (!termId) {
        log.warn('[终端] 无法获取状态管理器：终端ID为空')
        return null
      }

      // 如果已存在实例，直接返回
      if (terminalStateManagers.value[termId]) {
        return terminalStateManagers.value[termId]
      }

      // 获取终端对应的主机信息
      const session = terminalStore.sessions[termId]
      const hostId = session?.host || termId

      // 通过工厂创建新实例
      const stateManager = monitoringStateManagerFactory.getInstance(termId, hostId)
      if (stateManager) {
        terminalStateManagers.value[termId] = stateManager
        log.debug(`[终端] 已创建状态管理器实例: ${termId} (主机: ${hostId})`)
      }

      return stateManager
    }

    // 清理指定终端的状态管理器实例
    const cleanupTerminalStateManager = (termId) => {
      if (terminalStateManagers.value[termId]) {
        // 通过工厂销毁实例
        monitoringStateManagerFactory.destroyInstance(termId)
        delete terminalStateManagers.value[termId]
        log.debug(`[终端] 已清理状态管理器实例: ${termId}`)
      }
    }

    const hideMonitoringPanel = (termId) => {
      monitoringPanelStates.value[termId] = false;
      // 记录用户手动隐藏的偏好
      localStorage.setItem(`monitoring-panel-user-hidden-${termId}`, 'true');
      log.info(`[终端] 监控面板已隐藏: ${termId}`);
    }

    // 移动端抽屉特定方法
    const hideMobileMonitoringDrawer = (termId) => {
      hideMonitoringPanel(termId);
    }

    const updateMobileDrawerVisibility = (termId, visible) => {
      monitoringPanelStates.value[termId] = visible;
      if (!visible) {
        // 记录用户手动隐藏的偏好
        localStorage.setItem(`monitoring-panel-user-hidden-${termId}`, 'true');
      } else {
        // 用户手动显示，清除隐藏偏好
        localStorage.removeItem(`monitoring-panel-user-hidden-${termId}`);
      }
      log.info(`[终端] 移动端监控抽屉${visible ? '显示' : '隐藏'}: ${termId}`);
    }



    // 设置监控数据监听器 - 监听每个终端的独立状态管理器
    const setupMonitoringDataListener = () => {
      // 监听所有终端状态管理器的数据变化
      const watchers = []

      // 为现有终端设置监听器
      const setupWatcherForTerminal = (termId) => {
        const stateManager = getTerminalStateManager(termId)
        if (stateManager) {
          const monitoringData = computed(() => stateManager.getMonitoringData())

          const watcher = watch(monitoringData, (newData) => {
            if (newData && Object.keys(newData).length > 0) {
              monitoringDataCache.value[termId] = { ...newData }
              // 监控数据已更新（日志已移除，用户可在WebSocket中查看）
            }
          }, { deep: true })

          watchers.push({ termId, watcher })
        }
      }

      // 为现有终端设置监听器
      Object.keys(terminalStore.sessions).forEach(setupWatcherForTerminal)

      // 监听新终端的创建
      const sessionWatcher = watch(() => Object.keys(terminalStore.sessions), (newTerminals, oldTerminals) => {
        const addedTerminals = newTerminals.filter(id => !oldTerminals.includes(id))
        addedTerminals.forEach(setupWatcherForTerminal)
      })

      watchers.push({ termId: 'session-watcher', watcher: sessionWatcher })

      // 返回清理函数
      return () => {
        watchers.forEach(({ watcher }) => {
          if (typeof watcher === 'function') {
            watcher()
          }
        })
      }
    }

    // 初始化监控面板默认状态
    const initializeMonitoringPanelDefaults = () => {
      // 为所有现有的终端设置默认监控面板状态
      const currentTerminals = Object.keys(terminalStore.sessions);
      currentTerminals.forEach(termId => {
        if (monitoringPanelStates.value[termId] === undefined) {
          monitoringPanelStates.value[termId] = isDesktop(); // 桌面端默认显示
          log.debug(`[终端] 初始化监控面板默认状态: ${termId}, 显示: ${isDesktop()}`);
        }
      });

      // 如果有活动终端，也确保其状态被初始化
      if (activeConnectionId.value && monitoringPanelStates.value[activeConnectionId.value] === undefined) {
        monitoringPanelStates.value[activeConnectionId.value] = isDesktop();
        log.debug(`[终端] 初始化活动终端监控面板状态: ${activeConnectionId.value}, 显示: ${isDesktop()}`);
      }
    }

    // 处理监控面板响应式状态变化
    const handleMonitoringPanelResize = () => {
      const currentIsDesktop = isDesktop();
      const currentIsMobile = isMobile();

      Object.keys(terminalStore.sessions).forEach(termId => {
        // 桌面端逻辑：当从移动端切换到桌面端时，自动显示监控面板（如果用户没有手动设置过）
        if (currentIsDesktop && !monitoringPanelStates.value[termId]) {
          // 检查用户是否手动隐藏过面板（通过localStorage）
          const userPreference = localStorage.getItem(`monitoring-panel-user-hidden-${termId}`);
          if (!userPreference) {
            monitoringPanelStates.value[termId] = true;
            log.debug(`[终端] 窗口切换到桌面端，自动显示监控面板: ${termId}`);
          }
        }

        // 移动端逻辑：当从桌面端切换到移动端时，如果面板是显示的，保持状态但切换为抽屉模式
        if (currentIsMobile && monitoringPanelStates.value[termId]) {
          log.debug(`[终端] 窗口切换到移动端，监控面板切换为抽屉模式: ${termId}`);
          // 状态保持不变，只是显示方式从侧边面板切换为抽屉
        }
      });
    }
    
    // 组件挂载
    onMounted(() => {
      // 初始化标签页标题
      if (tabStore.tabs.some(tab => tab.path === '/terminal')) {
        tabStore.updateTabTitle('/terminal', '终端')
      }

      // 设置自动完成回调
      setupAutocompleteCallbacks()

      // 添加全局键盘事件监听
      document.addEventListener('keydown', handleGlobalKeydown, true)

      // 设置监控数据监听器
      cleanupMonitoringListener = setupMonitoringDataListener()

      // 初始化监控面板默认状态
      initializeMonitoringPanelDefaults()

      // 初始化ResizeObserver - 在DOM挂载后安全地初始化
      nextTick(() => {
        const terminalContainer = document.querySelector('.terminal-container')
        if (terminalContainer) {
          resizeObserver = new ResizeObserver(() => {
            if (activeConnectionId.value && terminalStore.hasTerminal(activeConnectionId.value)) {
              // 仅在终端实际存在时调整大小
              terminalStore.fitTerminal(activeConnectionId.value)
            }
          })
          resizeObserver.observe(terminalContainer)
        }
      })

      // 设置终端事件监听
      cleanupEvents = setupTerminalEvents()
      // 设置SSH失败事件监听
      cleanupSSHFailureEvents = setupSSHFailureHandler()

      // 添加会话切换事件监听
      window.addEventListener('terminal:session-change', handleSessionChange)
      // 移除重复的事件监听器 - 只保留 terminal-status-update 事件系统
      // window.addEventListener('terminal:refresh-status', handleTerminalRefreshStatus)

      // 添加终端主题更新监听器
      window.addEventListener('terminal-theme-update', handleTerminalThemeUpdate)

      // 添加终端设置更新监听器
      window.addEventListener('terminal-settings-updated', handleTerminalSettingsUpdate)

      // 如果有活动连接ID，则更新终端ID列表
      if (activeConnectionId.value) {
        if (!terminalIds.value.includes(activeConnectionId.value)) {
          terminalIds.value.push(activeConnectionId.value)
          log.debug(`更新终端ID列表: ${JSON.stringify(terminalIds.value)}`)
        }

        // 记录终端切换
        log.debug(`终端切换: undefined -> ${activeConnectionId.value}`)

        // 如果有DOM元素引用，尝试初始化终端
        if (terminalRefs.value[activeConnectionId.value]) {
          initTerminal(activeConnectionId.value, terminalRefs.value[activeConnectionId.value])
        }

        // 延迟聚焦当前活动终端（组件挂载时）
        setTimeout(() => {
          if (terminalStore.hasTerminal(activeConnectionId.value)) {
            log.debug(`组件挂载后聚焦终端: ${activeConnectionId.value}`)
            focusTerminal(activeConnectionId.value)
          }
        }, 300)

        // 触发终端状态刷新事件，同步工具栏状态
        window.dispatchEvent(new CustomEvent('terminal:refresh-status', {
          detail: {
            sessionId: activeConnectionId.value,
            forceShow: true
          }
        }));
      }
    });

    onActivated(() => {
      log.debug('终端视图已激活');
      // 当组件激活时，自动聚焦当前活动终端
      if (activeConnectionId.value && terminalStore.hasTerminal(activeConnectionId.value)) {
        setTimeout(() => {
          log.debug(`组件激活后聚焦终端: ${activeConnectionId.value}`)
          focusTerminal(activeConnectionId.value)
        }, 100)
      }
    });

    onDeactivated(() => {
      log.debug('终端视图已失活');
      // 可以在这里添加失活时的处理逻辑
    });

    // 声明ResizeObserver变量
    let resizeObserver = null;

    // 声明清理函数变量
    let cleanupEvents = null;
    let cleanupSSHFailureEvents = null;

    // 处理终端管理事件
    const handleTerminalEvent = (event) => {
      const { command } = event.detail

      if (command === 'resize-all') {
        terminalIds.value.forEach(id => {
          terminalStore.fitTerminal(id)
        })
      } else if (command === 'clear-active') {
        terminalStore.clearTerminal(activeConnectionId.value)
      } else if (command === 'focus') {
        terminalStore.focusTerminal(activeConnectionId.value)
      }
    }

    window.addEventListener('terminal-command', handleTerminalEvent)

    // 在组件卸载时清理
    onBeforeUnmount(() => {
      // 移除事件监听
      if (cleanupEvents) cleanupEvents()
      if (cleanupSSHFailureEvents) cleanupSSHFailureEvents()
      if (cleanupMonitoringListener) cleanupMonitoringListener()
      window.removeEventListener('terminal-command', handleTerminalEvent)
      window.removeEventListener('terminal:session-change', handleSessionChange)
      window.removeEventListener('terminal-theme-update', handleTerminalThemeUpdate)
      window.removeEventListener('terminal-settings-updated', handleTerminalSettingsUpdate)
      // window.removeEventListener('terminal:refresh-status', handleTerminalRefreshStatus)
      document.removeEventListener('keydown', handleGlobalKeydown, true)

      // 安全地断开ResizeObserver
      if (resizeObserver) {
        resizeObserver.disconnect()
        resizeObserver = null
      }

      // 清理自动完成服务
      terminalAutocompleteService.destroy()

      // 清理所有状态管理器实例
      Object.keys(terminalStateManagers.value).forEach(termId => {
        cleanupTerminalStateManager(termId)
      })

      // 保持会话不关闭，但停止特定组件的监听
      log.debug('终端组件卸载，保留会话')
    })
    
    // 移除重复的事件处理函数 - 统一使用 terminal-status-update 事件系统
    // 原 handleTerminalRefreshStatus 函数已删除，避免与 terminal-status-update 事件重复处理
    
    // 添加处理新会话事件的函数
    const handleNewSession = (event) => {
      if (!event.detail || !event.detail.sessionId) return;
      
      const { sessionId, isNewCreation } = event.detail;
      log.debug(`收到新会话事件: ${sessionId}, 是否新创建: ${isNewCreation}`);
      
      if (isNewCreation) {
        // 检查是否已经有正在创建中的SSH会话或已存在的会话
        const hasExistingSession = terminalStore.hasTerminalSession(sessionId);
        const isCreating = terminalStore.isSessionCreating(sessionId);
        
        if (hasExistingSession || isCreating) {
          log.debug(`终端${sessionId}已有会话或正在创建中，跳过重复初始化`);
          return;
        }
        
        // 确保清理旧的状态
        // 从终端ID列表中移除重复的ID
        terminalIds.value = terminalIds.value.filter(id => id !== sessionId);
        
        // 清理所有状态
        delete terminalInitialized.value[sessionId];
        delete terminalInitializingStates.value[sessionId];
        delete terminalConnectingStates.value[sessionId];
        delete terminalSized.value[sessionId];
        
        // 清理引用
        if (terminalRefs.value[sessionId]) {
          terminalRefs.value[sessionId] = null;
          delete terminalRefs.value[sessionId];
        }
        
        // 清理定时器
        if (resizeDebounceTimers.value[sessionId]) {
          clearTimeout(resizeDebounceTimers.value[sessionId]);
          delete resizeDebounceTimers.value[sessionId];
        }
        
        // 清理终端存储中的连接（如果有）
        if (terminalStore.hasTerminal(sessionId)) {
          log.debug(`检测到新创建的终端[${sessionId}]但存在旧终端，断开旧连接`);
          terminalStore.disconnectTerminal(sessionId)
            .catch(error => log.error(`清理旧终端连接失败: ${error.message}`));
        }
        
        // 添加到终端ID列表，确保初始化
        terminalIds.value.push(sessionId);
        log.debug(`为新会话[${sessionId}]重置状态，准备初始化`);
      }
    };
    
    // SSH连接成功事件处理已移至 TerminalToolbar.vue 组件中统一管理
    // 这里移除了重复的死代码，避免混淆和潜在的冲突
    
    // 添加终端状态更新事件监听
    const setupTerminalEvents = () => {
      // 监听终端状态变化事件
      const handleTerminalStatusUpdate = (event) => {
        const { terminalId, status, isNew, sessionId } = event.detail

        // 优化：只在关键状态变化时记录日志，减少噪音
        if (status === 'ready' || status === 'error') {
          log.debug(`收到终端状态刷新事件: ${terminalId}, ${status}, 新创建=${isNew || false}`)
        }
        
        // 根据状态更新UI
        if (status === 'initializing') {
          terminalInitializingStates.value[terminalId] = true
          terminalConnectingStates.value[terminalId] = true
          
          // 如果是新会话，确保添加到终端ID列表
          if (isNew && !terminalIds.value.includes(terminalId)) {
            terminalIds.value.push(terminalId)
            log.debug(`更新终端ID列表: ${JSON.stringify(terminalIds.value)}`)
          }
        } else if (status === 'ready') {
          // 终端已就绪
          terminalInitialized.value[terminalId] = true
          terminalInitializingStates.value[terminalId] = false
          terminalConnectingStates.value[terminalId] = false
          
          // 确保终端显示独立状态
          // 降低日志频率 - 状态独立确保是常规操作
          // log.debug(`正在确保终端[${terminalId}]的状态独立`)
          
          if (isNew) {
            log.debug(`强制显示终端: ${terminalId}`)
          }
          
          // 终端就绪后，尝试聚焦终端
          nextTick(() => {
            // 如果这是当前活动的终端，自动聚焦
            if (isActiveTerminal(terminalId)) {
              // 降低日志级别 - 聚焦是常规操作
              log.debug(`终端 ${terminalId} 就绪，自动聚焦`)

              // 先强制应用光标样式
              forceCursorStyle(terminalId)

              // 然后聚焦终端
              focusTerminal(terminalId)

              // 确保终端大小正确
              setTimeout(() => {
                resizeTerminal(terminalId)
                // 调整大小后再次确保光标样式正确
                forceCursorStyle(terminalId)
              }, 100)
            }
          })
          
          // 收到连接成功事件后，如果是当前激活的终端，更新标题等信息
          if (isActiveTerminal(terminalId) && sessionId) {
            // 获取连接信息
            let connection = null
            if (userStore.isLoggedIn) {
              connection = connectionStore.getConnectionById(terminalId)
            } else {
              connection = localConnectionsStore.getConnectionById(terminalId)
            }
            
            if (connection) {
              // 更新标题和标签页标题
              title.value = `${connection.name || connection.host} - 终端`
              const tabTitle = `${connection.username}@${connection.host}`
              tabStore.updateTabTitle('/terminal', tabTitle)
              
              // 通知会话存储这是当前活动会话
              sessionStore.setActiveSession(terminalId)
              log.debug(`当前活动会话ID已更新: ${terminalId}`)
            }
          }
        } else if (status === 'error') {
          // 终端初始化失败
          terminalInitializingStates.value[terminalId] = false
          terminalConnectingStates.value[terminalId] = false
          terminalInitialized.value[terminalId] = false
          
          // 直接清理本地状态
          delete terminalRefs.value[terminalId]
          
          // 从终端ID列表中移除
          terminalIds.value = terminalIds.value.filter(id => id !== terminalId)
          
          // 清理会话存储中的状态
          if (sessionStore.getSession(terminalId)) {
            sessionStore.setActiveSession(null)
          }
          
          // 仅在会话实际存在的情况下尝试断开连接
          if (terminalStore.hasTerminalSession(terminalId)) {
            terminalStore.disconnectTerminal(terminalId)
              .finally(() => {
                // 导航回连接配置界面
                router.push('/connections/new')
              })
          } else {
            // 如果会话不存在，直接返回连接配置界面
            router.push('/connections/new')
          }
        }
      }
      
      // 添加SSH会话创建失败事件监听
      const handleSessionCreationFailed = (event) => {
        if (!event.detail) return
        
        const { sessionId, terminalId, error } = event.detail
        log.debug(`收到SSH会话创建失败事件: 会话ID=${sessionId}, 终端ID=${terminalId || '未知'}, 错误=${error}`)
        
        // 如果有终端ID，清理相关状态
        if (terminalId) {
          // 清理终端状态
          terminalInitializingStates.value[terminalId] = false
          terminalConnectingStates.value[terminalId] = false
          terminalInitialized.value[terminalId] = false
          
          // 清理引用
          if (terminalRefs.value[terminalId]) {
            terminalRefs.value[terminalId] = null
            delete terminalRefs.value[terminalId]
          }
          
          // 从终端ID列表中移除
          terminalIds.value = terminalIds.value.filter(id => id !== terminalId)
          
          // 清理会话存储
          if (sessionStore.getSession(terminalId)) {
            sessionStore.setActiveSession(null)
          }
          
          // 如果是当前活动连接，显示错误并导航回连接配置界面
          if (terminalId === activeConnectionId.value) {
            // 提取简洁错误信息，避免重复
            let errorMessage = error || '服务器无响应';
            // 如果错误消息包含"SSH连接失败:"，则删除这个前缀
            errorMessage = errorMessage.replace(/SSH连接失败:\s*/g, '');
            
            // 翻译常见的英文错误消息为中文
            const errorTranslations = {
              'All configured authentication methods failed': '所有认证方式均失败，请检查用户名和密码',
              'Authentication failed': '认证失败，请检查用户名和密码',
              'Connection refused': '连接被拒绝，请检查服务器地址和端口',
              'Connection timed out': '连接超时，请检查网络和服务器状态',
              'Host not found': '无法找到主机，请检查服务器地址',
              'Network error': '网络错误，请检查网络连接',
              'Permission denied': '权限被拒绝，请检查用户名和密码',
              'Server unexpectedly closed connection': '服务器意外关闭连接',
              'Unable to connect': '无法连接到服务器',
              'Connection failed': '连接失败',
              'Invalid username or password': '用户名或密码错误'
            };
            
            // 寻找完全匹配的错误消息进行翻译
            if (errorTranslations[errorMessage]) {
              errorMessage = errorTranslations[errorMessage];
            } else {
              // 寻找部分匹配的错误消息
              for (const [engError, cnError] of Object.entries(errorTranslations)) {
                if (errorMessage.includes(engError)) {
                  errorMessage = cnError;
                  break;
                }
              }
            }
            
            // 显示优化后的错误消息
            ElMessage.error(`连接失败: ${errorMessage}`);

            // 调用页签回滚逻辑
            if (tabStore.connectionFailed) {
              tabStore.connectionFailed(terminalId, errorMessage)
            }

            // 发送自定义事件，通知终端清理完成
            window.dispatchEvent(new CustomEvent('ssh-cleanup-done', {
              detail: { connectionId: terminalId }
            }))

            // 延迟导航，确保清理完成（如果页签回滚没有处理导航）
            setTimeout(() => {
              // 检查当前路由，如果还在终端页面则导航回连接配置
              if (router.currentRoute.value.path.includes('/terminal/')) {
                router.push('/connections/new')
              }
            }, 100)
          }
        }
      }
      
      // 添加事件监听
      window.addEventListener('terminal-status-update', handleTerminalStatusUpdate)
      window.addEventListener('ssh-session-creation-failed', handleSessionCreationFailed)
      
      // 返回清理函数
      return () => {
        window.removeEventListener('terminal-status-update', handleTerminalStatusUpdate)
        window.removeEventListener('ssh-session-creation-failed', handleSessionCreationFailed)
      }
    }
    
    // 监听URL路径和参数变化
    watch(
      () => [route.params.id, route.path],
      ([newId, newPath]) => {
        // 如果路径不是终端相关路径，直接返回
        if (!newPath.includes('/terminal')) {
          return
        }
        
        // 获取最新的连接ID
        const currentId = activeConnectionId.value
        
        // 如果路由参数不是ID，则使用会话存储ID
        const routeId = newId || sessionStore.getActiveSession()
        
        if (routeId && routeId !== currentId) {
          log.debug(`[Terminal] 会话切换: ${currentId} -> ${routeId}`)

          // 如果终端ID不在列表中，则添加
          if (!terminalIds.value.includes(routeId)) {
            terminalIds.value.push(routeId)
            log.debug(`[Terminal] 终端列表更新: ${terminalIds.value.length}个终端`)
          }
          
          // 通知会话存储更新活动会话
          sessionStore.setActiveSession(routeId)
          
          // 如果已有终端引用，尝试初始化
          if (terminalRefs.value[routeId]) {
            log.debug(`切换到终端: ${routeId}`)
            // 这里不需要再重复整个初始化流程，只需检查并确保显示
            if (!terminalInitialized.value[routeId]) {
              log.debug(`终端 ${routeId} 不存在，等待初始化完成`)
              initTerminal(routeId, terminalRefs.value[routeId])
            }
          }
        }
      },
      { immediate: true }
    )
    
    // 自动完成处理函数
    const handleAutocompleteSelect = (suggestion) => {
      try {
        const activeId = activeConnectionId.value
        if (!activeId) return

        const terminal = terminalStore.getTerminal(activeId)
        if (!terminal) return

        terminalAutocompleteService.selectSuggestion(suggestion, terminal)
        autocomplete.value.visible = false

        log.debug('选择自动完成建议:', suggestion.text)
      } catch (error) {
        log.error('处理自动完成选择失败:', error)
      }
    }

    const handleAutocompleteClose = () => {
      autocomplete.value.visible = false
    }

    // 设置自动完成服务回调
    const setupAutocompleteCallbacks = () => {
      terminalAutocompleteService.setCallbacks({
        onSuggestionsUpdate: (suggestions, position) => {
          autocomplete.value.suggestions = suggestions
          autocomplete.value.position = position
          autocomplete.value.visible = suggestions.length > 0
        }
      })
    }



    // 监听用户登录状态变化，处理自动补全
    watch(
      () => userStore.isLoggedIn,
      (newLoginStatus, oldLoginStatus) => {
        // 优化：只在有意义的状态变化时记录日志，避免初始化期间的噪音
        if (oldLoginStatus !== undefined && oldLoginStatus !== newLoginStatus) {
          log.debug(`用户登录状态变化: ${oldLoginStatus} -> ${newLoginStatus}`)
        }

        // 如果用户登出，立即隐藏自动补全建议
        if (oldLoginStatus && !newLoginStatus) {
          log.debug('用户登出，隐藏自动补全建议')
          autocomplete.value.visible = false
          autocomplete.value.suggestions = []
          // 重置自动补全服务状态
          terminalAutocompleteService.reset()
        }

        // 如果用户登录，可以在这里做一些初始化工作
        if (!oldLoginStatus && newLoginStatus) {
          log.debug('用户登录，自动补全功能已启用')
        }
      },
      { immediate: false } // 不需要立即执行，只监听变化
    )

    // 键盘事件处理
    const handleGlobalKeydown = (event) => {
      if (autocompleteRef.value && autocomplete.value.visible) {
        // 检查是否是需要特殊处理的键
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown' ||
            event.key === 'Tab' || event.key === 'Escape') {
          // 阻止事件传播和默认行为
          event.preventDefault()
          event.stopPropagation()
          event.stopImmediatePropagation()

          // 调用自动补全组件的键盘处理
          autocompleteRef.value.handleKeydown(event)
          return false
        }

        // 对于Enter键，调用处理函数，根据返回值决定是否阻止传播
        if (event.key === 'Enter') {
          const handled = autocompleteRef.value.handleKeydown(event)
          if (handled) {
            // 如果自动补全处理了回车键（有选中项），阻止事件传播
            event.preventDefault()
            event.stopPropagation()
            event.stopImmediatePropagation()
            return false
          }
          // 如果没有选中项，让终端正常处理回车键
          return
        }

        // 对于其他键，也调用处理函数但不阻止传播
        autocompleteRef.value.handleKeydown(event)
      }
    }

    // 添加SSH连接失败处理事件
    const setupSSHFailureHandler = () => {
      const handleSSHConnectionFailed = (event) => {
        if (!event.detail) return
        
        const { connectionId, error, message } = event.detail
        log.debug(`收到全局SSH连接失败事件: ${connectionId}, 错误: ${error}`)
        
        if (!connectionId) return
        
        // 清理本地状态
        if (terminalInitialized.value[connectionId]) {
          delete terminalInitialized.value[connectionId]
        }
        if (terminalInitializingStates.value[connectionId]) {
          delete terminalInitializingStates.value[connectionId]
        }
        if (terminalConnectingStates.value[connectionId]) {
          delete terminalConnectingStates.value[connectionId]
        }
        if (terminalRefs.value[connectionId]) {
          delete terminalRefs.value[connectionId]
        }
        
        // 提取简洁错误信息，避免重复的"SSH连接失败"前缀
        let errorMessage = message || error || '服务器无响应';
        // 如果错误消息包含"SSH连接失败:"，则删除这个前缀
        errorMessage = errorMessage.replace(/SSH连接失败:\s*/g, '');
        
        // 翻译常见的英文错误消息为中文
        const errorTranslations = {
          'All configured authentication methods failed': '所有认证方式均失败，请检查用户名和密码',
          'Authentication failed': '认证失败，请检查用户名和密码',
          'Connection refused': '连接被拒绝，请检查服务器地址和端口',
          'Connection timed out': '连接超时，请检查网络和服务器状态',
          'Host not found': '无法找到主机，请检查服务器地址',
          'Network error': '网络错误，请检查网络连接',
          'Permission denied': '权限被拒绝，请检查用户名和密码',
          'Server unexpectedly closed connection': '服务器意外关闭连接',
          'Unable to connect': '无法连接到服务器',
          'Connection failed': '连接失败',
          'Invalid username or password': '用户名或密码错误'
        };
        
        // 寻找完全匹配的错误消息进行翻译
        if (errorTranslations[errorMessage]) {
          errorMessage = errorTranslations[errorMessage];
        } else {
          // 寻找部分匹配的错误消息
          for (const [engError, cnError] of Object.entries(errorTranslations)) {
            if (errorMessage.includes(engError)) {
              errorMessage = cnError;
              break;
            }
          }
        }
        
        // 显示优化后的错误消息
        ElMessage.error(`连接失败: ${errorMessage}`);

        // 从终端ID列表中移除
        terminalIds.value = terminalIds.value.filter(id => id !== connectionId)

        // 清理会话存储
        if (sessionStore.getSession(connectionId)) {
          sessionStore.setActiveSession(null)
        }

        // 调用页签回滚逻辑
        if (tabStore.connectionFailed) {
          tabStore.connectionFailed(connectionId, errorMessage)
        }

        // 导航回连接配置界面（如果页签回滚没有处理导航）
        if (connectionId === activeConnectionId.value) {
          // 延迟导航，让页签回滚逻辑先执行
          setTimeout(() => {
            // 检查当前路由，如果还在终端页面则导航回连接配置
            if (router.currentRoute.value.path.includes('/terminal/')) {
              router.push('/connections/new')
            }
          }, 100)
        }
      }
      
      // 添加全局事件监听
      window.addEventListener('ssh-connection-failed', handleSSHConnectionFailed)
      
      // 返回清理函数
      return () => {
        window.removeEventListener('ssh-connection-failed', handleSSHConnectionFailed)
      }
    }

    // ===== AI输入栏相关方法 =====

    /**
     * 检查是否应该显示AI输入栏
     * @param {string} termId 终端ID
     * @returns {boolean} 是否显示AI输入栏
     */
    const shouldShowAIInputBar = (termId) => {
      if (!termId) return false

      // 检查AI服务是否可用
      const aiService = getAIService()
      if (!aiService || !aiService.isEnabled) return false

      // 检查终端是否已连接
      if (!terminalStore.hasTerminal(termId)) return false

      // 检查用户设置（可以添加开关控制）
      return aiInputBarStates.value[termId] !== false // 默认显示
    }

    /**
     * 获取AI服务实例
     * @returns {Object} AI服务实例
     */
    const getAIService = () => {
      try {
        return aiService
      } catch (error) {
        console.error('获取AI服务失败:', error)
        return null
      }
    }

    /**
     * 处理AI响应
     * @param {Object} response AI响应数据
     */
    const handleAIResponse = (response) => {
      try {
        if (response.success) {
          // 将AI响应直接显示在终端中
          displayAIResponseInTerminal(response)
          log.info('AI响应成功', response)
        } else {
          // 处理错误响应
          displayAIResponseInTerminal({
            ...response,
            content: `❌ 错误: ${response.content}`,
            mode: 'error'
          })
          log.error('AI响应失败', response)
        }
      } catch (error) {
        log.error('处理AI响应失败', { error: error.message })
      }
    }

    /**
     * 在终端中显示AI响应
     * @param {Object} response AI响应数据
     */
    const displayAIResponseInTerminal = (response) => {
      try {
        const terminalId = activeConnectionId.value
        if (!terminalId) return

        const terminal = terminalStore.getTerminal(terminalId)
        if (!terminal) return

        // 获取模式图标和标题
        const modeIcons = {
          'chat': '💡',
          'agent': '🤖',
          'error': '❌'
        }
        const modeTitles = {
          'chat': 'AI回答',
          'agent': 'Agent分析',
          'error': '错误'
        }

        const icon = modeIcons[response.mode] || '💡'
        const title = modeTitles[response.mode] || 'AI响应'

        // 在终端中显示响应
        terminal.writeln('\r\n')
        terminal.writeln(`╭─ ${icon} ${title} ─────────────────────────────────────────╮`)

        // 处理响应内容，提取命令并添加运行提示
        const { content: processedContent, commands } = processAIResponseContent(response.content, terminalId)

        // 分行显示内容
        const lines = processedContent.split('\n')
        lines.forEach(line => {
          if (line.trim()) {
            terminal.writeln(`│ ${line}`)
          } else {
            terminal.writeln('│')
          }
        })

        // 如果有命令，显示执行提示
        if (commands && commands.length > 0) {
          terminal.writeln('│')
          terminal.writeln('│ 💡 提示: 复制上述命令到终端执行，或使用执行模式快速运行')
        }

        terminal.writeln('╰─────────────────────────────────────────────────────────╯')
        terminal.writeln('\r\n')

      } catch (error) {
        log.error('在终端显示AI响应失败', { error: error.message })
      }
    }

    /**
     * 处理AI响应内容，为命令添加可执行的按钮
     * @param {string} content 原始内容
     * @param {string} terminalId 终端ID
     * @returns {Object} {content: 处理后的内容, commands: 找到的命令列表}
     */
    const processAIResponseContent = (content, terminalId) => {
      try {
        // 匹配代码块中的命令 (```bash 或 ``` 包围的内容)
        const codeBlockRegex = /```(?:bash|shell|sh)?\n?([\s\S]*?)```/g
        // 匹配行内代码 (`command`)
        const inlineCodeRegex = /`([^`\n]+)`/g

        let processedContent = content
        const commandsFound = []
        let commandIndex = 0

        // 处理代码块
        processedContent = processedContent.replace(codeBlockRegex, (_, code) => {
          const commands = code.trim().split('\n').filter(line => line.trim())
          const processedCommands = commands.map(cmd => {
            const cleanCmd = cmd.trim()
            if (cleanCmd && !cleanCmd.startsWith('#') && !cleanCmd.startsWith('//')) {
              const cmdId = `ai_cmd_${terminalId}_${commandIndex++}`
              commandsFound.push({ id: cmdId, command: cleanCmd })
              return `${cleanCmd} [执行 ⚡]`
            }
            return cleanCmd
          }).join('\n')

          return `\n${processedCommands}\n`
        })

        // 处理行内代码（简单命令）
        processedContent = processedContent.replace(inlineCodeRegex, (match, code) => {
          const cleanCmd = code.trim()
          // 判断是否是命令（包含常见命令关键词）
          const commandKeywords = ['ls', 'cd', 'mkdir', 'rm', 'cp', 'mv', 'cat', 'grep', 'find', 'ps', 'top', 'docker', 'git', 'npm', 'yarn', 'sudo', 'chmod', 'chown', 'systemctl', 'service', 'wget', 'curl', 'apt', 'yum', 'pip', 'node']
          const isCommand = commandKeywords.some(keyword => cleanCmd.startsWith(keyword))

          if (isCommand) {
            const cmdId = `ai_cmd_${terminalId}_${commandIndex++}`
            commandsFound.push({ id: cmdId, command: cleanCmd })
            return `${cleanCmd} [执行 ⚡]`
          }
          return match
        })

        // 存储命令映射，用于后续点击处理
        if (commandsFound.length > 0) {
          if (!window.aiCommandMap) {
            window.aiCommandMap = new Map()
          }
          commandsFound.forEach(({ id, command }) => {
            window.aiCommandMap.set(id, { command, terminalId })
          })
        }

        return {
          content: processedContent,
          commands: commandsFound
        }
      } catch (error) {
        log.error('处理AI响应内容失败', { error: error.message })
        return {
          content: content,
          commands: []
        }
      }
    }

    /**
     * 处理AI模式变化
     * @param {string} mode 新的AI模式
     */
    const handleAIModeChange = (mode) => {
      try {
        log.debug('AI模式切换', { mode })
      } catch (error) {
        log.error('处理AI模式变化失败', { error: error.message })
      }
    }

    /**
     * 处理AI输入框获得焦点
     */
    const handleAIInputFocus = () => {
      try {
        log.debug('AI输入框获得焦点')
        // 可以在这里添加焦点处理逻辑
      } catch (error) {
        log.error('处理AI输入框焦点失败', { error: error.message })
      }
    }

    /**
     * 处理AI输入框失去焦点
     */
    const handleAIInputBlur = () => {
      try {
        log.debug('AI输入框失去焦点')
        // 可以在这里添加失焦处理逻辑
      } catch (error) {
        log.error('处理AI输入框失焦失败', { error: error.message })
      }
    }

    /**
     * 处理执行命令
     * @param {Object} data 命令数据 {terminalId, command}
     */
    const handleExecuteCommand = (data) => {
      try {
        const { terminalId, command } = data

        log.debug('执行命令', { terminalId, command })

        // 获取SSH会话ID
        const sessionId = terminalStore.sessions[terminalId]
        if (!sessionId) {
          log.error('未找到SSH会话ID', { terminalId })
          return
        }

        // 通过SSH服务获取会话
        const session = sshService.sessions.get(sessionId)
        if (!session) {
          log.error('未找到SSH会话', { sessionId })
          return
        }

        // 检查WebSocket连接状态
        if (!session.socket || session.socket.readyState !== WebSocket.OPEN) {
          log.error('SSH连接未就绪', { sessionId, readyState: session.socket?.readyState })
          return
        }

        // 检查SSH连接状态
        if (session.connectionState?.status !== 'connected') {
          log.error('SSH会话未连接', { sessionId, status: session.connectionState?.status })
          return
        }

        // 发送命令到SSH会话
        sshService._processTerminalInput(session, command + '\r')

        log.info('命令已发送到SSH会话', { terminalId, sessionId, command })
      } catch (error) {
        log.error('执行命令失败', { error: error.message })
      }
    }





    return {
      terminalIds,
      title,
      status,
      isConnectingInProgress,
      terminalBg,
      terminalBgStyle,
      isActiveTerminal,
      getTerminalStyle,
      setTerminalRef,
      terminalInitialized,
      terminalHasBackground,
      sftpPanelWidth,
      updateTerminalIds,
      shouldShowConnectingAnimation,
      toggleSftpPanel,
      toggleMonitoringPanel,
      // 监控面板相关方法
      shouldShowMonitoringPanel,
      shouldShowDesktopMonitoringPanel,
      shouldShowMobileMonitoringDrawer,
      isMonitoringPanelVisible,
      getMonitoringData,
      hideMonitoringPanel,
      hideMobileMonitoringDrawer,
      updateMobileDrawerVisibility,
      // 状态管理器相关方法
      getTerminalStateManager,
      cleanupTerminalStateManager,
      // 每个终端独立的火箭动画相关
      shouldShowTerminalConnectingAnimation,
      getTerminalRocketPhase,
      handleTerminalAnimationComplete,
      // 自动完成相关
      autocomplete,
      autocompleteRef,
      handleAutocompleteSelect,
      handleAutocompleteClose,
      // AI输入栏相关
      shouldShowAIInputBar,
      getAIService,
      handleAIResponse,
      handleAIModeChange,
      handleAIInputFocus,
      handleAIInputBlur,
      handleExecuteCommand,
      isMobile
    }
  }
}
</script>

<style scoped>
.terminal-container {
  height: 100%;
  width: 100%;
  position: relative;
  background-color: var(--color-bg-page);
  overflow: hidden;
  /* 添加3D渲染上下文，减少层间闪烁 */
  transform-style: preserve-3d;
  perspective: 1000px;
  /* 对整体容器加渲染合成*/
  will-change: contents;
  contain: layout size paint;
  /* 添加容器定位 */
  display: flex;
  flex-direction: column;
  /* 添加主题切换过渡效果 */
  transition:
    background-color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    background 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    border-color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    box-shadow 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.terminals-wrapper {
  position: relative;
  height: 100%;
  width: 100%;
  /* 预先创建堆叠上下文 */
  isolation: isolate;
  /* 添加flex布局 */
  flex: 1;
  display: flex;
  flex-direction: column;
  /* 添加主题切换过渡效果 */
  transition:
    background-color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    background 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    border-color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    box-shadow 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.terminal-content-wrapper {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  /* 完全不透明，避免透明度变化导致闪烁 */
  opacity: 1;
  /* 去除clip-path和transition */
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  /* 默认隐藏所有终端 */
  visibility: hidden;
  /* 内容渲染优化 */
  contain: strict;
  /* 降低失活终端的合成成本 */
  content-visibility: auto;
  /* 启用缓存，提高切换性能 */
  contain-intrinsic-size: 100%;
  /* 添加flex布局使工具栏和终端内容能垂直排列 */
  display: flex;
  flex-direction: column;
  /* 添加主题切换过渡效果 */
  transition:
    background-color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    background 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    border-color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    box-shadow 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.terminal-content-wrapper.terminal-active {
  z-index: 5;
  /* 只显示活动终端 */
  visibility: visible;
  /* 使活动终端能接收输入 */
  pointer-events: auto;
  /* 优先级最高 */
  content-visibility: visible;
}

.terminal-content-wrapper:not(.terminal-active) {
  z-index: 1;
  /* 非活动终端不接收输入 */
  pointer-events: none;
}

.terminal-individual-toolbar {
  flex-shrink: 0;
  z-index: 10;
  height: 40px; /* 确保工具栏高度固定为40px */
}

.terminal-main-area {
  flex: 1;
  display: flex;
  flex-direction: row;
  height: calc(100% - 40px); /* 减去工具栏高度 */
  overflow: hidden;
}

.terminal-monitoring-panel {
  flex-shrink: 0;
  z-index: 9;
  width: 320px; /* 增加宽度以适应内容 */
  max-width: 35vw; /* 最大不超过视口宽度的35% */
  height: 100%;
  overflow: hidden;
  border-right: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.1));
}

/* 移除外层动画CSS，改为在ResponsiveMonitoringPanel内部控制 */





/* 右侧内容区域：终端 + AI输入栏 */
.terminal-right-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.terminal-right-area.with-monitoring-panel {
  /* 当显示监控面板时，右侧区域自动调整宽度 */
  width: calc(100% - 320px); /* 减去监控面板宽度 */
}

.terminal-content-padding {
  flex: 1;
  box-sizing: border-box;
  width: 100%;
  position: relative;
  overflow: visible;
  padding: 0;
  min-height: 0; /* 允许flex子项收缩 */
  /* 添加主题切换过渡效果 */
  transition:
    background-color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    background 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    border-color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    box-shadow 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

/* AI输入栏区域 */
.terminal-ai-input-area {
  flex-shrink: 0;
  height: auto;
  min-height: 80px;
  max-height: 200px;
  background: transparent;
  z-index: 10;
  overflow: hidden;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .terminal-main-area {
    flex-direction: row; /* 移动端保持水平布局，因为不再显示侧边监控面板 */
  }

  .terminal-monitoring-panel {
    /* 移动端隐藏桌面端监控面板，使用抽屉代替 */
    display: none;
  }

  .terminal-right-area {
    width: 100%; /* 移动端占满全宽 */
    height: 100%; /* 移动端占满全高 */
  }

  .terminal-right-area.with-monitoring-panel {
    /* 移动端即使有监控面板也占满全宽，因为使用抽屉模式 */
    width: 100%;
    height: 100%;
  }

  .terminal-ai-input-area {
    /* 移动端AI输入栏调整 */
    min-height: 70px;
    max-height: 150px;
  }
}

@media (max-width: 480px) {
  .terminal-monitoring-panel {
    /* 小屏幕也隐藏桌面端监控面板 */
    display: none;
  }

  .terminal-right-area.with-monitoring-panel {
    /* 小屏幕占满全高 */
    height: 100%;
  }

  .terminal-ai-input-area {
    /* 小屏幕AI输入栏进一步调整 */
    min-height: 60px;
    max-height: 120px;
  }
}

.terminal-content {
  height: calc(100% - 40px); /* 减去margin空间 */
  width: calc(100% - 20px); /* 减去margin空间 */
  position: relative;
  margin: 20px 0 20px 20px; /* 使用margin替代padding */
  /* 确保容器有明确的尺寸 */
  box-sizing: border-box;
  overflow: hidden;
  /* 添加主题切换过渡效果 */
  transition:
    background-color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    background 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    border-color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    box-shadow 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}
.connecting-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  background-color: transparent;
  /* z-index: 10; */
  transition: opacity 0.3s ease-in-out;
}

.connecting-overlay.fade-out {
  opacity: 0;
  pointer-events: none;
}

/* 添加全局样式修复，确保xterm.js正常工作 */
:deep(.xterm) {
  height: 100% !important;
  width: 100% !important; /* 修改为100%，不要超出容器 */
  position: relative; /* 添加相对定位 */
  box-sizing: border-box;
  /* 为xterm.js背景色添加过渡效果 */
  transition: background-color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94) !important;
}

:deep(.xterm-viewport) {
  overflow-y: auto !important;
  overflow-x: hidden;
  /* position: absolute;
  right: 0;
  top: -20px !important;
  bottom: -20px !important;
  height: calc(100% + 40px);  */
  /* 为xterm视口背景色添加过渡效果 */
  transition: background-color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94) !important;
}

/* 添加Webkit浏览器的滚动条样式 */
:deep(.xterm-viewport::-webkit-scrollbar) {
  width: 5px; /* 减小滚动条宽度 */
  height: 0; /* 确保横向滚动条不显示 */
}

:deep(.xterm-viewport::-webkit-scrollbar-thumb) {
  background-color: rgba(255, 255, 255, 0.3);
  border-radius: 10px; /* 设置滚动条圆角 */
  border: none; /* 移除边框 */
}

:deep(.xterm-viewport::-webkit-scrollbar-thumb:hover) {
  background-color: rgba(255, 255, 255, 0.5);
}

:deep(.xterm-screen) {
  width: 100%;
  height: 100%;
  /* 为xterm屏幕背景色添加过渡效果 */
  transition: background-color 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94) !important;
}

/* 确保光标样式立即生效，避免闪烁 */
:deep(.xterm-cursor-layer) {
  transition: none !important;
}

:deep(.xterm-cursor) {
  transition: none !important;
}

/* 强制应用光标样式 */
:deep(.xterm.focus .xterm-cursor) {
  transition: none !important;
}
</style> 