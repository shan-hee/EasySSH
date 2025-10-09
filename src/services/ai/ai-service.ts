/**
 * AI服务
 * 前端AI功能的核心服务类
 */

import log from '../log';
import { EVENTS } from '@/services/events';
import AIClient from './ai-client';
import AICache from './ai-cache';
import AIConfig from './ai-config';
import aiApiService from './ai-api';
import { useAIPanelStore } from '../../store/ai-panel';

class AIService {
  private client: AIClient;
  private cache: AICache;
  private config: AIConfig;
  private activeRequests: Map<string, AbortController>;
  private isEnabled: boolean;
  private temporarilyDisabled: boolean;
  private storageEventListener: EventListener | null;

  constructor() {
    this.client = new AIClient();
    this.cache = new AICache();
    this.config = new AIConfig();
    this.activeRequests = new Map();
    this.isEnabled = false;
    this.temporarilyDisabled = true; // 临时禁用AI功能
    this.storageEventListener = null; // 存储事件监听器引用

    // 不在构造函数中加载配置，等待外部调用init()
    log.debug('AI服务已初始化（临时禁用）');
  }

  /**
   * 初始化AI服务
   * @param {Object} options 可选项 { soft?: boolean }
   */
  async init(options: { soft?: boolean } = {}): Promise<void> {
    try {
      const soft = options?.soft === true;
      // 只在这里加载配置，避免重复请求；soft模式下不连接后端
      if (soft) {
        await this.loadConfigSoft();
      } else {
        await this.loadConfig();
      }

      // 添加存储模式变化监听器
      this.setupStorageModeListener();

      log.debug('AI服务初始化完成');
    } catch (error: unknown) {
      log.error('AI服务初始化失败', error as any);
    }
  }

  /**
   * 启用AI服务
   * @param {Object} config AI配置
   * @param {boolean} saveConfig 是否保存配置（默认false，避免重复保存）
   */
  async enable(config: any, saveConfig: boolean = false): Promise<{ success: boolean }> {
    try {
      // 验证配置
      const validation = await this.validateConfig(config);
      if (!validation.valid) {
        throw new Error(validation.error || '配置无效');
      }

      // 只在明确需要时才保存配置
      if (saveConfig) {
        await this.config.save(config);
      } else {
        // 更新内存中的配置，但不保存到存储
        this.config.config = this.config.mergeConfig(this.config.config, config);
      }

      // 连接AI服务
      await this.client.connect(config);

      this.isEnabled = true;
      log.info('AI服务已启用', { provider: config.provider });

      // 发送AI服务状态变化事件
      this._notifyStatusChange('enabled');

      return { success: true };
    } catch (error: unknown) {
      log.error('启用AI服务失败', error as any);
      throw error as any;
    }
  }

  /**
   * 启用AI服务（后端托管配置模式）
   * 不校验或下发前端配置，仅建立WS连接并依靠后端KeyVault配置。
   */
  async enableBackendManaged(): Promise<{ success: boolean }> {
    try {
      await this.client.connect({});
      this.isEnabled = true;
      log.info('AI服务已启用（后端托管配置）');
      this._notifyStatusChange('enabled');
      return { success: true };
    } catch (error: unknown) {
      log.error('启用AI服务失败（后端托管配置）', error as any);
      throw error as any;
    }
  }

  /**
   * 禁用AI服务
   */
  async disable(): Promise<{ success: boolean }> {
    try {
      // 取消所有活跃请求
      this.cancelAllRequests();

      // 断开连接
      await this.client.disconnect();

      this.isEnabled = false;
      log.info('AI服务已禁用');

      // 发送AI服务状态变化事件
      this._notifyStatusChange('disabled');

      return { success: true };
    } catch (error: unknown) {
      log.error('禁用AI服务失败', error as any);
      throw error as any;
    }
  }

