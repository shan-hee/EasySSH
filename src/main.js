import { createApp } from 'vue';

// 导入根组件
import App from './App.vue';
// 导入路由配置
import router from './router';
// 导入状态管理
import pinia from './store';
import './assets/styles/main.css';
import './components/sftp/styles/sftp-panel.css';

// 导入服务初始化模块
import { initializeServices } from '../scripts/services';
import servicesManager, { initServices as initCoreServices } from './services';
// 导入日志服务
import log from './services/log';
// 导入字体加载器
import fontLoader from './utils/fontLoader';
// 导入配置管理器
import configManager from './utils/config-manager';
// 导入统一存储服务
import storageService from './services/storage';
// 导入自定义指令
import directives from './directives';
// 导入Iconify Vue组件
import { Icon } from '@iconify/vue';
// 右键粘贴：全局处理终端自定义事件
import settingsService from './services/settings';
import clipboard from './services/clipboard';
import authService from './services/auth.js';
import scriptLibraryService from './services/scriptLibrary.js';
import { useUserStore } from './store/user';
import monitoringService from './services/monitoring.js';

// 主题初始化现在由settingsService统一处理

// 修改预加载字体函数（精简日志：仅在异常时提示）
const preloadFonts = () => {
  // 开始字体预加载，不等待结果
  fontLoader
    .preloadFonts()
    .then(success => {
      if (!success) {
        log.warn('字体预加载未完全成功，但应用将继续运行');
      }
    })
    .catch(err => {
      log.error('字体预加载过程出错:', err);
    });
};

// 立即开始预加载字体
preloadFonts();


// 开发环境存储版本检查
if (process.env.NODE_ENV === 'development') {
  const storageVersion = 'v1.0';
  const savedVersion = storageService.getItem('app-version');

  if (savedVersion !== storageVersion) {
    log.info('检测到存储版本变更，重置存储状态');
    storageService.clear(true); // 清除所有存储
    sessionStorage.clear();
    storageService.setItem('app-version', storageVersion);
  }

  // 添加快捷键清除存储
  window.addEventListener('keydown', e => {
    // Ctrl+Shift+Delete 清除所有持久化存储
    if (e.ctrlKey && e.shiftKey && e.key === 'Delete') {
      storageService.clear(true); // 清除所有存储
      sessionStorage.clear();
      log.info('已清除所有存储');
      location.reload();
    }
  });
}

// Pinia实例已在store/index.js中配置好统一存储插件

// 创建Vue应用实例
const app = createApp(App);

// 使用插件
app.use(router);
app.use(pinia);

// 注册Iconify全局组件
app.component('Icon', Icon);

// 注册自定义指令
Object.keys(directives).forEach(key => {
  app.directive(key, directives[key]);
});

// 运行时回退：若未启用按需自动导入，则在此动态注册 Element Plus 并加载其样式
const ensureElementPlusReady = async () => {
  try {
    if (!__EP_AUTO_ENABLED__) {
      const { default: ElementPlus } = await import('element-plus');
      await import('element-plus/dist/index.css');
      app.use(ElementPlus);
    }
  } catch (e) {
    // 忽略回退失败，继续挂载，避免阻塞应用
  }
};

