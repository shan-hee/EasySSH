/**
 * 服务器服务 (TypeScript 版)
 * 用于管理SSH连接配置
 */

import Server, { type SafeServer, type ServerRecord } from '../models/Server';
const { getCache } = require('../config/database');

const cache = getCache();

export interface ServiceOk<T> { success: true; message: string; server?: T; }
export interface ServiceFail { success: false; message: string; }
export type ServiceResult<T> = ServiceOk<T> | ServiceFail;

class ServerService {
  async createServer(serverData: ServerRecord): Promise<ServiceResult<SafeServer>> {
    try {
      const server = new Server(serverData);
      await server.save();
      cache.del(`servers:user:${serverData.owner}`);
      return { success: true, message: '服务器添加成功', server: server.toSafeObject() };
    } catch (error: any) {
      console.error('创建服务器失败:', error);
      return { success: false, message: `创建失败: ${error.message}` };
    }
  }

  async getServersByUser(userId: string): Promise<SafeServer[]> {
    try {
      const cacheKey = `servers:user:${userId}`;
      const cachedServers = cache.get(cacheKey);
      if (cachedServers) {
        console.log('从缓存获取服务器列表');
        return cachedServers as SafeServer[];
      }
      console.log('从SQLite获取服务器列表');
      const servers = await Server.find({ owner: userId });
      const safeServers = servers.map(s => s.toSafeObject());
      cache.set(cacheKey, safeServers, 3600);
      return safeServers;
    } catch (error) {
      console.error('获取用户服务器列表失败:', error);
      throw error;
    }
  }

  async getServerById(serverId: number | string, includeCredentials = false): Promise<SafeServer | ServerRecord | null> {
    try {
      if (!includeCredentials) {
        const cacheKey = `server:${serverId}`;
        const cachedServer = cache.get(cacheKey);
        if (cachedServer) {
          console.log('从缓存获取服务器配置');
          return cachedServer as SafeServer;
        }
      }
      console.log('从SQLite获取服务器配置');
      const idNum = typeof serverId === 'string' ? parseInt(serverId, 10) : serverId;
      const server = await Server.findById(idNum);
      if (!server) return null;

      if (includeCredentials) {
        const result = server.toObject();
        if (server.password) result.password = server.decryptPassword();
        if (server.privateKey) result.privateKey = server.decryptPrivateKey();
        return result;
      }
      const result = server.toSafeObject();
      const cacheKey = `server:${serverId}`;
      cache.set(cacheKey, result, 3600);
      return result;
    } catch (error) {
      console.error('获取服务器配置失败:', error);
      throw error;
    }
  }

  async updateServer(serverId: number | string, userId: string, serverData: Partial<ServerRecord>): Promise<ServiceResult<SafeServer>> {
    try {
      const idNum = typeof serverId === 'string' ? parseInt(serverId, 10) : serverId;
      const server = await Server.findOne({ _id: idNum, owner: userId });
      if (!server) {
        return { success: false, message: '服务器不存在或无权限修改' };
      }
      Object.keys(serverData).forEach((key) => {
        (server as any)[key as keyof ServerRecord] = (serverData as any)[key];
      });
      await server.save();
      cache.del(`server:${serverId}`);
      cache.del(`servers:user:${userId}`);
      return { success: true, message: '服务器配置更新成功', server: server.toSafeObject() };
    } catch (error: any) {
      console.error('更新服务器失败:', error);
      return { success: false, message: `更新失败: ${error.message}` };
    }
  }

  async deleteServer(serverId: number | string, userId: string): Promise<ServiceResult<never>> {
    try {
      const idNum = typeof serverId === 'string' ? parseInt(serverId, 10) : serverId;
      const server = await Server.findOne({ _id: idNum, owner: userId });
      if (!server) {
        return { success: false, message: '服务器不存在或无权限删除' };
      }
      await Server.deleteOne({ _id: idNum });
      cache.del(`server:${serverId}`);
      cache.del(`servers:user:${userId}`);
      return { success: true, message: '服务器删除成功' };
    } catch (error: any) {
      console.error('删除服务器失败:', error);
      return { success: false, message: `删除失败: ${error.message}` };
    }
  }

  async incrementConnectionCount(serverId: number | string): Promise<ServiceResult<never>> {
    try {
      const idNum = typeof serverId === 'string' ? parseInt(serverId, 10) : serverId;
      const server = await Server.findByIdAndUpdate(
        idNum,
        {
          $inc: { connectionCount: 1 },
          $set: { lastConnected: new Date().toISOString() }
        },
        { new: true }
      );
      if (!server) return { success: false, message: '服务器不存在' };
      cache.del(`server:${serverId}`);
      if (server.owner) cache.del(`servers:user:${server.owner}`);
      return { success: true, message: 'ok' };
    } catch (error: any) {
      console.error('更新连接次数失败:', error);
      return { success: false, message: `更新失败: ${error.message}` };
    }
  }
}

export default new ServerService();
