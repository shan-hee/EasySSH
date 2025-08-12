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

          <div
            class="menu-item"
            :class="{ active: activeMenu === 'monitoring' }"
            @click="activeMenu = 'monitoring'"
          >
            <div class="menu-icon">
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path fill="currentColor" d="M3,3V21H21V19H5V3H3M9,17H7V10H9V17M13,17H11V7H13V17M17,17H15V13H17V17M21,17H19V4H21V17Z" />
              </svg>
            </div>
            <span class="menu-text">监控设置</span>
          </div>

          <div
            class="menu-item"
            :class="{ active: activeMenu === 'ai' }"
            @click="activeMenu = 'ai'"
          >
            <div class="menu-icon">
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path fill="currentColor" d="M12,2A2,2 0 0,1 14,4C14,4.74 13.6,5.39 13,5.73V7H14A7,7 0 0,1 21,14H22A1,1 0 0,1 23,15V18A1,1 0 0,1 22,19H21V20A2,2 0 0,1 19,22H5A2,2 0 0,1 3,20V19H2A1,1 0 0,1 1,18V15A1,1 0 0,1 2,14H3A7,7 0 0,1 10,7H11V5.73C10.4,5.39 10,4.74 10,4A2,2 0 0,1 12,2M7.5,13A2.5,2.5 0 0,0 5,15.5A2.5,2.5 0 0,0 7.5,18A2.5,2.5 0 0,0 10,15.5A2.5,2.5 0 0,0 7.5,13M16.5,13A2.5,2.5 0 0,0 14,15.5A2.5,2.5 0 0,0 16.5,18A2.5,2.5 0 0,0 19,15.5A2.5,2.5 0 0,0 16.5,13Z" />
              </svg>
            </div>
            <span class="menu-text">AI智能助手</span>
          </div>
        </div>
      </div>
      
      <!-- 右侧内容区域 -->
      <div class="settings-content">
        <!-- 账户设置面板 -->
        <div v-if="activeMenu === 'account'" class="content-panel">
          <div class="panel-body">
            <form @submit.prevent="updateAccount">
              <!-- 用户名修改 -->
              <div class="form-group">
                <label>用户名</label>
                <div class="input-group">
                  <input
                    v-model="accountForm.username"
                    type="text"
                    placeholder="请输入用户名"
                    class="form-input"
                    autocomplete="username"
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
                    autocomplete="current-password"
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
                    autocomplete="new-password"
                  />
                </div>
              </div>
            </form>
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

            <!-- 终端主题 -->
            <div class="security-item">
              <div class="security-info">
                <div class="security-title">终端主题</div>
                <div class="security-description">
                  选择您喜欢的终端主题风格，提供多种预设主题
                </div>
              </div>
              <div class="security-action">
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
            </div>

            <!-- 光标样式 -->
            <div class="security-item">
              <div class="security-info">
                <div class="security-title">光标样式</div>
                <div class="security-description">
                  设置终端光标的显示样式，影响输入位置的视觉效果
                </div>
              </div>
              <div class="security-action">
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
            </div>

            <!-- 终端字体 -->
            <div class="security-item">
              <div class="security-info">
                <div class="security-title">终端字体</div>
                <div class="security-description">
                  选择终端显示的字体，建议使用等宽字体以获得最佳效果
                </div>
              </div>
              <div class="security-action">
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
            </div>

            <!-- 字体大小 -->
            <div class="security-item">
              <div class="security-info">
                <div class="security-title">字体大小</div>
                <div class="security-description">
                  调整终端文字的大小，范围从8px到24px
                </div>
              </div>
              <div class="security-action">
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
            </div>

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
                      :value="getDisplayValue(shortcut)"
                      @focus="startKeyCapture(shortcut, $event)"
                      @blur="endKeyCapture(shortcut)"
                      @keydown="captureKeyDown($event, shortcut)"
                      @keyup="captureKeyUp($event, shortcut)"
                      class="shortcut-input"
                      :class="{ 'capturing': shortcut.isCapturing }"
                      :placeholder="shortcut.isCapturing ? '' : '点击设置快捷键'"
                      readonly
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

        <!-- 监控设置面板 -->
        <div v-if="activeMenu === 'monitoring'" class="content-panel">
          <div class="panel-body">
            <div class="settings-section">
              <!-- 更新间隔 -->
              <div class="security-item">
                <div class="security-info">
                  <div class="security-title">更新间隔</div>
                  <div class="security-description">
                    监控数据的更新频率，建议设置为 0.5-10 秒之间
                  </div>
                </div>
                <div class="security-action">
                  <div class="number-input-with-controls">
                    <button class="control-btn" @click="decrementMonitoringInterval">－</button>
                    <span class="number-display">{{ formatMonitoringInterval(monitoringSettings.updateInterval) }}</span>
                    <button class="control-btn" @click="incrementMonitoringInterval">＋</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- AI智能助手设置面板 -->
        <div v-if="activeMenu === 'ai'" class="content-panel">
          <div class="panel-body">
            <div class="settings-section">
              <!-- AI功能总开关 -->
              <div class="security-item">
                <div class="security-info">
                  <div class="security-title">
                    启用AI功能
                    <span v-if="aiSettings.enabled" class="status-badge enabled">已启用</span>
                    <span v-else class="status-badge disabled">未启用</span>
                  </div>
                  <div class="security-description">
                    启用后可使用智能补全、解释和修复建议等功能
                  </div>
                </div>
                <div class="security-action">
                  <button
                    class="btn btn-outline"
                    @click="toggleAIFeature"
                    :disabled="aiLoading"
                  >
                    <span v-if="aiLoading" class="btn-loading"></span>
                    {{ aiSettings.enabled ? '禁用' : '启用' }}
                  </button>
                </div>
              </div>

              <!-- API配置 -->
              <div class="settings-divider"></div>

              <!-- AI配置表单 -->
              <form @submit.prevent="saveAISettings" class="ai-config-form" autocomplete="off">
                <fieldset class="ai-config-fieldset">
                  <legend class="sr-only">AI服务配置</legend>

                  <div class="security-item">
                    <div class="security-info">
                      <div class="security-title">API地址</div>
                      <div class="security-description">
                        OpenAI 兼容 API 的接口地址
                      </div>
                    </div>
                    <div class="security-action">
                      <div class="input-with-icon">
                        <input
                          v-model="aiSettings.baseUrl"
                          type="url"
                          class="form-input"
                          placeholder="https://api.openai.com"
                          :disabled="aiLoading"
                          autocomplete="off"
                          name="ai-api-base-url"
                        />
                      </div>
                    </div>
                  </div>

                  <div class="security-item">
                    <div class="security-info">
                      <div class="security-title">API密钥</div>
                      <div class="security-description">
                        您的API访问密钥，将被安全加密存储
                      </div>
                    </div>
                    <div class="security-action">
                      <div class="input-with-icon">
                        <input
                          v-model="aiSettings.apiKey"
                          :type="showApiKey ? 'text' : 'password'"
                          class="form-input"
                          placeholder="sk-..."
                          :disabled="aiLoading"
                          autocomplete="off"
                          name="ai-api-key"
                        />
                        <button
                          class="btn btn-icon btn-eye"
                          @click="showApiKey = !showApiKey"
                          type="button"
                        >
                          <svg v-if="showApiKey" viewBox="0 0 24 24" width="16" height="16">
                            <path fill="currentColor" d="M11.83,9L15,12.16C15,12.11 15,12.05 15,12A3,3 0 0,0 12,9C11.94,9 11.89,9 11.83,9M7.53,9.8L9.08,11.35C9.03,11.56 9,11.77 9,12A3,3 0 0,0 12,15C12.22,15 12.44,14.97 12.65,14.92L14.2,16.47C13.53,16.8 12.79,17 12,17A5,5 0 0,1 7,12C7,11.21 7.2,10.47 7.53,9.8M2,4.27L4.28,6.55L4.73,7C3.08,8.3 1.78,10 1,12C2.73,16.39 7,19.5 12,19.5C13.55,19.5 15.03,19.2 16.38,18.66L16.81,19.09L19.73,22L21,20.73L3.27,3M12,7A5,5 0 0,1 17,12C17,12.64 16.87,13.26 16.64,13.82L19.57,16.75C21.07,15.5 22.27,13.86 23,12C21.27,7.61 17,4.5 12,4.5C10.6,4.5 9.26,4.75 8,5.2L10.17,7.35C10.76,7.13 11.37,7 12,7Z" />
                          </svg>
                          <svg v-else viewBox="0 0 24 24" width="16" height="16">
                            <path fill="currentColor" d="M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9M12,17A5,5 0 0,1 7,12A5,5 0 0,1 12,7A5,5 0 0,1 17,12A5,5 0 0,1 12,17M12,4.5C7,4.5 2.73,7.61 1,12C2.73,16.39 7,19.5 12,19.5C17,19.5 21.27,16.39 23,12C21.27,7.61 17,4.5 12,4.5Z" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>

                  <div class="security-item">
                    <div class="security-info">
                      <div class="security-title">AI模型</div>
                      <div class="security-description">
                        输入要使用的AI模型名称（必填）
                      </div>
                    </div>
                    <div class="security-action">
                      <div class="input-with-icon">
                        <input
                          v-model="aiSettings.model"
                          type="text"
                          class="form-input"
                          placeholder="请输入模型名称，如：gpt-4o-mini"
                          :disabled="aiLoading"
                          autocomplete="off"
                          name="ai-model"
                        />
                        <button
                          class="btn btn-icon btn-refresh"
                          @click="testAIConnection"
                          :disabled="!aiSettings.apiKey || !aiSettings.baseUrl || !aiSettings.model || aiTesting"
                          type="button"
                          title="测试API连接"
                        >
                          <span v-if="aiTesting" class="btn-loading"></span>
                          <svg v-else viewBox="0 0 24 24" width="16" height="16">
                            <path fill="currentColor" d="M17.65,6.35C16.2,4.9 14.21,4 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20C15.73,20 18.84,17.45 19.73,14H17.65C16.83,16.33 14.61,18 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6C13.66,6 15.14,6.69 16.22,7.78L13,11H20V4L17.65,6.35Z" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </fieldset>
              </form>



                <!-- 移除使用统计，简化界面 -->

                <!-- 移除配置管理，简化界面 -->
            </div>
          </div>

          <div class="panel-footer">
            <button class="btn btn-primary" @click="saveAISettings" :disabled="aiLoading">
              <span v-if="aiLoading" class="btn-loading"></span>
              {{ aiLoading ? '保存中...' : '保存AI设置' }}
            </button>
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
import { defineComponent, ref, onMounted, onUnmounted, computed, watch, reactive, nextTick } from 'vue'
import { useUserStore } from '@/store/user'
import { useTerminalStore } from '@/store/terminal'
import { ElMessage, ElMessageBox } from 'element-plus'
import Modal from '@/components/common/Modal.vue'
import MfaSetupModal from '@/components/auth/MfaSetupModal.vue'
import MfaDisableModal from '@/components/auth/MfaDisableModal.vue'
import LogoutAllDevicesModal from '@/components/auth/LogoutAllDevicesModal.vue'
import mfaService from '@/services/mfa'
import storageAdapter from '@/services/storage-adapter'
import log from '@/services/log'
import { localKeyboardManager } from '@/utils/keyboard'
import aiService from '@/services/ai/ai-service'
import AIConfig from '@/services/ai/ai-config'

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



    // 终端背景设置数据
    const terminalBgSettings = reactive({
      enabled: false,
      url: '',
      opacity: 0.5,
      mode: 'cover',
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

    // 监控设置数据
    const monitoringSettings = reactive({
      updateInterval: 1000, // 更新间隔（毫秒）
      initialized: false
    })

    // AI设置数据 - 简化版本
    const aiConfigManager = new AIConfig()
    const aiSettings = reactive({
      enabled: false,
      provider: 'openai', // 固定为OpenAI兼容格式
      baseUrl: 'https://api.openai.com', // 默认OpenAI官方API，但可修改
      apiKey: '',
      model: '', // 移除默认模型，要求用户手动输入
      features: {
        interaction: true,
        explanation: true,
        fix: true,
        generation: true
      },
      initialized: false
    })

    // AI相关状态
    const aiLoading = ref(false)
    const aiTesting = ref(false)
    const showApiKey = ref(false)

    // 默认快捷键定义
    const defaultShortcuts = {
      'terminal.copy': 'Ctrl+Shift+C',
      'terminal.paste': 'Ctrl+Shift+V',
      'accessibility.increaseFontSize': 'Ctrl+Alt+=',
      'accessibility.decreaseFontSize': 'Ctrl+Alt+-',
      'terminal.clear': 'Ctrl+L',
      'settings.open': 'Ctrl+,'
    }

    // 终端快捷键数据
    const terminalShortcuts = reactive([
      { description: '复制选中内容', key: 'Ctrl+Shift+C', action: 'terminal.copy', isCapturing: false },
      { description: '粘贴', key: 'Ctrl+Shift+V', action: 'terminal.paste', isCapturing: false },
      { description: '增加字体大小', key: 'Ctrl+Alt+=', action: 'accessibility.increaseFontSize', isCapturing: false },
      { description: '减小字体大小', key: 'Ctrl+Alt+-', action: 'accessibility.decreaseFontSize', isCapturing: false },
      { description: '清空终端', key: 'Ctrl+L', action: 'terminal.clear', isCapturing: false },
      { description: '打开设置', key: 'Ctrl+,', action: 'settings.open', isCapturing: false }
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

      // 初始化所有设置 - 统一使用storageAdapter从服务器获取
      try {
        // 初始化终端设置 - 从服务器获取
        try {
          const savedTerminalSettings = await storageAdapter.get('terminal', {
            fontSize: 16,
            fontFamily: "'JetBrains Mono'",
            theme: 'dark',
            cursorStyle: 'block',
            cursorBlink: true,
            copyOnSelect: false,
            rightClickSelectsWord: false
          })

          if (savedTerminalSettings) {
            Object.assign(terminalSettings, savedTerminalSettings)
            terminalSettings.initialized = true
            log.debug('终端设置已从服务器加载')
          }
        } catch (error) {
          log.error('加载终端设置失败:', error)
        }

        // 初始化连接设置 - 从服务器获取
        try {
          const savedConnectionSettings = await storageAdapter.get('connection', {
            autoReconnect: true,
            reconnectInterval: 3,
            connectionTimeout: 10,
            keepAlive: true,
            keepAliveInterval: 30
          })

          if (savedConnectionSettings) {
            Object.assign(connectionSettings, savedConnectionSettings)
            connectionSettings.initialized = true
            log.debug('连接设置已从服务器加载')
          }
        } catch (error) {
          log.error('加载连接设置失败:', error)
        }

        // 初始化监控设置 - 从服务器获取
        try {
          const savedMonitoringSettings = await storageAdapter.get('monitoring', {
            updateInterval: 1000
          })

          if (savedMonitoringSettings) {
            Object.assign(monitoringSettings, savedMonitoringSettings)
            monitoringSettings.initialized = true
            log.debug('监控设置已从服务器加载')
          }
        } catch (error) {
          log.error('加载监控设置失败:', error)
        }

        // 初始化终端背景设置 - 从服务器获取
        try {
          // 先尝试迁移旧数据
          const oldBgSettings = localStorage.getItem('easyssh_terminal_bg')
          if (oldBgSettings) {
            try {
              const parsedOldSettings = JSON.parse(oldBgSettings)
              await storageAdapter.set('terminal.background', parsedOldSettings)
              localStorage.removeItem('easyssh_terminal_bg')
              log.info('终端背景设置已迁移到统一存储服务')
            } catch (e) {
              log.warn('迁移终端背景设置失败:', e)
            }
          }

          // 加载设置
          const savedBgSettings = await storageAdapter.get('terminal.background', {
            enabled: false,
            url: '',
            opacity: 0.5,
            mode: 'cover'
          })

          if (savedBgSettings) {
            Object.assign(terminalBgSettings, savedBgSettings)
            terminalBgSettings.initialized = true
            log.debug('终端背景设置已从服务器加载')
          }
        } catch (error) {
          log.error('加载终端背景设置失败:', error)
        }

        // 初始化快捷键设置
        loadShortcuts()

        // 初始化AI设置 - 从已初始化的AI服务获取配置
        try {
          // 获取AI服务的当前配置，避免重复请求
          const currentConfig = aiConfigManager.config
          if (currentConfig) {
            Object.assign(aiSettings, currentConfig)
            aiSettings.initialized = true
            log.debug('AI设置已从服务获取')
          }
        } catch (error) {
          log.error('初始化AI设置失败:', error)
        }
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

        // 使用storageAdapter保存到服务器（登录时）或本地（未登录时）
        const success = await storageAdapter.set('terminal', {
          fontSize: terminalSettings.fontSize,
          fontFamily: terminalSettings.fontFamily,
          theme: terminalSettings.theme,
          cursorStyle: terminalSettings.cursorStyle,
          cursorBlink: terminalSettings.cursorBlink,
          copyOnSelect: terminalSettings.copyOnSelect,
          rightClickSelectsWord: terminalSettings.rightClickSelectsWord
        })

        if (success) {
          // 发送全局事件，通知所有终端设置已更新
          window.dispatchEvent(new CustomEvent('terminal-settings-updated', {
            detail: { settings: terminalSettings }
          }))

          log.info('终端设置已保存到服务器:', terminalSettings)
          ElMessage.success('终端设置已保存')
        } else {
          throw new Error('保存失败')
        }
      } catch (error) {
        log.error('保存终端设置失败', error)
        ElMessage.error('保存终端设置失败')
      }
    }

    // 保存连接设置
    const saveConnectionSettings = async () => {
      try {
        connectionSettings.initialized = true

        // 使用storageAdapter保存到服务器（登录时）或本地（未登录时）
        const success = await storageAdapter.set('connection', {
          autoReconnect: connectionSettings.autoReconnect,
          reconnectInterval: connectionSettings.reconnectInterval,
          connectionTimeout: connectionSettings.connectionTimeout,
          keepAlive: connectionSettings.keepAlive,
          keepAliveInterval: connectionSettings.keepAliveInterval
        })

        if (success) {
          log.info('连接设置已保存到服务器:', connectionSettings)
          ElMessage.success('连接设置已保存')
        } else {
          throw new Error('保存失败')
        }
      } catch (error) {
        log.error('保存连接设置失败', error)
        ElMessage.error('保存连接设置失败')
      }
    }

    // 保存监控设置
    const saveMonitoringSettings = async () => {
      try {
        monitoringSettings.initialized = true

        // 使用storageAdapter保存到服务器（登录时）或本地（未登录时）
        const success = await storageAdapter.set('monitoring', {
          updateInterval: monitoringSettings.updateInterval
        })

        if (success) {
          // 触发监控配置更新事件
          const event = new CustomEvent('monitoring-config-changed', {
            detail: { ...monitoringSettings }
          })
          window.dispatchEvent(event)

          log.info('监控设置已保存到服务器:', monitoringSettings)
          ElMessage.success('监控设置已保存')
        } else {
          throw new Error('保存失败')
        }
      } catch (error) {
        log.error('保存监控设置失败', error)
        ElMessage.error('保存监控设置失败')
      }
    }

    // 格式化监控间隔显示
    const formatMonitoringInterval = (interval) => {
      if (interval < 1000) {
        return `${interval}毫秒`
      } else {
        return `${interval / 1000}秒`
      }
    }

    // 增加监控间隔
    const incrementMonitoringInterval = () => {
      if (monitoringSettings.updateInterval < 10000) {
        if (monitoringSettings.updateInterval < 1000) {
          monitoringSettings.updateInterval += 100 // 毫秒级增量
        } else {
          monitoringSettings.updateInterval += 1000 // 秒级增量
        }
        saveMonitoringSettings()
      }
    }

    // 减少监控间隔
    const decrementMonitoringInterval = () => {
      if (monitoringSettings.updateInterval > 500) {
        if (monitoringSettings.updateInterval <= 1000) {
          monitoringSettings.updateInterval -= 100 // 毫秒级减量
        } else {
          monitoringSettings.updateInterval -= 1000 // 秒级减量
        }
        saveMonitoringSettings()
      }
    }

    // 移除availableModels，使用硬编码的模型选项

    // AI功能开关
    const toggleAIFeature = async () => {
      try {
        aiLoading.value = true

        if (aiSettings.enabled) {
          // 禁用AI服务
          await aiService.disable()
          aiSettings.enabled = false
          // 禁用AI时，同时禁用所有子功能
          aiSettings.features.interaction = false
          aiSettings.features.explanation = false
          aiSettings.features.fix = false
          aiSettings.features.generation = false
          ElMessage.info('AI功能已禁用')
        } else {
          // 启用AI服务需要先有API配置
          if (!aiSettings.apiKey) {
            ElMessage.warning('请先配置API密钥')
            return
          }

          await aiService.enable(aiSettings)
          aiSettings.enabled = true
          // 启用AI时，默认启用所有子功能
          aiSettings.features.interaction = true
          aiSettings.features.explanation = true
          aiSettings.features.fix = true
          aiSettings.features.generation = true
          ElMessage.success('AI功能已启用，所有智能功能已开启')
        }

        await saveAISettings()
      } catch (error) {
        // 回滚状态
        aiSettings.enabled = !aiSettings.enabled
        ElMessage.error(`操作失败: ${error.message}`)
        log.error('切换AI状态失败', error)
      } finally {
        aiLoading.value = false
      }
    }

    // 测试AI连接
    const testAIConnection = async () => {
      try {
        aiTesting.value = true

        // 前端验证
        if (!aiSettings.baseUrl || !aiSettings.apiKey || !aiSettings.model) {
          ElMessage({
            message: '请填写完整的API配置信息（地址、密钥、模型）',
            type: 'warning',
            offset: 3,
            zIndex: 9999
          })
          return
        }

        // 验证模型名称格式
        if (aiSettings.model.trim().length < 3) {
          ElMessage({
            message: '模型名称过短，请输入有效的模型名称',
            type: 'warning',
            offset: 3,
            zIndex: 9999
          })
          return
        }

        const result = await aiService.testConnection(aiSettings)

        if (result.success) {
          ElMessage({
            message: result.message || 'API连接测试成功',
            type: 'success',
            offset: 3,
            zIndex: 9999
          })
        } else {
          ElMessage({
            message: result.message || '连接测试失败',
            type: 'error',
            offset: 3,
            zIndex: 9999
          })
        }
      } catch (error) {
        ElMessage({
          message: `连接测试失败: ${error.message || '网络错误'}`,
          type: 'error',
          offset: 3,
          zIndex: 9999
        })
        log.error('API连接测试失败', error)
      } finally {
        aiTesting.value = false
      }
    }

    // 移除服务商变更处理，固定使用OpenAI

    // 保存AI设置 - 简化版本
    const saveAISettings = async () => {
      try {
        aiLoading.value = true

        await aiConfigManager.save(aiSettings)

        // 如果AI已启用，更新服务配置（需要保存配置）
        if (aiSettings.enabled) {
          await aiService.enable(aiSettings, true)
        }

        aiSettings.initialized = true
        ElMessage.success('AI设置已保存')
        log.info('AI设置已保存')
      } catch (error) {
        log.error('保存AI设置失败', error)
        ElMessage.error(`保存失败: ${error.message}`)
      } finally {
        aiLoading.value = false
      }
    }

    // 移除数值调整方法，使用默认值

    // 移除使用统计相关方法

    // 移除配置管理方法



    // 更新终端背景设置
    const updateTerminalBg = async () => {
      try {
        terminalBgSettings.initialized = true

        // 确保存储适配器已初始化
        if (!storageAdapter.initialized) {
          await storageAdapter.init()
        }

        // 保存终端背景设置到统一存储服务
        await storageAdapter.set('terminal.background', terminalBgSettings)

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
          log.info('开始重置所有快捷键...');

          // 获取键盘管理器服务
          const keyboardManager = window.services?.keyboardManager || localKeyboardManager;

          // 调用重置方法
          const resetResult = keyboardManager.resetAllShortcuts();

          if (resetResult) {
            // 直接将所有快捷键重置为默认值
            terminalShortcuts.forEach((shortcut, index) => {
              const defaultKey = defaultShortcuts[shortcut.action];
              if (defaultKey) {
                // 使用Vue的响应式更新
                Object.assign(terminalShortcuts[index], {
                  ...shortcut,
                  key: defaultKey,
                  isCapturing: false
                });
                log.info(`重置快捷键: ${shortcut.action} -> ${defaultKey}`);
              }
            });

            log.info('所有快捷键已重置为默认值');
            ElMessage.success('所有快捷键已重置为默认值');
          } else {
            throw new Error('重置操作失败');
          }
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
        } else {
          // 如果没有找到快捷键信息，使用默认值
          const defaultKey = defaultShortcuts[shortcut.action];
          if (defaultKey) {
            shortcut.key = defaultKey;
            log.info(`使用默认快捷键: ${shortcut.action} -> ${defaultKey}`);
          } else {
            log.warn(`未找到快捷键信息: ${shortcut.action}，且无默认值`);
          }
        }
        // 确保每个快捷键都有 isCapturing 属性
        if (shortcut.isCapturing === undefined) {
          shortcut.isCapturing = false;
        }
      });

      log.info('快捷键设置已重新加载');
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

    // 按键捕获相关变量
    const captureState = reactive({
      currentShortcut: null,
      originalKey: '',
      captureTimeout: null,
      tempKey: '' // 临时显示的按键组合
    })

    // 获取显示值的方法
    const getDisplayValue = (shortcut) => {
      if (shortcut.isCapturing) {
        return captureState.tempKey || '请按下快捷键组合...'
      }
      return shortcut.key
    }

    // 开始按键捕获
    const startKeyCapture = (shortcut) => {
      // 防止其他快捷键同时捕获
      terminalShortcuts.forEach(s => s.isCapturing = false)

      // 保存原始快捷键值
      captureState.originalKey = shortcut.key
      captureState.tempKey = '' // 清空临时按键

      shortcut.isCapturing = true
      captureState.currentShortcut = shortcut

      // 清除之前的超时
      if (captureState.captureTimeout) {
        clearTimeout(captureState.captureTimeout)
      }

      // 设置超时自动取消捕获（5秒后自动恢复）
      captureState.captureTimeout = setTimeout(() => {
        endKeyCapture(shortcut)
      }, 5000)

      log.info(`开始捕获快捷键: ${shortcut.description}`)
    }

    // 结束按键捕获
    const endKeyCapture = (shortcut) => {
      // 延迟结束捕获，给按键事件处理留时间
      setTimeout(() => {
        if (shortcut.isCapturing) {
          shortcut.isCapturing = false
          captureState.currentShortcut = null
          captureState.tempKey = ''

          // 如果没有成功捕获到新的快捷键，恢复原始值
          if (!shortcut.key || shortcut.key === '请按下快捷键组合...') {
            shortcut.key = captureState.originalKey
          }

          if (captureState.captureTimeout) {
            clearTimeout(captureState.captureTimeout)
            captureState.captureTimeout = null
          }
        }
      }, 100)
    }

    // 捕获按键按下事件
    const captureKeyDown = (event, shortcut) => {
      if (!shortcut.isCapturing) return

      event.preventDefault()
      event.stopPropagation()

      const key = event.key

      // 实时显示按键组合（包括修饰键）
      const keyCombo = buildKeyComboString(event)
      if (keyCombo) {
        captureState.tempKey = keyCombo
      }

      // 忽略单独的修饰键，不完成捕获
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
        return
      }

      // 有实际按键时完成捕获
      if (keyCombo && !['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
        // 直接设置新的快捷键值
        shortcut.key = keyCombo

        // 尝试更新快捷键设置
        try {
          updateShortcut(shortcut, keyCombo)
          log.info(`快捷键已更新: ${shortcut.description} -> ${keyCombo}`)
        } catch (error) {
          log.error('更新快捷键失败:', error)
          // 如果更新失败，恢复原始值
          shortcut.key = captureState.originalKey
        }

        // 结束捕获
        shortcut.isCapturing = false
        captureState.currentShortcut = null
        captureState.tempKey = ''

        if (captureState.captureTimeout) {
          clearTimeout(captureState.captureTimeout)
          captureState.captureTimeout = null
        }
      }
    }

    // 捕获按键释放事件（简化处理）
    const captureKeyUp = (event, shortcut) => {
      if (!shortcut.isCapturing) return
      event.preventDefault()
      event.stopPropagation()
    }

    // 构建快捷键组合字符串
    const buildKeyComboString = (event) => {
      const parts = []

      // 添加修饰键（按固定顺序）
      if (event.ctrlKey) parts.push('Ctrl')
      if (event.altKey) parts.push('Alt')
      if (event.shiftKey) parts.push('Shift')
      if (event.metaKey) parts.push('Meta')

      // 添加主键
      let mainKey = event.key

      // 处理特殊键名
      const keyMap = {
        ' ': 'Space',
        'ArrowUp': 'Up',
        'ArrowDown': 'Down',
        'ArrowLeft': 'Left',
        'ArrowRight': 'Right',
        'Escape': 'Esc'
      }

      if (keyMap[mainKey]) {
        mainKey = keyMap[mainKey]
      }

      // 处理字母键大小写
      if (mainKey.length === 1 && mainKey.match(/[a-zA-Z]/)) {
        mainKey = mainKey.toUpperCase()
      }

      // 忽略单独的修饰键
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(mainKey)) {
        return null
      }

      parts.push(mainKey)

      return parts.join('+')
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
      monitoringSettings,
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
      saveMonitoringSettings,
      formatMonitoringInterval,
      incrementMonitoringInterval,
      decrementMonitoringInterval,
      updateTerminalBg,
      updateShortcut,
      resetAllShortcuts,
      loadShortcuts,
      getDisplayValue,
      startKeyCapture,
      endKeyCapture,
      captureKeyDown,
      captureKeyUp,
      incrementReconnectInterval,
      decrementReconnectInterval,
      incrementConnectionTimeout,
      decrementConnectionTimeout,
      incrementKeepAliveInterval,
      decrementKeepAliveInterval,
      handleClose,
      // AI相关 - 简化版本
      aiSettings,
      aiLoading,
      aiTesting,
      showApiKey,
      toggleAIFeature,
      testAIConnection,
      saveAISettings
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
  height: 530px;
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
  padding: 0px 20px 20px 0px;
}

.content-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}


