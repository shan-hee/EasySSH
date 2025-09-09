/**
 * AI面板状态管理
 * 管理AI交互面板的状态、消息历史和用户偏好
 */

import { ref, reactive, computed, watch, readonly } from 'vue';
import { defineStore } from 'pinia';
import settingsService from '../services/settings.js';
import log from '../services/log.js';

export const useAIPanelStore = defineStore('aiPanel', () => {
  // ===== 状态定义 =====

  // 面板显示状态 - 每个终端独立
  const panelStates = ref({});

  // 消息历史 - 每个终端独立
  const messageHistory = ref({});

  // 面板高度 - 每个终端独立
  const panelHeights = ref({});

  // 用户偏好设置
  const preferences = reactive({
    autoShow: true, // 收到AI响应时自动显示面板
    maxMessages: 100, // 每个终端最大消息数
    defaultHeight: 250, // 默认面板高度
    enableAnimations: true, // 启用动画效果
    showTimestamps: true, // 显示时间戳
    enableSoundNotifications: false, // 声音通知
    autoScroll: true, // 自动滚动到底部
    compactMode: false // 紧凑模式
  });

  // 全局设置
  const globalSettings = reactive({
    isEnabled: true, // AI面板是否启用
    maxPanelHeight: 400, // 最大面板高度
    minPanelHeight: 100, // 最小面板高度
    persistHistory: true, // 是否持久化历史记录
    historyRetentionDays: 7 // 历史记录保留天数
  });

  // ===== 计算属性 =====

  // 获取所有活动的终端ID
  const activeTerminals = computed(() => {
    return Object.keys(panelStates.value).filter(termId => panelStates.value[termId]);
  });

  // 获取总消息数
  const totalMessages = computed(() => {
    return Object.values(messageHistory.value).reduce((total, messages) => {
      return total + (messages?.length || 0);
    }, 0);
  });

  // 检查是否有未读消息
  const hasUnreadMessages = computed(() => {
    return Object.values(messageHistory.value).some(messages => {
      return messages?.some(msg => msg.unread);
    });
  });

  // ===== 面板状态管理 =====

  /**
   * 初始化终端的AI面板状态
   * @param {string} terminalId 终端ID
   */
  const initializeTerminal = terminalId => {
    if (!terminalId) return;

    // 初始化面板状态
    if (!(terminalId in panelStates.value)) {
      panelStates.value[terminalId] = false;
    }

    // 初始化消息历史
    if (!(terminalId in messageHistory.value)) {
      messageHistory.value[terminalId] = [];
    }

    // 初始化面板高度
    if (!(terminalId in panelHeights.value)) {
      panelHeights.value[terminalId] = preferences.defaultHeight;
    }

    log.debug('AI面板状态已初始化', { terminalId });
  };

  /**
   * 显示AI面板
   * @param {string} terminalId 终端ID
   */
  const showPanel = terminalId => {
    if (!terminalId) return;

    initializeTerminal(terminalId);
    panelStates.value[terminalId] = true;

    log.debug('AI面板已显示', { terminalId });
  };

  /**
   * 隐藏AI面板
   * @param {string} terminalId 终端ID
   */
  const hidePanel = terminalId => {
    if (!terminalId) return;

    panelStates.value[terminalId] = false;

    log.debug('AI面板已隐藏', { terminalId });
  };

  /**
   * 切换AI面板显示状态
   * @param {string} terminalId 终端ID
   */
  const togglePanel = terminalId => {
    if (!terminalId) return;

    const isVisible = isPanelVisible(terminalId);
    if (isVisible) {
      hidePanel(terminalId);
    } else {
      showPanel(terminalId);
    }

    return !isVisible;
  };

  /**
   * 检查面板是否可见
   * @param {string} terminalId 终端ID
   * @returns {boolean} 是否可见
   */
  const isPanelVisible = terminalId => {
    return Boolean(panelStates.value[terminalId]);
  };

  // ===== 消息管理 =====

  /**
   * 添加消息到历史记录
   * @param {string} terminalId 终端ID
   * @param {Object} message 消息对象
   */
  const addMessage = (terminalId, message) => {
    if (!terminalId || !message) return;

    initializeTerminal(terminalId);

    // 创建消息对象
    const newMessage = {
      id: message.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      type: message.type || 'assistant',
      content: message.content || '',
      timestamp: message.timestamp || Date.now(),
      unread: message.unread !== false, // 默认为未读
      metadata: message.metadata || {}
    };

    // 添加到历史记录
    messageHistory.value[terminalId].push(newMessage);

    // 限制消息数量
    const maxMessages = preferences.maxMessages;
    if (messageHistory.value[terminalId].length > maxMessages) {
      const excess = messageHistory.value[terminalId].length - maxMessages;
      messageHistory.value[terminalId].splice(0, excess);
    }

    // 如果设置了自动显示，则显示面板
    if (preferences.autoShow && message.type === 'assistant') {
      showPanel(terminalId);
    }

    // 只对非流式消息记录DEBUG日志，减少日志噪音
    if (message.type !== 'assistant' || !message.content?.includes('...')) {
      log.debug('消息已添加到AI面板', { terminalId, messageId: newMessage.id });
    }

    return newMessage;
  };

  /**
   * 获取终端的消息历史
   * @param {string} terminalId 终端ID
   * @returns {Array} 消息列表
   */
  const getMessages = terminalId => {
    if (!terminalId) return [];
    return messageHistory.value[terminalId] || [];
  };

  /**
   * 清空终端的消息历史
   * @param {string} terminalId 终端ID
   */
  const clearMessages = terminalId => {
    if (!terminalId) return;

    messageHistory.value[terminalId] = [];

    log.debug('AI面板消息历史已清空', { terminalId });
  };

  /**
   * 标记消息为已读
   * @param {string} terminalId 终端ID
   * @param {string} messageId 消息ID，如果不提供则标记所有消息为已读
   */
  const markAsRead = (terminalId, messageId = null) => {
    if (!terminalId) return;

    const messages = messageHistory.value[terminalId];
    if (!messages) return;

    if (messageId) {
      const message = messages.find(msg => msg.id === messageId);
      if (message) {
        message.unread = false;
      }
    } else {
      // 标记所有消息为已读
      messages.forEach(msg => {
        msg.unread = false;
      });
    }

    log.debug('消息已标记为已读', { terminalId, messageId });
  };

  // ===== 面板高度管理 =====

  /**
   * 设置面板高度
   * @param {string} terminalId 终端ID
   * @param {number} height 高度值
   */
  const setPanelHeight = (terminalId, height) => {
    if (!terminalId || typeof height !== 'number') return;

    // 限制高度范围
    const clampedHeight = Math.max(
      globalSettings.minPanelHeight,
      Math.min(height, globalSettings.maxPanelHeight)
    );

    // 只在高度有显著变化时记录日志，减少日志噪音
    const previousHeight = panelHeights.value[terminalId] || 0;
    panelHeights.value[terminalId] = clampedHeight;

    if (Math.abs(clampedHeight - previousHeight) > 10) {
      log.debug('AI面板高度已设置', { terminalId, height: clampedHeight, previousHeight });
    }
  };

  /**
   * 获取面板高度
   * @param {string} terminalId 终端ID
   * @returns {number} 高度值
   */
  const getPanelHeight = terminalId => {
    return panelHeights.value[terminalId] || preferences.defaultHeight;
  };

  // ===== 偏好设置管理 =====

  /**
   * 更新用户偏好
   * @param {Object} newPreferences 新的偏好设置
   */
  const updatePreferences = newPreferences => {
    Object.assign(preferences, newPreferences);
    savePreferences();

    log.debug('AI面板偏好设置已更新', newPreferences);
  };

  /**
   * 重置偏好设置为默认值
   */
  const resetPreferences = () => {
    Object.assign(preferences, {
      autoShow: true,
      maxMessages: 100,
      defaultHeight: 250,
      enableAnimations: true,
      showTimestamps: true,
      enableSoundNotifications: false,
      autoScroll: true,
      compactMode: false
    });
    savePreferences();

    log.debug('AI面板偏好设置已重置');
  };

  // ===== 数据持久化 =====

  /**
   * 保存偏好设置到本地存储
   */
  const savePreferences = () => {
    try {
      settingsService.set('aiPanel.preferences', preferences);
      log.debug('AI面板偏好设置已保存');
    } catch (error) {
      log.error('保存AI面板偏好设置失败', { error: error.message });
    }
  };

  /**
   * 从本地存储加载偏好设置
   */
  const loadPreferences = () => {
    try {
      const saved = settingsService.get('aiPanel.preferences', {});
      Object.assign(preferences, saved);
      log.debug('AI面板偏好设置已加载');
    } catch (error) {
      log.error('加载AI面板偏好设置失败', { error: error.message });
    }
  };

  /**
   * 保存消息历史到本地存储
   */
  const saveMessageHistory = () => {
    if (!globalSettings.persistHistory) return;

    try {
      // 只保存最近的消息
      const filteredHistory = {};
      const cutoffTime = Date.now() - globalSettings.historyRetentionDays * 24 * 60 * 60 * 1000;

      Object.keys(messageHistory.value).forEach(terminalId => {
        const messages = messageHistory.value[terminalId];
        filteredHistory[terminalId] = messages.filter(msg => msg.timestamp > cutoffTime);
      });

      settingsService.set('aiPanel.messageHistory', filteredHistory);
      log.debug('AI面板消息历史已保存');
    } catch (error) {
      log.error('保存AI面板消息历史失败', { error: error.message });
    }
  };

  /**
   * 从本地存储加载消息历史
   */
  const loadMessageHistory = () => {
    if (!globalSettings.persistHistory) return;

    try {
      const saved = settingsService.get('aiPanel.messageHistory', {});
      messageHistory.value = saved;
      log.debug('AI面板消息历史已加载');
    } catch (error) {
      log.error('加载AI面板消息历史失败', { error: error.message });
    }
  };

  // ===== 清理和维护 =====

  /**
   * 清理终端数据
   * @param {string} terminalId 终端ID
   */
  const cleanupTerminal = terminalId => {
    if (!terminalId) return;

    delete panelStates.value[terminalId];
    delete messageHistory.value[terminalId];
    delete panelHeights.value[terminalId];

    log.debug('AI面板终端数据已清理', { terminalId });
  };

  /**
   * 清理过期的消息历史
   */
  const cleanupExpiredMessages = () => {
    const cutoffTime = Date.now() - globalSettings.historyRetentionDays * 24 * 60 * 60 * 1000;

    Object.keys(messageHistory.value).forEach(terminalId => {
      const messages = messageHistory.value[terminalId];
      messageHistory.value[terminalId] = messages.filter(msg => msg.timestamp > cutoffTime);
    });

    log.debug('过期的AI面板消息已清理');
  };

  // ===== 初始化 =====

  // 加载保存的数据
  loadPreferences();
  loadMessageHistory();

  // 监听偏好设置变化，自动保存
  watch(preferences, savePreferences, { deep: true });

  // 定期清理过期消息
  setInterval(cleanupExpiredMessages, 60 * 60 * 1000); // 每小时清理一次

  // ===== 返回公共API =====

  return {
    // 状态
    panelStates: readonly(panelStates),
    messageHistory: readonly(messageHistory),
    panelHeights: readonly(panelHeights),
    preferences: readonly(preferences),
    globalSettings: readonly(globalSettings),

    // 计算属性
    activeTerminals,
    totalMessages,
    hasUnreadMessages,

    // 面板状态管理
    initializeTerminal,
    showPanel,
    hidePanel,
    togglePanel,
    isPanelVisible,

    // 消息管理
    addMessage,
    getMessages,
    clearMessages,
    markAsRead,

    // 面板高度管理
    setPanelHeight,
    getPanelHeight,

    // 偏好设置管理
    updatePreferences,
    resetPreferences,

    // 数据持久化
    savePreferences,
    loadPreferences,
    saveMessageHistory,
    loadMessageHistory,

    // 清理和维护
    cleanupTerminal,
    cleanupExpiredMessages
  };
});

export default useAIPanelStore;
