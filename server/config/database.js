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
    
    // 创建连接表
    db.exec(`
      CREATE TABLE IF NOT EXISTS connections (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER DEFAULT 22,
        username TEXT NOT NULL,
        password TEXT,
        remember_password INTEGER DEFAULT 0,
        privateKey TEXT,
        passphrase TEXT,
        auth_type TEXT DEFAULT 'password',
        description TEXT,
        group_name TEXT DEFAULT '默认分组',
        config TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )
    `);
    
    // 创建连接收藏表
    db.exec(`
      CREATE TABLE IF NOT EXISTS connection_favorites (
        user_id INTEGER NOT NULL,
        connection_id TEXT NOT NULL,
        PRIMARY KEY (user_id, connection_id),
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (connection_id) REFERENCES connections (id) ON DELETE CASCADE
      )
    `);
    
    // 创建连接历史表
    db.exec(`
      CREATE TABLE IF NOT EXISTS connection_history (
        user_id INTEGER NOT NULL,
        connection_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        PRIMARY KEY (user_id, connection_id),
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (connection_id) REFERENCES connections (id) ON DELETE CASCADE
      )
    `);
    
    // 创建连接置顶表
    db.exec(`
      CREATE TABLE IF NOT EXISTS connection_pinned (
        user_id INTEGER NOT NULL,
        connection_id TEXT NOT NULL,
        PRIMARY KEY (user_id, connection_id),
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (connection_id) REFERENCES connections (id) ON DELETE CASCADE
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

// 获取数据库实例
const getDb = () => {
  if (!db) {
    connectDatabase();
  }
  return db;
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
  getDatabaseStatus,
  getDb
}; 