  /**
   * Chat模式 - 自由对话交流
   * @param {Object} context 上下文信息
   * @param {Object} options 选项
   * @returns {Promise<Object>} 对话结果
   */
  async requestChat(context: any, _options: any = {}): Promise<any | null> {
    if (!this.isEnabled) {
      throw new Error('AI服务未启用');
    }

    try {
      const requestId = this.generateRequestId();
      const controller = new AbortController();
      this.activeRequests.set(requestId, controller);

      try {
        const chatSettings: any = {
          temperature: 0.7, // 较高温度，更有创造性
          maxTokens: 1024, // 较多token，支持详细回答
          stream: true
        };
        const cfgModel = this.config.get('model');
        if (cfgModel) chatSettings.model = cfgModel;

        const result = await this.client.sendRequest(
          {
            type: 'ai_request',
            requestId,
            mode: 'chat',
            input: {
              prompt: context.prompt || '',
              question: context.question || '',
              currentLine: context.currentLine || ''
            },
            context: {
              terminalOutput: context.terminalOutput || '',
              osHint: context.osHint || 'unknown',
              shellHint: context.shellHint || 'unknown'
            },
            settings: chatSettings
          },
          controller.signal
        );

        return result;
      } finally {
        this.activeRequests.delete(requestId);
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        log.debug('Chat请求已取消');
        return null;
      }

      log.error('Chat模式请求失败', error as any);
      throw error as any;
    }
  }

  /**
   * Agent模式 - 智能助手分析
   * @param {Object} context 上下文信息
   * @param {Object} options 选项
   * @returns {Promise<Object>} 分析结果
   */
  async requestAgent(context: any, _options: any = {}): Promise<any | null> {
    if (!this.isEnabled) {
      throw new Error('AI服务未启用');
    }

    try {
      const requestId = this.generateRequestId();
      const controller = new AbortController();
      this.activeRequests.set(requestId, controller);

      try {
        const agentSettings: any = {
          temperature: 0.3, // 较低温度，更准确
          maxTokens: 512, // 适中token，专注于具体建议
          stream: true
        };
        const cfgModel2 = this.config.get('model');
        if (cfgModel2) agentSettings.model = cfgModel2;

        const result = await this.client.sendRequest(
          {
            type: 'ai_request',
            requestId,
            mode: 'agent',
            input: {
              prompt: context.prompt || '',
              operationType: context.operationType || 'auto',
              currentLine: context.currentLine || ''
            },
            context: {
              terminalOutput: context.terminalOutput || '',
              osHint: context.osHint || 'unknown',
              shellHint: context.shellHint || 'unknown',
              errorDetected: context.errorDetected || false
            },
            settings: agentSettings
          },
          controller.signal
        );

        return result;
      } finally {
        this.activeRequests.delete(requestId);
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        log.debug('Agent请求已取消');
        return null;
      }

      log.error('Agent模式请求失败', error as any);
      throw error as any;
    }
  }

  /**
   * 请求AI交互对话 (兼容方法，路由到Chat模式)
   * @param {Object} context 上下文信息
   * @param {Object} options 选项
   * @returns {Promise<Object>} 交互结果
   */
  async requestInteraction(context: any, _options: any = {}): Promise<any | null> {
    log.debug('使用兼容方法requestInteraction，路由到Chat模式');
    return await this.requestChat(context, _options);
  }

  /**
   * 请求智能解释 (兼容方法，路由到Agent模式)
   * @param {Object} context 上下文信息
   * @param {Object} options 选项
   * @returns {Promise<Object>} 解释结果
   */
  async requestExplanation(context: any, _options: any = {}): Promise<any | null> {
    log.debug('使用兼容方法requestExplanation，路由到Agent模式');
    const agentContext = {
      ...context,
      operationType: 'explanation'
    };
    return await this.requestAgent(agentContext, _options);
  }

  /**
   * 请求命令修复 (兼容方法，路由到Agent模式)
   * @param {Object} context 上下文信息
   * @param {Object} options 选项
   * @returns {Promise<Object>} 修复建议
   */
  async requestFix(context: any, _options: any = {}): Promise<any | null> {
    log.debug('使用兼容方法requestFix，路由到Agent模式');
    const agentContext = {
      ...context,
      operationType: 'fix',
      errorDetected: true
    };
    return await this.requestAgent(agentContext, _options);
  }

