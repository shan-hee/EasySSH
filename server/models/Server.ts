/**
 * 服务器连接数据模型 (TypeScript 版)
 * 与现有 SQLite 存储保持一致
 */

import crypto from 'crypto-js';
const { connectDatabase } = require('../config/database');

export interface SharedInfo {
  isShared: boolean;
  sharedWith: string[];
}

export interface ServerRecord {
  id?: number;
  name: string;
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  usePrivateKey?: boolean;
  description?: string;
  tags?: string[];
  timeout?: number;
  lastConnected?: string;
  connectionCount?: number;
  owner?: string;
  shared?: boolean | SharedInfo;
  sharedWith?: string[]; // 入库时会被 JSON.stringify
  createdAt?: string;
  updatedAt?: string;
}

export type SafeServer = Omit<ServerRecord, 'password' | 'privateKey'>;

export default class Server {
  id?: number;
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  usePrivateKey: boolean;
  description: string;
  tags: string[];
  timeout: number;
  lastConnected?: string;
  connectionCount: number;
  owner?: string;
  shared: SharedInfo;
  createdAt: string;
  updatedAt: string;

  constructor(data: Partial<ServerRecord> = {}) {
    this.id = data.id;
    this.name = data.name || '';
    this.host = data.host || '';
    this.port = data.port ?? 22;
    this.username = data.username || '';
    this.password = data.password;
    this.privateKey = data.privateKey;
    this.usePrivateKey = !!data.usePrivateKey;
    this.description = data.description || '';
    this.tags = Array.isArray(data.tags)
      ? data.tags
      : typeof (data as any).tags === 'string'
        ? (() => {
            try { return JSON.parse((data as any).tags); } catch { return []; }
          })()
        : [];
    this.timeout = data.timeout ?? 10000;
    this.lastConnected = data.lastConnected;
    this.connectionCount = data.connectionCount ?? 0;
    this.owner = data.owner;
    this.shared = {
      isShared: !!(data.shared ?? (data as any).shared),
      sharedWith: Array.isArray(data.sharedWith)
        ? data.sharedWith
        : typeof (data as any).sharedWith === 'string'
          ? (() => { try { return JSON.parse((data as any).sharedWith); } catch { return []; } })()
          : []
    };
    const nowIso = new Date().toISOString();
    this.createdAt = data.createdAt || nowIso;
    this.updatedAt = data.updatedAt || nowIso;
  }

  async save(): Promise<Server> {
    const db: any = connectDatabase();
    const now = new Date().toISOString();
    this.updatedAt = now;

    if (this.password) this.encryptPassword();
    if (this.privateKey) this.encryptPrivateKey();

    if (this.id) {
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
        this.password ?? null,
        this.privateKey ?? null,
        this.usePrivateKey ? 1 : 0,
        this.description,
        JSON.stringify(this.tags ?? []),
        this.timeout,
        this.lastConnected ?? null,
        this.connectionCount,
        this.owner ?? null,
        this.shared.isShared ? 1 : 0,
        JSON.stringify(this.shared.sharedWith ?? []),
        now,
        this.id
      );
    } else {
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
        this.password ?? null,
        this.privateKey ?? null,
        this.usePrivateKey ? 1 : 0,
        this.description,
        JSON.stringify(this.tags ?? []),
        this.timeout,
        this.lastConnected ?? null,
        this.connectionCount,
        this.owner ?? null,
        this.shared.isShared ? 1 : 0,
        JSON.stringify(this.shared.sharedWith ?? []),
        this.createdAt,
        now
      );

      this.id = info.lastInsertRowid as number;
    }

    return this;
  }

  encryptPassword() {
    const secretKey = process.env.ENCRYPTION_KEY || 'default-secret-key';
    if (typeof this.password === 'string') {
      this.password = crypto.AES.encrypt(this.password, secretKey).toString();
    }
  }

  encryptPrivateKey() {
    const secretKey = process.env.ENCRYPTION_KEY || 'default-secret-key';
    if (typeof this.privateKey === 'string') {
      this.privateKey = crypto.AES.encrypt(this.privateKey, secretKey).toString();
    }
  }

  decryptPassword(): string {
    const secretKey = process.env.ENCRYPTION_KEY || 'default-secret-key';
    if (!this.password) return '';
    const bytes = crypto.AES.decrypt(this.password, secretKey);
    return bytes.toString(crypto.enc.Utf8);
  }

  decryptPrivateKey(): string {
    const secretKey = process.env.ENCRYPTION_KEY || 'default-secret-key';
    if (!this.privateKey) return '';
    const bytes = crypto.AES.decrypt(this.privateKey, secretKey);
    return bytes.toString(crypto.enc.Utf8);
  }

  toSafeObject(): SafeServer {
    const { password: _p, privateKey: _k, ...rest } = this.toObject();
    return rest;
  }

  toObject(): ServerRecord {
    return { ...this };
  }

  // 静态方法 (与 JS 版保持一致)
  static findById(id: number): Server | null {
    const db: any = connectDatabase();
    const row = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
    return row ? new Server(row) : null;
  }

  static findOne(conditions: Partial<ServerRecord> & { _id?: number }): Server | null {
    const db: any = connectDatabase();
    let query = 'SELECT * FROM servers WHERE 1=1';
    const params: any[] = [];

    if ((conditions as any)._id) {
      query += ' AND id = ?';
      params.push((conditions as any)._id);
    } else if (conditions.id) {
      query += ' AND id = ?';
      params.push(conditions.id);
    }
    if (conditions.owner) {
      query += ' AND owner = ?';
      params.push(conditions.owner);
    }

    const row = db.prepare(query).get(...params);
    return row ? new Server(row) : null;
  }

  static find(conditions: Partial<ServerRecord> = {}): Server[] {
    const db: any = connectDatabase();
    let query = 'SELECT * FROM servers WHERE 1=1';
    const params: any[] = [];
    if (conditions.owner) {
      query += ' AND owner = ?';
      params.push(conditions.owner);
    }
    const rows = db.prepare(query).all(...params);
    return rows.map((row: any) => new Server(row));
  }

  static findByIdAndUpdate(id: number, update: any, options: { new?: boolean } = {}): Server | null {
    const server = this.findById(id);
    if (!server) return null;

    if (update.$inc) {
      Object.keys(update.$inc).forEach(key => {
        // @ts-ignore
        server[key] = ((server as any)[key] || 0) + update.$inc[key];
      });
    }
    if (update.$set) {
      Object.keys(update.$set).forEach(key => {
        // @ts-ignore
        server[key] = update.$set[key];
      });
    }

    server.save();
    return options.new ? server : server;
  }

  static deleteOne(conditions: Partial<ServerRecord> & { _id?: number }) {
    const db: any = connectDatabase();
    let query = 'DELETE FROM servers WHERE 1=1';
    const params: any[] = [];
    if ((conditions as any)._id) {
      query += ' AND id = ?';
      params.push((conditions as any)._id);
    } else if (conditions.id) {
      query += ' AND id = ?';
      params.push(conditions.id);
    }
    if (conditions.owner) {
      query += ' AND owner = ?';
      params.push(conditions.owner);
    }
    return db.prepare(query).run(...params);
  }
}
