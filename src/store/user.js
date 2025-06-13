import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import router from '../router'
import apiService from '../services/api'
import log from '../services/log'
import scriptLibraryService from '../services/scriptLibrary'

// 用于存储加密凭据的键名
const CREDENTIALS_KEY = 'easyssh_credentials'

// 简单加密函数，真实场景应使用更安全的加密方法
function encryptCredentials(username, password) {
  // 这里使用一个极简的编码方法，实际应用中应使用更安全的加密算法
  return btoa(JSON.stringify({
    u: username,
    p: password,
    t: Date.now()
  }))
}

// 解密凭据函数
function decryptCredentials() {
  try {
    const encrypted = localStorage.getItem(CREDENTIALS_KEY)
    if (!encrypted) return null
    
    const decoded = JSON.parse(atob(encrypted))
    return {
      username: decoded.u,
      password: decoded.p,
      timestamp: decoded.t
    }
  } catch (error) {
    log.error('解密凭据失败', error)
    return null
  }
}

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
    displayName: '',
    theme: 'system',
    fontSize: 14
  })
  const preferences = ref({
    theme: 'system',
    language: 'zh-CN',
    terminalFont: "'JetBrains Mono'",
    terminalFontSize: 14,
    showStatusBar: true,
    autoSave: true
  })
  
  // 连接相关状态
  const connections = ref([])
  const favorites = ref([])
  const history = ref([])
  const pinnedConnections = ref({})
  
  // 计算属性
  const isLoggedIn = computed(() => !!token.value)
  const isAdmin = computed(() => userInfo.value.role === 'admin')
  const username = computed(() => userInfo.value.username)
  
  // 连接相关计算属性
  const favoriteConnections = computed(() => {
    return connections.value.filter(conn => favorites.value.includes(conn.id))
  })
  
  const historyConnections = computed(() => {
    return history.value
  })
  
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
    
    // 同时将用户信息保存到localStorage的currentUser中，方便其他服务直接访问
    try {
      localStorage.setItem('currentUser', JSON.stringify(userInfo.value))
    } catch (error) {
      log.error('保存currentUser到localStorage失败', error)
    }
  }
  
  function updatePreferences(newPrefs) {
    preferences.value = { ...preferences.value, ...newPrefs }
  }
  
  // 保存用户凭据（记住密码）
  function saveUserCredentials(username, password) {
    try {
      const encrypted = encryptCredentials(username, password)
      localStorage.setItem(CREDENTIALS_KEY, encrypted)
      log.info('用户凭据已保存，下次登录将自动填充')
    } catch (error) {
      log.error('保存用户凭据失败', error)
    }
  }
  
  // 清除保存的用户凭据
  function clearUserCredentials() {
    localStorage.removeItem(CREDENTIALS_KEY)
    log.info('用户凭据已清除')
  }
  
  // 连接相关方法
  
  // 添加连接的请求状态跟踪
  const addingConnections = new Set()

  // 添加新连接
  function addConnection(connection) {
    try {
      // 检查是否已存在相同的连接（去重）
      const existingConnection = connections.value.find(conn =>
        conn.host === connection.host &&
        conn.port === connection.port &&
        conn.username === connection.username
      )

      if (existingConnection) {
        // 如果连接已存在，更新现有连接信息
        Object.assign(existingConnection, connection, { id: existingConnection.id })
        log.info('连接已存在，已更新连接信息')
        return existingConnection.id
      }

      // 生成唯一ID
      connection.id = Date.now().toString()

      // 防重复提交检查
      const connectionKey = `${connection.host}:${connection.port}:${connection.username}`
      if (addingConnections.has(connectionKey)) {
        log.warn('连接正在添加中，跳过重复请求', connectionKey)
        return null
      }

      connections.value.push(connection)

      // 同步到服务器
      if (isLoggedIn.value) {
        // 标记正在添加
        addingConnections.add(connectionKey)

        // 异步保存到服务器，不阻塞UI
        apiService.post('/connections', { connection })
          .then(response => {
            if (response && !response.success && response.existingConnectionId) {
              // 服务器返回连接已存在，更新本地ID
              const localConnection = connections.value.find(c => c.id === connection.id)
              if (localConnection) {
                localConnection.id = response.existingConnectionId
              }
              log.info('服务器检测到重复连接，已更新本地ID')
            }
          })
          .catch(error => {
            // API可能未实现，不影响用户体验
            log.warn('同步连接到服务器失败，仅保存在本地', error)
          })
          .finally(() => {
            // 清除添加状态
            addingConnections.delete(connectionKey)
          })
      }

      return connection.id
    } catch (error) {
      log.error('添加连接失败', error)
      ElMessage.error('添加连接失败')
      return null
    }
  }
  
  // 更新连接
  function updateConnection(id, updatedConnection) {
    try {
      const index = connections.value.findIndex(conn => conn.id === id)
      if (index === -1) {
        throw new Error(`未找到ID为${id}的连接`)
      }
      
      // 更新连接信息
      connections.value[index] = { ...connections.value[index], ...updatedConnection }
      
      // 同步到服务器
      if (isLoggedIn.value) {
        apiService.put(`/connections/${id}`, { connection: connections.value[index] })
          .catch(error => {
            // API可能未实现，不影响用户体验
            log.warn('同步连接更新到服务器失败，仅保存在本地', error)
          })
      }
      
      return connections.value[index]
    } catch (error) {
      log.error('更新连接失败', error)
      ElMessage.error('更新连接失败')
      return null
    }
  }
  
  // 删除连接
  function deleteConnection(id) {
    try {
      const index = connections.value.findIndex(conn => conn.id === id)
      if (index === -1) {
        throw new Error(`未找到ID为${id}的连接`)
      }
      
      // 删除连接
      connections.value.splice(index, 1)
      
      // 同时从收藏和置顶中移除
      const favIndex = favorites.value.indexOf(id)
      if (favIndex !== -1) {
        favorites.value.splice(favIndex, 1)
      }
      
      if (pinnedConnections.value[id]) {
        delete pinnedConnections.value[id]
      }
      
      // 同步到服务器
      if (isLoggedIn.value) {
        apiService.delete(`/connections/${id}`)
          .catch(error => log.error('同步连接删除到服务器失败', error))
      }
      
      return true
    } catch (error) {
      log.error('删除连接失败', error)
      ElMessage.error('删除连接失败')
      return false
    }
  }
  
  // 同步本地连接数据到服务器
  async function syncConnectionsToServer() {
    if (!isLoggedIn.value) return false
    
    try {
      // 检查API是否可用
      const apiCheckResponse = await apiService.get('/connections/check')
      .catch(() => ({ success: false }));
      
      // 如果API未实现或不可用，使用空数据，不影响用户体验
      if (!apiCheckResponse || !apiCheckResponse.success) {
        log.warn('连接同步API未实现或不可用，将使用本地数据')
        return false
      }
      
      // 同步连接列表
      await apiService.post('/connections/sync', {
        connections: connections.value,
        favorites: favorites.value,
        history: history.value,
        pinned: pinnedConnections.value
      })
      
      log.info('连接数据已同步到服务器')
      return true
    } catch (error) {
      // 不影响用户体验，只记录错误
      log.warn('同步连接数据到服务器失败，将继续使用本地数据', error)
      return false
    }
  }
  
  // 从服务器加载连接数据
  async function loadConnectionsFromServer() {
    if (!isLoggedIn.value) return false
    
    try {
      // 检查API是否可用
      const apiCheckResponse = await apiService.get('/connections/check')
      .catch(() => ({ success: false }));
      
      // 如果API未实现或不可用，使用空数据，不影响用户体验
      if (!apiCheckResponse || !apiCheckResponse.success) {
        log.warn('连接同步API未实现或不可用，将使用本地数据')
        return false
      }
      
      // 获取用户连接列表
      const connectionsResponse = await apiService.get('/connections')
      if (connectionsResponse && connectionsResponse.success) {
        connections.value = connectionsResponse.connections || []
      }
      
      // 获取用户收藏的连接
      const favoritesResponse = await apiService.get('/connections/favorites')
      if (favoritesResponse && favoritesResponse.success) {
        favorites.value = favoritesResponse.favorites || []
      }
      
      // 获取用户的历史记录
      const historyResponse = await apiService.get('/connections/history')
      if (historyResponse && historyResponse.success) {
        history.value = historyResponse.history || []
      }
      
      // 获取用户的置顶信息
      const pinnedResponse = await apiService.get('/connections/pinned')
      if (pinnedResponse && pinnedResponse.success) {
        pinnedConnections.value = pinnedResponse.pinned || {}
      }
      
      log.info('连接数据已从服务器加载')
      return true
    } catch (error) {
      // 不影响用户体验，只记录错误
      log.warn('从服务器加载连接数据失败，将使用本地数据', error)
      return false
    }
  }
  
  // 添加到历史记录
  function addToHistory(connection) {
    // 直接添加到历史记录开头，不去重
    history.value.unshift({
      id: connection.id,
      name: connection.name,
      host: connection.host,
      username: connection.username,
      port: connection.port,
      description: connection.description,
      timestamp: Date.now()
    })

    // 限制历史记录数量为20条
    if (history.value.length > 20) {
      history.value.pop()
    }

    // 同步到服务器
    if (isLoggedIn.value) {
      // 确保连接已创建成功后再同步历史记录
      apiService.post('/connections/history', { history: history.value })
        .catch(error => {
          log.error('同步历史记录到服务器失败', error)
          // 添加重试机制
          setTimeout(() => {
            apiService.post('/connections/history', { history: history.value })
              .catch(retryError => log.error('重试同步历史记录失败', retryError))
          }, 1000)
        })
    }
  }

  // 从历史记录中删除指定连接
  function removeFromHistory(connectionId, timestamp) {
    history.value = history.value.filter(h =>
      !(h.id === connectionId && h.timestamp === timestamp)
    )

    // 同步到服务器
    if (isLoggedIn.value) {
      apiService.post('/connections/history', { history: history.value })
        .catch(error => log.error('同步历史记录删除到服务器失败', error))
    }
  }

  // 重新排序历史连接
  function reorderHistoryConnections(newOrder) {
    history.value = [...newOrder]

    // 同步到服务器
    if (isLoggedIn.value) {
      apiService.post('/connections/history', { history: history.value })
        .catch(error => log.error('同步历史记录排序到服务器失败', error))
    }
  }

  // 更新历史连接顺序（用于乐观更新）
  function updateHistoryOrder(newOrder) {
    history.value = [...newOrder]
  }
  
  // 收藏连接
  function toggleFavorite(id) {
    const index = favorites.value.indexOf(id)
    
    if (index === -1) {
      // 添加到收藏
      favorites.value.push(id)
    } else {
      // 从收藏中移除
      favorites.value.splice(index, 1)
    }
    
    // 同步到服务器
    if (isLoggedIn.value) {
      apiService.post('/connections/favorites', { favorites: favorites.value })
        .catch(error => log.error('同步收藏状态到服务器失败', error))
    }
    
    return index === -1 // 返回当前是否为收藏状态
  }
  
  // 置顶连接
  function togglePin(id) {
    if (pinnedConnections.value[id]) {
      // 取消置顶
      delete pinnedConnections.value[id]
    } else {
      // 添加置顶
      pinnedConnections.value[id] = true
    }
    
    // 同步到服务器
    if (isLoggedIn.value) {
      apiService.post('/connections/pinned', { pinned: pinnedConnections.value })
        .catch(error => log.error('同步置顶状态到服务器失败', error))
    }
    
    return !!pinnedConnections.value[id] // 返回当前是否为置顶状态
  }
  
  // 检查是否收藏
  function isFavorite(id) {
    return favorites.value.includes(id)
  }
  
  // 检查是否置顶
  function isPinned(id) {
    return !!pinnedConnections.value[id]
  }
  
  // 登录
  async function login(credentials) {
    try {
      // 初始化API服务
      await apiService.init()
      
      log.info('开始登录流程', { username: credentials.username, remember: credentials.remember })
      
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
          user: response.user ? response.user.username : null,
          isDefaultPassword: response.isDefaultPassword || false
        })
        
        // 处理记住密码功能
        if (credentials.remember) {
          saveUserCredentials(credentials.username, credentials.password)
        } else {
          clearUserCredentials()
        }
        
        // 检查是否需要MFA验证
        if (response.user && response.user.mfaEnabled) {
          // 需要MFA验证，返回相关信息但不设置token
          return { 
            success: true, 
            requireMfa: true,
            user: response.user,
            isDefaultPassword: response.isDefaultPassword || false
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
      
        // 登录成功后，尝试加载用户的连接配置
        // 使用catch内部处理错误，不影响登录流程
        loadConnectionsFromServer().catch(() => {
          log.warn('加载用户连接配置失败，将使用本地数据')
        })

        // 同步脚本库数据（包括收藏状态）
        try {
          scriptLibraryService.syncFromServer().catch(() => {
            log.warn('同步脚本库数据失败，将使用本地数据')
          })
        } catch (error) {
          log.warn('调用脚本库服务失败:', error)
        }
      
        return { 
          success: true, 
          silent: credentials.silent,
          isDefaultPassword: response.isDefaultPassword || false
        }
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
      // 调用后端MFA验证API，注意在MFA验证阶段可能没有正式token
      // 需要使用临时凭证或会话ID
      // 修改请求结构，确保包含足够信息让服务器验证用户身份
      const response = await apiService.post('/users/login', {
        username: tempUserInfo.username,
        mfaCode: code,
        isMfaVerification: true
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
      displayName: '',
      theme: 'system',
      fontSize: 14
    })
    
    // 清空连接配置信息
    connections.value = []
    favorites.value = []
    history.value = []
    pinnedConnections.value = {}
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
  
  // 注销所有设备
  async function logoutAllDevices() {
    try {
      // 调用后端注销所有设备API
      const response = await apiService.post('/users/logout-all-devices')
      
      if (response && response.success) {
        // 清除所有保存的凭据
        clearUserCredentials()
        
        // 直接清除本地状态，不再调用logout()方法
        // 因为logout()方法会尝试调用后端API，可能导致401错误
        setToken('')
        setUserInfo({
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
        })
        
        return { success: true }
      } else {
        throw new Error(response?.message || '注销所有设备失败')
      }
    } catch (error) {
      log.error('注销所有设备失败', error)
      throw error
    }
  }
  
  return {
    // 状态
    token,
    userInfo,
    preferences,
    connections,
    favorites,
    history,
    pinnedConnections,
    
    // 计算属性
    isLoggedIn,
    isAdmin,
    username,
    favoriteConnections,
    historyConnections,
    
    // 方法
    setToken,
    setUserInfo,
    updatePreferences,
    login,
    logout,
    updateProfile,
    verifyMfaCode,
    logoutAllDevices,
    saveUserCredentials,
    clearUserCredentials,
    
    // 连接相关方法
    addConnection,
    updateConnection,
    deleteConnection,
    addToHistory,
    removeFromHistory,
    reorderHistoryConnections,
    updateHistoryOrder,
    toggleFavorite,
    togglePin,
    isFavorite,
    isPinned,
    syncConnectionsToServer,
    loadConnectionsFromServer
  }
}, {
  persist: {
    key: 'easyssh-user',
    storage: localStorage,
    paths: ['token', 'userInfo', 'preferences', 'connections', 'favorites', 'history', 'pinnedConnections']
  }
}) 