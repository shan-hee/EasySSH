import { createApp } from 'vue'

// 导入根组件
import App from './App.vue'
// 导入路由配置
import router from './router'
// 导入状态管理
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
// 导入Element Plus样式
import 'element-plus/dist/index.css'
import ElementPlus from 'element-plus'
// 导入xterm样式
import '@xterm/xterm/css/xterm.css'
import './assets/styles/main.css'
import './components/sftp/styles/sftp-panel.css'
// 导入监控服务
import monitoringService from './services/monitoring'
// 导入服务初始化模块
import { initializeServices } from '../scripts/services'
import servicesManager from './services'
// 导入日志服务
import log from './services/log'
// 导入字体加载器
import fontLoader from './utils/fontLoader'
// 导入配置管理器
import configManager from './utils/config-manager'
// 导入自定义指令
import directives from './directives'

// 初始化主题和语言设置
const initSettings = () => {
  try {
    const UI_SETTINGS_KEY = 'easyssh_ui_settings'
    const savedUISettings = localStorage.getItem(UI_SETTINGS_KEY)
    
    if (savedUISettings) {
      const uiSettings = JSON.parse(savedUISettings)
      
      // 应用主题
      if (uiSettings.theme) {
        if (uiSettings.theme === 'system') {
          const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
          document.documentElement.setAttribute('data-theme', isDarkMode ? 'dark' : 'light')
          if (isDarkMode) {
            document.documentElement.classList.add('dark-theme')
            document.documentElement.classList.remove('light-theme')
          } else {
            document.documentElement.classList.add('light-theme')
            document.documentElement.classList.remove('dark-theme')
          }
        } else {
          document.documentElement.setAttribute('data-theme', uiSettings.theme)
          if (uiSettings.theme === 'dark') {
            document.documentElement.classList.add('dark-theme')
            document.documentElement.classList.remove('light-theme')
          } else {
            document.documentElement.classList.add('light-theme')
            document.documentElement.classList.remove('dark-theme')
          }
        }
      }
      
      // 应用语言
      if (uiSettings.language) {
        document.documentElement.setAttribute('lang', uiSettings.language)
      }
    } else {
      // 没有保存的设置时，应用深色主题作为默认值
      document.documentElement.setAttribute('data-theme', 'dark')
      document.documentElement.classList.add('dark-theme')
      document.documentElement.classList.remove('light-theme')
      
      // 创建并保存默认的UI设置
      const defaultSettings = {
        theme: 'dark',
        language: 'zh-CN'
      }
      localStorage.setItem(UI_SETTINGS_KEY, JSON.stringify(defaultSettings))
      log.info('已应用默认深色主题')
    }
  } catch (error) {
    log.error('初始化主题和语言设置失败', error)
  }
}

// 立即初始化主题和语言
initSettings()

// 修改预加载字体函数
const preloadFonts = () => {
  log.debug('启动字体预加载...')

  // 开始字体预加载，不等待结果
  fontLoader.preloadFonts().then(success => {
    if (success) {
      log.debug('字体预加载成功')
    } else {
      log.warn('字体预加载未完全成功，但应用将继续运行')
    }
  }).catch(err => {
    log.error('字体预加载过程出错:', err)
  })
}

// 立即开始预加载字体
preloadFonts()

// 开发环境存储版本检查
if (process.env.NODE_ENV === 'development') {
  const storageVersion = 'v1.0'
  const savedVersion = localStorage.getItem('app-version')
  
  if (savedVersion !== storageVersion) {
    log.info('检测到存储版本变更，重置存储状态')
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('app-version', storageVersion)
  }
  
  // 添加快捷键清除存储
  window.addEventListener('keydown', (e) => {
    // Ctrl+Shift+Delete 清除所有持久化存储
    if (e.ctrlKey && e.shiftKey && e.key === 'Delete') {
      localStorage.clear()
      sessionStorage.clear()
      log.info('已清除所有存储')
      location.reload()
    }
  })
}

// 创建 Pinia 实例
const pinia = createPinia()
// 添加持久化插件
pinia.use(piniaPluginPersistedstate)

// 创建Vue应用实例
const app = createApp(App)

// 使用插件
app.use(router)
app.use(pinia)
app.use(ElementPlus)

// 注册自定义指令
Object.keys(directives).forEach(key => {
  app.directive(key, directives[key])
})

