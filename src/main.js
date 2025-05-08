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

// 预加载关键字体（在DOM准备好后执行）
const preloadFonts = () => {
  
  // 使用更可靠的导入方式
  const loadFontHelper = () => {
    import('./utils/fontLoader').then(module => {
      const fontLoader = module.default
      fontLoader.preloadFonts()
        .then(success => {
          if (success) {
            // 设置全局加载完成标志
            window.TERMINAL_FONTS_LOADED = true
            // 发送字体加载完成事件
            window.dispatchEvent(new CustomEvent('terminal:fonts-loaded'))
          } else {
            log.warn('终端字体预加载可能未完全成功')
          }
        })
        .catch(err => {
          log.warn('字体预加载过程中出错:', err)
          // 即使出错也设置标志，避免阻塞终端创建
          window.TERMINAL_FONTS_LOADED = true
        })
    }).catch(err => {
      log.error('加载字体工具失败:', err)
      // 即使导入失败也设置标志，避免阻塞
      window.TERMINAL_FONTS_LOADED = true
    })
  }
  
  // 确保DOM已加载完成
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadFontHelper)
  } else {
    // DOM已加载，直接执行
    loadFontHelper()
  }
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

// 统一的服务初始化流程
const initializeApp = async () => {
  try {
    // 首先初始化日志服务
    await servicesManager.log.init()
    
    // 使用日志服务记录而不是console.log
    servicesManager.log.info('开始初始化应用服务...')
    
    // 初始化基础UI服务（键盘管理等）
    servicesManager.log.debug('准备初始化UI基础服务')
    const serviceResult = await initializeServices()
    if (!serviceResult) {
      servicesManager.log.warn('部分UI服务初始化失败')
    } else {
      servicesManager.log.info('UI基础服务初始化成功')
    }
    
    // 初始化应用核心服务
    servicesManager.log.debug('准备初始化核心应用服务')
    await servicesManager.initServices()
    
    // 最后初始化监控服务（依赖之前的服务）
    servicesManager.log.debug('准备初始化监控服务')
    monitoringService.init()
    
    servicesManager.log.info('应用服务初始化流程完成')
    
    // 触发应用初始化完成事件
    window.dispatchEvent(new CustomEvent('app:initialized'))
  } catch (error) {
    servicesManager.log.error('应用服务初始化失败', error)
  }
}

// 启动初始化流程
initializeApp() 