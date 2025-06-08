/**
 * 脚本库控制器
 * 处理脚本相关的HTTP请求
 */

const Script = require('../models/Script');
const UserScript = require('../models/UserScript');
const { getDb } = require('../config/database');
const log = require('../utils/logger');
const { Client } = require('ssh2');

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

    // 执行SSH命令
    const executionResult = await executeSSHCommand({
      host,
      port: port || 22,
      username,
      password: connection.password,
      privateKey: connection.privateKey,
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
        user_id, script_id, script_name, command, server_id, server_name,
        host, port, username, stdout, stderr, exit_code, executed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertExecutionStmt.run(
      userId,
      validScriptId,
      scriptName,
      command,
      null, // 暂时不关联server_id，避免外键约束问题
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
      message: '脚本执行失败: ' + error.message
    });
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
  recordScriptUsage,
  executeScript
};
