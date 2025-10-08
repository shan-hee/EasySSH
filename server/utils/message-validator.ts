// @ts-nocheck
/**
 * WebSocket消息Schema验证器
 * 使用AJV进行JSON Schema验证，确保消息格式正确
 */
const AjvLib = require('ajv');
const logger = require('./logger');

// 兼容 Ajv v6/v8 的导入方式
const Ajv = AjvLib && AjvLib.default ? AjvLib.default : AjvLib;

// 创建AJV实例
const ajv = new Ajv({
  allErrors: true,
  removeAdditional: true, // 移除额外属性
  useDefaults: true,      // 使用默认值
  coerceTypes: true       // 类型强制转换
});

// 本项目未使用 JSON Schema 的 `format` 关键字，移除 ajv-formats 依赖与加载以降低噪音

// 统一错误码定义
const ERROR_CODES = {
  // 验证错误 (1000-1999)
  INVALID_MESSAGE_FORMAT: 1001,
  MISSING_REQUIRED_FIELD: 1002,
  INVALID_FIELD_TYPE: 1003,
  INVALID_FIELD_VALUE: 1004,
  MESSAGE_TOO_LARGE: 1005,

  // 认证错误 (2000-2999)
  AUTHENTICATION_REQUIRED: 2001,
  INVALID_CREDENTIALS: 2002,
  SESSION_EXPIRED: 2003,
  PERMISSION_DENIED: 2004,

  // 连接错误 (3000-3999)
  CONNECTION_FAILED: 3001,
  CONNECTION_TIMEOUT: 3002,
  CONNECTION_REFUSED: 3003,
  HOST_UNREACHABLE: 3004,

  // 系统错误 (4000-4999)
  INTERNAL_ERROR: 4001,
  SERVICE_UNAVAILABLE: 4002,
  RATE_LIMIT_EXCEEDED: 4003,
  RESOURCE_NOT_FOUND: 4004
};

// 基础消息Schema
const baseMessageSchema = {
  type: 'object',
  required: ['type', 'data'],
  properties: {
    type: {
      type: 'string',
      enum: [
        'connect', 'auth', 'authenticate', 'data', 'resize', 'disconnect', 'ping', 'pong', 'ssh_exec',
        // SFTP消息类型
        'sftp_init', 'sftp_list', 'sftp_upload', 'sftp_download', 'sftp_download_folder', 'sftp_delete', 'sftp_rename',
        'sftp_mkdir', 'sftp_chmod', 'sftp_stat', 'sftp_move', 'sftp_copy', 'sftp_fast_delete', 'sftp_close'
      ]
    },
    data: {
      type: 'object'
    },
    version: {
      type: 'string',
      default: '1.0'
    },
    timestamp: {
      type: 'number'
    },
    requestId: {
      type: 'string',
      pattern: '^[a-zA-Z0-9-_]{1,64}$'
    }
  },
  additionalProperties: false
};

// 连接消息Schema
const connectMessageSchema = {
  ...baseMessageSchema,
  properties: {
    ...baseMessageSchema.properties,
    type: { const: 'connect' },
    data: {
      type: 'object',
      required: ['sessionId'],
      properties: {
        sessionId: {
          type: 'string',
          pattern: '^[a-zA-Z0-9-_]{1,128}$'
        },
        connectionId: {
          type: 'string',
          pattern: '^[a-zA-Z0-9-_]{1,128}$'
        },
        supportsBinary: {
          type: 'boolean',
          default: false
        },
        protocolVersion: {
          type: 'string',
          default: '1.0'
        },
        // 直接连接模式的字段
        address: {
          type: 'string',
          minLength: 1,
          maxLength: 255
        },
        port: {
          type: 'integer',
          minimum: 1,
          maximum: 65535,
          default: 22
        },
        username: {
          type: 'string',
          minLength: 1,
          maxLength: 255
        },
        password: {
          type: 'string',
          maxLength: 1024
        },
        privateKey: {
          type: 'string',
          maxLength: 16384
        },
        passphrase: {
          type: 'string',
          maxLength: 1024
        },
        timeout: {
          type: 'integer',
          minimum: 1000,
          maximum: 60000,
          default: 15000
        }
      },
      additionalProperties: false
    }
  }
};

