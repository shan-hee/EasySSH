<template>
  <div class="login-panel">
    <div class="login-panel-content">
      <h2>EasySSH 登录</h2>
      <form @submit.prevent="handleLogin">
        <div class="form-group">
          <input 
            type="text" 
            id="username" 
            v-model="loginForm.username" 
            placeholder="请输入用户名"
            :disabled="loginLoading"
            autocomplete="username"
          />
        </div>
        <div class="form-group">
          <input 
            type="password" 
            id="password" 
            v-model="loginForm.password" 
            placeholder="请输入密码"
            :disabled="loginLoading"
            autocomplete="current-password"
          />
        </div>
        <div class="login-options">
          <Checkbox 
            v-model="rememberMe" 
            label="记住我" 
            :disabled="loginLoading" 
          />
          <a href="#" class="forgot-password" @click.prevent="forgotPassword">无法登录？</a>
        </div>
        <button 
          type="submit"
          class="login-submit-btn" 
          :disabled="loginLoading"
        >
          <span v-if="!loginLoading">登录</span>
          <span v-else class="loading-spinner"></span>
        </button>
      </form>
      <div class="login-footer">
        <p>还没有账户？ 
          <a href="#" @click.prevent="goToRegister">立即注册</a>
        </p>
      </div>
      <div class="login-copyright">
        © 2025 Theme By <a href="https://github.com/shan-hee/EasySSH" target="_blank">EasySSH</a>
      </div>
    </div>
    <MfaVerifyModal
      v-model:show="showMfaModal"
      :user-info="tempUserInfo"
      @success="handleMfaVerifySuccess"
      @cancel="handleMfaVerifyCancel"
    />
  </div>
</template>

<script>
import { defineComponent, reactive, ref, onMounted } from 'vue'
import { useUserStore } from '@/store/user'
import { ElMessage } from 'element-plus'
import Checkbox from '@/components/common/Checkbox.vue'
import MfaVerifyModal from '@/components/auth/MfaVerifyModal.vue'
import { useRouter } from 'vue-router'
import log from '@/services/log'

// 从localStorage获取保存的凭据函数
function getSavedCredentials() {
  try {
    const encrypted = localStorage.getItem('easyssh_credentials')
    if (!encrypted) return { username: '', password: '', hasCredentials: false }
    
    const decoded = JSON.parse(atob(encrypted))
    return {
      username: decoded.u,
      password: decoded.p,
      hasCredentials: true
    }
  } catch (error) {
    log.error('解析保存的凭据失败:', error)
    return {
      username: '',
      password: '',
      hasCredentials: false
    }
  }
}

export default defineComponent({
  name: 'LoginPanel',
  components: {
    Checkbox,
    MfaVerifyModal
  },
  emits: ['login-success'],
  setup(props, { emit }) {
    const userStore = useUserStore()
    const loginLoading = ref(false)
    const router = useRouter()
    const showMfaModal = ref(false)
    const tempUserInfo = ref(null)
    
    // 在初始化阶段获取保存的凭据
    const savedCreds = getSavedCredentials()
    
    // 初始化表单状态，如果有保存的凭据则直接使用
    const loginForm = reactive({
      username: savedCreds.username,
      password: savedCreds.password
    })
    
    // 初始化记住我选项
    const rememberMe = ref(savedCreds.hasCredentials)
    
    // 移除自动登录代码，用户需要手动点击登录
    onMounted(() => {
      log.info('登录页面初始化，需要用户手动点击登录按钮')
    })
    
    const handleLogin = async () => {
      // 简单表单验证
      if (!loginForm.username.trim() || !loginForm.password.trim()) {
        ElMessage({
          message: '请输入用户名和密码',
          type: 'warning',
          offset: 3,
          zIndex: 9999
        })
        return
      }
      
      try {
        loginLoading.value = true
        
        // 记录是否使用记住我选项
        log.info(`登录使用"记住我"选项: ${rememberMe.value}`)
        
        // 调用登录方法
        const result = await userStore.login({
          username: loginForm.username,
          password: loginForm.password,
          remember: rememberMe.value
        })
        
        if (result.success) {
          // 检查是否需要MFA验证
          if (result.requireMfa) {
            // 保存临时用户信息
            tempUserInfo.value = result.user
            tempUserInfo.value.isDefaultPassword = result.isDefaultPassword
            // 显示MFA验证弹窗
            showMfaModal.value = true
            return
          }
          
          // 不需要MFA，直接完成登录流程
          completeLogin(result.silent, result.isDefaultPassword)
        }
      } catch (error) {
        console.error('登录失败:', error)
        
        ElMessage({
          message: `登录失败: ${error.message || '未知错误'}`,
          type: 'error',
          offset: 3,
          zIndex: 9999
        })
      } finally {
        loginLoading.value = false
      }
    }
    
    // MFA验证成功处理
    const handleMfaVerifySuccess = async () => {
      try {
        loginLoading.value = true
        
        // 获取是否使用默认密码的状态
        const isDefaultPassword = tempUserInfo.value?.isDefaultPassword || false
        
        // 完成登录流程
        completeLogin(false, isDefaultPassword)
      } catch (error) {
        console.error('MFA验证后登录失败:', error)
        ElMessage({
          message: `登录失败: ${error.message || '未知错误'}`,
          type: 'error',
          offset: 3,
          zIndex: 9999
        })
      } finally {
        loginLoading.value = false
      }
    }
    
    // 完成登录流程
    const completeLogin = (silent = false, isDefaultPassword = false) => {
      // 清空表单(密码字段)
      loginForm.password = ''
      tempUserInfo.value = null
      
      // 发送登录成功事件
      emit('login-success')
      
      // 如果使用默认密码，显示安全提示并导向修改密码页面
      if (isDefaultPassword) {
        ElMessage({
          message: '您当前使用的是系统初始密码，存在严重安全风险。为了保障您的账户安全，请立即修改密码。',
          type: 'warning',
          offset: 3,
          zIndex: 9999,
          duration: 5000
        })
        
        // 导航到用户资料页进行密码修改
        router.push('/profile')
        return
      }
      
      // 显示登录成功消息(如果不是静默模式)
      if (!silent) {
      ElMessage({
        message: '登录成功',
        type: 'success',
        offset: 3,
        zIndex: 9999
      })
      }
      
      // 登录成功后导航到控制台
      router.push('/')
    }
    
    // MFA验证取消处理
    const handleMfaVerifyCancel = () => {
      tempUserInfo.value = null
    }
    
    const forgotPassword = () => {
      // 提示用户联系管理员
      ElMessage({
        message: '如果无法登录，请联系系统管理员',
        type: 'info',
        offset: 3,
        zIndex: 9999
      })
    }
    
    const goToRegister = () => {
      // 提示用户功能暂未实现
      ElMessage({
        message: '注册功能暂未实现',
        type: 'info',
        offset: 3,
        zIndex: 9999
      })
    }
    
    return {
      loginForm,
      loginLoading,
      rememberMe,
      handleLogin,
      forgotPassword,
      goToRegister,
      showMfaModal,
      handleMfaVerifySuccess,
      handleMfaVerifyCancel,
      tempUserInfo
    }
  }
})
</script>

