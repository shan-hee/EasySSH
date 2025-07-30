<template>
  <Modal 
    v-model:visible="isVisible" 
    title="设置"
    customClass="user-settings-modal"
    :hide-footer="true"
    @close="handleClose"
  >
    <div class="user-settings-container">
      <!-- 左侧菜单 -->
      <div class="settings-sidebar">
        <div class="menu-list">
          <div 
            class="menu-item"
            :class="{ active: activeMenu === 'account' }"
            @click="activeMenu = 'account'"
          >
            <div class="menu-icon">
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path fill="currentColor" d="M12,4A4,4 0 0,1 16,8A4,4 0 0,1 12,12A4,4 0 0,1 8,8A4,4 0 0,1 12,4M12,14C16.42,14 20,15.79 20,18V20H4V18C4,15.79 7.58,14 12,14Z" />
              </svg>
            </div>
            <span class="menu-text">账户设置</span>
          </div>
          
          <div
            class="menu-item"
            :class="{ active: activeMenu === 'security' }"
            @click="activeMenu = 'security'"
          >
            <div class="menu-icon">
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path fill="currentColor" d="M12,1L3,5V11C3,16.55 6.84,21.74 12,23C17.16,21.74 21,16.55 21,11V5L12,1M12,7C13.4,7 14.8,8.6 14.8,10V11H16V18H8V11H9.2V10C9.2,8.6 10.6,7 12,7M12,8.2C11.2,8.2 10.4,8.7 10.4,10V11H13.6V10C13.6,8.7 12.8,8.2 12,8.2Z" />
              </svg>
            </div>
            <span class="menu-text">安全设置</span>
          </div>

          <div
            class="menu-item"
            :class="{ active: activeMenu === 'terminal' }"
            @click="activeMenu = 'terminal'"
          >
            <div class="menu-icon">
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path fill="currentColor" d="M20,19V7H4V19H20M20,3A2,2 0 0,1 22,5V19A2,2 0 0,1 20,21H4A2,2 0 0,1 2,19V5C2,3.89 2.9,3 4,3H20M13,17V15H18V17H13M9.58,13L5.57,9H8.4L11.7,12.3C12.09,12.69 12.09,13.33 11.7,13.72L8.42,17H5.59L9.58,13Z" />
              </svg>
            </div>
            <span class="menu-text">终端设置</span>
          </div>

          <div
            class="menu-item"
            :class="{ active: activeMenu === 'connection' }"
            @click="activeMenu = 'connection'"
          >
            <div class="menu-icon">
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path fill="currentColor" d="M15,9H9V7.5H15M15,16.5H9V15H15M21,5V19A2,2 0 0,1 19,21H5A2,2 0 0,1 3,19V5A2,2 0 0,1 5,3H19A2,2 0 0,1 21,5M19,5H5V19H19V5Z" />
              </svg>
            </div>
            <span class="menu-text">连接设置</span>
          </div>
        </div>
      </div>
      
      <!-- 右侧内容区域 -->
      <div class="settings-content">
        <!-- 账户设置面板 -->
        <div v-if="activeMenu === 'account'" class="content-panel">
          <div class="panel-body">
            <!-- 用户名修改 -->
            <div class="form-group">
              <label>用户名</label>
              <div class="input-group">
                <input 
                  v-model="accountForm.username" 
                  type="text" 
                  placeholder="请输入用户名"
                  class="form-input"
                />
              </div>
            </div>
            
            <!-- 密码修改 -->
            <div class="form-group">
              <label>原密码</label>
              <div class="input-group">
                <input 
                  v-model="accountForm.oldPassword" 
                  type="password" 
                  placeholder="请输入原密码"
                  class="form-input"
                />
              </div>
            </div>
            
            <div class="form-group">
              <label>新密码</label>
              <div class="input-group">
                <input 
                  v-model="accountForm.newPassword" 
                  type="password" 
                  placeholder="请输入新密码"
                  class="form-input"
                />
              </div>
            </div>
          </div>
          
          <div class="panel-footer">
            <button class="btn btn-primary" @click="updateAccount" :disabled="isLoading">
              <span v-if="isLoading" class="btn-loading"></span>
              {{ isLoading ? '保存中...' : '保存更改' }}
            </button>
          </div>
        </div>
        
        <!-- 安全设置面板 -->
        <div v-if="activeMenu === 'security'" class="content-panel">
          <div class="panel-body">
            <!-- 两步验证 -->
            <div class="security-item">
              <div class="security-info">
                <div class="security-title">
                  两步验证
                  <span v-if="securityForm.mfaEnabled" class="status-badge enabled">已启用</span>
                  <span v-else class="status-badge disabled">未启用</span>
                </div>
                <div class="security-description">
                  在登录时需要通过额外的安全步骤，如果您无法通过此验证，请联系管理员。
                </div>
              </div>
              <div class="security-action">
                <button 
                  class="btn btn-outline" 
                  @click="handleMfaToggle"
                  :disabled="isLoading"
                >
                  {{ securityForm.mfaEnabled ? '禁用' : '启用' }}
                </button>
              </div>
            </div>
            
            <!-- 注销所有设备 -->
            <div class="security-item">
              <div class="security-info">
                <div class="security-title">注销所有设备</div>
                <div class="security-description">
                  立即终止您当前账号在所有设备上的登录状态，提高账号安全性。操作后您需要重新登录，其他设备的会话可能在 30 分钟内逐步失效。
                </div>
              </div>
              <div class="security-action">
                <button 
                  class="btn btn-danger" 
                  @click="showLogoutAllDevicesModal = true"
                  :disabled="isLoading"
                >
                  注销
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 终端设置面板 -->
        <div v-if="activeMenu === 'terminal'" class="content-panel">
          <div class="panel-body">

            <!-- 终端基础设置 -->
            <div class="settings-section">
              <h4 class="section-title">基础设置</h4>

              <!-- 终端主题 -->
              <div class="form-group form-group-horizontal">
                <label>终端主题</label>
                <select
                  v-model="terminalSettings.theme"
                  @change="saveTerminalSettings"
                  class="form-select"
                >
                  <option value="dark">深色主题</option>
                  <option value="light">浅色主题</option>
                  <option value="dracula">Dracula</option>
                  <option value="vscode">VSCode</option>
                  <option value="material">Material</option>
                </select>
              </div>

              <!-- 光标样式 -->
              <div class="form-group form-group-horizontal">
                <label>光标样式</label>
                <select
                  v-model="terminalSettings.cursorStyle"
                  @change="saveTerminalSettings"
                  class="form-select"
                >
                  <option value="block">块状</option>
                  <option value="underline">下划线</option>
                  <option value="bar">竖线</option>
                </select>
              </div>

              <!-- 终端字体 -->
              <div class="form-group form-group-horizontal">
                <label>终端字体</label>
                <select
                  v-model="terminalSettings.fontFamily"
                  @change="saveTerminalSettings"
                  class="form-select"
                >
                  <option value="'JetBrains Mono'">JetBrains Mono</option>
                  <option value="'Menlo'">Menlo</option>
                  <option value="'Courier New'">Courier New</option>
                  <option value="'DejaVu Sans Mono'">DejaVu Sans Mono</option>
                  <option value="'Ubuntu Mono'">Ubuntu Mono</option>
                </select>
              </div>

              <!-- 字体大小 -->
              <div class="form-group">
                <label>字体大小</label>
                <div class="slider-container">
                  <input
                    type="range"
                    v-model="terminalSettings.fontSize"
                    min="8"
                    max="24"
                    step="1"
                    @input="saveTerminalSettings"
                    class="form-slider"
                  />
                  <span class="slider-value">{{ terminalSettings.fontSize }}px</span>
                </div>
              </div>

              <!-- 开关设置 -->
              <div class="settings-section">
                <!-- 选中复制 -->
                <div class="security-item">
                  <div class="security-info">
                    <div class="security-title">
                      选中复制
                      <span v-if="terminalSettings.copyOnSelect" class="status-badge enabled">已启用</span>
                      <span v-else class="status-badge disabled">未启用</span>
                    </div>
                    <div class="security-description">
                      选中文本时自动复制到剪贴板，提高操作效率
                    </div>
                  </div>
                  <div class="security-action">
                    <button
                      class="btn btn-outline"
                      @click="terminalSettings.copyOnSelect = !terminalSettings.copyOnSelect; saveTerminalSettings()"
                    >
                      {{ terminalSettings.copyOnSelect ? '禁用' : '启用' }}
                    </button>
                  </div>
                </div>

                <!-- 右键粘贴 -->
                <div class="security-item">
                  <div class="security-info">
                    <div class="security-title">
                      右键粘贴
                      <span v-if="terminalSettings.rightClickSelectsWord" class="status-badge enabled">已启用</span>
                      <span v-else class="status-badge disabled">未启用</span>
                    </div>
                    <div class="security-description">
                      右键单击时自动粘贴剪贴板内容，快速输入文本
                    </div>
                  </div>
                  <div class="security-action">
                    <button
                      class="btn btn-outline"
                      @click="terminalSettings.rightClickSelectsWord = !terminalSettings.rightClickSelectsWord; saveTerminalSettings()"
                    >
                      {{ terminalSettings.rightClickSelectsWord ? '禁用' : '启用' }}
                    </button>
                  </div>
                </div>

                <!-- 光标闪烁 -->
                <div class="security-item">
                  <div class="security-info">
                    <div class="security-title">
                      光标闪烁
                      <span v-if="terminalSettings.cursorBlink" class="status-badge enabled">已启用</span>
                      <span v-else class="status-badge disabled">未启用</span>
                    </div>
                    <div class="security-description">
                      光标定期闪烁以提高可见性，便于定位输入位置
                    </div>
                  </div>
                  <div class="security-action">
                    <button
                      class="btn btn-outline"
                      @click="terminalSettings.cursorBlink = !terminalSettings.cursorBlink; saveTerminalSettings()"
                    >
                      {{ terminalSettings.cursorBlink ? '禁用' : '启用' }}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- 终端背景设置 -->
            <div class="settings-section">
              <h4 class="section-title">终端背景</h4>

              <!-- 启用背景图片 -->
              <div class="security-item">
                <div class="security-info">
                  <div class="security-title">
                    背景图片
                    <span v-if="terminalBgSettings.enabled" class="status-badge enabled">已启用</span>
                    <span v-else class="status-badge disabled">未启用</span>
                  </div>
                  <div class="security-description">
                    为终端设置自定义背景图片，个性化您的工作环境
                  </div>
                </div>
                <div class="security-action">
                  <button
                    class="btn btn-outline"
                    @click="terminalBgSettings.enabled = !terminalBgSettings.enabled; updateTerminalBg()"
                  >
                    {{ terminalBgSettings.enabled ? '禁用' : '启用' }}
                  </button>
                </div>
              </div>

              <template v-if="terminalBgSettings.enabled">
                <div class="form-group">
                  <label>图片URL</label>
                  <input
                    type="text"
                    v-model="terminalBgSettings.url"
                    placeholder="输入图片URL"
                    @change="updateTerminalBg"
                    class="form-input"
                  />
                </div>

                <div class="form-row-flex">
                  <div class="form-group flex-item">
                    <label>透明度</label>
                    <div class="slider-container">
                      <input
                        type="range"
                        v-model="terminalBgSettings.opacity"
                        min="0.1"
                        max="1"
                        step="0.05"
                        @input="updateTerminalBg"
                        class="form-slider"
                      />
                      <span class="slider-value">{{ Math.round(terminalBgSettings.opacity * 100) }}%</span>
                    </div>
                  </div>

                  <div class="form-group flex-item">
                    <label>显示模式</label>
                    <select
                      v-model="terminalBgSettings.mode"
                      @change="updateTerminalBg"
                      class="form-select"
                    >
                      <option value="cover">适应(cover)</option>
                      <option value="contain">包含(contain)</option>
                      <option value="fill">填充(fill)</option>
                      <option value="none">原始大小</option>
                      <option value="repeat">重复平铺</option>
                    </select>
                  </div>
                </div>

                <div class="form-group">
                  <label>背景预览</label>
                  <div class="terminal-bg-preview" :style="bgPreviewStyle">
                    <div class="preview-label">背景预览</div>
                  </div>
                </div>
              </template>
            </div>

            <!-- 终端快捷键设置 -->
            <div class="settings-section">
              <div class="section-title-with-actions">
                <h4 class="section-title">终端快捷键</h4>
                <button
                  class="btn btn-outline btn-sm"
                  @click="resetAllShortcuts"
                  :disabled="resettingShortcuts"
                >
                  {{ resettingShortcuts ? '重置中...' : '重置为默认值' }}
                </button>
              </div>

              <div class="shortcuts-container">
                <div class="shortcut-item" v-for="(shortcut, index) in terminalShortcuts" :key="index">
                  <div class="shortcut-description">{{ shortcut.description }}</div>
                  <div class="shortcut-key-editor">
                    <input
                      type="text"
                      v-model="shortcut.key"
                      @blur="updateShortcut(shortcut, shortcut.key)"
                      @keydown.enter="$event.target.blur()"
                      class="shortcut-input"
                      placeholder="按键组合"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 连接设置面板 -->
        <div v-if="activeMenu === 'connection'" class="content-panel">
          <div class="panel-body">


            <div class="settings-section">
              <h4 class="section-title">连接配置</h4>

              <!-- 自动重连 -->
              <div class="security-item">
                <div class="security-info">
                  <div class="security-title">
                    自动重连
                    <span v-if="connectionSettings.autoReconnect" class="status-badge enabled">已启用</span>
                    <span v-else class="status-badge disabled">未启用</span>
                  </div>
                  <div class="security-description">
                    连接意外断开时自动尝试重新连接，提高连接稳定性
                  </div>
                </div>
                <div class="security-action">
                  <button
                    class="btn btn-outline"
                    @click="connectionSettings.autoReconnect = !connectionSettings.autoReconnect; saveConnectionSettings()"
                  >
                    {{ connectionSettings.autoReconnect ? '禁用' : '启用' }}
                  </button>
                </div>
              </div>

              <!-- 重连间隔 -->
              <div class="security-item">
                <div class="security-info">
                  <div class="security-title">重连间隔</div>
                  <div class="security-description">
                    自动重连的时间间隔，建议设置为 3-10 秒之间
                  </div>
                </div>
                <div class="security-action">
                  <div class="number-input-with-controls">
                    <button class="control-btn" @click="decrementReconnectInterval">－</button>
                    <span class="number-display">{{ connectionSettings.reconnectInterval }}秒</span>
                    <button class="control-btn" @click="incrementReconnectInterval">＋</button>
                  </div>
                </div>
              </div>

              <!-- 连接超时 -->
              <div class="security-item">
                <div class="security-info">
                  <div class="security-title">连接超时</div>
                  <div class="security-description">
                    建立连接的最大等待时间，超时后将终止连接尝试
                  </div>
                </div>
                <div class="security-action">
                  <div class="number-input-with-controls">
                    <button class="control-btn" @click="decrementConnectionTimeout">－</button>
                    <span class="number-display">{{ connectionSettings.connectionTimeout }}秒</span>
                    <button class="control-btn" @click="incrementConnectionTimeout">＋</button>
                  </div>
                </div>
              </div>

              <!-- 保持连接 -->
              <div class="security-item">
                <div class="security-info">
                  <div class="security-title">
                    保持连接
                    <span v-if="connectionSettings.keepAlive" class="status-badge enabled">已启用</span>
                    <span v-else class="status-badge disabled">未启用</span>
                  </div>
                  <div class="security-description">
                    定期发送心跳包保持连接活跃，防止长时间无操作时连接被断开
                  </div>
                </div>
                <div class="security-action">
                  <button
                    class="btn btn-outline"
                    @click="connectionSettings.keepAlive = !connectionSettings.keepAlive; saveConnectionSettings()"
                  >
                    {{ connectionSettings.keepAlive ? '禁用' : '启用' }}
                  </button>
                </div>
              </div>

              <!-- 心跳间隔 -->
              <div class="security-item" :class="{ disabled: !connectionSettings.keepAlive }">
                <div class="security-info">
                  <div class="security-title">心跳间隔</div>
                  <div class="security-description">
                    发送心跳包的时间间隔，仅在启用保持连接时生效
                  </div>
                </div>
                <div class="security-action">
                  <div class="number-input-with-controls" :class="{ disabled: !connectionSettings.keepAlive }">
                    <button class="control-btn" @click="decrementKeepAliveInterval" :disabled="!connectionSettings.keepAlive">－</button>
                    <span class="number-display">{{ connectionSettings.keepAliveInterval }}秒</span>
                    <button class="control-btn" @click="incrementKeepAliveInterval" :disabled="!connectionSettings.keepAlive">＋</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- MFA 相关弹窗 -->
    <MfaSetupModal 
      :visible="showMfaSetupModal"
      @update:visible="showMfaSetupModal = $event"
      @mfa-setup-complete="handleMfaSetupComplete"
      @mfa-setup-cancelled="handleMfaSetupCancelled"
    />
    
    <MfaDisableModal 
      :visible="showMfaDisableModal"
      @update:visible="showMfaDisableModal = $event"
      @mfa-disable-complete="handleMfaDisableComplete"
      @mfa-disable-cancelled="handleMfaDisableCancelled"
    />
    
    <!-- 注销所有设备弹窗 -->
    <LogoutAllDevicesModal 
      :visible="showLogoutAllDevicesModal"
      @update:visible="showLogoutAllDevicesModal = $event"
      @logout-complete="handleLogoutComplete"
      @logout-cancelled="handleLogoutCancelled"
    />
  </Modal>
