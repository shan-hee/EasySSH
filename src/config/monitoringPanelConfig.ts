/**
 * 监控面板生产级配置
 * 统一管理监控面板的所有配置项
 */

// 组件高度配置
export const COMPONENT_HEIGHTS = {
  SYSTEM: 200, // 系统信息
  CPU: 180, // CPU监控
  MEMORY: 150, // 内存监控
  NETWORK: 180, // 网络监控
  DISK: 120 // 硬盘监控
};

// 动画配置
export const ANIMATION_CONFIG = {
  // 桌面端动画
  DESKTOP: {
    ENTER_DURATION: 400, // 进入动画时长(ms)
    LEAVE_DURATION: 300, // 退出动画时长(ms)
    ENTER_EASING: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', // 进入缓动
    LEAVE_EASING: 'cubic-bezier(0.55, 0.055, 0.675, 0.19)', // 退出缓动
    DIRECTION: 'left' // 滑入方向
  },

  // 移动端动画
  MOBILE: {
    ENTER_DURATION: 400,
    LEAVE_DURATION: 300,
    ENTER_EASING: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
    LEAVE_EASING: 'cubic-bezier(0.55, 0.055, 0.675, 0.19)',
    DIRECTION: 'left'
  },

  // 性能优化
  PERFORMANCE: {
    DEBOUNCE_DELAY: 150, // 防抖延迟(ms)
    USE_HARDWARE_ACCELERATION: true, // 启用硬件加速
    USE_WILL_CHANGE: true, // 使用will-change优化
    PASSIVE_LISTENERS: true // 使用passive事件监听器
  }
};

// 响应式断点配置
export const BREAKPOINTS = {
  MOBILE_MAX: 768, // 移动端最大宽度
  TABLET_MAX: 1024, // 平板最大宽度
  DESKTOP_MIN: 1025 // 桌面端最小宽度
};

// 面板尺寸配置
export const PANEL_DIMENSIONS = {
  DESKTOP: {
    WIDTH: 320, // 桌面端面板宽度
    MAX_WIDTH_VW: 35, // 最大宽度(视口百分比)
    MIN_WIDTH: 280 // 最小宽度
  },

  MOBILE: {
    WIDTH_VW: 80, // 移动端宽度(视口百分比)
    MAX_WIDTH: 400, // 最大宽度
    MIN_WIDTH: 300 // 最小宽度
  }
};

// 性能配置
export const PERFORMANCE_CONFIG = {
  DEBOUNCE_DELAY: 150, // 防抖延迟(ms)
  AUTO_CLEANUP: true, // 自动清理
  MAX_EVENT_HISTORY: 50 // 最大事件历史记录
};

// 可访问性配置
export const ACCESSIBILITY_CONFIG = {
  ARIA_LABELS: {
    DESKTOP_PANEL: '桌面端监控面板',
    MOBILE_DRAWER: '移动端监控抽屉',
    SYSTEM_INFO: '系统信息监控',
    CPU_MONITOR: 'CPU使用率监控',
    MEMORY_MONITOR: '内存使用率监控',
    NETWORK_MONITOR: '网络状态监控',
    DISK_MONITOR: '硬盘使用率监控'
  },

  KEYBOARD_NAVIGATION: {
    ENABLE_ESC_CLOSE: true, // 启用ESC键关闭
    ENABLE_TAB_NAVIGATION: true, // 启用Tab导航
    FOCUS_TRAP: true // 启用焦点陷阱
  }
};

// 主题配置
export const THEME_CONFIG = {
  COLORS: {
    BACKGROUND: 'rgba(0, 0, 0, 0.8)',
    BORDER: 'rgba(255, 255, 255, 0.1)',
    TEXT_PRIMARY: '#e5e5e5',
    TEXT_SECONDARY: '#b0b0b0',
    ACCENT: '#4CAF50'
  },

  TRANSITIONS: {
    THEME_SWITCH_DURATION: 500, // 主题切换动画时长(ms)
    THEME_SWITCH_EASING: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'
  }
};

// 开发/生产环境配置
export const ENVIRONMENT_CONFIG = {
  DEVELOPMENT: {
    ENABLE_DEBUG_LOGS: true,
    ANIMATION_DURATION_MULTIPLIER: 1 // 正常速度
  },

  PRODUCTION: {
    ENABLE_DEBUG_LOGS: false,
    ANIMATION_DURATION_MULTIPLIER: 1 // 正常速度
  }
};

// 获取当前环境配置
export function getCurrentEnvironmentConfig() {
  const isProd = typeof import.meta !== 'undefined' && (import.meta as any).env && (import.meta as any).env.PROD;
  return isProd ? ENVIRONMENT_CONFIG.PRODUCTION : ENVIRONMENT_CONFIG.DEVELOPMENT;
}

// 配置验证函数
export function validateConfig() {
  const errors = [];

  // 验证组件高度
  Object.entries(COMPONENT_HEIGHTS).forEach(([key, value]) => {
    if (typeof value !== 'number' || value <= 0) {
      errors.push(`Invalid component height for ${key}: ${value}`);
    }
  });

  // 验证动画配置
  if (ANIMATION_CONFIG.DESKTOP.ENTER_DURATION <= 0) {
    errors.push('Invalid desktop enter duration');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

// 导出默认配置
export default {
  COMPONENT_HEIGHTS,
  ANIMATION_CONFIG,
  BREAKPOINTS,
  PANEL_DIMENSIONS,
  PERFORMANCE_CONFIG,
  ACCESSIBILITY_CONFIG,
  THEME_CONFIG,
  ENVIRONMENT_CONFIG,
  getCurrentEnvironmentConfig,
  validateConfig
};
