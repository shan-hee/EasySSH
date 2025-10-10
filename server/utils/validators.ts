// Bridge stub to source JS validators (typed)
import logger from './logger';

type UserData = {
  username?: string;
  password?: string;
  email?: string;
};

type Connection = {
  host?: string;
  username?: string;
  port?: number;
  authType?: 'password' | 'key' | string;
  privateKey?: string;
};

const validateUser = (userData: UserData): boolean => {
  try {
    if (!userData.username || !userData.password) return false;
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(userData.username)) return false;
    if (userData.password.length < 6) return false;
    if (userData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userData.email)) return false;
    return true;
  } catch (error) {
    logger.error('用户数据验证失败', error);
    return false;
  }
};

const validateConnection = (connection: Connection): boolean => {
  try {
    if (!connection.host || !connection.username) return false;
    const hostRegex = /^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9])$|^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$|^localhost$/;
    if (!hostRegex.test(connection.host)) return false;
    if (connection.port && (isNaN(connection.port) || connection.port < 1 || connection.port > 65535)) return false;
    if (connection.authType && !['password', 'key'].includes(connection.authType)) return false;
    if (connection.authType === 'key' && !connection.privateKey) {
      logger.warn('密钥认证缺少私钥', { host: connection.host, username: connection.username });
    }
    return true;
  } catch (error) {
    logger.error('连接数据验证失败', error);
    return false;
  }
};

const api = { validateUser, validateConnection };
module.exports = api;
export default api;