// 扩展调试方法
window.debugMonitoring = {
  connect: (host) => {
    log.info(`[监控调试] 手动触发监控连接: ${host || '未指定主机'}`);
    if (!host) {
      // 尝试从当前SSH会话获取主机
      const sessions = JSON.parse(sessionStorage.getItem('ssh-sessions') || '[]');
      if (sessions.length > 0) {
        host = sessions[0].host;
        log.info(`[监控调试] 使用当前会话主机: ${host}`);
      } else {
        log.error('[监控调试] 未找到主机，请指定主机地址');
        return false;
      }
    }
    return monitoringService.connect(host);
  },
  status: () => {
    log.info('[监控调试] 当前监控状态:');
    monitoringService.printStatus();
    return monitoringService.state;
  },
  
  // 添加显式创建监控面板的方法
  showPanel: (host) => {
    log.info(`[监控调试] 显式创建监控面板: ${host || '未指定主机'}`);
    if (!host) {
      // 尝试从当前SSH会话获取主机
      const sessions = JSON.parse(sessionStorage.getItem('ssh-sessions') || '[]');
      if (sessions.length > 0) {
        host = sessions[0].host;
        log.info(`[监控调试] 使用当前会话主机: ${host}`);
      } else {
        log.error('[监控调试] 未找到主机，请指定主机地址');
        return false;
      }
    }
    
    // 触发自定义事件，通知需要显示监控面板
    try {
      window.dispatchEvent(new CustomEvent('show-monitoring-panel', { 
        detail: { host, serverId: 'debug' }
      }));
      return true;
    } catch (error) {
      log.error('[监控调试] 显示监控面板失败:', error);
      return false;
    }
  }
};

// 挂载应用并初始化服务
app.mount('#app')

// 导入用户状态管理，并初始化用户状态
import { useUserStore } from './store/user'

// 应用初始化时强制同步token状态，并主动验证和刷新数据
const userStore = useUserStore()
const savedToken = localStorage.getItem('auth_token')
if (savedToken) {
  userStore.setToken(savedToken)

  // 页面刷新后主动验证token并刷新数据
  import('./services/auth.js').then(({ default: authService }) => {
    authService.init().then(() => {
      // 验证认证状态并刷新用户数据
      authService.checkAuthStatus().then(isValid => {
        if (isValid) {
          log.info('页面刷新后认证验证成功，开始刷新数据')
          // 强制刷新用户相关数据
          refreshUserData().catch(error => {
            log.warn('刷新用户数据失败', error)
          })
        }
      }).catch(error => {
        log.error('认证状态检查失败', error)
      })
    })
  })
} else {
  userStore.setToken('')
  userStore.setUserInfo({
    id: '', username: '', email: '', avatar: '', role: '', lastLogin: null, mfaEnabled: false, displayName: '', theme: 'system', fontSize: 14
  })
  if (window.location.pathname !== '/login') {
    window.location.href = '/login'
  }
}

// 刷新用户数据的统一方法
async function refreshUserData() {
  try {
    const userStore = useUserStore()

    // 1. 刷新用户基本信息
    const authModule = await import('./services/auth.js')
    const authService = authModule.default
    await authService.refreshUserInfo()

    // 2. 强制刷新连接数据（绕过缓存）
    if (userStore.isLoggedIn) {
      await userStore.loadConnectionsFromServer(true) // 传入forceRefresh参数
    }

    // 3. 刷新脚本库数据
    try {
      const scriptLibraryModule = await import('./services/scriptLibrary.js')
      const scriptLibraryService = scriptLibraryModule.default
      await scriptLibraryService.syncFromServer()
    } catch (error) {
      log.warn('刷新脚本库数据失败', error)
    }

    log.info('用户数据刷新完成')
  } catch (error) {
    log.error('刷新用户数据过程中出现错误', error)
  }
}

// 防止重复认证跳转
window._isAuthFailed = false
window.addEventListener('auth:check-failed', () => {
  if (window._isAuthFailed) return
  window._isAuthFailed = true
  log.info('检测到认证状态检查失败，跳转到登录页')
  // 清理store等逻辑可放在api.js
  if (window.location.pathname !== '/login') {
    const currentPath = window.location.pathname
    const redirectParam = currentPath !== '/' ? `?redirect=${encodeURIComponent(currentPath)}` : ''
    window.location.href = `/login${redirectParam}`
  }
})

