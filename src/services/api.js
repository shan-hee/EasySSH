import axios from 'axios'
import { ElMessage } from 'element-plus'
import log from './log'

/**
 * API服务模块
 */
class ApiService {
  constructor() {
    this.isInitialized = false
    this.axios = null
    this.baseURL = import.meta.env.VITE_API_BASE_URL || '/api'
    this.timeout = 30000 // 30秒超时
  }

  /**
   * 初始化API服务
   * @returns {Promise<boolean>} 是否初始化成功
   */
  init() {
    try {
      if (this.isInitialized) {
        return Promise.resolve(true)
      }
      
      // 创建axios实例
      this.axios = axios.create({
        baseURL: this.baseURL,
        timeout: this.timeout,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      })
      
      // 请求拦截器
      this.axios.interceptors.request.use(
        config => {
          // 添加认证token
          const token = localStorage.getItem('auth_token')
          if (token) {
            config.headers['Authorization'] = `Bearer ${token}`
          }
          return config
        },
        error => {
          log.error('API请求拦截错误', error)
          return Promise.reject(error)
        }
      )
      
      // 响应拦截器
      this.axios.interceptors.response.use(
        response => {
          return response
        },
        error => {
          this._handleRequestError(error)
          return Promise.reject(error)
        }
      )
      
      this.isInitialized = true
      log.info('API服务初始化完成')
      return Promise.resolve(true)
    } catch (error) {
      log.error('API服务初始化失败', error)
      return Promise.resolve(false)
    }
  }
  
  /**
   * 处理请求错误
   * @param {Error} error - 错误对象
   * @private
   */
  _handleRequestError(error) {
    let message = '请求失败'
    
    if (error.response) {
      // 服务器返回错误响应
      const status = error.response.status
      const data = error.response.data
      
      switch (status) {
        case 400:
          message = data.message || '请求参数错误'
          break
        case 401:
          message = '认证失败，请重新登录'
          // 可以在这里触发登录过期逻辑
          this._handleAuthError()
          break
        case 403:
          message = '没有权限进行此操作'
          break
        case 404:
          message = '请求的资源不存在'
          break
        case 500:
          message = '服务器内部错误'
          break
        default:
          message = `请求错误(${status})`
      }
      
      log.error(`API请求失败: ${status}`, { url: error.config.url, data: error.response.data })
    } else if (error.request) {
      // 请求发送但未收到响应
      if (error.code === 'ECONNABORTED') {
        message = '请求超时，请稍后重试'
      } else {
        message = '网络连接错误，请检查网络'
      }
      
      log.error('API请求未收到响应', { url: error.config?.url })
    } else {
      // 请求设置过程中发生错误
      message = error.message || '请求初始化失败'
      log.error('API请求设置错误', error)
    }
    
    // 显示错误消息（除非明确要求不显示）
    if (!error.config?.hideErrorMessage) {
      ElMessage.error(message)
    }
  }
  
  /**
   * 处理认证错误
   * @private
   */
  _handleAuthError() {
    // 清除认证token
    localStorage.removeItem('auth_token')
    
    // 这里可以触发登录过期的全局事件
    const event = new CustomEvent('auth:expired')
    window.dispatchEvent(event)
    
    // 可以选择重定向到登录页
    if (window.location.pathname !== '/login') {
      setTimeout(() => {
        window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname)
      }, 1500)
    }
  }
  
  /**
   * 发送GET请求
   * @param {string} url - 请求地址
   * @param {Object} params - 请求参数
   * @param {Object} config - 请求配置
   * @returns {Promise<Object>} - 响应数据
   */
  async get(url, params = {}, config = {}) {
    if (!this.isInitialized) {
      await this.init()
    }
    
    try {
      const response = await this.axios.get(url, { params, ...config })
      return response.data
    } catch (error) {
      throw error
    }
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
      await this.init()
    }
    
    try {
      const response = await this.axios.post(url, data, config)
      return response.data
    } catch (error) {
      throw error
    }
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
      await this.init()
    }
    
    try {
      const response = await this.axios.put(url, data, config)
      return response.data
    } catch (error) {
      throw error
    }
  }
  
  /**
   * 发送DELETE请求
   * @param {string} url - 请求地址
   * @param {Object} config - 请求配置
   * @returns {Promise<Object>} - 响应数据
   */
  async delete(url, config = {}) {
    if (!this.isInitialized) {
      await this.init()
    }
    
    try {
      const response = await this.axios.delete(url, config)
      return response.data
    } catch (error) {
      throw error
    }
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
      await this.init()
    }
    
    try {
      const response = await this.axios.patch(url, data, config)
      return response.data
    } catch (error) {
      throw error
    }
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
      await this.init()
    }
    
    try {
      const uploadConfig = {
        headers: {
          'Content-Type': 'multipart/form-data'
        },
        ...config
      }
      
      const response = await this.axios.post(url, formData, uploadConfig)
      return response.data
    } catch (error) {
      throw error
    }
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
      await this.init()
    }
    
    try {
      const downloadConfig = {
        responseType: 'blob',
        params,
        ...config
      }
      
      const response = await this.axios.get(url, downloadConfig)
      
      // 创建Blob对象
      const blob = new Blob([response.data])
      
      // 创建下载链接
      const downloadUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = filename || this._getFilenameFromHeader(response) || 'download'
      
      // 触发下载
      document.body.appendChild(link)
      link.click()
      
      // 清理
      window.URL.revokeObjectURL(downloadUrl)
      document.body.removeChild(link)
      
      return true
    } catch (error) {
      log.error('文件下载失败', error)
      ElMessage.error('文件下载失败')
      return false
    }
  }
  
  /**
   * 从响应头中获取文件名
   * @param {Object} response - 响应对象
   * @returns {string|null} - 文件名
   * @private
   */
  _getFilenameFromHeader(response) {
    const contentDisposition = response.headers['content-disposition']
    if (!contentDisposition) return null
    
    const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/
    const matches = filenameRegex.exec(contentDisposition)
    if (matches && matches[1]) {
      return matches[1].replace(/['"]/g, '')
    }
    return null
  }
}

export default new ApiService() 