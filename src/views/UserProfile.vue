设置两步验证<template>
  <div class="profile-container">
    <div class="profile-header">
      <h1>更新个人资料</h1>
    </div>
    
    <!-- 添加加载状态显示 -->
    <div v-if="isLoading" class="profile-loading">
      <div class="loading-spinner"></div>
      <span>加载个人信息中...</span>
    </div>
    
    <form v-else class="profile-form" @submit.prevent="submitProfile">
      <div class="form-group">
        <label for="username">新用户名</label>
        <input type="text" id="username" v-model="profileForm.username" class="form-input" autocomplete="username" />
      </div>
      <div class="form-group">
        <label for="oldPassword">原始密码</label>
        <input type="password" id="oldPassword" v-model="profileForm.oldPassword" class="form-input" autocomplete="current-password" />
      </div>
      <div class="form-group">
        <label for="newPassword">新密码</label>
        <input type="password" id="newPassword" v-model="profileForm.newPassword" class="form-input" autocomplete="new-password" />
      </div>
      
      <!-- 修改两步验证部分 -->
      <div class="form-group mfa-section">
        <div class="mfa-header">
          <label>两步验证 <span v-if="profileForm.mfaEnabled" class="tag tag-success">已启用</span></label>
          <div class="mfa-switch">
            <button type="button" @click="handleMfaToggle">
              {{ profileForm.mfaEnabled ? '禁用' : '启用' }}
            </button>
          </div>
        </div>
        <p class="mfa-description">在登录时需要通过额外的安全步骤，如果您无法通过此验证，请联系管理员。</p>
      </div>
      
      <!-- 添加注销所有设备部分 -->
      <div class="form-group mfa-section">
        <div class="mfa-header">
          <label>注销所有设备</label>
          <div class="mfa-switch">
            <button type="button" @click="showLogoutAllDevicesModal = true">
              注销
            </button>
          </div>
        </div>
        <p class="mfa-description">立即终止您当前账号在所有设备上的登录状态，提高账号安全性。操作后您需要重新登录，其他设备的会话可能在 30 分钟内逐步失效。</p>
      </div>
      
      <div class="form-actions">
        <button type="button" class="btn-cancel" @click="closeProfile">关闭</button>
        <button type="submit" class="btn-submit">确认</button>
      </div>
    </form>
    
    <!-- MFA设置弹窗 -->
    <MfaSetupModal 
      :visible="showMfaSetupModal"
      @update:visible="showMfaSetupModal = $event"
      @mfa-setup-complete="handleMfaSetupComplete"
      @mfa-setup-cancelled="handleMfaSetupCancelled"
    />
    
    <!-- MFA禁用弹窗 -->
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
  </div>
</template>

