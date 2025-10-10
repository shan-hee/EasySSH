/**
 * UI 服务模块索引（TypeScript 版）
 * - 提供 initializeServices 统一初始化入口
 */
import keyboardManager from './keyboardManager';
import accessibilityService from './accessibility';
import log from '@/services/log';

const services = {
  keyboardManager,
  accessibility: accessibilityService
};

type InitState = {
  keyboardManager: boolean;
  accessibility: boolean;
};

const servicesState: InitState = {
  keyboardManager: false,
  accessibility: false
};

async function safeInitService(service: any, name: string): Promise<boolean> {
  try {
    if (service && typeof service.init === 'function') {
      await service.init();
      log.debug(`${name}服务初始化成功`);
      return true;
    } else if (service) {
      return true;
    }
    return false;
  } catch (error) {
    log.error(`${name}服务初始化失败`, error);
    return false;
  }
}

export async function initializeServices(): Promise<boolean> {
  log.debug('开始初始化UI服务...');
  try {
    window.dispatchEvent(new CustomEvent('services:before-ready'));

    const initPromises = [
      (async () => { servicesState.keyboardManager = await safeInitService(keyboardManager, '键盘管理'); })(),
      (async () => { servicesState.accessibility = await safeInitService(accessibilityService, '无障碍'); })()
    ];

    await Promise.all(initPromises);

    (window as any).services = services;

    const detail = { status: { ...servicesState } } as any;
    window.dispatchEvent(new CustomEvent('ui-services:ready', { detail }));
    window.dispatchEvent(new CustomEvent('services:ready', { detail }));

    log.debug('UI服务初始化完成');
    return Object.values(servicesState).every(Boolean);
  } catch (error) {
    log.error('UI服务初始化过程中发生错误', error);
    window.dispatchEvent(new CustomEvent('services:error', {
      detail: { error: (error as any)?.message ?? String(error), status: { ...servicesState } }
    }));
    return false;
  }
}

export function getServicesStatus(): InitState {
  return { ...servicesState };
}

export { services, keyboardManager, accessibilityService };
export default services;

