/**
 * AI HTTP API服务
 * 提供直接的HTTP API调用，用于简单操作如API测试
 */

import apiService from '../api'
import log from '../log'

class AIApiService {
  constructor() {
    this.baseUrl = '/ai'  // 移除 /api 前缀，因为 apiService 已经包含了
    log.debug('AI API服务已初始化')
  }

  /**
   * 测试API连接 - 使用HTTP请求而非WebSocket
   * @param {Object} config API配置
   * @returns {Promise<Object>} 测试结果
   */
  async testConnection(config) {
    try {
      // 验证必要参数
      if (!config.model) {
        return {
          success: false,
          valid: false,
          message: '请输入AI模型名称'
        }
      }

      const response = await apiService.post(`${this.baseUrl}/test-connection?t=${Date.now()}`, {
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model // 移除默认值，要求用户必须提供
      })

      if (response.success) {
        log.info('API连接测试成功', {
          model: response.data?.model
        })

        return {
          success: true,
          valid: true,
          message: response.message,
          data: response.data
        }
      } else {
        log.warn('API连接测试失败', {
          message: response.message
        })

        return {
          success: false,
          valid: false,
          message: response.message
        }
      }

    } catch (error) {
      log.error('API连接测试失败', {
        error: error.message
      })

      // 解析错误信息
      let errorMessage = '连接测试失败'
      if (error.response?.data?.message) {
        errorMessage = error.response.data.message
      } else if (error.message) {
        errorMessage = error.message
      }

      return {
        success: false,
        valid: false,
        message: errorMessage
      }
    }
  }

  /**
   * 获取AI服务状态
   * @returns {Promise<Object>} 服务状态
   */
  async getStatus() {
    try {
      const response = await apiService.get(`${this.baseUrl}/status`)
      return response.data
    } catch (error) {
      log.error('获取AI服务状态失败', error)
      throw error
    }
  }

  /**
   * 验证API配置格式
   * @param {Object} config API配置
   * @returns {Object} 验证结果
   */
  validateConfig(config) {
    const errors = []

    if (!config.baseUrl) {
      errors.push('API地址不能为空')
    } else {
      try {
        new URL(config.baseUrl)
      } catch (e) {
        errors.push('API地址格式无效')
      }
    }

    if (!config.apiKey) {
      errors.push('API密钥不能为空')
    } else if (config.apiKey.length < 10) {
      errors.push('API密钥长度过短')
    }

    if (config.model && typeof config.model !== 'string') {
      errors.push('模型名称格式无效')
    }

    return {
      valid: errors.length === 0,
      errors
    }
  }

  /**
   * 获取支持的模型列表
   * @returns {Array} 模型列表
   */
  getSupportedModels() {
    return [
      'gpt-4o-mini',
      'gpt-4o', 
      'gpt-4-turbo',
      'gpt-3.5-turbo'
    ]
  }

  /**
   * 获取支持的功能列表
   * @returns {Array} 功能列表
   */
  getSupportedFeatures() {
    return [
      'completion',    // 智能补全
      'explanation',   // 输出解释
      'fix',          // 错误修复
      'generation'    // 脚本生成
    ]
  }
}

// 创建单例实例
const aiApiService = new AIApiService()

export default aiApiService
