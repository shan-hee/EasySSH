import { ref, watch, onMounted, onUnmounted } from 'vue'

/**
 * 管理暗黑模式的组合式函数
 * @returns {Object} 包含isDark标志和切换函数
 */
export function useDarkMode() {
  // 存储当前暗黑模式状态
  const isDark = ref(false)
  
  // 初始设置
  const initDarkMode = () => {
    // 检查本地存储设置
    const savedTheme = localStorage.getItem('theme')
    
    if (savedTheme) {
      // 使用用户保存的设置
      isDark.value = savedTheme === 'dark'
    } else {
      // 如果没有保存设置，检查系统偏好
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      isDark.value = prefersDark
    }
    
    // 应用暗黑模式
    applyDarkMode()
  }
  
  // 应用暗黑模式到DOM
  const applyDarkMode = () => {
    // 切换文档类名
    if (isDark.value) {
      document.documentElement.classList.add('dark')
      document.documentElement.setAttribute('data-theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark')
      document.documentElement.setAttribute('data-theme', 'light')
    }
  }
  
  // 切换暗黑模式
  const toggleDark = () => {
    isDark.value = !isDark.value
    localStorage.setItem('theme', isDark.value ? 'dark' : 'light')
  }
  
  // 监听媒体查询变化
  let mediaQuery
  
  onMounted(() => {
    // 初始化暗黑模式
    initDarkMode()
    
    // 设置媒体查询监听器
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    
    // 监听系统主题变化
    const handleChange = (e) => {
      // 只有当用户没有手动设置主题时，才跟随系统变化
      if (!localStorage.getItem('theme')) {
        isDark.value = e.matches
      }
    }
    
    // 兼容不同浏览器的事件监听
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange)
    } else {
      // 旧版浏览器
      mediaQuery.addListener(handleChange)
    }
  })
  
  onUnmounted(() => {
    // 清理媒体查询监听器
    if (mediaQuery) {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleChange)
      } else {
        // 旧版浏览器
        mediaQuery.removeListener(handleChange)
      }
    }
  })
  
  // 监听深色模式变化，应用样式
  watch(isDark, () => {
    applyDarkMode()
  })
  
  return {
    isDark,
    toggleDark
  }
}