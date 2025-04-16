/**
 * API HTTP客户端
 * 提供基础的HTTP请求功能
 */

import { mergedConfig as config } from './config.js';
import { getFromStorage, saveToStorage } from '../../utils/storage.js';

// 缓存存储
const requestCache = new Map();

// 请求计数器，用于生成唯一请求ID
let requestId = 0;

/**
 * 生成缓存键
 * @param {string} url 请求URL
 * @param {Object} options 请求选项
 * @returns {string} 缓存键
 */
function generateCacheKey(url, options) {
  const method = options.method || 'GET';
  const body = options.body ? JSON.stringify(options.body) : '';
  return `${method}:${url}:${body}`;
}

/**
 * 检查是否应缓存请求
 * @param {Object} options 请求选项
 * @returns {boolean} 是否可缓存
 */
function isCacheable(options) {
  if (!config.cache.enabled) return false;
  
  const method = options.method || 'GET';
  return config.cache.methods.includes(method);
}

/**
 * 从缓存获取响应
 * @param {string} cacheKey 缓存键
 * @returns {Object|null} 缓存的响应或null
 */
function getFromCache(cacheKey) {
  if (!requestCache.has(cacheKey)) return null;
  
  const cachedItem = requestCache.get(cacheKey);
  const now = Date.now();
  
  // 检查是否过期
  if (cachedItem.expiry > now) {
    return cachedItem.data;
  }
  
  // 过期则删除
  requestCache.delete(cacheKey);
  return null;
}

/**
 * 保存响应到缓存
 * @param {string} cacheKey 缓存键
 * @param {Object} data 响应数据
 * @param {number} expiration 过期时间(毫秒)
 */
function saveToCache(cacheKey, data, expiration = config.cache.defaultExpiration) {
  const expiry = Date.now() + expiration;
  requestCache.set(cacheKey, { data, expiry });
}

/**
 * 请求拦截器
 * @param {string} url 请求URL
 * @param {Object} options 请求选项
 * @returns {Object} 处理后的选项
 */
function requestInterceptor(url, options) {
  // 生成唯一请求ID
  const currentRequestId = ++requestId;
  
  // 从localStorage获取令牌
  const token = getFromStorage('auth.token');
  
  // 添加请求头
  const headers = {
    ...config.headers,
    ...(options.headers || {})
  };
  
  // 添加认证头
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  // 添加请求ID
  headers['X-Request-ID'] = currentRequestId.toString();
  
  console.log(`[API] 请求开始 [${currentRequestId}]: ${options.method || 'GET'} ${url}`);
  
  return {
    ...options,
    headers,
    requestId: currentRequestId
  };
}

/**
 * 响应拦截器
 * @param {Response} response Fetch响应对象
 * @param {Object} options 请求选项
 * @returns {Promise<any>} 处理后的响应数据
 */
async function responseInterceptor(response, options) {
  const requestId = options.requestId;
  console.log(`[API] 请求完成 [${requestId}]: ${response.status} ${response.statusText}`);
  
  // 处理不同类型的响应
  if (response.status === 204) {
    return null; // No Content
  }
  
  // 根据Content-Type决定如何解析响应
  const contentType = response.headers.get('Content-Type') || '';
  
  if (contentType.includes('application/json')) {
    return await response.json();
  } else if (contentType.includes('text/')) {
    return await response.text();
  } else {
    return await response.blob();
  }
}

/**
 * 错误拦截器
 * @param {Error} error 错误对象
 * @param {Object} options 请求选项
 * @throws {Error} 处理后的错误
 */
function errorInterceptor(error, options) {
  const requestId = options.requestId;
  
  // 处理不同类型的错误
  if (error.name === 'AbortError') {
    console.error(`[API] 请求超时 [${requestId}]`);
    throw new Error('请求超时，请稍后重试');
  }
  
  // 网络错误
  if (error instanceof TypeError && error.message.includes('network')) {
    console.error(`[API] 网络错误 [${requestId}]: ${error.message}`);
    throw new Error('网络连接失败，请检查您的网络连接');
  }
  
  // 服务器错误
  console.error(`[API] 请求失败 [${requestId}]:`, error);
  throw error;
}

/**
 * 执行HTTP请求
 * @param {string} url 请求URL
 * @param {Object} options 请求选项
 * @param {Object} customConfig 自定义配置
 * @returns {Promise<any>} 请求结果
 */
