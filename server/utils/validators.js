/**
 * 验证工具
 * 提供各种数据验证函数
 */

const logger = require('./logger');

/**
 * 验证用户数据
 * @param {Object} userData 用户数据
 * @returns {boolean} 是否有效
 */
const validateUser = (userData) => {
  try {
    // 验证必填字段
    if (!userData.username || !userData.password) {
      return false;
    }

    // 用户名规则验证 (只允许字母、数字、下划线，长度3-20)
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(userData.username)) {
      return false;
    }

    // 密码长度验证（至少6位）
    if (userData.password.length < 6) {
      return false;
    }

    // 邮箱验证（如果提供）
    if (userData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userData.email)) {
      return false;
    }

    return true;
  } catch (error) {
    logger.error('用户数据验证失败', error);
    return false;
  }
};

/**
 * 验证连接数据
 * @param {Object} connection 连接数据
 * @returns {boolean} 是否有效
 */
const validateConnection = (connection) => {
  try {
    // 必填字段验证
    if (!connection.host || !connection.username) {
      return false;
    }

    // 主机名验证（IP地址或域名）
    const hostRegex = /^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9])$|^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$|^localhost$/;
    if (!hostRegex.test(connection.host)) {
      return false;
    }

    // 端口验证（1-65535之间的数字）
    if (connection.port && (isNaN(connection.port) || connection.port < 1 || connection.port > 65535)) {
      return false;
    }

    // 验证身份验证类型
    if (connection.authType && !['password', 'key'].includes(connection.authType)) {
      return false;
    }

    // 如果是密钥认证，验证是否有私钥
    if (connection.authType === 'key' && !connection.privateKey) {
      // 允许没有私钥，但会在日志中记录警告
      logger.warn('密钥认证缺少私钥', { host: connection.host, username: connection.username });
    }

    return true;
  } catch (error) {
    logger.error('连接数据验证失败', error);
    return false;
  }
};

module.exports = {
  validateUser,
  validateConnection
};