  /**
   * 请求脚本生成 (兼容方法，路由到Agent模式)
   * @param {Object} context 上下文信息
   * @param {Object} options 选项
   * @returns {Promise<Object>} 生成的脚本
   */
  async requestGeneration(context: any, _options: any = {}): Promise<any | null> {
    log.debug('使用兼容方法requestGeneration，路由到Agent模式');
    const agentContext = {
      ...context,
      operationType: 'generation'
    };
    return await this.requestAgent(agentContext, _options);
  }

  /**
   * 测试API配置 - 使用HTTP API而非WebSocket
   * @param {Object} config 配置对象
   * @returns {Promise<Object>} 测试结果
   */
  async testConnection(config: { baseUrl?: string; apiKey?: string; model: string }): Promise<any> {
    try {
      // 使用HTTP API服务进行测试
      const result = await aiApiService.testConnection(config);
      return result;
    } catch (error: unknown) {
      log.error('API配置测试失败', error as any);
      throw error as any;
    }
  }

  /**
   * 取消请求
   * @param {string} requestId 请求ID
   */
  cancelRequest(requestId: string): void {
    const controller = this.activeRequests.get(requestId);
    if (controller) {
      controller.abort();
      this.activeRequests.delete(requestId);
      log.debug('AI请求已取消', { requestId });
    }
  }

  /**
   * 取消所有活跃请求
   */
  cancelAllRequests(): void {
    for (const [_requestId, controller] of this.activeRequests.entries()) {
      controller.abort();
    }
    this.activeRequests.clear();
    log.debug('所有AI请求已取消');
  }

  /**
   * 验证配置
   * @param {Object} config 配置对象
   * @returns {Promise<Object>} 验证结果
   */
  async validateConfig(config: any): Promise<{ valid: boolean; error?: string }> {
    try {
      if (!config || typeof config !== 'object') {
        return { valid: false, error: '配置对象无效' };
      }

      const requiredFields = ['apiKey', 'baseUrl'];
      for (const field of requiredFields) {
        if (!config[field]) {
          return { valid: false, error: `缺少必需字段: ${field}` };
        }
      }

      // 验证URL格式
      try {
        new URL(config.baseUrl);
      } catch {
        return { valid: false, error: 'Base URL格式无效' };
      }

      // 验证API密钥格式
      if (typeof config.apiKey !== 'string' || config.apiKey.length < 10) {
        return { valid: false, error: 'API密钥格式无效' };
      }

      return { valid: true };
    } catch (error: any) {
      return { valid: false, error: error?.message };
    }
  }

  /**
   * 加载配置
   */
  async loadConfig(): Promise<void> {
    try {
      // 确保配置管理器已初始化
      await this.config.initStorage();

      const config = await this.config.load();
      if (config && config.enabled) {
        // 自动启用AI服务（如果配置有效）
        try {
          await this.enable(config);
        } catch (error: unknown) {
          log.warn('自动启用AI服务失败', error as any);
        }
      }
    } catch (error: unknown) {
      log.warn('加载AI配置失败', error as any);
    }
  }

  /**
   * 软加载配置：不进行任何网络连接到AI后端，不自动启用
   */
  async loadConfigSoft(): Promise<void> {
    try {
      await this.config.initStorage();
      if (typeof this.config.loadSoft === 'function') {
        await this.config.loadSoft();
      } else {
        // 回退：正常load但不自动enable（避免启用）
        const cfg = await this.config.load();
        // 显式不自动开启
        if (cfg && cfg.enabled) {
          log.debug('软加载模式：检测到已启用配置，但不自动连接');
        }
      }
    } catch (error: unknown) {
      log.warn('软加载AI配置失败', error as any);
    }
  }

