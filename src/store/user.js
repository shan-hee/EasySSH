import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import router from '../router'
import apiService from '../services/api'
import log from '../services/log'

export const useUserStore = defineStore('user', () => {
  // 状态
  const token = ref('')
  const userInfo = ref({
    id: '',
    username: '',
    email: '',
    avatar: '',
    role: '',
    lastLogin: null,
    mfaEnabled: false,
    mfaSecret: ''
  })
  const preferences = ref({
    theme: 'system',
    language: 'zh-CN',
    terminalFont: "'JetBrains Mono'",
    terminalFontSize: 14,
    showStatusBar: true,
    autoSave: true
  })
  
  // 计算属性
  const isLoggedIn = computed(() => !!token.value)
  const isAdmin = computed(() => userInfo.value.role === 'admin')
  const username = computed(() => userInfo.value.username)
  
  // 操作方法
  function setToken(newToken) {
    token.value = newToken
    // 将token保存到localStorage
    if (newToken) {
      localStorage.setItem('auth_token', newToken)
    } else {
      localStorage.removeItem('auth_token')
    }
  }
  
  function setUserInfo(info) {
    userInfo.value = { ...userInfo.value, ...info }
  }
  
  function updatePreferences(newPrefs) {
    preferences.value = { ...preferences.value, ...newPrefs }
  }
  
  // 登录
  async function login(credentials) {
    try {
      // 初始化API服务
      await apiService.init()
      
      log.info('开始登录流程', { username: credentials.username })
      
      // 调用后端登录API
      const response = await apiService.post('/users/login', {
        username: credentials.username,
        password: credentials.password
      })
      
      // 检查登录结果
      if (response && response.success) {
        log.info('登录成功，获取到响应', { 
          token: response.token ? `${response.token.substring(0, 15)}...` : 'undefined',
          hasToken: !!response.token,
          tokenLength: response.token ? response.token.length : 0, 
          user: response.user ? response.user.username : null
        })
        
        // 检查是否需要MFA验证
        if (response.requireMfa) {
          // 需要MFA验证，返回相关信息但不设置token
          return { 
            success: true, 
            requireMfa: true,
            user: response.user
          }
        }
        
        // 不需要MFA或MFA已验证，设置token和用户信息
        if (response.token) {
          // 直接操作localStorage确保token被保存
          localStorage.setItem('auth_token', response.token)
          // 然后更新状态
          token.value = response.token
          
          // 验证token是否正确保存
          const savedToken = localStorage.getItem('auth_token')
          log.info('Token保存状态', {
            saved: !!savedToken,
            length: savedToken ? savedToken.length : 0,
            matches: savedToken === response.token,
            preview: savedToken ? `${savedToken.substring(0, 15)}...` : 'null'
          })
        } else {
          log.error('登录响应中没有token')
        }
        
        setUserInfo(response.user)
      
        return { success: true }
      } else {
        // 登录失败
        const errorMsg = response?.message || '登录失败'
        throw new Error(errorMsg)
      }
    } catch (error) {
      log.error('登录失败', error)
      return { 
        success: false, 
        error: error.response?.data?.message || error.message || '登录失败，请检查用户名和密码' 
      }
    }
  }
  
  // 验证MFA代码
  async function verifyMfaCode(code, tempUserInfo) {
    try {
      // 调用后端MFA验证API
      const response = await apiService.post('/users/verify-mfa', {
        username: tempUserInfo.username,
        code: code
      })
      
      if (response && response.success) {
        // 验证成功，设置token和用户信息
        setToken(response.token)
        setUserInfo(response.user || tempUserInfo)
        return { success: true }
      } else {
        return { success: false, error: response?.message || '验证码不正确' }
      }
    } catch (error) {
      log.error('MFA验证失败', error)
      return { success: false, error: error.response?.data?.message || error.message || 'MFA验证失败' }
    }
  }
  
  // 登出
  async function logout() {
    try {
      // 如果已登录，调用后端登出API
      if (isLoggedIn.value) {
        await apiService.post('/users/logout')
      }
    } catch (error) {
      log.error('登出API调用失败', error)
      // 即使API调用失败，也继续清除本地状态
    } finally {
    // 清空token和用户信息
    setToken('')
    setUserInfo({
      id: '',
      username: '',
      email: '',
      avatar: '',
      role: '',
      lastLogin: null,
      mfaEnabled: false,
      mfaSecret: ''
    })
    }
  }
  
  // 更新用户资料
  async function updateProfile(userData) {
    try {
      // 调用后端更新用户资料API
      const response = await apiService.put('/users/me', userData)
      
      if (response && response.success) {
      // 更新本地用户信息
        setUserInfo(response.user)
        return { success: true }
      } else {
        throw new Error(response?.message || '更新资料失败')
      }
    } catch (error) {
      log.error('更新用户资料失败', error)
      throw error
    }
  }
  
  return {
    // 状态
    token,
    userInfo,
    preferences,
    
    // 计算属性
    isLoggedIn,
    isAdmin,
    username,
    
    // 方法
    setToken,
    setUserInfo,
    updatePreferences,
    login,
    logout,
    updateProfile,
    verifyMfaCode
  }
}) 