// 认证消息Schema
const authMessageSchema = {
  ...baseMessageSchema,
  properties: {
    ...baseMessageSchema.properties,
    type: { const: 'auth' },
    data: {
      type: 'object',
      required: ['connectionId'],
      properties: {
        connectionId: {
          type: 'string',
          pattern: '^[a-zA-Z0-9-_]{1,128}$'
        },
        address: {
          type: 'string',
          minLength: 1,
          maxLength: 255
        },
        port: {
          type: 'integer',
          minimum: 1,
          maximum: 65535,
          default: 22
        },
        username: {
          type: 'string',
          minLength: 1,
          maxLength: 255
        },
        password: {
          type: 'string',
          maxLength: 1024
        },
        privateKey: {
          type: 'string',
          maxLength: 16384
        },
        passphrase: {
          type: 'string',
          maxLength: 1024
        }
      },
      additionalProperties: false
    }
  }
};

// 认证消息Schema (加密认证)
const authenticateMessageSchema = {
  ...baseMessageSchema,
  properties: {
    ...baseMessageSchema.properties,
    type: { const: 'authenticate' },
    data: {
      type: 'object',
      required: ['connectionId'],
      properties: {
        connectionId: {
          type: 'string',
          pattern: '^[a-zA-Z0-9-_]{1,128}$'
        },
        encryptedPayload: {
          type: 'string',
          maxLength: 32768 // 32KB限制，足够容纳加密的认证信息
        },
        keyId: {
          type: 'string',
          maxLength: 256
        },
        // 非加密字段
        address: {
          type: 'string',
          minLength: 1,
          maxLength: 255
        },
        port: {
          type: 'integer',
          minimum: 1,
          maximum: 65535,
          default: 22
        },
        username: {
          type: 'string',
          minLength: 1,
          maxLength: 255
        }
      },
      additionalProperties: false
    }
  }
};

// 数据消息Schema
const dataMessageSchema = {
  ...baseMessageSchema,
  properties: {
    ...baseMessageSchema.properties,
    type: { const: 'data' },
    data: {
      type: 'object',
      required: ['sessionId', 'data'],
      properties: {
        sessionId: {
          type: 'string',
          pattern: '^[a-zA-Z0-9-_]{1,128}$'
        },
        data: {
          type: 'string',
          maxLength: 1048576 // 1MB限制
        }
      },
      additionalProperties: false
    }
  }
};

// 调整大小消息Schema
const resizeMessageSchema = {
  ...baseMessageSchema,
  properties: {
    ...baseMessageSchema.properties,
    type: { const: 'resize' },
    data: {
      type: 'object',
      required: ['sessionId', 'cols', 'rows'],
      properties: {
        sessionId: {
          type: 'string',
          pattern: '^[a-zA-Z0-9-_]{1,128}$'
        },
        cols: {
          type: 'integer',
          minimum: 1,
          maximum: 1000
        },
        rows: {
          type: 'integer',
          minimum: 1,
          maximum: 1000
        }
      },
      additionalProperties: false
    }
  }
};

// SSH执行命令消息Schema
const sshExecMessageSchema = {
  ...baseMessageSchema,
  properties: {
    ...baseMessageSchema.properties,
    type: { const: 'ssh_exec' },
    data: {
      type: 'object',
      required: ['sessionId', 'command'],
      properties: {
        sessionId: {
          type: 'string',
          pattern: '^[a-zA-Z0-9-_]{1,128}$'
        },
        command: {
          type: 'string',
          minLength: 1,
          maxLength: 4096
        },
        timeout: {
          type: 'integer',
          minimum: 1000,
          maximum: 300000,
          default: 30000
        }
      },
      additionalProperties: false
    }
  }
};

// Ping消息Schema
const pingMessageSchema = {
  ...baseMessageSchema,
  properties: {
    ...baseMessageSchema.properties,
    type: { const: 'ping' },
    data: {
      type: 'object',
      required: ['sessionId'],
      properties: {
        sessionId: {
          type: 'string',
          pattern: '^[a-zA-Z0-9-_]{1,128}$'
        },
        timestamp: {
          type: 'number'
        },
        clientSendTime: {
          type: 'number'
        },
        requestId: {
          type: 'string',
          maxLength: 128
        },
        measureLatency: {
          type: 'boolean'
        },
        client: {
          type: 'string',
          maxLength: 64
        },
        immediate: {
          type: 'boolean'
        },
        webSocketLatency: {
          type: 'number'
        }
      },
      additionalProperties: false
    }
  }
};

// Pong消息Schema
const pongMessageSchema = {
  ...baseMessageSchema,
  properties: {
    ...baseMessageSchema.properties,
    type: { const: 'pong' },
    data: {
      type: 'object',
      required: ['sessionId'],
      properties: {
        sessionId: {
          type: 'string',
          pattern: '^[a-zA-Z0-9-_]{1,128}$'
        },
        timestamp: {
          type: 'number'
        },
        requestId: {
          type: 'string',
          maxLength: 128
        },
        serverTime: {
          type: 'number'
        },
        latency: {
          type: 'number'
        }
      },
      additionalProperties: false
    }
  }
};

