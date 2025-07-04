/**
 * 统一设置服务模块
 * 整合了原有的多个设置管理，提供统一的设置接口
 */
import { reactive, watch } from 'vue'
import { userSettingsDefaults } from '../config/app-config.js'
import storageUtils from '../utils/storage.js'
import log from './log'

const SETTINGS_STORAGE_KEY = 'user_settings'

class SettingsService {
  constructor() {
    this.isInitialized = false

    // 响应式设置对象
    this.settings = reactive({ ...userSettingsDefaults })

    // 创建专用的存储实例
    this.storage = storageUtils.createPrefixedStorage('easyssh:')

    // 设置变更监听器
    this.changeListeners = new Set()
  }

  /**
   * 初始化设置服务
   * @returns {Promise<boolean>} 是否初始化成功
   */
  async init() {
    if (this.isInitialized) {
      return true
    }

    try {
      // 从存储加载设置
      await this.loadSettings()

      // 设置监听器，自动保存变更
      this._setupAutoSave()

      // 应用初始主题
      this.applyTheme(this.settings.ui.theme)

      this.isInitialized = true
      log.debug('设置服务初始化完成')
      return true
    } catch (error) {
      log.error('设置服务初始化失败', error)
      return false
    }
  }

  /**
   * 从存储加载设置
   * @private
   */
  async loadSettings() {
    try {
      const storedSettings = this.storage.get(SETTINGS_STORAGE_KEY, {})

      log.debug('从存储加载的设置数据:', storedSettings)
      log.debug('当前默认设置:', this.settings)

      // 深度合并设置，保留默认值
      this._mergeSettings(this.settings, storedSettings)

      log.debug('合并后的设置:', this.settings)
      log.debug('设置已从存储加载')
    } catch (error) {
      log.warn('加载设置失败，使用默认设置', error)
    }
  }

  /**
   * 保存设置到存储
   * @private
   */
  async saveSettings() {
    try {
      this.storage.set(SETTINGS_STORAGE_KEY, this.settings)
      log.debug('设置已保存到存储')
    } catch (error) {
      log.error('保存设置失败', error)
    }
  }

