import { defineStore } from 'pinia'
import { ref, nextTick, reactive, toRefs, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import router from '../router'
import { useUserStore } from './user'
import { useConnectionStore } from './connection'
import { useLocalConnectionsStore } from './localConnections'

// 导入会话存储
import { useSessionStore } from './session'

export const useTabStore = defineStore('tab', () => {
  // 使用reactive包装整个状态对象，增强响应式
  const state = reactive({
    // 标签页列表
    tabs: [],
    
    // 当前激活的标签页索引
    activeTabIndex: 0,
    
    // 是否正在添加连接
    isAddingConnection: false,
    
    // 用户是否清空了所有标签
    hasUserClearedTabs: false
  })
  
  // 添加新连接标签页
  const addNewConnection = async () => {
    // 防止同时多次添加
    if (state.isAddingConnection) return
    state.isAddingConnection = true
    
    // 创建新标签
    const newTab = {
      title: '连接配置',
      type: 'newConnection',
      path: '/connections/new',
      data: {
        name: '',
        host: '',
        port: 22,
        username: '',
        password: '',
        savePassword: true
      }
    }
    
    try {
      // 强制创建新数组以触发响应式更新
      const newTabs = [...state.tabs, newTab]
      state.tabs = newTabs
      
      // 计算新索引
      const newIndex = state.tabs.length - 1
      
      // 立即更新激活索引
      state.activeTabIndex = newIndex
      
      // 用户添加了标签，重置清空标记
      state.hasUserClearedTabs = false
      
      // 确保状态更新后再导航
      await nextTick()
      router.push('/connections/new')
    } catch (error) {
      console.error('添加新连接标签页失败:', error)
    } finally {
      // 重置状态标志
      setTimeout(() => {
        state.isAddingConnection = false
      }, 300)
    }
  }

  // 添加终端标签页
  const addTerminal = async (connectionId) => {
    // 默认标题
    let tabTitle = '终端'
    let connectionInfo = null
    
    try {
      // 获取连接信息
      const userStore = useUserStore()
      const connectionStore = useConnectionStore()
      const localConnectionsStore = useLocalConnectionsStore()
      const sessionStore = useSessionStore()
      
      // 首先尝试从会话存储中获取连接信息
      connectionInfo = sessionStore.getSession(connectionId)
      
      // 如果会话存储中没有，再尝试从连接存储中获取
      if (!connectionInfo) {
        if (userStore.isLoggedIn) {
          connectionInfo = connectionStore.getConnectionById(connectionId)
        } else {
          connectionInfo = localConnectionsStore.getConnectionById(connectionId)
        }
      }
      
      // 如果获取到连接信息，设置更详细的标题
      if (connectionInfo) {
        tabTitle = connectionInfo.name || `${connectionInfo.username}@${connectionInfo.host}`
      }
    } catch (error) {
      console.error('获取连接信息失败:', error)
    }
    
    // 构建完整路径
    const fullPath = `/terminal/${connectionId}`
    
    // 创建新标签
    const newTab = {
      title: tabTitle,
      type: 'terminal',
      path: fullPath, // 内部仍保留完整路径
      data: {
        connectionId: connectionId
      }
    }
    
    try {
      // 在会话存储中注册会话信息
      const sessionStore = useSessionStore()
      sessionStore.registerSession(connectionId, {
        ...connectionInfo,
        title: tabTitle,
        type: 'terminal'
      })
      
      // 强制创建新数组以触发响应式更新
      const newTabs = [...state.tabs, newTab]
      state.tabs = newTabs
      
      // 计算新索引
      const newIndex = state.tabs.length - 1
      
      // 立即更新激活索引
      state.activeTabIndex = newIndex
      
      // 用户添加了标签，重置清空标记
      state.hasUserClearedTabs = false
      
      // 确保状态更新后再导航
      await nextTick()
      
      // 导航到完整的终端路径 - 修改为导航到包含ID的路径以解决终端不显示问题
      // 这将直接导航到包含ID的路径，确保终端组件能够正确识别并初始化
      router.push(`/terminal/${connectionId}`)
      
      return newIndex
    } catch (error) {
      console.error('添加终端标签页失败:', error)
      return -1
    }
  }
  
  // 添加SFTP浏览器标签页
  const addSftpBrowser = async (connectionId) => {
    // 默认标题
    let tabTitle = 'SFTP 浏览器';
    let connectionInfo = null;
    let navigationPath = '/sftp';
    
    // 如果提供了connectionId，获取连接信息并创建针对特定连接的SFTP标签
    if (connectionId) {
      try {
        // 根据导入的store实例获取
        const userStore = useUserStore();
        const connectionStore = useConnectionStore();
        const localConnectionsStore = useLocalConnectionsStore();
        
        // 根据用户登录状态决定从哪个store获取连接
        if (userStore.isLoggedIn) {
          connectionInfo = connectionStore.getConnectionById(connectionId);
        } else {
          connectionInfo = localConnectionsStore.getConnectionById(connectionId);
        }
        
        // 如果获取到连接信息，设置更详细的标题
        if (connectionInfo) {
          tabTitle = `SFTP - ${connectionInfo.username}@${connectionInfo.host}`;
          // 在会话存储中注册会话信息
          const sessionStore = useSessionStore();
          sessionStore.registerSession(connectionId, {
            ...connectionInfo,
            title: tabTitle,
            type: 'sftp'
          });
          sessionStore.setActiveSession(connectionId);
        }
      } catch (error) {
        console.error('获取连接信息失败:', error);
      }
    }
    
    const newTab = {
      title: tabTitle,
      type: 'sftp',
      path: navigationPath,
      data: {
        connectionId: connectionId || null
      }
    };
    
    try {
      // 强制创建新数组以触发响应式更新
      const newTabs = [...state.tabs, newTab];
      state.tabs = newTabs;
      
      // 计算新索引
      const newIndex = state.tabs.length - 1;
      
      // 立即更新激活索引
      state.activeTabIndex = newIndex;
      
      // 用户添加了标签，重置清空标记
      state.hasUserClearedTabs = false;
      
      // 确保状态更新后再导航
      await nextTick();
      router.push(navigationPath);
      
      return newIndex;
    } catch (error) {
      console.error('添加SFTP浏览器标签页失败:', error);
      return -1;
    }
  }
  
  // 添加设置标签页
  const addSettings = async () => {
    const newTab = {
      title: '设置',
      type: 'settings',
      path: '/settings',
      data: {}
    }
    
    try {
      // 强制创建新数组以触发响应式更新
      const newTabs = [...state.tabs, newTab]
      state.tabs = newTabs
      
      // 计算新索引
      const newIndex = state.tabs.length - 1
      
      // 立即更新激活索引
      state.activeTabIndex = newIndex
      
      // 用户添加了标签，重置清空标记
      state.hasUserClearedTabs = false
      
      // 确保状态更新后再导航
      await nextTick()
      router.push('/settings')
    } catch (error) {
      console.error('添加设置标签页失败:', error)
    }
  }
  
  // 切换标签页
  const switchTab = (index) => {
    state.activeTabIndex = index
    
    // 如果标签页有关联的路径，则导航到该路径
    const tab = state.tabs[index]
    if (tab && tab.path) {
      // 对于终端页面特殊处理
      if (tab.type === 'terminal' && tab.data && tab.data.connectionId) {
        // 使用会话存储保存当前连接ID
        const sessionStore = useSessionStore()
        const previousSessionId = sessionStore.getActiveSession()
        const newSessionId = tab.data.connectionId
        
        // 只有当新旧会话ID不同时才更新
        if (previousSessionId !== newSessionId) {
          console.log(`切换终端会话: ${previousSessionId} -> ${newSessionId}`)
          sessionStore.setActiveSession(newSessionId)
          
          // 触发终端切换事件
          window.dispatchEvent(new CustomEvent('terminal:session-change', {
            detail: { 
              sessionId: newSessionId,
              isTabSwitch: true,  // 添加标记表明这是标签切换操作
              isNewSession: false  // 标记这不是新会话，避免重新创建
            }
          }))
          
          // 导入终端Store以聚焦终端
          import('./terminal').then(({ useTerminalStore }) => {
            const terminalStore = useTerminalStore()
            // 确保终端存在后再聚焦
            if (terminalStore.hasTerminal(newSessionId)) {
              // 添加延迟以确保先完成路由导航
              setTimeout(() => {
                terminalStore.focusTerminal(newSessionId)
              }, 100)
            }
          }).catch(error => {
            console.error('导入终端Store失败:', error)
          })
        }
        
        // 导航到终端路径，包含会话ID
        router.push(`/terminal/${newSessionId}`)
      } else {
        // 对于其他类型的标签，正常导航
        router.push(tab.path)
      }
    }
  }
  
  // 关闭标签页
  const closeTab = (indexOrPath) => {
    let index = indexOrPath
    
    // 如果传入的是路径，需要找到对应的索引
    if (typeof indexOrPath === 'string') {
      index = state.tabs.findIndex(tab => tab.path === indexOrPath)
      if (index === -1) {
        console.warn(`未找到路径为 ${indexOrPath} 的标签页`)
        return
      }
    }
    
    // 得到要关闭的标签信息，用于后续处理
    const closingTab = state.tabs[index]
    
    // 检查并关闭监控面板和SFTP面板
    const appLayoutElement = document.querySelector('.app-container')
    if (appLayoutElement) {
      // 检查监控面板是否打开
      const monitoringPanelVisible = document.querySelector('.monitoring-panel-container')
      if (monitoringPanelVisible) {
        // 触发关闭监控面板事件
        console.log('关闭标签页前先关闭监控面板')
        appLayoutElement.dispatchEvent(new CustomEvent('close-monitoring-panel'))
      }
      
      // 检查SFTP面板是否打开
      const sftpPanelVisible = document.querySelector('.sftp-panel-container')
      if (sftpPanelVisible) {
        // 触发关闭SFTP面板事件
        console.log('关闭标签页前先关闭SFTP面板')
        appLayoutElement.dispatchEvent(new CustomEvent('close-sftp-panel'))
      }
    }
    
    // 如果是终端标签，尝试关闭终端连接
    if (closingTab && closingTab.type === 'terminal' && closingTab.data && closingTab.data.connectionId) {
      // 使用动态导入避免循环依赖
      import('./terminal').then(({ useTerminalStore }) => {
        const terminalStore = useTerminalStore()
        // 检查是否有其他标签使用同一个连接
        const sameConnectionTabs = state.tabs.filter((tab, idx) => 
          idx !== index && 
          tab.type === 'terminal' && 
          tab.data && 
          tab.data.connectionId === closingTab.data.connectionId
        )
        
        // 如果没有其他标签使用此连接，则断开连接
        if (sameConnectionTabs.length === 0) {
          console.log(`没有其他标签使用终端 ${closingTab.data.connectionId}，准备断开连接`)
          
          // 添加超时保护，确保连接断开
          const disconnectTimeout = setTimeout(() => {
            console.warn(`断开终端 ${closingTab.data.connectionId} 连接超时，尝试强制释放资源`)
            
            // 尝试直接调用SSH服务释放资源
            import('../services/ssh').then(module => {
              const sshService = module.default
              // 查找可能的会话ID
              if (terminalStore.sessions && terminalStore.sessions[closingTab.data.connectionId]) {
                const sessionId = terminalStore.sessions[closingTab.data.connectionId]
                sshService.releaseResources(sessionId)
                  .catch(error => console.error(`强制释放SSH资源失败: ${error.message}`))
              }
            }).catch(error => {
              console.error('导入SSH服务失败:', error)
            })
          }, 5000) // 5秒超时
          
          // 尝试正常断开连接
          terminalStore.disconnectTerminal(closingTab.data.connectionId)
            .then(success => {
              clearTimeout(disconnectTimeout) // 清除超时
              console.log(`终端 ${closingTab.data.connectionId} 断开${success ? '成功' : '失败'}`)
              
              // 主动触发终端销毁事件，确保监控工厂断开连接
              window.dispatchEvent(new CustomEvent('terminal:destroyed', {
                detail: { terminalId: closingTab.data.connectionId }
              }));
            })
            .catch(error => {
              clearTimeout(disconnectTimeout) // 清除超时
              console.error('关闭终端连接失败:', error)
              
              // 即使终端断开失败，仍然触发终端销毁事件，确保监控工厂断开连接
              window.dispatchEvent(new CustomEvent('terminal:destroyed', {
                detail: { terminalId: closingTab.data.connectionId }
              }));
            })
        } else {
          console.log(`保持终端 ${closingTab.data.connectionId} 连接，还有 ${sameConnectionTabs.length} 个标签使用它`)
          
          // 在保留终端连接的同时，确保触发状态刷新事件
          window.dispatchEvent(new CustomEvent('terminal:refresh-status', {
            detail: { terminalId: closingTab.data.connectionId }
          }));
        }
      }).catch(error => {
        console.error('导入终端Store失败:', error)
      })
    }
    
    if (state.tabs.length === 1) {
      state.tabs = []
      state.activeTabIndex = 0
      // 标记用户已清空所有标签
      state.hasUserClearedTabs = true
      router.push('/') // 如果关闭最后一个标签，则回到首页
      return
    }
    
    // 创建新数组而不是使用splice，以确保响应式工作正常
    state.tabs = state.tabs.filter((_, i) => i !== index)
    
    // 如果关闭的是当前活动标签页，则需要切换到另一个标签
    if (state.activeTabIndex >= index && state.activeTabIndex > 0) {
      state.activeTabIndex--
      // 确保导航到新的活动标签页对应的路由
      const newActiveTab = state.tabs[state.activeTabIndex]
      if (newActiveTab && newActiveTab.path) {
        // 对终端标签特殊处理，使用不带参数的路径
        if (newActiveTab.type === 'terminal' && newActiveTab.data && newActiveTab.data.connectionId) {
          // 使用会话存储
          const sessionStore = useSessionStore()
          sessionStore.setActiveSession(newActiveTab.data.connectionId)
          
          // 导航到不带参数的终端路径
          router.push('/terminal')
        } else {
          // 对于其他类型的标签，正常导航
          router.push(newActiveTab.path)
        }
      }
    }
    
    // 如果关闭的是终端标签，并且关闭后没有其他终端标签，但有标签
    if (closingTab && closingTab.type === 'terminal' && state.tabs.length > 0) {
      // 检查是否还有其他终端标签
      const hasOtherTerminals = state.tabs.some(tab => tab.type === 'terminal')
      if (!hasOtherTerminals) {
        // 如果终端视图当前是活动的，导航到其他标签或首页
        if (router.currentRoute.value.path.startsWith('/terminal')) {
          const newTab = state.tabs[state.activeTabIndex]
          if (newTab) {
            // 检查新的活动标签是否也是终端标签
            if (newTab.type === 'terminal' && newTab.data && newTab.data.connectionId) {
              // 对终端标签使用不带参数的路径
              const sessionStore = useSessionStore()
              sessionStore.setActiveSession(newTab.data.connectionId)
              router.push('/terminal')
            } else {
              router.push(newTab.path)
            }
          } else {
            router.push('/')
          }
        }
      } else if (router.currentRoute.value.path.startsWith('/terminal/')) {
        // 如果还有其他终端标签，并且当前路径包含终端ID，切换到不带参数的路径
        const activeTab = state.tabs[state.activeTabIndex]
        if (activeTab && activeTab.type === 'terminal' && activeTab.data && activeTab.data.connectionId) {
          const sessionStore = useSessionStore()
          sessionStore.setActiveSession(activeTab.data.connectionId)
          router.push('/terminal')
        }
      }
    }
    
    // 如果关闭后没有标签页，导航到登录页
    if (state.tabs.length === 0) {
      state.hasUserClearedTabs = true
      router.push('/')
    }
  }
  
  // 保存连接
  const saveConnection = (index) => {
    const tab = state.tabs[index]
    
    // 验证表单
    if (!tab.data.name || !tab.data.host || !tab.data.username) {
      ElMessage({
        message: '请填写必填项（连接名称、主机地址和用户名）',
        type: 'warning',
        offset: 3,
        zIndex: 9999
      })
      return
    }
    
    // 保存连接信息
    ElMessage({
      message: '连接已保存',
      type: 'success',
      offset: 3,
      zIndex: 9999
    })
    
    // TODO: 实际保存连接到存储
    console.log('保存连接:', tab.data)
    
    // 关闭标签页
    closeTab(index)
  }
  
  // 重置状态
  const resetState = () => {
    // 关闭所有终端连接
    import('./terminal').then(({ useTerminalStore }) => {
      const terminalStore = useTerminalStore()
      // 找出所有终端标签页并断开连接
      state.tabs.forEach(tab => {
        if (tab.type === 'terminal' && tab.data && tab.data.connectionId) {
          terminalStore.disconnectTerminal(tab.data.connectionId)
            .catch(error => {
              console.error(`关闭终端连接 ${tab.data.connectionId} 失败:`, error)
            })
        }
      })
    }).catch(error => {
      console.error('导入终端Store失败:', error)
    })
    
    // 重置状态
    state.tabs = []
    state.activeTabIndex = 0
    state.isAddingConnection = false
    state.hasUserClearedTabs = true
  }
  
  // 更新标签页标题
  const updateTabTitle = (path, newTitle) => {
    if (!path || !newTitle) {
      console.warn('更新标签页标题失败：缺少路径或标题')
      return
    }
    
    // 处理终端路径的特殊情况
    if (path === '/terminal') {
      // 如果是不带参数的终端路径，需要从会话存储中获取当前活动的会话ID
      const sessionStore = useSessionStore()
      const activeId = sessionStore.getActiveSession()
      
      if (activeId) {
        // 寻找匹配会话ID的终端标签
        const matchingTab = state.tabs.findIndex(tab => 
          tab.type === 'terminal' && 
          tab.data && 
          tab.data.connectionId === activeId
        )
        
        if (matchingTab !== -1) {
          state.tabs[matchingTab].title = newTitle
          return
        }
      }
    }
    
    // 找到对应路径的标签
    const tabIndex = state.tabs.findIndex(tab => tab.path === path)
    
    if (tabIndex === -1) {
      // 如果找不到完全匹配的路径，尝试找到与路径前缀匹配的标签
      // 例如，如果path是/terminal/12345，那么也会匹配到/terminal/:id
      const partialMatch = state.tabs.findIndex(tab => {
        if (path.startsWith('/terminal/') && tab.path.startsWith('/terminal/')) {
          return tab.data && tab.data.connectionId === path.replace('/terminal/', '')
        }
        return false
      })
      
      if (partialMatch !== -1) {
        // 更新找到的标签
        state.tabs[partialMatch].title = newTitle
        return
      }
      
      console.warn(`未找到路径为 ${path} 的标签页或匹配项`)
      return
    }
    
    // 更新标题
    state.tabs[tabIndex].title = newTitle
  }
  
  // 直接设置当前活动标签页的标题
  const setActiveTabTitle = (newTitle) => {
    if (state.activeTabIndex >= 0 && state.activeTabIndex < state.tabs.length) {
      console.log('直接设置当前活动标签页标题:', newTitle);
      state.tabs[state.activeTabIndex].title = newTitle;
      return true;
    }
    return false;
  }
  
  // 确保初始状态下，如果没有页签会导航到登录页
  if (state.tabs.length === 0) {
    nextTick(() => router.push('/'))
  }

  // 更新标签页
  const updateTab = (index, tabData) => {
    // 检查索引是否有效
    if (index < 0 || index >= state.tabs.length) {
      console.warn(`更新标签页失败：索引 ${index} 超出范围`)
      return false
    }
    
    // 更新标签页数据
    state.tabs[index] = {
      ...state.tabs[index],  // 保留原始数据
      ...tabData             // 覆盖更新的数据
    }
    
    return true
  }

  return {
    ...toRefs(state),
    addNewConnection,
    addTerminal,
    addSftpBrowser,
    addSettings,
    switchTab,
    closeTab,
    saveConnection,
    resetState,
    updateTabTitle,
    setActiveTabTitle,
    updateTab
  }
}, {
  // 临时禁用自动持久化，改用手动控制
  persist: false
}) 