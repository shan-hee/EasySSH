import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import apiService from './api'
import log from './log'
import { useUserStore } from '../store/user'
import router from '../router'

/**
 * 认证服务模块
 */
class AuthService {
  constructor() {
    this.isInitialized = false
    this.isAuthenticated = ref(false)
    this.currentUser = ref(null)
    this.token = null
    this.tokenKey = 'auth_token'
    this.refreshTokenKey = 'refresh_token'
    this.userStore = null
    this.refreshPromise = null
    this.listeners = []
  }
  
  /**
   * 初始化认证服务
   * @returns {Promise<boolean>} 是否初始化成功
   */
  async init() {
    try {
      if (this.isInitialized) {
        return true
      }
      
      // 从本地存储获取令牌
      this.token = localStorage.getItem(this.tokenKey)
      
      // 如果存在令牌，验证并获取用户信息
      if (this.token) {
        await this.checkAuthStatus()
      }
      
      // 添加事件监听器
      window.addEventListener('auth:expired', this.handleAuthExpired.bind(this))
      
      this.isInitialized = true
      log.info('认证服务初始化完成')
      return true
    } catch (error) {
      log.error('认证服务初始化失败', error)
      return false
    }
  }
  
  /**
   * 检查认证状态
   * @returns {Promise<boolean>} 是否已认证
   */
  async checkAuthStatus() {
    try {
      if (!this.token) {
        this.isAuthenticated.value = false
        this.currentUser.value = null
        return false
      }
      
      // 请求当前用户信息
      const response = await apiService.get('/users/me', {}, { hideErrorMessage: true })
      
      if (response && response.success) {
        this.isAuthenticated.value = true
        this.currentUser.value = response.data.user
        return true
      } else {
        // 令牌无效，清除本地数据
        this.logout(false)
        return false
      }
    } catch (error) {
      // 请求失败，可能是令牌无效或网络问题
      log.error('验证认证状态失败', error)
      
      // 如果是401错误，清除认证状态
      if (error.response && error.response.status === 401) {
        this.logout(false)
      }
      
      return false
    }
  }
  
  /**
   * 处理认证过期事件
   * @private
   */
  handleAuthExpired() {
    const oldToken = localStorage.getItem(this.tokenKey)
    const oldUser = this.currentUser.value
    
    log.warn('认证已过期', {
      hadToken: !!oldToken, 
      tokenLength: oldToken ? oldToken.length : 0,
      hadUser: !!oldUser,
      username: oldUser ? oldUser.username : null
    })
    
    // 清理认证状态
    this.isAuthenticated.value = false
    this.currentUser.value = null
    this.token = null
    localStorage.removeItem(this.tokenKey)
    
    // 如果当前不在登录页，则跳转到登录页
    if (window.location.pathname !== '/login') {
      // 允许登录后返回当前页面
      const currentPath = window.location.pathname
      const redirectParam = currentPath !== '/' ? `?redirect=${encodeURIComponent(currentPath)}` : ''
      router.push(`/login${redirectParam}`)
    }
  }
  
  /**
   * 用户登录
   * @param {string} username - 用户名
   * @param {string} password - 密码
   * @returns {Promise<Object>} 登录结果
   */
  async login(username, password) {
    try {
      log.info(`尝试登录: ${username}`)
      
      const response = await apiService.post('/users/login', { username, password })
      
      if (response && response.success) {
        const { token, user } = response.data
        
        // 添加日志记录token信息
        log.info('登录成功，获取到token', { 
          tokenReceived: !!token,
          tokenLength: token ? token.length : 0,
          tokenPrefix: token ? (token.substring(0, 10) + '...') : 'none'
        })
        
        // 保存令牌和用户信息
        this.token = token
        localStorage.setItem(this.tokenKey, token)
        this.currentUser.value = user
        this.isAuthenticated.value = true
        
        // 检查localStorage中是否成功保存token
        const savedToken = localStorage.getItem(this.tokenKey)
        log.info('Token保存状态', {
          tokenSaved: !!savedToken,
          savedLength: savedToken ? savedToken.length : 0,
          matches: savedToken === token
        })
        
        log.info('用户登录成功', { username: user.username })
        return { success: true, user }
      } else {
        log.warn('登录失败', response)
        return { success: false, message: response.message || '登录失败' }
      }
    } catch (error) {
      log.error('登录请求失败', error)
      
      // 返回友好的错误信息
      let message = '登录失败，请稍后重试'
      if (error.response) {
        message = error.response.data.message || message
      }
      
      return { success: false, message }
    }
  }
  
