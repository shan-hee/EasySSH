/**
 * 服务模块索引，统一导出所有服务实例
 */
import apiService from './api'
import SettingsService from './settings'
import log from './log'
// 移除不存在的模块导入
// import themeService from './theme'
// import telemetryService from './telemetry'
// import updateService from './update'
import clipboardService from './clipboard'
// 导入其他依赖服务
import storage from './storage'
// import notification from './notification'
import auth from './auth'
import mfaService from './mfa'
import sshService, { sftpService } from './ssh'
import terminal from './terminal'

// 创建设置服务实例
const settings = new SettingsService()

// 服务初始化状态
const servicesStatus = {
  log: false,
  settings: false,
  ssh: false,
  sftp: false,
  api: false,
  // theme: false,
  // telemetry: false,
  // update: false,
  clipboard: false,
  storage: false,
  // notification: false,
  auth: false,
  terminal: false,
  mfa: false
}

// 初始化所有服务的方法
async function initServices() {
  // 该函数被src/main.js调用，main.js已经打印了开始初始化的日志，这里不需要重复
  
  try {
    // 首先初始化日志服务，因为其他服务依赖它记录日志
    await log.init()
    servicesStatus.log = true
    
    // 初始化基础服务 - 并行初始化不相互依赖的服务
    const baseServicesPromises = [
      (async () => {
        await storage.init();
        servicesStatus.storage = true;
        log.debug('存储服务初始化完成');
      })(),
      (async () => {
        await settings.init();
        servicesStatus.settings = true;
        log.debug('设置服务初始化完成');
      })()
    ]

    await Promise.all(baseServicesPromises)

    // 初始化用户体验相关服务 - 并行
    const uxServicesPromises = [
      (async () => {
        await clipboardService.init();
        servicesStatus.clipboard = true;
        log.debug('剪贴板服务初始化完成');
      })()
    ]

    await Promise.all(uxServicesPromises)

    // 初始化终端服务
    await terminal.init()
    servicesStatus.terminal = true

    // 初始化API和认证服务 - 顺序执行，因为auth依赖api
    await apiService.init()
    servicesStatus.api = true

    await auth.init()
    servicesStatus.auth = true

    // 最后初始化SSH服务，因为它依赖前面的服务
    await sshService.init()
    servicesStatus.ssh = true
    servicesStatus.sftp = true
    
    // 触发服务初始化完成事件
    window.dispatchEvent(new CustomEvent('services:ready', {
      detail: { status: { ...servicesStatus } }
    }))
    
    log.info('所有服务初始化完成')
    return true
  } catch (error) {
    log.error('服务初始化失败', error)
    
    // 触发服务初始化失败事件
    window.dispatchEvent(new CustomEvent('services:error', {
      detail: { 
        error: error.message, 
        status: { ...servicesStatus } 
      }
    }))
    
    return false
  }
}

// 获取服务初始化状态
function getServicesStatus() {
  return { ...servicesStatus }
}

// 导出所有服务
export {
  apiService,
  settings,
  log,
  sshService,
  sftpService,
  // themeService,
  // telemetryService,
  // updateService,
  clipboardService,
  storage,
  // notification,
  auth,
  terminal,
  mfaService,
  initServices,
  getServicesStatus
}

// 默认导出
export default {
  api: apiService,
  settings,
  log,
  ssh: sshService,
  sftp: sftpService,
  // theme: themeService,
  // telemetry: telemetryService,
  // update: updateService,
  clipboard: clipboardService,
  storage,
  // notification,
  auth,
  terminal,
  mfa: mfaService,
  initServices,
  getServicesStatus
}