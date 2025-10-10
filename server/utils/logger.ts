// Bridge stub for compiled dist to reach source JS implementation
/**
 * 服务器端日志工具（TypeScript）
 * - 标准化输出：debug/info/warn/error/table
 * - 可选文件日志：大小轮转 + 按天清理
 * - 生产/开发环境默认级别与行为
 *
 * 注意：保留 CommonJS 导出以兼容现有 `require('../utils/logger')` 调用。
 */

import fs from 'node:fs';
import path from 'node:path';

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
type LogConfig = {
  maxFileSize: number; // 单个日志文件最大字节数
  maxBackupFiles: number; // 保留备份文件个数
  maxLogAge: number; // 保留天数
  logDirectory: string; // 日志目录
  enableConsoleLog: boolean; // 是否输出到控制台
  enableFileLog: boolean; // 是否写入文件
  logFileName: string; // 文件名
  logLevel: string; // 当前阈值级别（小写）
};

type LoggerApi = {
  debug: (message: string, data?: unknown) => void;
  info: (message: string, data?: unknown) => void;
  warn: (message: string, data?: unknown) => void;
  error: (message: string, data?: unknown) => void;
  table: (title: string, data: unknown) => void;
  cleanupLogs: () => void;
  getLogConfig: () => Readonly<LogConfig>;
};


// 统一日志目录：
// - Docker 环境默认 /easyssh/logs
// - 非 Docker 环境默认 server/logs
// 推断运行根目录（支持 server/dist 以及 server/ 源码目录）
const maybeDist = path.resolve(__dirname, '..'); // e.g. server/dist/utils -> server/dist
const BASE_DIR = path.basename(maybeDist) === 'dist' ? path.resolve(maybeDist, '..') : maybeDist; // server
const IN_DOCKER = (() => { try { return fs.existsSync('/.dockerenv'); } catch { return false; } })();
const DEFAULT_LOG_DIR = IN_DOCKER ? '/easyssh/logs' : path.join(BASE_DIR, 'logs');

// 日志配置
const NODE_ENV = (process.env.NODE_ENV || 'development').toLowerCase();
const DEFAULT_LOG_LEVEL = NODE_ENV === 'production' ? 'info' : 'debug';

const LOG_CONFIG: LogConfig = {
  maxFileSize: parseInt(process.env.LOG_MAX_FILE_SIZE ?? '', 10) || 10 * 1024 * 1024, // 10MB
  maxBackupFiles: parseInt(process.env.LOG_MAX_BACKUP_FILES ?? '', 10) || 5,           // 保留5个备份
  maxLogAge: parseInt(process.env.LOG_MAX_AGE_DAYS ?? '', 10) || 7,                    // 保留7天
  logDirectory: (process.env.LOG_DIRECTORY || '').trim() || DEFAULT_LOG_DIR,
  enableConsoleLog: process.env.LOG_ENABLE_CONSOLE !== 'false',              // 默认启用控制台
  // 生产环境默认启用文件日志（若未显式设置 LOG_ENABLE_FILE）
  enableFileLog: typeof process.env.LOG_ENABLE_FILE === 'string'
    ? process.env.LOG_ENABLE_FILE === 'true'
    : NODE_ENV === 'production',
  logFileName: 'app.log',
  logLevel: (process.env.LOG_LEVEL || DEFAULT_LOG_LEVEL).toString().trim().toLowerCase()
};

function ensureLogDirectory(): void {
  try {
    if (!fs.existsSync(LOG_CONFIG.logDirectory)) {
      fs.mkdirSync(LOG_CONFIG.logDirectory, { recursive: true });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('创建日志目录失败:', msg);
  }
}

if (LOG_CONFIG.enableFileLog) {
  ensureLogDirectory();
}

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m'
} as const;

const levelColors: Record<LogLevel, string> = {
  DEBUG: colors.cyan,
  INFO: colors.green,
  WARN: colors.yellow,
  ERROR: colors.red
};

const levelOrder: Record<string, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

function shouldLog(level: string): boolean {
  const cfg = (LOG_CONFIG.logLevel || DEFAULT_LOG_LEVEL).toLowerCase();
  const want = levelOrder[level.toLowerCase()] ?? 999;
  const threshold = levelOrder[cfg] ?? levelOrder[DEFAULT_LOG_LEVEL];
  return want >= threshold;
}

