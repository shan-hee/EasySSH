<template>
  <div class="terminal-container">
    <!-- 彩虹加载动画，在连接建立之前显示 -->
    <div v-show="shouldShowConnectingAnimation" class="connecting-overlay" :class="{'fade-out': !shouldShowConnectingAnimation}">
      <RainbowLoader />
    </div>

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
        <!-- 为每个终端添加独立的工具栏 -->
        <div class="terminal-individual-toolbar">
          <TerminalToolbar 
            :has-background="terminalHasBackground"
            :active-session-id="termId"
            @toggle-sftp-panel="toggleSftpPanel"
            @toggle-monitoring-panel="toggleMonitoringPanel"
          />
        </div>
        <div class="terminal-content-padding">
          <div 
            :ref="el => setTerminalRef(el, termId)" 
            class="terminal-content"
            :data-terminal-id="termId"
          ></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, onMounted, onBeforeUnmount, nextTick, onUnmounted, watch, computed, onActivated, onDeactivated } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useConnectionStore } from '../../store/connection'
import { useLocalConnectionsStore } from '../../store/localConnections'
import { useUserStore } from '../../store/user'
import { useTabStore } from '../../store/tab'
import { useTerminalStore } from '../../store/terminal'
import terminalService from '../../services/terminal'
import sshService from '../../services/ssh/index'
import RainbowLoader from '../../components/common/RainbowLoader.vue'
import { useSettingsStore } from '../../store/settings'
// 导入终端工具栏组件
import TerminalToolbar from '../../components/terminal/TerminalToolbar.vue'
// 导入日志服务
import log from '../../services/log'

// 导入会话存储
import { useSessionStore } from '../../store/session'

