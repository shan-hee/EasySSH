/**
 * 统一应用配置文件
 * 整合了原有的多个配置文件，提供统一的配置管理
 */

// 应用基本信息
export const appInfo = {
  name: 'Easyssh',
  version: import.meta.env.VITE_APP_VERSION || '1.0.0',
  description: '轻量级、安全、高效的SSH连接管理工具',
  author: 'Easyssh',
  homepage: 'https://www.easyssh.io'
};

// 环境配置
export const environment = {
  // 动态检测环境
  isDevelopment: import.meta.env.DEV || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1',
  // 生产环境使用相对路径（通过Nginx代理），开发环境使用绝对路径
  apiBaseUrl: import.meta.env.DEV ? 'http://localhost:8000/api' : '/api',
  analyticsEnabled: !import.meta.env.DEV,
  debugLogging: import.meta.env.DEV
};

// WebSocket服务器配置
export const wsServerConfig = {
  // 动态配置WebSocket连接地址
  primaryHost: window.location.hostname,
  fallbackHost: '127.0.0.1',
  // 生产环境使用Nginx端口（8520），开发环境直接连接后端（8000）
  port: import.meta.env.DEV ? 8000 : window.location.port || 8520,
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

// 自动补全配置
export const autocompleteConfig = {
  minInputLength: 1,               // 最小输入长度
  maxSuggestions: 8,               // 最大建议数量
  debounceDelay: 50,               // 防抖延迟：50ms

  // 智能混合补全配置
  enableWordCompletion: true,      // 启用单词补全
  enableScriptCompletion: true,    // 启用脚本补全
  wordCompletionPriority: 0.7,     // 单词补全优先级权重
  scriptCompletionPriority: 1.0,   // 脚本补全优先级权重
  maxWordsPerType: 6,              // 每种类型最大建议数

  // 上下文判断配置
  contextDetection: {
    commandPrefixes: ['sudo', 'ssh', 'scp', 'rsync', 'git', 'docker', 'kubectl'], // 命令前缀
    scriptKeywords: ['sh', 'bash', 'python', 'node', 'npm', 'yarn'],              // 脚本关键词
    systemCommands: ['ls', 'cd', 'pwd', 'cat', 'grep', 'find', 'ps', 'top']       // 系统命令
  }
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

// 统一的用户设置默认值（整合了多个配置文件的设置）
export const userSettingsDefaults = {
  // 界面设置
  ui: {
    theme: 'system', // light, dark, system
    language: 'zh-CN',
    sidebarCollapsed: false,
    tabsEnabled: true,
    fontSize: 14,
    animations: true,
    denseLayout: false,
    menuWidth: 220,
    showStatusBar: true,
    showTabIcons: true
  },

  // 终端设置
  terminal: {
    fontFamily: "'JetBrains Mono'",
    fontSize: 16,
    lineHeight: 1.5,
    theme: 'dark', // 默认使用深色主题
    cursorStyle: 'block', // block, bar, underline
    cursorBlink: true,
    scrollback: 1000,
    bellSound: true,
    copyOnSelect: false,
    rightClickSelectsWord: false,
    // 渲染器配置：首选WebGL，备用Canvas，移除DOM
    rendererType: 'webgl', // 首选WebGL渲染器，提供最佳性能
    fallbackRenderer: 'canvas' // 备用Canvas渲染器，确保兼容性
  },

  // 连接设置
  connection: {
    defaultPort: 22,
    keepAliveInterval: 30, // 秒
    connectionTimeout: 10, // 秒
    defaultEncoding: 'utf8',
    autoReconnect: true,
    reconnectDelay: 3000, // ms
    displayLoginBanner: true,
    saveHistory: true,
    maxHistoryItems: 100,
    saveCredentials: false
  },

  // 编辑器设置
  editor: {
    theme: 'vs',
    tabSize: 2,
    insertSpaces: true,
    autoIndent: true,
    wordWrap: 'off',
    lineNumbers: true,
    highlightActiveLine: true
  },

  // 监控设置
  monitoring: {
    updateInterval: 1000      // 更新间隔（毫秒）
  },

  // 高级设置
  advanced: {
    experimentalFeatures: false,
    debugMode: false,
    analytics: true,
    autoUpdate: true
  }
};

// 功能默认配置（保持向后兼容）
export const featureDefaults = {
  ssh: userSettingsDefaults.connection,
  terminal: userSettingsDefaults.terminal
};

export default {
  app: appInfo,
  env: environment,
  ui: uiConfig,
  storage: storageConfig,
  features: featureDefaults,
  userDefaults: userSettingsDefaults,
  wsServer: wsServerConfig,
  autocomplete: autocompleteConfig
};