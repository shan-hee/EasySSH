/**
 * fontLoader.js - 字体加载检测工具
 * 用于确保终端字体完全加载后再进行初始化
 */
import log from '../services/log'

// 检测字体是否加载完成的状态
const fontState = {
  fontsLoaded: false,
  fontObserver: null,
  callbacks: [],
  isChecking: false
}

// 定义字体加载超时设置
const FONT_CHECK_TIMEOUT = 500; // 从1000毫秒降低到500毫秒
const FONT_SAFETY_TIMEOUT = 1000; // 从2000毫秒降低到1000毫秒

/**
 * 检查字体是否已加载完成
 * @param {string} fontFamily - 要检查的字体名称，默认为 JetBrains Mono
 * @returns {Promise<boolean>} - 返回一个Promise，解析为字体是否已加载
 */
export const ensureFontLoaded = (fontFamily = 'JetBrains Mono') => {
  // 如果字体已加载，立即返回
  if (fontState.fontsLoaded) {
    return Promise.resolve(true)
  }
  
  // 如果已经在检查中，返回一个新的Promise
  if (fontState.isChecking) {
    return new Promise(resolve => {
      fontState.callbacks.push(resolve)
    })
  }
  
  fontState.isChecking = true
  
  // 返回一个Promise，在字体加载完成时解析
  return new Promise((resolve) => {
    try {
      log.info(`正在检查字体加载状态: ${fontFamily}`)
      
      // 添加回调
      fontState.callbacks.push(resolve)
      
      // 使用document.fonts API检查字体加载状态
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
          // 检查特定字体是否已加载
          if (document.fonts.check(`12px "${fontFamily}"`)) {
            log.info(`字体已加载: ${fontFamily}`)
            _fontLoaded(true)
          } else {
            log.warn(`字体加载检查失败，将再次尝试: ${fontFamily}`)
            // 再次检查，有时字体API可能不准确
            setTimeout(() => {
              if (document.fonts.check(`12px "${fontFamily}"`)) {
                log.info(`字体已加载(重试成功): ${fontFamily}`)
                _fontLoaded(true)
              } else {
                // 如果第二次检查失败，假设字体仍在加载中
                log.warn(`字体可能未加载，但将继续: ${fontFamily}`)
                _fontLoaded(true) // 尽管检查失败，但仍继续进行
              }
            }, FONT_CHECK_TIMEOUT)
          }
        }).catch(err => {
          log.error(`字体加载检查出错: ${err.message}`)
          _fontLoaded(false)
        })
      } else {
        // 浏览器不支持字体加载API，使用超时机制
        log.warn('浏览器不支持字体加载API，使用超时机制')
        setTimeout(() => {
          _fontLoaded(true)
        }, FONT_CHECK_TIMEOUT) // 缩短给字体留出的加载时间
      }
    } catch (error) {
      log.error(`字体加载检查异常: ${error.message}`)
      _fontLoaded(false)
    }
  })
}

/**
 * 通知字体加载完成，并触发所有回调
 * @param {boolean} success - 是否成功加载
 * @private
 */
const _fontLoaded = (success) => {
  fontState.fontsLoaded = success
  fontState.isChecking = false
  
  // 触发所有回调
  fontState.callbacks.forEach(callback => {
    try {
      callback(success)
    } catch (e) {
      log.error(`字体加载回调执行出错: ${e.message}`)
    }
  })
  
  // 清空回调列表
  fontState.callbacks = []
  
  // 触发自定义事件，通知应用字体已加载
  try {
    window.dispatchEvent(new CustomEvent('fonts:loaded', { 
      detail: { success, fontFamily: 'JetBrains Mono' } 
    }))
  } catch (e) {
    log.error(`触发字体加载事件出错: ${e.message}`)
  }
}

/**
 * 预加载关键字体
 */
export const preloadFonts = () => {
  try {
    // 如果字体已加载完成，直接返回成功
    if (fontState.fontsLoaded) {
      log.info('字体已加载，无需重复加载')
      return Promise.resolve(true)
    }
    
    log.info('开始预加载 JetBrains Mono 字体...')
    
    // 创建一个包含预加载字体的隐藏元素
    const preloadDiv = document.createElement('div')
    preloadDiv.style.fontFamily = '"JetBrains Mono"'
    preloadDiv.style.position = 'absolute'
    preloadDiv.style.left = '-9999px'
    preloadDiv.style.fontSize = '16px'
    preloadDiv.style.visibility = 'hidden'
    preloadDiv.style.pointerEvents = 'none'
    // 包含各种字符以确保字体完全加载
    preloadDiv.textContent = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()[]{}<>/?\\|'
    document.body.appendChild(preloadDiv)
    
    // 确保即使在资源加载超时的情况下也设置字体加载标志
    const safetyTimeout = setTimeout(() => {
      if (!fontState.fontsLoaded) {
        log.warn('字体加载超时，设置为已加载状态')
        _fontLoaded(true)
      }
      
      // 清理预加载元素
      try {
        if (preloadDiv.parentNode) {
          preloadDiv.parentNode.removeChild(preloadDiv)
        }
      } catch (e) {
        // 忽略错误
      }
    }, FONT_SAFETY_TIMEOUT) // 缩短安全超时时间
    
    return ensureFontLoaded('JetBrains Mono')
      .then(success => {
        clearTimeout(safetyTimeout) // 成功加载，清除安全超时
        
        // 短暂延迟后移除预加载元素
        setTimeout(() => {
          try {
            if (preloadDiv.parentNode) {
              preloadDiv.parentNode.removeChild(preloadDiv)
            }
          } catch (e) {
            // 忽略错误
          }
        }, 500)
        
        return success
      })
      .catch(error => {
        clearTimeout(safetyTimeout) // 出错时也清除安全超时
        log.error(`预加载字体出错: ${error.message}`)
        _fontLoaded(true) // 即使出错也标记为已加载，避免阻塞应用
        
        // 清理预加载元素
        try {
          if (preloadDiv.parentNode) {
            preloadDiv.parentNode.removeChild(preloadDiv)
          }
        } catch (e) {
          // 忽略错误
        }
        
        return false
      })
  } catch (error) {
    log.error(`预加载字体出错: ${error.message}`)
    _fontLoaded(true) // 即使出错也标记为已加载，避免阻塞应用
    return Promise.resolve(false)
  }
}

export default {
  ensureFontLoaded,
  preloadFonts
} 