/**
 * 工具函数服务模块，提供各种通用工具方法
 */
import { ElMessage } from 'element-plus'
import CryptoJS from 'crypto-js'

/**
 * 格式化日期时间
 * @param {Date|string|number} date - 日期对象、时间戳或日期字符串
 * @param {string} format - 格式模板，如 'YYYY-MM-DD HH:mm:ss'
 * @returns {string} - 格式化后的日期字符串
 */
export function formatDate(date, format = 'YYYY-MM-DD HH:mm:ss') {
  if (!date) return ''
  
  // 转换为Date对象
  let dateObj = date
  if (typeof date === 'string' || typeof date === 'number') {
    dateObj = new Date(date)
  }
  
  if (!(dateObj instanceof Date) || isNaN(dateObj)) {
    return ''
  }
  
  const options = {
    'Y+': dateObj.getFullYear().toString(),
    'M+': (dateObj.getMonth() + 1).toString(),
    'D+': dateObj.getDate().toString(),
    'H+': dateObj.getHours().toString(),
    'h+': (dateObj.getHours() % 12 || 12).toString(),
    'm+': dateObj.getMinutes().toString(),
    's+': dateObj.getSeconds().toString(),
    'S+': dateObj.getMilliseconds().toString(),
    'q+': Math.floor((dateObj.getMonth() + 3) / 3).toString(),
    'a': dateObj.getHours() < 12 ? 'am' : 'pm',
    'A': dateObj.getHours() < 12 ? 'AM' : 'PM'
  }
  
  let result = format
  for (const key in options) {
    const regex = new RegExp(`(${key})`)
    if (regex.test(result)) {
      const match = regex.exec(result)[1]
      let value = options[key]
      
      // 处理前导零
      if (/(M+|D+|H+|h+|m+|s+|S+)/.test(key)) {
        value = value.padStart(match.length, '0')
      }
      
      // 处理毫秒
      if (key === 'S+' && match.length > 3) {
        value = value.padEnd(match.length, '0')
      }
      
      result = result.replace(match, value)
    }
  }
  
  return result
}

/**
 * 延迟执行
 * @param {number} ms - 延迟毫秒数
 * @returns {Promise} - Promise对象
 */
export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 防抖函数
 * @param {Function} fn - 要执行的函数
 * @param {number} wait - 等待时间(毫秒)
 * @returns {Function} - 防抖后的函数
 */
export function debounce(fn, wait = 300) {
  let timeout = null
  
  return function(...args) {
    const context = this
    
    if (timeout) clearTimeout(timeout)
    
    timeout = setTimeout(() => {
      fn.apply(context, args)
      timeout = null
    }, wait)
  }
}

/**
 * 节流函数
 * @param {Function} fn - 要执行的函数
 * @param {number} wait - 等待时间(毫秒)
 * @returns {Function} - 节流后的函数
 */
export function throttle(fn, wait = 300) {
  let last = 0
  let timeout = null
  
  return function(...args) {
    const context = this
    const now = Date.now()
    
    if (now - last > wait) {
      if (timeout) {
        clearTimeout(timeout)
        timeout = null
      }
      fn.apply(context, args)
      last = now
    } else if (!timeout) {
      timeout = setTimeout(() => {
        fn.apply(context, args)
        last = Date.now()
        timeout = null
      }, wait - (now - last))
    }
  }
}

/**
 * 深拷贝对象
 * @param {Object} obj - 要拷贝的对象
 * @returns {Object} - 拷贝后的对象
 */
export function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }
  
  // 处理日期对象
  if (obj instanceof Date) {
    return new Date(obj.getTime())
  }
  
  // 处理数组
  if (Array.isArray(obj)) {
    return obj.map(item => deepClone(item))
  }
  
  // 处理对象
  const cloned = {}
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      cloned[key] = deepClone(obj[key])
    }
  }
  
  return cloned
}

/**
 * 生成唯一ID
 * @param {string} prefix - ID前缀
 * @returns {string} - 唯一ID
 */
