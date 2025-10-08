/**
 * 服务器控制器 (TypeScript 版)
 */

import type { Request, Response } from 'express';
import serverService from '../services/serverService';

export const getUserServers = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id as string;
    const servers = await serverService.getServersByUser(userId);
    res.json({ success: true, servers });
  } catch (error) {
    console.error('获取服务器列表错误:', error);
    res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
  }
};

export const getServer = async (req: Request, res: Response) => {
  try {
    const serverId = req.params.id;
    const userId = (req as any).user?.id as string;
    const includeCredentials = req.query.includeCredentials === 'true';

    const server = await serverService.getServerById(serverId, includeCredentials);
    if (!server) return res.status(404).json({ success: false, message: '服务器不存在' });

    // 权限检查（安全对象或完整对象均含 owner/shared）
    const s: any = server as any;
    if (s.owner?.toString() !== userId && !s.shared?.isShared) {
      return res.status(403).json({ success: false, message: '无权限访问此服务器' });
    }
    if (s.shared?.isShared && s.owner?.toString() !== userId && !s.shared?.sharedWith?.includes(userId)) {
      return res.status(403).json({ success: false, message: '无权限访问此服务器' });
    }

    res.json({ success: true, server });
  } catch (error) {
    console.error('获取服务器信息错误:', error);
    res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
  }
};

export const createServer = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id as string;
    const { name, host, port, username } = req.body as any;

    if (!name || !host || !username) {
      return res.status(400).json({ success: false, message: '服务器名称、主机和用户名不能为空' });
    }
    if (!req.body.password && !req.body.privateKey) {
      return res.status(400).json({ success: false, message: '必须提供密码或私钥' });
    }

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

    const result = await serverService.createServer(serverData as any);
    if (!result.success) return res.status(400).json(result);
    return res.status(201).json(result);
  } catch (error) {
    console.error('创建服务器错误:', error);
    res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
  }
};

export const updateServer = async (req: Request, res: Response) => {
  try {
    const serverId = req.params.id;
    const userId = (req as any).user?.id as string;
    const result = await serverService.updateServer(serverId, userId, req.body as any);
    if (!result.success) {
      return res.status(result.message.includes('不存在') ? 404 : 400).json(result);
    }
    res.json(result);
  } catch (error) {
    console.error('更新服务器错误:', error);
    res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
  }
};

export const deleteServer = async (req: Request, res: Response) => {
  try {
    const serverId = req.params.id;
    const userId = (req as any).user?.id as string;
    const result = await serverService.deleteServer(serverId, userId);
    if (!result.success) {
      return res.status(result.message.includes('不存在') ? 404 : 400).json(result);
    }
    res.json(result);
  } catch (error) {
    console.error('删除服务器错误:', error);
    res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
  }
};

export const connectServer = async (req: Request, res: Response) => {
  try {
    const serverId = req.params.id;
    await serverService.incrementConnectionCount(serverId);
    res.json({ success: true, message: '连接计数已更新' });
  } catch (error) {
    console.error('更新连接次数错误:', error);
    res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
  }
};

export default {
  getUserServers,
  getServer,
  createServer,
  updateServer,
  deleteServer,
  connectServer
};

