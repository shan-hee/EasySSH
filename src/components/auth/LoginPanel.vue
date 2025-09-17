<template>
  <div class="login-panel">
    <div class="login-panel-content">
      <h2>{{ formTitle }}</h2>
      <form @submit.prevent="handleLogin">
        <div class="form-group">
          <input
            id="username"
            v-model="loginForm.username"
            type="text"
            placeholder="请输入用户名"
            :disabled="loginLoading"
            autocomplete="username"
          />
        </div>
        <div class="form-group">
          <input
            id="password"
            v-model="loginForm.password"
            type="password"
            placeholder="请输入密码"
            :disabled="loginLoading"
            autocomplete="current-password"
          />
        </div>
        <div class="login-options">
          <checkbox v-model="rememberMe" label="记住我" :disabled="loginLoading" />
          <a href="#" class="forgot-password" @click.prevent="forgotPassword">无法登录？</a>
        </div>
        <button type="submit" class="login-submit-btn" :disabled="loginLoading">
          <span v-if="!loginLoading">{{ submitButtonText }}</span>
          <span v-else class="loading-spinner" />
        </button>
      </form>
      <div class="login-footer" v-if="!isFirstAdminMode">
        <p>
          还没有账户？
          <a href="#" @click.prevent="goToRegister">立即注册</a>
        </p>
      </div>
      <div class="login-copyright">
        © 2025 Theme By <a href="https://github.com/shan-hee/EasySSH" target="_blank">EasySSH</a>
      </div>
    </div>
    <mfa-verify-modal
      v-model:show="showMfaModal"
      :user-info="tempUserInfo"
      @success="handleMfaVerifySuccess"
      @cancel="handleMfaVerifyCancel"
    />
  </div>
</template>

<script>
import { defineComponent, reactive, ref, onMounted, computed } from 'vue';
import { useUserStore } from '@/store/user';
import { ElMessage } from 'element-plus';
import Checkbox from '@/components/common/Checkbox.vue';
import MfaVerifyModal from '@/components/auth/MfaVerifyModal.vue';
import { useRouter } from 'vue-router';
import log from '@/services/log';
import storageService from '@/services/storage';
import apiService from '@/services/api';
import authStateManager from '@/services/auth-state-manager';

