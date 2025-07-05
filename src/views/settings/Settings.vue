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
              @change="saveTerminalSettings"
              class="full-width"
            >
              <el-option label="深色主题" value="dark" />
              <el-option label="浅色主题" value="light" />
              <el-option label="Dracula" value="dracula" />
              <el-option label="VSCode" value="vscode" />
              <el-option label="Material" value="material" />
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
              <el-option label="JetBrains Mono" value="'JetBrains Mono'" />
              <el-option label="Menlo" value="'Menlo'" />
              <el-option label="Courier New" value="'Courier New'" />
              <el-option label="DejaVu Sans Mono" value="'DejaVu Sans Mono'" />
              <el-option label="Ubuntu Mono" value="'Ubuntu Mono'" />

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
        
        <div class="form-row-flex">
          <el-form-item label="选中复制" class="flex-form-item">
            <el-switch 
              v-model="terminalSettings.copyOnSelect"
              @change="saveTerminalSettings"
            />
          </el-form-item>
          
          <el-form-item label="右键粘贴" class="flex-form-item">
            <el-tooltip content="需要域名支持https" placement="top">
              <el-switch
                v-model="terminalSettings.rightClickSelectsWord"
                @change="saveTerminalSettings"
              />
            </el-tooltip>
          </el-form-item>

          <el-form-item label="光标闪烁" class="flex-form-item">
            <el-switch 
              v-model="terminalSettings.cursorBlink"
              @change="saveTerminalSettings"
            />
          </el-form-item>
        </div>

        <!-- 终端快捷键设置 -->
        <div class="terminal-shortcuts-settings">
          <div class="theme-section-title">
            终端快捷键
            <div class="shortcut-actions">
              <el-button 
                type="primary" 
                size="small" 
                @click="resetAllShortcuts"
                :disabled="resettingShortcuts"
                style="background-color: #444; border-color: #444;"
              >
                重置为默认值
              </el-button>
            </div>
          </div>
          <div class="shortcuts-container">
            <div class="shortcut-item" v-for="(shortcut, index) in terminalShortcuts" :key="index">
              <div class="shortcut-description">{{ shortcut.description }}</div>
              <KeyboardShortcutEditor
                v-model="shortcut.key"
                @update:modelValue="updateShortcut(shortcut, $event)"
              />
            </div>
          </div>
        </div>
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
      </el-form>
    </SettingsCard>
  </div>
</template>

<script>
import { ref, reactive, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useTerminalStore } from '../../store/terminal'
import settingsService from '../../services/settings'
import { SettingsCard, KeyboardShortcutEditor } from '../../components/settings'
import { localKeyboardManager } from '../../utils/keyboard'
import log from '../../services/log'

