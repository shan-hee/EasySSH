<template>
  <div class="terminal-container">
    <!-- 彩虹加载动画，在连接建立之前显示 -->
    <div v-show="isConnecting" class="connecting-overlay" :class="{'fade-out': !isConnecting}">
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
        <div 
          :ref="el => setTerminalRef(el, termId)" 
          class="terminal-content"
          :data-terminal-id="termId"
        ></div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, onMounted, onBeforeUnmount, nextTick, onUnmounted, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useConnectionStore } from '../../store/connection'
import { useLocalConnectionsStore } from '../../store/localConnections'
import { useUserStore } from '../../store/user'
import { useTabStore } from '../../store/tab'
import { useTerminalStore } from '../../store/terminal'
import terminalService from '../../services/terminal'
import sshService from '../../services/ssh'
import RainbowLoader from '../../components/common/RainbowLoader.vue'
import { useSettingsStore } from '../../store/settings'

// 导入会话存储
import { useSessionStore } from '../../store/session'

export default {
  name: 'Terminal',
  components: {
    RainbowLoader
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
    const isConnecting = ref(true) // 连接状态标志
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
          console.error('初始化终端失败: 缺少ID或容器')
          return false
        }
        
        // 使用每个终端特定的初始化状态标志
        if (terminalInitializingStates.value[termId]) {
          console.log(`终端 ${termId} 正在初始化中，跳过重复初始化`)
          return false
        }
        
        // 设置当前终端的初始化状态为true
        terminalInitializingStates.value[termId] = true
        console.log(`开始初始化终端: ${termId}`)
        isConnecting.value = true
        
        // 获取连接信息以更新标签标题
        let connection = null
        if (userStore.isLoggedIn) {
          connection = connectionStore.getConnectionById(termId)
        } else {
          connection = localConnectionsStore.getConnectionById(termId)
        }
        
        if (!connection) {
          console.error(`无法找到连接: ${termId}`)
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
          console.log(`终端 ${termId} 已存在，重新附加`)
          terminalStore.reattachTerminal(termId, container)
          terminalInitialized.value[termId] = true
          terminalInitializingStates.value[termId] = false
          isConnecting.value = false
          return true
        }
        
        // 初始化新终端
        const success = await terminalStore.initTerminal(termId, container)
        
        if (success) {
          console.log(`终端 ${termId} 初始化成功`)
          terminalInitialized.value[termId] = true
          
          // 手动触发终端工具栏状态初始化
          // 此处添加延迟，确保SSH会话有足够时间建立
          setTimeout(() => {
            // 如果SSH连接已成功但未通知UI，手动触发
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
                    host: connection ? connection.host : null
                  }
                }));
              }
            }
          }, 500);
        } else {
          console.error(`终端 ${termId} 初始化失败`)
        }
        
        isConnecting.value = false
        terminalInitializingStates.value[termId] = false
        return success
      } catch (error) {
        console.error('初始化终端时发生错误:', error)
        isConnecting.value = false
        terminalInitializingStates.value[termId] = false
        return false
      }
    }

    // 应用终端设置
    const applyTerminalSettings = async (termId, settings) => {
      try {
        if (!termId || !terminalStore.hasTerminal(termId)) {
          console.warn(`跳过应用设置：终端 ${termId} 不存在`)
          return false
        }
        
        const terminal = terminalStore.getTerminal(termId)
        if (!terminal) {
          console.warn(`跳过应用设置：无法获取终端 ${termId} 实例`)
          return false
        }
        
        // 记录是否有任何设置更改
        let hasChanges = false
        
        // 应用字体大小
        if (settings.fontSize && terminal.options.fontSize !== settings.fontSize) {
          console.log(`终端 ${termId}: 更新字体大小 ${terminal.options.fontSize} -> ${settings.fontSize}`)
          terminal.options.fontSize = settings.fontSize
          hasChanges = true
        }
        
        // 应用字体系列
        if (settings.fontFamily && terminal.options.fontFamily !== settings.fontFamily) {
          console.log(`终端 ${termId}: 更新字体系列 ${terminal.options.fontFamily} -> ${settings.fontFamily}`)
          terminal.options.fontFamily = settings.fontFamily
          hasChanges = true
        }
        
        // 应用光标样式
        if (settings.cursorStyle && terminal.options.cursorStyle !== settings.cursorStyle) {
          console.log(`终端 ${termId}: 更新光标样式 ${terminal.options.cursorStyle} -> ${settings.cursorStyle}`)
          terminal.options.cursorStyle = settings.cursorStyle
          hasChanges = true
        }
        
        // 应用光标闪烁
        if (settings.cursorBlink !== undefined && terminal.options.cursorBlink !== settings.cursorBlink) {
          console.log(`终端 ${termId}: 更新光标闪烁 ${terminal.options.cursorBlink} -> ${settings.cursorBlink}`)
          terminal.options.cursorBlink = settings.cursorBlink
          hasChanges = true
        }
        
        // 应用终端主题
        if (settings.theme) {
          try {
            // 导入设置服务
            const settingsService = await import('../../services/settings').then(m => m.default)
            
            // 获取主题配置
            const themeConfig = settingsService.getTerminalTheme(settings.theme)
            
            // 检查主题是否发生变化
            if (JSON.stringify(terminal.options.theme) !== JSON.stringify(themeConfig)) {
              console.log(`终端 ${termId}: 更新主题 ${settings.theme}`)
              
              // 更新选项中的主题
              terminal.options.theme = themeConfig
              
              // 使用xterm的setOption API直接应用主题（如果可用）
              if (terminal.terminal && typeof terminal.terminal.setOption === 'function') {
                terminal.terminal.setOption('theme', themeConfig)
              }
              
              hasChanges = true
            }
          } catch (error) {
            console.error(`应用终端 ${termId} 主题失败:`, error)
          }
        }
        
        // 仅在有更改时执行渲染和调整
        if (hasChanges) {
          // 清除渲染器缓存
          if (terminal._core && terminal._core.renderer) {
            terminal._core.renderer.clear()
          }
          
          // 触发终端重新渲染
          terminal.refresh(0, terminal.rows - 1)
          
          // 调整终端大小以适应新字体设置
          setTimeout(() => {
            try {
              terminalStore.fitTerminal(termId)
            } catch (e) {
              console.warn(`调整终端 ${termId} 大小失败:`, e)
            }
          }, 100)
          
          console.log(`终端 ${termId}: 设置已成功应用`)
        } else {
          console.log(`终端 ${termId}: 没有需要应用的设置变更`)
        }
        
        return true
      } catch (error) {
        console.error(`应用终端 ${termId} 设置失败:`, error)
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
        console.error('加载终端背景设置失败:', error)
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
        
        // 比较新旧ID列表，只有当内容不同时才更新和记录日志
        const currentIds = terminalIds.value
        const hasChanged = newIds.length !== currentIds.length || 
                           newIds.some(id => !currentIds.includes(id)) ||
                           currentIds.some(id => !newIds.includes(id))
        
        if (hasChanged) {
          // 更新ID列表
          terminalIds.value = newIds
          console.log('更新终端ID列表:', terminalIds.value)
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
            console.log(`执行终端大小调整: ${id}`)
            terminalStore.fitTerminal(id)
            // 标记终端尺寸已调整
            terminalSized.value[id] = true
            // 清除定时器引用
            delete resizeDebounceTimers.value[id]
          } catch (error) {
            console.error(`调整终端 ${id} 大小失败:`, error)
          }
        }, 50) // 短延迟防抖
      }
      
      // 如果指定了ID，只调整该终端大小
      if (termId) {
        // 仅当终端未被调整过大小时才进行调整
        if (!terminalSized.value[termId]) {
          debouncedResize(termId)
        } else {
          console.log(`终端 ${termId} 已调整过大小，跳过调整`)
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
        console.error(`聚焦终端 ${termId} 失败:`, error)
        return false
      }
    }
    
    // 修改切换终端函数，避免重复调整大小
    const switchToTerminal = (termId) => {
      // 如果正在切换中或ID无效，则跳过
      if (!termId || isTerminalSwitching.value) return
      
      // 设置切换状态，防止重复触发
      isTerminalSwitching.value = true
      
      console.log(`切换到终端: ${termId}`)
      
      // 立即隐藏加载动画
      isConnecting.value = false
      
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
              console.log(`终端 ${termId} 首次切换，调整大小`)
              resizeTerminal(termId)
            } else {
              console.log(`终端 ${termId} 已调整过大小，仅聚焦`)
            }
            
            // 聚焦终端
            focusTerminal(termId)
            
            // 极短延迟后重置切换状态
            setTimeout(() => {
              isTerminalSwitching.value = false
            }, 5)
          } catch (error) {
            console.error(`切换到终端 ${termId} 失败:`, error)
            isTerminalSwitching.value = false
          }
        } else {
          console.warn(`终端 ${termId} 不存在，无法切换`)
          isTerminalSwitching.value = false
        }
      })
    }
    
    // 修改watch函数，添加连接中状态检查
    watch(
      () => route.path,
      (newPath) => {
        // 当路径变为'/terminal'（无参数）时，从会话存储获取会话ID
        if (newPath === '/terminal' && !isConnectingInProgress.value && !Object.values(terminalInitializingStates.value).some(state => state)) {
          const currentSessionId = sessionStore.getActiveSession()
          if (currentSessionId) {
            console.log(`检测到终端路径变更，使用会话存储ID: ${currentSessionId}`)
            updateTerminalIds()
          }
        }
      },
      { immediate: true }
    )
    
    // 监听活动连接ID的变化
    watch(
      activeConnectionId,
      (newId, oldId) => {
        if (!newId || newId === oldId) return
        
        console.log(`活动连接ID变更: ${oldId} -> ${newId}`)
        
        // 更新终端ID列表
        if (!terminalIds.value.includes(newId)) {
          terminalIds.value.push(newId)
        }
        
        // 切换到新的活动终端
        switchToTerminal(newId)
      }
    )
    
    // 监听标签页状态变化，更新终端ID列表
    watch(
      () => tabStore.tabs,
      () => {
        updateTerminalIds()
      },
      { deep: true, immediate: true }
    )
    
    // 监听终端切换事件
    const handleTerminalChange = (event) => {
      if (event.detail && event.detail.sessionId) {
        const newId = event.detail.sessionId
        console.log(`接收到终端切换事件: ${newId}`)
        
        // 确保该ID在终端列表中
        if (!terminalIds.value.includes(newId)) {
          terminalIds.value.push(newId)
        }
        
        // 切换到新终端
        switchToTerminal(newId)
      }
    }
    
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
        console.error('发送命令失败:', error)
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
          
          console.log(`执行命令到终端 ${id}: ${event.detail.command}`)
        } else {
          console.error('无法执行命令：终端不存在或无效')
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
          console.log(`终端 ${id} 已断开`)
          
          // 从终端ID列表中移除
          terminalIds.value = terminalIds.value.filter(termId => termId !== id)
          // 移除终端初始化状态标记
          delete terminalInitialized.value[id]
          
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
        console.log('窗口大小变化，重置所有终端尺寸状态')
        // 清空已调整标记，让所有终端都能重新调整
        terminalSized.value = {}
        // 调整所有终端大小
        resizeTerminal()
        windowResizeTimer = null
      }, 100) // 100ms防抖
    }
    
    // 添加防止重复切换的状态变量
    const isTerminalSwitching = ref(false)
    
    // 处理终端重连事件
    const handleTerminalReconnect = (event) => {
      // 获取连接ID和标签索引
      const { connectionId, tabIndex } = event.detail
      
      console.log(`接收到终端重连事件: ${connectionId}`)
      
      // 确保终端ID存在于列表中
      if (!terminalIds.value.includes(connectionId)) {
        terminalIds.value.push(connectionId)
        console.log(`终端ID ${connectionId} 添加到列表`)
      }
      
      // 更新活动会话
      sessionStore.setActiveSession(connectionId)
      
      // 延迟执行初始化，确保DOM准备就绪
      nextTick(() => {
        // 获取或创建终端DOM引用
        const container = terminalRefs.value[connectionId] || document.querySelector(`[data-terminal-id="${connectionId}"]`)
        
        if (container) {
          console.log(`找到终端 ${connectionId} 的容器，准备初始化`)
          initTerminal(connectionId, container)
        } else {
          console.log(`未找到终端 ${connectionId} 的容器，待下次DOM更新后再尝试`)
          
          // 如果DOM引用不存在，等待一段时间后再次检查
          setTimeout(() => {
            // 尝试获取最新的DOM引用
            const el = document.querySelector(`.terminal-content[data-terminal-id="${connectionId}"]`)
            if (el) {
              console.log(`延迟后找到终端 ${connectionId} 的容器，准备初始化`)
              terminalRefs.value[connectionId] = el
              initTerminal(connectionId, el)
            } else {
              console.error(`无法找到终端 ${connectionId} 的容器元素`)
            }
          }, 500)
        }
      })
    }
    
    // 在变量声明部分添加sftpPanelWidth
    const sftpPanelWidth = ref(600) // 默认SFTP面板宽度
    
    // 初始化
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
        console.error('加载SFTP面板宽度失败:', error)
      }
      
      // 添加窗口大小变化监听器
      window.addEventListener('resize', handleWindowResize);
      
      // 监听终端背景状态
      window.addEventListener('terminal-bg-status', (event) => {
        if (event.detail) {
          console.log('终端背景状态已更新:', event.detail.enabled);
        }
      });
      
      // 初始化时直接读取终端背景设置
      try {
        const savedBgSettings = localStorage.getItem('easyssh_terminal_bg');
        if (savedBgSettings) {
          const bgSettings = JSON.parse(savedBgSettings);
          terminalBg.value = { ...bgSettings };
          terminalHasBackground.value = bgSettings.enabled;
          console.log('初始化时读取终端背景状态:', bgSettings.enabled);
          
          // 初始化CSS变量
          updateCssVariables();
        }
      } catch (error) {
        console.error('初始化读取终端背景设置失败:', error);
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
      window.addEventListener('terminal:session-change', handleTerminalChange)
      
      // 监听终端重连事件
      window.addEventListener('terminal:reconnect', handleTerminalReconnect)
      
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
    })
    
    // 在组件卸载前移除监听器
    onBeforeUnmount(() => {
      // 移除工具栏事件监听
      removeToolbarListeners()
      
      // 移除各种事件监听器
      window.removeEventListener('ssh:error', handleSSHError)
      window.removeEventListener('resize', handleWindowResize)
      window.removeEventListener('terminal:session-change', handleTerminalChange)
      window.removeEventListener('terminal:reconnect', handleTerminalReconnect)
      
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
    })
    
    return {
      terminalIds,
      title,
      status,
      isConnecting,
      terminalBg,
      terminalBgStyle,
      isActiveTerminal,
      getTerminalStyle,
      setTerminalRef,
      terminalInitialized,
      terminalHasBackground,
      sftpPanelWidth, // 添加SFTP面板宽度
      updateTerminalIds
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

.terminal-content {
  height: 100%;
  width: 100%;
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