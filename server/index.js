/**
 * SSH WebSocket代理服务器
 * 主入口文件
 */

// 首先加载环境变量
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const express = require('express');
const http = require('http');
const cors = require('cors');
const { initWebSocketServer } = require('./ssh');
const { initMonitoringWebSocketServer } = require('./monitoring');
const { initAIWebSocketServer } = require('./ai');
const { connectDatabase, getDatabaseStatus, closeDatabase } = require('./config/database');
const setupAdmin = require('./scripts/setupAdmin');
const { initializeScripts } = require('./scripts/initScripts');

// 导入路由
const userRoutes = require('./routes/userRoutes');
const userSettingsRoutes = require('./routes/userSettings');
const serverRoutes = require('./routes/serverRoutes');
const monitorRoutes = require('./routes/monitorRoutes');
const connectionRoutes = require('./routes/connectionRoutes');

// 导入日志工具
const logger = require('./utils/logger');

// 导入监控桥接服务
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

// 输出关键环境变量（隐藏实际值，仅显示是否存在）
logger.info('环境变量加载状态', {
  NODE_ENV: process.env.NODE_ENV || 'development',
  SERVER_PORT: process.env.SERVER_PORT || '8000',
  JWT_SECRET: process.env.JWT_SECRET ? '已设置' : '未设置(使用默认值)',
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ? '已设置' : '未设置(使用默认值)'
});

// 初始化数据库连接
const initDatabase = () => {
  try {
    // 连接SQLite数据库
    connectDatabase();
    return true;
  } catch (err) {
    console.error('数据库初始化失败:', err);
    return false;
  }
};

// 创建Express应用
const app = express();
const PORT = process.env.SERVER_PORT || 8000;

// 配置中间件
app.use(cors());
app.use(express.json());

// 服务静态文件
app.use(express.static(path.join(__dirname, 'public')));

// API路由
app.use('/api/users', userRoutes);
app.use('/api/users/settings', userSettingsRoutes);
app.use('/api/servers', serverRoutes);
app.use('/api/monitor', monitorRoutes);
app.use('/api/connections', connectionRoutes);
app.use('/api/scripts', require('./routes/scripts'));
app.use('/api/ai', require('./routes/aiRoutes'));

// 状态API
app.get('/api/status', (req, res) => {
  // 动态读取后端版本号
  const packageJson = require('./package.json');

  res.json({
    status: 'running',
    version: packageJson.version,
    databases: getDatabaseStatus(),
    timestamp: new Date().toISOString()
  });
});

// 获取状态图标
const getStatusIcon = (status) => {
  return status === 'connected' 
    ? `${colors.green}✓${colors.reset}` 
    : `${colors.red}✗${colors.reset}`;
};

// 创建HTTP服务器
const server = http.createServer(app);

// 初始化WebSocket服务（包含SSH、监控和AI）
const { sshWss, monitorWss } = initWebSocketServer(server);

// 初始化AI WebSocket服务
const aiWss = initAIWebSocketServer(server);

// 初始化监控桥接服务
const monitoringService = require('./monitoring');
monitoringBridge.setMonitoringService(monitoringService);

// 更新服务器启动信息，添加监控WebSocket信息
const startApp = async () => {
  // 初始化数据库
  const dbInitialized = initDatabase();
  if (!dbInitialized) {
    console.error('无法启动应用：数据库连接失败');
    process.exit(1);
  }
  
  // 初始化管理员账户
  await setupAdmin();

  // 初始化默认脚本库
  try {
    await initializeScripts();
  } catch (error) {
    logger.warn('初始化脚本库失败，但不影响应用启动:', error.message);
  }

  // 启动服务器
  const host = '::'; // 监听 IPv6，可兼容 IPv4
  server.listen(PORT, host, () => {
    // 获取服务器实际绑定的地址信息
    const addr = server.address();
    const protocol = 'http';
    const wsProtocol = 'ws';
    const displayHost = (addr.address === '::') ? 'localhost' : addr.address;
    const ipv4Host = '127.0.0.1';
    const ipv6Host = '[::1]';
    
    // 获取数据库状态
    const dbStatus = getDatabaseStatus();
    const now = new Date();
    const timeStr = now.toLocaleTimeString();
    const dateStr = now.toLocaleDateString();
    
    // 清除控制台
    console.clear();
    
    console.log(`\n${colors.bright}${colors.cyan}SSH WebSocket代理服务器已启动${colors.reset}\n`);
    
    console.log(`${colors.white}HTTP服务${colors.reset}    : ${colors.yellow}${protocol}://${displayHost}:${PORT}${colors.reset}`);
    console.log(`${colors.white}SSH WS${colors.reset}      : ${colors.yellow}${wsProtocol}://${displayHost}:${PORT}/ssh${colors.reset}`);
    console.log(`${colors.white}监控 WS${colors.reset}     : ${colors.yellow}${wsProtocol}://${displayHost}:${PORT}/monitor${colors.reset}`);
    console.log(`${colors.white}启动时间${colors.reset}    : ${dateStr} ${timeStr}`);
    console.log(`${colors.white}运行环境${colors.reset}    : ${colors.green}${process.env.NODE_ENV || 'development'}${colors.reset}`);
    
    console.log(); // 空行
    
    console.log(`${colors.white}SQLite${colors.reset}      : ${getStatusIcon(dbStatus.sqlite)} ${dbStatus.sqlite}`);
    console.log(`${colors.white}缓存${colors.reset}        : ${getStatusIcon(dbStatus.cache)} ${dbStatus.cache}`);
    
    console.log(`\n${colors.dim}按 ${colors.bright}Ctrl+C${colors.reset}${colors.dim} 停止服务${colors.reset}\n`);
  });
};

// 启动应用
startApp().catch(err => {
  logger.error('应用启动失败', err);
  process.exit(1);
});

// 处理进程退出
process.on('SIGINT', () => {
  logger.info('正在关闭服务器...');
  server.close(() => {
    // 关闭数据库连接
    closeDatabase();
    logger.info('服务器已安全关闭');
    process.exit(0);
  });
});