/**
 * 通知服务
 * 提供统一的通知反馈机制
 */

import { EventEmitter } from './EventEmitter.js';
// Settings类已移除，使用统一的设置服务
import settingsService from '../../../src/services/settings.js';

// 通知类型
export const NotificationType = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error'
};

// 通知位置
export const NotificationPosition = {
  TOP_LEFT: 'top-left',
  TOP_RIGHT: 'top-right',
  BOTTOM_LEFT: 'bottom-left',
  BOTTOM_RIGHT: 'bottom-right',
  TOP_CENTER: 'top-center',
  BOTTOM_CENTER: 'bottom-center'
};

// 默认设置
const DEFAULT_OPTIONS = {
  // 通知显示时间(毫秒)，0表示不自动关闭
  duration: 3000,
  
  // 通知位置
  position: NotificationPosition.TOP_RIGHT,
  
  // 是否允许手动关闭
  closable: true,
  
  // 是否显示图标
  showIcon: true,
  
  // 操作按钮
  actions: [],
  
  // 是否启用声音
  sound: false,
  
  // 是否启用震动(移动设备)
  vibrate: false,
  
  // 是否启用桌面通知
  desktop: false,
  
  // 最大消息数量
  maxCount: 5,
  
  // 淡入淡出动画时长(毫秒)
  animationDuration: 300
};

/**
 * 通知项
 */
class Notification {
  /**
   * 构造函数
   * @param {string} id 通知ID
   * @param {string} message 通知消息
   * @param {string} type 通知类型
   * @param {Object} options 选项
   */
  constructor(id, message, type = NotificationType.INFO, options = {}) {
    this.id = id;
    this.message = message;
    this.type = type;
    this.title = options.title || this._getDefaultTitle();
    this.timestamp = Date.now();
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.visible = true;
    this.timer = null;
    
    // 如果设置了自动关闭，创建定时器
    if (this.options.duration > 0) {
      this.timer = setTimeout(() => {
        this.visible = false;
        if (typeof this.onClose === 'function') {
          this.onClose(this);
        }
      }, this.options.duration);
    }
  }
  
  /**
   * 获取默认标题
   * @returns {string} 默认标题
   * @private
   */
  _getDefaultTitle() {
    switch (this.type) {
      case NotificationType.SUCCESS:
        return '成功';
      case NotificationType.WARNING:
        return '警告';
      case NotificationType.ERROR:
        return '错误';
      default:
        return '提示';
    }
  }
  
  /**
   * 关闭通知
   */
  close() {
    // 清除自动关闭定时器
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    
    this.visible = false;
    
    if (typeof this.onClose === 'function') {
      this.onClose(this);
    }
  }
  
  /**
   * 触发动作
   * @param {string|number} actionKey 动作键或索引
   */
  triggerAction(actionKey) {
    const action = this.options.actions.find(a => 
      a.key === actionKey || a.text === actionKey
    );
    
    if (action && typeof action.onClick === 'function') {
      action.onClick(this);
    }
  }
}

/**
 * 通知服务类
 */
export class NotificationService extends EventEmitter {
  /**
   * 构造函数
   * @param {Object} options 默认选项
   */
  constructor(options = {}) {
    super();
    
    // 通知列表
    this.notifications = [];
    
    // 通知计数器
    this.counter = 0;
    
    // 默认选项
    this.defaultOptions = { ...DEFAULT_OPTIONS, ...options };
    
    // 加载设置
    this.settings = settingsService;
    this._loadSettingsConfig();

    // 监听设置变化
    this.settings.addChangeListener(this._loadSettingsConfig.bind(this));
  }
  
  /**
   * 从设置加载配置
   * @private
   */
  _loadSettingsConfig() {
    const notificationsConfig = this.settings.get('advanced.notifications', {});

    // 合并设置到默认选项
    if (notificationsConfig) {
      this.defaultOptions = {
        ...this.defaultOptions,
        ...notificationsConfig
      };
    }
  }
  
  /**
   * 创建通知
   * @param {string} message 通知消息
   * @param {string} type 通知类型
   * @param {Object} options 通知选项
   * @returns {Notification} 通知对象
   */
  _createNotification(message, type, options = {}) {
    // 生成唯一ID
    const id = `notification-${Date.now()}-${this.counter++}`;
    
    // 合并选项
    const mergedOptions = { ...this.defaultOptions, ...options };
    
    // 创建通知
    const notification = new Notification(id, message, type, mergedOptions);
    
    // 设置关闭回调
    notification.onClose = this._handleClose.bind(this);
    
    // 添加到列表
    this.notifications.push(notification);
    
    // 限制通知数量
    this._enforceMaxCount();
    
    // 触发事件
    this.emit('notification:add', notification);
    
    // 播放声音
    if (mergedOptions.sound) {
      this._playSound(type);
    }
    
    // 震动
    if (mergedOptions.vibrate && navigator.vibrate) {
      this._vibrate();
    }
    
    // 显示桌面通知
    if (mergedOptions.desktop) {
      this._showDesktopNotification(notification);
    }
    
    return notification;
  }
  