/* 面板主体 */
.panel-body {
  flex: 1;
  /* padding: 12px 32px 52px 32px; */
  overflow-y: auto;
}

/* 自定义滚动条样式 */
.panel-body::-webkit-scrollbar {
  width: 8px;
}

.panel-body::-webkit-scrollbar-track {
  background: transparent;
}

.panel-body::-webkit-scrollbar-thumb {
  background-color: #333333;
  border-radius: 4px;
}

.panel-body::-webkit-scrollbar-thumb:hover {
  background-color: #333333;
}

/* Firefox 滚动条样式 */
.panel-body {
  scrollbar-width: thin;
  scrollbar-color: #333333 transparent;
}

/* 表单组件 */
.form-group {
  margin-bottom: 24px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
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
  font-size: 12px;
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
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-primary);
}

.security-description {
  font-size: 12px;
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
  font-size: 10px;
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
  display: flex;
  justify-content: flex-end;
}

/* 按钮样式 */
.btn {
  padding: 10px 20px;
  border-radius: 6px;
  font-size: 12px;
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

.section-title {
  font-size: 14px;
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
  padding: 7px 12px;
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  background-color: var(--color-bg-container);
  color: var(--color-text-primary);
  font-size: 12px;
  transition: all 0.2s ease;
}

.form-select:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px var(--color-primary-lightest);
}

