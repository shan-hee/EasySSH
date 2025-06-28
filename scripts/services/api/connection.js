/**
 * 连接相关API实现
 * 处理SSH连接的API调用
 */

import { get, post, put, del } from './client.js';
import { connectionEndpoints } from './endpoints.js';
import { getFromStorage, saveToStorage } from '../../../src/utils/storage.js';

// 本地缓存键
const CACHE_KEYS = {
  RECENT_CONNECTIONS: 'local.connections.recent',
  FAVORITE_CONNECTIONS: 'local.connections.favorites'
};

/**
 * 获取所有连接
 * @param {Object} params 可选查询参数
 * @returns {Promise<Array>} 连接列表
 */
export async function getAllConnections(params = {}) {
  try {
    // 如果本地模式，从本地存储获取
    if (params.localOnly) {
      const connections = getFromStorage(CACHE_KEYS.RECENT_CONNECTIONS, []);
      return Promise.resolve(connections);
    }
    
    return await get(connectionEndpoints.getAll, params);
  } catch (error) {
    console.error('获取连接列表失败:', error);
    
    // 如果API失败，尝试从本地存储获取
    if (params.fallbackToLocal) {
      console.log('从本地存储获取连接列表');
      return getFromStorage(CACHE_KEYS.RECENT_CONNECTIONS, []);
    }
    
    throw error;
  }
}

/**
 * 获取单个连接详情
 * @param {string} id 连接ID
 * @returns {Promise<Object>} 连接详情
 */
export async function getConnectionById(id) {
  try {
    return await get(connectionEndpoints.getById(id));
  } catch (error) {
    console.error(`获取连接详情失败 [ID: ${id}]:`, error);
    throw error;
  }
}

/**
 * 创建新连接
 * @param {Object} connectionData 连接数据
 * @returns {Promise<Object>} 创建的连接
 */
export async function createConnection(connectionData) {
  try {
    const response = await post(connectionEndpoints.create, connectionData);
    
    // 更新本地缓存的最近连接
    updateRecentConnections(response);
    
    return response;
  } catch (error) {
    console.error('创建连接失败:', error);
    throw error;
  }
}

/**
 * 更新连接
 * @param {string} id 连接ID
 * @param {Object} connectionData 连接数据
 * @returns {Promise<Object>} 更新后的连接
 */
export async function updateConnection(id, connectionData) {
  try {
    const response = await put(connectionEndpoints.update(id), connectionData);
    
    // 更新本地缓存
    updateLocalConnectionCache(id, response);
    
    return response;
  } catch (error) {
    console.error(`更新连接失败 [ID: ${id}]:`, error);
    throw error;
  }
}

/**
 * 删除连接
 * @param {string} id 连接ID
 * @returns {Promise<boolean>} 是否成功
 */
export async function deleteConnection(id) {
  try {
    await del(connectionEndpoints.delete(id));
    
    // 从本地缓存中移除
    removeFromLocalCache(id);
    
    return true;
  } catch (error) {
    console.error(`删除连接失败 [ID: ${id}]:`, error);
    throw error;
  }
}

/**
 * 测试连接
 * @param {Object} connectionData 连接配置
 * @returns {Promise<Object>} 测试结果
 */
export async function testConnection(connectionData) {
  try {
    return await post(connectionEndpoints.test, connectionData);
  } catch (error) {
    console.error('连接测试失败:', error);
    throw error;
  }
}

/**
 * 获取最近连接
 * @param {number} limit 数量限制
 * @returns {Promise<Array>} 最近连接列表
 */
export async function getRecentConnections(limit = 5) {
  try {
    // 先尝试从本地缓存获取
    const cachedConnections = getFromStorage(CACHE_KEYS.RECENT_CONNECTIONS, []);
    
    if (cachedConnections.length > 0) {
      return cachedConnections.slice(0, limit);
    }
    
    // 如果本地没有，从服务器获取
    const connections = await get(connectionEndpoints.recent, { limit });
    
    // 更新本地缓存
    saveToStorage(CACHE_KEYS.RECENT_CONNECTIONS, connections);
    
    return connections;
  } catch (error) {
    console.error('获取最近连接失败:', error);
    
    // 如果API失败，返回空数组而不是抛出错误
    return [];
  }
}

/**
 * 获取连接状态
 * @param {string} id 连接ID
 * @returns {Promise<Object>} 连接状态
 */
export async function getConnectionStatus(id) {
  try {
    return await get(connectionEndpoints.status(id));
  } catch (error) {
    console.error(`获取连接状态失败 [ID: ${id}]:`, error);
    throw error;
  }
}

/**
 * 保存连接配置
 * @param {string} id 连接ID
 * @param {Object} config 配置数据
 * @returns {Promise<Object>} 保存结果
 */
