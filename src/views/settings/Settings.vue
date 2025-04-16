<template>
  <div class="settings-container">
    <!-- 完全移除header部分，因为它不再包含任何内容 -->
    
    <SettingsCard title="终端设置">
      <el-form :model="terminalSettings">
        <!-- 三个下拉框放在一行 -->
        <div class="form-row-flex">
          <el-form-item label="终端主题" class="flex-form-item">
            <el-select 
              v-model="terminalSettings.theme" 
              placeholder="选择主题"
              @change="onThemeChange"
              class="full-width"
            >
              <el-option label="深色主题" value="dark" />
              <el-option label="浅色主题" value="light" />
              <el-option label="Dracula" value="dracula" />
              <el-option label="VSCode" value="vscode" />
              <el-option label="Material" value="material" />
              <el-option label="自定义主题" value="custom" />
            </el-select>
          </el-form-item>
          
          <el-form-item label="光标样式" class="flex-form-item">
            <el-select 
              v-model="terminalSettings.cursorStyle" 
              placeholder="选择光标样式"
              @change="saveTerminalSettings"
              class="full-width"
            >
              <el-option label="块状" value="block" />
              <el-option label="下划线" value="underline" />
              <el-option label="竖线" value="bar" />
            </el-select>
          </el-form-item>
          
          <el-form-item label="终端字体" class="flex-form-item">
            <el-select 
              v-model="terminalSettings.fontFamily" 
              placeholder="选择字体"
              @change="saveTerminalSettings"
              class="full-width"
            >
              <el-option label="Menlo" value="Menlo, Monaco, Consolas, monospace" />
              <el-option label="Courier New" value="'Courier New', monospace" />
              <el-option label="DejaVu Sans Mono" value="'DejaVu Sans Mono', monospace" />
              <el-option label="Ubuntu Mono" value="'Ubuntu Mono', monospace" />
            </el-select>
          </el-form-item>
        </div>
        
        <!-- 终端背景图片设置 -->
        <div class="terminal-bg-settings">
          <div class="theme-section-title">终端背景</div>
          
          <el-form-item label="背景图片">
            <el-switch v-model="terminalBgSettings.enabled" @change="updateTerminalBg" />
          </el-form-item>
          
          <template v-if="terminalBgSettings.enabled">
            <el-form-item label="图片URL">
              <el-input 
                v-model="terminalBgSettings.url" 
                placeholder="输入图片URL"
                @change="updateTerminalBg"
                class="full-width"
              />
            </el-form-item>
            
            <div class="form-row-flex">
              <el-form-item label="透明度" class="flex-form-item">
                <el-slider
                  v-model="terminalBgSettings.opacity"
                  :min="0.1"
                  :max="1"
                  :step="0.05"
                  :format-tooltip="value => Math.round(value * 100) + '%'"
                  @change="updateTerminalBg"
                />
              </el-form-item>
              
              <el-form-item label="显示模式" class="flex-form-item">
                <el-select 
                  v-model="terminalBgSettings.mode" 
                  placeholder="选择显示模式"
                  @change="updateTerminalBg"
                  class="full-width"
                >
                  <el-option label="适应(cover)" value="cover" />
                  <el-option label="包含(contain)" value="contain" />
                  <el-option label="填充(fill)" value="fill" />
                  <el-option label="原始大小" value="none" />
                  <el-option label="重复平铺" value="repeat" />
                </el-select>
              </el-form-item>
            </div>
            
            <div class="terminal-bg-preview" :style="bgPreviewStyle">
              <div class="preview-label">背景预览</div>
            </div>
          </template>
        </div>
        
        <!-- 自定义主题配置区域 -->
        <div v-if="terminalSettings.theme === 'custom'" class="custom-theme-settings">
          <div class="theme-section-title">自定义终端主题</div>
          <div class="theme-color-grid">
            <div class="theme-color-item">
              <div class="color-label">前景色</div>
              <el-color-picker v-model="customTheme.foreground" @change="updateCustomTheme" />
            </div>
            <div class="theme-color-item">
              <div class="color-label">背景色</div>
              <el-color-picker v-model="customTheme.background" @change="updateCustomTheme" />
            </div>
            <div class="theme-color-item">
              <div class="color-label">光标颜色</div>
              <el-color-picker v-model="customTheme.cursor" @change="updateCustomTheme" />
            </div>
            <div class="theme-color-item">
              <div class="color-label">选择背景色</div>
              <el-color-picker v-model="customTheme.selectionBackground" @change="updateCustomTheme" />
            </div>
            <!-- 基本颜色 -->
            <div class="theme-color-item">
              <div class="color-label">黑色</div>
              <el-color-picker v-model="customTheme.black" @change="updateCustomTheme" />
            </div>
            <div class="theme-color-item">
              <div class="color-label">红色</div>
              <el-color-picker v-model="customTheme.red" @change="updateCustomTheme" />
            </div>
            <div class="theme-color-item">
              <div class="color-label">绿色</div>
              <el-color-picker v-model="customTheme.green" @change="updateCustomTheme" />
            </div>
            <div class="theme-color-item">
              <div class="color-label">黄色</div>
              <el-color-picker v-model="customTheme.yellow" @change="updateCustomTheme" />
            </div>
            <div class="theme-color-item">
              <div class="color-label">蓝色</div>
              <el-color-picker v-model="customTheme.blue" @change="updateCustomTheme" />
            </div>
            <div class="theme-color-item">
              <div class="color-label">洋红色</div>
              <el-color-picker v-model="customTheme.magenta" @change="updateCustomTheme" />
            </div>
            <div class="theme-color-item">
              <div class="color-label">青色</div>
              <el-color-picker v-model="customTheme.cyan" @change="updateCustomTheme" />
            </div>
            <div class="theme-color-item">
              <div class="color-label">白色</div>
              <el-color-picker v-model="customTheme.white" @change="updateCustomTheme" />
            </div>
            
            <div class="theme-section-title full-width">亮色变体</div>
            
            <div class="theme-color-item">
              <div class="color-label">亮黑色</div>
              <el-color-picker v-model="customTheme.brightBlack" @change="updateCustomTheme" />
            </div>
            <div class="theme-color-item">
              <div class="color-label">亮红色</div>
              <el-color-picker v-model="customTheme.brightRed" @change="updateCustomTheme" />
            </div>
            <div class="theme-color-item">
              <div class="color-label">亮绿色</div>
              <el-color-picker v-model="customTheme.brightGreen" @change="updateCustomTheme" />
            </div>
            <div class="theme-color-item">
              <div class="color-label">亮黄色</div>
              <el-color-picker v-model="customTheme.brightYellow" @change="updateCustomTheme" />
            </div>
            <div class="theme-color-item">
              <div class="color-label">亮蓝色</div>
              <el-color-picker v-model="customTheme.brightBlue" @change="updateCustomTheme" />
            </div>
            <div class="theme-color-item">
              <div class="color-label">亮洋红色</div>
              <el-color-picker v-model="customTheme.brightMagenta" @change="updateCustomTheme" />
            </div>
            <div class="theme-color-item">
              <div class="color-label">亮青色</div>
              <el-color-picker v-model="customTheme.brightCyan" @change="updateCustomTheme" />
            </div>
            <div class="theme-color-item">
              <div class="color-label">亮白色</div>
              <el-color-picker v-model="customTheme.brightWhite" @change="updateCustomTheme" />
            </div>
          </div>
        </div>
        
        <el-form-item label="字体大小">
          <el-slider
            v-model="terminalSettings.fontSize"
            :min="8"
            :max="24"
            :step="1"
            show-input
            @change="saveTerminalSettings"
          />
        </el-form-item>
        
        <el-form-item label="光标闪烁">
          <el-switch 
            v-model="terminalSettings.cursorBlink"
            @change="saveTerminalSettings"
          />
        </el-form-item>
      </el-form>
    </SettingsCard>
    
    <SettingsCard title="连接设置">
      <el-form :model="connectionSettings">
        <div class="form-row-flex">
          <el-form-item label="自动重连" class="flex-form-item">
            <el-switch 
              v-model="connectionSettings.autoReconnect"
              @change="saveConnectionSettings"
            />
          </el-form-item>
          
          <el-form-item label="重连间隔(秒)" class="flex-form-item">
            <div class="number-input-with-controls">
              <button class="control-btn" @click="decrementReconnectInterval">－</button>
              <span class="number-display">{{ connectionSettings.reconnectInterval }}</span>
              <button class="control-btn" @click="incrementReconnectInterval">＋</button>
            </div>
          </el-form-item>
          
          <el-form-item label="连接超时(秒)" class="flex-form-item">
            <div class="number-input-with-controls">
              <button class="control-btn" @click="decrementConnectionTimeout">－</button>
              <span class="number-display">{{ connectionSettings.connectionTimeout }}</span>
              <button class="control-btn" @click="incrementConnectionTimeout">＋</button>
            </div>
          </el-form-item>
        </div>
        
        <div class="form-row-flex">
          <el-form-item label="保持连接" class="flex-form-item">
            <el-switch 
              v-model="connectionSettings.keepAlive"
              @change="saveConnectionSettings"
            />
          </el-form-item>
          
          <el-form-item label="心跳间隔(秒)" class="flex-form-item">
            <div class="number-input-with-controls" v-if="connectionSettings.keepAlive">
              <button class="control-btn" @click="decrementKeepAliveInterval">－</button>
              <span class="number-display">{{ connectionSettings.keepAliveInterval }}</span>
              <button class="control-btn" @click="incrementKeepAliveInterval">＋</button>
            </div>
            <div class="number-input-with-controls disabled" v-else>
              <button class="control-btn" disabled>－</button>
              <span class="number-display">{{ connectionSettings.keepAliveInterval }}</span>
              <button class="control-btn" disabled>＋</button>
            </div>
          </el-form-item>
          
          <div class="flex-form-item"></div>
        </div>
      </el-form>
    </SettingsCard>

    <SettingsCard title="界面设置">
      <el-form :model="uiSettings">
        <div class="form-row-flex">
          <el-form-item label="界面主题" class="flex-form-item">
            <el-select 
              v-model="uiSettings.theme" 
              placeholder="选择界面主题"
              @change="saveUISettings"
              class="full-width"
            >
              <el-option label="深色主题" value="dark" />
              <el-option label="浅色主题 (待开发)" value="light" disabled />
              <el-option label="跟随系统" value="system" />
            </el-select>
          </el-form-item>
          
          <el-form-item label="系统语言" class="flex-form-item">
            <el-select 
              v-model="uiSettings.language" 
              placeholder="选择语言"
              @change="saveUISettings"
              class="full-width"
            >
              <el-option label="简体中文" value="zh-CN" />
              <el-option label="English (待开发)" value="en-US" disabled />
            </el-select>
          </el-form-item>
          
          <div class="flex-form-item"></div>
        </div>

        <el-form-item label="启动时恢复页签">
          <el-switch 
            v-model="uiSettings.autoRestoreTabs"
            @change="saveUISettings"
          />
        </el-form-item>
        
      </el-form>
    </SettingsCard>
  </div>
