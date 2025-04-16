<template>
  <div class="terminal-container">
    <!-- 彩虹加载动画，在连接建立之前显示 -->
    <div v-show="isConnecting" class="connecting-overlay" :class="{'fade-out': !isConnecting}">
      <RainbowLoader />
    </div>

    <!-- 终端背景层 - 修改为绝对定位并设置更高层级使其覆盖工具栏 -->
    <div class="terminal-background" :style="terminalBgStyle" v-if="terminalBg.enabled"></div>

    <!-- 终端内容区，添加过渡效果 -->
    <div class="terminal-content-wrapper" :class="{ 'terminal-ready': !isConnecting }">
      <div ref="terminalElement" class="terminal-content"></div>
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
    
    const terminalElement = ref(null)
    const title = ref('终端')
    const status = ref('正在连接...')
    const isConnecting = ref(true) // 连接状态标志
    const isConnectingInProgress = ref(false) // 添加连接进行中标志，避免并发请求
    
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
    const connectionId = computed(() => {
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
    
    // 添加对路由变化的监听
    watch(
      () => route.path,
      (newPath) => {
        // 当路径变为'/terminal'（无参数）时，从会话存储获取会话ID
        if (newPath === '/terminal' && !isConnectingInProgress.value) {
          const currentSessionId = sessionStore.getActiveSession()
          if (currentSessionId) {
            console.log(`检测到终端路径变更，使用会话存储ID: ${currentSessionId}`)
            
            // 在切换前检查终端是否已存在
            if (terminalStore.hasTerminal(currentSessionId)) {
              // 如果终端已存在，不显示加载动画
              isConnecting.value = false
            } else {
              // 如果不存在，则显示加载动画
              isConnecting.value = true
            }
            
            // 确保在继续之前DOM元素准备好
            nextTick().then(() => {
              // 确保终端初始化
              ensureTerminal().then(success => {
                if (success) {
                  // 终端初始化成功后，再延迟调整大小
                  setTimeout(() => {
                    resizeTerminal()
                  }, 500)
                }
              }).catch(error => {
                console.error('通过会话存储初始化终端失败:', error)
                isConnecting.value = false
                status.value = '连接失败'
              })
            })
          }
        }
      },
      { immediate: true } // 组件创建时立即执行一次
    )
    
    // 保留对路由参数的监听，以兼容旧的使用方式
    watch(
      () => route.params.id,
      (newId, oldId) => {
        if (newId && newId !== oldId && !isConnectingInProgress.value) {
          console.log(`路由参数ID变更: ${oldId} -> ${newId}，重新初始化终端...`)
          
          // 同时更新会话存储
          if (newId) {
            sessionStore.setActiveSession(newId)
          }
          
          // 在切换前检查新终端是否已存在
          if (terminalStore.hasTerminal(newId)) {
            // 如果终端已存在，不显示加载动画
            isConnecting.value = false
          } else {
            // 如果不存在，则显示加载动画
            isConnecting.value = true
          }
          
          // 确保在继续之前DOM元素准备好
          nextTick().then(() => {
            // 确保终端初始化
            ensureTerminal().then(success => {
              if (success) {
                // 终端初始化成功后，再延迟调整大小
                setTimeout(() => {
                  resizeTerminal()
                }, 500)
              }
            }).catch(error => {
              console.error('通过路由参数初始化终端失败:', error)
              isConnecting.value = false
              status.value = '连接失败'
            })
          })
        }
      }
    )
    
    // 监听计算属性connectionId的变化，确保在props或route参数变化时都能正确处理
    watch(
      connectionId,
      (newConnectionId, oldConnectionId) => {
        if (newConnectionId && newConnectionId !== oldConnectionId && !isConnectingInProgress.value) {
          console.log(`连接ID变更: ${oldConnectionId} -> ${newConnectionId}，重新初始化终端...`)
          
          // 在切换前检查新终端是否已存在
          if (terminalStore.hasTerminal(newConnectionId)) {
            // 如果终端已存在，不显示加载动画
            isConnecting.value = false
          } else {
            // 如果不存在，则显示加载动画
            isConnecting.value = true
          }
          
          // 确保在继续之前DOM元素准备好
          nextTick().then(() => {
            // 确保终端初始化
            ensureTerminal().then(success => {
              if (success) {
                // 终端初始化成功后，再延迟调整大小
                setTimeout(() => {
                  resizeTerminal()
                  // 确保终端获取焦点
                  terminalStore.focusTerminal(newConnectionId)
                }, 500)
              }
            }).catch(error => {
              console.error('切换到新终端失败:', error)
              isConnecting.value = false
              status.value = '连接失败'
            })
          })
        }
      }
    )
    
    // 添加终端设置的响应式引用
    const currentTerminalSettings = computed(() => {
      return settingsStore.getTerminalSettings()
    })

    // 监听终端设置变化
    watch(
      currentTerminalSettings,
      (newSettings, oldSettings) => {
        // 仅当设置实际发生变化时才应用
        if (JSON.stringify(newSettings) !== JSON.stringify(oldSettings)) {
          console.log('终端设置已变更，正在应用到所有打开的终端...')
          
          // 使用终端存储的方法应用设置到所有打开的终端
          const results = terminalStore.applySettingsToAllTerminals(newSettings)
          
          // 统计应用结果
          const successCount = Object.values(results).filter(success => success).length
          const totalCount = Object.keys(results).length
          
          if (totalCount > 0) {
            console.log(`成功将设置应用到 ${successCount}/${totalCount} 个终端`)
          } else {
            console.log('没有找到可应用设置的终端')
          }
        }
      },
      { deep: true }
    )

    // 加载终端背景设置
    const loadTerminalBgSettings = () => {
      try {
        const savedBgSettings = localStorage.getItem('easyssh_terminal_bg')
        if (savedBgSettings) {
          const parsedSettings = JSON.parse(savedBgSettings)
          terminalBg.value = { ...parsedSettings }
          
          // 发送背景图状态事件
          window.dispatchEvent(new CustomEvent('terminal-bg-status', { 
            detail: { enabled: terminalBg.value.enabled } 
          }))
        }
      } catch (error) {
        console.error('加载终端背景设置失败:', error)
      }
    }
    
    // 监听终端背景设置变化事件
    const listenForBgChanges = () => {
      window.addEventListener('terminal-bg-changed', (event) => {
        if (event.detail) {
          terminalBg.value = { ...event.detail }
          
          // 发送背景图状态变更事件
          window.dispatchEvent(new CustomEvent('terminal-bg-status', { 
            detail: { enabled: terminalBg.value.enabled } 
          }))
        }
      })
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
    
    // 确保终端存在并连接
    const ensureTerminal = async () => {
      try {
        // 如果已经在连接中，则跳过
        if (isConnectingInProgress.value) {
          console.log('连接已在进行中，跳过重复请求')
          return false
        }
        
        // 设置连接进行中标志
        isConnectingInProgress.value = true
        
        // 获取当前的连接ID
        const currentId = connectionId.value
        
        if (!currentId) {
          isConnectingInProgress.value = false // 重置标志
          ElMessage.error('未提供连接ID')
          router.push('/connections')
          return false
        }
        
        // 获取连接信息用于更新标签标题
        let connection = null
        if (userStore.isLoggedIn) {
          connection = connectionStore.getConnectionById(currentId)
        } else {
          connection = localConnectionsStore.getConnectionById(currentId)
        }
        
        if (!connection) {
          isConnectingInProgress.value = false // 重置标志
          ElMessage.error('无法找到连接信息')
          router.push('/connections')
          return false
        }
        
        // 更新标题
        title.value = `${connection.name || connection.host} - 终端`
        
        // 更新标签页标题为 用户名@主机
        const tabTitle = `${connection.username}@${connection.host}`
        // 使用不带参数的路径更新标签标题，会话存储中已经有当前会话ID
        tabStore.updateTabTitle('/terminal', tabTitle)
        
        // 检查终端是否已存在
        const terminalExists = terminalStore.hasTerminal(currentId)
        
        // 如果终端已存在，则不需要重新创建连接
        if (terminalExists) {
          console.log(`终端 ${currentId} 已存在，无需重新创建`)
          isConnecting.value = false
          isConnectingInProgress.value = false // 重置标志
          return true
        }
        
        // 仅在终端不存在时显示加载动画
        if (!terminalExists) {
          isConnecting.value = true
          status.value = '正在连接...'
        }
        
        // 等待DOM更新完成
        await nextTick()
        
        // 确保终端容器已准备好
        if (!terminalElement.value) {
          isConnectingInProgress.value = false // 重置标志
          console.error('终端容器未准备好')
          ElMessage.error('终端容器未准备好')
          isConnecting.value = false
          status.value = '连接失败'
          return false
        }
        
        // 检查DOM元素是否在文档中
        if (!document.body.contains(terminalElement.value)) {
          isConnectingInProgress.value = false // 重置标志
          console.error('终端容器不在文档中')
          ElMessage.error('终端容器不在文档中')
          isConnecting.value = false
          status.value = '连接失败'
          return false
        }
        
        // 初始化终端或重新连接已有终端
        const success = await terminalStore.initTerminal(currentId, terminalElement.value)
        
        // 重置连接进行中标志
        isConnectingInProgress.value = false
        
        if (success) {
          // 更新状态
          status.value = '已连接'
          
          // 仅在新创建终端时添加延迟过渡效果
          if (!terminalExists) {
            setTimeout(() => {
              isConnecting.value = false // 连接成功，隐藏加载动画
            }, 200)
          } else {
            // 已存在的终端直接显示
            isConnecting.value = false
          }

          // 应用新的终端设置
          const termSettings = settingsStore.getTerminalSettings()
          if (isConnecting.value && termSettings) {
            await applyTerminalSettings(connectionId.value, termSettings)
          }

          return true
        } else {
          // 如果失败，更新状态
          status.value = '连接失败'
          isConnecting.value = false
          return false
        }
      } catch (error) {
        // 重置连接进行中标志
        isConnectingInProgress.value = false
        
        console.error('确保终端连接失败:', error)
        ElMessage.error(`确保终端连接失败: ${error.message || '未知错误'}`)
        status.value = '连接失败'
        isConnecting.value = false // 连接失败，隐藏加载动画
        return false
      }
    }
    
    // 清空终端
    const clearTerminal = () => {
      if (connectionId.value && terminalStore.hasTerminal(connectionId.value)) {
        terminalStore.clearTerminal(connectionId.value)
      }
    }
    
    // 调整终端大小
    const resizeTerminal = () => {
      if (connectionId.value) {
        // 检查终端是否存在
        if (!terminalStore.hasTerminal(connectionId.value)) {
          console.warn(`尝试调整不存在的终端大小: ${connectionId.value}`)
          return;
        }
        
        // 检查DOM元素是否仍在文档中
        if (!terminalElement.value || !document.body.contains(terminalElement.value)) {
          console.warn('终端容器不在文档中，跳过调整大小');
          return;
        }
        
        // 添加短延迟，确保DOM已完全更新
        setTimeout(() => {
          try {
            terminalStore.fitTerminal(connectionId.value)
          } catch (error) {
            console.error('调整终端大小失败:', error)
          }
        }, 100) // 延迟100ms，给DOM更新留出时间
      }
    }
    
    // 监听外部工具栏事件
    const setupToolbarListeners = () => {
      window.addEventListener('terminal:send-command', sendTerminalCommand)
      window.addEventListener('terminal:clear', clearTerminal)
      window.addEventListener('terminal:disconnect', disconnectTerminal)
    }
    
    // 移除外部工具栏事件监听
    const removeToolbarListeners = () => {
      window.removeEventListener('terminal:send-command', sendTerminalCommand)
      window.removeEventListener('terminal:clear', clearTerminal)
      window.removeEventListener('terminal:disconnect', disconnectTerminal)
    }
    
    // 发送命令到终端
    const sendTerminalCommand = () => {
      try {
        ElMessageBox.prompt('请输入要执行的命令', '发送命令', {
          confirmButtonText: '发送',
          cancelButtonText: '取消',
          inputPattern: /.+/,
          inputErrorMessage: '命令不能为空'
        }).then(({ value }) => {
          if (connectionId.value) {
            terminalStore.sendCommand(connectionId.value, value)
          }
        }).catch(() => {
          // 用户取消输入，不做处理
        })
      } catch (error) {
        console.error('发送命令失败:', error)
      }
    }
    
    // 处理SSH错误
    const handleSSHError = (event) => {
      if (event.detail && connectionId.value) {
        const sessionId = terminalStore.sessions[connectionId.value]
        if (sessionId && event.detail.sessionId === sessionId) {
          ElMessage.error(`SSH错误: ${event.detail.message || '连接错误'}`)
          status.value = '连接错误'
        }
      }
    }
    
    // 断开终端连接
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
    
    // 断开会话的函数
    const disconnectSession = async () => {
      if (connectionId.value) {
        const success = await terminalStore.disconnectTerminal(connectionId.value)
        if (success) {
          console.log(`终端 ${connectionId.value} 已断开`)
          
          // 查找标签索引
          const tabIndex = tabStore.tabs.findIndex(tab => 
            tab.type === 'terminal' && 
            tab.data && 
            tab.data.connectionId === connectionId.value
          )
          
          if (tabIndex >= 0) {
            // 直接使用索引关闭标签，避免路径问题
            console.log(`按索引关闭标签: ${tabIndex}`)
            tabStore.closeTab(tabIndex)
          } else {
            // 如果找不到标签索引，回退到使用路径
            console.log(`按路径关闭标签: /terminal/${connectionId.value}`)
            tabStore.closeTab(`/terminal/${connectionId.value}`)
          }
        }
      }
    }
    
    // 在组件挂载时初始化终端和监听器
    onMounted(() => {
      nextTick(() => {
        // 初始化前检查终端是否已存在
        if (connectionId.value && terminalStore.hasTerminal(connectionId.value)) {
          // 如果终端已存在，直接设置为不加载状态
          isConnecting.value = false
          console.log(`终端 ${connectionId.value} 已存在，仅监听事件`)
          
          // 仍然设置监听器
          setupToolbarListeners()
          window.addEventListener('ssh:error', handleSSHError)
          window.addEventListener('resize', resizeTerminal)
        } else if (!isConnectingInProgress.value) {
          // 先设置监听器，确保不会丢失事件
          setupToolbarListeners() // 设置工具栏监听器
          
          // 监听SSH错误事件
          window.addEventListener('ssh:error', handleSSHError)
          // 监听窗口大小变化
          window.addEventListener('resize', resizeTerminal)
          
          // 初始化终端
          ensureTerminal().then(success => {
            if (success) {
              // 延迟一段时间，确保连接过渡完成后再调整尺寸
              setTimeout(() => {
                resizeTerminal()
                isConnecting.value = false
              }, 1000)
            } else {
              // 连接失败
              isConnecting.value = false
            }
          }).catch(error => {
            console.error('初始化终端失败:', error)
            isConnecting.value = false
            status.value = '连接失败'
          })
        }
      })
      
      // 加载终端背景设置
      loadTerminalBgSettings()
      
      // 监听终端背景设置变化
      listenForBgChanges()
    })
    
    // 在组件卸载前移除监听器
    onBeforeUnmount(() => {
      removeToolbarListeners()
      window.removeEventListener('ssh:error', handleSSHError)
      window.removeEventListener('resize', resizeTerminal)
      
      // 移除窗口大小变化监听
      window.removeEventListener('resize', resizeTerminal)
      
      // 移除终端背景设置变化监听
      window.removeEventListener('terminal-bg-changed', (event) => {})
    })
    
    // 在组件卸载时，不再主动断开连接，让连接保持活跃
    // 这允许在标签页之间切换而不丢失会话状态
    
    return {
      terminalElement,
      title,
      status,
      isConnecting,
      terminalBg,
      terminalBgStyle,
      resizeTerminal
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
}

.terminal-content-wrapper {
  height: 100%;
  width: 100%;
  opacity: 0;
  transition: opacity 0.3s ease-in-out;
}

.terminal-content-wrapper.terminal-ready {
  opacity: 1;
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

/* 终端背景样式 - 修改为固定定位，层级设置为2 */
.terminal-background {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2;
  pointer-events: none;
}
</style> 