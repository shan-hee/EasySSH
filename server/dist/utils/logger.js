"use strict";
// Bridge stub for compiled dist to reach source JS implementation
// @ts-nocheck
/**
 * 服务器端日志工具
 * 提供标准化的日志输出函数，支持文件轮转和自动清理
 */
const fs = require('fs');
const path = require('path');
// 统一日志目录：
// - Docker 环境默认 /easyssh/logs（保持与旧部署一致）
// - 非 Docker 环境默认 server/logs
const maybeDist = path.resolve(__dirname, '..'); // e.g. server/dist/utils -> server/dist
const BASE_DIR = path.basename(maybeDist) === 'dist' ? path.resolve(maybeDist, '..') : maybeDist; // server
const IN_DOCKER = (() => { try {
    return require('fs').existsSync('/.dockerenv');
}
catch {
    return false;
} })();
const DEFAULT_LOG_DIR = IN_DOCKER ? '/easyssh/logs' : path.join(BASE_DIR, 'logs');
// 日志配置
const NODE_ENV = (process.env.NODE_ENV || 'development').toLowerCase();
const DEFAULT_LOG_LEVEL = NODE_ENV === 'production' ? 'info' : 'debug';
const LOG_CONFIG = {
    maxFileSize: parseInt(process.env.LOG_MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB
    maxBackupFiles: parseInt(process.env.LOG_MAX_BACKUP_FILES) || 5, // 保留5个备份
    maxLogAge: parseInt(process.env.LOG_MAX_AGE_DAYS) || 7, // 保留7天
    logDirectory: (process.env.LOG_DIRECTORY || '').trim() || DEFAULT_LOG_DIR,
    // 布尔环境变量采用原有严格判定策略：只有 === 'true' 才启用
    enableConsoleLog: process.env.LOG_ENABLE_CONSOLE !== 'false', // 默认启用控制台
    // 生产环境默认启用文件日志（若未显式设置 LOG_ENABLE_FILE）
    enableFileLog: typeof process.env.LOG_ENABLE_FILE === 'string'
        ? process.env.LOG_ENABLE_FILE === 'true'
        : NODE_ENV === 'production',
    logFileName: 'app.log',
    logLevel: (process.env.LOG_LEVEL || DEFAULT_LOG_LEVEL).toString().trim().toLowerCase()
};
function ensureLogDirectory() {
    try {
        if (!fs.existsSync(LOG_CONFIG.logDirectory)) {
            fs.mkdirSync(LOG_CONFIG.logDirectory, { recursive: true });
        }
    }
    catch (error) {
        console.error('创建日志目录失败:', error.message);
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
};
const levelColors = {
    DEBUG: colors.cyan,
    INFO: colors.green,
    WARN: colors.yellow,
    ERROR: colors.red
};
const levelOrder = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40
};
function shouldLog(level) {
    const cfg = (LOG_CONFIG.logLevel || DEFAULT_LOG_LEVEL).toLowerCase();
    const want = levelOrder[level.toLowerCase()] ?? 999;
    const threshold = levelOrder[cfg] ?? levelOrder[DEFAULT_LOG_LEVEL];
    return want >= threshold;
}
function checkAndRotateLog(logFilePath) {
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
                    }
                    else {
                        fs.renameSync(oldFile, newFile);
                    }
                }
            }
            if (fs.existsSync(`${logFilePath}.1`)) {
                fs.unlinkSync(`${logFilePath}.1`);
            }
            fs.renameSync(logFilePath, `${logFilePath}.1`);
        }
    }
    catch (error) {
        if (LOG_CONFIG.enableConsoleLog) {
            console.error('日志轮转失败:', error.message);
        }
    }
}
function cleanupOldLogs() {
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
    }
    catch (error) {
        if (LOG_CONFIG.enableConsoleLog) {
            console.error('清理过期日志失败:', error.message);
        }
    }
}
function writeToFile(logMessage) {
    if (!LOG_CONFIG.enableFileLog)
        return;
    try {
        ensureLogDirectory();
        const logFilePath = path.join(LOG_CONFIG.logDirectory, LOG_CONFIG.logFileName);
        checkAndRotateLog(logFilePath);
        fs.appendFile(logFilePath, `${logMessage}\n`, (error) => {
            if (error && LOG_CONFIG.enableConsoleLog) {
                console.error('写入日志文件失败:', error.message);
            }
        });
    }
    catch (error) {
        if (LOG_CONFIG.enableConsoleLog) {
            console.error('日志文件操作失败:', error.message);
        }
    }
}
function truncateSensitiveValue(value, maxLength = 20) {
    if (typeof value === 'string' && value.length > maxLength) {
        return `${value.substring(0, maxLength)}...`;
    }
    return value;
}
function sanitizeData(data) {
    if (data === null || data === undefined)
        return data;
    if (typeof data === 'object') {
        if (Array.isArray(data))
            return data.map(item => sanitizeData(item));
        const result = {};
        for (const key in data) {
            if (/token|password|secret|key|auth|jwt/i.test(key)) {
                result[key] = typeof data[key] === 'string' ? truncateSensitiveValue(data[key]) : data[key];
            }
            else {
                result[key] = sanitizeData(data[key]);
            }
        }
        return result;
    }
    return data;
}
function formatData(data) {
    if (data === undefined || data === null)
        return '';
    const sanitizedData = sanitizeData(data);
    if (typeof sanitizedData === 'object') {
        try {
            return JSON.stringify(sanitizedData);
        }
        catch (error) {
            return String(sanitizedData);
        }
    }
    return String(sanitizedData);
}
function log(level, message, data) {
    if (!shouldLog(level))
        return;
    const timestamp = new Date().toISOString();
    const color = levelColors[level] || colors.white;
    const formattedData = data ? ` ${formatData(data)}` : '';
    const logMessage = `[${timestamp}] [${level}] ${message}${formattedData}`;
    if (LOG_CONFIG.enableConsoleLog) {
        console.log(`${colors.dim}[${timestamp}]${colors.reset} ${color}${colors.bright}[${level}]${colors.reset} ${message}${formattedData}`);
    }
    writeToFile(logMessage);
}
function debug(message, data) { log('DEBUG', message, data); }
function info(message, data) { log('INFO', message, data); }
function warn(message, data) { log('WARN', message, data); }
function error(message, data) { log('ERROR', message, data); }
function table(title, data) {
    const timestamp = new Date().toISOString();
    if (LOG_CONFIG.enableConsoleLog) {
        console.log(`${colors.bright}${colors.cyan}${title}${colors.reset}`);
        console.table(data);
    }
    const tableMessage = `[${timestamp}] [TABLE] ${title} ${JSON.stringify(data, null, 2)}`;
    writeToFile(tableMessage);
}
function cleanupLogs() { cleanupOldLogs(); }
function getLogConfig() { return { ...LOG_CONFIG }; }
if (LOG_CONFIG.enableFileLog) {
    setInterval(() => { cleanupOldLogs(); }, 24 * 60 * 60 * 1000);
    setTimeout(() => { cleanupOldLogs(); }, 5000);
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