  /**
   * 用户登出
   * @param {boolean} callApi - 是否调用登出API
   * @returns {Promise<boolean>} 是否登出成功
   */
  async logout(callApi = true) {
    try {
      // 如果需要通知服务器
      if (callApi && this.token) {
        try {
          await apiService.post('/users/logout', {}, { hideErrorMessage: true })
        } catch (error) {
          log.warn('登出API请求失败', error)
          // 继续执行登出流程
        }
      }
      
      // 清除本地认证状态
      this.token = null
      localStorage.removeItem(this.tokenKey)
      this.currentUser.value = null
      this.isAuthenticated.value = false
      
      log.info('用户已登出')
      return true
    } catch (error) {
      log.error('登出失败', error)
      return false
    }
  }
  
  /**
   * 用户注册
   * @param {Object} userData - 用户注册数据
   * @returns {Promise<Object>} 注册结果
   */
  async register(userData) {
    try {
      const response = await apiService.post('/users/register', userData)
      
      if (response && response.success) {
        log.info('用户注册成功')
        return { success: true, message: '注册成功' }
      } else {
        log.warn('注册失败', response)
        return { success: false, message: response.message || '注册失败' }
      }
    } catch (error) {
      log.error('注册请求失败', error)
      
      // 返回友好的错误信息
      let message = '注册失败，请稍后重试'
      if (error.response) {
        message = error.response.data.message || message
      }
      
      return { success: false, message }
    }
  }
  
  /**
   * 更新用户信息
   * @param {Object} userData - 用户数据
   * @returns {Promise<Object>} 更新结果
   */
  async updateUserProfile(userData) {
    try {
      if (!this.isAuthenticated.value) {
        return { success: false, message: '未登录' }
      }
      
      const response = await apiService.put('/users/me', userData)
      
      if (response && response.success) {
        // 更新本地用户信息
        this.currentUser.value = { ...this.currentUser.value, ...response.data.user }
        
        log.info('用户资料已更新')
        return { success: true, user: this.currentUser.value }
      } else {
        log.warn('更新用户资料失败', response)
        return { success: false, message: response.message || '更新失败' }
      }
    } catch (error) {
      log.error('更新用户资料请求失败', error)
      
      // 返回友好的错误信息
      let message = '更新失败，请稍后重试'
      if (error.response) {
        message = error.response.data.message || message
      }
      
      return { success: false, message }
    }
  }
  
  /**
   * 更改密码
   * @param {string} oldPassword - 旧密码
   * @param {string} newPassword - 新密码
   * @returns {Promise<Object>} 更改结果
   */
  async changePassword(oldPassword, newPassword) {
    try {
      if (!this.isAuthenticated.value) {
        return { success: false, message: '未登录' }
      }
      
      const response = await apiService.post('/users/change-password', {
        oldPassword,
        newPassword
      })
      
      if (response && response.success) {
        log.info('密码已更改')
        return { success: true, message: '密码已更改' }
      } else {
        log.warn('密码更改失败', response)
        return { success: false, message: response.message || '密码更改失败' }
      }
    } catch (error) {
      log.error('密码更改请求失败', error)
      
      // 返回友好的错误信息
      let message = '密码更改失败，请稍后重试'
      if (error.response) {
        message = error.response.data.message || message
      }
      
      return { success: false, message }
    }
  }
  
  /**
   * 获取当前认证状态
   * @returns {boolean} 是否已认证
   */
  isLoggedIn() {
    return this.isAuthenticated.value
  }
  
