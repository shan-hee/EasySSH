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
    
    // 创建连接历史表（独立存储，不依赖connections表）
    db.exec(`
      CREATE TABLE IF NOT EXISTS connection_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        connection_id TEXT NOT NULL,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER DEFAULT 22,
        username TEXT NOT NULL,
        description TEXT,
        group_name TEXT DEFAULT '默认分组',
        auth_type TEXT DEFAULT 'password',
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id)
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

    // 创建脚本库表
    db.exec(`
      CREATE TABLE IF NOT EXISTS scripts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        command TEXT NOT NULL,
        author TEXT,
        tags TEXT, -- JSON格式存储标签数组
        keywords TEXT, -- JSON格式存储关键词数组
        category TEXT DEFAULT '默认分类',
        is_public INTEGER DEFAULT 1, -- 是否公开脚本
        is_system INTEGER DEFAULT 0, -- 是否系统内置脚本
        usage_count INTEGER DEFAULT 0, -- 使用次数
        created_by INTEGER, -- 创建者用户ID
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (created_by) REFERENCES users (id)
      )
    `);

    // 创建用户脚本收藏表
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_script_favorites (
        user_id INTEGER NOT NULL,
        script_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, script_id),
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (script_id) REFERENCES scripts (id) ON DELETE CASCADE
      )
    `);

    // 创建用户自定义脚本表
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_scripts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        command TEXT NOT NULL,
        tags TEXT, -- JSON格式存储标签数组
        keywords TEXT, -- JSON格式存储关键词数组
        category TEXT DEFAULT '我的脚本',
        usage_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )
    `);

    // 创建脚本使用历史表
    db.exec(`
      CREATE TABLE IF NOT EXISTS script_usage_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        script_id INTEGER,
        user_script_id INTEGER,
        script_name TEXT NOT NULL,
        command TEXT NOT NULL,
        used_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (script_id) REFERENCES scripts (id) ON DELETE SET NULL,
        FOREIGN KEY (user_script_id) REFERENCES user_scripts (id) ON DELETE SET NULL
      )
    `);

    // 创建脚本执行历史表
    db.exec(`
      CREATE TABLE IF NOT EXISTS script_execution_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        script_id INTEGER,
        script_name TEXT NOT NULL,
        command TEXT NOT NULL,
        connection_id TEXT,
        server_name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER DEFAULT 22,
        username TEXT NOT NULL,
        stdout TEXT,
        stderr TEXT,
        exit_code INTEGER,
        executed_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (script_id) REFERENCES scripts (id) ON DELETE SET NULL
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