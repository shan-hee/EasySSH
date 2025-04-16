/**
 * API配置文件
 * 定义API服务的基本配置信息
 */

/**
 * API基础配置
 */
export const apiConfig = {
  // API基础URL
  baseUrl: 'https://api.easyssh.example.com/v1',
  
  // 请求超时时间(毫秒)
  timeout: 30000,
  
  // 默认请求头
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Client-Version': '1.0.0'
  },
  
  // 重试配置
  retry: {
    // 最大重试次数
    maxRetries: 3,
    // 重试延迟(毫秒)
    delay: 1000,
    // 重试延迟增长因子
    factor: 2
  },
  
  // 缓存配置
  cache: {
    // 是否启用缓存
    enabled: true,
    // 默认缓存过期时间(毫秒)
    defaultExpiration: 5 * 60 * 1000, // 5分钟
    // 可缓存的请求方法
    methods: ['GET']
  }
};

/**
 * 环境特定配置
 * 根据当前环境加载不同的配置
 */
export function getEnvironmentConfig() {
  // 检测环境
  const isDevelopment = window.location.hostname === 'localhost' || 
                       window.location.hostname === '127.0.0.1';
  
  if (isDevelopment) {
    return {
      baseUrl: 'http://localhost:3000/api',
      timeout: 5000
    };
  }
  
  // 可以添加其他环境的配置
  return {};
}

/**
 * 合并配置
 * 将环境特定配置与基础配置合并
 */
export const mergedConfig = {
  ...apiConfig,
  ...getEnvironmentConfig()
};

export default mergedConfig; 