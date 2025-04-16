/**
 * 用户数据模型
 * 用于SQLite存储
 */

const bcrypt = require('bcryptjs');
const { connectDatabase } = require('../config/database');

class User {
  constructor(data = {}) {
    this.id = data.id;
    this.username = data.username;
    this.email = data.email;
    this.password = data.password;
    this.profile = data.profile ? (typeof data.profile === 'string' ? JSON.parse(data.profile) : data.profile) : {
      displayName: '',
      avatar: '',
      bio: '',
      location: ''
    };
    this.settings = data.settings ? (typeof data.settings === 'string' ? JSON.parse(data.settings) : data.settings) : {
      theme: 'light',
      fontSize: 14,
      sshConfig: {
        defaultTimeout: 10000,
        keepAliveInterval: 30000
      }
    };
    this.isAdmin = data.isAdmin || false;
    this.status = data.status || 'active';
    this.lastLogin = data.lastLogin;
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
  }

  // 保存用户到数据库
  async save() {
    const db = connectDatabase();
    const now = new Date().toISOString();
    this.updatedAt = now;
    
    // 如果密码被修改，进行哈希处理
    if (this._passwordModified) {
      const salt = await bcrypt.genSalt(10);
      this.password = await bcrypt.hash(this.password, salt);
      this._passwordModified = false;
    }
    
    // 准备JSON字段
    const profileJson = JSON.stringify(this.profile || {});
    const settingsJson = JSON.stringify(this.settings || {});
    
    if (this.id) {
      // 更新现有用户
      const stmt = db.prepare(`
        UPDATE users SET
          username = ?, email = ?, password = ?, profile = ?,
          settings = ?, isAdmin = ?, status = ?, lastLogin = ?,
          updatedAt = ?
        WHERE id = ?
      `);
      
      stmt.run(
        this.username,
        this.email,
        this.password,
        profileJson,
        settingsJson,
        this.isAdmin ? 1 : 0,
        this.status,
        this.lastLogin,
        now,
        this.id
      );
    } else {
      // 创建新用户
      this.createdAt = now;
      
      const stmt = db.prepare(`
        INSERT INTO users (
          username, email, password, profile, settings,
          isAdmin, status, lastLogin, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const info = stmt.run(
        this.username,
        this.email,
        this.password,
        profileJson,
        settingsJson,
        this.isAdmin ? 1 : 0,
        this.status,
        this.lastLogin,
        now,
        now
      );
      
      this.id = info.lastInsertRowid;
    }
    
    return this;
  }

  // 设置密码（标记为已修改）
  setPassword(password) {
    this.password = password;
    this._passwordModified = true;
  }

  // 比较密码
  async comparePassword(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
  }

  // 转换为安全对象（不包含密码）
  toSafeObject() {
    const obj = { ...this };
    delete obj.password;
    delete obj._passwordModified;
    return obj;
  }

  // 转换为普通对象
  toObject() {
    const obj = { ...this };
    delete obj._passwordModified;
    return obj;
  }

  // 静态方法

  // 通过ID查找用户
  static findById(id) {
    const db = connectDatabase();
    const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
    const row = stmt.get(id);
    
    if (!row) return null;
    
    return new User(row);
  }

  // 通过用户名查找用户
  static findByUsername(username) {
    const db = connectDatabase();
    const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
    const row = stmt.get(username);
    
    if (!row) return null;
    
    return new User(row);
  }

  // 通过邮箱查找用户
  static findByEmail(email) {
    const db = connectDatabase();
    const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
    const row = stmt.get(email);
    
    if (!row) return null;
    
    return new User(row);
  }

  // 查找一个符合条件的用户
  static findOne(conditions) {
    const db = connectDatabase();
    
    let query = 'SELECT * FROM users WHERE 1=1';
    const params = [];
    
    if (conditions._id) {
      query += ' AND id = ?';
      params.push(conditions._id);
    } else if (conditions.id) {
      query += ' AND id = ?';
      params.push(conditions.id);
    }
    
    if (conditions.username) {
      query += ' AND username = ?';
      params.push(conditions.username);
    }
    
    if (conditions.email) {
      query += ' AND email = ?';
      params.push(conditions.email);
    }
    
    const stmt = db.prepare(query);
    const row = stmt.get(...params);
    
    if (!row) return null;
    
    return new User(row);
  }

  // 查找所有符合条件的用户
  static find(conditions = {}) {
    const db = connectDatabase();
    
    let query = 'SELECT * FROM users WHERE 1=1';
    const params = [];
    
    if (conditions.status) {
      query += ' AND status = ?';
      params.push(conditions.status);
    }
    
    const stmt = db.prepare(query);
    const rows = stmt.all(...params);
    
    return rows.map(row => new User(row));
  }

  // 查找并更新用户
  static findByIdAndUpdate(id, update, options = {}) {
    const user = this.findById(id);
    if (!user) return null;
    
    // 处理设置字段
    if (update.$set) {
      Object.keys(update.$set).forEach(key => {
        if (key === 'password') {
          user.setPassword(update.$set[key]);
        } else {
          user[key] = update.$set[key];
        }
      });
    }
    
    // 保存更新
    user.save();
    
    // 返回新文档
    if (options.new) {
      return user;
    }
    
    return user;
  }
}

module.exports = User; 