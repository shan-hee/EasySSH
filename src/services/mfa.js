import CryptoJS from 'crypto-js'
import apiService from './api'
import log from './log'

/**
 * 多因素认证服务
 */
class MfaService {
  constructor() {
    this.allowedChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567' // Base32字符集
  }

  /**
   * 生成安全的随机MFA密钥
   * @param {number} length - 密钥长度，默认16个字符
   * @returns {string} - 生成的随机密钥
   */
  generateSecretKey(length = 16) {
    let key = ''
    const allowedChars = this.allowedChars
    
    // 使用密码学安全的随机数生成
    const randomValues = new Uint8Array(length)
    
    // 尝试使用Web Crypto API (如果可用)
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(randomValues)
    } else {
      // 回退到Math.random (不够安全，但为了兼容)
      for (let i = 0; i < length; i++) {
        randomValues[i] = Math.floor(Math.random() * 256)
      }
    }
    
    // 基于随机值生成Base32字符串
    for (let i = 0; i < length; i++) {
      const randomIndex = randomValues[i] % allowedChars.length
      key += allowedChars[randomIndex]
    }
    
    return key
  }

  /**
   * 生成TOTP URI用于QR码生成
   * @param {string} secret - 密钥
   * @param {string} username - 用户名/账户标识
   * @param {string} issuer - 发行者/应用名称
   * @returns {string} - 完整的otpauth URI
   */
  generateOtpAuthUri(secret, username = 'user@easyssh.com', issuer = 'EasySSH') {
    return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(username)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
  }

  /**
   * 生成QR码URL
   * @param {string} otpAuthUri - TOTP URI
   * @param {number} size - QR码尺寸
   * @returns {string} - QR码生成URL
   */
  generateQrCodeUrl(otpAuthUri, size = 200) {
    return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(otpAuthUri)}`
  }

  /**
   * 生成当前时间的TOTP验证码
   * @param {string} secret - Base32编码的密钥
   * @returns {string} - 6位数字验证码
   */
  generateTOTP(secret) {
    try {
      if (!secret) {
        log.error('生成TOTP失败：密钥为空')
        return null
      }
      
      // 标准化密钥（移除空格和破折号）
      secret = secret.replace(/\s|-/g, '').toUpperCase()
      
      // 将Base32密钥解码为字节数组
      const keyBytes = this._decodeBase32ToBytes(secret)
      if (!keyBytes) {
        log.error('Base32解码失败')
        return null
      }
      
      // 获取当前UNIX时间（秒）
      const now = Math.floor(Date.now() / 1000)
      
      // 获取当前30秒时间窗口（除以30，取整）
      const time = Math.floor(now / 30)
      
      // 将时间转换为8字节的大端字节数组
      const timeBytes = new Uint8Array(8)
      let value = time
      for (let i = 7; i >= 0; i--) {
        timeBytes[i] = value & 0xff
        value = value >> 8
      }
      
      // 计算HMAC-SHA1
      const hmacResult = this._hmacSha1(keyBytes, timeBytes)
      if (!hmacResult) {
        log.error('HMAC计算失败')
        return null
      }
      
      // 从HMAC结果中获取4字节动态截断值
      const offset = hmacResult[hmacResult.length - 1] & 0x0f
      
      // 从偏移量开始取4字节，转换为31位整数（最高位被屏蔽）
      let code = (
        ((hmacResult[offset] & 0x7f) << 24) | 
        ((hmacResult[offset + 1] & 0xff) << 16) | 
        ((hmacResult[offset + 2] & 0xff) << 8) | 
        (hmacResult[offset + 3] & 0xff)
      )
      
      // 将结果截断为6位数字
      code = code % 1000000
      
      // 如果结果不足6位，前面补0
      return code.toString().padStart(6, '0')
    } catch (error) {
      log.error('生成TOTP验证码失败', error)
      return null
    }
  }

  /**
   * 验证TOTP码是否正确
   * @param {string} userCode - 用户输入的验证码
   * @param {string} secret - 密钥
   * @param {number} window - 验证窗口大小，默认5（当前窗口±5）
   * @returns {boolean} - 验证结果
   */
  verifyTOTP(userCode, secret, window = 5) {
    if (!userCode || !secret) {
      log.warn('验证码或密钥为空')
      return false
    }
    
    // 标准化输入
    userCode = userCode.replace(/\s/g, '')
    secret = secret.replace(/\s|-/g, '').toUpperCase()
    
    if (userCode.length !== 6 || !/^\d+$/.test(userCode)) {
      log.warn('验证码格式无效')
      return false
    }
    
    // 获取当前时间片
    const currentTime = Math.floor(Date.now() / 1000)
    const currentWindow = Math.floor(currentTime / 30)
    
    // 在验证窗口内验证
    for (let i = -window; i <= window; i++) {
      const testWindow = currentWindow + i
      
      try {
        // 将时间转换为8字节的大端字节数组
        const timeBytes = new Uint8Array(8)
        let value = testWindow
        for (let j = 7; j >= 0; j--) {
          timeBytes[j] = value & 0xff
          value = value >> 8
        }
        
        // 将Base32密钥解码为字节数组
        const keyBytes = this._decodeBase32ToBytes(secret)
        if (!keyBytes) continue
        
        // 计算HMAC-SHA1
        const hmacResult = this._hmacSha1(keyBytes, timeBytes)
        if (!hmacResult) continue
        
        // 从HMAC结果中获取4字节动态截断值
        const offset = hmacResult[hmacResult.length - 1] & 0x0f
        
        // 从偏移量开始取4字节，转换为31位整数（最高位被屏蔽）
        let code = (
          ((hmacResult[offset] & 0x7f) << 24) | 
          ((hmacResult[offset + 1] & 0xff) << 16) | 
          ((hmacResult[offset + 2] & 0xff) << 8) | 
          (hmacResult[offset + 3] & 0xff)
        )
        
        // 将结果截断为6位数字
        code = code % 1000000
        
        // 如果结果不足6位，前面补0
        const codeForThisWindow = code.toString().padStart(6, '0')
        
        // 验证码匹配
        if (codeForThisWindow === userCode) {
          return true
        }
      } catch (error) {
        log.error(`验证TOTP码失败 [窗口: ${i}]`, error)
      }
    }
    
    return false
  }

  /**
   * 启用MFA
   * @param {string} secret - MFA密钥
   * @param {string} code - 验证码
   * @returns {Promise<Object>} - 启用结果
   */
  async enableMfa(secret, code) {
    try {
      // 首先在本地验证码是否有效
      const isValid = this.verifyTOTP(code, secret)
      
      if (!isValid) {
        return {
          success: false,
          message: '验证码无效，请检查您的输入和密钥是否正确'
        }
      }
      
      // 在实际项目中，这里应该调用API来启用MFA
      // 由于我们没有实际后端，这里直接返回成功响应
      // const response = await apiService.post('/auth/mfa/enable', {
      //   secret,
      //   code
      // })
      
      return {
        success: true,
        message: 'MFA已成功启用',
        data: { success: true }
      }
    } catch (error) {
      log.error('启用MFA失败', error)
      return {
        success: false,
        message: error.message || '启用MFA失败，请稍后重试'
      }
    }
  }

  /**
   * 禁用MFA
   * @param {string} code - 验证码
   * @returns {Promise<Object>} - 禁用结果
   */
  async disableMfa(code) {
    try {
      // 在实际项目中，这里应该调用API来禁用MFA
      const response = await apiService.post('/auth/mfa/disable', {
        code
      })
      
      return {
        success: true,
        message: 'MFA已成功禁用',
        data: response
      }
    } catch (error) {
      log.error('禁用MFA失败', error)
      return {
        success: false,
        message: error.message || '禁用MFA失败，请稍后重试'
      }
    }
  }

  /**
   * 验证MFA
   * @param {string} code - 用户输入的验证码
   * @param {string} userId - 用户ID
   * @returns {Promise<Object>} - 验证结果
   */
  async verifyMfa(code, userId) {
    try {
      // 在实际项目中，这里应该调用API来验证MFA
      const response = await apiService.post('/auth/mfa/verify', {
        code,
        userId
      })
      
      return {
        success: true,
        message: 'MFA验证成功',
        data: response
      }
    } catch (error) {
      log.error('MFA验证失败', error)
      return {
        success: false,
        message: error.message || 'MFA验证失败，请检查验证码是否正确'
      }
    }
  }

  /**
   * Base32解码为字节数组
   * @private
   * @param {string} base32 - Base32编码的字符串
   * @returns {Uint8Array|null} - 解码后的字节数组，失败返回null
   */
  _decodeBase32ToBytes(base32) {
    try {
      // 标准Base32字符集
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
      
      // 移除所有非Base32字符
      base32 = base32.replace(/[^A-Z2-7]/gi, '').toUpperCase()
      
      if (base32.length === 0) return null
      
      let bits = 0
      let value = 0
      let index = 0
      
      // 计算输出长度：每8个Base32字符产生5个字节
      const output = new Uint8Array(Math.floor(base32.length * 5 / 8))
      
      for (let i = 0; i < base32.length; i++) {
        const charValue = chars.indexOf(base32.charAt(i))
        if (charValue === -1) continue // 跳过无效字符
        
        // 添加5位
        value = (value << 5) | charValue
        bits += 5
        
        // 当累积至少8位时，取出一个字节
        if (bits >= 8) {
          output[index++] = (value >>> (bits - 8)) & 0xff
          bits -= 8
        }
      }
      
      return output.slice(0, index)
    } catch (error) {
      log.error('Base32解码失败', error)
      return null
    }
  }
  
  /**
   * 使用CryptoJS计算HMAC-SHA1
   * @private
   * @param {Uint8Array} key - 密钥
   * @param {Uint8Array} message - 消息
   * @returns {Uint8Array|null} - HMAC-SHA1结果，失败返回null
   */
  _hmacSha1(key, message) {
    try {
      // 转换为CryptoJS支持的格式
      const keyWords = CryptoJS.lib.WordArray.create(key)
      const messageWords = CryptoJS.lib.WordArray.create(message)
      
      // 计算HMAC
      const hmac = CryptoJS.HmacSHA1(messageWords, keyWords)
      
      // 转换回字节数组
      const result = new Uint8Array(hmac.sigBytes)
      const words = hmac.words
      
      for (let i = 0; i < hmac.sigBytes; i++) {
        result[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff
      }
      
      return result
    } catch (error) {
      log.error('HMAC-SHA1计算失败', error)
      return null
    }
  }
}

// 创建单例实例
const mfaService = new MfaService()

export default mfaService 