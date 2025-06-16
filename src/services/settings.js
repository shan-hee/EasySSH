/**
 * 设置服务模块
 */
import { ref, reactive } from 'vue'
import { useSettingsStore } from '../store/settings'
import log from './log'

class SettingsService {
  constructor() {
    this.store = null
    this.isInitialized = false
  }

  /**
   * 初始化设置服务
   * @returns {Promise<boolean>} 是否初始化成功
   */
  init() {
    try {
      if (this.isInitialized) {
        return Promise.resolve(true)
      }
      
      this.store = useSettingsStore()
      
      // 确保store已经加载
      if (!this.store) {
        throw new Error('无法初始化设置存储')
      }
      
      log.debug('设置服务初始化完成')
      this.isInitialized = true
      return Promise.resolve(true)
    } catch (error) {
      log.error('设置服务初始化失败', error)
      return Promise.resolve(false)
    }
  }
  
  /**
   * 获取终端主题配置
   * @param {string} themeName - 主题名称
   * @returns {Object} - 主题配置
   */
  getTerminalTheme(themeName = 'vscode') {
    const themes = {
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
        cursor: '#FFCC00',
        selectionBackground: '#FFFFFF40',
        black: '#000000',
        red: '#FF5370',
        green: '#C3E88D',
        yellow: '#FFCB6B',
        blue: '#82AAFF',
        magenta: '#C792EA',
        cyan: '#89DDFF',
        white: '#FFFFFF',
        brightBlack: '#546E7A',
        brightRed: '#FF5370',
        brightGreen: '#C3E88D',
        brightYellow: '#FFCB6B',
        brightBlue: '#82AAFF',
        brightMagenta: '#C792EA',
        brightCyan: '#89DDFF',
        brightWhite: '#FFFFFF'
      }
    }
    
    return themes[themeName] || themes.vscode
  }
  
  /**
   * 获取终端默认选项
   * @returns {Object} - 终端选项
   */
  getTerminalOptions() {
    if (!this.store) {
      this.init()
    }
    
    // 从store获取当前的终端设置
    const settings = this.store.getTerminalSettings()
    
    // 获取主题
    const theme = this.getTerminalTheme(settings.theme)
    
    // 返回终端选项
    return {
      fontSize: settings.fontSize || 16,
      fontFamily: settings.fontFamily || "'JetBrains Mono'",
      theme: theme,
      cursorBlink: settings.cursorBlink !== undefined ? settings.cursorBlink : true,
      cursorStyle: settings.cursorStyle || 'block',
      scrollback: 1000,
      allowTransparency: true,
      rendererType: 'canvas',
      convertEol: true,
      disableStdin: false,
      drawBoldTextInBrightColors: true,
      copyOnSelect: settings.copyOnSelect !== undefined ? settings.copyOnSelect : false,
      rightClickSelectsWord: settings.rightClickSelectsWord !== undefined ? settings.rightClickSelectsWord : false
    }
  }
  
  /**
   * 获取连接设置
   * @returns {Object} - 连接设置
   */
  getConnectionOptions() {
    if (!this.store) {
      this.init()
    }
    
    return this.store.getConnectionSettings()
  }
  
  /**
   * 获取UI设置
   * @returns {Object} - UI设置
   */
  getUIOptions() {
    if (!this.store) {
      this.init()
    }
    
    return this.store.getUISettings()
  }
  
  /**
   * 保存终端设置
   * @param {Object} settings - 要保存的终端设置
   * @returns {boolean} - 是否保存成功
   */
  saveTerminalSettings(settings) {
    if (!this.store) {
      this.init()
    }
    
    return this.store.saveTerminalSettings(settings)
  }
  
  /**
   * 保存连接设置
   * @param {Object} settings - 要保存的连接设置
   * @returns {boolean} - 是否保存成功
   */
  saveConnectionSettings(settings) {
    if (!this.store) {
      this.init()
    }
    
    return this.store.saveConnectionSettings(settings)
  }
  
  /**
   * 保存UI设置
   * @param {Object} settings - 要保存的UI设置
   * @returns {boolean} - 是否保存成功
   */
  saveUISettings(settings) {
    if (!this.store) {
      this.init()
    }
    
    return this.store.saveUISettings(settings)
  }
  
  /**
   * 重置所有设置
   * @returns {boolean} - 是否重置成功
   */
  resetAllSettings() {
    if (!this.store) {
      this.init()
    }
    
    return this.store.resetAllSettings()
  }
  
  /**
   * 应用当前主题
   */
  applyTheme() {
    if (!this.store) {
      this.init()
    }
    
    this.store.applyTheme()
  }

  /**
   * 应用UI主题和语言
   * @param {string} theme - 主题名称
   * @param {string} language - 语言代码
   */
  applyThemeAndLanguage(theme, language) {
    // 设置主题
    document.documentElement.setAttribute('data-theme', theme)
    if (theme === 'dark') {
      document.documentElement.classList.add('dark-theme')
      document.documentElement.classList.remove('light-theme')
    } else if (theme === 'light') {
      document.documentElement.classList.add('light-theme')
      document.documentElement.classList.remove('dark-theme')
    }
    
    // 设置语言
    if (language) {
      document.documentElement.setAttribute('lang', language)
    }
    
    log.debug('主题已应用', { theme, language })
  }
}

// 导出类
export default SettingsService