</template>

<script>
import { ref, reactive, onMounted, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { useSettingsStore } from '../../store/settings'
import { useTerminalStore } from '../../store/terminal'
import { SettingsCard } from '../../components/settings'

export default {
  name: 'Settings',
  components: {
    SettingsCard
  },
  setup() {
    const settingsStore = useSettingsStore()
    const terminalStore = useTerminalStore()
    
    // 终端设置
    const terminalSettings = reactive({
      fontSize: 16,
      fontFamily: 'Menlo, Monaco, Consolas, monospace',
      theme: 'vscode',
      cursorStyle: 'block',
      cursorBlink: true,
    })
    
    // 终端背景图片设置
    const terminalBgSettings = reactive({
      enabled: false,
      url: '',
      opacity: 0.5,
      mode: 'cover',
      initialized: false
    })
    
    // 页面加载时立即检查本地存储中的背景设置
    try {
      const savedBgSettings = localStorage.getItem('easyssh_terminal_bg')
      if (savedBgSettings) {
        try {
          const parsedBgSettings = JSON.parse(savedBgSettings)
          // 更新背景设置
          Object.assign(terminalBgSettings, parsedBgSettings)
          // 标记为已初始化
          terminalBgSettings.initialized = true
          console.log('组件创建时加载背景设置:', terminalBgSettings)
          
          // 发送背景状态事件
          window.dispatchEvent(new CustomEvent('terminal-bg-status', { 
            detail: { enabled: terminalBgSettings.enabled } 
          }))
        } catch (e) {
          console.error('解析终端背景设置失败:', e)
        }
      }
    } catch (error) {
      console.error('初始化读取背景设置失败:', error)
    }
    
    // 背景预览样式计算属性
    const bgPreviewStyle = computed(() => {
      if (!terminalBgSettings.enabled || !terminalBgSettings.url) {
        return {
          backgroundColor: '#1E1E1E'
        }
      }
      
      let backgroundSize = 'cover'
      if (terminalBgSettings.mode === 'contain') {
        backgroundSize = 'contain'
      } else if (terminalBgSettings.mode === 'fill') {
        backgroundSize = '100% 100%'
      } else if (terminalBgSettings.mode === 'none') {
        backgroundSize = 'auto'
      } else if (terminalBgSettings.mode === 'repeat') {
        backgroundSize = 'auto'
      }
      
      return {
        backgroundImage: `url(${terminalBgSettings.url})`,
        backgroundSize: backgroundSize,
        backgroundRepeat: terminalBgSettings.mode === 'repeat' ? 'repeat' : 'no-repeat',
        backgroundPosition: 'center center',
        opacity: terminalBgSettings.opacity
      }
    })
    
    // 自定义主题设置
    const customTheme = reactive({
      foreground: '#CCCCCC',
      background: '#1E1E1E',
      cursor: '#FFFFFF',
      selectionBackground: '#264F78',
      black: '#000000',
      red: '#CD3131',
      green: '#0DBC79',
      yellow: '#E5E510',
      blue: '#2472C8',
      magenta: '#BC3FBC',
      cyan: '#11A8CD',
      white: '#E5E5E5',
      brightBlack: '#666666',
      brightRed: '#F14C4C',
      brightGreen: '#23D18B',
      brightYellow: '#F5F543',
      brightBlue: '#3B8EEA',
      brightMagenta: '#D670D6',
      brightCyan: '#29B8DB',
      brightWhite: '#FFFFFF'
    })

    // 连接设置
    const connectionSettings = reactive({
      autoReconnect: true,
      reconnectInterval: 3,
      connectionTimeout: 15,
      keepAlive: true,
      keepAliveInterval: 60,
    })
    
    // 界面设置
    const uiSettings = reactive({
      theme: 'dark',
      language: 'zh-CN',
      autoRestoreTabs: true,
    })
    
    // 加载设置
    onMounted(() => {
      loadSettings()
    })
    
    // 从存储加载设置
    const loadSettings = () => {
      try {
        // 加载终端设置
        const savedTerminalSettings = settingsStore.getTerminalSettings()
        if (savedTerminalSettings) {
          Object.assign(terminalSettings, savedTerminalSettings)
        }
        
        // 加载自定义主题设置
        const savedCustomTheme = localStorage.getItem('easyssh_custom_theme')
        if (savedCustomTheme) {
          Object.assign(customTheme, JSON.parse(savedCustomTheme))
        }
        
        // 加载终端背景图片设置
        const savedBgSettings = localStorage.getItem('easyssh_terminal_bg')
        if (savedBgSettings && !terminalBgSettings.initialized) {
          try {
            const parsedBgSettings = JSON.parse(savedBgSettings)
            // 检查状态是否与初始化时加载的不同
            if (terminalBgSettings.enabled !== parsedBgSettings.enabled) {
              Object.assign(terminalBgSettings, parsedBgSettings)
              console.log('loadSettings中更新背景设置:', terminalBgSettings)
            }
            
            // 无论如何都发送背景状态事件，确保系统各部分状态一致
            window.dispatchEvent(new CustomEvent('terminal-bg-status', { 
              detail: { enabled: terminalBgSettings.enabled } 
            }))
          } catch (e) {
            console.error('解析终端背景设置失败:', e)
          }
        }
        
        // 加载连接设置
        const savedConnectionSettings = settingsStore.getConnectionSettings()
        if (savedConnectionSettings) {
          Object.assign(connectionSettings, savedConnectionSettings)
        }
        
        // 加载界面设置
        const savedUISettings = settingsStore.getUISettings()
        if (savedUISettings) {
          Object.assign(uiSettings, savedUISettings)
        }
      } catch (error) {
        console.error('加载设置失败', error)
        ElMessage.error('加载设置失败')
      }
    }
    
    // 主题切换处理
    const onThemeChange = () => {
      if (terminalSettings.theme === 'custom') {
        // 如果首次切换到自定义主题，先从当前主题加载颜色值
        try {
          // 动态导入设置服务
          import('../../services/settings').then(module => {
            const settingsService = module.default
            // 获取当前选中主题的配置作为自定义主题的初始值
            const currentTheme = settingsService.getTerminalTheme('vscode')
            // 只有在首次切换到自定义主题时才初始化
            if (!localStorage.getItem('easyssh_custom_theme')) {
              Object.assign(customTheme, currentTheme)
            }
          })
        } catch (error) {
          console.error('加载主题配置失败', error)
        }
      }
      saveTerminalSettings()
    }
    
    // 更新自定义主题
    const updateCustomTheme = () => {
      try {
        // 保存自定义主题到本地存储
        localStorage.setItem('easyssh_custom_theme', JSON.stringify(customTheme))
        // 应用到终端设置
        saveTerminalSettings()
      } catch (error) {
        console.error('保存自定义主题失败', error)
        ElMessage.error('保存自定义主题失败')
      }
    }
    
    // 更新终端背景设置
    const updateTerminalBg = () => {
      try {
        // 标记为已初始化
        terminalBgSettings.initialized = true
        
        // 保存终端背景设置到本地存储
        localStorage.setItem('easyssh_terminal_bg', JSON.stringify(terminalBgSettings))
        
        // 创建自定义事件，通知终端组件更新背景
        const event = new CustomEvent('terminal-bg-changed', { detail: terminalBgSettings })
        window.dispatchEvent(event)
        
        // 立即触发状态更新事件，确保控制面板和其他组件能够立即感知到状态变化
        window.dispatchEvent(new CustomEvent('terminal-bg-status', { 
          detail: { enabled: terminalBgSettings.enabled } 
        }))
        
        console.log('终端背景设置已更新:', terminalBgSettings)
        ElMessage.success('终端背景设置已更新')
      } catch (error) {
        console.error('保存终端背景设置失败', error)
        ElMessage.error('保存终端背景设置失败')
      }
    }
    
    // 保存终端设置
    const saveTerminalSettings = async () => {
      try {
        // 首先保存设置到存储
        settingsStore.saveTerminalSettings(terminalSettings)
        
        // 如果是自定义主题，将自定义主题保存到本地存储
        if (terminalSettings.theme === 'custom') {
          localStorage.setItem('easyssh_custom_theme', JSON.stringify(customTheme))
        }
        
        // 然后应用设置到所有打开的终端
        const results = await terminalStore.applySettingsToAllTerminals(terminalSettings)
        const totalTerminals = Object.keys(results).length
        
        if (totalTerminals > 0) {
          const successCount = Object.values(results).filter(result => result === true).length
          
          if (successCount === totalTerminals) {
            ElMessage.success(`成功应用设置到 ${successCount} 个终端`)
          } else {
            ElMessage.warning(`应用设置时出现问题: ${successCount}/${totalTerminals} 个终端成功`)
          }
        } else {
          ElMessage.success('终端设置已保存')
        }
      } catch (error) {
        console.error('保存终端设置失败', error)
        ElMessage.error('保存终端设置失败')
      }
    }
    
    // 保存连接设置
    const saveConnectionSettings = () => {
      try {
        settingsStore.saveConnectionSettings(connectionSettings)
        ElMessage.success('连接设置已保存')
      } catch (error) {
        console.error('保存连接设置失败', error)
        ElMessage.error('保存连接设置失败')
      }
    }
    
    // 自定义数字输入框控制方法
    const incrementReconnectInterval = () => {
      if (connectionSettings.reconnectInterval < 60) {
        connectionSettings.reconnectInterval += 1
        saveConnectionSettings()
      }
    }
    
    const decrementReconnectInterval = () => {
      if (connectionSettings.reconnectInterval > 1) {
        connectionSettings.reconnectInterval -= 1
        saveConnectionSettings()
      }
    }
    
    const incrementConnectionTimeout = () => {
      if (connectionSettings.connectionTimeout < 120) {
        connectionSettings.connectionTimeout += 1
        saveConnectionSettings()
      }
    }
    
    const decrementConnectionTimeout = () => {
      if (connectionSettings.connectionTimeout > 5) {
        connectionSettings.connectionTimeout -= 1
        saveConnectionSettings()
      }
    }
    
    const incrementKeepAliveInterval = () => {
      if (connectionSettings.keepAliveInterval < 300) {
        connectionSettings.keepAliveInterval += 1
        saveConnectionSettings()
      }
    }
    
    const decrementKeepAliveInterval = () => {
      if (connectionSettings.keepAliveInterval > 15) {
        connectionSettings.keepAliveInterval -= 1
        saveConnectionSettings()
      }
    }
    
    // 保存界面设置
    const saveUISettings = () => {
      try {
        settingsStore.saveUISettings(uiSettings)
        ElMessage.success('界面设置已保存')
        
        // 应用主题变更
        if (uiSettings.theme === 'system') {
          const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
          document.documentElement.setAttribute('data-theme', isDarkMode ? 'dark' : 'light')
        } else {
          document.documentElement.setAttribute('data-theme', uiSettings.theme)
        }
      } catch (error) {
        console.error('保存界面设置失败', error)
        ElMessage.error('保存界面设置失败')
      }
    }
    
    return {
      terminalSettings,
      connectionSettings,
      uiSettings,
      customTheme,
      terminalBgSettings,
      bgPreviewStyle,
      saveTerminalSettings,
      saveConnectionSettings,
      saveUISettings,
      onThemeChange,
      updateCustomTheme,
      updateTerminalBg,
      incrementReconnectInterval,
      decrementReconnectInterval,
      incrementConnectionTimeout,
      decrementConnectionTimeout,
      incrementKeepAliveInterval,
      decrementKeepAliveInterval
    }
  }
}
</script>

<style>
.settings-container {
  max-width: 800px;
  margin: 20px auto;
  padding: 0 20px;
}

/* 统一表单元素样式 */
:deep(.el-form) {
  --el-text-color-regular: #fff;
}

:deep(.el-form-item__label) {
  color: #fff;
  font-weight: normal;
  font-size: 12px;
  width: 90px !important;
  text-align: left;
}

:deep(.el-form-item) {
  margin-bottom: 15px;
  display: flex;
  align-items: center;
}

:deep(.el-form-item__content) {
  margin-left: 0 !important;
  flex: 1;
  display: flex;
  align-items: center;
}

:deep(.el-input__wrapper),
:deep(.el-input-number__wrapper),
:deep(.el-select__wrapper) {
  background-color: transparent;
  box-shadow: 0 0 0 1px #666 inset;
  border-radius: 6px;
}

:deep(.el-input__wrapper:hover),
:deep(.el-input-number__wrapper:hover),
:deep(.el-select__wrapper:hover) {
  box-shadow: 0 0 0 1px #888 inset;
}

:deep(.el-input__wrapper.is-focus),
:deep(.el-input-number__wrapper.is-focus),
:deep(.el-select__wrapper.is-focus) {
  box-shadow: 0 0 0 1px #0083d3 inset;
}

/* 终端背景设置样式 */
.terminal-bg-settings {
  margin: 10px 0 20px;
  padding: 15px;
  border-radius: 8px;
  background-color: rgba(0, 0, 0, 0.2);
}

.terminal-bg-preview {
  width: 100%;
  height: 120px;
  margin-top: 10px;
  border-radius: 6px;
  position: relative;
  overflow: hidden;
  background-color: #1E1E1E;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-label {
  color: rgba(255, 255, 255, 0.7);
  font-size: 14px;
  position: relative;
  z-index: 2;
  background-color: rgba(0, 0, 0, 0.5);
  padding: 5px 10px;
  border-radius: 4px;
}

/* 自定义主题相关样式 */
.custom-theme-settings {
  margin: 10px 0 20px;
  padding: 15px;
  border-radius: 8px;
  background-color: rgba(0, 0, 0, 0.2);
}

.theme-section-title {
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 12px;
  color: #fff;
  padding-bottom: 5px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.theme-color-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 15px;
}

.theme-color-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.color-label {
  font-size: 12px;
  color: var(--text-secondary, rgba(255, 255, 255, 0.8));
}

.full-width {
  grid-column: 1 / -1;
}

/* 自定义数字输入控件 */
.number-input-with-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: flex-start;
  width: 100%;
}

