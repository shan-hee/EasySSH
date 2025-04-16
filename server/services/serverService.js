/**
 * 服务器服务
 * 用于管理SSH连接配置
 */

const Server = require('../models/Server');
const { getCache } = require('../config/database');

// 获取缓存实例
const cache = getCache();

class ServerService {
  /**
   * 创建新的服务器连接配置
   */
  async createServer(serverData) {
    try {
      const server = new Server(serverData);
      await server.save();
      
      // 清除用户服务器列表缓存
      cache.del(`servers:user:${serverData.owner}`);
      
      return {
        success: true,
        message: '服务器添加成功',
        server: server.toSafeObject()
      };
    } catch (error) {
      console.error('创建服务器失败:', error);
      return { success: false, message: '创建失败: ' + error.message };
    }
  }

  /**
   * 获取用户的所有服务器配置
   * 优先从缓存获取，未命中则从SQLite获取并缓存
   */
  async getServersByUser(userId) {
    try {
      // 尝试从缓存获取
      const cacheKey = `servers:user:${userId}`;
      const cachedServers = cache.get(cacheKey);
      
      if (cachedServers) {
        console.log('从缓存获取服务器列表');
        return cachedServers;
      }
      
      // 从SQLite获取
      console.log('从SQLite获取服务器列表');
      const servers = await Server.find({ owner: userId });
      
      // 获取安全的服务器对象
      const safeServers = servers.map(server => server.toSafeObject());
      
      // 缓存结果（1小时过期）
      cache.set(cacheKey, safeServers, 3600);
      
      return safeServers;
    } catch (error) {
      console.error('获取用户服务器列表失败:', error);
      throw error;
    }
  }

  /**
   * 根据ID获取服务器配置
   * 优先从缓存获取，未命中则从SQLite获取并缓存
   */
  async getServerById(serverId, includeCredentials = false) {
    try {
      // 仅当不需要凭证时才尝试从缓存获取
      if (!includeCredentials) {
        // 尝试从缓存获取
        const cacheKey = `server:${serverId}`;
        const cachedServer = cache.get(cacheKey);
        
        if (cachedServer) {
          console.log('从缓存获取服务器配置');
          return cachedServer;
        }
      }
      
      // 从SQLite获取
      console.log('从SQLite获取服务器配置');
      const server = await Server.findById(serverId);
      
      if (!server) {
        return null;
      }
      
      // 构建返回对象
      let result;
      
      if (includeCredentials) {
        // 包含凭证信息（解密后的密码和私钥）
        result = server.toObject();
        if (server.password) {
          result.password = server.decryptPassword();
        }
        if (server.privateKey) {
          result.privateKey = server.decryptPrivateKey();
        }
      } else {
        // 不包含凭证信息（安全对象）
        result = server.toSafeObject();
        
        // 缓存结果（1小时过期）
        const cacheKey = `server:${serverId}`;
        cache.set(cacheKey, result, 3600);
      }
      
      return result;
    } catch (error) {
      console.error('获取服务器配置失败:', error);
      throw error;
    }
  }

  /**
   * 更新服务器配置
   * 更新SQLite并使缓存失效
   */
  async updateServer(serverId, userId, serverData) {
    try {
      // 查找服务器并验证所有权
      const server = await Server.findOne({ _id: serverId, owner: userId });
      
      if (!server) {
        return { success: false, message: '服务器不存在或无权限修改' };
      }
      
      // 更新服务器数据
      Object.keys(serverData).forEach(key => {
        server[key] = serverData[key];
      });
      
      await server.save();
      
      // 使缓存失效
      cache.del(`server:${serverId}`);
      cache.del(`servers:user:${userId}`);
      
      return {
        success: true,
        message: '服务器配置更新成功',
        server: server.toSafeObject()
      };
    } catch (error) {
      console.error('更新服务器失败:', error);
      return { success: false, message: '更新失败: ' + error.message };
    }
  }

  /**
   * 删除服务器配置
   * 从SQLite删除并使缓存失效
   */
  async deleteServer(serverId, userId) {
    try {
      // 查找服务器并验证所有权
      const server = await Server.findOne({ _id: serverId, owner: userId });
      
      if (!server) {
        return { success: false, message: '服务器不存在或无权限删除' };
      }
      
      // 删除服务器
      await Server.deleteOne({ _id: serverId });
      
      // 使缓存失效
      cache.del(`server:${serverId}`);
      cache.del(`servers:user:${userId}`);
      
      return {
        success: true,
        message: '服务器删除成功'
      };
    } catch (error) {
      console.error('删除服务器失败:', error);
      return { success: false, message: '删除失败: ' + error.message };
    }
  }

  /**
   * 更新服务器连接次数
   */
  async incrementConnectionCount(serverId) {
    try {
      // 更新SQLite
      const server = await Server.findByIdAndUpdate(
        serverId,
        { 
          $inc: { connectionCount: 1 },
          $set: { lastConnected: new Date().toISOString() }
        },
        { new: true }
      );
      
      if (!server) {
        return { success: false, message: '服务器不存在' };
      }
      
      // 使缓存失效
      cache.del(`server:${serverId}`);
      cache.del(`servers:user:${server.owner}`);
      
      return { success: true };
    } catch (error) {
      console.error('更新连接次数失败:', error);
      return { success: false, message: '更新失败: ' + error.message };
    }
  }
}

module.exports = new ServerService(); 