<script>
import { defineComponent, ref, onMounted, onBeforeMount, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/store/user'
import { ElMessage } from 'element-plus'
import MfaSetupModal from '@/components/auth/MfaSetupModal.vue'
import MfaDisableModal from '@/components/auth/MfaDisableModal.vue'
import LogoutAllDevicesModal from '@/components/auth/LogoutAllDevicesModal.vue'
import mfaService from '@/services/mfa'
import apiService from '@/services/api'

export default defineComponent({
  name: 'UserProfile',
  components: {
    MfaSetupModal,
    MfaDisableModal,
    LogoutAllDevicesModal
  },
  setup() {
    const router = useRouter()
    const userStore = useUserStore()
    const showMfaSetupModal = ref(false)
    const showMfaDisableModal = ref(false)
    const showLogoutAllDevicesModal = ref(false)
    const isLoading = ref(true)
    
    // 个人资料表单
    const profileForm = ref({
      username: '',
      oldPassword: '',
      newPassword: '',
      mfaEnabled: false
    })
    
    // 计算属性：判断是否需要重新加载用户数据
    const shouldRefreshUserData = computed(() => {
      // 检查store中是否已有完整用户数据
      return !userStore.userInfo?.username || 
             userStore.userInfo.username === '' || 
             typeof userStore.userInfo.mfaEnabled === 'undefined'
    })
    
    // 从store中加载数据到表单
    const loadFormFromStore = () => {
      profileForm.value.username = userStore.username || ''
      profileForm.value.mfaEnabled = userStore.userInfo.mfaEnabled || false
    }
    
    // 从服务器获取最新用户数据
    const fetchUserData = async () => {
      try {
        isLoading.value = true
        const response = await apiService.get('/users/me')
        
        if (response && response.success) {
          console.log('获取用户信息成功:', response.user)
          // 更新store中的用户信息
          userStore.setUserInfo(response.user)
          
          // 更新表单中的数据
          profileForm.value.username = response.user.username || ''
          profileForm.value.mfaEnabled = response.user.mfaEnabled || false
        } else {
          // 如果请求失败但本地有数据，使用本地数据
          loadFormFromStore()
          ElMessage.warning('无法获取最新数据，显示本地缓存数据')
        }
      } catch (error) {
        console.error('获取用户信息失败:', error)
        // 使用已有信息
        loadFormFromStore()
        ElMessage.warning('获取数据失败，显示本地缓存数据')
      } finally {
        isLoading.value = false
      }
    }
    
    // 页面挂载前预加载数据
    onBeforeMount(() => {
      if (!userStore.isLoggedIn) {
        router.push('/')
        return
      }
      
      // 初始显示已有数据
      if (!shouldRefreshUserData.value) {
        loadFormFromStore()
        isLoading.value = false
      } else {
        // 没有数据则保持loading状态，等待onMounted获取数据
        isLoading.value = true
      }
    })
    
    // 组件挂载后根据情况决定是否刷新数据
    onMounted(async () => {
      if (userStore.isLoggedIn) {
        // 检查是否需要从服务器刷新数据
        if (shouldRefreshUserData.value) {
          await fetchUserData()
        } else {
          isLoading.value = false
        }
      } else {
        // 未登录时跳转回主页
        router.push('/')
      }
    })
    
    // 处理MFA切换
    const handleMfaToggle = async () => {
      if (profileForm.value.mfaEnabled) {
        // 如果已启用，显示禁用MFA的弹窗
        showMfaDisableModal.value = true
      } else {
        // 如果未启用，则打开设置弹窗
        showMfaSetupModal.value = true
      }
    }
    
    // 处理MFA设置完成
    const handleMfaSetupComplete = (data) => {
      if (data && data.user) {
        userStore.setUserInfo(data.user)
        profileForm.value.mfaEnabled = true
        ElMessage.success('已成功启用两步验证')
      }
    }
    
    // 处理MFA设置取消
    const handleMfaSetupCancelled = () => {
      // 不做任何操作，保持当前状态
    }
    
    // 处理MFA禁用完成
    const handleMfaDisableComplete = (data) => {
      if (data && data.user) {
        userStore.setUserInfo(data.user)
        profileForm.value.mfaEnabled = false
        ElMessage.success('已成功禁用两步验证')
      }
    }
    
    // 处理MFA禁用取消
    const handleMfaDisableCancelled = () => {
      // 不做任何操作，保持当前状态
    }
    
    // 提交更新
    const submitProfile = async () => {
      try {
        // 表单验证
        if (!profileForm.value.username) {
          ElMessage.error('用户名不能为空')
          return
        }
        
        if (profileForm.value.newPassword && !profileForm.value.oldPassword) {
          ElMessage.error('修改密码时必须输入原密码')
          return
        }
        
        // 构建更新数据
        const updateData = {
          username: profileForm.value.username,
          profile: {
            mfaEnabled: profileForm.value.mfaEnabled
          }
        }
        
        // 如果有MFA密钥，需要更新
        if (profileForm.value.mfaSecret) {
          updateData.profile.mfaSecret = profileForm.value.mfaSecret
        }
        
        // 检查是否修改了密码
        const isChangingPassword = profileForm.value.newPassword && profileForm.value.oldPassword
        
        // 如果填写了新密码则添加密码信息
        if (isChangingPassword) {
          updateData.oldPassword = profileForm.value.oldPassword
          updateData.newPassword = profileForm.value.newPassword
        }
        
        // 显示加载状态
        isLoading.value = true
        
        // 调用更新接口
        await userStore.updateProfile(updateData)
        
        // 成功消息
        ElMessage.success('个人资料更新成功')
        
        // 清空密码字段
        profileForm.value.oldPassword = ''
        profileForm.value.newPassword = ''
        
        // 更新成功后返回首页
        router.push('/')
      } catch (error) {
        console.error('更新个人资料失败:', error)
        ElMessage.error(error.message || '更新失败，请重试')
        isLoading.value = false
      }
    }
    
    // 关闭资料页
    const closeProfile = () => {
      router.push('/')
    }
    
    // 处理注销所有设备
    const handleLogoutAllDevices = async () => {
      isLoading.value = true
      try {
        const result = await userStore.logoutAllDevices()
        if (result.success) {
          ElMessage.success('已注销所有设备，请重新登录')
          router.push('/login') // 直接跳转登录页
        }
      } catch (error) {
        ElMessage.error('注销所有设备失败，请重试')
      } finally {
        isLoading.value = false
      }
    }
    
    // 处理注销所有设备完成
    const handleLogoutComplete = () => {
      // 注销完成后的逻辑已在LogoutAllDevicesModal中处理
    }
    
    // 处理取消注销所有设备
    const handleLogoutCancelled = () => {
      // 注销完成后的逻辑已在LogoutAllDevicesModal中处理
    }
    
    return {
      profileForm,
      isLoading,
      submitProfile,
      closeProfile,
      showMfaSetupModal,
      showMfaDisableModal,
      showLogoutAllDevicesModal,
      handleMfaToggle,
      handleMfaSetupComplete,
      handleMfaSetupCancelled,
      handleMfaDisableComplete,
      handleMfaDisableCancelled,
      handleLogoutAllDevices,
      handleLogoutComplete,
      handleLogoutCancelled
    }
  }
})
</script>

<style scoped>
.profile-container {
  max-width: 500px;
  margin: 50px auto;
  /* 移除背景色 */
  border-radius: 8px;
  overflow: hidden;
}

.profile-header {
  padding: var(--spacing-md);
  border-bottom: 1px solid #333;
}

.profile-header h1 {
  margin: 0;
  font-size: 20px;
  font-weight: bold;
  color: #f0f0f0;
}

/* 添加加载状态样式 */
.profile-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 50px 20px;
  text-align: center;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255, 255, 255, 0.1);
  border-radius: 50%;
  border-top-color: #0083d3;
  animation: spin 1s ease-in-out infinite;
  margin-bottom: 15px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.profile-form {
  padding: 20px;
}

