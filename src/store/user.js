import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import router from '../router'

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
      // 模拟登录API调用
      // 在实际应用中，这里会调用后端API进行认证
      if (credentials.username === 'admin' && credentials.password === 'admin') {
        // 检查用户是否启用了MFA
        const userRecord = {
          id: '1',
          username: credentials.username,
          email: 'admin@example.com',
          role: 'admin',
          lastLogin: new Date().toISOString(),
          mfaEnabled: userInfo.value.mfaEnabled || false,
          mfaSecret: userInfo.value.mfaSecret || ''
        }
        
        // 如果启用了MFA，需要额外验证
        if (userRecord.mfaEnabled) {
          // 先存储临时登录信息，不设置token
          return { 
            success: true, 
            requireMfa: true,
            user: userRecord
          }
        }
        
        // 未启用MFA，直接完成登录
        setToken('mock-token-123456')
        setUserInfo(userRecord)
      
        return { success: true }
      } else {
        throw new Error('用户名或密码错误')
      }
    } catch (error) {
      console.error('登录失败:', error)
      return { success: false, error: error.message }
    }
  }
  
  // 验证MFA代码
  async function verifyMfaCode(code, tempUserInfo) {
    try {
      // 这里应该调用API验证MFA代码
      // 模拟验证成功，任何6位数字代码都可以通过
      if (code && code.length === 6 && /^\d+$/.test(code)) {
        // 验证成功，设置token和用户信息
        setToken('mock-token-123456')
        setUserInfo(tempUserInfo)
        return { success: true }
      } else {
        return { success: false, error: '验证码不正确' }
      }
    } catch (error) {
      console.error('MFA验证失败:', error)
      return { success: false, error: error.message }
    }
  }
  
  // 登出
  function logout() {
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
    
    // 可以在这里调用API通知后端用户已登出
  }
  
  // 更新用户资料
  async function updateProfile(userData) {
    try {
      // 这里应该调用API更新用户资料
      // 模拟API调用
      console.log('更新用户资料:', userData)
      
      // 如果包含密码信息，应该验证原密码
      if (userData.oldPassword) {
        // 这里应该进行密码验证的API调用
        if (userData.oldPassword !== 'admin') {
          throw new Error('原密码不正确')
        }
      }
      
      // 更新本地用户信息
      setUserInfo({
        ...userInfo.value,
        username: userData.username,
        // 更新多因素身份验证设置
        mfaEnabled: userData.mfaEnabled,
        mfaSecret: userData.mfaSecret || userInfo.value.mfaSecret
      })
      
      return { success: true }
    } catch (error) {
      console.error('更新用户资料失败:', error)
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