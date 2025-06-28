/**
 * WebSocket常量，兼容浏览器和Node.js环境
 */
export const WS_CONSTANTS = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3
};

/**
 * WebSocket消息类型常量
 */
export const MESSAGE_TYPES = {
  CONNECT: 'connect',
  CONNECTED: 'connected',
  DISCONNECT: 'disconnect',
  DISCONNECTED: 'disconnected',
  DATA: 'data',
  ERROR: 'error',
  PING: 'ping',
  PONG: 'pong',
  RESIZE: 'resize',
  EXEC: 'exec',
  EXIT: 'exit',
  SFTP_REQUEST: 'sftp_request',
  SFTP_RESPONSE: 'sftp_response',
  SFTP_ERROR: 'sftp_error',
  SFTP_SUCCESS: 'sftp_success',
  SFTP_PROGRESS: 'sftp_progress',
  SFTP_READY: 'sftp_ready',
  SFTP_FILE: 'sftp_file',
  SFTP_LIST: 'sftp_list',
  SFTP_MKDIR: 'sftp_mkdir',
  SFTP_RENAME: 'sftp_rename',
  SFTP_REMOVE: 'sftp_remove',
  SFTP_MKDIR_ERROR: 'sftp_mkdir_error',
  SFTP_RENAME_ERROR: 'sftp_rename_error',
  SFTP_REMOVE_ERROR: 'sftp_remove_error',
  SFTP_CONFIRM: 'sftp_confirm',
  NETWORK_LATENCY: 'network_latency',
  HEARTBEAT: 'heartbeat',
  STATS: 'stats'
};

/**
 * 网络延迟事件常量
 */
export const LATENCY_EVENTS = {
  GLOBAL: 'network:latency',
  TOOLBAR: 'network-latency-update',
  TERMINAL: 'terminal:network-latency'
};

/**
 * 默认延迟测量配置
 * 注意：部分值可能会被settings中的配置覆盖
 */
export const LATENCY_CONFIG = {
  DEFAULT_LOCAL: 1,  // 默认本地延迟值
  CHECK_INTERVAL: 30, // 秒，可被settings.getConnectionSettings().keepAliveInterval覆盖
  UPDATE_THROTTLE: 1000 // 毫秒，更新UI的节流时间
};

/**
 * 终端相关常量
 * 注意：部分值可能会被settings中的配置覆盖
 */
export const TERMINAL_CONSTANTS = {
  DEFAULT_FONT_SIZE: 14, // 可被settings.getTerminalOptions().fontSize覆盖
  DEFAULT_FONT_FAMILY: "'JetBrains Mono', 'Courier New', monospace", // 可被settings.getTerminalOptions().fontFamily覆盖
  DEFAULT_SCROLLBACK: 3000
};

/**
 * SSH相关常量
 * 注意：部分值可能会被settings中的配置覆盖
 */
export const SSH_CONSTANTS = {
  DEFAULT_PORT: 22,
  DEFAULT_TIMEOUT: 10000, // 可被settings.getConnectionSettings().connectionTimeout*1000覆盖
  MAX_RECONNECT_ATTEMPTS: 3 // 可被settings中的配置覆盖
};

/**
 * SFTP相关常量
 */
export const SFTP_CONSTANTS = {
  DEFAULT_TIMEOUT: 30000,
  MAX_UPLOAD_SIZE: 1024 * 1024 * 100, // 100MB
  DEFAULT_CHUNK_SIZE: 1024 * 64 // 64KB
};

// 获取动态常量值的工具函数
export const getDynamicConstants = (settings) => {
  try {
    if (!settings) {
      return {
        LATENCY_CONFIG,
        TERMINAL_CONSTANTS,
        SSH_CONSTANTS,
        SFTP_CONSTANTS
      };
    }

    // 检查settings是否已初始化完成
    if (!settings.isInitialized) {
      return {
        LATENCY_CONFIG,
        TERMINAL_CONSTANTS,
        SSH_CONSTANTS,
        SFTP_CONSTANTS
      };
    }

    // 安全获取连接设置
    let connectionSettings = {};
    try {
      if (typeof settings.getConnectionSettings === 'function') {
        connectionSettings = settings.getConnectionSettings() || {};
      }
    } catch (error) {
      console.warn('获取连接设置失败，使用默认值', error);
    }
    
    // 安全获取终端设置
    let terminalSettings = {};
    try {
      if (typeof settings.getTerminalOptions === 'function') {
        terminalSettings = settings.getTerminalOptions() || {};
      }
    } catch (error) {
      console.warn('获取终端设置失败，使用默认值', error);
    }
    
    // 动态延迟配置
    const dynamicLatencyConfig = {
      ...LATENCY_CONFIG,
      CHECK_INTERVAL: connectionSettings.keepAliveInterval || LATENCY_CONFIG.CHECK_INTERVAL
    };
    
    // 动态终端配置
    const dynamicTerminalConstants = {
      ...TERMINAL_CONSTANTS,
      DEFAULT_FONT_SIZE: terminalSettings.fontSize || TERMINAL_CONSTANTS.DEFAULT_FONT_SIZE,
      DEFAULT_FONT_FAMILY: terminalSettings.fontFamily || TERMINAL_CONSTANTS.DEFAULT_FONT_FAMILY
    };
    
    // 动态SSH配置
    const dynamicSshConstants = {
      ...SSH_CONSTANTS,
      DEFAULT_TIMEOUT: (connectionSettings.connectionTimeout || 10) * 1000,
      MAX_RECONNECT_ATTEMPTS: connectionSettings.autoReconnect ? 
        (connectionSettings.reconnectInterval || 3) : 0
    };
    
    return {
      LATENCY_CONFIG: dynamicLatencyConfig,
      TERMINAL_CONSTANTS: dynamicTerminalConstants,
      SSH_CONSTANTS: dynamicSshConstants,
      SFTP_CONSTANTS
    };
  } catch (error) {
    console.warn('获取动态常量失败，使用默认值', error);
    return {
      LATENCY_CONFIG,
      TERMINAL_CONSTANTS,
      SSH_CONSTANTS,
      SFTP_CONSTANTS
    };
  }
};

// 导出所有常量
export default {
  WS_CONSTANTS,
  MESSAGE_TYPES,
  LATENCY_EVENTS,
  LATENCY_CONFIG,
  TERMINAL_CONSTANTS,
  SSH_CONSTANTS,
  SFTP_CONSTANTS,
  getDynamicConstants
}; 