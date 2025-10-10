/**
 * 用户脚本数据模型（TypeScript）
 * 处理用户自定义脚本的数据库操作
 */

import database from '../config/database';
import log from '../utils/logger';

class UserScript {
  id: number | null;
  userId: number | null;
  name: string;
  description: string;
  command: string;
  tags: any[];
  keywords: any[];
  category: string;
  usageCount: number;
  createdAt: string;
  updatedAt: string;

  constructor(data: any = {}) {
    this.id = data.id || null;
    this.userId = data.user_id || null;
    this.name = data.name || '';
    this.description = data.description || '';
    this.command = data.command || '';
    this.tags = Array.isArray(data.tags) ? data.tags : (data.tags ? JSON.parse(data.tags) : []);
    this.keywords = Array.isArray(data.keywords) ? data.keywords : (data.keywords ? JSON.parse(data.keywords) : []);
    this.category = data.category || '我的脚本';
    this.usageCount = data.usage_count || 0;
    this.createdAt = data.created_at || new Date().toISOString();
    this.updatedAt = data.updated_at || new Date().toISOString();
  }

  /**
   * 保存用户脚本到数据库
   */
  async save(): Promise<boolean> {
    const db = database.getDb();
    const now = new Date().toISOString();

    try {
      if (this.id) {
        // 更新现有脚本
        const stmt = db.prepare(`
          UPDATE user_scripts SET 
            name = ?, description = ?, command = ?, tags = ?, 
            keywords = ?, category = ?, usage_count = ?, updated_at = ?
          WHERE id = ? AND user_id = ?
        `);

        const result = stmt.run(
          this.name, this.description, this.command,
          JSON.stringify(this.tags), JSON.stringify(this.keywords),
          this.category, this.usageCount, now, this.id, this.userId
        );

        this.updatedAt = now;
        return (result?.changes || 0) > 0;
      } else {
        // 创建新脚本
        const stmt = db.prepare(`
          INSERT INTO user_scripts (
            user_id, name, description, command, tags, keywords, 
            category, usage_count, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const result = stmt.run(
          this.userId, this.name, this.description, this.command,
          JSON.stringify(this.tags), JSON.stringify(this.keywords),
          this.category, this.usageCount, now, now
        );

        this.id = Number((result as any).lastInsertRowid);
        this.createdAt = now;
        this.updatedAt = now;
        return true;
      }
    } catch (error) {
      log.error('保存用户脚本失败:', error);
      throw error;
    }
  }

  /**
   * 删除用户脚本
   */
  async delete(): Promise<boolean> {
    if (!this.id || !this.userId) {
      throw new Error('无法删除未保存的脚本');
    }

    const db = database.getDb();
    try {
      const stmt = db.prepare('DELETE FROM user_scripts WHERE id = ? AND user_id = ?');
      const result = stmt.run(this.id, this.userId);
      return (result?.changes || 0) > 0;
    } catch (error) {
      log.error('删除用户脚本失败:', error);
      throw error;
    }
  }

  /**
   * 增加使用次数
   */
  async incrementUsage(): Promise<boolean> {
    if (!this.id) return false;

    const db = database.getDb();
    try {
      const stmt = db.prepare('UPDATE user_scripts SET usage_count = usage_count + 1 WHERE id = ? AND user_id = ?');
      const result = stmt.run(this.id, this.userId);
      if ((result?.changes || 0) > 0) {
        this.usageCount += 1;
      }
      return (result?.changes || 0) > 0;
    } catch (error) {
      log.error('更新用户脚本使用次数失败:', error);
      return false;
    }
  }

  /**
   * 转换为JSON对象
   */
  toJSON(): any {
    return {
      id: this.id,
      userId: this.userId,
      name: this.name,
      description: this.description,
      command: this.command,
      tags: this.tags,
      keywords: this.keywords,
      category: this.category,
      usageCount: this.usageCount,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  /**
   * 根据ID查找用户脚本
   */
  static async findById(id: number | string, userId: number | string): Promise<UserScript | null> {
    const db = database.getDb();
    try {
      const stmt = db.prepare('SELECT * FROM user_scripts WHERE id = ? AND user_id = ?');
      const row = stmt.get(id, userId);
      return row ? new UserScript(row) : null;
    } catch (error) {
      log.error('查找用户脚本失败:', error);
      throw error;
    }
  }

  /**
   * 查找用户的所有脚本
   */
  static async findByUserId(userId: number | string, options: any = {}): Promise<UserScript[]> {
    const db = database.getDb();
    const { limit = 100, offset = 0, category, search } = options || {};

    try {
      let sql = 'SELECT * FROM user_scripts WHERE user_id = ?';
      const params: any[] = [userId];

      if (category) {
        sql += ' AND category = ?';
        params.push(category);
      }

      if (search) {
        sql += ' AND (name LIKE ? OR description LIKE ? OR command LIKE ?)';
        const searchPattern = `%${search}%`;
        params.push(searchPattern, searchPattern, searchPattern);
      }

      sql += ' ORDER BY usage_count DESC, updated_at DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const stmt = db.prepare(sql);
      const rows = stmt.all(...params) as any[];
      return rows.map(row => new UserScript(row));
    } catch (error) {
      log.error('查找用户脚本失败:', error);
      throw error;
    }
  }

  /**
   * 获取用户脚本分类
   */
  static async getUserCategories(userId: number | string): Promise<string[]> {
    const db = database.getDb();
    try {
      const stmt = db.prepare('SELECT DISTINCT category FROM user_scripts WHERE user_id = ? ORDER BY category');
      const rows = stmt.all(userId) as any[];
      return rows.map(row => row.category as string);
    } catch (error) {
      log.error('获取用户脚本分类失败:', error);
      throw error;
    }
  }

  /**
   * 获取用户常用脚本
   */
  static async getUserPopular(userId: number | string, limit = 10): Promise<UserScript[]> {
    const db = database.getDb();
    try {
      const stmt = db.prepare(`
        SELECT * FROM user_scripts 
        WHERE user_id = ? 
        ORDER BY usage_count DESC, updated_at DESC 
        LIMIT ?
      `);
      const rows = stmt.all(userId, limit) as any[];
      return rows.map(row => new UserScript(row));
    } catch (error) {
      log.error('获取用户常用脚本失败:', error);
      throw error;
    }
  }

  /**
   * 搜索用户脚本
   */
  static async searchUserScripts(userId: number | string, query: string, options: any = {}): Promise<UserScript[]> {
    const db = database.getDb();
    const { limit = 50, offset = 0 } = options || {};

    try {
      const searchPattern = `%${query}%`;
      const stmt = db.prepare(`
        SELECT * FROM user_scripts 
        WHERE user_id = ? AND (
          name LIKE ? OR 
          description LIKE ? OR 
          command LIKE ? OR 
          keywords LIKE ? OR
          tags LIKE ?
        )
        ORDER BY 
          CASE 
            WHEN name LIKE ? THEN 1
            WHEN command LIKE ? THEN 2
            WHEN description LIKE ? THEN 3
            ELSE 4
          END,
          usage_count DESC
        LIMIT ? OFFSET ?
      `);

      const rows = stmt.all(
        userId,
        searchPattern, searchPattern, searchPattern, searchPattern, searchPattern,
        searchPattern, searchPattern, searchPattern,
        limit, offset
      ) as any[];

      return rows.map(row => new UserScript(row));
    } catch (error) {
      log.error('搜索用户脚本失败:', error);
      throw error;
    }
  }

  /**
   * 获取用户所有脚本（包括公开脚本和用户脚本）
   */
  static async getAllUserScripts(userId: number | string, options: any = {}): Promise<any[]> {
    const db = database.getDb();
    const { limit = 100, offset = 0, search } = options || {};

    try {
      let sql = `
        SELECT 
          id, name, description, command, tags, keywords, category,
          usage_count, created_at, updated_at, 'public' as source
        FROM scripts 
        WHERE is_public = 1
      `;

      if (search) {
        sql += ' AND (name LIKE ? OR description LIKE ? OR command LIKE ?)';
      }

      sql += `
        UNION ALL
        SELECT 
          id, name, description, command, tags, keywords, category,
          usage_count, created_at, updated_at, 'user' as source
        FROM user_scripts 
        WHERE user_id = ?
      `;

      if (search) {
        sql += ' AND (name LIKE ? OR description LIKE ? OR command LIKE ?)';
      }

      sql += ' ORDER BY usage_count DESC, updated_at DESC LIMIT ? OFFSET ?';

      const params: any[] = [];
      if (search) {
        const searchPattern = `%${search}%`;
        params.push(searchPattern, searchPattern, searchPattern);
      }
      params.push(userId);
      if (search) {
        const searchPattern = `%${search}%`;
        params.push(searchPattern, searchPattern, searchPattern);
      }
      params.push(limit, offset);

      const stmt = db.prepare(sql);
      const rows = stmt.all(...params) as any[];

      return rows.map((row: any) => ({
        ...row,
        tags: row.tags ? JSON.parse(row.tags) : [],
        keywords: row.keywords ? JSON.parse(row.keywords) : []
      }));
    } catch (error) {
      log.error('获取用户所有脚本失败:', error);
      throw error;
    }
  }
}

module.exports = UserScript;
export default UserScript;
