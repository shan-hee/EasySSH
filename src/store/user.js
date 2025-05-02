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
    lastLogin: null
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
  
  async function login(credentials) {
    try {
      // 这里应该是实际的API调用
      // const response = await api.login(credentials)
      
      // 模拟登录成功
      const mockResponse = {
        token: 'mock_jwt_token_' + Date.now(),
        userInfo: {
          id: '1',
          username: credentials.username,
          email: `${credentials.username}@example.com`,
          avatar: '/assets/default-avatar.png',
          role: 'user',
          lastLogin: new Date().toISOString()
        }
      }
      
      // 保存登录信息
      setToken(mockResponse.token)
      setUserInfo(mockResponse.userInfo)
      
      // 登录成功的消息现在在App.vue中显示，这里不再重复显示
      // ElMessage.success('登录成功')
      
      // 导航到之前尝试访问的页面或默认到控制台
      const redirectPath = router.currentRoute.value.query.redirect || '/dashboard'
      router.push(redirectPath)
      
      return true
    } catch (error) {
      console.error('登录失败:', error)
      ElMessage.error('登录失败: ' + (error.message || '未知错误'))
      return false
    }
  }
  
  function logout() {
    // 清除用户数据
    setToken('')
    setUserInfo({
      id: '',
      username: '',
      email: '',
      avatar: '',
      role: '',
      lastLogin: null
    })
    
    // 返回到首页，由页面控制登录面板的显示
    router.push('/')
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
    logout
  }
}, {
  persist: {
    key: 'easyssh-user',
    storage: localStorage,
    paths: ['token', 'userInfo', 'preferences']
  }
}) 