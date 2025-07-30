<template>
  <Modal 
    v-model:visible="isVisible" 
    title="用户设置" 
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
import { defineComponent, ref, onMounted, computed, watch } from 'vue'
import { useUserStore } from '@/store/user'
import { ElMessage } from 'element-plus'
import Modal from '@/components/common/Modal.vue'
import MfaSetupModal from '@/components/auth/MfaSetupModal.vue'
import MfaDisableModal from '@/components/auth/MfaDisableModal.vue'
import LogoutAllDevicesModal from '@/components/auth/LogoutAllDevicesModal.vue'
import mfaService from '@/services/mfa'

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
    
    // MFA 相关弹窗状态
    const showMfaSetupModal = ref(false)
    const showMfaDisableModal = ref(false)
    const showLogoutAllDevicesModal = ref(false)
    
    // 初始化数据
    const initializeData = () => {
      accountForm.value.username = userStore.username || ''
      securityForm.value.mfaEnabled = userStore.userInfo.mfaEnabled || false
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
    })
    
    return {
      isVisible,
      activeMenu,
      isLoading,
      accountForm,
      securityForm,
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
</style>
