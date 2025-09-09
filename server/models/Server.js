/**
 * 服务器连接数据模型
 * 用于存储SSH连接配置（SQLite实现）
 */

const crypto = require('crypto-js');
const { connectDatabase } = require('../config/database');

class Server {
  constructor(data = {}) {
    this.id = data.id;
    this.name = data.name;
    this.host = data.host;
    this.port = data.port || 22;
    this.username = data.username;
    this.password = data.password;
    this.privateKey = data.privateKey;
    this.usePrivateKey = data.usePrivateKey || false;
    this.description = data.description || '';
    this.tags = data.tags || [];
    this.timeout = data.timeout || 10000;
    this.lastConnected = data.lastConnected;
    this.connectionCount = data.connectionCount || 0;
    this.owner = data.owner;
    this.shared = {
      isShared: data.shared || false,
      sharedWith: data.sharedWith ? JSON.parse(data.sharedWith) : []
    };
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
  }

  // 保存到数据库
  async save() {
    const db = connectDatabase();
    const now = new Date().toISOString();
    this.updatedAt = now;

    // 加密敏感信息
    if (this.password) {
      this.encryptPassword();
    }

    if (this.privateKey) {
      this.encryptPrivateKey();
    }

    if (this.id) {
      // 更新现有记录
      const stmt = db.prepare(`
        UPDATE servers SET
          name = ?, host = ?, port = ?, username = ?, password = ?,
          privateKey = ?, usePrivateKey = ?, description = ?, tags = ?,
          timeout = ?, lastConnected = ?, connectionCount = ?, owner = ?,
          shared = ?, sharedWith = ?, updatedAt = ?
        WHERE id = ?
      `);

      stmt.run(
        this.name,
        this.host,
        this.port,
        this.username,
        this.password,
        this.privateKey,
        this.usePrivateKey ? 1 : 0,
        this.description,
        Array.isArray(this.tags) ? JSON.stringify(this.tags) : '[]',
        this.timeout,
        this.lastConnected,
        this.connectionCount,
        this.owner,
        this.shared.isShared ? 1 : 0,
        JSON.stringify(this.shared.sharedWith),
        now,
        this.id
      );
    } else {
      // 新增记录
      this.createdAt = now;

      const stmt = db.prepare(`
        INSERT INTO servers (
          name, host, port, username, password, privateKey, usePrivateKey,
          description, tags, timeout, lastConnected, connectionCount, owner,
          shared, sharedWith, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const info = stmt.run(
        this.name,
        this.host,
        this.port,
        this.username,
        this.password,
        this.privateKey,
        this.usePrivateKey ? 1 : 0,
        this.description,
        Array.isArray(this.tags) ? JSON.stringify(this.tags) : '[]',
        this.timeout,
        this.lastConnected,
        this.connectionCount,
        this.owner,
        this.shared.isShared ? 1 : 0,
        JSON.stringify(this.shared.sharedWith),
        this.createdAt,
        now
      );

      this.id = info.lastInsertRowid;
    }

    return this;
  }

  // 加密方法
  encryptPassword() {
    const secretKey = process.env.ENCRYPTION_KEY || 'default-secret-key';
    this.password = crypto.AES.encrypt(this.password, secretKey).toString();
  }

  encryptPrivateKey() {
    const secretKey = process.env.ENCRYPTION_KEY || 'default-secret-key';
    this.privateKey = crypto.AES.encrypt(this.privateKey, secretKey).toString();
  }

  // 解密方法
  decryptPassword() {
    const secretKey = process.env.ENCRYPTION_KEY || 'default-secret-key';
    if (!this.password) return '';

    const bytes = crypto.AES.decrypt(this.password, secretKey);
    return bytes.toString(crypto.enc.Utf8);
  }

  decryptPrivateKey() {
    const secretKey = process.env.ENCRYPTION_KEY || 'default-secret-key';
    if (!this.privateKey) return '';

    const bytes = crypto.AES.decrypt(this.privateKey, secretKey);
    return bytes.toString(crypto.enc.Utf8);
  }

  // 转换为安全对象（不包含密码和私钥）
  toSafeObject() {
    const serverObj = { ...this };
    delete serverObj.password;
    delete serverObj.privateKey;
    return serverObj;
  }

  // 转换为普通对象
  toObject() {
    return { ...this };
  }

  // 静态方法

  // 通过ID查找服务器
  static findById(id) {
    const db = connectDatabase();
    const stmt = db.prepare('SELECT * FROM servers WHERE id = ?');
    const row = stmt.get(id);

    if (!row) return null;

    return new Server(row);
  }

  // 查找一个符合条件的服务器
  static findOne(conditions) {
    const db = connectDatabase();

    let query = 'SELECT * FROM servers WHERE 1=1';
    const params = [];

    if (conditions._id) {
      query += ' AND id = ?';
      params.push(conditions._id);
    } else if (conditions.id) {
      query += ' AND id = ?';
      params.push(conditions.id);
    }

    if (conditions.owner) {
      query += ' AND owner = ?';
      params.push(conditions.owner);
    }

    const stmt = db.prepare(query);
    const row = stmt.get(...params);

    if (!row) return null;

    return new Server(row);
  }

  // 查找符合条件的所有服务器
  static find(conditions = {}) {
    const db = connectDatabase();

    let query = 'SELECT * FROM servers WHERE 1=1';
    const params = [];

    if (conditions.owner) {
      query += ' AND owner = ?';
      params.push(conditions.owner);
    }

    const stmt = db.prepare(query);
    const rows = stmt.all(...params);

    return rows.map(row => new Server(row));
  }

  // 查找并更新服务器
  static findByIdAndUpdate(id, update, options = {}) {
    const server = this.findById(id);
    if (!server) return null;

    // 处理增量字段
    if (update.$inc) {
      Object.keys(update.$inc).forEach(key => {
        server[key] = (server[key] || 0) + update.$inc[key];
      });
    }

    // 处理设置字段
    if (update.$set) {
      Object.keys(update.$set).forEach(key => {
        server[key] = update.$set[key];
      });
    }

    // 保存更新
    server.save();

    // 返回新文档
    if (options.new) {
      return server;
    }

    return server;
  }

  // 删除一个服务器
  static deleteOne(conditions) {
    const db = connectDatabase();

    let query = 'DELETE FROM servers WHERE 1=1';
    const params = [];

    if (conditions._id) {
      query += ' AND id = ?';
      params.push(conditions._id);
    } else if (conditions.id) {
      query += ' AND id = ?';
      params.push(conditions.id);
    }

    if (conditions.owner) {
      query += ' AND owner = ?';
      params.push(conditions.owner);
    }

    const stmt = db.prepare(query);
    return stmt.run(...params);
  }
}

module.exports = Server;
