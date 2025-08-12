import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import router from '../router'
import apiService from '../services/api'
import log from '../services/log'
import scriptLibraryService from '../services/scriptLibrary'
import storageService from '../services/storage'
import authStateManager from '../services/auth-state-manager'

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
    const encrypted = storageService.getItem(CREDENTIALS_KEY)
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
    // 直接使用localStorage确保与API拦截器一致
    if (newToken) {
      localStorage.setItem('auth_token', newToken)
    } else {
      localStorage.removeItem('auth_token')
    }
  }
  
  function setUserInfo(info) {
      userInfo.value = { ...userInfo.value, ...info }

    // 同时将用户信息保存到统一存储的currentUser中，方便其他服务直接访问
    try {
      storageService.setItem('currentUser', JSON.stringify(userInfo.value))
    } catch (error) {
      log.error('保存currentUser到统一存储失败', error)
    }
  }
  
  function updatePreferences(newPrefs) {
    preferences.value = { ...preferences.value, ...newPrefs }
  }
  
  // 保存用户凭据（记住密码）
  function saveUserCredentials(username, password) {
    try {
      const encrypted = encryptCredentials(username, password)
      storageService.setItem(CREDENTIALS_KEY, encrypted)
      // 日志记录移到调用处，避免重复
    } catch (error) {
      log.error('保存用户凭据失败', error)
    }
  }

  // 清除保存的用户凭据
  function clearUserCredentials() {
    storageService.removeItem(CREDENTIALS_KEY)
    log.info('用户凭据已清除')
  }
  
  // 连接相关方法
  
  // 添加连接的请求状态跟踪
  const addingConnections = new Set()

  // 添加新连接
  async function addConnection(connection) {
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

      // 如果用户已登录，先同步到服务器再更新本地状态
      if (isLoggedIn.value) {
        // 标记正在添加
        addingConnections.add(connectionKey)

        try {
          // 同步保存到服务器
          const response = await apiService.post('/connections', { connection })

          if (response && response.success) {
            // 服务器保存成功，使用服务器返回的ID
            connection.id = response.connectionId || connection.id
            connections.value.push(connection)
            log.info('连接已成功保存到服务器和本地')
          } else if (response && !response.success && response.existingConnectionId) {
            // 服务器返回连接已存在，使用现有连接ID
            connection.id = response.existingConnectionId
            connections.value.push(connection)
            log.info('服务器检测到重复连接，已更新本地ID')
          } else {
            throw new Error(response?.message || '服务器保存失败')
          }
        } catch (error) {
          log.error('同步连接到服务器失败', error)
          ElMessage.error('保存连接失败：' + (error.message || '网络错误'))
          return null
        } finally {
          // 清除添加状态
          addingConnections.delete(connectionKey)
        }
      } else {
        // 用户未登录，仅保存到本地
        connections.value.push(connection)
        log.info('连接已保存到本地（用户未登录）')
      }

      return connection.id
    } catch (error) {
      log.error('添加连接失败', error)
      ElMessage.error('添加连接失败')
      return null
    }
  }
  
  // 更新连接
  async function updateConnection(id, updatedConnection) {
    try {
      const index = connections.value.findIndex(conn => conn.id === id)
      if (index === -1) {
        throw new Error(`未找到ID为${id}的连接`)
      }

      // 保存原始数据，以便回滚
      const originalConnection = { ...connections.value[index] }

      // 更新连接信息
      connections.value[index] = { ...connections.value[index], ...updatedConnection }

      // 同步到服务器
      if (isLoggedIn.value) {
        try {
          const response = await apiService.put(`/connections/${id}`, { connection: connections.value[index] })

          if (response && response.success) {
            log.info('连接更新已同步到服务器')
          } else {
            throw new Error(response?.message || '服务器更新失败')
          }
        } catch (error) {
          // 如果是404错误，说明服务器上没有这个连接，需要重新创建
          if (error.response && error.response.status === 404) {
            log.warn('服务器上未找到连接，尝试重新创建', { connectionId: id })

            try {
              // 尝试重新创建连接
              const createResponse = await apiService.post('/connections', { connection: connections.value[index] })

              if (createResponse && createResponse.success) {
                // 更新本地连接ID为服务器返回的ID
                const newId = createResponse.connectionId
                connections.value[index].id = newId
                log.info('连接已重新创建到服务器', { oldId: id, newId })
                ElMessage.success('连接已重新同步到服务器')
              } else {
                throw new Error(createResponse?.message || '重新创建连接失败')
              }
            } catch (createError) {
              log.error('重新创建连接失败', createError)
              // 回滚本地更改
              connections.value[index] = originalConnection
              ElMessage.error('连接同步失败，已回滚更改：' + (createError.message || '网络错误'))
              return null
            }
          } else {
            log.error('同步连接更新到服务器失败', error)
            // 回滚本地更改
            connections.value[index] = originalConnection
            ElMessage.error('连接更新失败，已回滚更改：' + (error.message || '网络错误'))
            return null
          }
        }
      }

      return connections.value[index]
    } catch (error) {
      log.error('更新连接失败', error)
      ElMessage.error('更新连接失败')
      return null
    }
  }
  
  // 删除连接
  async function deleteConnection(id) {
    try {
      const index = connections.value.findIndex(conn => conn.id === id)
      if (index === -1) {
        throw new Error(`未找到ID为${id}的连接`)
      }

      // 保存原始数据用于回滚
      const originalConnection = connections.value[index]
      const originalFavIndex = favorites.value.indexOf(id)
      const originalPinned = pinnedConnections.value[id]

      // 先删除本地数据
      connections.value.splice(index, 1)

      // 同时从收藏和置顶中移除
      if (originalFavIndex !== -1) {
        favorites.value.splice(originalFavIndex, 1)
      }

      if (originalPinned) {
        delete pinnedConnections.value[id]
      }

      // 同步到服务器
      if (isLoggedIn.value) {
        try {
          const response = await apiService.delete(`/connections/${id}`)

          if (response && response.success) {
            log.info('连接删除已同步到服务器')
          } else {
            throw new Error(response?.message || '服务器删除失败')
          }
        } catch (error) {
          log.error('同步连接删除到服务器失败', error)

          // 回滚本地更改
          connections.value.splice(index, 0, originalConnection)
          if (originalFavIndex !== -1) {
            favorites.value.splice(originalFavIndex, 0, id)
          }
          if (originalPinned) {
            pinnedConnections.value[id] = originalPinned
          }

          ElMessage.error('删除连接失败，已回滚更改：' + (error.message || '网络错误'))
          return false
        }
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
  async function loadConnectionsFromServer(forceRefresh = false) {
    if (!isLoggedIn.value) return false

    try {
      // 如果不是强制刷新，检查数据是否需要更新
      if (!forceRefresh) {
        const lastUpdateTime = localStorage.getItem('connections_last_update')
        if (lastUpdateTime) {
          const timeDiff = Date.now() - parseInt(lastUpdateTime)
          // 如果数据更新时间少于2分钟，跳过刷新
          if (timeDiff < 2 * 60 * 1000) {
            log.debug('连接数据较新，跳过刷新')
            return true
          }
        }
      }

      // 检查API是否可用
      const apiCheckResponse = await apiService.get('/connections/check')
      .catch(() => ({ success: false }));

      // 如果API未实现或不可用，使用空数据，不影响用户体验
      if (!apiCheckResponse || !apiCheckResponse.success) {
        log.warn('连接同步API未实现或不可用，将使用本地数据')
        return false
      }

      const requestOptions = forceRefresh ? {
        headers: { 'Cache-Control': 'no-cache' },
        timestamp: Date.now() // 添加时间戳防止缓存
      } : {}

      // 获取用户连接列表
      const connectionsResponse = await apiService.get('/connections', {}, requestOptions)
      if (connectionsResponse && connectionsResponse.success) {
        connections.value = connectionsResponse.connections || []
        log.debug('连接列表已更新', { count: connections.value.length })
      }

      // 获取用户收藏的连接
      const favoritesResponse = await apiService.get('/connections/favorites', {}, requestOptions)
      if (favoritesResponse && favoritesResponse.success) {
        favorites.value = favoritesResponse.favorites || []
        log.debug('收藏列表已更新', { count: favorites.value.length })
      }

      // 获取用户的历史记录
      const historyResponse = await apiService.get('/connections/history', {}, requestOptions)
      if (historyResponse && historyResponse.success) {
        history.value = historyResponse.history || []
        log.debug('历史记录已更新', { count: history.value.length })
      }

      // 获取用户的置顶信息
      const pinnedResponse = await apiService.get('/connections/pinned', {}, requestOptions)
      if (pinnedResponse && pinnedResponse.success) {
        pinnedConnections.value = pinnedResponse.pinned || {}
        log.debug('置顶信息已更新')
      }

      // 更新数据刷新时间戳
      localStorage.setItem('connections_last_update', Date.now().toString())

      log.info('连接数据已从服务器加载', {
        forceRefresh,
        connectionsCount: connections.value.length,
        favoritesCount: favorites.value.length,
        historyCount: history.value.length
      })
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
  async function removeFromHistory(connectionId, timestamp) {
    // 保存原始数据用于回滚
    const originalHistory = [...history.value]

    // 删除指定的历史记录
    history.value = history.value.filter(h =>
      !(h.id === connectionId && h.timestamp === timestamp)
    )

    // 同步到服务器
    if (isLoggedIn.value) {
      try {
        const response = await apiService.post('/connections/history', { history: history.value })

        if (response && response.success) {
          log.info('历史记录删除已同步到服务器')
        } else {
          throw new Error(response?.message || '服务器同步失败')
        }
      } catch (error) {
        log.error('同步历史记录删除到服务器失败', error)

        // 回滚本地更改
        history.value = originalHistory

        ElMessage.error('删除历史记录失败，已回滚更改：' + (error.message || '网络错误'))
        return false
      }
    }

    return true
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
  async function toggleFavorite(id) {
    const index = favorites.value.indexOf(id)
    const wasAdding = index === -1

    // 保存原始状态用于回滚
    const originalFavorites = [...favorites.value]

    if (wasAdding) {
      // 添加到收藏
      favorites.value.push(id)
    } else {
      // 从收藏中移除
      favorites.value.splice(index, 1)
    }

    // 同步到服务器
    if (isLoggedIn.value) {
      try {
        const response = await apiService.post('/connections/favorites', { favorites: favorites.value })

        if (response && response.success) {
          log.info('收藏状态已同步到服务器')
        } else {
          throw new Error(response?.message || '服务器同步失败')
        }
      } catch (error) {
        log.error('同步收藏状态到服务器失败', error)

        // 回滚本地更改
        favorites.value = originalFavorites

        ElMessage.error('收藏操作失败，已回滚更改：' + (error.message || '网络错误'))
        return !wasAdding // 返回回滚后的状态
      }
    }

    return wasAdding // 返回当前是否为收藏状态
  }
  
  // 置顶连接
  async function togglePin(id) {
    const wasPinned = !!pinnedConnections.value[id]

    // 保存原始状态用于回滚
    const originalPinned = { ...pinnedConnections.value }

    if (wasPinned) {
      // 取消置顶
      delete pinnedConnections.value[id]
    } else {
      // 添加置顶
      pinnedConnections.value[id] = true
    }

    // 同步到服务器
    if (isLoggedIn.value) {
      try {
        const response = await apiService.post('/connections/pinned', { pinned: pinnedConnections.value })

        if (response && response.success) {
          log.info('置顶状态已同步到服务器')
        } else {
          throw new Error(response?.message || '服务器同步失败')
        }
      } catch (error) {
        log.error('同步置顶状态到服务器失败', error)

        // 回滚本地更改
        pinnedConnections.value = originalPinned

        ElMessage.error('置顶操作失败，已回滚更改：' + (error.message || '网络错误'))
        return wasPinned // 返回回滚后的状态
      }
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
      
      // 登录流程日志已在LoginPanel中记录，避免重复
      
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
          log.info('用户凭据已保存，下次登录将自动填充')
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
          
          // 验证token是否正确保存（合并到登录成功日志中，避免重复）
          const savedToken = localStorage.getItem('auth_token')
          if (!savedToken || savedToken !== response.token) {
            log.error('Token保存失败', {
              saved: !!savedToken,
              matches: savedToken === response.token
            })
          }
        } else {
          log.error('登录响应中没有token')
        }
        
        setUserInfo(response.user)

        // 通知状态管理器用户已登录
        try {
          await authStateManager.onUserLogin(response.user)
        } catch (error) {
          log.warn('通知登录状态管理器失败', error)
        }

        // 登录成功后，仅启动脚本库数据的异步同步（不阻塞登录流程）
        // 其他数据（连接列表、历史记录、收藏等）改为按需加载模式
        // 使用 setTimeout 确保登录响应优先完成
        setTimeout(() => {
          try {
            scriptLibraryService.syncFromServer().catch(() => {
              log.warn('后台同步脚本库数据失败，将使用本地数据')
            })
            log.info('登录后数据同步策略：脚本库后台同步，其他数据按需加载')
          } catch (error) {
            log.warn('启动脚本库后台同步失败:', error)
          }
        }, 1500) // 减少延迟时间，提升响应速度
      
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
  
  // 登出 - 增强版，确保完全清理所有状态
  async function logout(skipApiCall = false) {
    log.info('开始执行登出流程', { skipApiCall })

    try {
      // 如果已登录且不跳过API调用，调用后端登出API
      if (isLoggedIn.value && !skipApiCall) {
        try {
          await apiService.post('/users/logout')
          log.info('后端登出API调用成功')
        } catch (apiError) {
          log.error('登出API调用失败，继续执行本地清理', apiError)
          // 即使API调用失败，也继续清除本地状态
        }
      }
    } catch (error) {
      log.error('登出过程中出现错误', error)
    } finally {
      // 发出退出登录清空页签的全局事件
      window.dispatchEvent(new CustomEvent('auth:logout-clear-tabs'))

      // 执行完整的本地状态清理
      await performCompleteCleanup()
    }
  }

  // 执行完整的状态清理（保留记住的凭据）
  async function performCompleteCleanup() {
    log.info('开始执行完整的状态清理（保留记住的凭据）')

    try {
      // 0. 发出清空页签的全局事件（在清理其他状态之前）
      window.dispatchEvent(new CustomEvent('auth:logout-clear-tabs'))

      // 1. 通知状态管理器用户已登出
      try {
        await authStateManager.onUserLogout()
      } catch (error) {
        log.warn('通知登出状态管理器失败', error)
      }

      // 2. 清空token和用户信息
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

      // 2. 清空连接配置信息
      connections.value = []
      favorites.value = []
      history.value = []
      pinnedConnections.value = {}

      // 3. 清空偏好设置（保留主题和字体大小）
      const currentTheme = preferences.value.theme || 'system'
      const currentFontSize = preferences.value.fontSize || 14
      preferences.value = {
        theme: currentTheme,
        fontSize: currentFontSize
      }

      // 4. 重置连接数据加载状态
      resetConnectionsLoadState()

      // 5. 注意：不再清除记住我凭据，保留用户的登录便利性
      // clearUserCredentials() // 已移除

      // 6. 清除localStorage中的其他相关数据
      try {
        localStorage.removeItem('currentUser')
        localStorage.removeItem('auth_token')
        // 不清除Pinia持久化存储，让Pinia自动处理
      } catch (error) {
        log.error('清除localStorage数据失败', error)
      }

      log.info('完整状态清理完成（保留记住的凭据）')
    } catch (error) {
      log.error('执行完整状态清理时出现错误', error)
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
  
  // 按需加载连接数据的状态管理
  const connectionsLoading = ref(false)
  const connectionsLoaded = ref(false)

  // 按需加载连接数据（仅加载连接配置，带重试机制）
  async function loadConnectionsOnDemand() {
    if (!isLoggedIn.value) {
      log.debug('用户未登录，跳过连接数据加载')
      return false
    }

    if (connectionsLoaded.value || connectionsLoading.value) {
      log.debug('连接数据已加载或正在加载中，跳过重复请求')
      return true
    }

    try {
      connectionsLoading.value = true
      log.info('开始按需加载连接配置...')

      const result = await retryWithBackoff(
        async () => {
          const success = await loadConnectionsOnly()
          if (!success) {
            throw new Error('连接配置加载失败')
          }
          return success
        },
        connectionsRetryCount,
        connectionsError
      )

      connectionsLoaded.value = true
      log.info('连接配置按需加载成功')
      return result

    } catch (error) {
      log.error('按需加载连接配置失败（所有重试都失败）:', error)
      return false
    } finally {
      connectionsLoading.value = false
    }
  }

  // 按需请求连接配置（不依赖本地存储同步）
  async function loadConnectionsOnly() {
    if (!isLoggedIn.value) return false

    try {
      log.debug('开始按需请求连接配置...')

      // 直接请求连接数据，不检查API可用性
      const connectionsResponse = await apiService.get('/connections')
      if (connectionsResponse && connectionsResponse.success) {
        connections.value = connectionsResponse.connections || []
        log.debug('连接配置按需加载成功', { count: connections.value.length })
        return true
      } else {
        log.warn('连接配置API响应无效')
        return false
      }
    } catch (error) {
      log.warn('按需请求连接配置失败:', error)
      return false
    }
  }

  // 历史记录和收藏数据的状态管理
  const historyLoading = ref(false)
  const historyLoaded = ref(false)
  const historyError = ref(null)
  const historyRetryCount = ref(0)

  const favoritesLoading = ref(false)
  const favoritesLoaded = ref(false)
  const favoritesError = ref(null)
  const favoritesRetryCount = ref(0)

  // 连接数据错误状态
  const connectionsError = ref(null)
  const connectionsRetryCount = ref(0)

  // 通用重试配置
  const MAX_RETRY_COUNT = 3
  const RETRY_DELAY = 1000 // 1秒

  // 通用重试函数
  async function retryWithBackoff(fn, retryCountRef, errorRef, maxRetries = MAX_RETRY_COUNT) {
    let lastError = null

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        retryCountRef.value = attempt
        const result = await fn()

        // 成功时清除错误状态
        errorRef.value = null
        retryCountRef.value = 0

        return result
      } catch (error) {
        lastError = error
        log.warn(`尝试 ${attempt + 1}/${maxRetries + 1} 失败:`, error)

        // 如果不是最后一次尝试，等待后重试
        if (attempt < maxRetries) {
          const delay = RETRY_DELAY * Math.pow(2, attempt) // 指数退避
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
    }

    // 所有重试都失败，设置错误状态
    errorRef.value = lastError
    log.error('所有重试都失败:', lastError)
    throw lastError
  }

  // 清除错误状态
  function clearError(type) {
    switch (type) {
      case 'connections':
        connectionsError.value = null
        connectionsRetryCount.value = 0
        break
      case 'history':
        historyError.value = null
        historyRetryCount.value = 0
        break
      case 'favorites':
        favoritesError.value = null
        favoritesRetryCount.value = 0
        break
    }
  }

  // 强制刷新历史记录
  async function forceRefreshHistory() {
    if (!isLoggedIn.value) return false

    // 重置状态以强制刷新
    historyLoaded.value = false
    historyError.value = null
    historyRetryCount.value = 0

    return await loadHistoryOnDemand()
  }

  // 强制刷新收藏数据
  async function forceRefreshFavorites() {
    if (!isLoggedIn.value) return false

    // 重置状态以强制刷新
    favoritesLoaded.value = false
    favoritesError.value = null
    favoritesRetryCount.value = 0

    return await loadFavoritesOnDemand()
  }

  // 强制刷新连接数据
  async function forceRefreshConnections() {
    if (!isLoggedIn.value) return false

    // 重置状态以强制刷新
    connectionsLoaded.value = false
    connectionsError.value = null
    connectionsRetryCount.value = 0

    return await loadConnectionsOnDemand()
  }

  // 按需请求历史记录（简化版，内存缓存）
  async function loadHistoryOnDemand() {
    if (!isLoggedIn.value) {
      log.debug('用户未登录，跳过历史记录加载')
      return false
    }

    if (historyLoaded.value || historyLoading.value) {
      log.debug('历史记录已缓存或正在加载中，跳过重复请求')
      return true
    }

    try {
      historyLoading.value = true
      log.debug('开始按需请求历史记录...')

      const result = await retryWithBackoff(
        async () => {
          const historyResponse = await apiService.get('/connections/history')
          if (historyResponse && historyResponse.success) {
            return historyResponse.history || []
          }
          throw new Error('历史记录API响应无效')
        },
        historyRetryCount,
        historyError
      )

      history.value = result
      historyLoaded.value = true
      log.debug('历史记录按需请求成功', { count: result.length })
      return true

    } catch (error) {
      log.error('按需请求历史记录失败:', error)
      return false
    } finally {
      historyLoading.value = false
    }
  }

  // 按需请求收藏数据（简化版，内存缓存）
  async function loadFavoritesOnDemand() {
    if (!isLoggedIn.value) {
      log.debug('用户未登录，跳过收藏数据加载')
      return false
    }

    if (favoritesLoaded.value || favoritesLoading.value) {
      log.debug('收藏数据已缓存或正在加载中，跳过重复请求')
      return true
    }

    try {
      favoritesLoading.value = true
      log.debug('开始按需请求收藏数据...')

      const result = await retryWithBackoff(
        async () => {
          const favoritesResponse = await apiService.get('/connections/favorites')
          if (favoritesResponse && favoritesResponse.success) {
            return favoritesResponse.favorites || []
          }
          throw new Error('收藏数据API响应无效')
        },
        favoritesRetryCount,
        favoritesError
      )

      favorites.value = result
      favoritesLoaded.value = true
      log.debug('收藏数据按需请求成功', { count: result.length })
      return true

    } catch (error) {
      log.error('按需请求收藏数据失败:', error)
      return false
    } finally {
      favoritesLoading.value = false
    }
  }

  // 重置连接数据加载状态（用于登出时清理）
  function resetConnectionsLoadState() {
    connectionsLoaded.value = false
    connectionsLoading.value = false
    connectionsError.value = null
    connectionsRetryCount.value = 0

    historyLoaded.value = false
    historyLoading.value = false
    historyError.value = null
    historyRetryCount.value = 0

    favoritesLoaded.value = false
    favoritesLoading.value = false
    favoritesError.value = null
    favoritesRetryCount.value = 0
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

    // 按需加载状态
    connectionsLoading,
    connectionsLoaded,
    connectionsError,
    connectionsRetryCount,
    historyLoading,
    historyLoaded,
    historyError,
    historyRetryCount,
    favoritesLoading,
    favoritesLoaded,
    favoritesError,
    favoritesRetryCount,

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
    performCompleteCleanup,
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
    loadConnectionsFromServer,
    loadConnectionsOnDemand,
    loadConnectionsOnly,
    loadHistoryOnDemand,
    loadFavoritesOnDemand,
    resetConnectionsLoadState,
    clearError,
    retryWithBackoff,
    forceRefreshHistory,
    forceRefreshFavorites,
    forceRefreshConnections
  }
}, {
  persist: {
    key: 'user',
    storageType: 'persistent',
    paths: ['token', 'userInfo', 'preferences', 'connections', 'favorites', 'history', 'pinnedConnections']
  }
})