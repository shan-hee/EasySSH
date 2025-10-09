import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
  type AxiosError
} from 'axios';
import { ElMessage } from 'element-plus';
import log from './log';

type CacheEntry = { data: unknown; timestamp: number; ttl?: number };
type GetConfig = AxiosRequestConfig & { useCache?: boolean; cacheTtlMs?: number; hideErrorMessage?: boolean };

class ApiService {
  private isInitialized = false;
  private axios!: AxiosInstance;
  private readonly baseURL: string;
  private readonly timeout = 30000;
  private _lastTokenExists: boolean | null = null;
  private requestCache = new Map<string, CacheEntry>();
  private readonly cacheTimeout = 5 * 60 * 1000;

  constructor() {
    this.baseURL = import.meta.env.DEV
      ? `${import.meta.env.VITE_API_TARGET || 'http://localhost:8000'}/api`
      : import.meta.env.VITE_API_BASE_URL || '/api';
  }

  init(): Promise<boolean> {
    try {
      if (this.isInitialized) return Promise.resolve(true);

      this.axios = axios.create({
        baseURL: this.baseURL,
        timeout: this.timeout,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' }
      });

      this.axios.interceptors.request.use(
        (config: InternalAxiosRequestConfig) => {
          const token = localStorage.getItem('auth_token');
          const currentTokenExists = !!token;
          if (this._lastTokenExists !== currentTokenExists) {
            log.debug('请求拦截器 - token状态变化', { exists: currentTokenExists });
            this._lastTokenExists = currentTokenExists;
          }

          if (token) {
            if (token.split('.').length !== 3) {
              log.warn('无效的JWT格式');
              localStorage.removeItem('auth_token');
              this._handleAuthError();
            } else {
              (config.headers as any) = (config.headers || {}) as any;
              (config.headers as any)['Authorization'] = `Bearer ${token}`;
            }
          }
          return config as InternalAxiosRequestConfig;
        },
        error => {
          log.error('API请求拦截错误', error);
          return Promise.reject(error);
        }
      );

      this.axios.interceptors.response.use(
        (response: AxiosResponse) => response,
        (error: AxiosError) => {
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

  private _handleRequestError(error: AxiosError | any) {
    let message = '请求失败';

    if (error?.response) {
      const status: number = (error.response as AxiosResponse).status;
      const data = (error.response as AxiosResponse).data as any;

      switch (status) {
        case 400:
          message = data?.message || '请求参数错误';
          break;
        case 401: {
          message = data?.message || data?.error || data?.detail || '认证失败，请重新登录';

          if (!window._isRemoteLogout) {
            window._isRemoteLogout = false;
            const isSso = data?.errorCode === 'SSO_SESSION_EXPIRED' || data?.detail === 'sso_logout';
            if (isSso) {
              log.warn('检测到SSO登录过期，执行轻量清理并通知前端');
              localStorage.removeItem('auth_token');
              window.dispatchEvent(new CustomEvent('auth:remote-logout'));
            } else {
              log.warn('检测到普通认证失败，执行标准清理流程');
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

      log.error(`API请求失败: ${status}`,
        { url: (error.config as any)?.url, data: (error.response as AxiosResponse | undefined)?.data }
      );
    } else if (error?.request) {
      if (error.code === 'ECONNABORTED') message = '请求超时，请稍后重试';
      else message = '网络连接错误，请检查网络';
      log.error('API请求未收到响应', { url: (error.config as any)?.url });
    } else {
      message = error?.message || '请求初始化失败';
      log.error('API请求设置错误', error);
    }

    if (!((error?.config as any)?.hideErrorMessage)) ElMessage.error(message);
  }

  private _handleAuthError() {
    log.warn('处理认证错误，开始清理认证相关状态（保留记住的凭据）');
    localStorage.removeItem('auth_token');
    localStorage.removeItem('currentUser');

    try {
      localStorage.removeItem('easyssh-user');
    } catch (error) {
      log.error('清除Pinia持久化存储失败', error);
    }

    // 使用动态导入避免在类型检查阶段的循环依赖与 ESM require 问题
    import('@/store/user')
      .then(({ useUserStore }) => {
        const userStore = useUserStore();
        (userStore as any).setToken('');
        (userStore as any).setUserInfo({
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
        } as any);
        (userStore as any).connections = [];
        (userStore as any).favorites = [];
        (userStore as any).history = [];
        (userStore as any).pinnedConnections = {};
      })
      .catch(err => log.error('清除用户Store状态失败', err));

    window.dispatchEvent(new CustomEvent('auth:complete-logout'));
    log.info('认证错误处理完成，已清理相关状态（保留记住的凭据）');
  }

  async get<T = unknown>(url: string, params: Record<string, unknown> = {}, config: GetConfig = {}): Promise<T> {
    if (!this.isInitialized) await this.init();

    const cacheKey = `GET:${url}:${JSON.stringify(params)}`;
    const ttlMs = typeof config.cacheTtlMs === 'number' ? config.cacheTtlMs : this.cacheTimeout;

    if (config.useCache !== false && this.requestCache.has(cacheKey)) {
      const cached = this.requestCache.get(cacheKey)!;
      const effectiveTtl = typeof cached.ttl === 'number' ? cached.ttl : this.cacheTimeout;
      if (Date.now() - cached.timestamp < effectiveTtl) {
        log.debug('使用缓存响应', { url, params });
        return cached.data as T;
      }
      this.requestCache.delete(cacheKey);
    }

    const { cacheTtlMs: _ttlIgnored, useCache: _useCacheIgnored, ...axiosConfig } = config || {};
    const response = await this.axios.get<T>(url, { params, ...(axiosConfig as AxiosRequestConfig) });

    if (config.useCache !== false) {
      this.requestCache.set(cacheKey, { data: response.data, timestamp: Date.now(), ttl: ttlMs });
    }

    return response.data;
  }

  async post<T = unknown, B = unknown>(url: string, data?: B, config: AxiosRequestConfig = {}): Promise<T> {
    if (!this.isInitialized) await this.init();
    const response = await this.axios.post<T>(url, data as any, config);
    return response.data;
  }

  async put<T = unknown, B = unknown>(url: string, data?: B, config: AxiosRequestConfig = {}): Promise<T> {
    if (!this.isInitialized) await this.init();
    this.clearRelatedCache(url);
    const response = await this.axios.put<T>(url, data as any, config);
    return response.data;
  }

  async delete<T = unknown>(url: string, config: AxiosRequestConfig = {}): Promise<T> {
    if (!this.isInitialized) await this.init();
    this.clearRelatedCache(url);
    const response = await this.axios.delete<T>(url, config);
    return response.data;
  }

  clearRelatedCache(url: string) {
    const keysToDelete: string[] = [];
    for (const key of this.requestCache.keys()) if (key.includes(url)) keysToDelete.push(key);
    keysToDelete.forEach(key => this.requestCache.delete(key));
  }

  setGetCache<T = unknown>(url: string, params: Record<string, unknown> = {}, data: T, ttlMs = this.cacheTimeout) {
    const cacheKey = `GET:${url}:${JSON.stringify(params)}`;
    this.requestCache.set(cacheKey, { data, timestamp: Date.now(), ttl: ttlMs });
  }

  clearCache() {
    this.requestCache.clear();
    log.debug('API缓存已清除');
  }

  async patch<T = unknown, B = unknown>(url: string, data?: B, config: AxiosRequestConfig = {}): Promise<T> {
    if (!this.isInitialized) await this.init();
    const response = await this.axios.patch<T>(url, data as any, config);
    return response.data;
  }

  async upload<T = unknown>(url: string, formData: FormData, config: AxiosRequestConfig = {}): Promise<T> {
    if (!this.isInitialized) await this.init();
    const uploadConfig: AxiosRequestConfig = { headers: { 'Content-Type': 'multipart/form-data' }, ...config };
    const response = await this.axios.post<T>(url, formData, uploadConfig);
    return response.data;
  }

  async download(url: string, params: Record<string, unknown> = {}, filename?: string, config: AxiosRequestConfig = {}): Promise<boolean> {
    if (!this.isInitialized) await this.init();
    try {
      const downloadConfig: AxiosRequestConfig = { responseType: 'blob', params, ...config } as AxiosRequestConfig;
      const response = await this.axios.get<Blob>(url, downloadConfig);
      const blob = new Blob([response.data]);
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename || this._getFilenameFromHeader(response) || 'download';
      document.body.appendChild(link);
      link.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(link);
      return true;
    } catch (error) {
      log.error('文件下载失败', error);
      ElMessage.error('文件下载失败');
      return false;
    }
  }

  private _getFilenameFromHeader(response: AxiosResponse): string | null {
    const contentDisposition = (response.headers as any)['content-disposition'];
    if (!contentDisposition) return null;
    const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
    const matches = filenameRegex.exec(contentDisposition);
    if (matches && matches[1]) return matches[1].replace(/['"]/g, '');
    return null;
  }
}

export default new ApiService();