.form-group {
  margin-bottom: 20px;
}

label {
  display: block;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: normal;
  color: #fff;
}

.form-input {
  width: 100%;
  height: 36px;
  background-color: transparent;
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  color: var(--color-text-primary);
  padding: 0 var(--spacing-sm);
  box-sizing: border-box;
  outline: none;
  font-weight: normal;
}

.form-input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 1px var(--color-focus-ring);
}

.form-input::placeholder {
  color: var(--color-text-placeholder);
}

/* 修改两步验证部分的样式 */
.mfa-section {
  border-top: 1px solid var(--color-border-default);
  padding-top: var(--spacing-lg);
}

.mfa-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.mfa-header label {
  margin-bottom: 0;
}

.mfa-switch button {
  background-color: transparent;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
  padding: var(--spacing-xs) var(--spacing-md);
  cursor: pointer;
  font-size: var(--font-size-sm);
  transition: all var(--transition-base);
}

.mfa-switch button:hover {
  border-color: #999;
}

.mfa-description {
  font-size: 12px;
  color: #999;
  margin-top: 5px;
  line-height: 1.5;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 30px;
}

.btn-cancel {
  padding: 8px 16px;
  background-color: #3f3f3f;
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-weight: bold;
}

.btn-submit {
  padding: 8px 16px;
  background-color: #0083d3;
  color: #ffffff;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-weight: bold;
}

.btn-cancel:hover {
  background-color: #444;
}

.btn-submit:hover {
  background-color: #0096f2;
}

/* 添加状态标签样式 */
.tag {
  display: inline-block;
  padding: 2px 6px;
  margin-left: 8px;
  font-size: 12px;
  border-radius: 4px;
  font-weight: normal;
  vertical-align: middle;
}

.tag-success {
  background-color: var(--color-success-bg);
  color: var(--color-success);
  border: 1px solid var(--color-success-light);
}
</style> 