/**
 * 统一设置服务模块
 * 整合了原有的多个设置管理，提供统一的设置接口
 */
import { reactive, watch } from 'vue'
import { userSettingsDefaults } from '../config/app-config.js'
import storageUtils from '../utils/storage.js'
import log from './log'

const SETTINGS_STORAGE_KEY = 'user_settings'

// 终端主题常量
export const TERMINAL_THEMES = {
  LIGHT: 'light',
  DARK: 'dark',
  VSCODE: 'vscode',
  DRACULA: 'dracula',
  MATERIAL: 'material',
  SYSTEM: 'system'
}

export const VALID_THEMES = Object.values(TERMINAL_THEMES)

class SettingsService {
  constructor() {
    this.isInitialized = false

    // 响应式设置对象
    this.settings = reactive({ ...userSettingsDefaults })

    // 创建专用的存储实例
    this.storage = storageUtils.createPrefixedStorage('easyssh:')

    // 设置变更监听器
    this.changeListeners = new Set()

    // 添加主题缓存，避免重复计算
    this._themeCache = new Map()
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

      // 设置系统主题变化监听器
      this._setupSystemThemeListener()

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

      // 优化：只记录设置加载的摘要信息，避免大对象重复输出
      const settingsKeys = Object.keys(storedSettings)
      log.debug('设置已从存储加载', {
        storedKeys: settingsKeys,
        hasTerminalSettings: !!storedSettings.terminal,
        hasUISettings: !!storedSettings.ui,
        hasConnectionSettings: !!storedSettings.connection
      })

      // 深度合并设置，保留默认值
      this._mergeSettings(this.settings, storedSettings)
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
    const theme = this._getTerminalTheme(terminalSettings.theme || TERMINAL_THEMES.DARK)

    // 优化：只在首次获取或主题变化时记录详细日志
    const currentTheme = terminalSettings.theme
    if (!this._lastLoggedTheme || this._lastLoggedTheme !== currentTheme) {
      log.debug('获取终端选项', {
        fontSize: terminalSettings.fontSize,
        fontFamily: terminalSettings.fontFamily,
        theme: currentTheme,
        themeColors: {
          foreground: theme.foreground,
          background: theme.background
        }
      })
      this._lastLoggedTheme = currentTheme
    }

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
   * 设置系统主题变化监听器
   * @private
   */
  _setupSystemThemeListener() {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    const handleSystemThemeChange = (e) => {
      // 只有当用户选择了"跟随系统"时才响应系统主题变化
      if (this.settings.ui.theme === 'system') {
        const newTheme = e.matches ? 'dark' : 'light'
        log.debug('系统主题变化，自动切换主题', { newTheme })
        this.applyTheme('system')
      }
    }

    // 兼容不同浏览器的事件监听
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleSystemThemeChange)
    } else {
      // 旧版浏览器支持
      mediaQuery.addListener(handleSystemThemeChange)
    }

    // 保存监听器引用，用于清理
    this._systemThemeListener = {
      mediaQuery,
      handler: handleSystemThemeChange
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

    // 获取当前主题，避免不必要的切换
    const currentTheme = document.documentElement.getAttribute('data-theme')
    if (currentTheme === actualTheme) {
      return // 主题没有变化，无需切换
    }

    // 添加主题切换状态类，提供视觉反馈
    document.documentElement.classList.add('theme-switching')

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

    // 移除主题切换状态类
    setTimeout(() => {
      document.documentElement.classList.remove('theme-switching')
    }, 300)

    // 清除终端主题缓存，确保下次获取时使用新的CSS变量值
    this._themeCache.clear()

    // 触发主题变化事件，供其他组件监听
    window.dispatchEvent(new CustomEvent('theme-changed', {
      detail: { theme, actualTheme, previousTheme: currentTheme }
    }))

    // 触发终端主题更新事件，让终端跟随界面主题
    window.dispatchEvent(new CustomEvent('terminal-theme-update', {
      detail: { uiTheme: actualTheme }
    }))

    log.debug('主题已应用', { theme, actualTheme, previousTheme: currentTheme, language })
  }

  /**
   * 验证主题名称是否有效
   * @param {string} themeName - 主题名称
   * @returns {boolean} 是否有效
   */
  isValidTheme(themeName) {
    return VALID_THEMES.includes(themeName)
  }

