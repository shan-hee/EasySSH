/**
 * 服务器端日志工具
 * 提供标准化的日志输出函数，支持文件轮转和自动清理
 */

const fs = require('fs');
const path = require('path');

// 日志配置
const LOG_CONFIG = {
  maxFileSize: parseInt(process.env.LOG_MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB
  maxBackupFiles: parseInt(process.env.LOG_MAX_BACKUP_FILES) || 5,           // 保留5个备份
  maxLogAge: parseInt(process.env.LOG_MAX_AGE_DAYS) || 7,                    // 保留7天
  logDirectory: process.env.LOG_DIRECTORY || path.join(__dirname, '../logs'),
  enableConsoleLog: process.env.LOG_ENABLE_CONSOLE !== 'false',             // 默认启用控制台
  enableFileLog: process.env.LOG_ENABLE_FILE === 'true',                    // 默认禁用文件日志
  logFileName: 'app.log'
};

// 确保日志目录存在
function ensureLogDirectory() {
  try {
    if (!fs.existsSync(LOG_CONFIG.logDirectory)) {
      fs.mkdirSync(LOG_CONFIG.logDirectory, { recursive: true });
    }
  } catch (error) {
    console.error('创建日志目录失败:', error.message);
  }
}

// 只有启用文件日志时才初始化日志目录
if (LOG_CONFIG.enableFileLog) {
  ensureLogDirectory();
}

// ANSI颜色代码
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',

  // 前景色
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  // 背景色
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m'
};

// 日志级别和颜色映射
const levelColors = {
  DEBUG: colors.cyan,
  INFO: colors.green,
  WARN: colors.yellow,
  ERROR: colors.red
};

/**
 * 检查并轮转日志文件
 * @param {string} logFilePath - 日志文件路径
 */
function checkAndRotateLog(logFilePath) {
  try {
    if (!fs.existsSync(logFilePath)) {
      return;
    }

    const stats = fs.statSync(logFilePath);
    if (stats.size > LOG_CONFIG.maxFileSize) {
      // 轮转备份文件
      for (let i = LOG_CONFIG.maxBackupFiles - 1; i >= 1; i--) {
        const oldFile = `${logFilePath}.${i}`;
        const newFile = `${logFilePath}.${i + 1}`;

        if (fs.existsSync(oldFile)) {
          if (i === LOG_CONFIG.maxBackupFiles - 1) {
            fs.unlinkSync(oldFile); // 删除最老的文件
          } else {
            fs.renameSync(oldFile, newFile);
          }
        }
      }

      // 将当前日志文件重命名为 .1
      if (fs.existsSync(`${logFilePath}.1`)) {
        fs.unlinkSync(`${logFilePath}.1`);
      }
      fs.renameSync(logFilePath, `${logFilePath}.1`);
    }
  } catch (error) {
    // 轮转失败时静默处理，不影响日志记录
    if (LOG_CONFIG.enableConsoleLog) {
      console.error('日志轮转失败:', error.message);
    }
  }
}

/**
 * 清理过期的日志文件
 */
function cleanupOldLogs() {
  try {
    const files = fs.readdirSync(LOG_CONFIG.logDirectory);
    const now = Date.now();
    const maxAge = LOG_CONFIG.maxLogAge * 24 * 60 * 60 * 1000; // 转换为毫秒

    files.forEach(file => {
      if (file.startsWith(LOG_CONFIG.logFileName)) {
        const filePath = path.join(LOG_CONFIG.logDirectory, file);
        const stats = fs.statSync(filePath);

        if (now - stats.mtime.getTime() > maxAge) {
          fs.unlinkSync(filePath);
          if (LOG_CONFIG.enableConsoleLog) {
            console.log(`已清理过期日志文件: ${file}`);
          }
        }
      }
    });
  } catch (error) {
    if (LOG_CONFIG.enableConsoleLog) {
      console.error('清理过期日志失败:', error.message);
    }
  }
}

/**
 * 写入日志到文件
 * @param {string} logMessage - 格式化后的日志消息
 */
function writeToFile(logMessage) {
  // 如果未启用文件日志，直接返回
  if (!LOG_CONFIG.enableFileLog) {
    return;
  }

  try {
    // 确保日志目录存在（延迟创建）
    ensureLogDirectory();

    const logFilePath = path.join(LOG_CONFIG.logDirectory, LOG_CONFIG.logFileName);

    // 检查并轮转日志
    checkAndRotateLog(logFilePath);

    // 异步写入文件
    fs.appendFile(logFilePath, `${logMessage}\n`, (error) => {
      if (error && LOG_CONFIG.enableConsoleLog) {
        console.error('写入日志文件失败:', error.message);
      }
    });
  } catch (error) {
    // 文件写入失败时静默处理，不影响控制台输出
    if (LOG_CONFIG.enableConsoleLog) {
      console.error('日志文件操作失败:', error.message);
    }
  }
}

