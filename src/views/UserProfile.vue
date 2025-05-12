<template>
  <div class="profile-container">
    <div class="profile-header">
      <h1>更新个人资料</h1>
    </div>
    <div class="profile-form">
      <div class="form-group">
        <label for="username">新用户名</label>
        <input type="text" id="username" v-model="profileForm.username" class="form-input" />
      </div>
      <div class="form-group">
        <label for="oldPassword">原始密码</label>
        <input type="password" id="oldPassword" v-model="profileForm.oldPassword" class="form-input" />
      </div>
      <div class="form-group">
        <label for="newPassword">新密码</label>
        <input type="password" id="newPassword" v-model="profileForm.newPassword" class="form-input" />
      </div>
      
      <!-- 修改多因素身份验证部分 -->
      <div class="form-group mfa-section">
        <div class="mfa-header">
          <label>多因素身份验证</label>
          <div class="mfa-switch">
            <button @click="handleMfaToggle">
              {{ profileForm.mfaEnabled ? '禁用' : '启用' }}
            </button>
          </div>
        </div>
        <p class="mfa-description">在登录时需要通过额外的安全项。如果您无法通过此验证，则可选择通过电子邮件恢复账户。</p>
      </div>
      
      <div class="form-actions">
        <button class="btn-cancel" @click="closeProfile">关闭</button>
        <button class="btn-submit" @click="submitProfile">确认</button>
      </div>
    </div>
    
    <!-- MFA设置弹窗 -->
    <MfaSetupModal 
      v-model:visible="showMfaSetupModal"
      @mfa-setup-complete="handleMfaSetupComplete"
      @mfa-setup-cancelled="handleMfaSetupCancelled"
    />
  </div>
</template>

<script>
import { defineComponent, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/store/user'
import { ElMessage } from 'element-plus'
import MfaSetupModal from '@/components/auth/MfaSetupModal.vue'

export default defineComponent({
  name: 'UserProfile',
  components: {
    MfaSetupModal
  },
  setup() {
    const router = useRouter()
    const userStore = useUserStore()
    const showMfaSetupModal = ref(false)
    
    // 个人资料表单
    const profileForm = ref({
      username: '',
      oldPassword: '',
      newPassword: '',
      mfaEnabled: false
    })
    
    // 加载当前用户信息
    onMounted(() => {
      if (userStore.isLoggedIn) {
        profileForm.value.username = userStore.username
        // 如果用户有MFA设置，也应该加载
        profileForm.value.mfaEnabled = userStore.userInfo.mfaEnabled || false
      } else {
        // 未登录时跳转回主页
        router.push('/')
      }
    })
    
    // 处理MFA切换
    const handleMfaToggle = () => {
      if (profileForm.value.mfaEnabled) {
        // 如果已启用，则直接禁用
        profileForm.value.mfaEnabled = false
        ElMessage.success('已禁用多因素身份验证')
      } else {
        // 如果未启用，则打开设置弹窗
        showMfaSetupModal.value = true
      }
    }
    
    // 处理MFA设置完成
    const handleMfaSetupComplete = (data) => {
      profileForm.value.mfaEnabled = true
      profileForm.value.mfaSecret = data.secret
      ElMessage.success('已成功启用多因素身份验证')
    }
    
    // 处理MFA设置取消
    const handleMfaSetupCancelled = () => {
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
          mfaEnabled: profileForm.value.mfaEnabled
        }
        
        // 如果有MFA密钥，需要更新
        if (profileForm.value.mfaSecret) {
          updateData.mfaSecret = profileForm.value.mfaSecret
        }
        
        // 如果填写了新密码则添加密码信息
        if (profileForm.value.newPassword && profileForm.value.oldPassword) {
          updateData.oldPassword = profileForm.value.oldPassword
          updateData.newPassword = profileForm.value.newPassword
        }
        
        // 调用更新接口
        await userStore.updateProfile(updateData)
        
        ElMessage.success('个人资料更新成功')
        
        // 清空密码字段
        profileForm.value.oldPassword = ''
        profileForm.value.newPassword = ''
        
        // 更新成功后返回首页
        router.push('/')
      } catch (error) {
        console.error('更新个人资料失败:', error)
        ElMessage.error(error.message || '更新失败，请重试')
      }
    }
    
    // 关闭资料页
    const closeProfile = () => {
      router.push('/')
    }
    
    return {
      profileForm,
      submitProfile,
      closeProfile,
      showMfaSetupModal,
      handleMfaToggle,
      handleMfaSetupComplete,
      handleMfaSetupCancelled
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
  padding: 16px;
  background-color: #121212; /* 更深的头部背景 */
  border-bottom: 1px solid #333;
}

.profile-header h1 {
  margin: 0;
  font-size: 20px;
  font-weight: bold;
  color: #f0f0f0;
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
  border: 1px solid #666;
  border-radius: 6px;
  color: #fff;
  padding: 0 10px;
  box-sizing: border-box;
  outline: none;
  font-weight: normal;
}

.form-input:focus {
  border-color: #0083d3;
  box-shadow: 0 0 0 1px rgba(0, 131, 211, 0.2);
}

.form-input::placeholder {
  color: #666;
}

/* 修改多因素身份验证部分的样式 */
.mfa-section {
  border-top: 1px solid #333;
  padding-top: 20px;
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
  border: 1px solid #666;
  border-radius: 6px;
  color: #fff;
  padding: 5px 15px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.3s;
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
  border-radius: 4px;
  cursor: pointer;
  font-weight: bold;
}

.btn-submit {
  padding: 8px 16px;
  background-color: #0083d3;
  color: #ffffff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: bold;
}

.btn-cancel:hover {
  background-color: #444;
}

.btn-submit:hover {
  background-color: #0096f2;
}
</style> 