function checkAndRotateLog(logFilePath: string): void {
  try {
    if (!fs.existsSync(logFilePath)) {
      return;
    }
    const stats = fs.statSync(logFilePath);
    if (stats.size > LOG_CONFIG.maxFileSize) {
      for (let i = LOG_CONFIG.maxBackupFiles - 1; i >= 1; i--) {
        const oldFile = `${logFilePath}.${i}`;
        const newFile = `${logFilePath}.${i + 1}`;
        if (fs.existsSync(oldFile)) {
          if (i === LOG_CONFIG.maxBackupFiles - 1) {
            fs.unlinkSync(oldFile);
          } else {
            fs.renameSync(oldFile, newFile);
          }
        }
      }
      if (fs.existsSync(`${logFilePath}.1`)) {
        fs.unlinkSync(`${logFilePath}.1`);
      }
      fs.renameSync(logFilePath, `${logFilePath}.1`);
    }
  } catch (error) {
    if (LOG_CONFIG.enableConsoleLog) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('日志轮转失败:', msg);
    }
  }
}

function cleanupOldLogs(): void {
  try {
    const files = fs.readdirSync(LOG_CONFIG.logDirectory);
    const now = Date.now();
    const maxAge = LOG_CONFIG.maxLogAge * 24 * 60 * 60 * 1000;
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
      const msg = error instanceof Error ? error.message : String(error);
      console.error('清理过期日志失败:', msg);
    }
  }
}

function writeToFile(logMessage: string): void {
  if (!LOG_CONFIG.enableFileLog) return;
  try {
    ensureLogDirectory();
    const logFilePath = path.join(LOG_CONFIG.logDirectory, LOG_CONFIG.logFileName);
    checkAndRotateLog(logFilePath);
    fs.appendFile(logFilePath, `${logMessage}\n`, (error) => {
      if (error && LOG_CONFIG.enableConsoleLog) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('写入日志文件失败:', msg);
      }
    });
  } catch (error) {
    if (LOG_CONFIG.enableConsoleLog) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('日志文件操作失败:', msg);
    }
  }
}

function truncateSensitiveValue(value: unknown, maxLength = 20): unknown {
  if (typeof value === 'string' && value.length > maxLength) {
    return `${value.substring(0, maxLength)}...`;
  }
  return value;
}

function sanitizeData(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data === 'object') {
    if (Array.isArray(data)) return data.map(item => sanitizeData(item));
    const input = data as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key in input) {
      if (/token|password|secret|key|auth|jwt/i.test(key)) {
        const v = input[key];
        result[key] = typeof v === 'string' ? truncateSensitiveValue(v) : v;
      } else {
        result[key] = sanitizeData(input[key]);
      }
    }
    return result;
  }
  return data;
}

function formatData(data: unknown): string {
  if (data === undefined || data === null) return '';
  const sanitizedData = sanitizeData(data);
  if (typeof sanitizedData === 'object') {
    try { return JSON.stringify(sanitizedData); } catch {
      return String(sanitizedData);
    }
  }
  return String(sanitizedData);
}

function log(level: LogLevel, message: string, data?: unknown): void {
  if (!shouldLog(level)) return;
  const timestamp = new Date().toISOString();
  const color = levelColors[level] || colors.white;
  const formattedData = data ? ` ${formatData(data)}` : '';
  const logMessage = `[${timestamp}] [${level}] ${message}${formattedData}`;
  if (LOG_CONFIG.enableConsoleLog) {
    console.log(`${colors.dim}[${timestamp}]${colors.reset} ${color}${colors.bright}[${level}]${colors.reset} ${message}${formattedData}`);
  }
  writeToFile(logMessage);
}

function debug(message: string, data?: unknown): void { log('DEBUG', message, data); }
function info(message: string, data?: unknown): void { log('INFO', message, data); }
function warn(message: string, data?: unknown): void { log('WARN', message, data); }
function error(message: string, data?: unknown): void { log('ERROR', message, data); }

function table(title: string, data: unknown): void {
  const timestamp = new Date().toISOString();
  if (LOG_CONFIG.enableConsoleLog) {
    console.log(`${colors.bright}${colors.cyan}${title}${colors.reset}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    console.table(data as any);
  }
  const tableMessage = `[${timestamp}] [TABLE] ${title} ${JSON.stringify(data, null, 2)}`;
  writeToFile(tableMessage);
}

function cleanupLogs(): void { cleanupOldLogs(); }

function getLogConfig(): Readonly<LogConfig> { return { ...LOG_CONFIG }; }

if (LOG_CONFIG.enableFileLog) {
  setInterval(() => { cleanupOldLogs(); }, 24 * 60 * 60 * 1000);
  setTimeout(() => { cleanupOldLogs(); }, 5000);
}

const logger: LoggerApi = {
  debug,
  info,
  warn,
  error,
  table,
  cleanupLogs,
  getLogConfig
};

// CommonJS 导出，保持对现有 require() 的兼容
module.exports = logger;

// 也支持 TS/ESM 默认导入（如：import logger from '../utils/logger.js'）
export default logger;