/**
 * 安全处理敏感值，截断超长字符串以避免日志泄露
 * @param {*} value - 需要处理的值
 * @param {number} maxLength - 字符串最大长度
 * @returns {*} - 处理后的值
 */
function truncateSensitiveValue(value, maxLength = 20) {
  if (typeof value === 'string' && value.length > maxLength) {
    return `${value.substring(0, maxLength)}...`;
  }
  return value;
}

/**
 * 递归处理对象中的敏感字段
 * @param {*} data - 要处理的数据
 * @returns {*} - 处理后的数据
 */
function sanitizeData(data) {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'object') {
    if (Array.isArray(data)) {
      return data.map(item => sanitizeData(item));
    }

    const result = {};
    for (const key in data) {
      // 特殊处理敏感字段
      if (/token|password|secret|key|auth|jwt/i.test(key)) {
        if (typeof data[key] === 'string') {
          result[key] = truncateSensitiveValue(data[key]);
        } else {
          result[key] = data[key];
        }
      } else {
        result[key] = sanitizeData(data[key]);
      }
    }
    return result;
  }

  return data;
}

/**
 * 格式化数据对象为字符串
 * @param {*} data - 要格式化的数据
 * @returns {string} - 格式化后的字符串
 */
function formatData(data) {
  if (data === undefined || data === null) {
    return '';
  }

  // 先处理敏感数据
  const sanitizedData = sanitizeData(data);

  if (typeof sanitizedData === 'object') {
    try {
      return JSON.stringify(sanitizedData);
    } catch (error) {
      return String(sanitizedData);
    }
  }

  return String(sanitizedData);
}

/**
 * 通用日志输出函数
 * @param {string} level - 日志级别
 * @param {string} message - 日志消息
 * @param {*} data - 相关数据
 */
function log(level, message, data) {
  const timestamp = new Date().toISOString();
  const color = levelColors[level] || colors.white;
  const formattedData = data ? ` ${formatData(data)}` : '';

  // 格式化日志消息（用于文件和控制台）
  const logMessage = `[${timestamp}] [${level}] ${message}${formattedData}`;

  // 输出到控制台（带颜色）
  if (LOG_CONFIG.enableConsoleLog) {
    console.log(
      `${colors.dim}[${timestamp}]${colors.reset} ${color}${colors.bright}[${level}]${colors.reset} ${message}${formattedData}`
    );
  }

  // 写入到文件（无颜色代码）
  writeToFile(logMessage);
}

/**
 * 调试级别日志
 * @param {string} message - 日志消息
 * @param {*} data - 相关数据
 */
function debug(message, data) {
  log('DEBUG', message, data);
}

/**
 * 信息级别日志
 * @param {string} message - 日志消息
 * @param {*} data - 相关数据
 */
function info(message, data) {
  log('INFO', message, data);
}

/**
 * 警告级别日志
 * @param {string} message - 日志消息
 * @param {*} data - 相关数据
 */
function warn(message, data) {
  log('WARN', message, data);
}

/**
 * 错误级别日志
 * @param {string} message - 日志消息
 * @param {*} data - 相关数据
 */
function error(message, data) {
  log('ERROR', message, data);
}

/**
 * 表格日志，用于展示结构化数据
 * @param {string} title - 表格标题
 * @param {Array|Object} data - 表格数据
 */
function table(title, data) {
  const timestamp = new Date().toISOString();

  // 控制台输出（带颜色和表格格式）
  if (LOG_CONFIG.enableConsoleLog) {
    console.log(`${colors.bright}${colors.cyan}${title}${colors.reset}`);
    console.table(data);
  }

  // 文件输出（纯文本格式）
  const tableMessage = `[${timestamp}] [TABLE] ${title} ${JSON.stringify(data, null, 2)}`;
  writeToFile(tableMessage);
}

/**
 * 手动清理过期日志（可通过API调用）
 */
function cleanupLogs() {
  cleanupOldLogs();
}

/**
 * 获取日志配置信息
 */
function getLogConfig() {
  return { ...LOG_CONFIG };
}

// 只有启用文件日志时才执行定期清理和启动清理
if (LOG_CONFIG.enableFileLog) {
  // 定期清理过期日志（每24小时执行一次）
  setInterval(() => {
    cleanupOldLogs();
  }, 24 * 60 * 60 * 1000);

  // 启动时清理一次过期日志
  setTimeout(() => {
    cleanupOldLogs();
  }, 5000); // 延迟5秒执行，避免启动时阻塞
}

module.exports = {
  debug,
  info,
  warn,
  error,
  table,
  cleanupLogs,
  getLogConfig
};