export default {
  name: 'Terminal',
  components: {
    RainbowLoader,
    TerminalToolbar // 注册工具栏组件
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
    const settingsStore = useSettingsStore()
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
    
    // 终端背景设置
    const terminalBg = ref({
      enabled: false,
      url: '',
      opacity: 0.5,
      mode: 'cover'
    })
    
    // 计算属性：是否应该显示彩虹加载动画
    const shouldShowConnectingAnimation = computed(() => {
      const activeId = activeConnectionId.value;
      if (!activeId) return true; // 如果没有活动连接ID，则显示加载动画
      
      // 检查活动终端是否正在连接中
      if (terminalConnectingStates.value[activeId]) return true;
      
      // 检查活动终端是否在初始化中
      if (terminalInitializingStates.value[activeId]) return true;
      
      // 检查活动终端是否已初始化
      if (!terminalInitialized.value[activeId]) return true;
      
      return false;
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
    
    // 初始化特定ID的终端
    const initTerminal = async (termId, container) => {
      try {
        if (!termId || !container) {
          log.error('初始化终端失败: 缺少ID或容器')
          return false
        }
        
        // 使用每个终端特定的初始化状态标志
        if (terminalInitializingStates.value[termId]) {
          log.debug(`终端 ${termId} 正在初始化中，跳过重复初始化`)
          return false
        }
        
        // 检查是否已有此终端ID的SSH会话正在创建中
        const isCreating = terminalStore.isSessionCreating(termId)
        if (isCreating) {
          log.debug(`终端 ${termId} 的SSH会话正在创建中，跳过重复初始化`)
          return false
        }
        
        // 设置当前终端的初始化状态和连接状态为true
        terminalInitializingStates.value[termId] = true
        terminalConnectingStates.value[termId] = true
        log.info(`开始初始化终端: ${termId}`)
        
        // 获取连接信息以更新标签标题
        let connection = null
        if (userStore.isLoggedIn) {
          connection = connectionStore.getConnectionById(termId)
        } else {
          connection = localConnectionsStore.getConnectionById(termId)
        }
        
        if (!connection) {
          log.error(`无法找到连接: ${termId}`)
          terminalConnectingStates.value[termId] = false
          terminalInitializingStates.value[termId] = false
          return false
        }
        
        // 更新标题
        if (isActiveTerminal(termId)) {
          title.value = `${connection.name || connection.host} - 终端`
          
          // 更新标签页标题
          const tabTitle = `${connection.username}@${connection.host}`
          tabStore.updateTabTitle('/terminal', tabTitle)
          
          // 通知会话存储这是当前活动会话
          sessionStore.setActiveSession(termId)
          
          // 通知终端切换
          window.dispatchEvent(new CustomEvent('terminal:session-change', {
            detail: { sessionId: termId }
          }))
        }
        
        // 检查终端是否已存在，如果已存在则重新附加
        if (terminalStore.hasTerminal(termId)) {
          log.debug(`终端 ${termId} 已存在，重新附加`)
          terminalStore.reattachTerminal(termId, container)
          terminalInitialized.value[termId] = true
          terminalInitializingStates.value[termId] = false
          terminalConnectingStates.value[termId] = false
          return true
        }
        
        // 初始化新终端
        const success = await terminalStore.initTerminal(termId, container)
        
        if (success) {
          log.info(`终端 ${termId} 初始化成功`)
          terminalInitialized.value[termId] = true
          
          // 移除延迟，立即触发SSH连接事件
            if (terminalStore.isTerminalConnected(termId)) {
              // 获取SSH会话ID
              const sshSessionId = terminalStore.sessions[termId];
              if (sshSessionId) {
                // 手动触发连接成功事件
                window.dispatchEvent(new CustomEvent('ssh-connected', {
                  detail: { 
                    sessionId: sshSessionId,
                    terminalId: termId,
                    // 尝试获取主机信息
                    host: connection ? connection.host : null,
                    connection: connection
                  }
                }));
              }
            }
        } else {
          log.error(`终端 ${termId} 初始化失败`)
        }
        
        // 更新终端特定的状态
        terminalInitializingStates.value[termId] = false
        terminalConnectingStates.value[termId] = false
        return success
      } catch (error) {
        log.error('初始化终端时发生错误:', error)
        // 确保错误情况下也正确设置终端状态
        terminalInitializingStates.value[termId] = false
        terminalConnectingStates.value[termId] = false
        return false
      }
    }

    // 应用终端设置
    const applyTerminalSettings = (termId) => {
      try {
        // 获取终端实例
        const terminalInstance = terminalStore.getTerminal(termId)
        
        if (!terminalStore.hasSession(termId)) {
          log.warn(`跳过应用设置：终端 ${termId} 不存在`)
          return false
        }
        
        if (!terminalInstance) {
          log.warn(`跳过应用设置：无法获取终端 ${termId} 实例`)
          return false
        }
        
        const terminal = terminalInstance
        const settings = settingsStore.terminalSettings
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
          hasChanges = true
        }
        
        // 应用光标闪烁
        if (settings.cursorBlink !== undefined && terminal.options.cursorBlink !== settings.cursorBlink) {
          log.debug(`终端 ${termId}: 更新光标闪烁 ${terminal.options.cursorBlink} -> ${settings.cursorBlink}`)
          terminal.options.cursorBlink = settings.cursorBlink
          hasChanges = true
        }
        
        // 应用其他可配置项...
        
        // 应用主题设置
        try {
          if (settings.theme && settings.theme !== 'default') {
            log.debug(`终端 ${termId}: 更新主题 ${settings.theme}`)
            
            // 将主题名称转换为标准格式
            const themeName = settings.theme.toLowerCase()
            const themeClass = `xterm-theme-${themeName}`
            
            // 移除所有主题类
            const themeClasses = Array.from(terminal.element.classList)
              .filter(className => className.startsWith('xterm-theme-'))
            
            themeClasses.forEach(className => {
              terminal.element.classList.remove(className)
            })
            
            // 添加新主题类
            terminal.element.classList.add(themeClass)
              hasChanges = true
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
            detail: { enabled: terminalBg.value.enabled } 
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
            detail: { enabled: terminalBg.value.enabled } 
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
            log.debug(`执行终端大小调整: ${id}`)
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

    // 修改聚焦逻辑，跟踪焦点状态
    const focusTerminal = (termId) => {
      if (!termId || !terminalStore.hasTerminal(termId)) return false
      
      try {
        terminalStore.focusTerminal(termId)
        lastFocusedTerminalId.value = termId
        return true
      } catch (error) {
        log.error(`聚焦终端 ${termId} 失败:`, error)
        return false
      }
    }
    
    // 修改切换终端函数，避免重复调整大小
    const switchToTerminal = async (termId) => {
      try {
        log.debug(`切换到终端: ${termId}`)
      
      if (!termId) return
      
      // 检查终端是否存在，如果不存在则等待初始化完成
      if (!terminalStore.hasTerminal(termId)) {
          log.debug(`终端 ${termId} 不存在，等待初始化完成`)
        return
      }
      
      // 取消所有正在进行的大小调整
      Object.keys(resizeDebounceTimers.value).forEach(id => {
        clearTimeout(resizeDebounceTimers.value[id])
        delete resizeDebounceTimers.value[id]
      })
      
      // 使用nextTick确保DOM更新
      nextTick(() => {
        if (terminalStore.hasTerminal(termId)) {
          try {
            // 仅当终端未调整过大小时才调整
            if (!terminalSized.value[termId]) {
                log.debug(`终端 ${termId} 首次切换，调整大小`)
              resizeTerminal(termId)
            } else {
                log.debug(`终端 ${termId} 已调整过大小，仅聚焦`)
            }
            
            // 聚焦终端
            focusTerminal(termId)
          } catch (error) {
              log.error(`切换到终端 ${termId} 失败:`, error)
          }
        } else {
            log.warn(`终端 ${termId} 不存在，无法切换`)
        }
      })
      } catch (error) {
        log.error(`切换到终端 ${termId} 失败:`, error)
      }
    }
    
    // 监听活动连接ID的变化 - 移除自动切换
    watch(
      activeConnectionId,
      (newId, oldId) => {
        if (!newId || newId === oldId) return
        
        log.debug(`活动连接ID变更: ${oldId} -> ${newId}`)
        
        // 更新终端ID列表
        if (!terminalIds.value.includes(newId)) {
          terminalIds.value.push(newId)
        }
        
        // 移除自动切换，依赖默认聚焦行为
        // switchToTerminal(newId) - 删除这行
      }
    )
    
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
      if (!event || !event.detail || !event.detail.sessionId) return;
      
      const { sessionId, isTabSwitch } = event.detail;
      log.debug(`收到会话切换事件: ${sessionId}`);
      
      // 如果终端ID不在列表中，添加到列表
      if (!terminalIds.value.includes(sessionId)) {
        terminalIds.value.push(sessionId);
      }
      
      // 检查是否是标签切换模式
      if (!isTabSwitch) {
        // 无论终端是否已存在，都将其状态设置为正在连接
        // 这确保了彩虹动画能正常显示，即使是已有终端
        terminalConnectingStates.value[sessionId] = true;
        
        // 告知工具栏重置状态 - 发送工具栏状态重置事件
        window.dispatchEvent(new CustomEvent('terminal:toolbar-reset', {
          detail: { sessionId }
        }));
        
        // 如果终端已经存在，延迟一段时间后更新连接状态
        // 这样可以确保彩虹动画能显示足够长的时间
        if (terminalStore.hasTerminal(sessionId)) {
          setTimeout(() => {
            terminalConnectingStates.value[sessionId] = false;
          }, 1000); // 延迟1秒，保证彩虹动画有足够显示时间
        }
      } else {
        // 如果是标签切换，则不显示连接动画，但需要同步工具栏状态
        terminalConnectingStates.value[sessionId] = false;
        
        // 发送工具栏同步事件，与terminal:toolbar-reset不同，这个事件不会触发彩虹动画
        window.dispatchEvent(new CustomEvent('terminal:toolbar-sync', {
          detail: { sessionId }
        }));
      }
      
      // 终端窗口大小调整可能在切换终端时触发
      // 在处理终端切换事件时，需添加延迟以确保终端初始化完成
      setTimeout(() => {
        switchToTerminal(sessionId);
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
    
    // 监听活动连接ID的变化 - 移除自动切换
    watch(
      activeConnectionId,
      (newId, oldId) => {
        if (!newId || newId === oldId) return
        
        log.debug(`活动连接ID变更: ${oldId} -> ${newId}`)
        
        // 更新终端ID列表
        if (!terminalIds.value.includes(newId)) {
          terminalIds.value.push(newId)
        }
        
        // 移除自动切换，依赖默认聚焦行为
        // switchToTerminal(newId) - 删除这行
      }
    )
    
    // 定义处理键盘快捷键事件的函数
    const handleKeyboardAction = (action) => {
      if (action === 'terminal.clear') {
        clearTerminal()
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
          ElMessage.error(`SSH错误: ${event.detail.message || '连接错误'}`)
          status.value = '连接错误'
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

    const toggleMonitoringPanel = () => {
      // 通过事件将当前终端ID传递给父组件
      window.dispatchEvent(new CustomEvent('request-toggle-monitoring-panel', {
        detail: { sessionId: activeConnectionId.value }
      }));
    }
    
    // 添加组件激活/失活生命周期钩子
    onActivated(() => {
      log.info('终端视图已激活');
      
      // 触发终端状态刷新事件，同步工具栏状态
      const currentId = activeConnectionId.value;
      if (currentId) {
        window.dispatchEvent(new CustomEvent('terminal:refresh-status', {
          detail: { 
            sessionId: currentId,
            forceShow: true 
          }
        }));
      }
    });

    onDeactivated(() => {
      log.info('终端视图已失活');
      // 可以在这里添加失活时的处理逻辑
    });
    
    // 在onMounted中添加新会话事件监听
    onMounted(() => {
      // 加载保存的SFTP面板宽度
      try {
        const savedWidth = localStorage.getItem('sftpPanelWidth')
        if (savedWidth) {
          const width = parseInt(savedWidth, 10)
          const maxWidth = window.innerWidth * 0.9
          if (!isNaN(width) && width >= 300 && width <= maxWidth) {
            sftpPanelWidth.value = width
          } else if (!isNaN(width) && width > maxWidth) {
            // 如果保存的宽度超过了当前最大值，则使用最大值
            sftpPanelWidth.value = maxWidth
          }
        }
      } catch (error) {
        log.error('加载SFTP面板宽度失败:', error)
      }
      
      // 添加窗口大小变化监听器
      window.addEventListener('resize', handleWindowResize);
      
      // 监听终端背景状态
      window.addEventListener('terminal-bg-status', (event) => {
        if (event.detail) {
          log.debug('终端背景状态已更新:', event.detail.enabled);
        }
      });
      
      // 初始化时直接读取终端背景设置
      try {
        const savedBgSettings = localStorage.getItem('easyssh_terminal_bg');
        if (savedBgSettings) {
          const bgSettings = JSON.parse(savedBgSettings);
          terminalBg.value = { ...bgSettings };
          terminalHasBackground.value = bgSettings.enabled;
          log.debug('初始化时读取终端背景状态:', bgSettings.enabled);
          
          // 初始化CSS变量
          updateCssVariables();
        }
      } catch (error) {
        log.error('初始化读取终端背景设置失败:', error);
      }
      
      // 加载终端背景设置
      loadTerminalBgSettings();
      
      // 初始化其他监听器
      listenForBgChanges();
      
      // 设置工具栏监听器
      setupToolbarListeners()
      
      // 监听SSH错误事件
      window.addEventListener('ssh:error', handleSSHError)
      
      // 监听窗口大小变化 - 使用命名函数而非匿名函数，便于移除
      window.addEventListener('resize', handleWindowResize)
      
      // 监听终端切换事件
      window.addEventListener('terminal:session-change', handleSessionChange)
      
      // 初始化时更新终端ID列表
      updateTerminalIds()
      
      // 在组件挂载后延迟初始化活动终端
      nextTick(() => {
        // 获取活动连接ID
        const id = activeConnectionId.value
        if (id) {
          // 确保该ID在终端列表中
          if (!terminalIds.value.includes(id)) {
            terminalIds.value.push(id)
          }
          
          // 延迟初始化，确保DOM已更新
          setTimeout(() => {
            // 如果终端引用已存在但未初始化，则初始化终端
            if (terminalRefs.value[id] && !terminalInitialized.value[id]) {
              initTerminal(id, terminalRefs.value[id])
            }
          }, 100)
        }
      })
      
      // 监听终端初始化完成事件
      window.addEventListener('terminal:initialized', event => {
        if (event.detail && event.detail.terminalId) {
          const termId = event.detail.terminalId
          // 如果这是当前活动终端，尝试切换到它
          if (termId === activeConnectionId.value) {
            // 使用nextTick确保DOM已更新
            nextTick(() => switchToTerminal(termId))
          }
        }
      })

      // 检查当前是否有活动会话，如果有则设置连接状态
      const sessionId = activeConnectionId.value;
      if (sessionId) {
        if (!terminalIds.value.includes(sessionId)) {
          terminalIds.value.push(sessionId);
        }
        
        // 初始设置连接状态为true，这样能确保彩虹动画显示
        // 直到终端初始化完成
        terminalConnectingStates.value[sessionId] = true;
      }

      // 监听新会话事件
      window.addEventListener('terminal:new-session', handleNewSession);
      
      // 只保留终端状态刷新事件监听器
      window.addEventListener('terminal:refresh-status', handleTerminalRefreshStatus);
    })
    
    // 在onBeforeUnmount中移除新会话事件监听
    onBeforeUnmount(() => {
      // 移除工具栏事件监听
      removeToolbarListeners()
      
      // 移除各种事件监听器
      window.removeEventListener('ssh:error', handleSSHError)
      window.removeEventListener('resize', handleWindowResize)
      window.removeEventListener('terminal:session-change', handleSessionChange)
      
      // 正确移除终端背景设置变化监听
      if (bgChangeHandler) {
        window.removeEventListener('terminal-bg-changed', bgChangeHandler)
        bgChangeHandler = null
      }
      
      // 清理所有防抖定时器
      Object.keys(resizeDebounceTimers.value).forEach(id => {
        clearTimeout(resizeDebounceTimers.value[id])
      })
      
      // 清理窗口大小变化定时器
      if (windowResizeTimer) {
        clearTimeout(windowResizeTimer)
      }
      
      // 清理终端尺寸状态
      terminalSized.value = {}

      // 移除新会话事件监听
      window.removeEventListener('terminal:new-session', handleNewSession);

      // 只保留终端状态刷新事件监听器移除
      window.removeEventListener('terminal:refresh-status', handleTerminalRefreshStatus);
    })
    
    // 添加防抖控制
    const refreshStatusDebounceTimer = ref(null)
    
    // 添加回handleTerminalRefreshStatus函数，但简化逻辑
    const handleTerminalRefreshStatus = (event) => {
      if (!event.detail || !event.detail.sessionId) return;
      
      // 添加防抖处理，避免短时间内处理多次相同会话ID的刷新事件
      if (refreshStatusDebounceTimer.value) {
        clearTimeout(refreshStatusDebounceTimer.value);
      }
      
      refreshStatusDebounceTimer.value = setTimeout(() => {
        const { sessionId, forceShow, isNewCreation } = event.detail;
        log.debug(`收到终端状态刷新事件: ${sessionId}${forceShow ? ', 强制显示' : ''}${isNewCreation ? ', 新创建' : ''}`);
        
        // 如果是新创建的终端，首先清理旧状态
        if (isNewCreation) {
          // 检查是否已经有正在创建中的SSH会话或已存在的会话
          const hasExistingSession = terminalStore.hasTerminalSession(sessionId);
          const isCreating = terminalStore.isSessionCreating(sessionId);
          
          if (hasExistingSession || isCreating) {
            log.debug(`终端${sessionId}已有会话或正在创建中，跳过重复初始化`);
            // 只处理强制显示，不清理状态
            if (forceShow && sessionId === activeConnectionId.value) {
              // 确保终端ID在列表中
              if (!terminalIds.value.includes(sessionId)) {
                terminalIds.value.push(sessionId);
              }
              
              // 重置终端大小状态以便重新调整大小
              terminalSized.value[sessionId] = false;
              
              // 强制重新调整终端大小并聚焦
              nextTick(() => {
                resizeTerminal(sessionId);
                focusTerminal(sessionId);
              });
              
              log.debug(`强制显示终端: ${sessionId}`);
            }
            refreshStatusDebounceTimer.value = null;
            return;
          }
          
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
          
          // 增加对终端存储的清理
          if (terminalStore.hasTerminal(sessionId)) {
            log.debug(`检测到新创建的终端[${sessionId}]但存在旧连接，断开旧连接`);
            terminalStore.disconnectTerminal(sessionId)
              .catch(error => log.error(`清理旧终端连接失败: ${error.message}`));
          }
          
          // 添加到终端ID列表，确保初始化
          if (!terminalIds.value.includes(sessionId)) {
            terminalIds.value.push(sessionId);
            log.debug(`为新创建的终端[${sessionId}]准备初始化`);
          }
        }
        
        // 主要处理强制显示标志
        if (forceShow && sessionId === activeConnectionId.value) {
          // 确保终端ID在列表中
          if (!terminalIds.value.includes(sessionId)) {
            terminalIds.value.push(sessionId);
          }
          
          // 重置终端大小状态以便重新调整大小
          terminalSized.value[sessionId] = false;
          
          // 强制重新调整终端大小并聚焦
          nextTick(() => {
            resizeTerminal(sessionId);
            focusTerminal(sessionId);
          });
          
          log.debug(`强制显示终端: ${sessionId}`);
        }
        
        refreshStatusDebounceTimer.value = null;
      }, 10); // 短延迟防抖
    }
    
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
    
    // 添加记录已处理的SSH会话连接事件
    const processedSshSessions = ref(new Set())
    
    // 修改SSH连接成功处理函数，添加去重逻辑
    const handleSshConnected = (event) => {
      if (!event.detail) return;
      
      const sessionId = event.detail.sessionId;
      let terminalId = event.detail.terminalId;
      
      // 检查是否已经处理过该会话的连接成功事件
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
      
      log.info(`收到SSH连接成功事件: 会话ID=${sessionId}, 终端ID=${terminalId || '未知'}`);
      
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
        // 去掉setTimeout，立即检查监控状态
        checkMonitoringServiceStatus();
      }
    };
    
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
      toggleMonitoringPanel
    }
  }
}
</script>

<style scoped>
.terminal-container {
  height: 100%;
  width: 100%;
  position: relative;
  background-color: #121212;
  overflow: hidden;
  /* 添加3D渲染上下文，减少层间闪烁 */
  transform-style: preserve-3d;
  perspective: 1000px;
  /* 对整体容器加渲染合成*/
  will-change: contents;
  contain: layout size paint;
}

.terminals-wrapper {
  position: relative;
  height: 100%;
  width: 100%;
  /* 预先创建堆叠上下文 */
  isolation: isolate;
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

.terminal-content-padding {
  flex: 1;
  padding: 20px; /* 添加20px的内边距 */
  box-sizing: border-box;
  height: calc(100% - 40px); /* 减去工具栏的高度 */
  width: 100%;
  position: relative;
  overflow: hidden; /* 防止内容溢出 */
}

.terminal-content {
  height: 100%;
  width: 100%;
  position: relative; /* 添加相对定位以便终端能正确定位 */
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
  z-index: 10;
  transition: opacity 0.3s ease-in-out;
}

.connecting-overlay.fade-out {
  opacity: 0;
  pointer-events: none;
}

/* 添加全局样式修复，确保xterm.js正常工作 */
:deep(.xterm) {
  height: 100%;
  width: 100%;
}

:deep(.xterm-viewport) {
  overflow-y: auto;
}

:deep(.xterm-screen) {
  width: 100%;
  height: 100%;
}
</style> 