/**
 * AI配置管理器
 * 负责AI配置的存储、加载和验证
 */

import log from '../log'
import storageAdapter from '../storage-adapter'

class AIConfig {
  constructor() {
    this.storageKey = 'ai-config'
    this.config = this.getDefaultConfig()
    this.initialized = false

    log.debug('AI配置管理器已初始化')
  }

  /**
   * 初始化存储服务
   */
  async initStorage() {
    if (this.initialized) {
      return // 避免重复初始化
    }

    try {
      await storageAdapter.init()

      this.initialized = true
      log.debug('AI配置存储服务初始化完成')
    } catch (error) {
      log.error('AI配置存储服务初始化失败', error)
    }
  }



  /**
   * 获取默认配置
   * @returns {Object} 默认配置
   */
  getDefaultConfig() {
    return {
      enabled: false,
      provider: 'openai', // 固定为OpenAI兼容格式
      baseUrl: 'https://api.openai.com', // 默认OpenAI官方API，但可修改
      apiKey: '',
      model: '', // 移除默认模型，要求用户手动输入
      features: {
        chat: true,    // Chat模式 - 自由对话交流
        agent: true    // Agent模式 - 智能助手分析
      }
    }
  }

  /**
   * 加载配置
   * @returns {Promise<Object>} 配置对象
   */
  async load() {
    try {
      // 确保存储服务已初始化
      await this.initStorage()

      const saved = await storageAdapter.get(this.storageKey)
      if (saved) {
        // 合并默认配置和保存的配置
        this.config = this.mergeConfig(this.getDefaultConfig(), saved)

        log.debug('AI配置已加载')
      }

      return this.config
    } catch (error) {
      log.error('加载AI配置失败', error)
      this.config = this.getDefaultConfig()
      return this.config
    }
  }

  /**
   * 保存配置
   * @param {Object} newConfig 新配置
   * @returns {Promise<boolean>} 是否保存成功
   */
  async save(newConfig) {
    try {
      // 验证配置
      const validation = this.validate(newConfig)
      if (!validation.valid) {
        throw new Error(validation.error)
      }

      // 合并配置
      this.config = this.mergeConfig(this.config, newConfig)

      // 保存到统一存储服务
      await storageAdapter.set(this.storageKey, this.config)

      log.debug('AI配置已保存', {
        enabled: this.config.enabled,
        provider: this.config.provider,
        model: this.config.model
      })

      return true
    } catch (error) {
      log.error('保存AI配置失败', error)
      throw error
    }
  }

  /**
   * 获取配置值
   * @param {string} key 配置键，支持点号分隔的嵌套键
   * @param {*} defaultValue 默认值
   * @returns {*} 配置值
   */
  get(key, defaultValue = null) {
    try {
      const keys = key.split('.')
      let value = this.config
      
      for (const k of keys) {
        if (value && typeof value === 'object' && k in value) {
          value = value[k]
        } else {
          return defaultValue
        }
      }
      
      return value
    } catch (error) {
      log.error('获取配置值失败', { key, error })
      return defaultValue
    }
  }

  /**
   * 设置配置值
   * @param {string} key 配置键
   * @param {*} value 配置值
   */
  set(key, value) {
    try {
      const keys = key.split('.')
      let target = this.config
      
      // 导航到目标对象
      for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i]
        if (!target[k] || typeof target[k] !== 'object') {
          target[k] = {}
        }
        target = target[k]
      }
      
      // 设置值
      target[keys[keys.length - 1]] = value
      
