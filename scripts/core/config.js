/**
 * 应用配置模块
 * 包含应用的全局配置信息
 */

/**
 * API相关配置
 */
export const apiConfig = {
  // 基础API路径
  baseUrl: '/api',
  
  // API版本
  version: 'v1',
  
  // 超时时间(毫秒)
  timeout: 30000,
  
  // API端点
  endpoints: {
    connect: '/connect',
    disconnect: '/disconnect',
    execute: '/execute',
    transfer: '/transfer',
    sessions: '/sessions',
    settings: '/settings'
  }
};

/**
 * 本地存储相关配置
 */
export const storageConfig = {
  // 存储键名前缀
  prefix: 'easyssh_',
  
  // 存储键名
  keys: {
    theme: 'easyssh_theme',
    menuState: 'easyssh_menu_state',
    recentConnections: 'easyssh_recent_connections',
    settings: 'easyssh_settings',
    sessions: 'easyssh_active_sessions'
  }
};

/**
 * UI相关配置
 */
export const uiConfig = {
  // 默认主题
  defaultTheme: 'light',
  
  // 默认菜单状态
  defaultMenuState: 'expanded',
  
  // 最小屏幕断点
  breakpoints: {
    mobile: 768,
    tablet: 992,
    desktop: 1200
  },
  
  // 动画持续时间(毫秒)
  animationDuration: 300,
  
  // 通知显示时间(毫秒)
  notificationDuration: 3000,
  
  // 最大标签页数量
  maxTabs: 10
};

/**
 * 应用默认设置
 */
export const defaultSettings = {
  // 终端设置
  terminal: {
    fontSize: 16,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    scrollback: 1000,
    cursorBlink: true,
    cursorStyle: 'block', // 'block', 'underline', 'bar'
    theme: {
      background: '#000000',
      foreground: '#ffffff',
      cursor: '#ffffff',
      selection: 'rgba(255, 255, 255, 0.3)'
    }
  },
  
  // 连接设置
  connection: {
    keepAliveInterval: 60, // 秒
    reconnectAttempts: 3,
    reconnectDelay: 2000, // 毫秒
    defaultPort: 22,
    timeout: 10000 // 毫秒
  },
  
  // 界面设置
  interface: {
    language: 'zh-CN',
    showStatusBar: true,
    showLineNumbers: true,
    confirmOnExit: true,
    saveSessionLog: false
  },
  
  // 安全设置
  security: {
    clearClipboardAfter: 30, // 秒，0表示禁用
    lockAfterInactivity: 0, // 分钟，0表示禁用
    storeCredentials: false
  }
};

/**
 * 获取完整配置对象
 * @returns {Object} 应用完整配置对象
 */
export function getFullConfig() {
  return {
    api: apiConfig,
    storage: storageConfig,
    ui: uiConfig,
    defaults: defaultSettings
  };
}

/**
 * 获取当前运行环境
 * @returns {string} 当前环境('development'|'production'|'test')
 */
export function getEnvironment() {
  return process.env.NODE_ENV || 'development';
}

/**
 * 是否为开发环境
 * @returns {boolean}
 */
export function isDevelopment() {
  return getEnvironment() === 'development';
}

/**
 * 是否为生产环境
 * @returns {boolean}
 */
export function isProduction() {
  return getEnvironment() === 'production';
}

/**
 * 是否为测试环境
 * @returns {boolean}
 */
export function isTest() {
  return getEnvironment() === 'test';
}

// 导出默认配置对象
export default {
  api: apiConfig,
  storage: storageConfig,
  ui: uiConfig,
  defaults: defaultSettings,
  getEnvironment,
  isDevelopment,
  isProduction,
  isTest
};