// Disconnect消息Schema
const disconnectMessageSchema = {
  ...baseMessageSchema,
  properties: {
    ...baseMessageSchema.properties,
    type: { const: 'disconnect' },
    data: {
      type: 'object',
      required: ['sessionId'],
      properties: {
        sessionId: {
          type: 'string',
          pattern: '^[a-zA-Z0-9-_]{1,128}$'
        },
        reason: {
          type: 'string',
          maxLength: 256
        }
      },
      additionalProperties: false
    }
  }
};

// SFTP初始化消息Schema
const sftpInitMessageSchema = {
  ...baseMessageSchema,
  properties: {
    ...baseMessageSchema.properties,
    type: { const: 'sftp_init' },
    data: {
      type: 'object',
      required: ['sessionId'],
      properties: {
        sessionId: {
          type: 'string',
          pattern: '^[a-zA-Z0-9-_]{1,128}$'
        }
      },
      additionalProperties: false
    }
  }
};

// SFTP列表目录消息Schema
const sftpListMessageSchema = {
  ...baseMessageSchema,
  properties: {
    ...baseMessageSchema.properties,
    type: { const: 'sftp_list' },
    data: {
      type: 'object',
      required: ['sessionId', 'path'],
      properties: {
        sessionId: {
          type: 'string',
          pattern: '^[a-zA-Z0-9-_]{1,128}$'
        },
        path: {
          type: 'string',
          maxLength: 4096
        },
        operationId: {
          type: 'string',
          maxLength: 128
        }
      },
      additionalProperties: false
    }
  }
};

// SFTP上传消息Schema
const sftpUploadMessageSchema = {
  ...baseMessageSchema,
  properties: {
    ...baseMessageSchema.properties,
    type: { const: 'sftp_upload' },
    data: {
      type: 'object',
      required: ['sessionId', 'filename', 'path', 'content'],
      properties: {
        sessionId: {
          type: 'string',
          pattern: '^[a-zA-Z0-9-_]{1,128}$'
        },
        filename: {
          type: 'string',
          maxLength: 255
        },
        path: {
          type: 'string',
          maxLength: 4096
        },
        content: {
          type: 'string',
          maxLength: 104857600 // 100MB限制
        },
        size: {
          type: 'integer',
          minimum: 0
        },
        operationId: {
          type: 'string',
          maxLength: 128
        }
      },
      additionalProperties: false
    }
  }
};

// SFTP通用操作消息Schema (用于delete, mkdir, chmod等)
const sftpOperationMessageSchema = {
  ...baseMessageSchema,
  properties: {
    ...baseMessageSchema.properties,
    type: {
      enum: ['sftp_delete', 'sftp_mkdir', 'sftp_chmod', 'sftp_stat', 'sftp_download', 'sftp_rename', 'sftp_move', 'sftp_copy']
    },
    data: {
      type: 'object',
      required: ['sessionId', 'path'],
      properties: {
        sessionId: {
          type: 'string',
          pattern: '^[a-zA-Z0-9-_]{1,128}$'
        },
        path: {
          type: 'string',
          maxLength: 4096
        },
        oldPath: {
          type: 'string',
          maxLength: 4096
        },
        newPath: {
          type: 'string',
          maxLength: 4096
        },
        mode: {
          type: 'string',
          pattern: '^[0-7]{3,4}$'
        },
        permissions: {
          type: 'integer',
          minimum: 0,
          maximum: 511  // 八进制777 = 十进制511
        },
        operationId: {
          type: 'string',
          maxLength: 128
        },
        isDirectory: {
          type: 'boolean'
        }
      },
      additionalProperties: false
    }
  }
};

// SFTP文件夹下载消息Schema
const sftpDownloadFolderMessageSchema = {
  ...baseMessageSchema,
  properties: {
    ...baseMessageSchema.properties,
    type: { const: 'sftp_download_folder' },
    data: {
      type: 'object',
      required: ['sessionId', 'path'],
      properties: {
        sessionId: {
          type: 'string',
          pattern: '^[a-zA-Z0-9-_]{1,128}$'
        },
        path: {
          type: 'string',
          maxLength: 4096
        },
        operationId: {
          type: 'string',
          maxLength: 128
        }
      },
      additionalProperties: false
    }
  }
};

