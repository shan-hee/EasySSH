/**
 * 脚本库数据模型（TypeScript）
 * 处理脚本的数据库操作
 */

import database from '../config/database';
import log from '../utils/logger';

class Script {
  id: number | null;
  name: string;
  description: string;
  command: string;
  author: string;
  tags: any[];
  keywords: any[];
  category: string;
  isPublic: boolean;
  isSystem: boolean;
  usageCount: number;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;

  constructor(data: any = {}) {
    this.id = data.id || null;
    this.name = data.name || '';
    this.description = data.description || '';
    this.command = data.command || '';
    this.author = data.author || '';
    this.tags = Array.isArray(data.tags) ? data.tags : (data.tags ? JSON.parse(data.tags) : []);
    this.keywords = Array.isArray(data.keywords) ? data.keywords : (data.keywords ? JSON.parse(data.keywords) : []);
    this.category = data.category || '默认分类';
    this.isPublic = data.is_public !== undefined ? Boolean(data.is_public) : true;
    this.isSystem = data.is_system !== undefined ? Boolean(data.is_system) : false;
    this.usageCount = data.usage_count || 0;
    this.createdBy = data.created_by || null;
    this.createdAt = data.created_at || new Date().toISOString();
    this.updatedAt = data.updated_at || new Date().toISOString();
  }

  /**
   * 保存脚本到数据库
   */
  async save(): Promise<boolean> {
    const db = database.getDb();
    const now = new Date().toISOString();

    try {
      if (this.id) {
        // 更新现有脚本
        const stmt = db.prepare(`
          UPDATE scripts SET 
            name = ?, description = ?, command = ?, author = ?, 
            tags = ?, keywords = ?, category = ?, is_public = ?, 
            is_system = ?, usage_count = ?, updated_at = ?
          WHERE id = ?
        `);

        const result = stmt.run(
          this.name, this.description, this.command, this.author,
          JSON.stringify(this.tags), JSON.stringify(this.keywords),
          this.category, this.isPublic ? 1 : 0, this.isSystem ? 1 : 0,
          this.usageCount, now, this.id
        );

        this.updatedAt = now;
        return (result?.changes || 0) > 0;
      } else {
        // 创建新脚本
        const stmt = db.prepare(`
          INSERT INTO scripts (
            name, description, command, author, tags, keywords, 
            category, is_public, is_system, usage_count, created_by,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const result = stmt.run(
          this.name, this.description, this.command, this.author,
          JSON.stringify(this.tags), JSON.stringify(this.keywords),
          this.category, this.isPublic ? 1 : 0, this.isSystem ? 1 : 0,
          this.usageCount, this.createdBy, now, now
        );

        this.id = Number((result as any).lastInsertRowid);
        this.createdAt = now;
        this.updatedAt = now;
        return true;
      }
    } catch (error) {
      log.error('保存脚本失败:', error);
      throw error;
    }
  }

  /**
   * 删除脚本
   */
  async delete(): Promise<boolean> {
    if (!this.id) {
      throw new Error('无法删除未保存的脚本');
    }

    const db = database.getDb();
    try {
      const stmt = db.prepare('DELETE FROM scripts WHERE id = ?');
      const result = stmt.run(this.id);
      return (result?.changes || 0) > 0;
    } catch (error) {
      log.error('删除脚本失败:', error);
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
      const stmt = db.prepare('UPDATE scripts SET usage_count = usage_count + 1 WHERE id = ?');
      const result = stmt.run(this.id);
      if ((result?.changes || 0) > 0) {
        this.usageCount += 1;
      }
      return (result?.changes || 0) > 0;
    } catch (error) {
      log.error('更新脚本使用次数失败:', error);
      return false;
    }
  }

  /**
   * 转换为JSON对象
   */
  toJSON(): any {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      command: this.command,
      author: this.author,
      tags: this.tags,
      keywords: this.keywords,
      category: this.category,
      isPublic: this.isPublic,
      isSystem: this.isSystem,
      usageCount: this.usageCount,
      createdBy: this.createdBy,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  /**
   * 根据ID查找脚本
   */
  static async findById(id: number | string): Promise<Script | null> {
    const db = database.getDb();
    try {
      const stmt = db.prepare('SELECT * FROM scripts WHERE id = ?');
      const row = stmt.get(id);
      return row ? new Script(row) : null;
    } catch (error) {
      log.error('查找脚本失败:', error);
      throw error;
    }
  }

  /**
   * 查找所有公开脚本
   */
  static async findPublic(options: any = {}): Promise<Script[]> {
    const db = database.getDb();
    const { limit = 100, offset = 0, category, search } = options || {};

    try {
      let sql = 'SELECT * FROM scripts WHERE is_public = 1';
      const params: any[] = [];

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
      return rows.map(row => new Script(row));
    } catch (error) {
      log.error('查找公开脚本失败:', error);
      throw error;
    }
  }

  /**
   * 获取所有分类
   */
  static async getCategories(): Promise<string[]> {
    const db = database.getDb();
    try {
      const stmt = db.prepare('SELECT DISTINCT category FROM scripts WHERE is_public = 1 ORDER BY category');
      const rows = stmt.all() as any[];
      return rows.map(row => row.category as string);
    } catch (error) {
      log.error('获取脚本分类失败:', error);
      throw error;
    }
  }

  /**
   * 获取热门脚本
   */
  static async getPopular(limit = 10): Promise<Script[]> {
    const db = database.getDb();
    try {
      const stmt = db.prepare(`
        SELECT * FROM scripts 
        WHERE is_public = 1 
        ORDER BY usage_count DESC, updated_at DESC 
        LIMIT ?
      `);
      const rows = stmt.all(limit) as any[];
      return rows.map(row => new Script(row));
    } catch (error) {
      log.error('获取热门脚本失败:', error);
      throw error;
    }
  }

  /**
   * 搜索脚本（支持关键词匹配）
   */
  static async search(query: string, options: any = {}): Promise<Script[]> {
    const db = database.getDb();
    const { limit = 50, offset = 0 } = options || {};

    try {
      const searchPattern = `%${query}%`;
      const stmt = db.prepare(`
        SELECT * FROM scripts 
        WHERE is_public = 1 AND (
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
        searchPattern, searchPattern, searchPattern, searchPattern, searchPattern,
        searchPattern, searchPattern, searchPattern,
        limit, offset
      ) as any[];

      return rows.map(row => new Script(row));
    } catch (error) {
      log.error('搜索脚本失败:', error);
      throw error;
    }
  }
}

module.exports = Script;
export default Script;
