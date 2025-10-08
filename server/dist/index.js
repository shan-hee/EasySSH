"use strict";
/**
 * SSH WebSocket代理服务器 - TypeScript 入口
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// 环境变量
const path_1 = __importDefault(require("path"));
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const cors_1 = __importDefault(require("cors"));
// 运行时模块（保持与 JS 版一致）
// 这些模块当前为 JS，实现逐步 TS 化
const { initWebSocketServer } = require('./ssh');
const { initMonitoringWebSocketServer } = require('./monitoring');
const { initAIWebSocketServer } = require('./ai');
const { connectDatabase, getDatabaseStatus, closeDatabase } = require('./config/database');
// 路由
const userRoutes = (require('./routes/userRoutes').default) || require('./routes/userRoutes');
const userSettingsRoutes = (require('./routes/userSettings').default) || require('./routes/userSettings');
const monitorRoutes = (require('./routes/monitorRoutes').default) || require('./routes/monitorRoutes');
const connectionRoutes = (require('./routes/connectionRoutes').default) || require('./routes/connectionRoutes');
// 使用 TS 版服务器路由
const serverRoutes = (require('./routes/serverRoutes').default) || require('./routes/serverRoutes');
// 工具
const logger = require('./utils/logger');
const monitoringBridge = require('./services/monitoringBridge');
// ANSI颜色代码
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    red: '\x1b[31m',
    bgGreen: '\x1b[42m',
    bgBlue: '\x1b[44m',
    white: '\x1b[37m'
};
// 端口解析：容错处理（支持 "8001 # 注释"、空白等）
const rawPort = (process.env.SERVER_PORT || '').toString().trim();
const parsedPort = rawPort ? parseInt(rawPort, 10) : NaN;
const PORT = Number.isFinite(parsedPort) ? parsedPort : 8000;
logger.info('环境变量加载状态', {
    NODE_ENV: process.env.NODE_ENV || 'development',
    SERVER_PORT: PORT,
    JWT_SECRET: process.env.JWT_SECRET ? '已设置' : '未设置(使用默认值)',
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ? '已设置' : '未设置(使用默认值)'
});
const initDatabase = () => {
    try {
        connectDatabase();
        return true;
    }
    catch (err) {
        console.error('数据库初始化失败:', err);
        return false;
    }
};
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use(express_1.default.static(path_1.default.join(__dirname, 'public')));
// API 路由
app.use('/api/users', userRoutes);
app.use('/api/users/settings', userSettingsRoutes);
app.use('/api/servers', serverRoutes);
app.use('/api/monitor', monitorRoutes);
app.use('/api/connections', connectionRoutes);
const scriptsRoutes = (require('./routes/scripts').default) || require('./routes/scripts');
const aiRoutes = (require('./routes/aiRoutes').default) || require('./routes/aiRoutes');
app.use('/api/scripts', scriptsRoutes);
app.use('/api/ai', aiRoutes);
// 状态 API
app.get('/api/status', (_req, res) => {
    const packageJson = require('../package.json');
    res.json({
        status: 'running',
        version: packageJson.version,
        databases: getDatabaseStatus(),
        timestamp: new Date().toISOString()
    });
});
const getStatusIcon = (status) => (status === 'connected' ? `${colors.green}✓${colors.reset}` : `${colors.red}✗${colors.reset}`);
const server = http_1.default.createServer(app);
// 初始化 WebSocket 服务
const { sshWss, monitorWss } = initWebSocketServer(server);
const aiWss = initAIWebSocketServer(server);
// 监控桥接
const monitoringService = require('./monitoring');
monitoringBridge.setMonitoringService(monitoringService);
const startApp = async () => {
    const dbInitialized = initDatabase();
    if (!dbInitialized) {
        console.error('无法启动应用：数据库连接失败');
        process.exit(1);
    }
    const host = '::';
    server.listen(PORT, host, () => {
        const protocol = 'http';
        const wsProtocol = 'ws';
        const exampleHost = 'localhost';
        const dbStatus = getDatabaseStatus();
        const now = new Date();
        const timeStr = now.toLocaleTimeString();
        const dateStr = now.toLocaleDateString();
        console.log(`\n${colors.bright}${colors.cyan}SSH WebSocket代理服务器已启动${colors.reset}\n`);
        console.log(`${colors.white}HTTP服务${colors.reset}    : ${colors.yellow}${protocol}://${exampleHost}:${PORT}${colors.reset}`);
        console.log(`${colors.white}SSH WS${colors.reset}      : ${colors.yellow}${wsProtocol}://${exampleHost}:${PORT}/ssh${colors.reset}`);
        console.log(`${colors.white}监控 WS${colors.reset}     : ${colors.yellow}${wsProtocol}://${exampleHost}:${PORT}/monitor${colors.reset}`);
        console.log(`${colors.white}启动时间${colors.reset}    : ${dateStr} ${timeStr}`);
        console.log(`${colors.white}运行环境${colors.reset}    : ${colors.green}${process.env.NODE_ENV || 'development'}${colors.reset}`);
        console.log();
        console.log(`${colors.white}SQLite${colors.reset}      : ${getStatusIcon(dbStatus.sqlite)} ${dbStatus.sqlite}`);
        console.log(`${colors.white}缓存${colors.reset}        : ${getStatusIcon(dbStatus.cache)} ${dbStatus.cache}`);
        console.log(`\n${colors.dim}按 ${colors.bright}Ctrl+C${colors.reset}${colors.dim} 停止服务${colors.reset}\n`);
    });
};
startApp().catch((err) => {
    logger.error('应用启动失败', err);
    process.exit(1);
});
const gracefulShutdown = (signal) => {
    logger.info(`接收到${signal}信号，正在关闭服务器...`);
    try {
        const monitoringBridge = require('./services/monitoringBridge');
        monitoringBridge.cleanup();
        logger.info('监控服务已清理');
    }
    catch (error) {
        logger.error('清理监控服务失败', { error: error.message });
    }
    server.close(() => {
        closeDatabase();
        logger.info('服务器已安全关闭');
        process.exit(0);
    });
};
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