// 从统一存储获取保存的凭据函数
function getSavedCredentials() {
  try {
    const encrypted = storageService.getItem('easyssh_credentials');
    if (!encrypted) return { username: '', password: '', hasCredentials: false };

    const decoded = JSON.parse(atob(encrypted));
    return {
      username: decoded.u,
      password: decoded.p,
      hasCredentials: true
    };
  } catch (error) {
    log.error('解析保存的凭据失败:', error);
    return {
      username: '',
      password: '',
      hasCredentials: false
    };
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
    const userStore = useUserStore();
    const loginLoading = ref(false);
    const router = useRouter();
    const showMfaModal = ref(false);
    const tempUserInfo = ref(null);
    const isFirstAdminMode = ref(false);

    // 在初始化阶段获取保存的凭据
    const savedCreds = getSavedCredentials();

    // 初始化表单状态，如果有保存的凭据则直接使用（仅自动填充，不自动登录）
    const loginForm = reactive({
      username: savedCreds.username,
      password: savedCreds.password
    });

    // 初始化记住我选项
    const rememberMe = ref(savedCreds.hasCredentials);

    // 移除自动登录代码，用户需要手动点击登录按钮
    onMounted(async () => {
      if (!window._loginPanelMounted) {
        log.info('登录页面初始化，需要用户手动点击登录按钮');
        window._loginPanelMounted = true;
      }

      // 检查各种登出场景并显示相应提示
      checkLogoutScenarios();

      // 检测是否存在管理员账户，用于首次引导创建管理员
      try {
        await apiService.init();
        // 使用默认缓存策略获取管理员存在性
        const resp = await apiService.get('/users/admin-exists');
        if (resp && resp.success) {
          isFirstAdminMode.value = !resp.adminExists;
          if (isFirstAdminMode.value) {
            log.info('未检测到管理员账户，启用首次管理员创建模式');
          }
        }
      } catch (e) {
        // 静默失败：保持默认登录模式
        log.warn('检查管理员存在性失败，按普通登录处理', e);
      }
    });

    // 检查登出场景并显示相应提示
    const checkLogoutScenarios = () => {
      // 检查URL中是否包含远程注销参数
      const urlParams = new URLSearchParams(window.location.search);

      if (urlParams.has('remote-logout')) {
        ElMessage({
          message: '您的账号已在其他设备上被注销，请重新登录',
          type: 'warning',
          duration: 5000,
          offset: 80,
          zIndex: 9999
        });
        // 清理URL参数
        cleanUrlParams(['remote-logout']);
      }

      // 检查sessionStorage中的完全登出标志
      if (sessionStorage.getItem('auth_complete_logout')) {
        ElMessage({
          message: '登录已过期，请重新登录',
          type: 'info',
          duration: 4000,
          offset: 80,
          zIndex: 9999
        });
        // 清理标志
        sessionStorage.removeItem('auth_complete_logout');
      }

      // 检查登出错误标志
      if (sessionStorage.getItem('auth_logout_error')) {
        ElMessage({
          message: '登录状态异常，请重新登录',
          type: 'warning',
          duration: 4000,
          offset: 80,
          zIndex: 9999
        });
        // 清理标志
        sessionStorage.removeItem('auth_logout_error');
      }

      // 检查强制登出参数（向后兼容）
      if (urlParams.has('force-logout')) {
        ElMessage({
          message: '登录已过期，请重新登录',
          type: 'info',
          duration: 4000,
          offset: 80,
          zIndex: 9999
        });
        // 清理URL参数
        cleanUrlParams(['force-logout']);
      }
    };

    // 清理URL参数的通用函数
    const cleanUrlParams = paramsToRemove => {
      const urlParams = new URLSearchParams(window.location.search);
      let hasChanges = false;

      paramsToRemove.forEach(param => {
        if (urlParams.has(param)) {
          urlParams.delete(param);
          hasChanges = true;
        }
      });

      if (hasChanges) {
        const newUrl =
          window.location.pathname +
          (urlParams.toString() ? `?${urlParams.toString()}` : '') +
          window.location.hash;
        window.history.replaceState({}, '', newUrl);
      }
    };

    const handleLogin = async () => {
      // 简单表单验证
      if (!loginForm.username.trim() || !loginForm.password.trim()) {
        ElMessage({
          message: '请输入用户名和密码',
          type: 'warning',
          offset: 3,
          zIndex: 9999
        });
        return;
      }

      try {
        loginLoading.value = true;

        if (isFirstAdminMode.value) {
          // 首次启动：注册管理员并登录
          log.info('首次模式：创建管理员并登录', { username: loginForm.username });
          const resp = await apiService.post('/users/register', {
            username: loginForm.username,
            password: loginForm.password,
            // 后端会在无管理员时自动授予管理员权限
            // isAdmin: true // 可不传，由后端判定
          });

          if (resp && resp.success && resp.token && resp.user) {
            // 记住密码选项
            if (rememberMe.value) {
              userStore.saveUserCredentials(loginForm.username, loginForm.password);
            } else {
              userStore.clearUserCredentials();
            }

            // 设置登录状态
            userStore.setToken(resp.token);
            userStore.setUserInfo(resp.user);

            // 已成功创建管理员，关闭引导模式
            isFirstAdminMode.value = false;

            // 更新 /users/admin-exists 的缓存为存在管理员（60秒TTL）
            try {
              apiService.setGetCache('/users/admin-exists', {}, { success: true, adminExists: true }, 60000);
            } catch (e) {
              log.warn('更新管理员存在性缓存失败', e);
            }

            const createdIsAdmin = !!(resp.user && resp.user.isAdmin);
            ElMessage({
              message: createdIsAdmin ? '管理员账户已创建并已登录' : '账户已创建并已登录',
              type: 'success',
              offset: 3,
              zIndex: 9999
            });

            // 通知登录状态管理器
            try {
              await authStateManager.onUserLogin(resp.user);
            } catch (e) {
              log.warn('通知登录状态管理器失败', e);
            }

            // 跳转主页
            router.push('/');
            emit('login-success');
            return;
          } else {
            throw new Error(resp?.message || '创建管理员失败');
          }
        } else {
          // 常规登录
          // 记录登录选项（合并到登录流程日志中）
          log.info('开始登录流程', {
            username: loginForm.username,
            remember: rememberMe.value
          });

          // 调用登录方法
          const result = await userStore.login({
            username: loginForm.username,
            password: loginForm.password,
            remember: rememberMe.value
          });

          if (result.success) {
            // 检查是否需要MFA验证
          if (result.requireMfa) {
            // 保存临时用户信息
            tempUserInfo.value = result.user;
            // 显示MFA验证弹窗
            showMfaModal.value = true;
            return;
          }

          // 不需要MFA，直接完成登录流程
          completeLogin(result.silent);
        }
        }
      } catch (error) {
        console.error('登录失败:', error);

        ElMessage({
          message: `登录失败: ${error.message || '未知错误'}`,
          type: 'error',
          offset: 3,
          zIndex: 9999
        });
      } finally {
        loginLoading.value = false;
      }
    };

    // MFA验证成功处理
    const handleMfaVerifySuccess = async () => {
      try {
        loginLoading.value = true;

        // 完成登录流程
        completeLogin(false);
      } catch (error) {
        console.error('MFA验证后登录失败:', error);
        ElMessage({
          message: `登录失败: ${error.message || '未知错误'}`,
          type: 'error',
          offset: 3,
          zIndex: 9999
        });
      } finally {
        loginLoading.value = false;
      }
    };

    // 完成登录流程
    const completeLogin = (silent = false) => {
      // 清空表单(密码字段)
      loginForm.password = '';
      tempUserInfo.value = null;

      // 发送登录成功事件，同时发出清空页签的事件
      emit('login-success');

      // 发出清空页签的全局事件
      window.dispatchEvent(new CustomEvent('auth:login-success-clear-tabs'));

      // 显示登录成功消息(如果不是静默模式)
      if (!silent) {
        ElMessage({
          message: '登录成功',
          type: 'success',
          offset: 3,
          zIndex: 9999
        });
      }

      // 登录成功后导航到控制台
      router.push('/');
    };

    // MFA验证取消处理
    const handleMfaVerifyCancel = () => {
      tempUserInfo.value = null;
    };

    const forgotPassword = () => {
      // 提示用户联系管理员
      ElMessage({
        message: '如果无法登录，请联系系统管理员',
        type: 'info',
        offset: 3,
        zIndex: 9999
      });
    };

    const goToRegister = () => {
      // 提示用户功能暂未实现
      ElMessage({
        message: '注册功能暂未实现',
        type: 'info',
        offset: 3,
        zIndex: 9999
      });
    };

    const formTitle = computed(() =>
      isFirstAdminMode.value
        ? '欢迎使用EasySSH'
        : 'EasySSH 登录'
    );

    const submitButtonText = computed(() =>
      isFirstAdminMode.value ? '登录并创建管理员账户' : '登录'
    );

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
      tempUserInfo,
      isFirstAdminMode,
      formTitle,
      submitButtonText
    };
  }
});
</script>