export async function saveConnectionConfig(id, config) {
  try {
    return await post(connectionEndpoints.saveConfig(id), config);
  } catch (error) {
    console.error(`保存连接配置失败 [ID: ${id}]:`, error);
    throw error;
  }
}

/**
 * 添加或更新最近连接缓存
 * @param {Object} connection 连接对象
 */
function updateRecentConnections(connection) {
  try {
    const recentConnections = getFromStorage(CACHE_KEYS.RECENT_CONNECTIONS, []);
    
    // 移除已存在的相同ID连接
    const filtered = recentConnections.filter(conn => conn.id !== connection.id);
    
    // 添加到开头
    filtered.unshift(connection);
    
    // 限制数量
    const limited = filtered.slice(0, 10);
    
    // 保存到本地存储
    saveToStorage(CACHE_KEYS.RECENT_CONNECTIONS, limited);
  } catch (error) {
    console.error('更新最近连接缓存失败:', error);
  }
}

/**
 * 更新本地连接缓存
 * @param {string} id 连接ID
 * @param {Object} updatedConnection 更新后的连接
 */
function updateLocalConnectionCache(id, updatedConnection) {
  try {
    // 更新最近连接
    const recentConnections = getFromStorage(CACHE_KEYS.RECENT_CONNECTIONS, []);
    const updatedRecent = recentConnections.map(conn => 
      conn.id === id ? { ...conn, ...updatedConnection } : conn
    );
    saveToStorage(CACHE_KEYS.RECENT_CONNECTIONS, updatedRecent);
    
    // 更新收藏连接
    const favoriteConnections = getFromStorage(CACHE_KEYS.FAVORITE_CONNECTIONS, []);
    const updatedFavorites = favoriteConnections.map(conn => 
      conn.id === id ? { ...conn, ...updatedConnection } : conn
    );
    saveToStorage(CACHE_KEYS.FAVORITE_CONNECTIONS, updatedFavorites);
  } catch (error) {
    console.error('更新本地连接缓存失败:', error);
  }
}

/**
 * 从本地缓存中移除连接
 * @param {string} id 连接ID
 */
function removeFromLocalCache(id) {
  try {
    // 从最近连接移除
    const recentConnections = getFromStorage(CACHE_KEYS.RECENT_CONNECTIONS, []);
    const filteredRecent = recentConnections.filter(conn => conn.id !== id);
    saveToStorage(CACHE_KEYS.RECENT_CONNECTIONS, filteredRecent);
    
    // 从收藏连接移除
    const favoriteConnections = getFromStorage(CACHE_KEYS.FAVORITE_CONNECTIONS, []);
    const filteredFavorites = favoriteConnections.filter(conn => conn.id !== id);
    saveToStorage(CACHE_KEYS.FAVORITE_CONNECTIONS, filteredFavorites);
  } catch (error) {
    console.error('从本地缓存移除连接失败:', error);
  }
}

/**
 * 添加连接到收藏
 * @param {Object} connection 连接对象
 * @returns {boolean} 是否成功
 */
export function addToFavorites(connection) {
  try {
    const favorites = getFromStorage(CACHE_KEYS.FAVORITE_CONNECTIONS, []);
    
    // 检查是否已存在
    if (favorites.some(fav => fav.id === connection.id)) {
      return true; // 已经是收藏了
    }
    
    // 添加到收藏
    favorites.push(connection);
    saveToStorage(CACHE_KEYS.FAVORITE_CONNECTIONS, favorites);
    
    return true;
  } catch (error) {
    console.error('添加连接到收藏失败:', error);
    return false;
  }
}

/**
 * 从收藏中移除连接
 * @param {string} connectionId 连接ID
 * @returns {boolean} 是否成功
 */
export function removeFromFavorites(connectionId) {
  try {
    const favorites = getFromStorage(CACHE_KEYS.FAVORITE_CONNECTIONS, []);
    const filtered = favorites.filter(conn => conn.id !== connectionId);
    saveToStorage(CACHE_KEYS.FAVORITE_CONNECTIONS, filtered);
    
    return true;
  } catch (error) {
    console.error('从收藏移除连接失败:', error);
    return false;
  }
}

/**
 * 获取收藏的连接
 * @returns {Array} 收藏的连接列表
 */
export function getFavoriteConnections() {
  return getFromStorage(CACHE_KEYS.FAVORITE_CONNECTIONS, []);
}

export default {
  getAllConnections,
  getConnectionById,
  createConnection,
  updateConnection,
  deleteConnection,
  testConnection,
  getRecentConnections,
  getConnectionStatus,
  saveConnectionConfig,
  addToFavorites,
  removeFromFavorites,
  getFavoriteConnections
}; 