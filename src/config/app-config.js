/**
 * 应用配置文件
 * 包含应用的全局配置参数
 */

// 应用基本信息
export const appInfo = {
  name: 'Easyssh',
  version: '1.0.0',
  description: '轻量级、安全、高效的SSH连接管理工具',
  author: 'Easyssh',
  homepage: 'https://www.easyssh.io'
};

// 环境配置
export const environment = {
  isDevelopment: true,
  apiBaseUrl: '/api',
  analyticsEnabled: false,
  debugLogging: true
};

// WebSocket服务器配置
export const wsServerConfig = {
  // 默认使用localhost而非IP地址，更加稳定
  primaryHost: 'localhost',
  fallbackHost: '127.0.0.1',
  port: 8000,
  path: '/ssh',
  connectionTimeout: 10000, // 毫秒
  reconnectAttempts: 3,
  reconnectDelay: 1000, // 毫秒
  keepAliveInterval: 10 // 秒，保活间隔，减少到10秒确保连接不会超时
};

// UI配置
export const uiConfig = {
  defaultTheme: 'light',
  animationDuration: 300, // ms
  maxRecentConnections: 10,
  defaultMenuCollapsed: false
};

// 存储配置
export const storageConfig = {
  prefix: 'easyssh_',
  keys: {
    theme: 'easyssh_theme',
    menuState: 'easyssh_menu_state',
    recentConnections: 'easyssh_recent_connections',
    settings: 'easyssh_settings'
  },
  useLocalStorage: true
};

// 功能默认配置
export const featureDefaults = {
  ssh: {
    defaultPort: 22,
    keepAliveInterval: 30, // 秒
    connectionTimeout: 10, // 秒
    defaultEncoding: 'utf8'
  },
  terminal: {
    fontSize: 14,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    lineHeight: 1.5,
    cursorBlink: true
  }
};

export default {
  app: appInfo,
  env: environment,
  ui: uiConfig,
  storage: storageConfig,
  features: featureDefaults,
  wsServer: wsServerConfig
}; 