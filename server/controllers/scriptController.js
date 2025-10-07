/**
 * 脚本库控制器
 * 处理脚本相关的HTTP请求
 */

const Script = require('../models/Script');
const UserScript = require('../models/UserScript');
const { getDb } = require('../config/database');
const log = require('../utils/logger');
const { Client } = require('ssh2');
const { decryptPassword, decryptPrivateKey } = require('../utils/encryption');

/**
 * 执行SSH命令
 */
async function executeSSHCommand({ host, port, username, password, privateKey, authType, command }) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const startTime = Date.now();

    conn.on('ready', () => {
      log.info(`SSH连接已建立: ${username}@${host}:${port}`);

      conn.exec(command, (err, stream) => {
        if (err) {
          conn.end();
          return reject(new Error(`执行命令失败: ${err.message}`));
        }

        let stdout = '';
        let stderr = '';

        stream.on('close', (code) => {
          const duration = Date.now() - startTime;
          conn.end();

          log.info(`命令执行完成: 退出码=${code}, 耗时=${duration}ms`);

          resolve({
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: code,
            executedAt: new Date().toISOString(),
            duration
          });
        });

        stream.on('data', (data) => {
          stdout += data.toString();
        });

        stream.stderr.on('data', (data) => {
          stderr += data.toString();
        });
      });
    });

    conn.on('error', (err) => {
      log.error(`SSH连接错误: ${err.message}`);
      reject(new Error(`SSH连接失败: ${err.message}`));
    });

    // 准备连接配置
    const connectConfig = {
      host,
      port,
      username,
      readyTimeout: 10000
    };

    // 根据认证类型设置认证信息
    if (authType === 'key' && privateKey) {
      connectConfig.privateKey = privateKey;
    } else if (password) {
      connectConfig.password = password;
    } else {
      return reject(new Error('缺少认证信息：需要密码或私钥'));
    }

    // 连接SSH服务器
    conn.connect(connectConfig);
  });
}

/**
 * 获取公开脚本列表
 */
const getPublicScripts = async (req, res) => {
  try {
    const { page = 1, limit = 20, category, search } = req.query;
    const offset = (page - 1) * limit;

    const scripts = await Script.findPublic({
      limit: parseInt(limit),
      offset: parseInt(offset),
      category,
      search
    });

    res.json({
      success: true,
      scripts: scripts.map(script => script.toJSON()),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: scripts.length
      }
    });
  } catch (error) {
    log.error('获取公开脚本失败:', error);
    res.status(500).json({
      success: false,
      message: '获取脚本列表失败'
    });
  }
};

/**
 * 获取脚本分类
 */
const getCategories = async (req, res) => {
  try {
    const categories = await Script.getCategories();
    res.json({
      success: true,
      categories
    });
  } catch (error) {
    log.error('获取脚本分类失败:', error);
    res.status(500).json({
      success: false,
      message: '获取分类失败'
    });
  }
};

/**
 * 获取热门脚本
 */
const getPopularScripts = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const scripts = await Script.getPopular(parseInt(limit));

    res.json({
      success: true,
      scripts: scripts.map(script => script.toJSON())
    });
  } catch (error) {
    log.error('获取热门脚本失败:', error);
    res.status(500).json({
      success: false,
      message: '获取热门脚本失败'
    });
  }
};

/**
 * 搜索脚本
 */
const searchScripts = async (req, res) => {
  try {
    const { q: query, page = 1, limit = 20 } = req.query;

    if (!query || query.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: '搜索关键词不能为空'
      });
    }

    const offset = (page - 1) * limit;
    const scripts = await Script.search(query.trim(), {
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({
      success: true,
      scripts: scripts.map(script => script.toJSON()),
      query: query.trim(),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: scripts.length
      }
    });
  } catch (error) {
    log.error('搜索脚本失败:', error);
    res.status(500).json({
      success: false,
      message: '搜索失败'
    });
  }
};

/**
 * 获取用户脚本列表
 */
