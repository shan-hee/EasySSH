/**
 * 服务器端日志工具
 * 提供标准化的日志输出函数
 */

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
 * 安全处理敏感值，截断超长字符串以避免日志泄露
 * @param {*} value - 需要处理的值
 * @param {number} maxLength - 字符串最大长度
 * @returns {*} - 处理后的值
 */
function truncateSensitiveValue(value, maxLength = 20) {
  if (typeof value === 'string' && value.length > maxLength) {
    return value.substring(0, maxLength) + '...';
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
  
  console.log(
    `${colors.dim}[${timestamp}]${colors.reset} ${color}${colors.bright}[${level}]${colors.reset} ${message}${formattedData}`
  );
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
  console.log(`${colors.bright}${colors.cyan}${title}${colors.reset}`);
  console.table(data);
}

module.exports = {
  debug,
  info,
  warn,
  error,
  table
}; 