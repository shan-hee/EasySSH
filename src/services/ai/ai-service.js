/**
 * AI服务
 * 前端AI功能的核心服务类
 */

import { ElMessage } from 'element-plus'
import log from '../log'
import AIClient from './ai-client'
import AICache from './ai-cache'
import AIConfig from './ai-config'
import aiApiService from './ai-api'

class AIService {
  constructor() {
    this.client = new AIClient()
    this.cache = new AICache()
    this.config = new AIConfig()
    this.activeRequests = new Map()
    this.isEnabled = false
    this.temporarilyDisabled = true // 临时禁用AI功能

    // 不在构造函数中加载配置，等待外部调用init()
    log.debug('AI服务已初始化（临时禁用）')
  }

  /**
   * 初始化AI服务
   */
  async init() {
    try {
      // 只在这里加载配置，避免重复请求
      await this.loadConfig()
      log.debug('AI服务初始化完成')
    } catch (error) {
      log.error('AI服务初始化失败', error)
    }
  }

  /**
   * 启用AI服务
   * @param {Object} config AI配置
   * @param {boolean} saveConfig 是否保存配置（默认false，避免重复保存）
   */
  async enable(config, saveConfig = false) {
    try {
      // 验证配置
      const validation = await this.validateConfig(config)
      if (!validation.valid) {
        throw new Error(validation.error)
      }

      // 只在明确需要时才保存配置
      if (saveConfig) {
        await this.config.save(config)
      } else {
        // 更新内存中的配置，但不保存到存储
        this.config.config = this.config.mergeConfig(this.config.config, config)
      }

      // 连接AI服务
      await this.client.connect(config)

      this.isEnabled = true
      log.info('AI服务已启用', { provider: config.provider })

      // 发送AI服务状态变化事件
      this._notifyStatusChange('enabled')

      return { success: true }
    } catch (error) {
      log.error('启用AI服务失败', error)
      throw error
    }
  }

  /**
   * 禁用AI服务
   */
  async disable() {
    try {
      // 取消所有活跃请求
      this.cancelAllRequests()
      
      // 断开连接
      await this.client.disconnect()
      
      this.isEnabled = false
      log.info('AI服务已禁用')

      // 发送AI服务状态变化事件
      this._notifyStatusChange('disabled')

      return { success: true }
    } catch (error) {
      log.error('禁用AI服务失败', error)
      throw error
    }
  }



  /**
   * 请求AI交互对话
   * @param {Object} context 上下文信息
   * @param {Object} options 选项
   * @returns {Promise<Object>} 交互结果
   */
  async requestInteraction(context, options = {}) {
    if (!this.isEnabled) {
      throw new Error('AI服务未启用')
    }

    try {
      const requestId = this.generateRequestId()
      const controller = new AbortController()
      this.activeRequests.set(requestId, controller)

      try {
        const result = await this.client.sendRequest({
          type: 'ai_request',
          requestId,
          mode: 'interaction',
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
          settings: {
            model: this.config.get('model'),
            temperature: 0.7,
            maxTokens: 1024,
            stream: true
          }
        }, controller.signal)

        return result
      } finally {
        this.activeRequests.delete(requestId)
      }

    } catch (error) {
      if (error.name === 'AbortError') {
        log.debug('交互请求已取消')
        return null
      }

      log.error('AI交互请求失败', error)
      throw error
    }
  }

  /**
   * 请求智能解释
   * @param {Object} context 上下文信息
   * @param {Object} options 选项
   * @returns {Promise<Object>} 解释结果
   */
  async requestExplanation(context, options = {}) {
    if (!this.isEnabled) {
      throw new Error('AI服务未启用')
    }

    try {
      const requestId = this.generateRequestId()
      const controller = new AbortController()
      this.activeRequests.set(requestId, controller)

      try {
        const result = await this.client.sendRequest({
          type: 'ai_request',
          requestId,
          mode: 'explanation',
          input: {
            prompt: context.prompt || '',
            currentLine: context.currentLine || ''
          },
          context: {
            terminalOutput: context.terminalOutput || '',
            osHint: context.osHint || 'unknown',
            shellHint: context.shellHint || 'unknown',
            errorDetected: context.errorDetected || false
          },
          settings: {
            model: this.config.get('model'),
            temperature: 0.3,
            maxTokens: 512,
            stream: true
          }
        }, controller.signal)

        return result
      } finally {
        this.activeRequests.delete(requestId)
      }

    } catch (error) {
      if (error.name === 'AbortError') {
        log.debug('解释请求已取消')
        return null
      }
      
      log.error('智能解释请求失败', error)
      throw error
    }
  }

