import { defineStore } from 'pinia'
import { ref, reactive } from 'vue'
import { ElMessage } from 'element-plus'
import log from '../services/log'
import apiService from '../services/api'
import storageService from '../services/storage'

// 设置存储的键名
const TERMINAL_SETTINGS_KEY = 'easyssh_terminal_settings'
const CONNECTION_SETTINGS_KEY = 'easyssh_connection_settings'
const UI_SETTINGS_KEY = 'easyssh_ui_settings'

// 同步设置到服务器
const syncSettingsToServer = async (settingType, settingData) => {
  try {
    // 检查用户是否已登录
    const token = localStorage.getItem('auth_token')
    if (!token) {
      log.debug('用户未登录，跳过设置同步')
      return false
    }

    // 构建要同步的设置数据
    const settingsToSync = {
      settings: {
        [settingType]: settingData
      }
    }

    // 调用用户更新API同步设置
    const response = await apiService.put('/users/me', settingsToSync)

    if (response && response.success) {
      log.debug(`${settingType}设置已同步到服务器`)
      return true
    } else {
      log.warn(`同步${settingType}设置到服务器失败:`, response?.message)
      return false
    }
  } catch (error) {
    // 不影响用户体验，只记录错误
    log.warn(`同步${settingType}设置到服务器失败，将继续使用本地数据:`, error)
    return false
  }
}

/**
 * 设置状态管理
 */
