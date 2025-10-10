"use strict";
/**
 * 用户数据模型（TypeScript）
 * 用于SQLite存储
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const database_1 = __importDefault(require("../config/database"));
class User {
    constructor(data = {}) {
        this.id = data.id;
        this.username = data.username;
        this.email = data.email;
        this.password = data.password;
        // 从数据库提取的独立字段
        this.displayName = data.displayName || '';
        this.avatar = data.avatar || '';
        this.mfaEnabled = data.mfaEnabled === 1 || false; // 转换INTEGER到布尔值
        this.mfaSecret = data.mfaSecret || '';
        this.theme = data.theme || 'dark';
        this.fontSize = data.fontSize || 14;
        // 解析其他配置JSON
        let profileData = {};
        let settingsData = {};
        // 解析profileJson
        if (data.profileJson) {
            try {
                profileData = typeof data.profileJson === 'string' ? JSON.parse(data.profileJson) : data.profileJson;
            }
            catch (e) {
                console.error('解析profileJson失败:', e);
            }
        }
        // 解析settingsJson
        if (data.settingsJson) {
            try {
                settingsData = typeof data.settingsJson === 'string' ? JSON.parse(data.settingsJson) : data.settingsJson;
            }
            catch (e) {
                console.error('解析settingsJson失败:', e);
            }
        }
        // 兼容旧的profile和settings字段（用于迁移）
        if (data.profile && !data.profileJson) {
            try {
                const parsedProfile = typeof data.profile === 'string' ? JSON.parse(data.profile) : data.profile;
                this.displayName = parsedProfile.displayName || this.displayName;
                this.avatar = parsedProfile.avatar || this.avatar;
                this.mfaEnabled = parsedProfile.mfaEnabled || this.mfaEnabled;
                this.mfaSecret = parsedProfile.mfaSecret || this.mfaSecret;
                // 其他profile属性复制到profileData
                profileData = { ...parsedProfile };
                delete profileData.displayName;
                delete profileData.avatar;
                delete profileData.mfaEnabled;
                delete profileData.mfaSecret;
            }
            catch (e) {
                console.error('解析旧profile失败:', e);
            }
        }
        if (data.settings && !data.settingsJson) {
            try {
                const parsedSettings = typeof data.settings === 'string' ? JSON.parse(data.settings) : data.settings;
                this.theme = parsedSettings.theme || this.theme;
                this.fontSize = parsedSettings.fontSize || this.fontSize;
                // 其他settings属性复制到settingsData
                settingsData = { ...parsedSettings };
                delete settingsData.theme;
                delete settingsData.fontSize;
            }
            catch (e) {
                console.error('解析旧settings失败:', e);
            }
        }
        // 存储剩余配置属性
        this.profileData = profileData;
        this.settingsData = settingsData;
        // 其他用户属性
        this.isAdmin = data.isAdmin || false;
        this.status = data.status || 'active';
        this.lastLogin = data.lastLogin;
        this.createdAt = data.createdAt || new Date().toISOString();
        this.updatedAt = data.updatedAt || new Date().toISOString();
    }
    // 保存用户到数据库
    async save() {
        const db = database_1.default.connectDatabase();
        const now = new Date().toISOString();
        this.updatedAt = now;
        // 如果密码被修改，进行哈希处理
        if (this._passwordModified) {
            const salt = await bcryptjs_1.default.genSalt(10);
            this.password = await bcryptjs_1.default.hash(this.password || '', salt);
            this._passwordModified = false;
        }
        // 准备JSON字段 - 仅包含非独立字段的数据
        const profileJson = JSON.stringify(this.profileData || {});
        const settingsJson = JSON.stringify(this.settingsData || {});
        if (this.id) {
            // 更新现有用户
            const stmt = db.prepare(`
        UPDATE users SET
          username = ?, email = ?, password = ?, 
          displayName = ?, avatar = ?, mfaEnabled = ?, mfaSecret = ?,
          theme = ?, fontSize = ?, profileJson = ?, settingsJson = ?,
          isAdmin = ?, status = ?, lastLogin = ?,
          updatedAt = ?
        WHERE id = ?
      `);
            stmt.run(this.username, this.email, this.password, this.displayName, this.avatar, this.mfaEnabled ? 1 : 0, this.mfaSecret, this.theme, this.fontSize, profileJson, settingsJson, this.isAdmin ? 1 : 0, this.status, this.lastLogin, now, this.id);
        }
        else {
            // 创建新用户
            this.createdAt = now;
            const stmt = db.prepare(`
        INSERT INTO users (
          username, email, password, 
          displayName, avatar, mfaEnabled, mfaSecret,
          theme, fontSize, profileJson, settingsJson,
          isAdmin, status, lastLogin, 
          createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
            const info = stmt.run(this.username, this.email, this.password, this.displayName, this.avatar, this.mfaEnabled ? 1 : 0, this.mfaSecret, this.theme, this.fontSize, profileJson, settingsJson, this.isAdmin ? 1 : 0, this.status, this.lastLogin, now, now);
            this.id = Number(info.lastInsertRowid);
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
        return await bcryptjs_1.default.compare(candidatePassword, this.password || '');
    }
    // 获取安全用户对象（不包含密码）
    toSafeObject() {
        const userObj = { ...this };
        // 移除敏感信息
        delete userObj.password;
        delete userObj._passwordModified;
        delete userObj.mfaSecret; // 移除敏感的MFA密钥
        // 移除不必要的内部字段
        // 删除profileData和settingsData，不再创建重复的子对象
        delete userObj.profileData;
        delete userObj.settingsData;
        return userObj;
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
        const db = database_1.default.connectDatabase();
        const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
        const row = stmt.get(id);
        if (!row)
            return null;
        return new User(row);
    }
    // 通过用户名查找用户
    static findByUsername(username) {
        const db = database_1.default.connectDatabase();
        const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
        const row = stmt.get(username);
        if (!row)
            return null;
        return new User(row);
    }
    // 通过邮箱查找用户
    static findByEmail(email) {
        const db = database_1.default.connectDatabase();
        const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
        const row = stmt.get(email);
        if (!row)
            return null;
        return new User(row);
    }
    // 查找一个符合条件的用户
    static findOne(conditions) {
        const db = database_1.default.connectDatabase();
        let query = 'SELECT * FROM users WHERE 1=1';
        const params = [];
        if (conditions._id) {
            query += ' AND id = ?';
            params.push(conditions._id);
        }
        else if (conditions.id) {
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
        if (!row)
            return null;
        return new User(row);
    }
    // 查找所有符合条件的用户
    static find(conditions = {}) {
        const db = database_1.default.connectDatabase();
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
        if (!user)
            return null;
        // 处理设置字段
        if (update.$set) {
            Object.keys(update.$set).forEach((key) => {
                if (key === 'password') {
                    user.setPassword(update.$set[key]);
                }
                else {
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
    // 检查是否存在管理员账户
    static countAdmins() {
        const db = database_1.default.connectDatabase();
        const row = db.prepare('SELECT COUNT(*) AS count FROM users WHERE isAdmin = 1').get();
        return row ? row.count : 0;
    }
}
module.exports = User;
