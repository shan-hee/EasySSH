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
  ABORT: 'abort',
  DATA: 'data',
  ERROR: 'error',
  PING: 'ping',
  PONG: 'pong',
  RESIZE: 'resize',
  EXEC: 'exec',
  EXIT: 'exit',
  CONNECTION_REGISTERED: 'connection_id_registered',
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
 * 二进制消息类型常量
 */
export const BINARY_MESSAGE_TYPES = {
  // 控制消息 (0x00-0x0F)
  HANDSHAKE: 0x00,
  HEARTBEAT: 0x01,
  ERROR: 0x02,
  PING: 0x03,
  PONG: 0x04,
  CONNECT: 0x05,
  AUTHENTICATE: 0x06,
  DISCONNECT: 0x07,
  CONNECTION_REGISTERED: 0x08,
  CONNECTED: 0x09,
  NETWORK_LATENCY: 0x0a,
  STATUS_UPDATE: 0x0b,
  ABORT: 0x0c,

  // SSH终端数据 (0x10-0x1F)
  SSH_DATA: 0x10, // SSH终端数据传输
  SSH_RESIZE: 0x11, // 终端大小调整
  SSH_COMMAND: 0x12, // 终端命令
  SSH_DATA_ACK: 0x13, // SSH数据确认

  // SFTP操作 (0x20-0x3F)
  SFTP_INIT: 0x20,
  SFTP_LIST: 0x21,
  SFTP_UPLOAD: 0x22,
  SFTP_DOWNLOAD: 0x23,
  SFTP_MKDIR: 0x24,
  SFTP_DELETE: 0x25,
  SFTP_RENAME: 0x26,
  SFTP_CHMOD: 0x27,
  SFTP_DOWNLOAD_FOLDER: 0x28,
  SFTP_CLOSE: 0x29,
  SFTP_CANCEL: 0x2a,

  // 响应消息 (0x80-0xFF)
  SFTP_SUCCESS: 0x80,
  SFTP_ERROR: 0x81,
  SFTP_PROGRESS: 0x82,
  SFTP_FILE_DATA: 0x83,
  SFTP_FOLDER_DATA: 0x84
};

/**
 * 连接状态编码映射
 */
export const CONNECTION_STATUS = {
  CODES: {
    CONNECTING: 0,
    CONNECTED: 1,
    DISCONNECTING: 2,
    DISCONNECTED: 3,
    NEED_AUTH: 4,
    AUTHENTICATING: 5,
    RECONNECTED: 6,
    ERROR: 7
  },
  NAMES: {
    0: 'connecting',
    1: 'connected',
    2: 'disconnecting',
    3: 'disconnected',
    4: 'need_auth',
    5: 'authenticating',
    6: 'reconnected',
    7: 'error'
  }
};

/**
 * 二进制协议配置
 */
export const BINARY_PROTOCOL = {
  MAGIC_NUMBER: 0x45535348, // "ESSH"
  VERSION: 0x02, // 统一使用版本2
  MAX_HEADER_SIZE: 8192, // 8KB
  MAX_PAYLOAD_SIZE: 10485760, // 10MB
  CHUNK_SIZE: 65536 // 64KB per chunk
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
  CHECK_INTERVAL: 5, // 秒，延迟测量间隔
  UPDATE_THROTTLE: 1000 // 毫秒，更新UI的节流时间
};

/**
 * 终端相关常量
 * 注意：部分值可能会被settings中的配置覆盖
 */
export const TERMINAL_CONSTANTS = {
  DEFAULT_FONT_SIZE: 16, // 可被settings.getTerminalOptions().fontSize覆盖
  DEFAULT_FONT_FAMILY: "'JetBrains Mono'", // 可被settings.getTerminalOptions().fontFamily覆盖
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
export const getDynamicConstants = settings => {
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
      log.warn('获取连接设置失败，使用默认值', error);
    }

    // 安全获取终端设置
    let terminalSettings = {};
    try {
      if (typeof settings.getTerminalOptions === 'function') {
        terminalSettings = settings.getTerminalOptions() || {};
      }
    } catch (error) {
      log.warn('获取终端设置失败，使用默认值', error);
    }

    // 动态延迟配置 - 延迟测量间隔独立于保活间隔
    const dynamicLatencyConfig = {
      ...LATENCY_CONFIG
      // 保持LATENCY_CONFIG.CHECK_INTERVAL = 5秒，不被keepAliveInterval覆盖
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
      MAX_RECONNECT_ATTEMPTS: connectionSettings.autoReconnect
        ? connectionSettings.reconnectInterval || 3
        : 0
    };

    return {
      LATENCY_CONFIG: dynamicLatencyConfig,
      TERMINAL_CONSTANTS: dynamicTerminalConstants,
      SSH_CONSTANTS: dynamicSshConstants,
      SFTP_CONSTANTS
    };
  } catch (error) {
    log.warn('获取动态常量失败，使用默认值', error);
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
  BINARY_MESSAGE_TYPES,
  CONNECTION_STATUS,
  BINARY_PROTOCOL,
  LATENCY_EVENTS,
  LATENCY_CONFIG,
  TERMINAL_CONSTANTS,
  SSH_CONSTANTS,
  SFTP_CONSTANTS,
  getDynamicConstants
};
import log from './log';
