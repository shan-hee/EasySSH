import { ElNotification } from 'element-plus';

/**
 * 通知服务模块，提供应用内和系统通知功能
 */
class NotificationService {
  constructor() {
    this.isReady = false;
    this.hasPermission = false;
    this.listeners = [];
    this.notificationHistory = [];
    this.maxHistoryLength = 50; // 最大保存通知数量
  }

  /**
   * 初始化通知服务
   */
  init() {
    // 检查浏览器通知支持
    this.checkNotificationSupport();

    // 初始化完成
    this.isReady = true;
    console.log('通知服务初始化完成');
  }

  /**
   * 检查浏览器通知功能是否支持
   * @returns {boolean} - 是否支持
   */
  checkNotificationSupport() {
    // 检查是否支持Notification API
    if (!('Notification' in window)) {
      console.warn('该浏览器不支持系统通知功能');
      this.hasPermission = false;
      return false;
    }

    // 检查通知权限
    this.checkPermission();
    return true;
  }

  /**
   * 检查通知权限状态
   * @returns {string} - 权限状态 "granted", "denied", "default"
   */
  checkPermission() {
    const permission = Notification.permission;

    // 更新权限状态
    this.hasPermission = permission === 'granted';

    return permission;
  }

  /**
   * 请求通知权限
   * @returns {Promise<string>} - 权限状态
   */
  async requestPermission() {
    try {
      const permission = await Notification.requestPermission();

      // 更新权限状态
      this.hasPermission = permission === 'granted';

      return permission;
    } catch (error) {
      console.error('请求通知权限失败:', error);
      return 'denied';
    }
  }

  /**
   * 发送应用内通知
   * @param {Object} options - 通知选项
   * @param {string} options.title - 通知标题
   * @param {string} options.message - 通知内容
   * @param {string} options.type - 通知类型 "success", "warning", "info", "error"
   * @param {number} options.duration - 显示时间(毫秒), 默认4500ms, 设置为0则不自动关闭
   * @param {boolean} options.showClose - 是否显示关闭按钮
   * @param {Function} options.onClick - 点击通知回调
   * @param {Function} options.onClose - 关闭通知回调
   * @returns {import('element-plus').NotificationHandle} - 通知实例
   */
  notify(options) {
    // 默认参数
    const defaultOptions = {
      title: 'EasySSH',
      message: '',
      type: 'info',
      duration: 4500,
      showClose: true,
      onClick: null,
      onClose: null
    };

    // 合并选项
    const notifyOptions = { ...defaultOptions, ...options };

    // 保存通知历史记录
    this._addToHistory({
      title: notifyOptions.title,
      message: notifyOptions.message,
      type: notifyOptions.type,
      timestamp: new Date()
    });

    // 触发通知事件
    this._emitNotificationEvent('internal', {
      title: notifyOptions.title,
      message: notifyOptions.message,
      type: notifyOptions.type
    });

    // 发送Element Plus通知
    return ElNotification({
      title: notifyOptions.title,
      message: notifyOptions.message,
      type: notifyOptions.type,
      duration: notifyOptions.duration,
      showClose: notifyOptions.showClose,
      onClick: () => {
        this._handleNotificationClick(notifyOptions);
      },
      onClose: () => {
        if (typeof notifyOptions.onClose === 'function') {
          notifyOptions.onClose();
        }
      }
    });
  }

  /**
   * 发送系统通知
   * @param {Object} options - 通知选项
   * @param {string} options.title - 通知标题
   * @param {string} options.body - 通知内容
   * @param {string} options.icon - 通知图标URL
   * @param {number} options.timeout - 通知自动关闭时间(毫秒)
   * @param {boolean} options.requireInteraction - 是否需要用户交互才关闭
   * @param {Function} options.onClick - 点击通知回调
   * @param {Function} options.onClose - 关闭通知回调
   * @param {Function} options.onError - 错误回调
   * @param {boolean} options.silent - 是否静音
   * @returns {Notification|null} - 通知实例或null(如果不支持)
   */
  sendSystemNotification(options) {
    if (!this.hasPermission) {
      console.warn('没有系统通知权限，将使用应用内通知替代');

      // 降级使用应用内通知
      return this.notify({
        title: options.title,
        message: options.body || '',
        type: 'info',
        onClick: options.onClick,
        onClose: options.onClose
      });
    }

    try {
      // 创建系统通知
      const notification = new Notification(options.title, {
        body: options.body || '',
        icon: options.icon,
        requireInteraction: options.requireInteraction || false,
        silent: options.silent || false
      });

      // 添加事件监听
      if (typeof options.onClick === 'function') {
        notification.addEventListener('click', options.onClick);
      }

      if (typeof options.onClose === 'function') {
        notification.addEventListener('close', options.onClose);
      }

      if (typeof options.onError === 'function') {
        notification.addEventListener('error', options.onError);
      }

      // 设置自动关闭
      if (options.timeout && options.timeout > 0) {
        setTimeout(() => {
          notification.close();
        }, options.timeout);
      }

      // 保存通知历史记录
      this._addToHistory({
        title: options.title,
        message: options.body || '',
        type: 'system',
        timestamp: new Date()
      });

      // 触发通知事件
      this._emitNotificationEvent('system', {
        title: options.title,
        message: options.body || '',
        type: 'system'
      });

      return notification;
    } catch (error) {
      console.error('发送系统通知失败:', error);

      // 降级使用应用内通知
      return this.notify({
        title: options.title,
        message: options.body || '',
        type: 'info',
        onClick: options.onClick,
        onClose: options.onClose
      });
    }
  }