export const useSettingsStore = defineStore('settings', () => {
  // 终端设置
  const terminalSettings = reactive({
    fontSize: 16,
    fontFamily: "'JetBrains Mono'",
    theme: 'dark',
    cursorStyle: 'block',
    cursorBlink: true,
    copyOnSelect: false,
    rightClickSelectsWord: false,
  })
  
  // 连接设置
  const connectionSettings = reactive({
    autoReconnect: true,
    reconnectInterval: 3,
    connectionTimeout: 10,
    keepAlive: true,
    keepAliveInterval: 30,
  })
  
  // 界面设置
  const uiSettings = {
    theme: 'dark',
    language: 'zh-CN',
    initialized: false
  }
  
  // 初始化：从存储中加载设置
  const initSettings = () => {
    try {
      // 加载终端设置
      const savedTerminalSettings = storageService.getItem(TERMINAL_SETTINGS_KEY)
      if (savedTerminalSettings) {
        Object.assign(terminalSettings, JSON.parse(savedTerminalSettings))
      }

      // 加载连接设置
      const savedConnectionSettings = storageService.getItem(CONNECTION_SETTINGS_KEY)
      if (savedConnectionSettings) {
        Object.assign(connectionSettings, JSON.parse(savedConnectionSettings))
      }

      // 加载界面设置
      const savedUISettings = storageService.getItem(UI_SETTINGS_KEY)
      if (savedUISettings) {
        Object.assign(uiSettings, JSON.parse(savedUISettings))
      }

      // 应用主题设置
      applyTheme()
    } catch (error) {
      log.error('初始化设置失败', error)
    }
  }
  
  // 应用主题
  const applyTheme = () => {
    try {
      if (uiSettings.theme === 'system') {
        const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        document.documentElement.setAttribute('data-theme', isDarkMode ? 'dark' : 'light')
        if (isDarkMode) {
          document.documentElement.classList.add('dark-theme')
          document.documentElement.classList.remove('light-theme')
          document.body.style.backgroundColor = '#1e1e1e'
          document.body.style.color = '#e0e0e0'
        } else {
          document.documentElement.classList.add('light-theme')
          document.documentElement.classList.remove('dark-theme')
          document.body.style.backgroundColor = '#ffffff'
          document.body.style.color = '#333333'
        }
      } else {
        document.documentElement.setAttribute('data-theme', uiSettings.theme)
        if (uiSettings.theme === 'dark') {
          document.documentElement.classList.add('dark-theme')
          document.documentElement.classList.remove('light-theme')
          document.body.style.backgroundColor = '#1e1e1e'
          document.body.style.color = '#e0e0e0'
        } else {
          document.documentElement.classList.add('light-theme')
          document.documentElement.classList.remove('dark-theme')
          document.body.style.backgroundColor = '#ffffff'
          document.body.style.color = '#333333'
        }
      }
      
      // 应用语言设置
      document.documentElement.setAttribute('lang', uiSettings.language)
      
      log.info(`主题已应用: ${uiSettings.theme}, 语言: ${uiSettings.language}`)
    } catch (error) {
      log.error('应用主题失败', error)
    }
  }
  
  // 保存终端设置
  const saveTerminalSettings = async (settings) => {
    try {
      // 更新当前状态
      Object.assign(terminalSettings, settings)

      // 保存到统一存储
      storageService.setItem(TERMINAL_SETTINGS_KEY, JSON.stringify(terminalSettings))

      // 同步到服务器（如果用户已登录）
      await syncSettingsToServer('terminal', terminalSettings)

      return true
    } catch (error) {
      log.error('保存终端设置失败', error)
      return false
    }
  }
  
  // 获取终端设置
  const getTerminalSettings = () => {
    return { ...terminalSettings }
  }
  
  // 保存连接设置
  const saveConnectionSettings = async (settings) => {
    try {
      // 更新当前状态
      Object.assign(connectionSettings, settings)

      // 保存到统一存储
      storageService.setItem(CONNECTION_SETTINGS_KEY, JSON.stringify(connectionSettings))

      // 同步到服务器（如果用户已登录）
      await syncSettingsToServer('connection', connectionSettings)

      return true
    } catch (error) {
      log.error('保存连接设置失败', error)
      return false
    }
  }
  
  // 获取连接设置
  const getConnectionSettings = () => {
    return { ...connectionSettings }
  }
  
  // 保存UI设置
  const saveUISettings = async (settings) => {
    try {
      // 更新当前状态
      Object.assign(uiSettings, settings)

      // 保存到统一存储
      storageService.setItem(UI_SETTINGS_KEY, JSON.stringify(uiSettings))

      // 应用主题和语言
      applyTheme()

      // 同步到服务器（如果用户已登录）
      await syncSettingsToServer('ui', uiSettings)

      // 语言变更可能需要刷新页面以完全应用
      if (settings.language && settings.language !== getUISettings().language) {
        log.info('检测到语言变更，需要刷新页面以完全应用')
        setTimeout(() => {
          window.location.reload()
        }, 500)
      }

      return true
    } catch (error) {
      log.error('保存UI设置失败', error)
      return false
    }
  }
  
  // 获取UI设置
  const getUISettings = () => {
    return { ...uiSettings }
  }
  
  // 重置所有设置为默认值
  const resetAllSettings = () => {
    try {
      // 重置终端设置
      Object.assign(terminalSettings, {
        fontSize: 16,
        fontFamily: "'JetBrains Mono'",
        theme: 'dark',
        cursorStyle: 'block',
        cursorBlink: true,
        copyOnSelect: false,
        rightClickSelectsWord: false,
      })
      
      // 重置连接设置
      Object.assign(connectionSettings, {
        autoReconnect: true,
        reconnectInterval: 3,
        connectionTimeout: 10,
        keepAlive: true,
        keepAliveInterval: 30,
      })
      
      // 重置界面设置，使用深色主题
      Object.assign(uiSettings, {
        theme: 'dark',
        language: 'zh-CN',
        initialized: true
      })
      
      // 保存所有重置的设置
      storageService.setItem(TERMINAL_SETTINGS_KEY, JSON.stringify(terminalSettings))
      storageService.setItem(CONNECTION_SETTINGS_KEY, JSON.stringify(connectionSettings))
      storageService.setItem(UI_SETTINGS_KEY, JSON.stringify(uiSettings))
      
      // 应用主题
      applyTheme()
      
      return true
    } catch (error) {
      log.error('重置设置失败', error)
      return false
    }
  }
  
  // 初始化设置
  initSettings()
  
  return {
    terminalSettings,
    connectionSettings,
    uiSettings,
    saveTerminalSettings,
    getTerminalSettings,
    saveConnectionSettings,
    getConnectionSettings,
    saveUISettings,
    getUISettings,
    resetAllSettings,
    applyTheme
  }
}, {
  persist: {
    key: 'settings',
    storageType: 'persistent',
    paths: ['terminalSettings', 'connectionSettings', 'uiSettings']
  }
})