// 处理完全登出事件，确保彻底退出系统
window.addEventListener('auth:complete-logout', async () => {
  if (window._isAuthFailed) return
  window._isAuthFailed = true

  log.warn('检测到完全登出事件，开始执行彻底退出流程')

  try {
    // 1. 清理用户Store状态
    const { useUserStore } = await import('./store/user')
    const userStore = useUserStore()
    await userStore.performCompleteCleanup()

    // 2. 清理所有可能的缓存和状态（但保留记住的凭据）
    try {
      // 清理sessionStorage
      sessionStorage.clear()

      // 清理特定的localStorage项目（但保留记住的凭据）
      const keysToRemove = [
        'auth_token',
        'currentUser',
        // 注意：不再清除 easyssh_credentials，保留记住的密码
        'easyssh-user'
      ]
      keysToRemove.forEach(key => {
        try {
          localStorage.removeItem(key)
        } catch (e) {
          log.error(`清理localStorage项目失败: ${key}`, e)
        }
      })
    } catch (error) {
      log.error('清理缓存数据失败', error)
    }

    // 3. 强制刷新页面并跳转到登录页，确保完全重置应用状态
    log.info('执行强制页面刷新，确保完全退出系统')
    // 设置一个标志表示这是完全登出，供登录页面检测
    sessionStorage.setItem('auth_complete_logout', 'true')
    window.location.href = '/login'

  } catch (error) {
    log.error('执行完全登出流程时出现错误', error)
    // 即使出错也要跳转到登录页
    sessionStorage.setItem('auth_logout_error', 'true')
    window.location.href = '/login'
  }
})

// 处理远程注销事件，立即跳转到登录页
window.addEventListener('auth:remote-logout', () => {
  log.warn('检测到远程注销，立即跳转到登录页')
  // 清除全局状态指示器
  window._isAuthFailed = true
  // 清除token，确保不再获取登录信息
  localStorage.removeItem('auth_token')
  // 远程注销时清理记住的凭据（这是唯一清理凭据的场景）
  localStorage.removeItem('easyssh_credentials')
  log.info('远程注销：已清理记住的凭据')
  // 不保留重定向路径，确保完全重新登录
  window.location.href = '/login?remote-logout=true'
})

// 处理认证过期事件，直接跳转到登录页
window.addEventListener('auth:expired', () => {
  log.info('检测到认证令牌过期，跳转到登录页')
  if (window.location.pathname !== '/login') {
    const currentPath = window.location.pathname
    const redirectParam = currentPath !== '/' ? `?redirect=${encodeURIComponent(currentPath)}` : ''
    window.location.href = `/login${redirectParam}`
  }
})

// 统一的服务初始化流程
const initializeApp = async () => {
  try {
    // 首先初始化日志服务
    await servicesManager.log.init()
    
    // 使用日志服务记录而不是console.log
    servicesManager.log.info('开始初始化应用服务...')
    
    // 初始化用户状态
    try {
      const userStore = useUserStore()
      // 检查localStorage中是否有token，并确保store中的token被正确设置
      const savedToken = localStorage.getItem('auth_token')
      if (savedToken && !userStore.token) {
        log.info('从localStorage恢复用户登录状态')
        userStore.setToken(savedToken)
      }
    } catch (error) {
      log.error('初始化用户状态失败', error)
    }
    
    // 初始化基础UI服务（键盘管理等）
    const serviceResult = await initializeServices()
    if (!serviceResult) {
      servicesManager.log.warn('部分UI服务初始化失败')
    }

    // 初始化配置管理器
    const cacheConfigStats = configManager.getStats()
    if (cacheConfigStats.isDevelopment) {
      servicesManager.log.debug('配置管理器已初始化', {
        isDevelopment: cacheConfigStats.isDevelopment,
        totalOverrides: cacheConfigStats.totalOverrides,
        totalPresets: cacheConfigStats.totalPresets
      })
    }

    // 初始化应用核心服务
    await servicesManager.initServices()

    servicesManager.log.info('应用服务初始化流程完成')
    
    // 触发应用初始化完成事件
    window.dispatchEvent(new CustomEvent('app:initialized'))
  } catch (error) {
    servicesManager.log.error('应用服务初始化失败', error)
  }
}

// 启动初始化流程
initializeApp()

// 页面可见性API监听 - 页面重新激活时刷新数据
let lastVisibilityChange = Date.now()
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    const now = Date.now()
    // 如果页面隐藏超过5分钟，则刷新数据
    if (now - lastVisibilityChange > 5 * 60 * 1000) {
      const userStore = useUserStore()
      if (userStore.isLoggedIn) {
        log.info('页面重新激活，开始刷新数据')
        refreshUserData().catch(error => {
          log.warn('页面激活后刷新数据失败', error)
        })
      }
    }
    lastVisibilityChange = now
  } else {
    lastVisibilityChange = Date.now()
  }
})

// 窗口焦点事件监听 - 窗口重新获得焦点时检查数据
let lastFocusTime = Date.now()
window.addEventListener('focus', () => {
  const now = Date.now()
  // 如果失去焦点超过10分钟，则刷新数据
  if (now - lastFocusTime > 10 * 60 * 1000) {
    const userStore = useUserStore()
    if (userStore.isLoggedIn) {
      log.info('窗口重新获得焦点，开始刷新数据')
      refreshUserData().catch(error => {
        log.warn('窗口焦点后刷新数据失败', error)
      })
    }
  }
})

window.addEventListener('blur', () => {
  lastFocusTime = Date.now()
})