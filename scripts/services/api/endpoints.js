/**
 * API接口定义
 * 集中管理所有API端点
 */

/**
 * 连接相关接口
 */
export const connectionEndpoints = {
  // 获取所有连接
  getAll: '/connections',
  // 获取单个连接
  getById: (id) => `/connections/${id}`,
  // 创建连接
  create: '/connections',
  // 更新连接
  update: (id) => `/connections/${id}`,
  // 删除连接
  delete: (id) => `/connections/${id}`,
  // 连接测试
  test: '/connections/test',
  // 获取最近连接
  recent: '/connections/recent',
  // 获取连接状态
  status: (id) => `/connections/${id}/status`,
  // 保存连接配置
  saveConfig: (id) => `/connections/${id}/config`
};

/**
 * 用户相关接口
 */
export const userEndpoints = {
  // 用户登录
  login: '/auth/login',
  // 用户登出
  logout: '/auth/logout',
  // 用户注册
  register: '/auth/register',
  // 获取当前用户信息
  current: '/users/me',
  // 更新用户信息
  update: '/users/me',
  // 修改密码
  changePassword: '/users/password',
  // 找回密码
  resetPassword: '/auth/reset-password',
  // 验证令牌
  verifyToken: '/auth/verify'
};

/**
 * 设置相关接口
 */
export const settingEndpoints = {
  // 获取所有设置
  getAll: '/settings',
  // 获取单个设置
  getById: (key) => `/settings/${key}`,
  // 更新设置
  update: (key) => `/settings/${key}`,
  // 重置设置
  reset: '/settings/reset',
  // 导出设置
  export: '/settings/export',
  // 导入设置
  import: '/settings/import'
};

/**
 * 文件传输相关接口
 */
export const fileEndpoints = {
  // 上传文件
  upload: '/files/upload',
  // 下载文件
  download: (path) => `/files/download?path=${encodeURIComponent(path)}`,
  // 获取目录列表
  listDirectory: '/files/list',
  // 创建目录
  createDirectory: '/files/directory',
  // 删除文件或目录
  delete: '/files/delete'
};

/**
 * 系统相关接口
 */
export const systemEndpoints = {
  // 系统状态
  status: '/system/status',
  // 系统日志
  logs: '/system/logs',
  // 获取系统配置
  config: '/system/config',
  // 更新系统配置
  updateConfig: '/system/config'
};

/**
 * 统一导出所有接口
 */
export default {
  connection: connectionEndpoints,
  user: userEndpoints,
  setting: settingEndpoints,
  file: fileEndpoints,
  system: systemEndpoints
}; 