export function generateId(prefix = '') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).substring(2, 9)}`
}

/**
 * 格式化文件大小
 * @param {number} bytes - 字节数
 * @param {number} decimals - 小数位数
 * @returns {string} - 格式化后的文件大小
 */
export function formatFileSize(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes'
  
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i]
}

/**
 * 复制文本到剪贴板 - 使用统一的剪贴板服务
 * @param {string} text - 要复制的文本
 * @param {boolean} showMessage - 是否显示提示消息
 */
export async function copyToClipboard(text, showMessage = true) {
  try {
    // 动态导入剪贴板服务，避免循环依赖
    const { default: clipboardService } = await import('./clipboard.js')

    const success = await clipboardService.copyToClipboard(text)

    if (success && showMessage) {
      ElMessage.success('复制成功')
    } else if (!success && showMessage) {
      ElMessage.error('复制失败')
    }

    return success
  } catch (error) {
    console.error('复制文本失败:', error)
    if (showMessage) ElMessage.error('复制失败')
    return false
  }
}

/**
 * 休眠函数
 * @param {number} ms - 休眠时间(毫秒)
 * @returns {Promise} - Promise对象
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 检查对象是否为空
 * @param {Object} obj - 检查的对象
 * @returns {boolean} - 是否为空
 */
export function isEmpty(obj) {
  if (obj === null || obj === undefined) return true
  if (typeof obj === 'string') return obj.trim() === ''
  if (typeof obj === 'object') {
    if (Array.isArray(obj)) return obj.length === 0
    return Object.keys(obj).length === 0
  }
  return false
}

/**
 * 获取URL查询参数对象
 * @param {string} url - URL字符串
 * @returns {Object} - 解析后的查询参数对象
 */
export function getQueryParams(url) {
  const params = {}
  const searchString = url ? url.split('?')[1] : window.location.search.slice(1)
  
  if (searchString) {
    const searchParams = new URLSearchParams(searchString)
    for (const [key, value] of searchParams.entries()) {
      params[key] = value
    }
  }
  
  return params
}

/**
 * 将对象转换为查询字符串
 * @param {Object} params - 查询参数对象
 * @returns {string} - 查询字符串
 */
export function objectToQueryString(params) {
  return Object.keys(params)
    .filter(key => params[key] !== undefined && params[key] !== null)
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&')
}

/**
 * 获取数据的类型
 * @param {*} data - 要检查的数据
 * @returns {string} - 类型字符串
 */
export function getType(data) {
  return Object.prototype.toString.call(data).slice(8, -1).toLowerCase()
}

/**
 * 检查数据类型
 * @param {*} data - 要检查的数据
 * @param {string} type - 类型名称
 * @returns {boolean} - 是否为指定类型
 */
export function isType(data, type) {
  return getType(data) === type.toLowerCase()
}

/**
 * 安全地访问嵌套对象属性
 * @param {Object} obj - 目标对象
 * @param {string} path - 属性路径，如 'user.profile.name'
 * @param {*} defaultValue - 默认值，当属性不存在时返回
 * @returns {*} - 属性值或默认值
 */
export function getObjectValue(obj, path, defaultValue = undefined) {
  const keys = path.split('.')
  let result = obj
  
  for (const key of keys) {
    if (result === null || result === undefined) {
      return defaultValue
    }
    result = result[key]
  }
  
  return result === undefined ? defaultValue : result
}

/**
 * 安全地设置嵌套对象属性
 * @param {Object} obj - 目标对象
 * @param {string} path - 属性路径，如 'user.profile.name'
 * @param {*} value - 要设置的值
 * @returns {Object} - 设置后的对象
 */
export function setObjectValue(obj, path, value) {
  if (!obj || typeof obj !== 'object') return obj
  
  const keys = path.split('.')
  let current = obj
  
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    
    if (current[key] === undefined || current[key] === null) {
      // 如果下一级键是数字，创建数组，否则创建对象
      current[key] = /^\d+$/.test(keys[i + 1]) ? [] : {}
    }
    
    current = current[key]
  }
  
  current[keys[keys.length - 1]] = value
  return obj
}

/**
 * 将对象扁平化为单层对象
 * @param {Object} obj - 要扁平化的对象
 * @param {string} prefix - 键前缀
 * @returns {Object} - 扁平化后的对象
 */
export function flattenObject(obj, prefix = '') {
  const result = {}
  
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const newKey = prefix ? `${prefix}.${key}` : key
      
      if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
        Object.assign(result, flattenObject(obj[key], newKey))
      } else {
        result[newKey] = obj[key]
      }
    }
  }
  
  return result
}

/**
 * 将扁平对象还原为嵌套对象
 * @param {Object} obj - 扁平对象
 * @returns {Object} - 嵌套对象
 */
export function unflattenObject(obj) {
  const result = {}
  
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      setObjectValue(result, key, obj[key])
    }
  }
  
  return result
}

/**
 * 下载文件
 * @param {string|Blob|File} content - 文件内容、Blob或File对象
 * @param {string} filename - 文件名
 * @param {string} type - MIME类型
 */
export function downloadFile(content, filename, type = 'text/plain') {
  let blob
  
  if (content instanceof Blob) {
    blob = content
  } else if (typeof content === 'string') {
    blob = new Blob([content], { type })
  } else {
    throw new Error('不支持的内容类型')
  }
  
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  
  document.body.appendChild(a)
  a.click()
  
  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 100)
}

/**
 * 检查字符串是否是有效的JSON
 * @param {string} str - 要检查的字符串
 * @returns {boolean} - 是否有效
 */
export function isValidJSON(str) {
  try {
    JSON.parse(str)
    return true
  } catch (e) {
    return false
  }
}

/**
 * 对字符串加密
 * @param {string} text - 明文
 * @param {string} key - 加密密钥
 * @returns {string} - 密文
 */
export function encrypt(text, key) {
  if (!CryptoJS) {
    console.error('CryptoJS库未加载')
    return text
  }
  
  try {
    return CryptoJS.AES.encrypt(text, key).toString()
  } catch (error) {
    console.error('加密失败:', error)
    return text
  }
}

/**
 * 解密字符串
 * @param {string} cipherText - 密文
 * @param {string} key - 解密密钥
 * @returns {string} - 明文
 */
export function decrypt(cipherText, key) {
  if (!CryptoJS) {
    console.error('CryptoJS库未加载')
    return cipherText
  }
  
  try {
    const bytes = CryptoJS.AES.decrypt(cipherText, key)
    return bytes.toString(CryptoJS.enc.Utf8)
  } catch (error) {
    console.error('解密失败:', error)
    return cipherText
  }
}

/**
 * 生成MD5哈希
 * @param {string} text - 要哈希的文本
 * @returns {string} - MD5哈希值
 */
export function generateMD5(text) {
  if (!CryptoJS) {
    console.error('CryptoJS库未加载')
    return text
  }
  
  try {
    return CryptoJS.MD5(text).toString()
  } catch (error) {
    console.error('MD5生成失败:', error)
    return text
  }
}

/**
 * 格式化时间间隔为人类可读格式
 * @param {number} ms - 毫秒数
 * @returns {string} - 格式化后的时间
 */
export function formatDuration(ms) {
  if (ms < 0) return '0秒'
  
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  
  if (days > 0) {
    return `${days}天${hours % 24}小时`
  } else if (hours > 0) {
    return `${hours}小时${minutes % 60}分钟`
  } else if (minutes > 0) {
    return `${minutes}分钟${seconds % 60}秒`
  } else {
    return `${seconds}秒`
  }
}

/**
 * 格式化相对时间
 * @param {Date|string|number} date - 日期对象、时间戳或日期字符串
 * @returns {string} - 相对时间描述
 */
export function formatRelativeTime(date) {
  if (!date) return ''
  
  const now = new Date()
  const dateObj = new Date(date)
  const diff = now - dateObj
  
  // 处理无效日期
  if (isNaN(dateObj)) return ''
  
  // 显示相对时间
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  const months = Math.floor(days / 30)
  const years = Math.floor(days / 365)
  
  if (seconds < 60) {
    return '刚刚'
  } else if (minutes < 60) {
    return `${minutes}分钟前`
  } else if (hours < 24) {
    return `${hours}小时前`
  } else if (days < 30) {
    return `${days}天前`
  } else if (months < 12) {
    return `${months}个月前`
  } else {
    return `${years}年前`
  }
}

/**
 * 验证电子邮件地址
 * @param {string} email - 电子邮件地址
 * @returns {boolean} - 是否有效
 */
export function validateEmail(email) {
  const regex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
  return regex.test(email)
}

/**
 * 验证URL
 * @param {string} url - URL地址
 * @returns {boolean} - 是否有效
 */
export function validateUrl(url) {
  try {
    new URL(url)
    return true
  } catch (e) {
    return false
  }
}

/**
 * 检测设备类型
 * @returns {string} - 设备类型('mobile', 'tablet', 'desktop')
 */
export function getDeviceType() {
  const ua = navigator.userAgent
  
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
    return 'tablet'
  }
  
  if (/Mobile|iP(hone|od)|Android|BlackBerry|IEMobile|Kindle|NetFront|Silk-Accelerated|(hpw|web)OS|Fennec|Minimo|Opera M(obi|ini)|Blazer|Dolfin|Dolphin|Skyfire|Zune/.test(ua)) {
    return 'mobile'
  }
  
  return 'desktop'
}

/**
 * 检测浏览器类型和版本
 * @returns {Object} - 浏览器信息 {name, version}
 */
export function getBrowserInfo() {
  const ua = navigator.userAgent
  let browserName = 'Unknown'
  let browserVersion = ''
  
  // 检测 Chrome
  if (/Chrome/.test(ua) && !/Chromium|Edge|Edg|OPR|Opera/.test(ua)) {
    browserName = 'Chrome'
    browserVersion = ua.match(/Chrome\/(\d+\.\d+)/)?.[1] || ''
  }
  // 检测 Firefox
  else if (/Firefox/.test(ua)) {
    browserName = 'Firefox'
    browserVersion = ua.match(/Firefox\/(\d+\.\d+)/)?.[1] || ''
  }
  // 检测 Safari
  else if (/Safari/.test(ua) && !/Chrome|Chromium|Edge|Edg|OPR|Opera/.test(ua)) {
    browserName = 'Safari'
    browserVersion = ua.match(/Version\/(\d+\.\d+)/)?.[1] || ''
  }
  // 检测 Edge (Chromium based)
  else if (/Edg/.test(ua)) {
    browserName = 'Edge'
    browserVersion = ua.match(/Edg\/(\d+\.\d+)/)?.[1] || ''
  }
  // 检测 Edge (legacy)
  else if (/Edge/.test(ua)) {
    browserName = 'Edge Legacy'
    browserVersion = ua.match(/Edge\/(\d+\.\d+)/)?.[1] || ''
  }
  // 检测 Opera
  else if (/OPR|Opera/.test(ua)) {
    browserName = 'Opera'
    browserVersion = ua.match(/(?:OPR|Opera)\/(\d+\.\d+)/)?.[1] || ''
  }
  // 检测 IE
  else if (/Trident/.test(ua)) {
    browserName = 'Internet Explorer'
    browserVersion = ua.match(/rv:(\d+\.\d+)/)?.[1] || ''
  }
  
  return { name: browserName, version: browserVersion }
}

// 导出所有工具函数
export default {
  formatDate,
  delay,
  debounce,
  throttle,
  deepClone,
  generateId,
  formatFileSize,
  copyToClipboard,
  sleep,
  isEmpty,
  getQueryParams,
  objectToQueryString,
  getType,
  isType,
  getObjectValue,
  setObjectValue,
  flattenObject,
  unflattenObject,
  downloadFile,
  isValidJSON,
  encrypt,
  decrypt,
  generateMD5,
  formatDuration,
  formatRelativeTime,
  validateEmail,
  validateUrl,
  getDeviceType,
  getBrowserInfo
} 