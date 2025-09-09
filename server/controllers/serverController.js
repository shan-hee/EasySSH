/**
 * 服务器控制器
 * 处理服务器相关API请求
 */

const serverService = require('../services/serverService');

// 获取用户的所有服务器
exports.getUserServers = async (req, res) => {
  try {
    const userId = req.user.id;
    const servers = await serverService.getServersByUser(userId);

    res.json({
      success: true,
      servers
    });
  } catch (error) {
    console.error('获取服务器列表错误:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误，请稍后重试'
    });
  }
};

// 获取单个服务器信息
exports.getServer = async (req, res) => {
  try {
    const serverId = req.params.id;
    const userId = req.user.id;
    const includeCredentials = req.query.includeCredentials === 'true';

    // 获取服务器信息
    const server = await serverService.getServerById(serverId, includeCredentials);

    if (!server) {
      return res.status(404).json({
        success: false,
        message: '服务器不存在'
      });
    }

    // 检查权限（仅所有者可以访问）
    if (server.owner.toString() !== userId && !server.shared.isShared) {
      return res.status(403).json({
        success: false,
        message: '无权限访问此服务器'
      });
    }

    // 如果是共享服务器，但当前用户不在共享列表中
    if (server.shared.isShared &&
        server.owner.toString() !== userId &&
        !server.shared.sharedWith.includes(userId)) {
      return res.status(403).json({
        success: false,
        message: '无权限访问此服务器'
      });
    }

    res.json({
      success: true,
      server
    });
  } catch (error) {
    console.error('获取服务器信息错误:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误，请稍后重试'
    });
  }
};

// 创建服务器
exports.createServer = async (req, res) => {
  try {
    const userId = req.user.id;

    // 验证必要字段
    const { name, host, port, username } = req.body;

    if (!name || !host || !username) {
      return res.status(400).json({
        success: false,
        message: '服务器名称、主机和用户名不能为空'
      });
    }

    // 身份验证方式验证
    if (!req.body.password && !req.body.privateKey) {
      return res.status(400).json({
        success: false,
        message: '必须提供密码或私钥'
      });
    }

    // 准备服务器数据
    const serverData = {
      name,
      host,
      port: port || 22,
      username,
      password: req.body.password,
      privateKey: req.body.privateKey,
      usePrivateKey: !!req.body.privateKey,
      description: req.body.description,
      tags: req.body.tags || [],
      timeout: req.body.timeout || 10000,
      owner: userId
    };

    // 创建服务器
    const result = await serverService.createServer(serverData);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.status(201).json(result);
  } catch (error) {
    console.error('创建服务器错误:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误，请稍后重试'
    });
  }
};

// 更新服务器
exports.updateServer = async (req, res) => {
  try {
    const serverId = req.params.id;
    const userId = req.user.id;

    // 更新服务器数据
    const result = await serverService.updateServer(serverId, userId, req.body);

    if (!result.success) {
      return res.status(result.message.includes('不存在') ? 404 : 400).json(result);
    }

    res.json(result);
  } catch (error) {
    console.error('更新服务器错误:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误，请稍后重试'
    });
  }
};

// 删除服务器
exports.deleteServer = async (req, res) => {
  try {
    const serverId = req.params.id;
    const userId = req.user.id;

    const result = await serverService.deleteServer(serverId, userId);

    if (!result.success) {
      return res.status(result.message.includes('不存在') ? 404 : 400).json(result);
    }

    res.json(result);
  } catch (error) {
    console.error('删除服务器错误:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误，请稍后重试'
    });
  }
};

// 连接服务器（仅增加连接次数）
exports.connectServer = async (req, res) => {
  try {
    const serverId = req.params.id;

    await serverService.incrementConnectionCount(serverId);

    // 实际的SSH连接通过WebSocket处理，这里只更新统计数据
    res.json({
      success: true,
      message: '连接计数已更新'
    });
  } catch (error) {
    console.error('更新连接次数错误:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误，请稍后重试'
    });
  }
};
