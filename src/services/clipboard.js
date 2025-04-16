/**
 * 剪贴板服务模块，负责处理剪贴板相关操作
 */
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import log from './log'
import notification from './notification'

class ClipboardService {
  constructor() {
    // 是否初始化完成
    this.isInitialized = false
    
    // 剪贴板历史记录
    this.history = ref([])
    
    // 最大历史记录条数
    this.maxHistorySize = 20
    
    // 剪贴板权限状态
    this.permissionState = ref('prompt')  // 'granted', 'denied', 'prompt'
    
    // 是否支持剪贴板API
    this.isSupported = ref(false)
    
    // 是否正在监听剪贴板变化
    this.isListening = ref(false)
    
    // 查询剪贴板权限的计时器
    this.permissionCheckTimer = null
    
    // 最近一次复制的内容
    this.lastCopiedText = ref('')
    
    this.hasPermission = false
  }
  
  /**
   * 初始化剪贴板服务
   * @returns {Promise<boolean>} 是否初始化成功
   */
  async init() {
    try {
      if (this.isInitialized) {
        return Promise.resolve(true)
      }
      
      // 检查剪贴板API是否可用
      if (!navigator.clipboard) {
        log.warn('剪贴板API不可用，部分功能可能不正常')
        this.isInitialized = true
        return Promise.resolve(false)
      }
      
      // 请求剪贴板权限（在部分浏览器中需要）
      this._requestPermission()
        .then(hasPermission => {
          this.hasPermission = hasPermission
          log.info(`剪贴板权限: ${hasPermission ? '已授权' : '未授权'}`)
        })
        .catch(error => {
          log.error('请求剪贴板权限失败', error)
        })
      
      this.isInitialized = true
      log.info('剪贴板服务初始化完成')
      return Promise.resolve(true)
    } catch (error) {
      log.error('剪贴板服务初始化失败', error)
      return Promise.resolve(false)
    }
  }
  