<style scoped>
.login-panel {
  width: 360px;
  max-width: 100%;
  background: transparent;
  overflow: hidden;
}

.login-panel-content {
  padding: 0;
  width: 360px;
}

.login-panel-content h2 {
  margin: 0 0 30px 0;
  color: #ffffff;
  font-size: 1.6rem;
  font-weight: 500;
  text-align: center;
  letter-spacing: 1px;
  font-family: "Microsoft YaHei", sans-serif !important;
}

.form-group {
  margin-bottom: 15px;
}

.form-group input {
  width: 100%;
  padding: 12px 15px;
  background-color: rgba(40, 40, 40, 0.4);
  border: none;
  border-radius: 4px;
  color: #ffffff;
  font-size: 1rem;
  transition: all 0.2s ease;
  font-family: "Microsoft YaHei", sans-serif !important;
}

.form-group input::placeholder {
  color: #888888;
  font-family: "Microsoft YaHei", sans-serif !important;
}

.form-group input:focus {
  background-color: rgba(50, 50, 50, 0.6);
  outline: none;
  box-shadow: 0 0 0 1px rgba(100, 100, 100, 0.3);
}

.login-options {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  opacity: 0.8;
}

.forgot-password {
  color: #aaaaaa;
  font-size: 0.9rem;
  text-decoration: none;
  transition: color 0.2s;
  font-family: "Microsoft YaHei", sans-serif !important;
}

.forgot-password:hover {
  color: #eeeeee;
}

.login-submit-btn {
  width: 100%;
  padding: 12px;
  margin-top: 10px;
  background-color: rgba(60, 60, 60, 0.6);
  border: none;
  border-radius: 4px;
  color: #ffffff;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s ease;
  letter-spacing: 1px;
  font-family: "Microsoft YaHei", sans-serif !important;
}

.login-submit-btn:hover {
  background-color: rgba(80, 80, 80, 0.8);
}

.login-submit-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.loading-spinner {
  display: inline-block;
  width: 20px;
  height: 20px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  border-top-color: #ffffff;
  animation: spinner 0.8s linear infinite;
}

@keyframes spinner {
  to {
    transform: rotate(360deg);
  }
}

.login-footer {
  margin-top: 25px;
  padding-top: 15px;
  border-top: 1px solid rgba(100, 100, 100, 0.15);
  text-align: center;
}

.login-footer p {
  margin: 0;
  color: #999999;
  font-size: 0.9rem;
  font-family: "Microsoft YaHei", sans-serif !important;
}

.login-footer a {
  color: #aaaaaa;
  text-decoration: none;
  transition: color 0.2s;
  font-weight: 500;
  font-family: "Microsoft YaHei", sans-serif !important;
}

.login-footer a:hover {
  color: #eeeeee;
  text-decoration: none;
}

.login-copyright {
  margin-top: 15px;
  text-align: center;
  font-size: 0.8rem;
  opacity: 0.5;
  font-family: "Microsoft YaHei", sans-serif !important;
}

.login-copyright a {
  color: inherit;
  text-decoration: none;
}
</style> 