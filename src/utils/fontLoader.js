/**
 * fontLoader.js - 字体加载工具
 * 用于预加载终端字体
 */
import log from '../services/log'

// 字体加载状态
const fontState = {
  fontsLoaded: false
}

/**
 * 预加载关键字体
 */
export const preloadFonts = () => {
  try {
    // 如果字体已标记为加载完成，直接返回成功
    if (fontState.fontsLoaded) {
      return Promise.resolve(true)
    }
    
    
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
    
    // 标记字体为已加载状态
    fontState.fontsLoaded = true
    
    // 触发自定义事件，通知应用字体已预加载
    try {
      window.dispatchEvent(new CustomEvent('fonts:loaded', { 
        detail: { success: true, fontFamily: 'JetBrains Mono' } 
      }))
    } catch (e) {
      log.error(`触发字体加载事件出错: ${e.message}`)
    }
    
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
    
    return Promise.resolve(true)
  } catch (error) {
    log.error(`预加载字体出错: ${error.message}`)
    fontState.fontsLoaded = true // 即使出错也标记为已加载，避免阻塞应用
    return Promise.resolve(false)
  }
}

export default {
  preloadFonts
} 