  /**
   * 获取终端主题配置（公共方法）
   * @param {string} themeName - 主题名称
   * @returns {Object} 终端主题配置
   */
  getTerminalTheme(themeName = TERMINAL_THEMES.DARK) {
    // 验证主题名称
    if (!this.isValidTheme(themeName)) {
      log.warn(`无效的主题名称: ${themeName}，使用默认主题 '${TERMINAL_THEMES.DARK}'`)
      themeName = TERMINAL_THEMES.DARK
    }
    return this._getTerminalTheme(themeName)
  }

  /**
   * 获取终端主题配置
   * @param {string} themeName - 主题名称 (light, dark, vscode, dracula, material, system)
   * @returns {Object} 终端主题配置
   * @private
   */
  _getTerminalTheme(themeName = TERMINAL_THEMES.DARK) {
    // 检查缓存
    if (this._themeCache.has(themeName)) {
      return this._themeCache.get(themeName)
    }
    const themes = {
      light: {
        foreground: '#000000',
        background: '#F5F5F5', // 使用与--color-bg-page相近的颜色作为默认值
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
      },
      vscode: {
        foreground: '#CCCCCC',
        background: '#1E1E1E',
        cursor: '#FFFFFF',
        selectionBackground: '#264F78',
        black: '#000000',
        red: '#CD3131',
        green: '#0DBC79',
        yellow: '#E5E510',
        blue: '#2472C8',
        magenta: '#BC3FBC',
        cyan: '#11A8CD',
        white: '#E5E5E5',
        brightBlack: '#666666',
        brightRed: '#F14C4C',
        brightGreen: '#23D18B',
        brightYellow: '#F5F543',
        brightBlue: '#3B8EEA',
        brightMagenta: '#D670D6',
        brightCyan: '#29B8DB',
        brightWhite: '#FFFFFF'
      },
      dracula: {
        foreground: '#F8F8F2',
        background: '#282A36',
        cursor: '#F8F8F2',
        selectionBackground: '#44475A',
        black: '#21222C',
        red: '#FF5555',
        green: '#50FA7B',
        yellow: '#F1FA8C',
        blue: '#BD93F9',
        magenta: '#FF79C6',
        cyan: '#8BE9FD',
        white: '#F8F8F2',
        brightBlack: '#6272A4',
        brightRed: '#FF6E6E',
        brightGreen: '#69FF94',
        brightYellow: '#FFFFA5',
        brightBlue: '#D6ACFF',
        brightMagenta: '#FF92DF',
        brightCyan: '#A4FFFF',
        brightWhite: '#FFFFFF'
      },
      material: {
        foreground: '#EEFFFF',
        background: '#263238',
        cursor: '#FFCC02',
        selectionBackground: '#546E7A',
        black: '#000000',
        red: '#F07178',
        green: '#C3E88D',
        yellow: '#FFCB6B',
        blue: '#82AAFF',
        magenta: '#C792EA',
        cyan: '#89DDFF',
        white: '#FFFFFF',
        brightBlack: '#546E7A',
        brightRed: '#FF5370',
        brightGreen: '#C3E88D',
        brightYellow: '#FFD54F',
        brightBlue: '#729FCF',
        brightMagenta: '#AD7FA8',
        brightCyan: '#34E2E2',
        brightWhite: '#FFFFFF'
      }
    }

    // 处理系统主题
    let actualTheme = themeName
    if (themeName === TERMINAL_THEMES.SYSTEM) {
      actualTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? TERMINAL_THEMES.DARK : TERMINAL_THEMES.LIGHT
    }

    const themeConfig = themes[actualTheme] || themes[TERMINAL_THEMES.DARK]

    // 动态解析CSS变量，使终端主题与界面主题保持一致
    const resolvedTheme = { ...themeConfig }

    // 获取当前界面主题的CSS变量值
    const computedStyle = getComputedStyle(document.documentElement)
    const bgColor = computedStyle.getPropertyValue('--color-bg-page').trim()
    const textColor = computedStyle.getPropertyValue('--color-text-primary').trim()

    // 如果CSS变量有值，则使用界面主题的颜色
    if (bgColor && textColor) {
      resolvedTheme.background = bgColor
      resolvedTheme.foreground = textColor
      resolvedTheme.cursor = textColor
    }

    // 不缓存，确保每次都能获取到最新的CSS变量值
    return resolvedTheme
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
      theme: this._getTerminalTheme(TERMINAL_THEMES.DARK),
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