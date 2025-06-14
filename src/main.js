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

// 应用初始化时强制同步token状态，由userStore或auth服务统一校验token有效性
const userStore = useUserStore()
const savedToken = localStorage.getItem('auth_token')
if (savedToken) {
  userStore.setToken(savedToken)
  // 不再在main.js中主动fetch('/api/users/me')
} else {
  userStore.setToken('')
  userStore.setUserInfo({
    id: '', username: '', email: '', avatar: '', role: '', lastLogin: null, mfaEnabled: false, displayName: '', theme: 'system', fontSize: 14
  })
  if (window.location.pathname !== '/login') {
    window.location.href = '/login'
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

// 处理远程注销事件，立即跳转到登录页
window.addEventListener('auth:remote-logout', () => {
  log.warn('检测到远程注销，立即跳转到登录页')
  // 清除全局状态指示器
  window._isAuthFailed = true
  // 清除token，确保不再获取登录信息
  localStorage.removeItem('auth_token')
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