/**
 * 用户体验服务模块索引
 * 统一导出所有UX相关服务
 */

import notificationService from './notifications.js';
import loadingService from './loading.js';
import formService from './form.js';
import accessibilityService from './accessibility.js';
import keyboardManager from './keyboardManager.js';

/**
 * 初始化所有UX服务
 */
export function initUXServices() {
  // 服务已在导入时初始化，无需额外操作
  console.log('UX服务初始化完成');
}

// 导出所有服务
export {
  notificationService,
  loadingService,
  formService,
  accessibilityService,
  keyboardManager
};
