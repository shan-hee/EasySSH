<template>
  <Modal 
    v-model:visible="isVisible" 
    title="设置两步验证" 
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
        <div class="step-divider" :class="{ 'active': currentStep === 2 }"></div>
        <div class="step-item" :class="{ 'active': currentStep === 2 }">
          <div class="step-number">2</div>
          <div class="step-text">输入验证码</div>
        </div>
      </div>
      
      <div class="mfa-content">
        <div v-if="currentStep === 1" class="qrcode-container">
          <div v-if="isLoading" class="loading-qrcode">
            <div class="loading-spinner"></div>
            <span>正在生成二维码...</span>
          </div>
          <div v-else class="qrcode-content">
            <div class="qrcode-wrap">
              <img :src="qrCodeUrl" alt="身份验证器二维码" class="qrcode-image" @load="onQrCodeLoaded" />
            </div>
            <div class="mfa-instructions">
              <div class="instruction-step">
                <div class="instruction-number">1</div>
                <p>下载并安装 Google Authenticator 或其它身份验证器 App</p>
              </div>
              <div class="instruction-step">
                <div class="instruction-number">2</div>
                <p>使用验证器应用扫描上方二维码</p>
              </div>
              <div class="instruction-step">
                <div class="instruction-number">3</div>
                <p>扫描成功后点击"下一步"输入验证码</p>
              </div>
            </div>
            <div class="mfa-secret">
              <p class="secret-title">无法扫描？手动输入以下密钥：</p>
              <div class="secret-code-container">
                <div class="secret-code">
                  {{ secretKey }}
                  <button class="copy-btn" @click="copySecretKey" title="复制密钥">
                    <svg class="copy-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">
                      <path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
                    </svg>
                  </button>
                </div>
              </div>
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
            <div class="code-inputs">
              <template v-for="(digit, index) in 6" :key="index">
                <input
                  type="text"
                  maxlength="1"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  class="code-input"
                  :value="verificationCode[index] || ''"
                  @input="handleDigitInput($event, index)"
                  @keydown="handleKeyDown($event, index)"
                  @paste="handlePaste"
                  ref="codeInputs"
                />
                <span class="code-separator" v-if="index < 5"></span>
              </template>
            </div>
          </div>
          <div class="verify-error" v-if="verifyError">
            <i class="error-icon"></i>
            {{ verifyError }}
          </div>
          <div class="mfa-btn-container">
            <button class="mfa-btn btn-back" @click="currentStep = 1">返回</button>
            <button 
              class="mfa-btn btn-verify" 
              :disabled="verificationCode.length !== 6 || isVerifying"
              @click="verifyAndEnableMfa"
            >
              <span v-if="isVerifying" class="btn-loading"></span>
              {{ isVerifying ? '验证中...' : '验证并启用' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Modal>
</template>

<script>
import { defineComponent, ref, onMounted, watch, computed, nextTick } from 'vue'
import Modal from '@/components/common/Modal.vue'
import CryptoJS from 'crypto-js'
import mfaService from '@/services/mfa'
import { useUserStore } from '@/store/user'
import { ElMessage } from 'element-plus'

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
    const userStore = useUserStore()
    
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
    const codeInputs = ref([])
    let autoSubmitTimeout = null
    
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
    
    // 二维码加载完成处理
    const onQrCodeLoaded = () => {
      isLoading.value = false
    }
    
    // 生成QR码
    const generateQrCode = () => {
      try {
        // 预先将loading设为true
        isLoading.value = true
        
        // 生成安全的随机密钥
        const key = mfaService.generateSecretKey()
        secretKey.value = key
        
        // 获取当前用户信息，用于生成更个性化的URI
        const username = userStore.username || 'user@easyssh.com'
        
        // 生成otpauth URI
        const otpAuthUri = mfaService.generateOtpAuthUri(key, username)
        
        // 生成QR码URL
        qrCodeUrl.value = mfaService.generateQrCodeUrl(otpAuthUri)
        
        // 预加载二维码图片
        const img = new Image()
        img.onload = () => {
          // 二维码加载完成后再设置isLoading为false
          isLoading.value = false
        }
        img.onerror = () => {
          console.error('二维码加载失败')
          isLoading.value = false
        }
        img.src = qrCodeUrl.value
      } catch (error) {
        console.error('生成QR码失败:', error)
        isLoading.value = false
      }
    }
    
    // 处理单个数字输入
    const handleDigitInput = (e, index) => {
      // 只允许输入数字
      const inputValue = e.target.value.replace(/[^0-9]/g, '');
      const lastChar = inputValue.length > 0 ? inputValue[inputValue.length - 1] : '';
      
      // 更新verificationCode
      let newCode = verificationCode.value.split('');
      newCode[index] = lastChar;
      verificationCode.value = newCode.join('');
      
      // 设置当前输入框的值为最后输入的数字
      e.target.value = lastChar;
      
      // 清除错误信息
      if (verifyError.value) {
        verifyError.value = '';
      }
      
      // 自动跳转到下一个输入框（仅输入新数字时）
      if (lastChar && index < 5) {
        nextTick(() => {
          codeInputs.value[index + 1].focus();
        });
      }
      
      // 自动提交：6位且全为数字才触发
      const codeArr = verificationCode.value.split('');
      const isAllDigits = codeArr.length === 6 && codeArr.every(c => /^[0-9]$/.test(c));
      if (isAllDigits && !isVerifying.value) {
        clearTimeout(autoSubmitTimeout)
        autoSubmitTimeout = setTimeout(() => {
          verifyAndEnableMfa()
        }, 100)
      }
    }
    
    // 处理键盘导航
    const handleKeyDown = (e, index) => {
      // 处理删除键
      if (e.key === 'Backspace' && !verificationCode.value[index]) {
        if (index > 0) {
          nextTick(() => {
            codeInputs.value[index - 1].focus()
          })
        }
      }
      
      // 左箭头导航
      if (e.key === 'ArrowLeft' && index > 0) {
        nextTick(() => {
          codeInputs.value[index - 1].focus()
        })
      }
      
      // 右箭头导航
      if (e.key === 'ArrowRight' && index < 5) {
        nextTick(() => {
          codeInputs.value[index + 1].focus()
        })
      }
    }
    
    // 处理粘贴操作
    const handlePaste = (e) => {
      e.preventDefault();
      const pasteData = (e.clipboardData || window.clipboardData).getData('text');
      const digits = pasteData.replace(/[^0-9]/g, '').substring(0, 6);
      
      if (digits) {
        verificationCode.value = digits.padEnd(6, '').substring(0, 6);
        // 将数字分配到每个输入框
        for (let i = 0; i < digits.length && i < 6; i++) {
          if (codeInputs.value[i]) {
            codeInputs.value[i].value = digits[i];
          }
        }
        // 自动提交：6位且全为数字才触发
        const codeArr = verificationCode.value.split('');
        const isAllDigits = codeArr.length === 6 && codeArr.every(c => /^[0-9]$/.test(c));
        if (isAllDigits && !isVerifying.value) {
          clearTimeout(autoSubmitTimeout)
          autoSubmitTimeout = setTimeout(() => {
            verifyAndEnableMfa()
          }, 100)
        }
      }
    }
    
    // 进入验证步骤
    const goToVerifyStep = () => {
      currentStep.value = 2
      verificationCode.value = ''
      verifyError.value = ''
      
      // 聚焦第一个输入框
      nextTick(() => {
        if (codeInputs.value[0]) {
          codeInputs.value[0].focus()
        }
      })
    }
    
    // 验证并启用MFA
    const verifyAndEnableMfa = async () => {
      // 1. 输入长度不足
      if (verificationCode.value.length !== 6) {
        verifyError.value = '请输入6位验证码';
        // 新增：失败时聚焦最后一个输入框
        nextTick(() => {
          if (codeInputs.value[5]) {
            codeInputs.value[5].focus();
          }
        });
        return;
      }
      // 2. 存在非数字字符
      if (!/^\d{6}$/.test(verificationCode.value)) {
        verifyError.value = '验证码只能包含数字，请重新输入';
        // 新增：失败时聚焦最后一个输入框
        nextTick(() => {
          if (codeInputs.value[5]) {
            codeInputs.value[5].focus();
          }
        });
        return;
      }
      if (isVerifying.value) return;
      isVerifying.value = true;
      try {
        // 使用 mfaService.enableMfa 来启用 MFA
        const result = await mfaService.enableMfa(secretKey.value, verificationCode.value);
        if (result.success) {
          // 直接用返回的用户数据刷新本地状态
          if (result.user) {
            emit('mfa-setup-complete', { user: result.user, secret: secretKey.value });
          } else if (result.data && result.data.user) {
            emit('mfa-setup-complete', { user: result.data.user, secret: secretKey.value });
          }
          handleClose();
        } else {
          verifyError.value = result.message || '验证失败，请确保您输入了正确的验证码';
          // 新增：失败时聚焦最后一个输入框
          nextTick(() => {
            if (codeInputs.value[5]) {
              codeInputs.value[5].focus();
            }
          });
        }
      } catch (error) {
        console.error('MFA验证失败:', error);
        verifyError.value = '验证失败，请重试';
        // 新增：失败时聚焦最后一个输入框
        nextTick(() => {
          if (codeInputs.value[5]) {
            codeInputs.value[5].focus();
          }
        });
      } finally {
        isVerifying.value = false;
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
    
    // 复制密钥到剪贴板 - 使用统一的剪贴板服务
    const copySecretKey = async () => {
      try {
        // 使用统一的剪贴板服务
        const { copyToClipboard } = await import('@/services/utils.js')
        const success = await copyToClipboard(secretKey.value, false)

        if (success) {
          ElMessage.success('密钥已复制到剪贴板')
        } else {
          ElMessage.error('复制失败，请手动复制')
        }
      } catch (error) {
        ElMessage.error('复制失败，请手动复制')
        console.error('复制失败:', error)
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
      handleDigitInput,
      handleKeyDown,
      handlePaste,
      verifyAndEnableMfa,
      handleClose,
      onQrCodeLoaded,
      codeInputs,
      copySecretKey
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
  padding-top: 10px;
}

.step-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
  z-index: 1;
}

.step-number {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background-color: #2a2a2a;
  color: #999;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 10px;
  font-weight: bold;
  transition: all 0.3s ease;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.step-item.active .step-number {
  background-color: #0083d3;
  color: #fff;
  transform: scale(1.1);
  box-shadow: 0 0 0 4px rgba(0, 131, 211, 0.2);
}

.step-text {
  font-size: 13px;
  color: #999;
  transition: all 0.3s ease;
}

.step-item.active .step-text {
  color: #fff;
  font-weight: 500;
}

.step-divider {
  width: 100px;
  height: 2px;
  background-color: #2a2a2a;
  margin: 0 15px;
  margin-bottom: 25px;
  transition: all 0.5s ease;
  position: relative;
}

.step-divider.active {
  background-color: #0083d3;
}

.step-divider::after {
  content: '';
  position: absolute;
  width: 0%;
  height: 100%;
  background-color: #0083d3;
  left: 0;
  top: 0;
  transition: width 0.5s ease;
}

.step-divider.active::after {
  width: 100%;
}

.mfa-content {
  margin-top: 20px;
}

.loading-qrcode {
  width: 220px;
  height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: #181818;
  border-radius: 8px;
  color: #999;
  margin-bottom: 20px;
  box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.3);
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255, 255, 255, 0.1);
  border-radius: 50%;
  border-top-color: #0083d3;
  animation: spin 1s ease-in-out infinite;
  margin-bottom: 10px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
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
  padding: 15px;
  border-radius: 12px;
  margin-bottom: 30px;
  width: fit-content;
  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.2);
}

.qrcode-image {
  width: 200px;
  height: 200px;
  display: block;
}

.mfa-instructions {
  width: 100%;
  margin-bottom: 25px;
}

.instruction-step {
  display: flex;
  align-items: flex-start;
  margin-bottom: 15px;
}

.instruction-number {
  min-width: 24px;
  height: 24px;
  border-radius: 50%;
  background-color: #0083d3;
  color: #fff;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 12px;
  margin-top: 2px;
}

.instruction-step p {
  margin: 0;
  color: #ddd;
  font-size: 14px;
  line-height: 1.6;
}

.mfa-secret {
  width: 100%;
  background-color: #1a1a1a;
  padding: 15px;
  border-radius: 8px;
  margin-bottom: 20px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.secret-title {
  margin: 0 0 10px;
  color: #999;
  font-size: 13px;
}

.secret-code-container {
  position: relative;
}

.secret-code {
  font-family: monospace;
  font-size: 16px;
  color: #fff;
  letter-spacing: 1px;
  word-break: break-all;
  background-color: rgba(0, 0, 0, 0.2);
  padding: 10px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  position: relative;
}

.copy-btn {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background-color: transparent;
  border: none;
  color: #ccc;
  cursor: pointer;
  transition: all 0.2s ease;
  padding: 0;
}

.copy-btn:hover {
  color: white;
}

.copy-icon {
  width: 16px;
  height: 16px;
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
  color: #ddd;
  font-size: 15px;
  line-height: 1.5;
}

.verify-input-container {
  width: 100%;
  margin: 30px 0;
}

.code-inputs {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  margin: 0 auto;
}

.code-input {
  width: 45px;
  height: 55px;
  background-color: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #fff;
  font-size: 24px;
  font-weight: 500;
  text-align: center;
  outline: none;
  transition: all 0.3s ease;
  padding: 0;
  margin: 0;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.code-input:focus {
  border-color: #0083d3;
  background-color: rgba(0, 131, 211, 0.1);
  box-shadow: 0 0 0 2px rgba(0, 131, 211, 0.2);
  transform: translateY(-2px);
}

.code-separator {
  width: 8px;
}

.verify-error {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ff4d4f;
  font-size: 14px;
  margin-bottom: 20px;
  text-align: center;
  background-color: rgba(255, 77, 79, 0.1);
  padding: 8px 15px;
  border-radius: 4px;
  border: 1px solid rgba(255, 77, 79, 0.2);
}

.error-icon {
  display: inline-block;
  width: 16px;
  height: 16px;
  background-color: #ff4d4f;
  border-radius: 50%;
  margin-right: 8px;
  position: relative;
}

.error-icon::before {
  content: "!";
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: bold;
  font-size: 12px;
}

.mfa-btn-container {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  width: 100%;
  margin-top: 15px;
}

.mfa-btn {
  padding: 10px 18px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  min-width: 100px;
  transition: all 0.2s ease;
  position: relative;
  overflow: hidden;
}

.btn-next, .btn-verify {
  background-color: #0083d3;
  color: #fff;
  box-shadow: 0 4px 8px rgba(0, 131, 211, 0.2);
}

.btn-next:hover, .btn-verify:hover {
  background-color: #0096f2;
  box-shadow: 0 6px 12px rgba(0, 131, 211, 0.3);
}

.btn-back {
  background-color: #333;
  color: #fff;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
}

.btn-back:hover {
  background-color: #444;
}

.btn-verify:disabled {
  background-color: #555;
  cursor: not-allowed;
  box-shadow: none;
}

.btn-loading {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  border-top-color: #fff;
  animation: spin 1s linear infinite;
  margin-right: 8px;
  vertical-align: middle;
}

/* 修改弹窗样式 */
:deep(.mfa-modal) {
  width: 500px !important;
  border-radius: 12px !important;
  overflow: hidden !important;
}

:deep(.mfa-modal .modal-header) {
  border-bottom: 1px solid rgba(255, 255, 255, 0.05) !important;
}
</style> 