const getUserScripts = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20, category, search } = req.query;
    const offset = (page - 1) * limit;

    const scripts = await UserScript.findByUserId(userId, {
      limit: parseInt(limit),
      offset: parseInt(offset),
      category,
      search
    });

    res.json({
      success: true,
      scripts: scripts.map(script => script.toJSON()),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: scripts.length
      }
    });
  } catch (error) {
    log.error('获取用户脚本失败:', error);
    res.status(500).json({
      success: false,
      message: '获取用户脚本失败'
    });
  }
};

/**
 * 创建用户脚本
 */
const createUserScript = async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, description, command, tags, keywords, category } = req.body;

    if (!name || !command) {
      return res.status(400).json({
        success: false,
        message: '脚本名称和命令不能为空'
      });
    }

    const userScript = new UserScript({
      user_id: userId,
      name: name.trim(),
      description: description?.trim() || '',
      command: command.trim(),
      tags: Array.isArray(tags) ? tags : [],
      keywords: Array.isArray(keywords) ? keywords : [],
      category: category?.trim() || '我的脚本'
    });

    await userScript.save();

    res.status(201).json({
      success: true,
      script: userScript.toJSON(),
      message: '脚本创建成功'
    });
  } catch (error) {
    log.error('创建用户脚本失败:', error);
    res.status(500).json({
      success: false,
      message: '创建脚本失败'
    });
  }
};

/**
 * 更新用户脚本
 */
const updateUserScript = async (req, res) => {
  try {
    const userId = req.user.id;
    const scriptId = req.params.id;
    const { name, description, command, tags, keywords, category } = req.body;

    const userScript = await UserScript.findById(scriptId, userId);
    if (!userScript) {
      return res.status(404).json({
        success: false,
        message: '脚本不存在'
      });
    }

    // 更新脚本信息
    if (name !== undefined) userScript.name = name.trim();
    if (description !== undefined) userScript.description = description.trim();
    if (command !== undefined) userScript.command = command.trim();
    if (Array.isArray(tags)) userScript.tags = tags;
    if (Array.isArray(keywords)) userScript.keywords = keywords;
    if (category !== undefined) userScript.category = category.trim() || '我的脚本';

    await userScript.save();

    res.json({
      success: true,
      script: userScript.toJSON(),
      message: '脚本更新成功'
    });
  } catch (error) {
    log.error('更新用户脚本失败:', error);
    res.status(500).json({
      success: false,
      message: '更新脚本失败'
    });
  }
};

/**
 * 删除用户脚本
 */
const deleteUserScript = async (req, res) => {
  try {
    const userId = req.user.id;
    const scriptId = req.params.id;

    const userScript = await UserScript.findById(scriptId, userId);
    if (!userScript) {
      return res.status(404).json({
        success: false,
        message: '脚本不存在'
      });
    }

    await userScript.delete();

    res.json({
      success: true,
      message: '脚本删除成功'
    });
  } catch (error) {
    log.error('删除用户脚本失败:', error);
    res.status(500).json({
      success: false,
      message: '删除脚本失败'
    });
  }
};

/**
 * 获取用户所有脚本（包括公开脚本和用户脚本）
 */
const getAllUserScripts = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 100, search } = req.query;
    const offset = (page - 1) * limit;

    const scripts = await UserScript.getAllUserScripts(userId, {
      limit: parseInt(limit),
      offset: parseInt(offset),
      search
    });

    res.json({
      success: true,
      scripts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: scripts.length
      }
    });
  } catch (error) {
    log.error('获取用户所有脚本失败:', error);
    res.status(500).json({
      success: false,
      message: '获取脚本失败'
    });
  }
};

/**
 * 获取脚本增量更新
 */
