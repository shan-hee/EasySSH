/**
 * 数据库连接配置
 * 使用SQLite + node-cache实现存储和缓存
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const NodeCache = require('node-cache');

// 创建缓存实例
const cache = new NodeCache({
  stdTTL: 3600, // 默认缓存1小时
  checkperiod: 600, // 每10分钟检查过期的条目
  useClones: false // 不使用对象克隆，提高性能
});

// 数据库连接状态
let dbConnected = false;
let db = null;

// 数据库目录
const DB_DIR = path.join(__dirname, '../data');
// 数据库文件路径
const DB_PATH = path.join(DB_DIR, 'easyssh.sqlite');

// 确保数据目录存在
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// 连接SQLite数据库
const connectDatabase = () => {
  if (dbConnected && db) return db;
  
  try {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL'); // 使用WAL模式提高性能
    dbConnected = true;
    
    // 创建用户表
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE,
        password TEXT NOT NULL,
        
        /* 从profile中提取的关键字段 */
        displayName TEXT DEFAULT '',
        avatar TEXT DEFAULT '',
        mfaEnabled INTEGER DEFAULT 0,
        mfaSecret TEXT DEFAULT '',
        
        /* 从settings中提取的关键字段 */
        theme TEXT DEFAULT 'dark',
        fontSize INTEGER DEFAULT 14,
        
        /* 其余不常用配置保留为JSON */
        profileJson TEXT,
        settingsJson TEXT,
        
        isAdmin INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        isDefaultPassword INTEGER DEFAULT 1,
        lastLogin TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `);
    
    // 创建服务器表
    db.exec(`
      CREATE TABLE IF NOT EXISTS servers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER DEFAULT 22,
        username TEXT NOT NULL,
        password TEXT,
        privateKey TEXT,
        usePrivateKey INTEGER DEFAULT 0,
        description TEXT,
        tags TEXT,
        timeout INTEGER DEFAULT 10000,
        lastConnected TEXT,
        connectionCount INTEGER DEFAULT 0,
        owner INTEGER NOT NULL,
        shared INTEGER DEFAULT 0,
        sharedWith TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (owner) REFERENCES users (id)
      )
    `);
    
    return db;
  } catch (error) {
    console.error('SQLite数据库连接失败:', error);
    throw error;
  }
};

// 关闭数据库连接
const closeDatabase = () => {
  if (db) {
    db.close();
    dbConnected = false;
    db = null;
  }
};

// 获取缓存实例
const getCache = () => cache;

// 获取数据库状态
const getDatabaseStatus = () => ({
  sqlite: dbConnected ? 'connected' : 'disconnected',
  cache: 'connected' // 内存缓存始终连接
});

module.exports = {
  connectDatabase,
  closeDatabase,
  getCache,
  getDatabaseStatus
}; 