  /**
   * 请求剪贴板权限
   * @returns {Promise<boolean>} 是否有权限
   * @private
   */
  async _requestPermission() {
    try {
      // 在一些浏览器中，需要实际调用一次剪贴板API才能触发权限请求
      // 尝试读取剪贴板内容，这可能会触发权限请求
      await navigator.clipboard.readText()
      return true
    } catch (error) {
      // 如果是权限错误，则标记为没有权限
      if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
        return false
      }
      // 其他错误可能表示API可用但当前没有内容或者其他问题
      return true
    }
  }
  
  /**
   * 检查剪贴板权限状态
   * @private
   */
  async _checkPermission() {
    // 仅适用于安全上下文(HTTPS)且支持Permissions API的环境
    if (!navigator.permissions || !navigator.clipboard) {
      this.permissionState.value = 'prompt'
      return
    }
    
    try {
      // 查询剪贴板读取权限
      const readPermission = await navigator.permissions.query({ name: 'clipboard-read' })
      
      // 查询剪贴板写入权限
      const writePermission = await navigator.permissions.query({ name: 'clipboard-write' })
      
      // 设置权限状态(取较低权限)
      if (readPermission.state === 'denied' || writePermission.state === 'denied') {
        this.permissionState.value = 'denied'
      } else if (readPermission.state === 'granted' && writePermission.state === 'granted') {
        this.permissionState.value = 'granted'
      } else {
        this.permissionState.value = 'prompt'
      }
      
      // 添加权限变更监听
      readPermission.addEventListener('change', () => this._checkPermission())
      writePermission.addEventListener('change', () => this._checkPermission())
      
      log.info(`剪贴板权限状态: ${this.permissionState.value}`)
      
      // 如果有权限，启动监听剪贴板变化
      if (this.permissionState.value === 'granted' && !this.isListening.value) {
        this._startClipboardMonitor()
      }
    } catch (error) {
      log.error('检查剪贴板权限失败', error)
      this.permissionState.value = 'prompt'
    }
  }
  
  /**
   * 开始监听剪贴板变化
   * @private
   */
  _startClipboardMonitor() {
    if (this.isListening.value || !this.isSupported.value) return
    
    log.info('开始监听剪贴板变化')
    this.isListening.value = true
    
    // 由于Web标准没有提供剪贴板变化事件，我们需要周期性检查
    // 这种方法可能不适用于所有环境，且可能受到浏览器安全策略限制
    this.clipboardCheckTimer = setInterval(async () => {
      try {
        // 只有在页面聚焦时才检查，减少不必要的API调用
        if (document.hasFocus() && this.permissionState.value === 'granted') {
          const text = await this.readText()
          
          // 如果内容与上次不同，添加到历史记录
          if (text && text !== this.lastCopiedText.value) {
            this._addToHistory(text, 'external')
            this.lastCopiedText.value = text
          }
        }
      } catch (error) {
        // 忽略权限错误，可能是用户突然撤销了权限
        if (error.name !== 'NotAllowedError') {
          log.error('检查剪贴板内容失败', error)
        }
      }
    }, 2000)  // 每2秒检查一次
  }
  
  /**
   * 停止监听剪贴板变化
   * @private
   */
  _stopClipboardMonitor() {
    if (this.clipboardCheckTimer) {
      clearInterval(this.clipboardCheckTimer)
      this.clipboardCheckTimer = null
      this.isListening.value = false
      log.info('停止监听剪贴板变化')
    }
  }
  
  /**
   * 复制文本到剪贴板
   * @param {string} text - 要复制的文本
   * @param {Object} options - 选项
   * @param {boolean} options.silent - 是否静默操作，不显示提示
   * @returns {Promise<boolean>} - 是否复制成功
   */
  async copyText(text, options = {}) {
    if (!this.isInitialized) {
      await this.init()
    }
    
    try {
      if (!text) {
        return false
      }
      
      // 现代剪贴板API方式
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text)
        if (!options.silent) {
          ElMessage.success('复制成功')
        }
        return true
      }
      
      // 如果现代API不可用，回退到document.execCommand方式
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.left = '-9999px'
      textarea.style.top = '-9999px'
      document.body.appendChild(textarea)
      textarea.focus()
      textarea.select()
      
      const successful = document.execCommand('copy')
      document.body.removeChild(textarea)
      
      if (successful && !options.silent) {
        ElMessage.success('复制成功')
      } else if (!successful && !options.silent) {
        ElMessage.error('复制失败')
      }
      
      return successful
    } catch (error) {
      log.error('复制到剪贴板失败', error)
      if (!options.silent) {
        ElMessage.error('复制失败')
      }
      return false
    }
  }
  
  /**
   * 从剪贴板读取文本
   * @returns {Promise<string>} - 剪贴板文本
   */
  async readText() {
    if (!this.isInitialized) {
      await this.init()
    }
    
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        return await navigator.clipboard.readText()
      }
      
      // 目前execCommand不支持读取剪贴板
      log.warn('当前浏览器不支持读取剪贴板')
      return ''
    } catch (error) {
      log.error('从剪贴板读取失败', error)
      return ''
    }
  }
  
  /**
   * 将图像复制到剪贴板
   * @param {Blob|File|HTMLCanvasElement|HTMLImageElement} image - 图像数据
   * @param {Object} options - 复制选项
   * @param {boolean} options.silent - 是否静默复制(不显示通知)
   * @returns {Promise<boolean>} - 是否复制成功
   */
  async copyImage(image, options = {}) {
    const { silent = false } = options
    
    if (!this.isSupported.value) {
      if (!silent) {
        ElMessage.error('当前环境不支持复制图像')
      }
      return false
    }
    
    try {
      let clipboardItem
      
      if (image instanceof HTMLCanvasElement) {
        // 从Canvas创建Blob
        const blob = await new Promise(resolve => {
          image.toBlob(blob => resolve(blob), 'image/png')
        })
        clipboardItem = new ClipboardItem({ 'image/png': blob })
      } else if (image instanceof HTMLImageElement) {
        // 从Image元素创建Blob
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const ctx = canvas.getContext('2d')
        ctx.drawImage(image, 0, 0)
        
        const blob = await new Promise(resolve => {
          canvas.toBlob(blob => resolve(blob), 'image/png')
        })
        clipboardItem = new ClipboardItem({ 'image/png': blob })
      } else if (image instanceof Blob) {
        // 直接使用Blob
        clipboardItem = new ClipboardItem({ [image.type]: image })
      } else {
        throw new Error('不支持的图像格式')
      }
      
      await navigator.clipboard.write([clipboardItem])
      
      if (!silent) {
        ElMessage.success('图像已复制到剪贴板')
      }
      
      log.info('复制图像到剪贴板成功')
      return true
    } catch (error) {
      log.error('复制图像到剪贴板失败', error)
      
      if (!silent) {
        ElMessage.error('复制图像失败：' + error.message)
      }
      
      return false
    }
  }
  
  /**
   * 将文本粘贴到指定元素
   * @param {HTMLElement} element - 目标元素
   * @returns {Promise<boolean>} - 是否粘贴成功
   */
  async pasteToElement(element) {
    if (!element) return false
    
    try {
      const text = await this.readText()
      
      if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        // 处理输入框元素
        const start = element.selectionStart || 0
        const end = element.selectionEnd || 0
        const before = element.value.substring(0, start)
        const after = element.value.substring(end)
        
        element.value = before + text + after
        element.selectionStart = element.selectionEnd = start + text.length
        
        // 触发input事件，用于通知框架(如Vue)值已变更
        element.dispatchEvent(new Event('input', { bubbles: true }))
      } else {
        // 处理其他元素
        element.textContent = text
      }
      
      log.info('粘贴文本到元素成功')
      return true
    } catch (error) {
      log.error('粘贴文本到元素失败', error)
      
      if (error.name === 'NotAllowedError') {
        notification.error('粘贴失败', '浏览器拒绝访问剪贴板，请检查权限设置')
      } else {
        notification.error('粘贴失败', error.message)
      }
      
      return false
    }
  }
  
  /**
   * 添加内容到历史记录
   * @param {string} text - 要添加的文本
   * @param {string} source - 来源('app'或'external')
   * @private
   */
  _addToHistory(text, source = 'app') {
    if (!text) return
    
    // 创建历史记录项
    const historyItem = {
      id: Date.now().toString(),
      text,
      source,
      timestamp: new Date(),
      preview: text.length > 100 ? text.substring(0, 97) + '...' : text
    }
    
    // 检查是否已存在相同的文本
    const existingIndex = this.history.value.findIndex(item => item.text === text)
    
    if (existingIndex >= 0) {
      // 如果存在相同的文本，移除旧记录
      this.history.value.splice(existingIndex, 1)
    }
    
    // 添加到历史开头
    this.history.value.unshift(historyItem)
    
    // 限制历史记录数量
    if (this.history.value.length > this.maxHistorySize) {
      this.history.value = this.history.value.slice(0, this.maxHistorySize)
    }
  }
  
  /**
   * 从历史记录复制文本
   * @param {string|Object} itemOrId - 历史记录项或其ID
   * @returns {Promise<boolean>} - 是否复制成功
   */
  async copyFromHistory(itemOrId) {
    const item = typeof itemOrId === 'string'
      ? this.history.value.find(h => h.id === itemOrId)
      : itemOrId
    
    if (!item) {
      ElMessage.error('找不到指定的历史记录')
      return false
    }
    
    return this.copyText(item.text, { addToHistory: false })
  }
  
  /**
   * 清空历史记录
   */
  clearHistory() {
    this.history.value = []
    log.info('清空剪贴板历史记录')
  }
  
  /**
   * 从历史记录中删除项
   * @param {string} id - 要删除的项目ID
   */
  removeFromHistory(id) {
    const index = this.history.value.findIndex(item => item.id === id)
    
    if (index >= 0) {
      this.history.value.splice(index, 1)
      log.info(`从剪贴板历史记录中删除项 ${id}`)
    }
  }
  
  /**
   * 设置最大历史记录条数
   * @param {number} size - 最大条数
   */
  setMaxHistorySize(size) {
    if (typeof size === 'number' && size > 0) {
      this.maxHistorySize = size
      
      // 如果当前历史记录超过新的大小限制，裁剪历史记录
      if (this.history.value.length > size) {
        this.history.value = this.history.value.slice(0, size)
      }
    }
  }
  
  /**
   * 请求剪贴板权限
   * @returns {Promise<boolean>} - 是否获取到权限
   */
  async requestPermission() {
    if (!navigator.clipboard || !navigator.permissions) {
      ElMessage.warning('当前环境不支持完整的剪贴板功能')
      return false
    }
    
    try {
      log.info('请求剪贴板权限')
      
      // 读取权限
      const readPermission = await navigator.permissions.query({ name: 'clipboard-read' })
      
      // 写入权限
      const writePermission = await navigator.permissions.query({ name: 'clipboard-write' })
      
      // 尝试进行一次读操作来触发权限请求
      if (readPermission.state !== 'granted') {
        try {
          await navigator.clipboard.readText()
        } catch (e) {
          // 忽略错误，这里只是为了触发权限请求对话框
        }
      }
      
      // 尝试进行一次写操作来触发权限请求
      if (writePermission.state !== 'granted') {
        try {
          await navigator.clipboard.writeText(' ') // 写入空格
        } catch (e) {
          // 忽略错误，这里只是为了触发权限请求对话框
        }
      }
      
      // 重新检查权限状态
      await this._checkPermission()
      
      if (this.permissionState.value === 'granted') {
        notification.success('权限已获取', '已获取剪贴板访问权限')
        this._startClipboardMonitor()
        return true
      } else {
        notification.warning('权限受限', '剪贴板权限受限，部分功能可能不可用')
        return false
      }
    } catch (error) {
      log.error('请求剪贴板权限失败', error)
      notification.error('权限请求失败', error.message)
      return false
    }
  }
}

// 创建单例实例
const clipboardService = new ClipboardService()

export default clipboardService 