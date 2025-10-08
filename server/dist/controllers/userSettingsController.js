"use strict";
// @ts-nocheck
/**
 * 用户设置控制器
 * 处理用户设置的存储、获取和同步
 */
const { getDb } = require('../config/database');
const log = require('../utils/logger');
class UserSettingsController {
    /**
     * 获取用于终端初始化的最小设置集
     * 仅返回创建终端会话所需字段，避免多拿数据
     * GET /api/users/settings/terminal/minimal
     */
    async getTerminalMinimal(req, res) {
        try {
            const userId = req.user.id;
            const db = getDb();
            // 允许返回的白名单字段（严格控制）
            const ALLOWED_KEYS = new Set([
                'fontFamily',
                'fontSize',
                'lineHeight',
                'cursorStyle',
                'cursorBlink',
                'scrollback',
                'rendererType',
                'fallbackRenderer',
                'copyOnSelect',
                'rightClickSelectsWord',
                'theme'
            ]);
            // 终端背景设置允许字段
            const ALLOWED_BG_KEYS = new Set(['enabled', 'url', 'opacity', 'mode']);
            const row = db.prepare(`SELECT settings_data, version, server_timestamp, updated_at
         FROM user_settings WHERE user_id = ? AND category = 'terminal'`).get(userId);
            let minimalTerminal = {};
            let terminalBackground = {};
            let aiEnabled = false;
            let aiModel = '';
            // 不附带多余元信息，保持最小化
            if (row) {
                try {
                    const data = JSON.parse(row.settings_data || '{}');
                    // 仅挑选白名单字段
                    for (const key of Object.keys(data)) {
                        if (ALLOWED_KEYS.has(key)) {
                            minimalTerminal[key] = data[key];
                        }
                    }
                    // 忽略版本与时间戳等元数据
                }
                catch (e) {
                    // 数据不合法时返回空对象，由前端使用默认值
                    log.warn('解析终端设置失败，返回默认空对象');
                }
            }
            // 读取终端背景设置（独立分类：terminal.background）
            try {
                const bgRow = db
                    .prepare(`SELECT settings_data FROM user_settings WHERE user_id = ? AND category = 'terminal.background'`)
                    .get(userId);
                if (bgRow && bgRow.settings_data) {
                    const bgData = JSON.parse(bgRow.settings_data || '{}');
                    const filtered = {};
                    for (const key of Object.keys(bgData)) {
                        if (ALLOWED_BG_KEYS.has(key))
                            filtered[key] = bgData[key];
                    }
                    terminalBackground = filtered;
                }
            }
            catch (e) {
                // 背景设置读取失败时忽略
            }
            // 读取AI启用状态与模型（仅返回非敏感字段；不返回baseUrl/apiKey）
            try {
                const aiRow = db
                    .prepare(`SELECT settings_data FROM user_settings WHERE user_id = ? AND category = 'ai-config'`)
                    .get(userId);
                if (aiRow && aiRow.settings_data) {
                    const aiData = JSON.parse(aiRow.settings_data);
                    aiEnabled = !!aiData.enabled;
                    if (typeof aiData.model === 'string')
                        aiModel = aiData.model;
                }
            }
            catch (e) {
                // 出错时默认禁用
                aiEnabled = false;
            }
            // 返回严格受控的数据集（仅启用位与模型名称）
            return res.json({
                success: true,
                data: {
                    terminal: minimalTerminal,
                    terminalBackground: terminalBackground,
                    ai: { enabled: aiEnabled, model: aiModel }
                }
            });
        }
        catch (error) {
            log.error('获取终端最小设置失败:', error);
            return res.status(500).json({
                success: false,
                message: '获取终端设置失败',
                error: error.message
            });
        }
    }
    /**
     * 获取用户设置
     * GET /api/users/settings
     */
    async getSettings(req, res) {
        try {
            const userId = req.user.id;
            const { category } = req.query; // 可选：获取特定分类的设置
            const db = getDb();
            let query, params;
            if (category) {
                // 获取特定分类的设置
                query = `
          SELECT category, settings_data, version, client_timestamp, server_timestamp, updated_at
          FROM user_settings 
          WHERE user_id = ? AND category = ?
        `;
                params = [userId, category];
            }
            else {
                // 获取所有设置
                query = `
          SELECT category, settings_data, version, client_timestamp, server_timestamp, updated_at
          FROM user_settings 
          WHERE user_id = ?
        `;
                params = [userId];
            }
            const rows = db.prepare(query).all(...params);
            // 将结果转换为对象格式
            const settings = {};
            rows.forEach(row => {
                try {
                    settings[row.category] = {
                        data: JSON.parse(row.settings_data),
                        version: row.version,
                        clientTimestamp: row.client_timestamp,
                        serverTimestamp: row.server_timestamp,
                        updatedAt: row.updated_at
                    };
                }
                catch (error) {
                    log.error(`解析设置数据失败 [${row.category}]:`, error);
                }
            });
            res.json({
                success: true,
                data: settings,
                timestamp: new Date().toISOString()
            });
        }
        catch (error) {
            log.error('获取用户设置失败:', error);
            res.status(500).json({
                success: false,
                message: '获取设置失败',
                error: error.message
            });
        }
    }
    /**
     * 更新用户设置
     * PUT /api/users/settings
     */
    async updateSettings(req, res) {
        try {
            const userId = req.user.id;
            const { category, data, version, clientTimestamp } = req.body;
            if (!category || !data) {
                return res.status(400).json({
                    success: false,
                    message: '缺少必要参数：category 和 data'
                });
            }
            const db = getDb();
            const now = new Date().toISOString();
            // 检查是否存在冲突
            const existing = db.prepare(`
        SELECT version, server_timestamp 
        FROM user_settings 
        WHERE user_id = ? AND category = ?
      `).get(userId, category);
            let newVersion = 1;
            if (existing) {
                // 检查版本冲突
                if (version && existing.version > version) {
                    return res.status(409).json({
                        success: false,
                        message: '设置版本冲突',
                        conflict: {
                            serverVersion: existing.version,
                            clientVersion: version,
                            serverTimestamp: existing.server_timestamp
                        }
                    });
                }
                newVersion = existing.version + 1;
            }
            // 使用 UPSERT 操作
            const upsertQuery = `
        INSERT INTO user_settings (user_id, category, settings_data, version, client_timestamp, server_timestamp, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, category) 
        DO UPDATE SET 
          settings_data = excluded.settings_data,
          version = excluded.version,
          client_timestamp = excluded.client_timestamp,
          server_timestamp = excluded.server_timestamp,
          updated_at = excluded.updated_at
      `;
            db.prepare(upsertQuery).run(userId, category, JSON.stringify(data), newVersion, clientTimestamp || now, now, now);
            res.json({
                success: true,
                data: {
                    category,
                    version: newVersion,
                    serverTimestamp: now
                },
                message: '设置更新成功'
            });
        }
        catch (error) {
            log.error('更新用户设置失败:', error);
            res.status(500).json({
                success: false,
                message: '更新设置失败',
                error: error.message
            });
        }
    }
    /**
     * 批量更新用户设置
     * PUT /api/users/settings/batch
     */
    async updateSettingsBatch(req, res) {
        try {
            const userId = req.user.id;
            const { settings, clientTimestamp } = req.body;
            if (!settings || typeof settings !== 'object') {
                return res.status(400).json({
                    success: false,
                    message: '缺少必要参数：settings'
                });
            }
            const db = getDb();
            const now = new Date().toISOString();
            const results = {};
            const conflicts = {};
            // 开始事务
            const transaction = db.transaction(() => {
                for (const [category, settingData] of Object.entries(settings)) {
                    try {
                        // 检查现有版本
                        const existing = db.prepare(`
              SELECT version, server_timestamp 
              FROM user_settings 
              WHERE user_id = ? AND category = ?
            `).get(userId, category);
                        let newVersion = 1;
                        if (existing) {
                            // 检查版本冲突
                            if (settingData.version && existing.version > settingData.version) {
                                conflicts[category] = {
                                    serverVersion: existing.version,
                                    clientVersion: settingData.version,
                                    serverTimestamp: existing.server_timestamp
                                };
                                continue;
                            }
                            newVersion = existing.version + 1;
                        }
                        // 更新设置
                        const upsertQuery = `
              INSERT INTO user_settings (user_id, category, settings_data, version, client_timestamp, server_timestamp, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(user_id, category) 
              DO UPDATE SET 
                settings_data = excluded.settings_data,
                version = excluded.version,
                client_timestamp = excluded.client_timestamp,
                server_timestamp = excluded.server_timestamp,
                updated_at = excluded.updated_at
            `;
                        db.prepare(upsertQuery).run(userId, category, JSON.stringify(settingData.data || settingData), newVersion, clientTimestamp || now, now, now);
                        results[category] = {
                            version: newVersion,
                            serverTimestamp: now,
                            status: 'updated'
                        };
                    }
                    catch (error) {
                        log.error(`更新设置失败 [${category}]:`, error);
                        results[category] = {
                            status: 'error',
                            error: error.message
                        };
                    }
                }
            });
            transaction();
            const response = {
                success: true,
                data: results,
                timestamp: now
            };
            if (Object.keys(conflicts).length > 0) {
                response.conflicts = conflicts;
                response.message = '部分设置存在冲突，需要解决';
            }
            else {
                response.message = '批量更新成功';
            }
            res.json(response);
        }
        catch (error) {
            log.error('批量更新用户设置失败:', error);
            res.status(500).json({
                success: false,
                message: '批量更新设置失败',
                error: error.message
            });
        }
    }
    /**
     * 数据同步接口
     * POST /api/users/settings/sync
     */
    async syncSettings(req, res) {
        try {
            const userId = req.user.id;
            const { localSettings, strategy = 'merge' } = req.body;
            if (!localSettings || typeof localSettings !== 'object') {
                return res.status(400).json({
                    success: false,
                    message: '缺少必要参数：localSettings'
                });
            }
            const db = getDb();
            const now = new Date().toISOString();
            const syncResults = {
                uploaded: {},
                conflicts: {},
                errors: {},
                summary: {
                    total: 0,
                    success: 0,
                    conflicts: 0,
                    errors: 0
                }
            };
            // 获取服务器上的所有设置
            const serverSettings = {};
            const serverRows = db.prepare(`
        SELECT category, settings_data, version, server_timestamp
        FROM user_settings
        WHERE user_id = ?
      `).all(userId);
            serverRows.forEach(row => {
                try {
                    serverSettings[row.category] = {
                        data: JSON.parse(row.settings_data),
                        version: row.version,
                        timestamp: row.server_timestamp
                    };
                }
                catch (error) {
                    log.error(`解析服务器设置失败 [${row.category}]:`, error);
                }
            });
            // 开始事务处理同步
            const transaction = db.transaction(() => {
                for (const [category, localData] of Object.entries(localSettings)) {
                    syncResults.summary.total++;
                    try {
                        const serverData = serverSettings[category];
                        if (!serverData) {
                            // 服务器没有此设置，直接上传
                            const upsertQuery = `
                INSERT INTO user_settings (user_id, category, settings_data, version, client_timestamp, server_timestamp, updated_at)
                VALUES (?, ?, ?, 1, ?, ?, ?)
              `;
                            db.prepare(upsertQuery).run(userId, category, JSON.stringify(localData), now, now, now);
                            syncResults.uploaded[category] = {
                                status: 'uploaded',
                                version: 1,
                                timestamp: now
                            };
                            syncResults.summary.success++;
                        }
                        else {
                            // 服务器已有此设置，需要处理冲突
                            if (strategy === 'force_local') {
                                // 强制使用本地数据覆盖服务器
                                const newVersion = serverData.version + 1;
                                const updateQuery = `
                  UPDATE user_settings
                  SET settings_data = ?, version = ?, client_timestamp = ?, server_timestamp = ?, updated_at = ?
                  WHERE user_id = ? AND category = ?
                `;
                                db.prepare(updateQuery).run(JSON.stringify(localData), newVersion, now, now, now, userId, category);
                                syncResults.uploaded[category] = {
                                    status: 'overwritten',
                                    version: newVersion,
                                    timestamp: now
                                };
                                syncResults.summary.success++;
                            }
                            else if (strategy === 'force_server') {
                                // 保持服务器数据不变
                                syncResults.conflicts[category] = {
                                    status: 'server_kept',
                                    serverVersion: serverData.version,
                                    serverTimestamp: serverData.timestamp,
                                    reason: 'force_server_strategy'
                                };
                                syncResults.summary.conflicts++;
                            }
                            else {
                                // 默认合并策略：记录冲突，让客户端决定
                                syncResults.conflicts[category] = {
                                    status: 'conflict',
                                    serverData: serverData.data,
                                    serverVersion: serverData.version,
                                    serverTimestamp: serverData.timestamp,
                                    localData,
                                    reason: 'data_conflict'
                                };
                                syncResults.summary.conflicts++;
                            }
                        }
                    }
                    catch (error) {
                        log.error(`同步设置失败 [${category}]:`, error);
                        syncResults.errors[category] = {
                            status: 'error',
                            error: error.message
                        };
                        syncResults.summary.errors++;
                    }
                }
            });
            transaction();
            res.json({
                success: true,
                data: syncResults,
                message: `同步完成：成功${syncResults.summary.success}个，冲突${syncResults.summary.conflicts}个，错误${syncResults.summary.errors}个`,
                timestamp: now
            });
        }
        catch (error) {
            log.error('数据同步失败:', error);
            res.status(500).json({
                success: false,
                message: '数据同步失败',
                error: error.message
            });
        }
    }
    /**
     * 删除用户设置
     * DELETE /api/users/settings/:category
     */
    async deleteSettings(req, res) {
        try {
            const userId = req.user.id;
            const { category } = req.params;
            const db = getDb();
            const result = db.prepare(`
        DELETE FROM user_settings
        WHERE user_id = ? AND category = ?
      `).run(userId, category);
            if (result.changes === 0) {
                return res.status(404).json({
                    success: false,
                    message: '设置不存在'
                });
            }
            res.json({
                success: true,
                message: '设置删除成功'
            });
        }
        catch (error) {
            log.error('删除用户设置失败:', error);
            res.status(500).json({
                success: false,
                message: '删除设置失败',
                error: error.message
            });
        }
    }
}
module.exports = new UserSettingsController();
