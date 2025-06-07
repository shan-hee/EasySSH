/**
 * 脚本库控制器
 * 处理脚本相关的HTTP请求
 */

const Script = require('../models/Script');
const UserScript = require('../models/UserScript');
const { getDb } = require('../config/database');
const log = require('../utils/logger');

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
  recordScriptUsage
};