  /**
   * 设置存储模式变化监听器
   */
  setupStorageModeListener(): void {
    // 如果已经设置过监听器，先移除
    if (this.storageEventListener) {
      window.removeEventListener('storage-mode-changed', this.storageEventListener);
    }

    // 创建事件处理函数
    this.storageEventListener = ((e: Event) => {
      this.handleStorageModeChange(e as CustomEvent).catch(() => {});
    }) as EventListener;

    // 添加事件监听器
    window.addEventListener('storage-mode-changed', this.storageEventListener!);

    log.debug('AI服务存储模式变化监听器已设置');
  }

  /**
   * 处理存储模式变化事件
   * @param {CustomEvent} event 存储模式变化事件
   */
  async handleStorageModeChange(event: CustomEvent): Promise<void> {
    try {
      const { mode, isLoggedIn, user } = (event as any).detail || {};

      log.debug('AI服务收到存储模式变化事件', { mode, isLoggedIn, username: user?.username });

      if (isLoggedIn && mode === 'server') {
        // 用户登录，切换到服务器存储模式，重新加载配置
        log.info('用户登录，重新加载AI服务配置');
        await this.reloadConfig();
      } else if (!isLoggedIn && mode === 'local') {
        // 用户登出，切换到本地存储模式
        log.info('用户登出，AI服务切换到本地模式');
        // 可以选择禁用AI服务或保持当前状态
        // 这里选择保持当前状态，因为本地也可能有AI配置
      }
    } catch (error: unknown) {
      log.error('处理存储模式变化事件失败', error as any);
    }
  }

  /**
   * 重新加载配置
   * 与loadConfig类似，但会记录重新加载的日志
   */
  async reloadConfig(): Promise<void> {
    try {
      // 确保配置管理器已初始化
      await this.config.initStorage();

      const config = await this.config.load();
      if (config && config.enabled) {
        // 自动启用AI服务（如果配置有效）
        try {
          await this.enable(config);
          log.info('AI服务配置重新加载并启用成功', { provider: config.provider });
        } catch (error: unknown) {
          log.warn('重新启用AI服务失败', error as any);
        }
      } else {
        log.debug('重新加载的AI配置未启用或无效');
      }
    } catch (error: unknown) {
      log.warn('重新加载AI配置失败', error as any);
    }
  }