  /**
   * 请求命令修复
   * @param {Object} context 上下文信息
   * @param {Object} options 选项
   * @returns {Promise<Object>} 修复建议
   */
  async requestFix(context, options = {}) {
    if (!this.isEnabled) {
      throw new Error('AI服务未启用')
    }

    try {
      const requestId = this.generateRequestId()
      const controller = new AbortController()
      this.activeRequests.set(requestId, controller)

      try {
        const result = await this.client.sendRequest({
          type: 'ai_request',
          requestId,
          mode: 'fix',
          input: {
            prompt: context.prompt || '',
            currentLine: context.currentLine || ''
          },
          context: {
            terminalOutput: context.terminalOutput || '',
            osHint: context.osHint || 'unknown',
            shellHint: context.shellHint || 'unknown',
            errorDetected: true
          },
          settings: {
            model: this.config.get('model'),
            temperature: 0.2,
            maxTokens: 256,
            stream: true
          }
        }, controller.signal)

        return result
      } finally {
        this.activeRequests.delete(requestId)
      }

    } catch (error) {
      if (error.name === 'AbortError') {
        log.debug('修复请求已取消')
        return null
      }
      
      log.error('命令修复请求失败', error)
      throw error
    }
  }

  /**
   * 请求脚本生成
   * @param {Object} context 上下文信息
   * @param {Object} options 选项
   * @returns {Promise<Object>} 生成的脚本
   */
  async requestGeneration(context, options = {}) {
    if (!this.isEnabled) {
      throw new Error('AI服务未启用')
    }

    try {
      const requestId = this.generateRequestId()
      const controller = new AbortController()
      this.activeRequests.set(requestId, controller)

      try {
        const result = await this.client.sendRequest({
          type: 'ai_request',
          requestId,
          mode: 'generation',
          input: {
            prompt: context.prompt || '',
            description: context.description || ''
          },
          context: {
            terminalOutput: context.terminalOutput || '',
            osHint: context.osHint || 'unknown',
            shellHint: context.shellHint || 'unknown'
          },
          settings: {
            model: this.config.get('model'),
            temperature: 0.4,
            maxTokens: 1024,
            stream: true
          }
        }, controller.signal)

        return result
      } finally {
        this.activeRequests.delete(requestId)
      }

    } catch (error) {
      if (error.name === 'AbortError') {
        log.debug('生成请求已取消')
        return null
      }
      
      log.error('脚本生成请求失败', error)
      throw error
    }
  }

  /**
   * 测试API配置 - 使用HTTP API而非WebSocket
   * @param {Object} config 配置对象
   * @returns {Promise<Object>} 测试结果
   */
  async testConnection(config) {
    try {
      // 使用HTTP API服务进行测试
      const result = await aiApiService.testConnection(config)
      return result
    } catch (error) {
      log.error('API配置测试失败', error)
      throw error
    }
  }

  /**
   * 取消请求
   * @param {string} requestId 请求ID
   */
  cancelRequest(requestId) {
    const controller = this.activeRequests.get(requestId)
    if (controller) {
      controller.abort()
      this.activeRequests.delete(requestId)
      log.debug('AI请求已取消', { requestId })
    }
  }

  /**
   * 取消所有活跃请求
   */
  cancelAllRequests() {
    for (const [requestId, controller] of this.activeRequests.entries()) {
      controller.abort()
    }
    this.activeRequests.clear()
    log.debug('所有AI请求已取消')
  }

  /**
   * 验证配置
   * @param {Object} config 配置对象
   * @returns {Promise<Object>} 验证结果
   */
  async validateConfig(config) {
    try {
      if (!config || typeof config !== 'object') {
        return { valid: false, error: '配置对象无效' }
      }

      const requiredFields = ['apiKey', 'baseUrl']
      for (const field of requiredFields) {
        if (!config[field]) {
          return { valid: false, error: `缺少必需字段: ${field}` }
        }
      }

      // 验证URL格式
      try {
        new URL(config.baseUrl)
      } catch {
        return { valid: false, error: 'Base URL格式无效' }
      }

      // 验证API密钥格式
      if (config.apiKey.length < 10) {
        return { valid: false, error: 'API密钥格式无效' }
      }

      return { valid: true }
    } catch (error) {
      return { valid: false, error: error.message }
    }
  }

  /**
   * 加载配置
   */
  async loadConfig() {
    try {
      // 确保配置管理器已初始化
      await this.config.initStorage()

      const config = await this.config.load()
      if (config && config.enabled) {
        // 自动启用AI服务（如果配置有效）
        try {
          await this.enable(config)
        } catch (error) {
          log.warn('自动启用AI服务失败', error)
        }
      }
    } catch (error) {
      log.warn('加载AI配置失败', error)
    }
  }



  /**
   * 生成请求ID
   * @returns {string} 请求ID
   */
  generateRequestId() {
    return `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 获取服务状态
   * @returns {Object} 服务状态
   */
  getStatus() {
    return {
      enabled: this.isEnabled,
      connected: this.client.isConnected(),
      activeRequests: this.activeRequests.size,
      config: this.config.getSafeConfig() // 不包含敏感信息的配置
    }
  }

  /**
   * 通知AI服务状态变化
   * @param {string} status 状态
   */
  _notifyStatusChange(status) {
    try {
      // 发送自定义事件通知状态变化
      window.dispatchEvent(new CustomEvent('ai-service-status-change', {
        detail: { status, isEnabled: this.isEnabled }
      }))
      log.debug('AI服务状态变化通知已发送', { status })
    } catch (error) {
      log.error('发送AI服务状态变化通知失败', error)
    }
  }
}

// 创建单例实例
const aiService = new AIService()

export default aiService