ensureElementPlusReady().then(() => {
  // 挂载应用并初始化服务
  app.mount('#app');

  // 全局消息行为：最多显示10条，超出时优雅移除最早的
  try {
    const MAX_MESSAGES = 10;
    const SELECTOR = '.el-message';

    const gracefulRemove = el => {
      if (!el || !el.parentNode) return;
      el.classList.add('el-message--force-leave');
      // 等待过渡完成再移除
      setTimeout(() => {
        if (el && el.parentNode) el.parentNode.removeChild(el);
      }, 260);
    };

    const enforceLimit = () => {
      const nodes = Array.from(document.querySelectorAll(SELECTOR));
      if (nodes.length <= MAX_MESSAGES) return;

      // 优先保留进度类消息，先移除非进度消息
      const isProgress = el =>
        el.classList.contains('upload-progress-notification') ||
        el.classList.contains('download-progress-notification');

      const nonProgress = nodes.filter(n => !isProgress(n));
      let toRemove = nodes.length - MAX_MESSAGES;

      for (let i = 0; i < nonProgress.length && toRemove > 0; i++) {
        gracefulRemove(nonProgress[i]);
        toRemove--;
      }

      // 如仍超限，再从所有消息头部开始移除
      if (toRemove > 0) {
        for (let i = 0; i < nodes.length && toRemove > 0; i++) {
          if (nodes[i].isConnected) {
            gracefulRemove(nodes[i]);
            toRemove--;
          }
        }
      }
    };

    const observer = new MutationObserver(mutations => {
      let touched = false;
      for (const m of mutations) {
        if (m.addedNodes && m.addedNodes.length) {
          for (const n of m.addedNodes) {
            if (n.nodeType === 1 && n.matches && n.matches(SELECTOR)) {
              touched = true;
            }
          }
        }
      }
      if (touched) enforceLimit();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  } catch (_) {
    // 忽略消息限制设置失败，避免影响应用
  }
  // UI服务与核心服务的初始化统一放到 initializeApp 内，避免重复调用导致接口请求两次
});

// 导入用户状态管理，并初始化用户状态

// 应用初始化时强制同步token状态，并主动验证和刷新数据
const userStore = useUserStore();
const savedToken = localStorage.getItem('auth_token');
if (savedToken) {
  userStore.setToken(savedToken);

  // 页面刷新后的认证验证将由服务初始化流程统一处理
  // 这里不再重复调用，避免多次认证验证
  log.debug('页面刷新检测到已保存的token，等待服务初始化完成后统一验证');
} else {
  userStore.setToken('');
  userStore.setUserInfo({
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
  });
  if (window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}

// 处理来自终端的右键上下文事件（作为统一入口）
// 说明：terminal-manager 会在容器上派发 'terminal-context-menu' 事件；
// 这里根据设置决定是否执行粘贴，避免无处理导致默认菜单被拦截。
document.addEventListener(
  'terminal-context-menu',
  async e => {
    try {
      const opts = settingsService.getTerminalOptions?.() || {};
      const enableRightClickPaste = !!opts.rightClickSelectsWord;

      if (enableRightClickPaste) {
        // 阻止默认菜单并执行粘贴，避免重复处理
        // 优先阻止原始的 contextmenu 事件
        const orig = e.detail?.originalEvent;
        if (orig && typeof orig.preventDefault === 'function') orig.preventDefault();
        if (orig && typeof orig.stopPropagation === 'function') orig.stopPropagation();
        // 兜底：也阻止自定义事件继续传播
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
        const target = e.detail?.terminalElement || e.target;
        await clipboard.pasteToTerminal(target);
      }
      // 如果未启用右键粘贴，不做处理，保留系统菜单
    } catch (_) {
      // 忽略粘贴异常，避免影响其他行为
    }
  },
  true // 捕获阶段，确保能够监听到非冒泡的自定义事件
);

// 登录后加载用户配置的统一入口在 auth-state-manager 中执行，避免重复拉取

// 刷新用户数据的统一方法（智能缓存优先策略）
async function refreshUserData() {
  try {
    const userStore = useUserStore();

    // 1. 刷新用户基本信息（优先级最高）
    await authService.refreshUserInfo();

    if (userStore.isLoggedIn) {
      // 2. 智能数据刷新策略
      await smartDataRefresh(userStore);
    }

    log.info('用户数据刷新完成（智能缓存优先策略）');
  } catch (error) {
    log.error('刷新用户数据过程中出现错误', error);
  }
}

// 智能数据刷新策略（优化为按需加载模式）
async function smartDataRefresh(userStore) {
  try {
    // 检查网络状态
    const isOnline = navigator.onLine;
    if (!isOnline) {
      log.info('网络离线，跳过数据刷新，使用本地缓存');
      return;
    }

    // 获取上次刷新时间
    const lastRefreshTime = localStorage.getItem('last_data_refresh');
    const now = Date.now();
    const timeSinceLastRefresh = lastRefreshTime ? now - parseInt(lastRefreshTime) : Infinity;

    // 如果距离上次刷新不到30秒，跳过刷新
    if (timeSinceLastRefresh < 30000) {
      // 优化：降低跳过刷新的日志级别，减少重复输出
      return;
    }

    // 更新刷新时间
    localStorage.setItem('last_data_refresh', now.toString());

    // 统一并发刷新：若任一类别需要刷新，则一次性强制并发刷新全部关联数据
    const needConnections = userStore.connectionsLoaded && isConnectionPageActive();
    const needHistory = userStore.historyLoaded && isHistoryPageActive();
    const needFavorites = userStore.favoritesLoaded && isFavoritesPageActive();

    if (needConnections || needHistory || needFavorites) {
      try {
        await userStore.ensureConnectionsData(true);
        log.info('智能数据刷新完成（统一并发刷新）');
      } catch (error) {
        log.warn('智能数据刷新失败（统一并发刷新）', error);
      }
    }
  } catch (error) {
    log.error('智能数据刷新失败', error);
  }
}

// 已移除：脚本库主动刷新函数（连接/变更事件驱动）

// 页面活跃状态检测函数（用于智能数据刷新）
function isConnectionPageActive() {
  const currentPath = window.location.pathname;
  return (
    currentPath.includes('/connections') || currentPath === '/' || currentPath === '/dashboard'
  );
}

function isHistoryPageActive() {
  const currentPath = window.location.pathname;
  return currentPath.includes('/history') || currentPath === '/' || currentPath === '/dashboard';
}

function isFavoritesPageActive() {
  const currentPath = window.location.pathname;
  return currentPath.includes('/favorites') || currentPath === '/' || currentPath === '/dashboard';
}

// 防止重复认证跳转
window._isAuthFailed = false;
window.addEventListener('auth:check-failed', () => {
  if (window._isAuthFailed) return;
  window._isAuthFailed = true;
  log.info('检测到认证状态检查失败，跳转到登录页');
  // 清理store等逻辑可放在api.js
  if (window.location.pathname !== '/login') {
    const currentPath = window.location.pathname;
    const redirectParam = currentPath !== '/' ? `?redirect=${encodeURIComponent(currentPath)}` : '';
    window.location.href = `/login${redirectParam}`;
  }
});

// 处理完全登出事件，确保彻底退出系统
window.addEventListener('auth:complete-logout', async () => {
  if (window._isAuthFailed) return;
  window._isAuthFailed = true;

  log.warn('检测到完全登出事件，开始执行彻底退出流程');

  try {
    // 1. 清理用户Store状态
    const userStore = useUserStore();
    await userStore.performCompleteCleanup();

    // 2. 清理所有可能的缓存和状态（但保留记住的凭据）
    try {
      // 清理sessionStorage
      sessionStorage.clear();

      // 清理特定的存储项目（但保留记住的凭据）
      const keysToRemove = [
        'auth_token',
        'currentUser',
        // 注意：不再清除 easyssh_credentials，保留记住的密码
        'user'
      ];
      keysToRemove.forEach(key => {
        try {
          storageService.removeItem(key);
        } catch (e) {
          log.error(`清理存储项目失败: ${key}`, e);
        }
      });
    } catch (error) {
      log.error('清理缓存数据失败', error);
    }

    // 3. 强制刷新页面并跳转到登录页，确保完全重置应用状态
    log.info('执行强制页面刷新，确保完全退出系统');
    // 设置一个标志表示这是完全登出，供登录页面检测
  sessionStorage.setItem('auth_complete_logout', 'true');
    // 设置缓存清理已移动至 auth-state-manager，避免重复
    window.location.href = '/login';
  } catch (error) {
    log.error('执行完全登出流程时出现错误', error);
    // 即使出错也要跳转到登录页
    sessionStorage.setItem('auth_logout_error', 'true');
    window.location.href = '/login';
  }
});

// 处理远程注销事件，立即跳转到登录页
window.addEventListener('auth:remote-logout', () => {
  log.warn('检测到远程注销，立即跳转到登录页');
  // 清除全局状态指示器
  window._isAuthFailed = true;
  // 清除token，确保不再获取登录信息
  localStorage.removeItem('auth_token');
  // 远程注销时清理记住的凭据（这是唯一清理凭据的场景）
  storageService.removeItem('easyssh_credentials');
  log.info('远程注销：已清理记住的凭据');
  // 不保留重定向路径，确保完全重新登录
  window.location.href = '/login?remote-logout=true';
});

// 处理认证过期事件，直接跳转到登录页
window.addEventListener('auth:expired', () => {
  log.info('检测到认证令牌过期，跳转到登录页');
  if (window.location.pathname !== '/login') {
    const currentPath = window.location.pathname;
    const redirectParam = currentPath !== '/' ? `?redirect=${encodeURIComponent(currentPath)}` : '';
    window.location.href = `/login${redirectParam}`;
  }
});

// 添加SSH连接开始时同时触发监控连接的全局事件监听器
(async () => {
  try {
    const { EVENTS } = await import('@/services/events');
    window.addEventListener(EVENTS.SSH_CONNECTING, async event => {
      const { host, terminalId } = event.detail || {};
      if (host && terminalId) {
        try {
          const connected = await monitoringService.connect(terminalId, host);
          if (!connected) {
            log.debug(`[监控] 终端 ${terminalId} 连接到 ${host} 失败`);
          }
        } catch (error) {
          log.debug(`[监控] 终端 ${terminalId} 连接到 ${host} 出错:`, error);
        }
      }
    });
  } catch (_) {
    window.addEventListener('ssh-connecting', async event => {
      const { host, terminalId } = event.detail || {};
      if (host && terminalId) {
        try {
          const connected = await monitoringService.connect(terminalId, host);
          if (!connected) {
            log.debug(`[监控] 终端 ${terminalId} 连接到 ${host} 失败`);
          }
        } catch (error) {
          log.debug(`[监控] 终端 ${terminalId} 连接到 ${host} 出错:`, error);
        }
      }
    });
  }
})();

// 统一的服务初始化流程
const initializeApp = async () => {
  try {
    // 首先初始化日志服务
    await servicesManager.log.init();

    // 使用日志服务记录而不是console.log
    servicesManager.log.info('开始初始化应用服务...');

    // 初始化用户状态
    try {
      const userStore = useUserStore();
      // 检查localStorage中是否有token，并确保store中的token被正确设置
      const savedToken = localStorage.getItem('auth_token');
      if (savedToken && !userStore.token) {
        log.info('从localStorage恢复用户登录状态');
        userStore.setToken(savedToken);
      }
    } catch (error) {
      log.error('初始化用户状态失败', error);
    }

    // 初始化基础UI服务（键盘管理等）
    const serviceResult = await initializeServices();
    if (!serviceResult) {
      servicesManager.log.warn('部分UI服务初始化失败');
    }

    // 初始化配置管理器
    const configStats = configManager.getStats();
    if (configStats.isDevelopment) {
      servicesManager.log.debug('配置管理器已初始化', {
        isDevelopment: configStats.isDevelopment,
        totalOverrides: configStats.totalOverrides,
        totalPresets: configStats.totalPresets
      });
    }

    // 初始化应用核心服务
    await servicesManager.initServices();

    servicesManager.log.info('应用服务初始化流程完成');

    // 触发应用初始化完成事件（不再在此处触发数据刷新）
    window.dispatchEvent(new CustomEvent('app:initialized'));
  } catch (error) {
    servicesManager.log.error('应用服务初始化失败', error);
  }
};

// 启动初始化流程
initializeApp();

// 智能页面状态管理
let lastVisibilityChange = Date.now();
let isRefreshing = false;

// 智能刷新触发器
async function triggerSmartRefresh(reason) {
  if (isRefreshing) {
    log.debug(`跳过${reason}刷新，已有刷新任务在进行中`);
    return;
  }

  const userStore = useUserStore();
  if (!userStore.isLoggedIn) {
    return;
  }

  try {
    isRefreshing = true;
    log.info(`${reason}，开始智能刷新数据`);
    await refreshUserData();
  } catch (error) {
    log.warn(`${reason}后刷新数据失败`, error);
  } finally {
    isRefreshing = false;
  }
}

// 页面可见性API监听 - 页面重新激活时智能刷新数据
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    const now = Date.now();
    const hiddenDuration = now - lastVisibilityChange;

    // 根据隐藏时间决定是否刷新
    if (hiddenDuration > 5 * 60 * 1000) {
      // 5分钟
      triggerSmartRefresh('页面重新激活');
    }

    lastVisibilityChange = now;
  } else {
    lastVisibilityChange = Date.now();
  }
});

// 已移除：基于窗口焦点的刷新（简化逻辑，避免重复触发）

// 网络状态变化监听
window.addEventListener('online', () => {
  log.info('网络连接恢复，开始刷新数据');
  setTimeout(() => {
    triggerSmartRefresh('网络连接恢复');
  }, 2000); // 延迟2秒确保网络稳定
});

window.addEventListener('offline', () => {
  log.info('网络连接断开，将使用本地缓存');
});