  /**
   * 生成请求ID
   * @returns {string} 请求ID
   */
  generateRequestId(): string {
    return `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 获取服务状态
   * @returns {Object} 服务状态
   */
  getStatus(): { enabled: boolean; connected: boolean; activeRequests: number; hasConfig: boolean; config: any } {
    return {
      enabled: this.isEnabled,
      connected: this.client.isConnected(),
      activeRequests: this.activeRequests.size,
      hasConfig: this.hasValidConfig(),
      config: this.config.getSafeConfig() // 不包含敏感信息的配置
    };
  }

  /**
   * 通知AI服务状态变化
   * @param {string} status 状态
   */
  _notifyStatusChange(status: string): void {
    try {
      // 发送自定义事件通知状态变化（使用常量）
      window.dispatchEvent(
        new CustomEvent(EVENTS.AI_SERVICE_STATUS_CHANGE, {
          detail: { status, isEnabled: this.isEnabled }
        })
      );
      log.debug('AI服务状态变化通知已发送', { status });
    } catch (error: unknown) {
      log.error('发送AI服务状态变化通知失败', error as any);
    }
  }

  /**
   * 是否存在有效配置（不泄露敏感信息，仅做基本校验）
   */
  hasValidConfig(): boolean {
    try {
      const cfg = this.config?.config || {};
      if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) return false;
      try {
        new URL(cfg.baseUrl);
      } catch {
        return false;
      }
      if (typeof cfg.apiKey !== 'string' || cfg.apiKey.length < 10) return false;
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * 确保已连接到AI后端（在已启用前提下）
   */
  async ensureConnected(): Promise<boolean> {
    if (!this.isEnabled) return false;
    if (this.client.isConnected()) return true;
    try {
      await this.client.connect(this.config.config);
      return true;
    } catch (e: unknown) {
      log.warn('确保AI连接失败', e as any);
      return false;
    }
  }

  // ===== AI面板集成方法 =====

  /**
   * 发送消息到AI面板
   * @param {string} terminalId 终端ID
   * @param {Object} message 消息对象
   */
  async sendToPanel(terminalId: string, message: any): Promise<void> {
    try {
      const aiPanelStore = useAIPanelStore();
      aiPanelStore.addMessage(terminalId, message);

      // 只对重要消息类型记录日志，减少日志噪音
      if (
        message.type === 'user' ||
        (message.type === 'assistant' && !message.content?.includes('...'))
      ) {
        log.debug('消息已发送到AI面板', { terminalId, messageType: message.type });
      }
    } catch (error: any) {
      log.error('发送消息到AI面板失败', { error: error?.message, terminalId });
    }
  }

  /**
   * 处理AI响应并发送到面板
   * @param {string} terminalId 终端ID
   * @param {string} userMessage 用户消息
   * @param {Object} response AI响应
   */
  async handleResponseForPanel(terminalId: string, userMessage: string, response: any): Promise<void> {
    try {
      // 添加用户消息
      if (userMessage) {
        await this.sendToPanel(terminalId, {
          type: 'user',
          content: userMessage,
          timestamp: Date.now()
        });
      }

      // 添加AI响应
      if (response.success) {
        await this.sendToPanel(terminalId, {
          type: 'assistant',
          content: response.content,
          timestamp: Date.now(),
          metadata: {
            model: response.model,
            tokens: response.tokens,
            duration: response.duration
          }
        });
      } else {
        await this.sendToPanel(terminalId, {
          type: 'system',
          content: `❌ AI响应失败: ${response.error || '未知错误'}`,
          timestamp: Date.now(),
          status: 'error'
        });
      }
    } catch (error: any) {
      log.error('处理AI响应到面板失败', { error: error?.message, terminalId });
    }
  }

  /**
   * 清空终端的AI面板历史
   * @param {string} terminalId 终端ID
   */
  clearPanelHistory(terminalId: string): void {
    try {
      const aiPanelStore = useAIPanelStore();
      aiPanelStore.clearMessages(terminalId);
    } catch (error: any) {
      log.error('清空AI面板历史失败', { error: error?.message, terminalId });
    }
  }

  /**
   * 获取AI面板状态
   * @param {string} terminalId 终端ID
   * @returns {Object} 面板状态信息
   */
  async getPanelStatus(terminalId: string): Promise<{ isVisible: boolean; messageCount: number; height: number; hasUnread: boolean }> {
    try {
      const aiPanelStore = useAIPanelStore();

      return {
        isVisible: aiPanelStore.isPanelVisible(terminalId),
        messageCount: aiPanelStore.getMessages(terminalId).length,
        height: aiPanelStore.getPanelHeight(terminalId),
        hasUnread: aiPanelStore.getMessages(terminalId).some(msg => msg.unread)
      };
    } catch (error: any) {
      log.error('获取AI面板状态失败', { error: error?.message, terminalId });
      return {
        isVisible: false,
        messageCount: 0,
        height: 250,
        hasUnread: false
      };
    }
  }

  /**
   * 销毁AI服务
   * 清理所有资源和事件监听器
   */
  destroy(): void {
    try {
      // 移除存储模式变化监听器
      if (this.storageEventListener) {
        window.removeEventListener('storage-mode-changed', this.storageEventListener);
        this.storageEventListener = null;
        log.debug('AI服务存储模式变化监听器已移除');
      }

      // 取消所有活跃请求
      this.cancelAllRequests();

      // 断开客户端连接
      if (this.client) {
        this.client.disconnect().catch((error: unknown) => {
          log.warn('断开AI客户端连接失败', error as any);
        });
      }

      // 重置状态
      this.isEnabled = false;
      this.temporarilyDisabled = true;

      log.debug('AI服务已销毁');
    } catch (error: unknown) {
      log.error('销毁AI服务失败', error as any);
    }
  }
}

// 创建单例实例
const aiService = new AIService();

export default aiService;