  /**
   * 获取当前用户
   * @returns {Object|null} 当前用户
   */
  getUser() {
    return this.currentUser.value
  }
  
  /**
   * 加载当前用户信息
   * @returns {Promise<Object>} - 用户信息
   */
  async loadUserInfo() {
    try {
      const userInfo = await apiService.get('/users/me')
      this.userStore.setUserInfo(userInfo)
      return userInfo
    } catch (error) {
      // 如果获取用户信息失败，可能是token无效
      if (error.response && error.response.status === 401) {
        // 尝试刷新token
        try {
          await this.refreshToken()
          // 刷新成功后重新获取用户信息
          return await apiService.get('/users/me')
        } catch (refreshError) {
          // 如果刷新失败，则登出
          this.logout()
          throw refreshError
        }
      }
      throw error
    }
  }
  
  /**
   * 刷新访问令牌
   * @returns {Promise<Object>} - 新的令牌
   */
  async refreshToken() {
    // 如果已经有刷新请求，则返回该Promise
    if (this.refreshPromise) {
      return this.refreshPromise
    }
    
    const refreshToken = this.getRefreshToken()
    
    if (!refreshToken) {
      return Promise.reject(new Error('无可用的刷新令牌'))
    }
    
    // 创建新的刷新请求
    this.refreshPromise = apiService.post('/users/refresh', { refreshToken })
      .then(response => {
        // 保存新token
        this.setToken(response.accessToken)
        if (response.refreshToken) {
          this.setRefreshToken(response.refreshToken)
        }
        
        return response
      })
      .finally(() => {
        // 清除Promise引用
        this.refreshPromise = null
      })
    
    return this.refreshPromise
  }
  
  /**
   * 更新用户密码
   * @param {Object} passwordData - 包含旧密码和新密码
   * @returns {Promise<Object>} - 更新结果
   */
  async updatePassword(passwordData) {
    try {
      const response = await apiService.post('/users/password', passwordData)
      ElMessage.success('密码更新成功')
      return response
    } catch (error) {
      console.error('密码更新失败:', error)
      throw error
    }
  }
  
  /**
   * 检查用户是否已认证
   * @returns {boolean} - 认证状态
   */
  isAuthenticated() {
    return !!this.getToken()
  }
  
  /**
   * 获取当前访问令牌
   * @returns {string|null} - 访问令牌
   */
  getToken() {
    return localStorage.getItem(this.tokenKey)
  }
  
  /**
   * 保存访问令牌
   * @param {string} token - 访问令牌
   */
  setToken(token) {
    localStorage.setItem(this.tokenKey, token)
    this.userStore.setToken(token)
  }
  
  /**
   * 获取刷新令牌
   * @returns {string|null} - 刷新令牌
   */
  getRefreshToken() {
    return localStorage.getItem(this.refreshTokenKey)
  }
  
  /**
   * 保存刷新令牌
   * @param {string} token - 刷新令牌
   */
  setRefreshToken(token) {
    localStorage.setItem(this.refreshTokenKey, token)
  }
  
  /**
   * 添加认证事件监听器
   * @param {string} event - 事件名称
   * @param {Function} callback - 回调函数
   */
  addAuthListener(event, callback) {
    this.listeners.push({ event, callback })
  }
  
  /**
   * 移除认证事件监听器
   * @param {string} event - 事件名称
   * @param {Function} callback - 回调函数
   */
  removeAuthListener(event, callback) {
    const index = this.listeners.findIndex(
      listener => listener.event === event && listener.callback === callback
    )
    
    if (index !== -1) {
      this.listeners.splice(index, 1)
    }
  }
  
  /**
   * 触发认证事件
   * @param {string} event - 事件名称
   * @param {Object} data - 事件数据
   */
  emitAuthEvent(event, data = {}) {
    this.listeners
      .filter(listener => listener.event === event)
      .forEach(listener => {
        try {
          listener.callback(data)
        } catch (error) {
          console.error(`执行认证事件监听器出错:`, error)
        }
      })
  }
}

// 创建单例实例
const authService = new AuthService()

export default authService 