const getScriptsIncremental = async (req, res) => {
  try {
    const userId = req.user.id;
    const { since } = req.query;

    if (!since) {
      return res.status(400).json({
        success: false,
        message: '缺少since参数'
      });
    }

    const sinceDate = new Date(since);
    if (isNaN(sinceDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'since参数格式无效'
      });
    }

    const db = getDb();

    // 获取更新的公开脚本
    const updatedPublicScriptsStmt = db.prepare(`
      SELECT *, 'public' as source FROM scripts
      WHERE is_public = 1 AND updated_at > ?
      ORDER BY updated_at DESC
    `);
    const updatedPublicScripts = updatedPublicScriptsStmt.all(since);

    // 获取更新的用户脚本
    const updatedUserScriptsStmt = db.prepare(`
      SELECT *, 'user' as source FROM user_scripts
      WHERE user_id = ? AND updated_at > ?
      ORDER BY updated_at DESC
    `);
    const updatedUserScripts = updatedUserScriptsStmt.all(userId, since);

    // 合并所有更新的脚本
    const updates = [
      ...updatedPublicScripts.map(script => ({
        id: script.id,
        name: script.name,
        description: script.description,
        command: script.command,
        author: script.author,
        tags: script.tags ? JSON.parse(script.tags) : [],
        keywords: script.keywords ? JSON.parse(script.keywords) : [],
        category: script.category,
        source: script.source,
        usageCount: script.usage_count || 0,
        createdAt: script.created_at,
        updatedAt: script.updated_at
      })),
      ...updatedUserScripts.map(script => ({
        id: script.id,
        name: script.name,
        description: script.description,
        command: script.command,
        tags: script.tags ? JSON.parse(script.tags) : [],
        keywords: script.keywords ? JSON.parse(script.keywords) : [],
        category: script.category,
        source: script.source,
        createdAt: script.created_at,
        updatedAt: script.updated_at
      }))
    ];

    // 获取用户收藏状态（如果有更新）
    // 注意：user_script_favorites表没有updated_at字段，所以我们检查created_at
    const favoritesStmt = db.prepare(`
      SELECT script_id FROM user_script_favorites
      WHERE user_id = ? AND created_at > ?
    `);
    const updatedFavorites = favoritesStmt.all(userId, since);

    // 获取所有当前收藏
    const allFavoritesStmt = db.prepare(`
      SELECT script_id FROM user_script_favorites WHERE user_id = ?
    `);
    const allFavorites = allFavoritesStmt.all(userId).map(row => row.script_id);

    res.json({
      success: true,
      updates,
      deletes: [], // 暂时不处理删除，因为公开脚本通常不会删除
      favorites: updatedFavorites.length > 0 ? allFavorites : undefined
    });

  } catch (error) {
    log.error('获取脚本增量更新失败:', error);
    res.status(500).json({
      success: false,
      message: '获取增量更新失败'
    });
  }
};

/**
 * 记录脚本使用
 */
