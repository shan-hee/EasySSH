import { defineStore } from 'pinia';
import { ref, reactive } from 'vue';

interface Session {
  id?: string;
  createdAt: Date;
  updatedAt?: Date;
  [key: string]: any;
}

/**
 * 会话状态管理
 * 用于管理终端会话，但不通过URL传递会话ID
 */
export const useSessionStore = defineStore('session', () => {
  // 当前活动的会话ID
  const activeSessionId = ref<string | null>(null);

  // 存储所有会话信息
  const sessions = reactive<Record<string, Session>>({});

  /**
   * 设置当前活动会话
   * @param {string} sessionId - 会话ID
   */
  const setActiveSession = (sessionId: string) => {
    if (!sessionId) return;
    activeSessionId.value = sessionId;
  };

  /**
   * 获取当前活动会话ID
   * @returns {string|null} - 会话ID
   */
  const getActiveSession = (): string | null => {
    return activeSessionId.value;
  };

  /**
   * 注册新会话
   * @param {string} sessionId - 会话ID
   * @param {Object} sessionData - 会话数据
   */
  const registerSession = (sessionId: string, sessionData: Record<string, any>) => {
    if (!sessionId) return;

    sessions[sessionId] = {
      ...sessionData,
      createdAt: new Date()
    };

    // 自动设置为活动会话
    setActiveSession(sessionId);
  };

  /**
   * 获取会话信息
   * @param {string} sessionId - 会话ID
   * @returns {Object|null} - 会话信息
   */
  const getSession = (sessionId: string): Session | null => {
    if (!sessionId || !sessions[sessionId]) return null;
    return sessions[sessionId];
  };

  /**
   * 通过路径获取会话ID
   * 此方法用于兼容以前的URL路径结构
   * @param {string} path - 路径
   * @returns {string|null} - 会话ID
   */
  const getSessionIdFromPath = (path: string): string | null => {
    if (!path || typeof path !== 'string') return null;

    // 匹配 /terminal/xxx 格式的路径
    const match = path.match(/\/terminal\/([^/]+)/);
    if (match && match[1]) {
      return match[1];
    }

    return null;
  };

  /**
   * 更新会话信息
   * @param {string} sessionId - 会话ID
   * @param {Object} data - 更新的数据
   */
  const updateSession = (sessionId: string, data: Partial<Session>) => {
    if (!sessionId || !sessions[sessionId]) return;

    sessions[sessionId] = {
      ...sessions[sessionId],
      ...data,
      updatedAt: new Date()
    };
  };

  /**
   * 移除会话
   * @param {string} sessionId - 会话ID
   */
  const removeSession = (sessionId: string) => {
    if (!sessionId || !sessions[sessionId]) return;

    delete sessions[sessionId];

    // 如果移除的是当前活动会话，清空活动会话引用
    if (activeSessionId.value === sessionId) {
      activeSessionId.value = null;
    }
  };

  /**
   * 获取所有会话
   * @returns {Object} - 所有会话
   */
  const getAllSessions = (): Record<string, Session> => {
    return { ...sessions } as Record<string, Session>;
  };

  /**
   * 检查会话是否存在
   * @param {string} sessionId - 会话ID
   * @returns {boolean} - 会话是否存在
   */
  const hasSession = (sessionId: string) => {
    return !!sessions[sessionId];
  };

  return {
    activeSessionId,
    setActiveSession,
    getActiveSession,
    registerSession,
    getSession,
    getSessionIdFromPath,
    updateSession,
    removeSession,
    getAllSessions,
    hasSession
  };
});