<style scoped>
.login-panel {
  width: 360px;
  max-width: 100%;
  background: transparent;
  overflow: hidden;

  /* 统一字体设置，避免在每个子元素中重复使用!important */
  font-family: 'Microsoft YaHei', sans-serif;

  /* 确保所有子元素继承字体 */
  * {
    font-family: inherit;
  }
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
  /* font-family继承自父元素，无需!important */
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
  transition: all var(--theme-transition-duration) var(--theme-transition-timing);
  /* font-family继承自父元素 */
}

.form-group input::placeholder {
  color: #888888;
  /* font-family继承自父元素 */
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
  color: var(--login-panel-forgot-password-color);
  font-size: 0.9rem;
  text-decoration: none;
  transition: color var(--theme-transition-duration) var(--theme-transition-timing);
  /* font-family继承自父元素 */
}

.forgot-password:hover {
  color: var(--login-panel-forgot-password-hover-color);
}

.login-submit-btn {
  width: 100%;
  padding: 12px;
  margin-top: 10px;
  background-color: var(--login-panel-submit-btn-bg);
  border: none;
  border-radius: 4px;
  color: var(--login-panel-submit-btn-color);
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color var(--theme-transition-duration) var(--theme-transition-timing);
  letter-spacing: 1px;
  /* font-family继承自父元素 */
}