const recordScriptUsage = async (req, res) => {
  try {
    const userId = req.user.id;
    const { scriptId, userScriptId, scriptName, command } = req.body;

    const db = getDb();

    // 记录使用历史
    const insertHistoryStmt = db.prepare(`
      INSERT INTO script_usage_history (
        user_id, script_id, user_script_id, script_name, command, used_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    insertHistoryStmt.run(
      userId,
      scriptId || null,
      userScriptId || null,
      scriptName,
      command,
      new Date().toISOString()
    );

    // 更新使用次数
    if (scriptId) {
      const script = await Script.findById(scriptId);
      if (script) {
        await script.incrementUsage();
      }
    } else if (userScriptId) {
      const userScript = await UserScript.findById(userScriptId, userId);
      if (userScript) {
        await userScript.incrementUsage();
      }
    }

    res.json({
      success: true,
      message: '使用记录已保存'
    });
  } catch (error) {
    log.error('记录脚本使用失败:', error);
    res.status(500).json({
      success: false,
      message: '记录使用失败'
    });
  }
};

/**
 * 执行脚本
 */
const executeScript = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      scriptId,
      scriptName,
      command,
      serverId,
      serverName,
      host,
      port,
      username
    } = req.body;

    if (!command) {
      return res.status(400).json({
        success: false,
        message: '脚本命令不能为空'
      });
    }

    if (!host || !username) {
      return res.status(400).json({
        success: false,
        message: '服务器信息不完整'
      });
    }

    log.info('开始执行脚本', {
      userId,
      scriptId,
      scriptName,
      command,
      serverName,
      host
    });

    // 获取连接配置信息
    const db = getDb();
    const connectionStmt = db.prepare('SELECT * FROM connections WHERE host = ? AND username = ? AND user_id = ?');
    const connection = connectionStmt.get(host, username, userId);

    if (!connection) {
      return res.status(400).json({
        success: false,
        message: '未找到对应的连接配置'
      });
    }

    // 解密敏感数据
    const decryptedPassword = connection.password ? decryptPassword(connection.password) : '';
    const decryptedPrivateKey = connection.privateKey ? decryptPrivateKey(connection.privateKey) : '';

    // 执行SSH命令
    const executionResult = await executeSSHCommand({
      host,
      port: port || 22,
      username,
      password: decryptedPassword,
      privateKey: decryptedPrivateKey,
      authType: connection.auth_type,
      command
    });

    // 记录脚本执行历史

    // 先检查脚本是否存在，如果不存在则不记录script_id
    let validScriptId = null;
    if (scriptId) {
      const checkScript = db.prepare('SELECT id FROM scripts WHERE id = ?');
      const scriptExists = checkScript.get(scriptId);
      if (scriptExists) {
        validScriptId = scriptId;
      }
    }

    const insertExecutionStmt = db.prepare(`
      INSERT INTO script_execution_history (
        user_id, script_id, script_name, command, connection_id, server_name,
        host, port, username, stdout, stderr, exit_code, executed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertExecutionStmt.run(
      userId,
      validScriptId,
      scriptName,
      command,
      connection.id, // 关联连接ID，便于追溯
      serverName,
      host,
      port || 22,
      username,
      executionResult.stdout,
      executionResult.stderr,
      executionResult.exitCode,
      executionResult.executedAt
    );

    res.json({
      success: true,
      result: executionResult,
      message: '脚本执行成功'
    });

  } catch (error) {
    log.error('执行脚本失败:', error);
    res.status(500).json({
      success: false,
      message: `脚本执行失败: ${error.message}`
    });
  }
};

/**
 * 获取用户收藏的脚本
 */
const getUserFavorites = async (req, res) => {
  try {
    const userId = req.user.id;
    const db = getDb();

    // 获取用户收藏的脚本ID列表
    const favorites = db.prepare(
      'SELECT script_id FROM user_script_favorites WHERE user_id = ?'
    ).all(userId);

    const favoriteIds = favorites.map(fav => fav.script_id);

    res.json({
      success: true,
      favorites: favoriteIds
    });
  } catch (error) {
    log.error('获取用户收藏脚本失败:', error);
    res.status(500).json({
      success: false,
      message: '获取收藏脚本失败',
      error: error.message
    });
  }
};

/**
 * 更新用户收藏的脚本
 */
const updateUserFavorites = async (req, res) => {
  try {
    const userId = req.user.id;
    const { favorites } = req.body;

    if (!Array.isArray(favorites)) {
      return res.status(400).json({
        success: false,
        message: '收藏数据格式不正确，应为数组'
      });
    }

    const db = getDb();

    // 开始事务
    db.prepare('BEGIN TRANSACTION').run();

    try {
      // 清除现有收藏
      db.prepare(
        'DELETE FROM user_script_favorites WHERE user_id = ?'
      ).run(userId);

      // 添加新收藏
      const insertStmt = db.prepare(
        'INSERT INTO user_script_favorites (user_id, script_id, created_at) VALUES (?, ?, ?)'
      );

      const now = new Date().toISOString();
      for (const scriptId of favorites) {
        insertStmt.run(userId, scriptId, now);
      }

      // 提交事务
      db.prepare('COMMIT').run();

      res.json({
        success: true,
        message: '收藏脚本已更新'
      });
    } catch (error) {
      // 回滚事务
      db.prepare('ROLLBACK').run();
      throw error;
    }
  } catch (error) {
    log.error('更新用户收藏脚本失败:', error);
    res.status(500).json({
      success: false,
      message: '更新收藏脚本失败',
      error: error.message
    });
  }
};

/**
 * 切换脚本收藏状态
 */
const toggleScriptFavorite = async (req, res) => {
  try {
    const userId = req.user.id;
    const scriptId = parseInt(req.params.scriptId);

    if (!scriptId) {
      return res.status(400).json({
        success: false,
        message: '脚本ID不能为空'
      });
    }

    const db = getDb();

    // 检查是否已收藏
    const existing = db.prepare(
      'SELECT 1 FROM user_script_favorites WHERE user_id = ? AND script_id = ?'
    ).get(userId, scriptId);

    if (existing) {
      // 取消收藏
      db.prepare(
        'DELETE FROM user_script_favorites WHERE user_id = ? AND script_id = ?'
      ).run(userId, scriptId);

      res.json({
        success: true,
        isFavorite: false,
        message: '已取消收藏'
      });
    } else {
      // 添加收藏
      db.prepare(
        'INSERT INTO user_script_favorites (user_id, script_id, created_at) VALUES (?, ?, ?)'
      ).run(userId, scriptId, new Date().toISOString());

      res.json({
        success: true,
        isFavorite: true,
        message: '已添加到收藏'
      });
    }
  } catch (error) {
    log.error('切换脚本收藏状态失败:', error);
    res.status(500).json({
      success: false,
      message: '操作失败',
      error: error.message
    });
  }
};

/**
 * 获取脚本执行历史（可按 connection_id/scriptId 过滤）
 */
const getExecutionHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { connectionId, scriptId, page = 1, limit = 20 } = req.query;

    const db = getDb();

    const safeLimit = Math.min(parseInt(limit) || 20, 100);
    const currentPage = Math.max(parseInt(page) || 1, 1);
    const offset = (currentPage - 1) * safeLimit;

    // 动态条件
    const whereClauses = ["user_id = ?"];
    const params = [userId];

    if (connectionId) {
      whereClauses.push("connection_id = ?");
      params.push(connectionId);
    }
    if (scriptId) {
      whereClauses.push("script_id = ?");
      params.push(parseInt(scriptId));
    }

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // 统计总数
    const countRow = db.prepare(`
      SELECT COUNT(*) AS total
      FROM script_execution_history
      ${whereSql}
    `).get(...params);
    const total = countRow?.total || 0;

    // 查询数据
    const rows = db.prepare(`
      SELECT id, user_id, script_id, script_name, command, connection_id, server_name,
             host, port, username, stdout, stderr, exit_code, executed_at
      FROM script_execution_history
      ${whereSql}
      ORDER BY datetime(executed_at) DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...params, safeLimit, offset);

    res.json({
      success: true,
      history: rows,
      pagination: {
        page: currentPage,
        limit: safeLimit,
        total
      }
    });
  } catch (error) {
    log.error('获取脚本执行历史失败:', error);
    res.status(500).json({
      success: false,
      message: '获取执行历史失败',
      error: error.message
    });
  }
};

/**
 * 获取单条执行历史详情
 */
const getExecutionDetail = async (req, res) => {
  try {
    const userId = req.user.id;
    const id = parseInt(req.params.id);

    if (!id) {
      return res.status(400).json({ success: false, message: '无效的执行记录ID' });
    }

    const db = getDb();
    const row = db.prepare(`
      SELECT id, user_id, script_id, script_name, command, connection_id, server_name,
             host, port, username, stdout, stderr, exit_code, executed_at
      FROM script_execution_history
      WHERE id = ? AND user_id = ?
    `).get(id, userId);

    if (!row) {
      return res.status(404).json({ success: false, message: '记录不存在' });
    }

    res.json({ success: true, execution: row });
  } catch (error) {
    log.error('获取执行历史详情失败:', error);
    res.status(500).json({ success: false, message: '获取详情失败', error: error.message });
  }
};

module.exports = {
  getPublicScripts,
  getCategories,
  getPopularScripts,
  searchScripts,
  getUserScripts,
  createUserScript,
  updateUserScript,
  deleteUserScript,
  getAllUserScripts,
  getScriptsIncremental,
  recordScriptUsage,
  executeScript,
  getUserFavorites,
  updateUserFavorites,
  toggleScriptFavorite,
  getExecutionHistory,
  getExecutionDetail
};