.number-display {
  font-size: 14px;
  color: var(--font-color, #fff);
  min-width: 20px;
  text-align: center;
}

.control-btn {
  background-color: transparent;
  border: none;
  color: var(--font-color, #fff);
  font-size: 14px;
  cursor: pointer;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.control-btn:hover {
  background-color: var(--hover-bg, rgba(255, 255, 255, 0.1));
}

.control-btn:active {
  background-color: var(--active-bg, rgba(255, 255, 255, 0.2));
}

.number-input-with-controls.disabled {
  opacity: 0.5;
}

.number-input-with-controls.disabled .control-btn {
  cursor: not-allowed;
}

/* 自定义数字输入框样式 */
:deep(.el-input-number) {
  width: 100px;
  border-radius: 6px;
  display: flex;
  align-items: center;
}

:deep(.el-input-number__decrease),
:deep(.el-input-number__increase) {
  background-color: transparent;
  border: none;
  color: var(--font-color, #fff);
  display: flex;
  align-items: center;
  justify-content: center;
}

:deep(.el-input-number__wrapper) {
  box-shadow: none;
  border: none;
}

:deep(.el-input-number .el-input__wrapper) {
  box-shadow: none;
  background-color: transparent;
}

:deep(.el-switch__core) {
  border: 1px solid var(--switch-border-color, #666);
  background-color: var(--switch-bg-color, transparent);
}

:deep(.el-switch.is-checked .el-switch__core) {
  border-color: var(--switch-active-border-color, #0083d3);
  background-color: var(--switch-active-bg-color, #0083d3);
}

:deep(.el-slider__runway) {
  background-color: var(--slider-runway-color, #333);
}

:deep(.el-slider__bar) {
  background-color: var(--slider-bar-color, #0083d3);
}

/* 浅色主题适配 */
:root[data-theme="light"] .color-label {
  color: rgba(0, 0, 0, 0.6);
}

:root[data-theme="light"] .number-display {
  color: #333;
}

:root[data-theme="light"] .control-btn {
  color: #333;
}

:root[data-theme="light"] .control-btn:hover {
  background-color: rgba(0, 0, 0, 0.05);
}

:root[data-theme="light"] .control-btn:active {
  background-color: rgba(0, 0, 0, 0.1);
}

/* 横向表单布局 */
.form-row-flex {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 15px;
  width: 100%;
}

.flex-form-item {
  flex: 1 1 0;
  min-width: 0;
  margin-bottom: 0 !important;
}

.flex-form-item :deep(.el-select) {
  width: 100%;
}

.flex-form-item :deep(.el-form-item__content) {
  width: 100%;
}

.full-width {
  width: 100%;
}
</style> 