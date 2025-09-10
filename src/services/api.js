import axios from 'axios';
import { ElMessage } from 'element-plus';
import log from './log';

/**
 * 统一API服务模块
 * 整合了原有的多个API实现，提供统一的HTTP客户端
 */
class ApiService {
  constructor() {
    this.isInitialized = false;
    this.axios = null;
    // 动态配置API基础URL：开发环境直接访问后端，生产环境通过Nginx代理
    this.baseURL = import.meta.env.DEV
      ? `${import.meta.env.VITE_API_TARGET || 'http://localhost:8000'}/api`
      : import.meta.env.VITE_API_BASE_URL || '/api';
    this.timeout = 30000; // 30秒超时
    this._lastTokenExists = null; // 用于跟踪token状态变化

    // 请求缓存（用于GET请求）
    this.requestCache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5分钟缓存
  }

  /**
   * 初始化API服务
   * @returns {Promise<boolean>} 是否初始化成功
   */
  init() {
    try {
      if (this.isInitialized) {
        return Promise.resolve(true);
      }

      // 创建axios实例
      this.axios = axios.create({
        baseURL: this.baseURL,
        timeout: this.timeout,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        }
      });

      // 请求拦截器
      this.axios.interceptors.request.use(
        config => {
          // 添加认证token
          const token = localStorage.getItem('auth_token');

          // 减少重复的token状态日志，只在token状态变化时记录
          const currentTokenExists = !!token;
          if (this._lastTokenExists !== currentTokenExists) {
            log.debug('请求拦截器 - token状态变化', {
              exists: currentTokenExists,
              length: token ? token.length : 0,
              preview: token ? `${token.substring(0, 15)}...` : 'null'
            });
            this._lastTokenExists = currentTokenExists;
          }

          // 判断是否为不需要认证的请求路径（如需在此处跳过可配置白名单）

          if (token) {
            // 验证token格式有效性
            if (token.split('.').length !== 3) {
              log.warn('无效的JWT格式', { token: `${token.substring(0, 15)}...` });
              // 清除无效token并触发认证失败事件
              localStorage.removeItem('auth_token');
              this._handleAuthError();
            } else {
              config.headers['Authorization'] = `Bearer ${token}`;
            }
          }
          return config;
        },
        error => {
          log.error('API请求拦截错误', error);
          return Promise.reject(error);
        }
      );

      // 响应拦截器
      this.axios.interceptors.response.use(
        response => {
          // 记录关键请求的响应情况
          if (response.config.url.includes('/users/me')) {
            log.debug('用户验证请求成功', {
              status: response.status,
              hasData: !!response.data,
              success: response.data?.success
            });
          }
          return response;
        },
        error => {
          this._handleRequestError(error);
          return Promise.reject(error);
        }
      );

      this.isInitialized = true;
      return Promise.resolve(true);
    } catch (error) {
      log.error('API服务初始化失败', error);
      return Promise.resolve(false);
    }
  }

  /**
   * 处理请求错误
   * @param {Error} error - 错误对象
   * @private
   */
  _handleRequestError(error) {
    let message = '请求失败';

    if (error.response) {
      // 服务器返回错误响应
      const status = error.response.status;
      const data = error.response.data;

      switch (status) {
      case 400:
        message = data.message || '请求参数错误';
        break;
      case 401: {
        message = data.message || '身份验证失败';
        // 401错误统一处理，仅在确实是认证问题时触发登录过期逻辑
        // 排除登录、注册、刷新token等不需要触发认证过期的路径
        const noAuthRequiredPaths = [
          '/users/login',
          '/users/register',
          '/users/refresh',
          '/users/verify-mfa'
        ];
        const isAuthRequiredPath =
          error.config && !noAuthRequiredPaths.some(path => error.config.url.includes(path));

        if (isAuthRequiredPath) {
          log.warn('检测到401认证失败，开始处理身份验证失败流程', {
            url: error.config.url,
            isRemoteLogout:
              data && (data.error === 'remote-logout' || data.message === 'remote-logout')
          });

          // 判断是否为远程注销情况
          const isRemoteLogout =
            (data && data.error === 'remote-logout') ||
            (data && data.message === 'remote-logout');

          if (isRemoteLogout) {
            log.warn('检测到远程注销，执行完整清理流程');
            // 设置远程注销标志
            window._isRemoteLogout = true;
            // 触发远程注销事件
            window.dispatchEvent(new CustomEvent('auth:remote-logout'));
          } else {
            log.warn('检测到普通认证失败，执行标准清理流程');
            // 普通认证失败，触发完整登出处理
            this._handleAuthError();
          }
        }
        break;
      }
      case 403:
        message = '没有权限进行此操作';
        break;
      case 404:
        message = '请求的资源不存在';
        break;
      case 500:
        message = '服务器内部错误';
        break;
      default:
        message = `请求错误(${status})`;
      }

      log.error(`API请求失败: ${status}`, { url: error.config.url, data: error.response.data });
    } else if (error.request) {
      // 请求发送但未收到响应
      if (error.code === 'ECONNABORTED') {
        message = '请求超时，请稍后重试';
      } else {
        message = '网络连接错误，请检查网络';
      }

      log.error('API请求未收到响应', { url: error.config?.url });
    } else {
      // 请求设置过程中发生错误
      message = error.message || '请求初始化失败';
      log.error('API请求设置错误', error);
    }

    // 显示错误消息（除非明确要求不显示）
    if (!error.config?.hideErrorMessage) {
      ElMessage.error(message);
    }
  }

  /**
   * 处理认证错误 - 增强版（保留记住的凭据）
   * @private
   */
  _handleAuthError() {
    log.warn('处理认证错误，开始清理认证相关状态（保留记住的凭据）');

    // 1. 清除localStorage中的认证相关数据（但保留记住的凭据）
    localStorage.removeItem('auth_token');
    localStorage.removeItem('currentUser');
    // 注意：不再清除 easyssh_credentials，保留记住的密码

    // 2. 清除Pinia持久化存储
    try {
      localStorage.removeItem('easyssh-user');
    } catch (error) {
      log.error('清除Pinia持久化存储失败', error);
    }

    // 3. 清除用户Store状态
    try {
      const { useUserStore } = require('@/store/user');
      const userStore = useUserStore();
      userStore.setToken('');
      userStore.setUserInfo({
        id: '',
        username: '',
        email: '',
        avatar: '',
        role: '',
        lastLogin: null,
        mfaEnabled: false,
        displayName: '',
        theme: 'system',
        fontSize: 14
      });
      // 清空连接配置信息
      userStore.connections = [];
      userStore.favorites = [];
      userStore.history = [];
      userStore.pinnedConnections = {};
    } catch (error) {
      log.error('清除用户Store状态失败', error);
    }

    // 4. 触发认证失败事件，确保完全退出系统
    window.dispatchEvent(new CustomEvent('auth:complete-logout'));

    log.info('认证错误处理完成，已清理相关状态（保留记住的凭据）');
  }

  /**
   * 发送GET请求（支持缓存）
   * @param {string} url - 请求地址
   * @param {Object} params - 请求参数
   * @param {Object} config - 请求配置
   * @param {boolean} config.useCache - 是否使用缓存
   * @returns {Promise<Object>} - 响应数据
   */
  async get(url, params = {}, config = {}) {
    if (!this.isInitialized) {
      await this.init();
    }

    // 生成缓存键
    const cacheKey = `GET:${url}:${JSON.stringify(params)}`;

    // 检查缓存
    if (config.useCache !== false && this.requestCache.has(cacheKey)) {
      const cached = this.requestCache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTimeout) {
        log.debug('使用缓存响应', { url, params });
        return cached.data;
      } else {
        this.requestCache.delete(cacheKey);
      }
    }

    const response = await this.axios.get(url, { params, ...config });

    // 缓存GET请求响应
    if (config.useCache !== false) {
      this.requestCache.set(cacheKey, {
        data: response.data,
        timestamp: Date.now()
      });
    }

    return response.data;
  }

  /**
   * 发送POST请求
   * @param {string} url - 请求地址
   * @param {Object} data - 请求数据
   * @param {Object} config - 请求配置
   * @returns {Promise<Object>} - 响应数据
   */
  async post(url, data = {}, config = {}) {
    if (!this.isInitialized) {
      await this.init();
    }

    const response = await this.axios.post(url, data, config);
    return response.data;
  }

  /**
   * 发送PUT请求
   * @param {string} url - 请求地址
   * @param {Object} data - 请求数据
   * @param {Object} config - 请求配置
   * @returns {Promise<Object>} - 响应数据
   */
  async put(url, data = {}, config = {}) {
    if (!this.isInitialized) {
      await this.init();
    }

    // 清除相关缓存
    this.clearRelatedCache(url);

    const response = await this.axios.put(url, data, config);
    return response.data;
  }

  /**
   * 发送DELETE请求
   * @param {string} url - 请求地址
   * @param {Object} config - 请求配置
   * @returns {Promise<Object>} - 响应数据
   */
  async delete(url, config = {}) {
    if (!this.isInitialized) {
      await this.init();
    }

    // 清除相关缓存
    this.clearRelatedCache(url);

    const response = await this.axios.delete(url, config);
    return response.data;
  }

  /**
   * 清除相关缓存
   * @param {string} url - URL路径
   */
  clearRelatedCache(url) {
    const keysToDelete = [];
    for (const key of this.requestCache.keys()) {
      if (key.includes(url)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => this.requestCache.delete(key));
  }

  /**
   * 清除所有缓存
   */
  clearCache() {
    this.requestCache.clear();
    log.debug('API缓存已清除');
  }

  /**
   * 发送PATCH请求
   * @param {string} url - 请求地址
   * @param {Object} data - 请求数据
   * @param {Object} config - 请求配置
   * @returns {Promise<Object>} - 响应数据
   */
  async patch(url, data = {}, config = {}) {
    if (!this.isInitialized) {
      await this.init();
    }

    const response = await this.axios.patch(url, data, config);
    return response.data;
  }

  /**
   * 发送文件上传请求
   * @param {string} url - 请求地址
   * @param {FormData} formData - 表单数据
   * @param {Object} config - 请求配置
   * @returns {Promise<Object>} - 响应数据
   */
  async upload(url, formData, config = {}) {
    if (!this.isInitialized) {
      await this.init();
    }

    const uploadConfig = {
      headers: {
        'Content-Type': 'multipart/form-data'
      },
      ...config
    };

    const response = await this.axios.post(url, formData, uploadConfig);
    return response.data;
  }

  /**
   * 下载文件
   * @param {string} url - 请求地址
   * @param {Object} params - 请求参数
   * @param {string} filename - 保存的文件名
   * @param {Object} config - 请求配置
   * @returns {Promise<boolean>} - 是否下载成功
   */
  async download(url, params = {}, filename, config = {}) {
    if (!this.isInitialized) {
      await this.init();
    }

    try {
      const downloadConfig = {
        responseType: 'blob',
        params,
        ...config
      };

      const response = await this.axios.get(url, downloadConfig);

      // 创建Blob对象
      const blob = new Blob([response.data]);

      // 创建下载链接
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename || this._getFilenameFromHeader(response) || 'download';

      // 触发下载
      document.body.appendChild(link);
      link.click();

      // 清理
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(link);

      return true;
    } catch (error) {
      log.error('文件下载失败', error);
      ElMessage.error('文件下载失败');
      return false;
    }
  }

  /**
   * 从响应头中获取文件名
   * @param {Object} response - 响应对象
   * @returns {string|null} - 文件名
   * @private
   */
  _getFilenameFromHeader(response) {
    const contentDisposition = response.headers['content-disposition'];
    if (!contentDisposition) return null;

    const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
    const matches = filenameRegex.exec(contentDisposition);
    if (matches && matches[1]) {
      return matches[1].replace(/['"]/g, '');
    }
    return null;
  }
}

export default new ApiService();