  /**
   * 处理通知关闭
   * @param {Notification} notification 通知对象
   * @private
   */
  _handleClose(notification) {
    // 从列表中移除
    const index = this.notifications.findIndex(n => n.id === notification.id);
    
    if (index !== -1) {
      this.notifications.splice(index, 1);
      
      // 触发事件
      this.emit('notification:remove', notification);
    }
  }
  
  /**
   * 限制通知数量
   * @private
   */
  _enforceMaxCount() {
    const { maxCount } = this.defaultOptions;
    
    // 如果超过最大数量，关闭最早的通知
    while (this.notifications.length > maxCount) {
      const oldest = this.notifications[0];
      oldest.close();
    }
  }
  
  /**
   * 播放声音
   * @param {string} type 通知类型
   * @private
   */
  _playSound(type) {
    // 音频文件映射
    const audioMap = {
      [NotificationType.INFO]: 'notification-info.mp3',
      [NotificationType.SUCCESS]: 'notification-success.mp3',
      [NotificationType.WARNING]: 'notification-warning.mp3',
      [NotificationType.ERROR]: 'notification-error.mp3'
    };
    
    const audioFile = audioMap[type] || audioMap[NotificationType.INFO];
    const audio = new Audio(`/assets/sounds/${audioFile}`);
    
    // 尝试播放
    audio.play().catch(err => {
      console.error('通知音效播放失败:', err);
    });
  }
  
  /**
   * 设备震动
   * @private
   */
  _vibrate() {
    try {
      // 短震动模式(毫秒)
      navigator.vibrate([100, 50, 100]);
    } catch (err) {
      console.error('设备震动失败:', err);
    }
  }
  
  /**
   * 显示桌面通知
   * @param {Notification} notification 通知对象
   * @private
   */
  _showDesktopNotification(notification) {
    // 检查权限
    if (window.Notification && Notification.permission === 'granted') {
      try {
        // 创建桌面通知
        const desktopNotification = new Notification(notification.title, {
          body: notification.message,
          icon: `/assets/icons/notification-${notification.type}.png`
        });
        
        // 点击时聚焦窗口
        desktopNotification.onclick = () => {
          window.focus();
          notification.close();
        };
      } catch (err) {
        console.error('桌面通知创建失败:', err);
      }
    } 
    // 尝试请求权限
    else if (window.Notification && Notification.permission !== 'denied') {
      Notification.requestPermission();
    }
  }
  
  /**
   * 显示信息通知
   * @param {string} message 消息内容
   * @param {Object} options 选项
   * @returns {Notification} 通知对象
   */
  info(message, options = {}) {
    return this._createNotification(message, NotificationType.INFO, options);
  }
  
  /**
   * 显示成功通知
   * @param {string} message 消息内容
   * @param {Object} options 选项
   * @returns {Notification} 通知对象
   */
  success(message, options = {}) {
    return this._createNotification(message, NotificationType.SUCCESS, options);
  }
  
  /**
   * 显示警告通知
   * @param {string} message 消息内容
   * @param {Object} options 选项
   * @returns {Notification} 通知对象
   */
  warning(message, options = {}) {
    return this._createNotification(message, NotificationType.WARNING, options);
  }
  
  /**
   * 显示错误通知
   * @param {string} message 消息内容
   * @param {Object} options 选项
   * @returns {Notification} 通知对象
   */
  error(message, options = {}) {
    return this._createNotification(message, NotificationType.ERROR, options);
  }
  
  /**
   * 关闭指定通知
   * @param {string} id 通知ID
   * @returns {boolean} 是否成功关闭
   */
  close(id) {
    const notification = this.notifications.find(n => n.id === id);
    
    if (notification) {
      notification.close();
      return true;
    }
    
    return false;
  }
  
  /**
   * 关闭所有通知
   */
  closeAll() {
    // 复制数组避免迭代时修改
    const notificationsCopy = [...this.notifications];
    notificationsCopy.forEach(notification => notification.close());
  }
  
  /**
   * 单例实例
   */
  static instance = null;
  
  /**
   * 获取服务实例
   * @param {Object} options 选项
   * @returns {NotificationService} 通知服务实例
   */
  static getInstance(options = {}) {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService(options);
    }
    return NotificationService.instance;
  }
}

// 导出默认实例
export default NotificationService.getInstance(); 