      log.debug('配置值已设置', { key, value })
    } catch (error) {
      log.error('设置配置值失败', { key, value, error })
    }
  }

  /**
   * 重置为默认配置
   */
  async reset() {
    this.config = this.getDefaultConfig()
    await storageAdapter.remove(this.storageKey)
    log.info('AI配置已重置为默认值')
  }

  /**
   * 验证配置
   * @param {Object} config 配置对象
   * @returns {Object} 验证结果
   */
  validate(config) {
    try {
      if (!config || typeof config !== 'object') {
        return { valid: false, error: '配置必须是对象' }
      }

      // 验证必需字段
      if (config.enabled && !config.apiKey) {
        return { valid: false, error: '启用AI时必须提供API密钥' }
      }

      if (config.baseUrl) {
        try {
          new URL(config.baseUrl)
        } catch {
          return { valid: false, error: 'Base URL格式无效' }
        }
      }

      // 验证数值范围
      if (config.temperature !== undefined) {
        if (typeof config.temperature !== 'number' || config.temperature < 0 || config.temperature > 2) {
          return { valid: false, error: 'Temperature必须在0-2之间' }
        }
      }

      if (config.maxTokens !== undefined) {
        if (typeof config.maxTokens !== 'number' || config.maxTokens < 1 || config.maxTokens > 4096) {
          return { valid: false, error: 'MaxTokens必须在1-4096之间' }
        }
      }

      if (config.timeout !== undefined) {
        if (typeof config.timeout !== 'number' || config.timeout < 1000 || config.timeout > 120000) {
          return { valid: false, error: 'Timeout必须在1000-120000毫秒之间' }
        }
      }

      // 验证自定义请求头
      if (config.customHeaders) {
        try {
          JSON.parse(config.customHeaders)
        } catch {
          return { valid: false, error: '自定义请求头必须是有效的JSON格式' }
        }
      }

      // 验证代理URL格式
      if (config.proxyUrl) {
        try {
          new URL(config.proxyUrl)
        } catch {
          return { valid: false, error: '代理URL格式无效' }
        }
      }

      // 验证UI配置
      if (config.ui) {
        if (config.ui.idleDelay !== undefined) {
          if (typeof config.ui.idleDelay !== 'number' || config.ui.idleDelay < 100 || config.ui.idleDelay > 2000) {
            return { valid: false, error: '补全延迟必须在100-2000毫秒之间' }
          }
        }
      }

      // 验证安全配置
      if (config.security) {
        if (config.security.maxContextLines !== undefined) {
          if (typeof config.security.maxContextLines !== 'number' || config.security.maxContextLines < 50 || config.security.maxContextLines > 500) {
            return { valid: false, error: '上下文行数必须在50-500之间' }
          }
        }
      }

      return { valid: true }
    } catch (error) {
      return { valid: false, error: error.message }
    }
  }

  /**
   * 合并配置对象
   * @param {Object} target 目标配置
   * @param {Object} source 源配置
   * @returns {Object} 合并后的配置
   */
  mergeConfig(target, source) {
    const result = { ...target }
    
    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          result[key] = this.mergeConfig(result[key] || {}, source[key])
        } else {
          result[key] = source[key]
        }
      }
    }
    
    return result
  }

  /**
   * 获取安全的配置（不包含敏感信息）
   * @returns {Object} 安全的配置对象
   */
  getSafeConfig() {
    const safeConfig = { ...this.config }
    
    // 移除敏感信息
    if (safeConfig.apiKey) {
      safeConfig.apiKey = '***' + safeConfig.apiKey.slice(-4)
    }
    
    return safeConfig
  }

  /**
   * 导出配置
   * @param {boolean} includeSensitive 是否包含敏感信息
   * @returns {string} JSON格式的配置
   */
  export(includeSensitive = false) {
    const config = includeSensitive ? this.config : this.getSafeConfig()
    return JSON.stringify(config, null, 2)
  }

  /**
   * 导入配置
   * @param {string} configJson JSON格式的配置
   * @returns {Promise<boolean>} 是否导入成功
   */
  async import(configJson) {
    try {
      const importedConfig = JSON.parse(configJson)
      await this.save(importedConfig)
      return true
    } catch (error) {
      log.error('导入配置失败', error)
      throw error
    }
  }

  /**
   * 获取支持的模型列表
   * @returns {Array} 模型列表
   */
  getSupportedModels() {
    const models = {
      openai: [
        { value: 'gpt-4o-mini', label: 'GPT-4o Mini', description: '快速且经济的模型' },
        { value: 'gpt-4o', label: 'GPT-4o', description: '最新的GPT-4模型' },
        { value: 'gpt-4', label: 'GPT-4', description: '强大的GPT-4模型' },
        { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo', description: '快速的GPT-3.5模型' }
      ],
      azure: [
        { value: 'gpt-4', label: 'GPT-4 (Azure)', description: 'Azure OpenAI GPT-4' },
        { value: 'gpt-35-turbo', label: 'GPT-3.5 Turbo (Azure)', description: 'Azure OpenAI GPT-3.5' }
      ],
      custom: [
        { value: 'custom-model', label: '自定义模型', description: '自定义API兼容模型' }
      ]
    }

    return models[this.config.provider] || models.openai
  }

  /**
   * 获取支持的提供商列表
   * @returns {Array} 提供商列表
   */
  getSupportedProviders() {
    return [
      { value: 'openai', label: 'OpenAI', description: '官方OpenAI API' },
      { value: 'azure', label: 'Azure OpenAI', description: 'Microsoft Azure OpenAI服务' },
      { value: 'custom', label: '自定义', description: '自定义OpenAI兼容API' }
    ]
  }

  /**
   * 检查功能是否启用
   * @param {string} feature 功能名称
   * @returns {boolean} 是否启用
   */
  isFeatureEnabled(feature) {
    return this.get(`features.${feature}`, false) && this.get('enabled', false)
  }

  /**
   * 获取当前配置的摘要
   * @returns {Object} 配置摘要
   */
  getSummary() {
    return {
      enabled: this.config.enabled,
      provider: this.config.provider,
      model: this.config.model,
      features: Object.keys(this.config.features).filter(key => this.config.features[key]),
      hasApiKey: !!this.config.apiKey,
      lastModified: new Date().toISOString()
    }
  }
}

export default AIConfig
