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

// 检查URL参数，看是否禁用页签恢复
const urlParams = new URLSearchParams(window.location.search);
const noRestore = urlParams.get('no-restore') === 'true';
if (noRestore) {
  console.log('检测到no-restore参数，将禁用页签自动恢复')
  localStorage.setItem('tab-auto-restore', JSON.stringify({
    enabled: false
  }))
}

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
    }
  } catch (error) {
    console.error('初始化主题和语言设置失败', error)
  }
}

// 立即初始化主题和语言
initSettings()

// 开发环境存储版本检查
if (process.env.NODE_ENV === 'development') {
  const storageVersion = 'v1.0'
  const savedVersion = localStorage.getItem('app-version')
  
  if (savedVersion !== storageVersion) {
    console.log('检测到存储版本变更，重置存储状态')
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
      console.log('已清除所有存储')
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

// 直接挂载应用
app.mount('#app') 