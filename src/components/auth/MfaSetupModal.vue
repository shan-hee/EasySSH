<template>
  <Modal 
    v-model:visible="isVisible" 
    title="设置双因素身份验证" 
    customClass="mfa-modal"
    :hide-footer="true"
    @close="handleClose"
  >
    <div class="mfa-setup-container">
      <div class="mfa-steps">
        <div class="step-item" :class="{ 'active': currentStep === 1 }">
          <div class="step-number">1</div>
          <div class="step-text">扫描二维码</div>
        </div>
        <div class="step-divider"></div>
        <div class="step-item" :class="{ 'active': currentStep === 2 }">
          <div class="step-number">2</div>
          <div class="step-text">输入验证码</div>
        </div>
      </div>
      
      <div class="mfa-content">
        <div v-if="currentStep === 1" class="qrcode-container">
          <div v-if="isLoading" class="loading-qrcode">
            正在生成二维码...
          </div>
          <div v-else class="qrcode-content">
            <div class="qrcode-wrap">
              <img :src="qrCodeUrl" alt="身份验证器二维码" class="qrcode-image" />
            </div>
            <div class="mfa-instructions">
              <p>1. 下载并安装 Google Authenticator 或其它身份验证器 App</p>
              <p>2. 使用验证器应用扫描上方二维码</p>
              <p>3. 扫描成功后点击"下一步"输入验证码</p>
            </div>
            <div class="mfa-secret">
              <p class="secret-title">无法扫描？手动输入以下密钥：</p>
              <div class="secret-code">{{ secretKey }}</div>
            </div>
            <div class="mfa-btn-container">
              <button class="mfa-btn btn-next" @click="goToVerifyStep">下一步</button>
            </div>
          </div>
        </div>
        
        <div v-else-if="currentStep === 2" class="verify-container">
          <div class="verify-instructions">
            <p>请输入验证器应用上显示的 6 位验证码</p>
          </div>
          <div class="verify-input-container">
            <input 
              type="text" 
              v-model="verificationCode" 
              class="verify-input" 
              maxlength="6" 
              placeholder="输入6位验证码"
              @input="handleCodeInput"
            />
          </div>
          <div class="verify-error" v-if="verifyError">
            {{ verifyError }}
          </div>
          <div class="mfa-btn-container">
            <button class="mfa-btn btn-back" @click="currentStep = 1">返回</button>
            <button 
              class="mfa-btn btn-verify" 
              :disabled="verificationCode.length !== 6 || isVerifying"
              @click="verifyAndEnableMfa"
            >
              {{ isVerifying ? '验证中...' : '验证并启用' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Modal>
</template>

<script>
import { defineComponent, ref, onMounted, watch, computed } from 'vue'
import Modal from '@/components/common/Modal.vue'

export default defineComponent({
  name: 'MfaSetupModal',
  components: {
    Modal
  },
  props: {
    visible: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:visible', 'mfa-setup-complete', 'mfa-setup-cancelled'],
  setup(props, { emit }) {
    // 使用计算属性处理双向绑定
    const isVisible = computed({
      get: () => props.visible,
      set: (value) => emit('update:visible', value)
    })
    
    const currentStep = ref(1)
    const isLoading = ref(true)
    const qrCodeUrl = ref('')
    const secretKey = ref('')
    const verificationCode = ref('')
    const verifyError = ref('')
    const isVerifying = ref(false)
    
    // 监听弹窗显示状态
    watch(() => props.visible, (newVal) => {
      if (newVal) {
        // 弹窗打开时，重置状态并生成QR码
        resetModal()
        generateQrCode()
      }
    })
    
    // 重置模态框状态
    const resetModal = () => {
      currentStep.value = 1
      isLoading.value = true
      verificationCode.value = ''
      verifyError.value = ''
    }
    
    // 生成QR码（模拟API请求）
    const generateQrCode = () => {
      // 实际应用中，这里应该调用后端API获取QR码URL和密钥
      // 直接设置数据，不使用延时
      qrCodeUrl.value = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=otpauth://totp/EasySSH:admin@example.com?secret=JBSWY3DPEHPK3PXP&issuer=EasySSH'
      secretKey.value = 'JBSWY3DPEHPK3PXP'
      isLoading.value = false
    }
    
    // 进入验证步骤
    const goToVerifyStep = () => {
      currentStep.value = 2
      verificationCode.value = ''
      verifyError.value = ''
    }
    
    // 处理验证码输入
    const handleCodeInput = (e) => {
      // 只允许输入数字
      verificationCode.value = e.target.value.replace(/[^0-9]/g, '')
      
      // 清除之前的错误
      if (verifyError.value) {
        verifyError.value = ''
      }
    }
    
    // 验证并启用MFA
    const verifyAndEnableMfa = async () => {
      if (verificationCode.value.length !== 6) {
        verifyError.value = '请输入6位验证码'
        return
      }
      
      isVerifying.value = true
      
      try {
        // 直接验证，不使用延时
        
        // 模拟验证成功
        emit('mfa-setup-complete', {
          secret: secretKey.value
        })
        
        handleClose()
      } catch (error) {
        console.error('MFA验证失败:', error)
        verifyError.value = '验证失败，请确认验证码是否正确'
      } finally {
        isVerifying.value = false
      }
    }
    
    // 关闭弹窗
    const handleClose = () => {
      isVisible.value = false
      
      // 如果用户取消设置，触发取消事件
      if (currentStep.value !== 2 || verificationCode.value.length !== 6) {
        emit('mfa-setup-cancelled')
      }
    }
    
    return {
      isVisible,
      currentStep,
      isLoading,
      qrCodeUrl,
      secretKey,
      verificationCode,
      verifyError,
      isVerifying,
      goToVerifyStep,
      handleCodeInput,
      verifyAndEnableMfa,
      handleClose
    }
  }
})
</script>

<style scoped>
.mfa-setup-container {
  padding: 0 20px 20px;
}

.mfa-steps {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 30px;
}

.step-item {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.step-number {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background-color: #333;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
  font-weight: bold;
}

.step-item.active .step-number {
  background-color: #0083d3;
}

.step-text {
  font-size: 12px;
  color: #999;
}

.step-item.active .step-text {
  color: #fff;
}

.step-divider {
  width: 100px;
  height: 1px;
  background-color: #333;
  margin: 0 15px;
  margin-bottom: 8px;
}

.mfa-content {
  margin-top: 20px;
}

.loading-qrcode {
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #999;
}

.qrcode-container {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.qrcode-content {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.qrcode-wrap {
  background-color: #fff;
  padding: 10px;
  border-radius: 4px;
  margin-bottom: 20px;
  width: fit-content;
}

.qrcode-image {
  width: 200px;
  height: 200px;
  display: block;
}

.mfa-instructions {
  width: 100%;
  margin-bottom: 20px;
}

.mfa-instructions p {
  margin: 0 0 10px;
  color: #ccc;
  font-size: 14px;
  line-height: 1.5;
}

.mfa-secret {
  width: 100%;
  background-color: #121212;
  padding: 15px;
  border-radius: 4px;
  margin-bottom: 20px;
}

.secret-title {
  margin: 0 0 10px;
  color: #999;
  font-size: 13px;
}

.secret-code {
  font-family: monospace;
  font-size: 16px;
  color: #fff;
  letter-spacing: 1px;
  word-break: break-all;
}

.verify-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

.verify-instructions {
  margin-bottom: 20px;
  width: 100%;
  text-align: center;
}

.verify-instructions p {
  margin: 0;
  color: #ccc;
  font-size: 14px;
  line-height: 1.5;
}

.verify-input-container {
  width: 100%;
  margin-bottom: 20px;
}

.verify-input {
  width: 100%;
  height: 50px;
  background-color: transparent;
  border: 1px solid #666;
  border-radius: 6px;
  color: #fff;
  padding: 0 15px;
  box-sizing: border-box;
  outline: none;
  font-weight: normal;
  font-size: 20px;
  text-align: center;
  letter-spacing: 5px;
}

.verify-input:focus {
  border-color: #0083d3;
  box-shadow: 0 0 0 1px rgba(0, 131, 211, 0.2);
}

.verify-error {
  color: #f56c6c;
  font-size: 14px;
  margin-bottom: 20px;
  text-align: center;
}

.mfa-btn-container {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  width: 100%;
  margin-top: 10px;
}

.mfa-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: bold;
  min-width: 80px;
}

.btn-next, .btn-verify {
  background-color: #0083d3;
  color: #fff;
}

.btn-next:hover, .btn-verify:hover {
  background-color: #0096f2;
}

.btn-back {
  background-color: #3f3f3f;
  color: #fff;
}

.btn-back:hover {
  background-color: #4f4f4f;
}

.btn-verify:disabled {
  background-color: #666;
  cursor: not-allowed;
}

/* 为QR码添加加载动画 */
@keyframes pulse {
  0% { opacity: 0.6; }
  50% { opacity: 1; }
  100% { opacity: 0.6; }
}

.loading-qrcode {
  animation: pulse 1.5s infinite;
}

/* 修改弹窗样式 */
:deep(.mfa-modal) {
  width: 500px !important;
}
</style> 