// SFTP关闭会话消息Schema
const sftpCloseMessageSchema = {
  ...baseMessageSchema,
  properties: {
    ...baseMessageSchema.properties,
    type: { const: 'sftp_close' },
    data: {
      type: 'object',
      required: ['sessionId'],
      properties: {
        sessionId: {
          type: 'string',
          pattern: '^[a-zA-Z0-9-_]{1,128}$'
        },
        operationId: {
          type: 'string',
          maxLength: 128
        }
      },
      additionalProperties: false
    }
  }
};

// 编译所有Schema
const validators = {
  connect: ajv.compile(connectMessageSchema),
  auth: ajv.compile(authMessageSchema),
  authenticate: ajv.compile(authenticateMessageSchema),
  data: ajv.compile(dataMessageSchema),
  resize: ajv.compile(resizeMessageSchema),
  ping: ajv.compile(pingMessageSchema),
  pong: ajv.compile(pongMessageSchema),
  disconnect: ajv.compile(disconnectMessageSchema),
  ssh_exec: ajv.compile(sshExecMessageSchema),
  // SFTP消息验证器
  sftp_init: ajv.compile(sftpInitMessageSchema),
  sftp_list: ajv.compile(sftpListMessageSchema),
  sftp_upload: ajv.compile(sftpUploadMessageSchema),
  sftp_delete: ajv.compile(sftpOperationMessageSchema),
  sftp_mkdir: ajv.compile(sftpOperationMessageSchema),
  sftp_chmod: ajv.compile(sftpOperationMessageSchema),
  sftp_stat: ajv.compile(sftpOperationMessageSchema),
  sftp_download: ajv.compile(sftpOperationMessageSchema),
  sftp_download_folder: ajv.compile(sftpDownloadFolderMessageSchema),
  sftp_rename: ajv.compile(sftpOperationMessageSchema),
  sftp_move: ajv.compile(sftpOperationMessageSchema),
  sftp_copy: ajv.compile(sftpOperationMessageSchema),
  sftp_fast_delete: ajv.compile(sftpOperationMessageSchema),
  sftp_close: ajv.compile(sftpCloseMessageSchema),
  base: ajv.compile(baseMessageSchema)
};

/**
 * 验证WebSocket消息
 * @param {Object} message 要验证的消息
 * @returns {Object} 验证结果
 */
function validateMessage(message) {
  const result = {
    isValid: false,
    errorCode: null,
    errorMessage: null,
    errors: [],
    sanitizedMessage: null
  };

  try {
    // 首先验证基础消息格式
    const baseValid = validators.base(message);
    if (!baseValid) {
      result.errorCode = ERROR_CODES.INVALID_MESSAGE_FORMAT;
      result.errorMessage = '消息格式不正确';
      result.errors = validators.base.errors || [];
      return result;
    }

    // 根据消息类型进行具体验证
    const messageType = message.type;
    const validator = validators[messageType];

    if (!validator) {
      result.errorCode = ERROR_CODES.INVALID_FIELD_VALUE;
      result.errorMessage = `不支持的消息类型: ${messageType}`;
      return result;
    }

    // 创建消息副本进行验证（避免修改原消息）
    const messageCopy = JSON.parse(JSON.stringify(message));
    const isValid = validator(messageCopy);

    if (isValid) {
      result.isValid = true;
      result.sanitizedMessage = messageCopy;
    } else {
      result.errorCode = ERROR_CODES.INVALID_MESSAGE_FORMAT;
      result.errorMessage = `${messageType}消息验证失败`;
      result.errors = validator.errors || [];
    }

    return result;
  } catch (error) {
    logger.error('消息验证异常:', error);
    result.errorCode = ERROR_CODES.INTERNAL_ERROR;
    result.errorMessage = '消息验证时发生内部错误';
    return result;
  }
}

/**
 * 创建标准错误响应
 * @param {number} errorCode 错误码
 * @param {string} errorMessage 错误消息
 * @param {string} requestId 请求ID
 * @returns {Object} 错误响应对象
 */
function createErrorResponse(errorCode, errorMessage, requestId = null) {
  return {
    type: 'error',
    data: {
      errorCode,
      errorMessage,
      timestamp: Date.now()
    },
    requestId,
    version: '1.0'
  };
}

/**
 * 格式化验证错误信息
 * @param {Array} errors AJV错误数组
 * @returns {string} 格式化的错误信息
 */
function formatValidationErrors(errors) {
  if (!errors || errors.length === 0) {
    return '未知验证错误';
  }

  return errors.map(error => {
    const path = error.instancePath || error.dataPath || '';
    const message = error.message || '验证失败';
    return path ? `${path}: ${message}` : message;
  }).join('; ');
}

module.exports = {
  validateMessage,
  createErrorResponse,
  formatValidationErrors,
  ERROR_CODES
};
