/**
 * API服务模块
 * 用于处理与后端的API交互
 */

import { apiConfig } from '../core/config.js';

/**
 * 创建API请求
 * @param {string} url 请求URL
 * @param {Object} options 请求选项
 * @returns {Promise<any>} 请求结果
 */
async function request(url, options = {}) {
  // 默认选项
  const defaultOptions = {
    method: 'GET',
    headers: {
      ...apiConfig.headers,
      'Authorization': localStorage.getItem('token') ? `Bearer ${localStorage.getItem('token')}` : ''
    },
    timeout: apiConfig.timeout
  };
  
  // 合并选项
  const requestOptions = {
    ...defaultOptions,
    ...options,
    headers: {
      ...defaultOptions.headers,
      ...(options.headers || {})
    }
  };
  
  // 处理URL
  const fullUrl = url.startsWith('http') ? url : `${apiConfig.baseUrl}${url}`;
  
  try {
    // 添加超时处理
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), requestOptions.timeout);
    
    requestOptions.signal = controller.signal;
    
    // 发送请求
    const response = await fetch(fullUrl, requestOptions);
    
    // 清除超时
    clearTimeout(timeoutId);
    
    // 处理响应
    if (!response.ok) {
      throw new Error(`API请求失败: ${response.status} ${response.statusText}`);
    }
    
    // 解析JSON响应
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('API请求错误:', error);
    throw error;
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
      queryParams.append(key, value);
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
 * @returns {Promise<any>} 请求结果
 */
export function upload(url, formData, options = {}) {
  return request(url, {
    method: 'POST',
    body: formData,
    headers: {
      // 不设置Content-Type，让浏览器自动设置
    },
    ...options
  });
}

export default {
  get,
  post,
  put,
  del,
  upload
}; 