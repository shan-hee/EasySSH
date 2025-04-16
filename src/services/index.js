/**
 * 服务模块索引，统一导出所有服务实例
 */
import api from './api'
import auth from './auth'
import storage from './storage'
import ssh from './ssh'
import notification from './notification'
import log from './log'
import settings from './settings'
import clipboard from './clipboard'
import terminal from './terminal'
import utils from './utils'

// 初始化所有服务的方法
async function initServices() {
  console.log('开始初始化应用服务...')
  
  try {
    // 首先初始化日志服务，因为其他服务依赖它记录日志
    await log.init()
    
    // 初始化基础服务
    await storage.init()
    await settings.init()
    
    // 初始化通知服务
    await notification.init()
    
    // 初始化剪贴板服务
    await clipboard.init()
    
    // 初始化终端服务
    terminal.init()
    
    // 初始化API和认证服务
    await api.init()
    await auth.init()
    
    // 最后初始化SSH服务，因为它依赖前面的服务
    await ssh.init()
    
    console.log('所有服务初始化完成')
    return true
  } catch (error) {
    console.error('服务初始化失败:', error)
    return false
  }
}

export {
  api,
  auth,
  storage,
  ssh,
  notification,
  log,
  settings,
  clipboard,
  terminal,
  utils,
  initServices
}

// 导出默认对象，包含所有服务实例
export default {
  api,
  auth,
  storage,
  ssh,
  notification,
  log,
  settings,
  clipboard,
  terminal,
  utils,
  initServices
} 