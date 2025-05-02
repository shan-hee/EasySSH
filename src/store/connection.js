import { defineStore } from 'pinia'
import { ref, reactive, computed } from 'vue'
import { ElMessage } from 'element-plus'

/**
 * 连接管理状态
 */
export const useConnectionStore = defineStore('connection', () => {
  // 连接列表
  const connections = ref([])
  
  // 搜索关键字
  const searchKeyword = ref('')
  
  // 分组列表
  const groups = ref(['默认分组', '开发服务器', '测试服务器', '生产服务器'])
  
  // 添加连接
  const addConnection = (connection) => {
    try {
      if (!connection.id) {
        connection.id = Date.now().toString()
      }
      
      if (!connection.name) {
        connection.name = `${connection.host}:${connection.port}`
      }
      
      if (!connection.group) {
        connection.group = '默认分组'
      }
      
      // 连接创建日期
      connection.createdAt = new Date().toISOString()
      
      // 设置最后更新日期
      connection.updatedAt = new Date().toISOString()
      
      // 添加到列表
      connections.value.push(connection)
      
      return connection.id
    } catch (error) {
      console.error('添加连接失败', error)
      ElMessage.error('添加连接失败')
      return null
    }
  }
  
  // 更新连接
  const updateConnection = (id, updatedConnection) => {
    try {
      const index = connections.value.findIndex(conn => conn.id === id)
      if (index === -1) {
        throw new Error(`未找到ID为${id}的连接`)
      }
      
      // 更新最后修改日期
      updatedConnection.updatedAt = new Date().toISOString()
      
      // 更新连接信息
      connections.value[index] = { ...connections.value[index], ...updatedConnection }
      
      return connections.value[index]
    } catch (error) {
      console.error('更新连接失败', error)
      ElMessage.error('更新连接失败')
      return null
    }
  }
  
  // 删除连接
  const deleteConnection = (id) => {
    try {
      const index = connections.value.findIndex(conn => conn.id === id)
      if (index === -1) {
        throw new Error(`未找到ID为${id}的连接`)
      }
      
      // 删除连接
      connections.value.splice(index, 1)
      
      return true
    } catch (error) {
      console.error('删除连接失败', error)
      ElMessage.error('删除连接失败')
      return false
    }
  }
  
  // 获取连接信息
  const getConnectionById = (id) => {
    try {
      return connections.value.find(conn => conn.id === id) || null
    } catch (error) {
      console.error('获取连接信息失败', error)
      return null
    }
  }
  
  // 筛选连接列表
  const filteredConnections = computed(() => {
    if (!searchKeyword.value) {
      return connections.value
    }
    
    const keyword = searchKeyword.value.toLowerCase()
    return connections.value.filter(conn => 
      conn.name.toLowerCase().includes(keyword) || 
      conn.host.toLowerCase().includes(keyword) ||
      (conn.description && conn.description.toLowerCase().includes(keyword))
    )
  })
  
  // 按分组获取连接
  const connectionsByGroup = computed(() => {
    const result = {}
    
    // 初始化所有分组
    groups.value.forEach(group => {
      result[group] = []
    })
    
    // 按分组归类连接
    connections.value.forEach(conn => {
      if (!result[conn.group]) {
        result[conn.group] = []
      }
      result[conn.group].push(conn)
    })
    
    return result
  })
  
  // 添加分组
  const addGroup = (groupName) => {
    try {
      if (!groupName || groups.value.includes(groupName)) {
        return false
      }
      
      groups.value.push(groupName)
      return true
    } catch (error) {
      console.error('添加分组失败', error)
      return false
    }
  }
  
  // 重命名分组
  const renameGroup = (oldName, newName) => {
    try {
      if (!oldName || !newName || oldName === newName || groups.value.includes(newName)) {
        return false
      }
      
      // 更新分组名称
      const index = groups.value.indexOf(oldName)
      if (index === -1) {
        return false
      }
      
      groups.value[index] = newName
      
      // 更新连接中的分组信息
      connections.value.forEach(conn => {
        if (conn.group === oldName) {
          conn.group = newName
        }
      })
      
      return true
    } catch (error) {
      console.error('重命名分组失败', error)
      return false
    }
  }
  
  // 删除分组
  const deleteGroup = (groupName) => {
    try {
      if (!groupName || groupName === '默认分组') {
        return false
      }
      
      // 从分组列表中删除
      const index = groups.value.indexOf(groupName)
      if (index === -1) {
        return false
      }
      
      groups.value.splice(index, 1)
      
      // 更新连接中的分组信息，将该分组下的连接移到默认分组
      connections.value.forEach(conn => {
        if (conn.group === groupName) {
          conn.group = '默认分组'
        }
      })
      
      return true
    } catch (error) {
      console.error('删除分组失败', error)
      return false
    }
  }
  
  // 设置搜索关键字
  const setSearchKeyword = (keyword) => {
    searchKeyword.value = keyword
  }
  
  // 初始化示例连接（仅开发用途）
  const initExampleConnections = () => {
    if (connections.value.length > 0) {
      return
    }
    
    const now = new Date().toISOString()
    
    const exampleConnections = [
      {
        id: '1',
        name: '本地开发服务器',
        host: 'localhost',
        port: 22,
        username: 'dev',
        authType: 'password',
        password: '',
        group: '开发服务器',
        description: '本地开发环境SSH服务器',
        createdAt: now,
        updatedAt: now
      },
      {
        id: '2',
        name: '测试服务器1',
        host: '192.168.1.100',
        port: 22,
        username: 'test',
        authType: 'password',
        password: '',
        group: '测试服务器',
        description: '测试环境1号服务器',
        createdAt: now,
        updatedAt: now
      },
      {
        id: '3',
        name: '生产服务器',
        host: 'production.example.com',
        port: 22,
        username: 'admin',
        authType: 'key',
        privateKey: '',
        passphrase: '',
        group: '生产服务器',
        description: '生产环境主服务器',
        createdAt: now,
        updatedAt: now
      }
    ]
    
    connections.value = exampleConnections
  }
  
  // 初始化连接列表
  initExampleConnections()
  
  return {
    connections,
    groups,
    searchKeyword,
    filteredConnections,
    connectionsByGroup,
    addConnection,
    updateConnection,
    deleteConnection,
    getConnectionById,
    addGroup,
    renameGroup,
    deleteGroup,
    setSearchKeyword
  }
}, {
  persist: true
}) 