export async function request(url, options = {}, customConfig = {}) {
  // 合并自定义配置
  const mergedCfg = {
    ...config,
    ...customConfig
  };
  
  // 处理完整URL
  const fullUrl = url.startsWith('http') ? url : `${mergedCfg.baseUrl}${url}`;
  
  // 应用请求拦截器
  const interceptedOptions = requestInterceptor(fullUrl, options);
  
  // 检查缓存
  if (isCacheable(interceptedOptions)) {
    const cacheKey = generateCacheKey(fullUrl, interceptedOptions);
    const cachedResponse = getFromCache(cacheKey);
    
    if (cachedResponse) {
      console.log(`[API] 从缓存返回 [${interceptedOptions.requestId}]: ${fullUrl}`);
      return cachedResponse;
    }
  }
  
  try {
    // 添加超时处理
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), mergedCfg.timeout);
    
    interceptedOptions.signal = controller.signal;
    
    // 发送请求
    const response = await fetch(fullUrl, interceptedOptions);
    
    // 清除超时
    clearTimeout(timeoutId);
    
    // 处理错误响应
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: response.statusText }));
      const error = new Error(errorData.message || '请求失败');
      error.status = response.status;
      error.data = errorData;
      throw error;
    }
    
    // 应用响应拦截器
    const data = await responseInterceptor(response, interceptedOptions);
    
    // 缓存响应
    if (isCacheable(interceptedOptions)) {
      const cacheKey = generateCacheKey(fullUrl, interceptedOptions);
      saveToCache(cacheKey, data);
    }
    
    return data;
  } catch (error) {
    // 应用错误拦截器
    errorInterceptor(error, interceptedOptions);
  }
}

/**
 * GET请求
 * @param {string} url 请求URL
 * @param {Object} params 查询参数
 * @param {Object} options 请求选项
 * @returns {Promise<any>} 请求结果
 */
export function get(url, params = {}, options = {}) {
  // 处理查询参数
  const queryParams = new URLSearchParams();
  
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      queryParams.append(key, String(value));
    }
  });
  
  const queryString = queryParams.toString();
  const fullUrl = queryString ? `${url}?${queryString}` : url;
  
  return request(fullUrl, { method: 'GET', ...options });
}

/**
 * POST请求
 * @param {string} url 请求URL
 * @param {Object} data 请求数据
 * @param {Object} options 请求选项
 * @returns {Promise<any>} 请求结果
 */
export function post(url, data = {}, options = {}) {
  return request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data),
    ...options
  });
}

/**
 * PUT请求
 * @param {string} url 请求URL
 * @param {Object} data 请求数据
 * @param {Object} options 请求选项
 * @returns {Promise<any>} 请求结果
 */
export function put(url, data = {}, options = {}) {
  return request(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data),
    ...options
  });
}

/**
 * DELETE请求
 * @param {string} url 请求URL
 * @param {Object} options 请求选项
 * @returns {Promise<any>} 请求结果
 */
export function del(url, options = {}) {
  return request(url, {
    method: 'DELETE',
    ...options
  });
}

/**
 * 上传文件
 * @param {string} url 请求URL
 * @param {FormData} formData 表单数据
 * @param {Object} options 请求选项
 * @param {Function} onProgress 进度回调
 * @returns {Promise<any>} 请求结果
 */
export function upload(url, formData, options = {}, onProgress = null) {
  const requestOptions = {
    method: 'POST',
    body: formData,
    ...options
  };
  
  // 如果提供了进度回调，使用XHR而不是fetch
  if (onProgress && typeof onProgress === 'function') {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      
      xhr.open('POST', url.startsWith('http') ? url : `${config.baseUrl}${url}`);
      
      // 添加请求头
      const token = getFromStorage('auth.token');
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }
      
      // 设置超时
      xhr.timeout = config.timeout;
      
      // 进度事件
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100);
          onProgress(progress);
        }
      });
      
      // 完成事件
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText);
            resolve(response);
          } catch (e) {
            resolve(xhr.responseText);
          }
        } else {
          reject(new Error(`上传失败: ${xhr.status} ${xhr.statusText}`));
        }
      });
      
      // 错误事件
      xhr.addEventListener('error', () => {
        reject(new Error('网络错误，上传失败'));
      });
      
      // 超时事件
      xhr.addEventListener('timeout', () => {
        reject(new Error('上传超时，请稍后重试'));
      });
      
      // 发送请求
      xhr.send(formData);
    });
  }
  
  // 如果没有进度回调，使用fetch
  return request(url, requestOptions);
}

export default {
  request,
  get,
  post,
  put,
  del,
  upload
}; 