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

// 缓存配置（支持环境变量覆盖）
export const cacheConfig = {
  // 内存缓存配置
  memory: {
    maxSize: parseInt(import.meta.env.VITE_CACHE_MEMORY_MAX_SIZE) || 100,
    ttl: parseInt(import.meta.env.VITE_CACHE_MEMORY_TTL) || 30 * 60 * 1000,
    staleWhileRevalidate: 10 * 60 * 1000, // 过期但可用时间：10分钟
    cleanupInterval: 5 * 60 * 1000   // 清理间隔：5分钟
  },

  // 建议缓存配置
  suggestions: {
    maxSize: parseInt(import.meta.env.VITE_CACHE_SUGGESTIONS_MAX_SIZE) || 50,
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
  },

  // 同步配置
  sync: {
    backgroundInterval: parseInt(import.meta.env.VITE_CACHE_SYNC_INTERVAL) || 5 * 60 * 1000,
    retryAttempts: 3,                // 重试次数
    retryDelay: 1000                 // 重试延迟：1秒
  },

  // 存储配置
  storage: {
    prefix: 'easyssh-cache',         // 本地存储前缀
    enabled: true                    // 是否启用持久化存储
  },

  // 开发环境配置
  development: {
    enableDebugLogs: environment.isDevelopment, // 基于环境自动判断
    enablePerformanceMonitoring: environment.isDevelopment,
    cacheStatsInterval: 10000        // 缓存统计输出间隔：10秒
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