export default {
  name: 'Settings',
  components: {
    SettingsCard,
    KeyboardShortcutEditor
  },
  setup() {
    const terminalStore = useTerminalStore()
    
    // 终端设置 - 初始化为空，将在组件挂载时从统一设置服务加载
    const terminalSettings = reactive({
      fontSize: 16,
      fontFamily: "'JetBrains Mono'",
      theme: 'dark',
      cursorStyle: 'block',
      cursorBlink: true,
      copyOnSelect: false,
      rightClickSelectsWord: false,
      initialized: false
    })

    // 立即同步加载用户设置，避免显示默认值的闪烁
    const initializeTerminalSettings = () => {
      try {
        if (settingsService.isInitialized) {
          const userSettings = settingsService.getTerminalSettings()
          if (userSettings) {
            Object.assign(terminalSettings, userSettings)
            terminalSettings.initialized = true
          }
        }
      } catch (error) {
        console.warn('同步加载终端设置失败:', error)
      }
    }

    // 立即执行初始化
    initializeTerminalSettings()
    
    // 终端背景图片设置
    const terminalBgSettings = reactive({
      enabled: false,
      url: '',
      opacity: 0.5,
      mode: 'cover',
      initialized: false
    })
    
    // 连接设置
    const connectionSettings = reactive({
      autoReconnect: true,
      reconnectInterval: 3,
      connectionTimeout: 10,
      keepAlive: true,
      keepAliveInterval: 30,
      initialized: false
    })
    
    // 界面设置
    const uiSettings = reactive({
      theme: 'dark',
      language: 'zh-CN',
      initialized: false
    })
    
    // 终端快捷键
    const terminalShortcuts = reactive([
      { description: '复制选中内容', key: 'Ctrl+Shift+C', action: 'terminal.copy' },
      { description: '粘贴', key: 'Ctrl+Shift+V', action: 'terminal.paste' },
      { description: '增加字体大小', key: 'Ctrl+Alt+=', action: 'accessibility.increaseFontSize' },
      { description: '减小字体大小', key: 'Ctrl+Alt+-', action: 'accessibility.decreaseFontSize' },
      { description: '清空终端', key: 'Ctrl+L', action: 'terminal.clear' },
      { description: '打开设置', key: 'Ctrl+,', action: 'settings.open' }
    ])

    // 更新CSS变量以供AppLayout使用
    const updateCssVariables = () => {
      if (terminalBgSettings.enabled && terminalBgSettings.url) {
        document.documentElement.style.setProperty('--terminal-bg-image', `url(${terminalBgSettings.url})`)
        document.documentElement.style.setProperty('--terminal-bg-opacity', terminalBgSettings.opacity.toString())

        // 设置背景尺寸
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
        document.documentElement.style.setProperty('--terminal-bg-size', backgroundSize)

        // 设置背景重复
        const backgroundRepeat = terminalBgSettings.mode === 'repeat' ? 'repeat' : 'no-repeat'
        document.documentElement.style.setProperty('--terminal-bg-repeat', backgroundRepeat)

        log.info('CSS变量已更新:', {
          image: terminalBgSettings.url,
          opacity: terminalBgSettings.opacity,
          size: backgroundSize,
          repeat: backgroundRepeat
        })
      } else {
        document.documentElement.style.removeProperty('--terminal-bg-image')
        document.documentElement.style.removeProperty('--terminal-bg-opacity')
        document.documentElement.style.removeProperty('--terminal-bg-size')
        document.documentElement.style.removeProperty('--terminal-bg-repeat')

        log.info('CSS变量已清除')
      }
    }

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
          log.debug('组件创建时加载背景设置:', { enabled: parsedBgSettings.enabled, opacity: parsedBgSettings.opacity }) // 简化日志输出

          // 立即更新CSS变量
          updateCssVariables()

          // 发送背景状态事件
          window.dispatchEvent(new CustomEvent('terminal-bg-status', {
            detail: {
              enabled: terminalBgSettings.enabled,
              bgSettings: terminalBgSettings
            }
          }))
        } catch (e) {
          log.error('解析终端背景设置失败:', e)
        }
      }
    } catch (error) {
      log.error('初始化读取背景设置失败:', error)
    }
    
    // 页面加载时立即检查本地存储中的连接设置
    try {
      if (settingsService.isInitialized) {
        const savedConnectionSettings = settingsService.getConnectionSettings()
        if (savedConnectionSettings) {
          // 更新连接设置
          Object.assign(connectionSettings, savedConnectionSettings)
          // 标记为已初始化
          connectionSettings.initialized = true
          log.debug('组件创建时加载连接设置:', connectionSettings) // 降低日志级别
        }
      }
    } catch (error) {
      log.error('初始化读取连接设置失败:', error)
    }

    // 页面加载时立即检查本地存储中的界面设置
    try {
      if (settingsService.isInitialized) {
        const savedUISettings = settingsService.getUISettings()
        if (savedUISettings) {
          // 更新界面设置
          Object.assign(uiSettings, savedUISettings)
          // 标记为已初始化
          uiSettings.initialized = true
          log.debug('组件创建时加载界面设置:', uiSettings) // 降低日志级别
        }
      }
    } catch (error) {
      log.error('初始化读取界面设置失败:', error)
    }
    
    // 初始化设置服务和加载设置
    const initializeSettings = async () => {
      try {
        // 确保设置服务已初始化
        if (!settingsService.isInitialized) {
          await settingsService.init()
        }

        const savedTerminalSettings = settingsService.getTerminalSettings()
        if (savedTerminalSettings) {
          // 更新终端设置
          Object.assign(terminalSettings, savedTerminalSettings)
          // 标记为已初始化
          terminalSettings.initialized = true
          log.debug('组件创建时从统一设置服务加载终端设置:', savedTerminalSettings) // 降低日志级别，只记录设置内容
        }
      } catch (error) {
        log.error('初始化读取终端设置失败:', error)
      }
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
    
    // 加载设置
    onMounted(async () => {
      // 初始化设置服务和加载设置
      await initializeSettings();

      // 初始化常规设置
      await loadSettings();
      
      // 调试键盘管理器加载 - 简化日志输出
      log.debug('Settings组件挂载，检查键盘管理器服务', {
        servicesExists: !!window.services,
        keyboardManagerExists: !!window.services?.keyboardManager,
        availableServices: window.services ? Object.keys(window.services) : []
      });
      
      // 尝试加载快捷键设置
      try {
        // 在window.services准备好后加载快捷键
        if (window.services?.keyboardManager) {
          log.debug('使用全局键盘管理器服务');
          loadShortcuts();
        } else {
          log.debug('使用本地键盘管理器');
          loadShortcuts(); // 使用本地键盘管理器

          // 仍然监听services就绪事件，以便在服务可用时再次加载
          window.addEventListener('services:ready', () => {
            log.debug('收到services就绪事件，切换到全局键盘管理器');
            if (window.services?.keyboardManager) {
              loadShortcuts();
            }
          }, { once: true });
        }
      } catch (error) {
        log.error('加载快捷键设置失败:', error);
      }
    });
    
    // 从存储加载设置
    const loadSettings = async () => {
      try {
        // 确保设置服务已初始化
        if (!settingsService.isInitialized) {
          await settingsService.init()
        }

        // 加载终端设置 - 避免重复日志
        const savedTerminalSettings = settingsService.getTerminalSettings()
        if (savedTerminalSettings && !terminalSettings.initialized) {
          Object.assign(terminalSettings, savedTerminalSettings)
          terminalSettings.initialized = true
          log.debug('loadSettings中更新终端设置') // 简化日志，避免重复输出大对象
        }
        
        // 加载终端背景图片设置
        const savedBgSettings = localStorage.getItem('easyssh_terminal_bg')
        if (savedBgSettings && !terminalBgSettings.initialized) {
          try {
            const parsedBgSettings = JSON.parse(savedBgSettings)
            // 检查状态是否与初始化时加载的不同
            if (terminalBgSettings.enabled !== parsedBgSettings.enabled) {
              Object.assign(terminalBgSettings, parsedBgSettings)
              log.debug('loadSettings中更新背景设置状态变化') // 简化日志
            }
            
            // 无论如何都发送背景状态事件，确保系统各部分状态一致
            window.dispatchEvent(new CustomEvent('terminal-bg-status', { 
              detail: { enabled: terminalBgSettings.enabled } 
            }))
          } catch (e) {
            log.error('解析终端背景设置失败:', e)
          }
        }
        
        // 加载连接设置 - 避免重复日志
        const savedConnectionSettings = settingsService.getConnectionSettings()
        if (savedConnectionSettings && !connectionSettings.initialized) {
          Object.assign(connectionSettings, savedConnectionSettings)
          connectionSettings.initialized = true
          log.debug('loadSettings中更新连接设置') // 简化日志
        }

        // 加载界面设置 - 避免重复日志
        const savedUISettings = settingsService.getUISettings()
        if (savedUISettings && !uiSettings.initialized) {
          Object.assign(uiSettings, savedUISettings)
          uiSettings.initialized = true
          log.debug('loadSettings中更新界面设置') // 简化日志
        }
      } catch (error) {
        log.error('加载设置失败', error)
        ElMessage.error('加载设置失败')
      }
    }
    
    // 更新终端背景设置
    const updateTerminalBg = () => {
      try {
        // 标记为已初始化
        terminalBgSettings.initialized = true

        // 保存终端背景设置到本地存储
        localStorage.setItem('easyssh_terminal_bg', JSON.stringify(terminalBgSettings))

        // 立即更新CSS变量
        updateCssVariables()

        // 创建自定义事件，通知终端组件更新背景
        const event = new CustomEvent('terminal-bg-changed', { detail: terminalBgSettings })
        window.dispatchEvent(event)

        // 立即触发状态更新事件，确保控制面板和其他组件能够立即感知到状态变化
        window.dispatchEvent(new CustomEvent('terminal-bg-status', {
          detail: {
            enabled: terminalBgSettings.enabled,
            bgSettings: terminalBgSettings
          }
        }))

        log.info('终端背景设置已更新:', terminalBgSettings)
        ElMessage.success('终端背景设置已更新')
      } catch (error) {
        log.error('保存终端背景设置失败', error)
        ElMessage.error('保存终端背景设置失败')
      }
    }

    // 保存终端设置
    const saveTerminalSettings = async () => {
      try {
        // 标记为已初始化
        terminalSettings.initialized = true

        // 确保设置服务已初始化
        if (!settingsService.isInitialized) {
          await settingsService.init()
        }

        // 保存设置到统一设置服务，并立即应用到所有终端
        settingsService.updateTerminalSettings(terminalSettings, true)

        // 发送全局事件，通知所有终端设置已更新（用于动态更新复制粘贴功能）
        window.dispatchEvent(new CustomEvent('terminal-settings-updated', {
          detail: { settings: terminalSettings }
        }))

        log.info('终端设置已保存到统一设置服务并应用到所有终端:', terminalSettings)

        // 检查当前是否有打开的终端来显示相应的消息
        const terminalIds = Object.keys(terminalStore.terminals || {})

        if (terminalIds.length > 0) {
          ElMessage.success(`终端设置已保存并应用到 ${terminalIds.length} 个终端`)
        } else {
          ElMessage.success('终端设置已保存')
        }
      } catch (error) {
        log.error('保存终端设置失败', error)
        ElMessage.error('保存终端设置失败')
      }
    }

    // 保存连接设置
    const saveConnectionSettings = async () => {
      try {
        // 标记为已初始化
        connectionSettings.initialized = true

        // 确保设置服务已初始化
        if (!settingsService.isInitialized) {
          await settingsService.init()
        }

        // 保存到统一设置服务
        settingsService.updateConnectionSettings(connectionSettings)
        ElMessage.success('连接设置已保存')
      } catch (error) {
        log.error('保存连接设置失败', error)
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
      if (connectionSettings.keepAliveInterval > 30) {
        connectionSettings.keepAliveInterval -= 1
        saveConnectionSettings()
      }
    }
    
    // 保存界面设置
    const saveUISettings = async () => {
      try {
        // 标记为已初始化
        uiSettings.initialized = true

        // 确保设置服务已初始化
        if (!settingsService.isInitialized) {
          await settingsService.init()
        }

        // 保存到统一设置服务
        settingsService.updateUISettings(uiSettings)
        ElMessage.success('界面设置已保存')

        // 应用主题变更
        if (uiSettings.theme === 'system') {
          const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
          document.documentElement.setAttribute('data-theme', isDarkMode ? 'dark' : 'light')
        } else {
          document.documentElement.setAttribute('data-theme', uiSettings.theme)
        }
      } catch (error) {
        log.error('保存界面设置失败', error)
        ElMessage.error('保存界面设置失败')
      }
    }
    
    // 更新快捷键设置
    const updateShortcut = (shortcut, newValue) => {
      try {
        // 检查冲突（与其他快捷键是否重复）
        const duplicateShortcut = terminalShortcuts.find(
          s => s.action !== shortcut.action && s.key === newValue
        );
        
        if (duplicateShortcut) {
          // 有冲突，弹出确认对话框
          ElMessageBox.confirm(
            `快捷键 "${newValue}" 已被 "${duplicateShortcut.description}" 使用，要替换吗？`,
            '快捷键冲突',
            {
              confirmButtonText: '替换',
              cancelButtonText: '取消',
              type: 'warning',
            }
          ).then(() => {
            // 用户确认替换，为避免两个操作使用同一个快捷键，先清除现有的
            duplicateShortcut.key = ''; // 清除冲突快捷键
            
            // 更新快捷键值
            shortcut.key = newValue;
            
            // 获取键盘管理器服务，优先使用全局服务，其次使用本地管理器
            const keyboardManager = window.services?.keyboardManager || localKeyboardManager;
            
            // 调用键盘管理器服务进行设置
            keyboardManager.setCustomShortcut(shortcut.action, newValue);
            ElMessage.success(`快捷键 "${shortcut.description}" 已更新为 ${newValue}`);
            
            // 重置后，重新加载所有快捷键以确保一致性
            loadShortcuts();
          }).catch(() => {
            // 用户取消替换，恢复为原值
            const keyboardManager = window.services?.keyboardManager || localKeyboardManager;
            const originalShortcut = keyboardManager.getShortcutForAction(shortcut.action);
            if (originalShortcut) {
              shortcut.key = originalShortcut.key;
            }
            
            ElMessage.info('已取消快捷键更新');
          });
        } else {
          // 无冲突，直接更新
          // 更新快捷键值
          shortcut.key = newValue;
          
          // 获取键盘管理器服务，优先使用全局服务，其次使用本地管理器
          const keyboardManager = window.services?.keyboardManager || localKeyboardManager;
          
          // 调用键盘管理器服务进行设置
          keyboardManager.setCustomShortcut(shortcut.action, newValue);
          ElMessage.success(`快捷键 "${shortcut.description}" 已更新为 ${newValue}`);
        }
      } catch (error) {
        log.error('更新快捷键失败', error);
        ElMessage.error(`更新快捷键失败：${error.message}`);
        
        // 恢复原快捷键值（从键盘管理器获取）
        const keyboardManager = window.services?.keyboardManager || localKeyboardManager;
        const originalShortcut = keyboardManager.getShortcutForAction(shortcut.action);
        if (originalShortcut) {
          shortcut.key = originalShortcut.key;
        }
      }
    };
    
    // 添加重置状态
    const resettingShortcuts = ref(false);
    
    // 重置所有快捷键
    const resetAllShortcuts = () => {
      ElMessageBox.confirm(
        '确定要将所有快捷键重置为默认值吗？这将删除所有自定义快捷键设置。',
        '重置快捷键',
        {
          confirmButtonText: '确定重置',
          cancelButtonText: '取消',
          type: 'warning',
        }
      ).then(async () => {
        try {
          resettingShortcuts.value = true;
          
          // 获取键盘管理器服务
          const keyboardManager = window.services?.keyboardManager || localKeyboardManager;
          
          // 调用重置方法
          await keyboardManager.resetAllShortcuts();
          
          // 重新加载快捷键
          loadShortcuts();
          
          ElMessage.success('所有快捷键已重置为默认值');
        } catch (error) {
          log.error('重置快捷键失败', error);
          ElMessage.error(`重置快捷键失败：${error.message || '未知错误'}`);
        } finally {
          resettingShortcuts.value = false;
        }
      }).catch(() => {
        ElMessage.info('已取消重置操作');
      });
    };
    
    // 加载快捷键设置
    const loadShortcuts = () => {
      // 获取键盘管理器服务，优先使用全局服务，其次使用本地管理器
      const keyboardManager = window.services?.keyboardManager || localKeyboardManager;
      
      // 加载每个快捷键的当前值
      terminalShortcuts.forEach(shortcut => {
        const shortcutInfo = keyboardManager.getShortcutForAction(shortcut.action);
        if (shortcutInfo) {
          shortcut.key = shortcutInfo.key;
        }
      });
    }
    
    return {
      terminalSettings,
      terminalBgSettings,
      connectionSettings,
      uiSettings,
      terminalShortcuts,
      bgPreviewStyle,
      saveTerminalSettings,
      updateTerminalBg,
      saveConnectionSettings,
      saveUISettings,
      incrementReconnectInterval,
      decrementReconnectInterval,
      incrementConnectionTimeout,
      decrementConnectionTimeout,
      incrementKeepAliveInterval,
      decrementKeepAliveInterval,
      updateShortcut,
      resetAllShortcuts,
      resettingShortcuts,
      loadShortcuts
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

/* 快捷键样式 */
.terminal-shortcuts-settings {
  padding: 15px;
  border-radius: 8px;
  background-color: rgba(0, 0, 0, 0.2);
}

.theme-section-title {
  margin-bottom: 15px;
  font-size: 16px;
  font-weight: 500;
  color: var(--font-color, #e0e0e0);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.shortcut-actions {
  display: flex;
  gap: 10px;
}

.shortcuts-container {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 10px;
  margin-top: 10px;
}

.shortcut-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background-color: var(--card-bg-color, rgba(30, 30, 30, 0.5));
  border-radius: 4px;
  margin-bottom: 5px;
}

.shortcut-description {
  font-size: 14px;
  color: var(--font-color, #e0e0e0);
  margin-right: 10px;
  flex: 1;
}

.shortcut-key {
  font-family: monospace;
  font-size: 13px;
  background-color: var(--keyboard-bg, rgba(50, 50, 50, 0.8));
  padding: 3px 8px;
  border-radius: 4px;
  color: var(--keyboard-color, #ffffff);
}

/* 浅色主题适配 */
:root[data-theme="light"] .shortcut-description {
  color: #333;
}

:root[data-theme="light"] .shortcut-key {
  background-color: rgba(200, 200, 200, 0.8);
  color: #333;
}
</style> 