</template>

<script>
import { defineComponent, ref, onMounted, onUnmounted, computed, watch, reactive } from 'vue'
import { useUserStore } from '@/store/user'
import { useTerminalStore } from '@/store/terminal'
import { ElMessage } from 'element-plus'
import Modal from '@/components/common/Modal.vue'
import MfaSetupModal from '@/components/auth/MfaSetupModal.vue'
import MfaDisableModal from '@/components/auth/MfaDisableModal.vue'
import LogoutAllDevicesModal from '@/components/auth/LogoutAllDevicesModal.vue'
import mfaService from '@/services/mfa'
import settingsService from '@/services/settings'
import log from '@/services/log'
import { localKeyboardManager } from '@/utils/keyboard'

export default defineComponent({
  name: 'UserSettingsModal',
  components: {
    Modal,
    MfaSetupModal,
    MfaDisableModal,
    LogoutAllDevicesModal
  },
  props: {
    visible: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:visible', 'close'],
  setup(props, { emit }) {
    const userStore = useUserStore()
    const terminalStore = useTerminalStore()

    // 弹窗显示状态
    const isVisible = computed({
      get: () => props.visible,
      set: (value) => emit('update:visible', value)
    })


    
    // 当前激活的菜单
    const activeMenu = ref('account')
    
    // 加载状态
    const isLoading = ref(false)
    
    // 账户表单数据
    const accountForm = ref({
      username: '',
      oldPassword: '',
      newPassword: ''
    })
    
    // 安全表单数据
    const securityForm = ref({
      mfaEnabled: false
    })

    // 终端设置数据
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

    // 连接设置数据
    const connectionSettings = reactive({
      autoReconnect: true,
      reconnectInterval: 3,
      connectionTimeout: 10,
      keepAlive: true,
      keepAliveInterval: 30,
      initialized: false
    })

    // 终端背景设置数据
    const terminalBgSettings = reactive({
      enabled: false,
      url: '',
      opacity: 0.5,
      mode: 'cover',
      initialized: false
    })

    // 终端快捷键数据
    const terminalShortcuts = reactive([
      { description: '复制选中内容', key: 'Ctrl+Shift+C', action: 'terminal.copy' },
      { description: '粘贴', key: 'Ctrl+Shift+V', action: 'terminal.paste' },
      { description: '增加字体大小', key: 'Ctrl+Alt+=', action: 'accessibility.increaseFontSize' },
      { description: '减小字体大小', key: 'Ctrl+Alt+-', action: 'accessibility.decreaseFontSize' },
      { description: '清空终端', key: 'Ctrl+L', action: 'terminal.clear' },
      { description: '打开设置', key: 'Ctrl+,', action: 'settings.open' }
    ])

    // 重置状态
    const resettingShortcuts = ref(false)

    // MFA 相关弹窗状态
    const showMfaSetupModal = ref(false)
    const showMfaDisableModal = ref(false)
    const showLogoutAllDevicesModal = ref(false)

    // 背景预览样式计算属性
    const bgPreviewStyle = computed(() => {
      if (!terminalBgSettings.enabled || !terminalBgSettings.url) {
        return {
          backgroundColor: 'var(--color-bg-muted)'
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
    
    // 初始化数据
    const initializeData = async () => {
      accountForm.value.username = userStore.username || ''
      securityForm.value.mfaEnabled = userStore.userInfo.mfaEnabled || false

      // 初始化终端设置
      try {
        if (!settingsService.isInitialized) {
          await settingsService.init()
        }

        const savedTerminalSettings = settingsService.getTerminalSettings()
        if (savedTerminalSettings) {
          Object.assign(terminalSettings, savedTerminalSettings)
          terminalSettings.initialized = true
        }

        const savedConnectionSettings = settingsService.getConnectionSettings()
        if (savedConnectionSettings) {
          Object.assign(connectionSettings, savedConnectionSettings)
          connectionSettings.initialized = true
        }

        // 初始化终端背景设置
        const savedBgSettings = localStorage.getItem('easyssh_terminal_bg')
        if (savedBgSettings) {
          try {
            const parsedBgSettings = JSON.parse(savedBgSettings)
            Object.assign(terminalBgSettings, parsedBgSettings)
            terminalBgSettings.initialized = true
          } catch (e) {
            log.error('解析终端背景设置失败:', e)
          }
        }

        // 初始化快捷键设置
        loadShortcuts()
      } catch (error) {
        log.error('初始化设置失败:', error)
      }
    }
    
    // 更新账户信息
    const updateAccount = async () => {
      try {
        isLoading.value = true

        // 验证输入
        if (!accountForm.value.username.trim()) {
          ElMessage.error('用户名不能为空')
          return
        }

        // 构建更新数据
        const updateData = {
          username: accountForm.value.username.trim()
        }

        // 如果有密码修改
        if (accountForm.value.oldPassword || accountForm.value.newPassword) {
          if (!accountForm.value.oldPassword) {
            ElMessage.error('请输入原密码')
            return
          }
          if (!accountForm.value.newPassword) {
            ElMessage.error('请输入新密码')
            return
          }
          if (accountForm.value.newPassword.length < 6) {
            ElMessage.error('新密码长度不能少于6位')
            return
          }

          updateData.oldPassword = accountForm.value.oldPassword
          updateData.newPassword = accountForm.value.newPassword
        }

        // 调用更新接口
        await userStore.updateProfile(updateData)

        // 成功消息
        ElMessage.success('账户信息更新成功')

        // 清空密码字段
        accountForm.value.oldPassword = ''
        accountForm.value.newPassword = ''

      } catch (error) {
        console.error('更新账户信息失败:', error)
        ElMessage.error(error.message || '更新失败，请重试')
      } finally {
        isLoading.value = false
      }
    }
    
    // 处理MFA切换
    const handleMfaToggle = () => {
      if (securityForm.value.mfaEnabled) {
        // 如果已启用，显示禁用弹窗
        showMfaDisableModal.value = true
      } else {
        // 如果未启用，显示设置弹窗
        showMfaSetupModal.value = true
      }
    }

    // MFA相关事件处理
    const handleMfaSetupComplete = () => {
      showMfaSetupModal.value = false
      securityForm.value.mfaEnabled = true
      ElMessage.success('两步验证已启用')

      // 刷新用户信息
      initializeData()
    }

    const handleMfaSetupCancelled = () => {
      showMfaSetupModal.value = false
    }

    const handleMfaDisableComplete = () => {
      showMfaDisableModal.value = false
      securityForm.value.mfaEnabled = false
      ElMessage.success('两步验证已禁用')

      // 刷新用户信息
      initializeData()
    }

    const handleMfaDisableCancelled = () => {
      showMfaDisableModal.value = false
    }
    
    // 注销所有设备相关事件处理
    const handleLogoutComplete = () => {
      showLogoutAllDevicesModal.value = false
    }
    
    const handleLogoutCancelled = () => {
      showLogoutAllDevicesModal.value = false
    }
    
    // 保存终端设置
    const saveTerminalSettings = async () => {
      try {
        terminalSettings.initialized = true

        if (!settingsService.isInitialized) {
          await settingsService.init()
        }

        settingsService.updateTerminalSettings(terminalSettings, true)

        // 发送全局事件，通知所有终端设置已更新
        window.dispatchEvent(new CustomEvent('terminal-settings-updated', {
          detail: { settings: terminalSettings }
        }))

        log.info('终端设置已保存:', terminalSettings)
        ElMessage.success('终端设置已保存')
      } catch (error) {
        log.error('保存终端设置失败', error)
        ElMessage.error('保存终端设置失败')
      }
    }

    // 保存连接设置
    const saveConnectionSettings = async () => {
      try {
        connectionSettings.initialized = true

        if (!settingsService.isInitialized) {
          await settingsService.init()
        }

        settingsService.updateConnectionSettings(connectionSettings)
        ElMessage.success('连接设置已保存')
      } catch (error) {
        log.error('保存连接设置失败', error)
        ElMessage.error('保存连接设置失败')
      }
    }

    // 更新终端背景设置
    const updateTerminalBg = () => {
      try {
        terminalBgSettings.initialized = true

        // 保存终端背景设置到本地存储
        localStorage.setItem('easyssh_terminal_bg', JSON.stringify(terminalBgSettings))

        // 更新CSS变量
        updateCssVariables()

        // 创建自定义事件，通知终端组件更新背景
        const event = new CustomEvent('terminal-bg-changed', { detail: terminalBgSettings })
        window.dispatchEvent(event)

        // 立即触发状态更新事件
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
      } else {
        document.documentElement.style.removeProperty('--terminal-bg-image')
        document.documentElement.style.removeProperty('--terminal-bg-opacity')
        document.documentElement.style.removeProperty('--terminal-bg-size')
        document.documentElement.style.removeProperty('--terminal-bg-repeat')
      }
    }

    // 连接设置的数字控制方法
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

    // 更新快捷键设置
    const updateShortcut = (shortcut, newValue) => {
      try {
        // 检查冲突（与其他快捷键是否重复）
        const duplicateShortcut = terminalShortcuts.find(
          s => s.action !== shortcut.action && s.key === newValue
        );

        if (duplicateShortcut) {
          // 有冲突，弹出确认对话框
          if (confirm(`快捷键 "${newValue}" 已被 "${duplicateShortcut.description}" 使用，要替换吗？`)) {
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
          } else {
            // 用户取消替换，恢复为原值
            const keyboardManager = window.services?.keyboardManager || localKeyboardManager;
            const originalShortcut = keyboardManager.getShortcutForAction(shortcut.action);
            if (originalShortcut) {
              shortcut.key = originalShortcut.key;
            }

            ElMessage.info('已取消快捷键更新');
          }
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

    // 重置所有快捷键
    const resetAllShortcuts = () => {
      if (confirm('确定要将所有快捷键重置为默认值吗？这将删除所有自定义快捷键设置。')) {
        try {
          resettingShortcuts.value = true;

          // 获取键盘管理器服务
          const keyboardManager = window.services?.keyboardManager || localKeyboardManager;

          // 调用重置方法
          keyboardManager.resetAllShortcuts();

          // 重新加载快捷键
          loadShortcuts();

          ElMessage.success('所有快捷键已重置为默认值');
        } catch (error) {
          log.error('重置快捷键失败', error);
          ElMessage.error(`重置快捷键失败：${error.message || '未知错误'}`);
        } finally {
          resettingShortcuts.value = false;
        }
      }
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

    // 关闭弹窗
    const handleClose = () => {
      isVisible.value = false
      emit('close')
    }
    
    // 监听弹窗显示状态，初始化数据
    watch(() => props.visible, (newVal) => {
      if (newVal) {
        initializeData()
        activeMenu.value = 'account' // 默认显示账户设置
      }
    })

    onMounted(() => {
      initializeData()

      // 监听设置激活标签页的事件
      const handleSetActiveTab = (event) => {
        if (event?.detail?.activeTab) {
          activeMenu.value = event.detail.activeTab
        }
      }

      window.addEventListener('user-settings-set-active-tab', handleSetActiveTab)

      // 组件卸载时清理事件监听器
      onUnmounted(() => {
        window.removeEventListener('user-settings-set-active-tab', handleSetActiveTab)
      })
    })
    
    return {
      isVisible,
      activeMenu,
      isLoading,
      userStore,
      accountForm,
      securityForm,
      terminalSettings,
      connectionSettings,
      terminalBgSettings,
      terminalShortcuts,
      resettingShortcuts,
      bgPreviewStyle,
      showMfaSetupModal,
      showMfaDisableModal,
      showLogoutAllDevicesModal,
      updateAccount,
      handleMfaToggle,
      handleMfaSetupComplete,
      handleMfaSetupCancelled,
      handleMfaDisableComplete,
      handleMfaDisableCancelled,
      handleLogoutComplete,
      handleLogoutCancelled,
      saveTerminalSettings,
      saveConnectionSettings,
      updateTerminalBg,
      updateShortcut,
      resetAllShortcuts,
      loadShortcuts,
      incrementReconnectInterval,
      decrementReconnectInterval,
      incrementConnectionTimeout,
      decrementConnectionTimeout,
      incrementKeepAliveInterval,
      decrementKeepAliveInterval,
      handleClose
    }
  }
})
</script>

<style scoped>
/* 弹窗容器 */
:deep(.user-settings-modal) {
  width: 800px !important;
  max-width: 90vw !important;
  height: 600px !important;
  max-height: 80vh !important;
}

/* 弹窗标题样式覆盖 */
:deep(.user-settings-modal .modal-header) {
  padding: 20px 15px 0px 20px !important;
}

:deep(.user-settings-modal .modal-header > span) {
  font-size: 16px !important;
  font-weight: 500 !important;
}

/* 确保关闭按钮不受影响 */
:deep(.user-settings-modal .modal-header .close-btn) {
  font-size: 20px !important;
}

.user-settings-container {
  display: flex;
  height: 550px;
  background-color: var(--color-bg-page);
}

/* 左侧菜单栏 */
.settings-sidebar {
  width: 200px;
  background-color: var(--color-bg-page);
  padding: 0px 0 20px 0;
}

.menu-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.menu-item {
  display: flex;
  align-items: center;
  padding: 12px 20px;
  cursor: pointer;
  transition: all 0.2s ease;
  color: var(--color-text-secondary);
  border-radius: 0;
}

.menu-item:hover {
  color: var(--color-text-primary);
}

.menu-item.active {
  color: var(--color-text-primary);
}

.menu-icon {
  margin-right: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.menu-text {
  font-size: 14px;
  font-weight: 500;
}

/* 右侧内容区域 */
.settings-content {
  flex: 1;
  padding: 0;
  overflow-y: auto;
}

.content-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* 面板主体 */
.panel-body {
  flex: 1;
  padding: 12px 32px 32px 32px;
  overflow-y: auto;
}

/* 表单组件 */
.form-group {
  margin-bottom: 24px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-primary);
}

/* 水平布局的表单组 */
.form-group-horizontal {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.form-group-horizontal label {
  display: block;
  margin-bottom: 0;
  margin-right: 16px;
  flex-shrink: 0;
  min-width: 80px;
}

.form-group-horizontal .form-select {
  flex: 1;
  max-width: 200px;
}

.input-group {
  position: relative;
}

.form-input {
  width: 100%;
  padding: 12px 16px;
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  background-color: var(--color-bg-container);
  color: var(--color-text-primary);
  font-size: 14px;
  transition: all 0.2s ease;
  box-sizing: border-box;
}

.form-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px var(--color-primary-lightest);
}

.form-input::placeholder {
  color: var(--color-text-placeholder);
}

/* 安全设置项 */
.security-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 20px 0;
  border-bottom: 1px solid var(--color-border-light);
}

.security-item:last-child {
  border-bottom: none;
}

.security-info {
  flex: 1;
  margin-right: 20px;
}

.security-title {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
  font-size: 16px;
  font-weight: 500;
  color: var(--color-text-primary);
}

.security-description {
  font-size: 14px;
  color: var(--color-text-secondary);
  line-height: 1.5;
}

.security-action {
  flex-shrink: 0;
}

.security-item.disabled {
  opacity: 0.6;
}

.security-item.disabled .security-title,
.security-item.disabled .security-description {
  color: var(--color-text-disabled);
}

/* 状态徽章 */
.status-badge {
  margin-left: 12px;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}

.status-badge.enabled {
  background-color: var(--color-success-bg);
  color: var(--color-success);
}

.status-badge.disabled {
  background-color: var(--color-warning-bg);
  color: var(--color-warning);
}

/* 面板底部 */
.panel-footer {
  padding: 0 32px 32px;
  display: flex;
  justify-content: flex-end;
}

/* 按钮样式 */
.btn {
  padding: 10px 20px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-primary {
  background-color: var(--btn-primary-bg);
  color: var(--btn-primary-text);
  border-color: var(--btn-primary-bg);
}

.btn-primary:hover:not(:disabled) {
  background-color: var(--btn-primary-hover-bg);
}

.btn-outline {
  background-color: transparent;
  color: var(--color-text-primary);
  border-color: var(--color-border-default);
}

.btn-outline:hover:not(:disabled) {
  background-color: var(--color-hover-bg);
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.btn-danger {
  background-color: var(--color-error);
  color: white;
  border-color: var(--color-error);
}

.btn-danger:hover:not(:disabled) {
  background-color: var(--color-error-hover);
}

/* 加载动画 */
.btn-loading {
  width: 14px;
  height: 14px;
  border: 2px solid transparent;
  border-top: 2px solid currentColor;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

/* 响应式设计 */
@media (max-width: 768px) {
  :deep(.user-settings-modal) {
    width: 95vw !important;
    height: 90vh !important;
  }

  .user-settings-container {
    flex-direction: column;
    height: auto;
  }

  .settings-sidebar {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--color-border-default);
  }

  .menu-list {
    flex-direction: row;
    overflow-x: auto;
  }

  .menu-item {
    flex-shrink: 0;
    min-width: 120px;
    justify-content: center;
  }

  .menu-item.active {
    border-right: none;
    border-bottom: 3px solid var(--color-primary);
  }
}

/* 设置界面样式 */
.settings-section {
  margin-bottom: 32px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 20px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--color-border-muted);
}

/* 响应式布局 */
@media (max-width: 768px) {
  .form-row-flex {
    flex-direction: column;
    gap: 16px;
  }

  .shortcuts-container {
    grid-template-columns: 1fr;
  }

  .shortcut-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .shortcut-key-editor {
    width: 100%;
  }

  .shortcut-input {
    width: 100%;
  }
}

/* 表单布局 */
.form-row-flex {
  display: flex;
  gap: 20px;
  margin-bottom: 20px;
}

.flex-item {
  flex: 1;
  min-width: 0;
}

/* 表单选择框 */
.form-select {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  background-color: var(--color-bg-container);
  color: var(--color-text-primary);
  font-size: 14px;
  transition: all 0.2s ease;
}

.form-select:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px var(--color-primary-lightest);
}

/* 滑块容器 */
.slider-container {
  display: flex;
  align-items: center;
  gap: 12px;
}

.form-slider {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: var(--color-border-muted);
  outline: none;
  -webkit-appearance: none;
}

.form-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-primary);
  cursor: pointer;
  border: 2px solid white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.form-slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-primary);
  cursor: pointer;
  border: 2px solid white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.slider-value {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-primary);
  min-width: 45px;
  text-align: right;
}

/* 开关样式 */
.switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.switch-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--color-border-muted);
  transition: 0.3s;
  border-radius: 24px;
}

.switch-slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: 0.3s;
  border-radius: 50%;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.switch input:checked + .switch-slider {
  background-color: var(--color-primary);
}

.switch input:checked + .switch-slider:before {
  transform: translateX(20px);
}

/* 数字输入控件 */
.number-input-with-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: flex-start;
  width: 100%;
}

.number-display {
  font-size: 14px;
  color: var(--color-text-primary);
  min-width: 20px;
  text-align: center;
  font-weight: 500;
}

.control-btn {
  background-color: transparent;
  border: 1px solid var(--color-border-default);
  color: var(--color-text-primary);
  font-size: 14px;
  cursor: pointer;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.control-btn:hover:not(:disabled) {
  background-color: var(--color-bg-muted);
  border-color: var(--color-primary);
}

.control-btn:active:not(:disabled) {
  background-color: var(--color-primary-lightest);
}

.control-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.number-input-with-controls.disabled {
  opacity: 0.6;
}

.number-input-with-controls.disabled .control-btn {
  cursor: not-allowed;
  opacity: 0.5;
}

/* 终端背景预览 */
.terminal-bg-preview {
  width: 100%;
  height: 120px;
  margin-top: 10px;
  border-radius: 6px;
  position: relative;
  overflow: hidden;
  background-color: var(--color-bg-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-border-default);
}

.preview-label {
  color: var(--color-text-secondary);
  font-size: 14px;
  position: relative;
  z-index: 2;
  background-color: rgba(0, 0, 0, 0.6);
  color: white;
  padding: 5px 10px;
  border-radius: 4px;
}

/* 快捷键设置样式 */
.section-title-with-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--color-border-muted);
}

.section-title-with-actions .section-title {
  margin-bottom: 0;
  padding-bottom: 0;
  border-bottom: none;
}

.btn-outline {
  background-color: transparent;
  border: 1px solid var(--color-border-default);
  color: var(--color-text-primary);
}

.btn-outline:hover:not(:disabled) {
  background-color: var(--color-bg-muted);
  border-color: var(--color-primary);
}

.btn-sm {
  padding: 6px 12px;
  font-size: 12px;
}

.shortcuts-container {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  margin-top: 10px;
}

.shortcut-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background-color: var(--color-bg-container);
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  transition: all 0.2s ease;
}

.shortcut-item:hover {
  border-color: var(--color-primary-light);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.shortcut-description {
  font-size: 14px;
  color: var(--color-text-primary);
  margin-right: 12px;
  flex: 1;
  font-weight: 500;
}

.shortcut-key-editor {
  flex-shrink: 0;
}

.shortcut-input {
  font-family: monospace;
  font-size: 13px;
  background-color: var(--color-bg-muted);
  padding: 4px 8px;
  border: 1px solid var(--color-border-default);
  border-radius: 4px;
  color: var(--color-text-primary);
  min-width: 120px;
  text-align: center;
  transition: all 0.2s ease;
}

.shortcut-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px var(--color-primary-lightest);
}



/* 禁用状态样式 */
.form-select:disabled,
.form-input:disabled,
.form-slider:disabled,
.shortcut-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  background-color: var(--color-bg-muted);
}

.switch input:disabled + .switch-slider {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