  /**
   * 深度合并设置对象
   * @param {Object} target - 目标对象
   * @param {Object} source - 源对象
   * @private
   */
  _mergeSettings(target, source) {
    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        if (target[key] && typeof target[key] === 'object' && typeof source[key] === 'object') {
          this._mergeSettings(target[key], source[key])
        } else {
          target[key] = source[key]
        }
      }
    }
  }

  /**
   * 设置自动保存监听器
   * @private
   */
  _setupAutoSave() {
    // 使用Vue的watch监听设置变更
    watch(
      () => this.settings,
      () => {
        this.saveSettings()
        this._notifyListeners()
      },
      { deep: true }
    )
  }

  /**
   * 通知变更监听器
   * @private
   */
  _notifyListeners() {
    this.changeListeners.forEach(listener => {
      try {
        listener(this.settings)
      } catch (error) {
        log.error('设置变更监听器执行失败', error)
      }
    })
  }

  /**
   * 获取设置值
   * @param {string} path - 设置路径，如 'ui.theme'
   * @param {any} defaultValue - 默认值
   * @returns {any} 设置值
   */
  get(path, defaultValue = undefined) {
    const keys = path.split('.')
    let value = this.settings

    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key]
      } else {
        return defaultValue
      }
    }

    return value
  }

  /**
   * 设置值
   * @param {string} path - 设置路径
   * @param {any} value - 设置值
   */
  set(path, value) {
    const keys = path.split('.')
    let target = this.settings

    // 导航到目标对象
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i]
      if (!target[key] || typeof target[key] !== 'object') {
        target[key] = {}
      }
      target = target[key]
    }

    // 设置值
    const lastKey = keys[keys.length - 1]
    target[lastKey] = value

    log.debug(`设置已更新: ${path} = ${JSON.stringify(value)}`)
  }

  /**
   * 重置设置到默认值
   * @param {string} path - 设置路径，不提供则重置所有
   */
  reset(path = null) {
    if (path) {
      // 重置指定路径
      const keys = path.split('.')
      let defaultValue = userSettingsDefaults

      // 获取默认值
      for (const key of keys) {
        if (defaultValue && typeof defaultValue === 'object' && key in defaultValue) {
          defaultValue = defaultValue[key]
        } else {
          defaultValue = undefined
          break
        }
      }

      // 设置默认值
      if (defaultValue !== undefined) {
        this.set(path, defaultValue)
      }
    } else {
      // 重置所有设置
      Object.assign(this.settings, userSettingsDefaults)
    }

    log.debug(`设置已重置: ${path || '全部'}`)
  }

  /**
   * 添加设置变更监听器
   * @param {Function} listener - 监听器函数
   */
  addChangeListener(listener) {
    this.changeListeners.add(listener)
  }

  /**
   * 移除设置变更监听器
   * @param {Function} listener - 监听器函数
   */
  removeChangeListener(listener) {
    this.changeListeners.delete(listener)
  }

  /**
   * 获取终端设置
   * @returns {Object} 终端设置
   */
  getTerminalSettings() {
    return { ...this.settings.terminal }
  }

  /**
   * 获取连接设置
   * @returns {Object} 连接设置
   */
  getConnectionSettings() {
    return { ...this.settings.connection }
  }

  /**
   * 获取UI设置
   * @returns {Object} UI设置
   */
  getUISettings() {
    return { ...this.settings.ui }
  }

  /**
   * 获取编辑器设置
   * @returns {Object} 编辑器设置
   */
  getEditorSettings() {
    return { ...this.settings.editor }
  }

  /**
   * 获取高级设置
   * @returns {Object} 高级设置
   */
  getAdvancedSettings() {
    return { ...this.settings.advanced }
  }

  /**
   * 获取终端选项（用于xterm.js）
   * @returns {Object} 终端选项
   */
  getTerminalOptions() {
    // 如果未初始化，先尝试初始化
    if (!this.isInitialized) {
      log.warn('设置服务未初始化，使用默认终端选项')
      return this._getDefaultTerminalOptions()
    }

    const terminalSettings = this.settings.terminal
    const theme = this._getTerminalTheme(this.settings.ui.theme)

    log.debug('获取终端选项 - 终端设置:', terminalSettings)
    log.debug('获取终端选项 - 当前主题:', this.settings.ui.theme)
    log.debug('获取终端选项 - 主题配置:', theme)

    return {
      fontSize: terminalSettings.fontSize,
      fontFamily: terminalSettings.fontFamily,
      lineHeight: terminalSettings.lineHeight,
      theme: theme,
      cursorBlink: terminalSettings.cursorBlink,
      cursorStyle: terminalSettings.cursorStyle,
      scrollback: terminalSettings.scrollback,
      allowTransparency: true,
      rendererType: 'canvas',
      convertEol: true,
      disableStdin: false,
      drawBoldTextInBrightColors: true,
      copyOnSelect: terminalSettings.copyOnSelect,
      rightClickSelectsWord: terminalSettings.rightClickSelectsWord
    }
  }

  /**
   * 更新终端设置
   * @param {Object} updates - 要更新的设置
   * @param {boolean} applyToTerminals - 是否立即应用到所有终端
   */
  updateTerminalSettings(updates, applyToTerminals = false) {
    Object.assign(this.settings.terminal, updates)
    log.debug('终端设置已更新:', updates)
    log.debug('更新后的完整终端设置:', this.settings.terminal)

    // 如果需要立即应用到终端，触发应用逻辑
    if (applyToTerminals) {
      this._applyTerminalSettingsToAllTerminals()
    }
  }

  /**
   * 将当前终端设置应用到所有打开的终端
   * @private
   */
  async _applyTerminalSettingsToAllTerminals() {
    try {
      // 动态导入终端store以避免循环依赖
      const { useTerminalStore } = await import('../store/terminal')
      const terminalStore = useTerminalStore()

      if (terminalStore && terminalStore.applySettingsToAllTerminals) {
        const results = await terminalStore.applySettingsToAllTerminals(this.settings.terminal)
        log.debug('设置已应用到所有终端:', results)
      }
    } catch (error) {
      log.error('应用终端设置到所有终端失败:', error)
    }
  }

  /**
   * 更新连接设置
   * @param {Object} updates - 要更新的设置
   */
  updateConnectionSettings(updates) {
    Object.assign(this.settings.connection, updates)
  }

  /**
   * 更新UI设置
   * @param {Object} updates - 要更新的设置
   */
  updateUISettings(updates) {
    Object.assign(this.settings.ui, updates)

    // 如果主题发生变化，立即应用
    if (updates.theme) {
      this.applyTheme(updates.theme)
    }
  }

  /**
   * 应用主题
   * @param {string} theme - 主题名称 (light, dark, system)
   */
  applyTheme(theme = this.settings.ui.theme) {
    let actualTheme = theme

    // 处理系统主题
    if (theme === 'system') {
      actualTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }

    // 设置主题
    document.documentElement.setAttribute('data-theme', actualTheme)
    document.documentElement.className = document.documentElement.className
      .replace(/\b(light|dark)-theme\b/g, '')
    document.documentElement.classList.add(`${actualTheme}-theme`)

    // 设置语言
    const language = this.settings.ui.language
    if (language) {
      document.documentElement.setAttribute('lang', language)
    }

    log.debug('主题已应用', { theme, actualTheme, language })
  }

  /**
   * 获取终端主题配置（公共方法）
   * @param {string} themeName - 主题名称
   * @returns {Object} 终端主题配置
   */
  getTerminalTheme(themeName = 'dark') {
    return this._getTerminalTheme(themeName)
  }

  /**
   * 获取终端主题配置
   * @param {string} uiTheme - UI主题
   * @returns {Object} 终端主题配置
   * @private
   */
  _getTerminalTheme(uiTheme = 'light') {
    const themes = {
      light: {
        foreground: '#000000',
        background: '#FFFFFF',
        cursor: '#000000',
        selectionBackground: '#ACCEF7',
        black: '#000000',
        red: '#C91B00',
        green: '#00C200',
        yellow: '#C7C400',
        blue: '#0225C7',
        magenta: '#CA30C7',
        cyan: '#00C5C7',
        white: '#C7C7C7',
        brightBlack: '#686868',
        brightRed: '#FF6E67',
        brightGreen: '#5FF967',
        brightYellow: '#FEFB67',
        brightBlue: '#6871FF',
        brightMagenta: '#FF77FF',
        brightCyan: '#5FFDFF',
        brightWhite: '#FFFFFF'
      },
      dark: {
        foreground: '#F8F8F2',
        background: '#121212',
        cursor: '#F8F8F0',
        selectionBackground: '#49483E',
        black: '#272822',
        red: '#F92672',
        green: '#A6E22E',
        yellow: '#F4BF75',
        blue: '#66D9EF',
        magenta: '#AE81FF',
        cyan: '#A1EFE4',
        white: '#F8F8F2',
        brightBlack: '#75715E',
        brightRed: '#F92672',
        brightGreen: '#A6E22E',
        brightYellow: '#F4BF75',
        brightBlue: '#66D9EF',
        brightMagenta: '#AE81FF',
        brightCyan: '#A1EFE4',
        brightWhite: '#F9F8F5'
      }
    }

    // 处理系统主题
    let actualTheme = uiTheme
    if (uiTheme === 'system') {
      actualTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }

    return themes[actualTheme] || themes.light
  }

  /**
   * 导出设置
   * @returns {Object} 设置数据
   */
  exportSettings() {
    return {
      settings: { ...this.settings },
      timestamp: Date.now(),
      version: '1.0.0'
    }
  }

  /**
   * 导入设置
   * @param {Object} data - 设置数据
   */
  importSettings(data) {
    if (data.settings) {
      this._mergeSettings(this.settings, data.settings)
      this.applyTheme()
      log.info('设置导入成功')
    }
  }



  /**
   * 获取默认终端选项（当设置服务未初始化时使用）
   * @private
   * @returns {Object} 默认终端选项
   */
  _getDefaultTerminalOptions() {
    return {
      fontSize: 16,
      fontFamily: "'JetBrains Mono'",
      lineHeight: 1.2,
      theme: {
        foreground: '#F8F8F2',
        background: '#121212',
        cursor: '#F8F8F0',
        selectionBackground: '#49483E',
        black: '#272822',
        red: '#F92672',
        green: '#A6E22E',
        yellow: '#F4BF75',
        blue: '#66D9EF',
        magenta: '#AE81FF',
        cyan: '#A1EFE4',
        white: '#F8F8F2',
        brightBlack: '#75715E',
        brightRed: '#F92672',
        brightGreen: '#A6E22E',
        brightYellow: '#F4BF75',
        brightBlue: '#66D9EF',
        brightMagenta: '#AE81FF',
        brightCyan: '#A1EFE4',
        brightWhite: '#F9F8F5'
      },
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 3000,
      allowTransparency: true,
      rendererType: 'canvas',
      convertEol: true,
      disableStdin: false,
      drawBoldTextInBrightColors: true,
      copyOnSelect: false,
      rightClickSelectsWord: false
    }
  }
}

// 创建服务实例
const settingsService = new SettingsService()

// 导出服务实例
export default settingsService