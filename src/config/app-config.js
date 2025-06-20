/**
 * 应用配置文件
 * 包含应用的全局配置参数
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
    minInterval: parseInt(import.meta.env.VITE_CACHE_SYNC_MIN_INTERVAL) || 30 * 1000, // 最小同步间隔：30秒
    retryAttempts: 3,                // 重试次数
    retryDelay: 1000,                // 重试延迟：1秒
    enableIncremental: true,         // 启用增量同步
    fullSyncInterval: 60 * 60 * 1000 // 强制全量同步间隔：1小时
  },

  // 存储配置
  storage: {
    prefix: 'easyssh-cache',         // 本地存储前缀
    enabled: true                    // 是否启用持久化存储
  },

  // 开发环境配置
  development: {
    enableDebugLogs: true, // 开发环境默认启用
    enablePerformanceMonitoring: true, // 开发环境默认启用
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