/* 在安全设置项中的选择框样式 */
.security-action .form-select {
  min-width: 160px;
  width: auto;
}

/* 滑块容器 */
.slider-container {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* 在安全设置项中的滑块容器样式 */
.security-action .slider-container {
  min-width: 160px;
}

.form-slider {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: var(--color-border-muted);
  outline: none;
  /* -webkit-appearance: none; */
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
  font-size: 12px;
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
  font-size: 12px;
  color: var(--color-text-primary);
  min-width: 20px;
  text-align: center;
  font-weight: 500;
}

.control-btn {
  background-color: transparent;
  border: 1px solid var(--color-border-default);
  color: var(--color-text-primary);
  font-size: 12px;
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
  font-size: 12px;
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
  padding: 20px 0 0 0;
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

.shortcut-description {
  font-size: 12px;
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
  font-size: 11px;
  background-color: var(--color-bg-muted);
  padding: 4px 8px;
  border: 1px solid var(--color-border-default);
  border-radius: 4px;
  color: var(--color-text-primary);
  min-width: 120px;
  text-align: center;
  transition: all 0.2s ease;
  cursor: pointer;
}

.shortcut-input:hover {
  border-color: var(--color-primary-light);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.shortcut-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px var(--color-primary-lightest);
}

.shortcut-input.capturing {
  border-color: var(--color-primary);
  background-color: var(--color-primary-bg);
  color: var(--color-primary);
  font-family: monospace;
  font-style: normal;
  font-size: 13px;
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

/* 监控设置样式 */
.number-input-with-controls {
  display: flex;
  align-items: center;
  gap: 0;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--color-bg-secondary);
}

.control-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: var(--color-bg-secondary);
  color: var(--color-text-secondary);
  font-size: 14px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.control-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-primary);
}

.control-btn:active {
  background: var(--color-bg-active);
}

.number-display {
  min-width: 60px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-primary);
  background: var(--color-bg-primary);
  border-left: 1px solid var(--color-border);
  border-right: 1px solid var(--color-border);
}

/* AI设置输入框布局样式 */
.input-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.input-with-icon {
  position: relative;
  flex: 1;
}

.input-with-icon .form-input {
  padding-right: 40px;
}

.input-with-icon .btn-eye,
.input-with-icon .btn-refresh {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: none;
  color: var(--color-text-secondary);
  padding: 4px;
  cursor: pointer;
}

.input-with-icon .btn-eye:hover,
.input-with-icon .btn-refresh:hover {
  color: var(--color-text-primary);
}

.input-with-icon .btn-refresh:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-refresh {
  flex-shrink: 0;
}

/* AI配置表单样式 */
.ai-config-form {
  width: 100%;
  display: contents; /* 使表单不影响现有布局 */
}

.ai-config-fieldset {
  border: none;
  margin: 0;
  padding: 0;
  display: contents; /* 使fieldset不影响现有布局 */
}

/* 屏幕阅读器专用样式 */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
