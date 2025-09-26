const logger = require('../utils/logger');

class SessionLifecycleService {
  constructor() {
    this.sessions = new Map();
  }

  /**
   * 注册或获取会话上下文
   * @param {string} sessionId
   * @param {Object} [options]
   * @param {string} [options.connectionId]
   * @param {Object} [options.metadata]
   * @param {number} [options.timeoutMs]
   * @returns {Object}
   */
  register(sessionId, options = {}) {
    if (!sessionId) {
      throw new Error('sessionId is required to register session lifecycle context');
    }

    const existing = this.sessions.get(sessionId);
    if (existing) {
      if (options.connectionId) {
        existing.connectionId = options.connectionId;
      }
      if (options.metadata) {
        existing.metadata = {
          ...existing.metadata,
          ...options.metadata
        };
      }
      return existing;
    }

    if (typeof AbortController === 'undefined') {
      throw new Error('AbortController is not available in the current environment');
    }

    const controller = new AbortController();
    const context = {
      sessionId,
      connectionId: options.connectionId || sessionId,
      metadata: options.metadata || {},
      controller,
      signal: controller.signal,
      createdAt: Date.now(),
      status: 'active',
      abortHandlers: new Set(),
      timeoutTimer: null,
      abortReason: null,
      abortDetail: null
    };

    if (options.timeoutMs && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0) {
      context.timeoutTimer = setTimeout(() => {
        logger.warn('Session cancellation timeout reached', {
          sessionId,
          timeoutMs: options.timeoutMs
        });
        this.abort(sessionId, 'timeout');
      }, options.timeoutMs);
    }

    context.signal.addEventListener('abort', () => {
      context.status = 'aborted';
      const reason = context.signal.reason || context.abortReason || 'aborted';
      const detail = context.abortDetail || {};

      for (const handler of context.abortHandlers) {
        try {
          handler(reason, detail);
        } catch (error) {
          logger.error('Session abort handler failed', {
            sessionId,
            error: error.message
          });
        }
      }

      context.abortHandlers.clear();
      this.#cleanup(sessionId);
    }, { once: true });

    if (options.onAbort && typeof options.onAbort === 'function') {
      context.abortHandlers.add(options.onAbort);
    }

    this.sessions.set(sessionId, context);
    return context;
  }

  /**
   * 添加会话取消处理器
   * @param {string} sessionId
   * @param {Function} handler
   * @param {Object} [options]
   * @param {boolean} [options.runIfAborted=true]
   * @returns {Function} 清理函数
   */
  addAbortHandler(sessionId, handler, options = {}) {
    const context = this.sessions.get(sessionId);
    if (!context || typeof handler !== 'function') {
      return () => {};
    }

    const { runIfAborted = true } = options;

    if (context.signal.aborted) {
      if (runIfAborted) {
        try {
          handler(context.signal.reason || context.abortReason || 'aborted', context.abortDetail || {});
        } catch (error) {
          logger.error('Session abort handler failed (late registration)', {
            sessionId,
            error: error.message
          });
        }
      }
      return () => {};
    }

    context.abortHandlers.add(handler);
    return () => {
      context.abortHandlers.delete(handler);
    };
  }

  /**
   * 触发会话取消
   * @param {string} sessionId
   * @param {string|Error} reason
   * @param {Object} [detail]
   * @returns {boolean} 是否触发了取消
   */
  abort(sessionId, reason = 'manual', detail = {}) {
    const context = this.sessions.get(sessionId);
    if (!context) {
      return false;
    }

    if (context.signal.aborted) {
      return false;
    }

    context.abortReason = reason;
    context.abortDetail = detail;

    try {
      context.controller.abort(reason);
      return true;
    } catch (error) {
      logger.error('Session abort failed', {
        sessionId,
        error: error.message
      });
      return false;
    }
  }

  /**
   * 结束并清理会话上下文（非取消路径）
   * @param {string} sessionId
   */
  finalize(sessionId) {
    this.#cleanup(sessionId);
  }

  get(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  has(sessionId) {
    return this.sessions.has(sessionId);
  }

  isAborted(sessionId) {
    const context = this.sessions.get(sessionId);
    return context ? context.signal.aborted : false;
  }

  listActive() {
    return Array.from(this.sessions.values()).map((ctx) => ({
      sessionId: ctx.sessionId,
      connectionId: ctx.connectionId,
      metadata: ctx.metadata,
      status: ctx.status,
      createdAt: ctx.createdAt
    }));
  }

  #cleanup(sessionId) {
    const context = this.sessions.get(sessionId);
    if (!context) {
      return;
    }

    if (context.timeoutTimer) {
      clearTimeout(context.timeoutTimer);
      context.timeoutTimer = null;
    }

    context.abortHandlers.clear();
    this.sessions.delete(sessionId);
  }
}

module.exports = new SessionLifecycleService();
