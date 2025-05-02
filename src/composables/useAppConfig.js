import { reactive, watch } from 'vue'

/**
 * 管理应用全局配置的组合式函数
 * @returns {Object} 包含配置对象和更新方法
 */
export function useAppConfig() {
  // 默认配置
  const defaultConfig = {
    // 界面设置
    ui: {
      sidebarCollapsed: false, // 侧边栏是否折叠
      tabsEnabled: true, // 是否启用标签页
      language: 'zh-CN', // 系统语言
      fontSize: 14, // 全局字体大小
      animations: true, // 是否启用动画
      denseLayout: false, // 是否使用紧凑布局
      menuWidth: 220 // 菜单宽度(px)
    },
    
    // 终端设置
    terminal: {
      fontFamily: 'Menlo, monospace', // 终端字体
      fontSize: 14, // 终端字体大小
      cursorStyle: 'block', // 光标样式: block, bar, underline
      cursorBlink: true, // 光标是否闪烁
      scrollback: 1000, // 回滚行数
      bellSound: true, // 终端提示音
      lineHeight: 1.2 // 行高
    },
    
    // 连接设置
    connection: {
      autoReconnect: true, // 自动重连
      reconnectDelay: 3000, // 重连延迟(ms)
      keepAliveInterval: 30, // 保持连接间隔(s)
      displayLoginBanner: true, // 显示登录banner信息
      saveHistory: true, // 保存命令历史
      maxHistoryItems: 100 // 最大历史记录数
    },
    
    // 编辑器设置
    editor: {
      theme: 'vs', // 编辑器主题
      tabSize: 2, // Tab大小
      insertSpaces: true, // Tab使用空格替代
      autoIndent: true, // 自动缩进
      wordWrap: 'off', // 自动换行
      lineNumbers: true, // 显示行号
      highlightActiveLine: true // 高亮当前行
    },
    
    // 高级设置
    advanced: {
      experimentalFeatures: false, // 实验性功能
      debugMode: false, // 调试模式
      analytics: true, // 匿名使用统计
      autoUpdate: true // 自动更新
    }
  }
  
  // 从本地存储加载配置
  const loadConfig = () => {
    try {
      const savedConfig = localStorage.getItem('app-config')
      if (savedConfig) {
        // 将保存的配置与默认配置合并
        return {
          ...defaultConfig,
          ...JSON.parse(savedConfig)
        }
      }
    } catch (error) {
      console.error('加载配置失败:', error)
    }
    
    return defaultConfig
  }
  
  // 创建响应式配置对象
  const config = reactive(loadConfig())
  
  // 更新配置
  const updateConfig = (path, value) => {
    // 允许使用点路径更新深层配置
    if (typeof path === 'string' && path.includes('.')) {
      const keys = path.split('.')
      let current = config
      
      // 遍历到倒数第二层
      for (let i = 0; i < keys.length - 1; i++) {
        current = current[keys[i]]
      }
      
      // 设置最终属性值
      current[keys[keys.length - 1]] = value
    } 
    // 直接更新顶级属性
    else if (typeof path === 'string') {
      config[path] = value
    } 
    // 批量更新配置对象
    else if (typeof path === 'object') {
      Object.assign(config, path)
    }
    
    saveConfig()
  }
  
  // 保存配置到本地存储
  const saveConfig = () => {
    try {
      localStorage.setItem('app-config', JSON.stringify(config))
    } catch (error) {
      console.error('保存配置失败:', error)
    }
  }
  
  // 重置配置到默认值
  const resetConfig = () => {
    Object.keys(defaultConfig).forEach(key => {
      config[key] = JSON.parse(JSON.stringify(defaultConfig[key]))
    })
    saveConfig()
  }
  
  // 监视配置变化，保存到本地存储
  watch(config, () => {
    saveConfig()
  }, { deep: true })
  
  return {
    config,
    updateConfig,
    resetConfig
  }
}