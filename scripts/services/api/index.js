/**
 * API服务模块入口
 * 组织和导出所有API相关功能
 */

import client from './client.js';
import endpoints from './endpoints.js';
import config from './config.js';

/**
 * 连接管理API
 */
export const connectionApi = {
  /**
   * 获取所有连接
   * @param {Object} params 查询参数
   * @returns {Promise<Array>} 连接列表
   */
  getAll: (params) => client.get(endpoints.connection.getAll, params),
  
  /**
   * 获取单个连接
   * @param {string} id 连接ID
   * @returns {Promise<Object>} 连接详情
   */
  getById: (id) => client.get(endpoints.connection.getById(id)),
  
  /**
   * 创建连接
   * @param {Object} data 连接数据
   * @returns {Promise<Object>} 创建的连接
   */
  create: (data) => client.post(endpoints.connection.create, data),
  
  /**
   * 更新连接
   * @param {string} id 连接ID
   * @param {Object} data 连接数据
   * @returns {Promise<Object>} 更新后的连接
   */
  update: (id, data) => client.put(endpoints.connection.update(id), data),
  
  /**
   * 删除连接
   * @param {string} id 连接ID
   * @returns {Promise<void>} 无返回值
   */
  delete: (id) => client.del(endpoints.connection.delete(id)),
  
  /**
   * 测试连接
   * @param {Object} data 连接配置
   * @returns {Promise<Object>} 测试结果
   */
  test: (data) => client.post(endpoints.connection.test, data),
  
  /**
   * 获取最近连接
   * @param {number} limit 限制数量
   * @returns {Promise<Array>} 最近连接列表
   */
  getRecent: (limit = 5) => client.get(endpoints.connection.recent, { limit }),
  
  /**
   * 获取连接状态
   * @param {string} id 连接ID
   * @returns {Promise<Object>} 连接状态
   */
  getStatus: (id) => client.get(endpoints.connection.status(id)),
  
  /**
   * 保存连接配置
   * @param {string} id 连接ID
   * @param {Object} config 配置数据
   * @returns {Promise<Object>} 保存结果
   */
  saveConfig: (id, config) => client.post(endpoints.connection.saveConfig(id), config)
};

/**
 * 用户API
 */
export const userApi = {
  /**
   * 用户登录
   * @param {Object} credentials 登录凭证
   * @returns {Promise<Object>} 登录结果
   */
  login: (credentials) => client.post(endpoints.user.login, credentials),
  
  /**
   * 用户登出
   * @returns {Promise<void>} 无返回值
   */
  logout: () => client.post(endpoints.user.logout),
  
  /**
   * 用户注册
   * @param {Object} userData 用户数据
   * @returns {Promise<Object>} 注册结果
   */
  register: (userData) => client.post(endpoints.user.register, userData),
  
  /**
   * 获取当前用户信息
   * @returns {Promise<Object>} 用户信息
   */
  getCurrentUser: () => client.get(endpoints.user.current),
  
  /**
   * 更新用户信息
   * @param {Object} userData 用户数据
   * @returns {Promise<Object>} 更新后的用户信息
   */
  updateProfile: (userData) => client.put(endpoints.user.update, userData),
  
  /**
   * 修改密码
   * @param {Object} passwordData 密码数据
   * @returns {Promise<Object>} 更新结果
   */
  changePassword: (passwordData) => client.post(endpoints.user.changePassword, passwordData),
  
  /**
   * 找回密码
   * @param {string} email 邮箱
   * @returns {Promise<Object>} 操作结果
   */
  resetPassword: (email) => client.post(endpoints.user.resetPassword, { email }),
  
  /**
   * 验证令牌
   * @param {string} token 令牌
   * @returns {Promise<Object>} 验证结果
   */
  verifyToken: (token) => client.post(endpoints.user.verifyToken, { token })
};

/**
 * 设置API
 */
export const settingApi = {
  /**
   * 获取所有设置
   * @returns {Promise<Object>} 设置列表
   */
  getAll: () => client.get(endpoints.setting.getAll),
  
  /**
   * 获取单个设置
   * @param {string} key 设置键
   * @returns {Promise<Object>} 设置值
   */
  getByKey: (key) => client.get(endpoints.setting.getById(key)),
  
  /**
   * 更新设置
   * @param {string} key 设置键
   * @param {any} value 设置值
   * @returns {Promise<Object>} 更新结果
   */
  update: (key, value) => client.put(endpoints.setting.update(key), { value }),
  
  /**
   * 重置设置
   * @returns {Promise<Object>} 重置结果
   */
  reset: () => client.post(endpoints.setting.reset),
  
  /**
   * 导出设置
   * @returns {Promise<Blob>} 导出的设置文件
   */
  export: () => client.get(endpoints.setting.export, {}, { responseType: 'blob' }),
  
  /**
   * 导入设置
   * @param {FormData} formData 包含设置文件的表单数据
   * @returns {Promise<Object>} 导入结果
   */
  import: (formData) => client.upload(endpoints.setting.import, formData)
};

/**
 * 文件API
 */
export const fileApi = {
  /**
   * 上传文件
   * @param {FormData} formData 文件表单数据
   * @param {Function} onProgress 进度回调
   * @returns {Promise<Object>} 上传结果
   */
  upload: (formData, onProgress) => client.upload(endpoints.file.upload, formData, {}, onProgress),
  
  /**
   * 下载文件
   * @param {string} path 文件路径
   * @returns {Promise<Blob>} 文件数据
   */
  download: (path) => client.get(endpoints.file.download(path), {}, { responseType: 'blob' }),
  
  /**
   * 获取目录列表
   * @param {string} path 目录路径
   * @returns {Promise<Array>} 文件列表
   */
  listDirectory: (path) => client.get(endpoints.file.listDirectory, { path }),
  
  /**
   * 创建目录
   * @param {string} path 目录路径
   * @returns {Promise<Object>} 创建结果
   */
  createDirectory: (path) => client.post(endpoints.file.createDirectory, { path }),
  
  /**
   * 删除文件或目录
   * @param {string} path 路径
   * @param {boolean} recursive 是否递归删除
   * @returns {Promise<Object>} 删除结果
   */
  delete: (path, recursive = false) => client.post(endpoints.file.delete, { path, recursive })
};

/**
 * 系统API
 */
export const systemApi = {
  /**
   * 获取系统状态
   * @returns {Promise<Object>} 系统状态
   */
  getStatus: () => client.get(endpoints.system.status),
  
  /**
   * 获取系统日志
   * @param {Object} params 查询参数
   * @returns {Promise<Array>} 日志列表
   */
  getLogs: (params) => client.get(endpoints.system.logs, params),
  
  /**
   * 获取系统配置
   * @returns {Promise<Object>} 系统配置
   */
  getConfig: () => client.get(endpoints.system.config),
  
  /**
   * 更新系统配置
   * @param {Object} configData 配置数据
   * @returns {Promise<Object>} 更新结果
   */
  updateConfig: (configData) => client.put(endpoints.system.updateConfig, configData)
};

// 清除API请求缓存的方法
export function clearApiCache() {
  // 这里可以实现清除缓存的逻辑
  console.log('[API] 缓存已清除');
}

// 导出所有API
export const api = {
  connection: connectionApi,
  user: userApi,
  setting: settingApi,
  file: fileApi,
  system: systemApi,
  
  // 工具方法
  clearCache: clearApiCache,
  
  // 底层客户端
  client,
  
  // 配置
  config
};

export default api; 