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

  // SSH终端数据 (0x10-0x1F)
  SSH_DATA: 0x10,
  SSH_RESIZE: 0x11,
  SSH_COMMAND: 0x12,
  SSH_DATA_ACK: 0x13,

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
} as const;

export type BinaryMessageType = typeof BINARY_MESSAGE_TYPES[keyof typeof BINARY_MESSAGE_TYPES];

export interface BinaryHeader {
  magic: number; // 0x45535348
  version: number; // 0x02
  type: BinaryMessageType;
  sessionId: string;
  // 可按需扩展
}