  /**
   * 显示成功通知
   * @param {string|Object} message - 通知内容或选项对象
   * @param {string} title - 通知标题
   * @param {Object} options - 其他选项
   */
  success(message, title = '成功', options = {}) {
    if (typeof message === 'object') {
      options = message;
    } else {
      options.message = message;
      options.title = title;
    }

    return this.notify({
      ...options,
      type: 'success'
    });
  }

  /**
   * 显示错误通知
   * @param {string|Object} message - 通知内容或选项对象
   * @param {string} title - 通知标题
   * @param {Object} options - 其他选项
   */
  error(message, title = '错误', options = {}) {
    if (typeof message === 'object') {
      options = message;
    } else {
      options.message = message;
      options.title = title;
    }

    return this.notify({
      ...options,
      type: 'error'
    });
  }

  /**
   * 显示警告通知
   * @param {string|Object} message - 通知内容或选项对象
   * @param {string} title - 通知标题
   * @param {Object} options - 其他选项
   */
  warning(message, title = '警告', options = {}) {
    if (typeof message === 'object') {
      options = message;
    } else {
      options.message = message;
      options.title = title;
    }

    return this.notify({
      ...options,
      type: 'warning'
    });
  }

  /**
   * 显示信息通知
   * @param {string|Object} message - 通知内容或选项对象
   * @param {string} title - 通知标题
   * @param {Object} options - 其他选项
   */
  info(message, title = '信息', options = {}) {
    if (typeof message === 'object') {
      options = message;
    } else {
      options.message = message;
      options.title = title;
    }

    return this.notify({
      ...options,
      type: 'info'
    });
  }

  /**
   * 获取通知历史记录
   * @returns {Array<Object>} - 通知历史记录
   */
  getHistory() {
    return [...this.notificationHistory];
  }

  /**
   * 清空通知历史记录
   */
  clearHistory() {
    this.notificationHistory = [];
  }

  /**
   * 添加通知事件监听器
   * @param {string} event - 事件名称 "all", "internal", "system"
   * @param {Function} callback - 回调函数
   */
  addListener(event, callback) {
    if (typeof callback === 'function') {
      this.listeners.push({ event, callback });
    }
  }

  /**
   * 移除通知事件监听器
   * @param {string} event - 事件名称
   * @param {Function} callback - 回调函数
   */
  removeListener(event, callback) {
    const index = this.listeners.findIndex(
      listener => listener.event === event && listener.callback === callback
    );

    if (index !== -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * 处理通知点击事件
   * @param {Object} options - 通知选项
   * @private
   */
  _handleNotificationClick(options) {
    if (typeof options.onClick === 'function') {
      options.onClick();
    }
  }

  /**
   * 添加通知到历史记录
   * @param {Object} notification - 通知对象
   * @private
   */
  _addToHistory(notification) {
    // 添加到历史记录前面
    this.notificationHistory.unshift(notification);

    // 限制历史记录长度
    if (this.notificationHistory.length > this.maxHistoryLength) {
      this.notificationHistory = this.notificationHistory.slice(0, this.maxHistoryLength);
    }
  }

  /**
   * 触发通知事件
   * @param {string} type - 通知类型
   * @param {Object} data - 通知数据
   * @private
   */
  _emitNotificationEvent(type, data) {
    // 触发特定类型监听器
    this.listeners
      .filter(listener => listener.event === type || listener.event === 'all')
      .forEach(listener => {
        try {
          listener.callback(data);
        } catch (error) {
          console.error('通知事件监听器执行出错:', error);
        }
      });
  }
}

// 创建单例实例
const notificationService = new NotificationService();

export default notificationService;
