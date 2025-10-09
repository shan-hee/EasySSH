/**
 * AI客户端
 * 负责与后端AI服务的WebSocket通信
 */

import log from '../log';
import storageService from '../storage';

type AIMessageHandler = {
  onStream?: (data: any) => void;
  onDone?: (data: any) => void;
  onError?: (data: any) => void;
  onCancel?: (data?: any) => void;
};

class AIClient {
  private ws: WebSocket | null;
  private connected: boolean;
  private reconnectAttempts: number;
  private maxReconnectAttempts: number;
  private reconnectDelay: number;
  private messageHandlers: Map<string, AIMessageHandler>;
  private config: any;

  constructor() {
    this.ws = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.messageHandlers = new Map();
    this.config = null;

    // 绑定方法
    this.onOpen = this.onOpen.bind(this);
    this.onMessage = this.onMessage.bind(this);
    this.onClose = this.onClose.bind(this);
    this.onError = this.onError.bind(this);
  }

  /**
   * 连接到AI服务
   * @param {Object} config AI配置
   */
  async connect(config: any): Promise<void> {
    if (this.connected) {
      log.debug('AI客户端已连接');
      return;
    }

    this.config = config;

    try {
      // 构建WebSocket URL
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      // 后端服务器运行在8001端口
      const backendHost = `${window.location.hostname}:8001`;
      const userId = this.getUserId();
      const sessionId = this.getSessionId();

      const wsUrl = `${protocol}//${backendHost}/ai?userId=${userId}&sessionId=${sessionId}`;

      log.debug('连接AI WebSocket', { url: wsUrl });

      // 创建WebSocket连接
      this.ws = new WebSocket(wsUrl);
      this.ws.onopen = this.onOpen;
      this.ws.onmessage = this.onMessage;
      this.ws.onclose = this.onClose;
      this.ws.onerror = this.onError;

      // 等待连接建立
      await this.waitForConnection();
    } catch (error: unknown) {
      log.error('连接AI服务失败', error as any);
      throw error as any;
    }
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close(1000, '客户端主动断开');
      this.ws = null;
    }
    this.connected = false;
    this.reconnectAttempts = 0;
    log.debug('AI客户端已断开连接');
  }

  /**
   * 发送请求
   * @param {Object} request 请求对象
   * @param {AbortSignal} signal 取消信号
   * @returns {Promise<Object>} 响应结果
   */
  async sendRequest(
    request: { requestId: string; [k: string]: any },
    signal: AbortSignal | null = null
  ): Promise<{ content: string; metadata: any; success: boolean }> {
    if (!this.connected) {
      throw new Error('AI服务未连接');
    }

    return new Promise((resolve, reject) => {
      const requestId = request.requestId;
      const result = {
        content: '',
        metadata: null,
        success: false
      };

      // 设置消息处理器
      const handler: AIMessageHandler = {
        onStream: (data: any) => {
          result.content += data.delta || '';
        },
        onDone: (data: any) => {
          result.metadata = data.metadata;
          result.success = true;
          this.messageHandlers.delete(requestId);
          resolve(result);
        },
        onError: (data: any) => {
          this.messageHandlers.delete(requestId);
          reject(new Error(data.error?.message || '未知错误'));
        },
        onCancel: () => {
          this.messageHandlers.delete(requestId);
          reject(new Error('请求已取消'));
        }
      };

      this.messageHandlers.set(requestId, handler);

      // 处理取消信号
      if (signal) {
        signal.addEventListener('abort', () => {
          this.cancelRequest(requestId);
          handler.onCancel?.();
        });
      }

      // 发送请求
      try {
        this.send(request);
      } catch (error) {
        this.messageHandlers.delete(requestId);
        reject(error);
      }
    });
  }

  /**
   * 取消请求
   * @param {string} requestId 请求ID
   */
  cancelRequest(requestId: string): void {
    if (this.connected) {
      this.send({
        type: 'ai_cancel',
        requestId
      });
    }
  }

  /**
   * 发送消息
   * @param {Object} message 消息对象
   */
  send(message: any): void {
    if (!this.connected || !this.ws) {
      throw new Error('AI服务未连接');
    }

    try {
      this.ws.send(JSON.stringify(message));
      log.debug('发送AI消息', { type: message.type, requestId: message.requestId });
    } catch (error: unknown) {
      log.error('发送AI消息失败', error as any);
      throw error as any;
    }
  }

  /**
   * 等待连接建立
   * @returns {Promise<void>}
   */
  waitForConnection(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('连接超时'));
      }, 10000); // 10秒超时

      const checkConnection = () => {
        if (this.connected) {
          clearTimeout(timeout);
          resolve();
        } else if (this.ws && this.ws.readyState === WebSocket.CLOSED) {
          clearTimeout(timeout);
          reject(new Error('连接失败'));
        } else {
          setTimeout(checkConnection, 100);
        }
      };

      checkConnection();
    });
  }

  /**
   * WebSocket连接打开事件
   */
  onOpen(): void {
    this.connected = true;
    this.reconnectAttempts = 0;
    log.info('AI WebSocket连接已建立');

    // 连接建立后，立即发送配置到后端
    this.sendConfigToBackend();
  }

  /**
   * WebSocket消息事件
   * @param {MessageEvent} event 消息事件
   */
  onMessage(event: MessageEvent): void {
    try {
      const message = JSON.parse(event.data as any);

      // 只对非流式消息记录DEBUG日志，减少日志噪音
      if (message.type !== 'ai_stream') {
        log.debug('收到AI消息', { type: message.type });
      }

      // 路由消息到相应的处理器
      this.routeMessage(message);
    } catch (error: unknown) {
      log.error('解析AI消息失败', error as any);
    }
  }

  /**
   * WebSocket连接关闭事件
   * @param {CloseEvent} event 关闭事件
   */
  onClose(event: CloseEvent): void {
    this.connected = false;
    log.info('AI WebSocket连接已关闭', { code: event.code, reason: event.reason });

    // 清理所有消息处理器
    for (const [_requestId, handler] of this.messageHandlers.entries()) {
      handler.onCancel?.();
    }
    this.messageHandlers.clear();

    // 尝试重连（如果不是主动关闭）
    if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.attemptReconnect();
    }
  }

  /**
   * WebSocket错误事件
   * @param {Event} event 错误事件
   */
  onError(event: Event): void {
    log.error('AI WebSocket错误', event);
  }

  /**
   * 路由消息到处理器
   * @param {Object} message 消息对象
   */
  routeMessage(message: any): void {
    const { type, requestId } = message;

    // 对于连接确认消息，不需要处理器
    if (type === 'ai_connected') {
      log.debug('收到AI连接确认消息');
      return;
    }

    // 对于配置同步结果消息，不需要处理器
    if (type === 'ai_config_sync_result') {
      log.debug('收到AI配置同步结果', { success: message.success, message: message.message });
      return;
    }

    // 对于全局错误消息（没有requestId），直接处理
    if (type === 'ai_error' && !requestId) {
      log.error('收到AI服务全局错误', message);
      return;
    }

    const handler = this.messageHandlers.get(requestId);

    if (!handler) {
      log.warn('未找到消息处理器', { type, requestId });
      return;
    }

    switch (type) {
      case 'ai_stream':
        handler.onStream?.(message);
        break;

      case 'ai_done':
        handler.onDone?.(message);
        break;

      case 'ai_error':
        handler.onError?.(message);
        break;

      case 'ai_cancelled':
        handler.onCancel?.(message);
        break;

      case 'ai_config_test_result':
        // 配置测试结果需要特殊处理
        if (message.success) {
          handler.onDone?.({
            success: true,
            message: message.message,
            metadata: { testResult: true }
          });
        } else {
          handler.onError?.({
            error: { message: message.message }
          });
        }
        break;

      default:
        log.warn('未知的AI消息类型', { type, requestId });
    }
  }

  /**
   * 尝试重连
   */
  async attemptReconnect(): Promise<void> {
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    log.info(`尝试重连AI服务 (${this.reconnectAttempts}/${this.maxReconnectAttempts})`, { delay });

    setTimeout(async () => {
      try {
        await this.connect(this.config);
        log.info('AI服务重连成功');
      } catch (error: unknown) {
        log.error('AI服务重连失败', error as any);

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          log.error('AI服务重连次数已达上限，停止重连');
        }
      }
    }, delay);
  }

  /**
   * 获取用户ID
   * @returns {string} 用户ID
   */
  getUserId(): string {
    try {
      // 优先从统一存储中获取（由 userStore.setUserInfo 写入）
      const currentUserRaw = storageService.getItem('currentUser', null);
      if (currentUserRaw) {
        const u = typeof currentUserRaw === 'string' ? JSON.parse(currentUserRaw) : currentUserRaw;
        if (u && (u.id || u.userId)) return String(u.id || u.userId);
      }
    } catch (_) {}

    try {
      // 退化读取 localStorage 兼容字段
      const userInfo = JSON.parse(localStorage.getItem('user') || '{}');
      if (userInfo && userInfo.id) return String(userInfo.id);
    } catch (_) {}

    return 'anonymous';
  }

  /**
   * 获取会话ID
   * @returns {string} 会话ID
   */
  getSessionId(): string {
    // 生成或获取会话ID
    let sessionId = sessionStorage.getItem('ai-session-id');
    if (!sessionId) {
      sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      sessionStorage.setItem('ai-session-id', sessionId);
    }
    return sessionId;
  }

  /**
   * 检查是否已连接
   * @returns {boolean} 连接状态
   */
  isConnected(): boolean {
    return !!(this.connected && this.ws && this.ws.readyState === WebSocket.OPEN);
  }

  /**
   * 获取连接状态
   * @returns {Object} 连接状态信息
   */
  getConnectionStatus(): { connected: boolean; reconnectAttempts: number; maxReconnectAttempts: number; activeHandlers: number } {
    return {
      connected: this.connected,
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: this.maxReconnectAttempts,
      activeHandlers: this.messageHandlers.size
    };
  }

  /**
   * 发送配置到后端
   */
  sendConfigToBackend(): void {
    if (!this.connected || !this.config) {
      return;
    }

    // 仅当前端持有完整且有效的配置时才同步到后端，避免用空值覆盖后端已存储的配置
    const hasFullConfig =
      this.config.apiKey && this.config.baseUrl && this.config.model;
    if (!hasFullConfig) return;

    try {
      // 发送配置到后端，让后端存储用户的API配置
      this.send({
        type: 'ai_config_sync',
        config: {
          provider: this.config.provider,
          baseUrl: this.config.baseUrl,
          model: this.config.model,
          apiKey: this.config.apiKey,
          temperature: this.config.temperature,
          maxTokens: this.config.maxTokens,
          timeout: this.config.timeout
        },
        userId: this.getUserId(),
        timestamp: new Date().toISOString()
      });

      log.debug('AI配置已发送到后端');
    } catch (error) {
      log.error('发送AI配置到后端失败', error);
    }
  }
}

export default AIClient;