.login-submit-btn:hover {
  background-color: var(--login-panel-submit-btn-hover-bg);
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
  /* font-family继承自父元素 */
}

.login-footer a {
  color: var(--login-panel-link-color);
  text-decoration: none;
  transition: color var(--theme-transition-duration) var(--theme-transition-timing);
  font-weight: 500;
  /* font-family继承自父元素 */
}

.login-footer a:hover {
  color: var(--login-panel-link-hover-color);
  text-decoration: none;
}

.login-copyright {
  margin-top: 15px;
  text-align: center;
  font-size: 0.8rem;
  opacity: 0.5;
  /* font-family继承自父元素 */
}

.login-copyright a {
  color: inherit;
  text-decoration: none;
}

/* 主题特定样式已迁移到主题变量 */
.login-panel-content h2 {
  color: var(--login-panel-title-color);
}

:root[data-theme='light'] .form-group input,
.light-theme .form-group input,
html[data-theme='light'] .form-group input {
  background-color: rgba(245, 247, 250, 0.8);
  border: 1px solid #dcdfe6;
  color: #606266;
}

:root[data-theme='light'] .form-group input::placeholder,
.light-theme .form-group input::placeholder,
html[data-theme='light'] .form-group input::placeholder {
  color: #c0c4cc;
}

:root[data-theme='light'] .form-group input:focus,
.light-theme .form-group input:focus,
html[data-theme='light'] .form-group input:focus {
  background-color: rgba(236, 245, 255, 0.8);
  border-color: #aaaaaa;
  box-shadow: 0 0 0 2px rgba(170, 170, 170, 0.2);
}

:root[data-theme='light'] .forgot-password,
.light-theme .forgot-password,
html[data-theme='light'] .forgot-password {
  color: #909399;
}

:root[data-theme='light'] .forgot-password:hover,
.light-theme .forgot-password:hover,
html[data-theme='light'] .forgot-password:hover {
  color: #aaaaaa;
}

:root[data-theme='light'] .login-submit-btn,
.light-theme .login-submit-btn,
html[data-theme='light'] .login-submit-btn {
  background-color: #aaaaaa;
  color: #ffffff;
}

:root[data-theme='light'] .login-submit-btn:hover,
.light-theme .login-submit-btn:hover,
html[data-theme='light'] .login-submit-btn:hover {
  background-color: #bbbbbb;
}

:root[data-theme='light'] .loading-spinner,
.light-theme .loading-spinner,
html[data-theme='light'] .loading-spinner {
  border: 2px solid rgba(170, 170, 170, 0.3);
  border-top-color: #ffffff;
}

:root[data-theme='light'] .login-footer,
.light-theme .login-footer,
html[data-theme='light'] .login-footer {
  border-top: 1px solid #e4e7ed;
}

:root[data-theme='light'] .login-footer p,
.light-theme .login-footer p,
html[data-theme='light'] .login-footer p {
  color: #c0c4cc;
}

:root[data-theme='light'] .login-footer a,
.light-theme .login-footer a,
html[data-theme='light'] .login-footer a {
  color: #909399;
}

:root[data-theme='light'] .login-footer a:hover,
.light-theme .login-footer a:hover,
html[data-theme='light'] .login-footer a:hover {
  color: #aaaaaa;
}
</style>
