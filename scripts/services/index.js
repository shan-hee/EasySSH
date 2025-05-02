/**
 * 服务模块索引，统一导出所有服务实例
 */
import keyboardManager from './ux/keyboardManager.js';
import accessibilityService from './ux/accessibility.js';
// 导入统一日志服务
import log from '../../src/services/log.js';

// 服务初始化状态
const servicesState = {
  keyboardManager: false,
  accessibility: false
};

// 所有服务的集合
const services = {
  keyboardManager: keyboardManager,
  accessibility: accessibilityService
};

// 安全地初始化服务
async function safeInitService(service, name) {
  try {
    // 检查服务对象是否存在且有init方法
    if (service && typeof service.init === 'function') {
      await service.init();
      log.info(`${name}服务初始化成功`);
      return true;
    }
    // 如果服务存在但没有init方法，认为它已经初始化完成
    else if (service) {
      log.info(`${name}服务无需初始化，视为已就绪`);
      return true;
    }
    return false;
  } catch (error) {
    log.error(`${name}服务初始化失败`, error);
    return false;
  }
}

// 初始化所有服务
async function initializeServices() {
  log.info('开始初始化UI服务...');
  
  try {
    // 发布services就绪前事件
    window.dispatchEvent(new CustomEvent('services:before-ready'));
    
    // 并行初始化所有UI服务
    const initPromises = [
      (async () => {
        const result = await safeInitService(keyboardManager, '键盘管理');
        servicesState.keyboardManager = result;
      })(),
      (async () => {
        const result = await safeInitService(accessibilityService, '无障碍');
        servicesState.accessibility = result;
      })()
    ];
    
    await Promise.all(initPromises);
    
    // 注册到全局对象
    window.services = services;
    
    // 发布services就绪事件，包含初始化状态
    window.dispatchEvent(new CustomEvent('services:ready', {
      detail: { status: { ...servicesState } }
    }));
    
    log.info('UI服务初始化完成');
    return Object.values(servicesState).every(status => status === true);
  } catch (error) {
    log.error('UI服务初始化过程中发生错误', error);
    
    // 发布服务初始化错误事件
    window.dispatchEvent(new CustomEvent('services:error', {
      detail: { 
        error: error.message,
        status: { ...servicesState }
      }
    }));
    
    return false;
  }
}

// 获取服务初始化状态
function getServicesStatus() {
  return { ...servicesState };
}

export {
  services,
  initializeServices,
  getServicesStatus,
  keyboardManager,
  accessibilityService
};

export default services; 