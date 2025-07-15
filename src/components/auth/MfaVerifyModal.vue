<template>
  <Modal 
    v-model:visible="isVisible" 
    title="验证身份" 
    customClass="mfa-verify-modal"
    :hide-footer="true"
    @close="handleClose"
  >
    <div class="mfa-verify-container">
      <div class="verify-icon">
        <svg viewBox="0 0 24 24" width="50" height="50" class="security-icon">
          <path fill="currentColor" d="M12,1L3,5v6c0,5.55 3.84,10.74 9,12 5.16,-1.26 9,-6.45 9,-12V5L12,1zM11,7h2v2h-2V7zM11,11h2v6h-2V11z" />
        </svg>
      </div>
      <div class="verify-title">
        双因素身份验证
      </div>
      <div class="verify-subtitle">
        请输入身份验证器应用中的 6 位验证码
      </div>
      <div class="verify-input-container">
        <div class="code-inputs">
          <template v-for="(digit, index) in 6" :key="index">
            <div class="digit-container" :class="{ 'active': codeDigits[index] }">
        <input 
                type="tel"
                maxlength="1"
                inputmode="numeric"
                pattern="[0-9]*"
                class="code-input"
                v-model="codeDigits[index]"
                @keydown="handleKeyDown($event, index)"
                @paste="handlePaste"
                @keyup.enter="handleEnterKey"
                ref="codeInputs"
              />
              <span class="digit-display">{{ codeDigits[index] }}</span>
            </div>
            <span class="code-separator" v-if="index < 5"></span>
          </template>
        </div>
      </div>
      <div class="verify-error" v-if="verifyError">
        {{ verifyError }}
      </div>
      <div class="mfa-btn-container">
        <button class="mfa-btn btn-cancel" @click="handleClose">取消</button>
        <button 
          class="mfa-btn btn-verify" 
          :disabled="verificationCode.length !== 6 || isVerifying"
          @click="verifyCode"
        >
          {{ isVerifying ? '验证中...' : '验证' }}
        </button>
      </div>
    </div>
  </Modal>
</template>

<script>
import { defineComponent, ref, watch, computed, nextTick } from 'vue'
import Modal from '@/components/common/Modal.vue'
import { useUserStore } from '@/store/user'

export default defineComponent({
  name: 'MfaVerifyModal',
  components: {
    Modal
  },
  props: {
    show: {
      type: Boolean,
      default: false
    },
    userInfo: {
      type: Object,
      default: null
    }
  },
  emits: ['update:show', 'success', 'cancel'],
  setup(props, { emit }) {
    const userStore = useUserStore()
    const isVisible = computed({
      get: () => props.show,
      set: (value) => emit('update:show', value)
    })
    const codeDigits = ref(['', '', '', '', '', ''])
    const verificationCode = ref('')
    const verifyError = ref('')
    const isVerifying = ref(false)
    const codeInputs = ref([])
    const MAX_RETRY_ATTEMPTS = 3
    const retryCount = ref(0)
    
    // 监听弹窗显示状态
    watch(() => props.show, (newVal) => {
      if (newVal) {
        codeDigits.value = ['', '', '', '', '', '']
        verificationCode.value = ''
        verifyError.value = ''
        isVerifying.value = false
        retryCount.value = 0
        // 自动聚焦第一个输入框
        nextTick(() => {
          if (codeInputs.value && codeInputs.value[0]) {
            codeInputs.value[0].focus()
          }
        })
      }
    })

    // 监听数字输入变化，更新验证码
    watch(codeDigits, (newDigits) => {
      verificationCode.value = newDigits.join('')
      // 自动聚焦到下一个输入框
      const emptyIndex = newDigits.findIndex(d => d === '')
      const lastFilledIndex = emptyIndex > 0 ? emptyIndex - 1 : -1
      if (lastFilledIndex >= 0 && lastFilledIndex < 5) {
        nextTick(() => {
          if (codeInputs.value && codeInputs.value[lastFilledIndex + 1]) {
            codeInputs.value[lastFilledIndex + 1].focus()
          }
        })
      }
      // 自动提交
      const isAllDigits = newDigits.length === 6 && newDigits.every(c => /^[0-9]$/.test(c))
      if (isAllDigits && !isVerifying.value) {
        verifyCode()
      }
      // 清除之前的错误
      if (verifyError.value) {
        verifyError.value = ''
      }
    }, { deep: true })

    // 处理键盘事件
    const handleKeyDown = (e, index) => {
      // 退格键处理
      if (e.key === 'Backspace') {
        if (!codeDigits.value[index] && index > 0) {
          codeDigits.value[index-1] = ''
          nextTick(() => {
            if (codeInputs.value && codeInputs.value[index - 1]) {
              codeInputs.value[index - 1].focus()
            }
          })
        }
      }
      // 左右箭头导航
      if (e.key === 'ArrowLeft' && index > 0) {
        nextTick(() => {
          codeInputs.value[index - 1].focus()
        })
      }
      if (e.key === 'ArrowRight' && index < 5) {
        nextTick(() => {
          codeInputs.value[index + 1].focus()
        })
      }
    }

    // 处理回车键确认
    const handleEnterKey = () => {
      if (verificationCode.value.length === 6) {
        verifyCode()
      }
    }

    // 处理粘贴事件
    const handlePaste = (e) => {
      e.preventDefault()
      const pasteData = e.clipboardData.getData('text')
      const digits = pasteData.replace(/[^0-9]/g, '').substring(0, 6)
      if (digits) {
        for (let i = 0; i < 6; i++) {
          codeDigits.value[i] = i < digits.length ? digits[i] : ''
        }
        // 聚焦最后一个有值的输入框的下一个，或者最后一个
        const focusIndex = Math.min(digits.length, 5)
        nextTick(() => {
          if (codeInputs.value && codeInputs.value[focusIndex]) {
            codeInputs.value[focusIndex].focus()
          }
        })
      }
    }
    
    // 验证代码
    const verifyCode = async () => {
      if (verificationCode.value.length !== 6 || !/^\d{6}$/.test(verificationCode.value)) {
        verifyError.value = '请输入6位数字验证码'
        // 新增：失败时聚焦最后一个输入框
        nextTick(() => {
          if (codeInputs.value && codeInputs.value[5]) {
            codeInputs.value[5].focus()
          }
        })
        return
      }
      if (retryCount.value >= MAX_RETRY_ATTEMPTS) {
        verifyError.value = '错误次数过多，请稍后再试或联系管理员'
        // 新增：失败时聚焦最后一个输入框
        nextTick(() => {
          if (codeInputs.value && codeInputs.value[5]) {
            codeInputs.value[5].focus()
          }
        })
        return
      }
      isVerifying.value = true
      try {
        const result = await userStore.verifyMfaCode(verificationCode.value, props.userInfo)
        if (result.success) {
          emit('success')
          handleClose()
        } else {
          retryCount.value++
          if (retryCount.value >= MAX_RETRY_ATTEMPTS) {
            verifyError.value = '错误次数过多，请稍后再试或联系管理员'
            setTimeout(() => {
              handleClose()
            }, 2000)
          } else {
            const remainingAttempts = MAX_RETRY_ATTEMPTS - retryCount.value
            verifyError.value = `验证码不正确，您还有${remainingAttempts}次尝试机会`
            // 新增：失败时聚焦最后一个输入框
            nextTick(() => {
              if (codeInputs.value && codeInputs.value[5]) {
                codeInputs.value[5].focus()
              }
            })
          }
        }
      } catch (error) {
        retryCount.value++
        verifyError.value = '验证失败，请重试'
        // 新增：失败时聚焦最后一个输入框
        nextTick(() => {
          if (codeInputs.value && codeInputs.value[5]) {
            codeInputs.value[5].focus()
          }
        })
      } finally {
        isVerifying.value = false
      }
    }
    
    // 关闭弹窗
    const handleClose = () => {
      isVisible.value = false
      emit('cancel')
    }
    
    return {
      isVisible,
      codeDigits,
      verificationCode,
      verifyError,
      isVerifying,
      codeInputs,
      handleKeyDown,
      handlePaste,
      handleEnterKey,
      verifyCode,
      handleClose
    }
  }
})
</script>

<style scoped>
.mfa-verify-container {
  padding: 30px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.verify-icon {
  margin-bottom: 20px;
}

.security-icon {
  color: var(--color-info);
}

.verify-title {
  font-size: 20px;
  font-weight: bold;
  color: var(--color-text-primary);
  margin-bottom: 15px;
  text-align: center;
}

.verify-subtitle {
  font-size: 14px;
  color: var(--color-text-secondary);
  text-align: center;
  margin-bottom: 30px;
  line-height: 1.5;
  max-width: 450px;
}

.verify-input-container {
  width: 100%;
  max-width: 360px;
  margin: 0 auto 20px auto;
}

.code-inputs {
  display: flex;
  justify-content: center;
  gap: 8px;
}

.digit-container {
  position: relative;
  width: 40px;
  height: 48px;
}

.code-input {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border: 1px solid var(--color-border-default);
  border-radius: 4px;
  background-color: var(--color-bg-container);
  color: transparent;
  font-size: 20px;
  text-align: center;
  outline: none;
  z-index: 1;
  caret-color: var(--color-primary);
}

.digit-display {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  color: var(--color-text-primary);
  pointer-events: none;
  z-index: 2;
}

.code-input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px var(--color-focus-ring);
}

.code-separator {
  display: flex;
  align-items: center;
  margin: 0 2px;
}

.verify-error {
  color: var(--color-error);
  margin-top: 15px;
  text-align: center;
  font-size: 14px;
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

/* 浅色主题下的按钮样式 - 默认蓝色 */
.btn-verify,
:root[data-theme="light"] .btn-verify,
.light-theme .btn-verify {
  background-color: #1890ff !important;
  color: #ffffff !important;
}

.btn-verify:hover,
:root[data-theme="light"] .btn-verify:hover,
.light-theme .btn-verify:hover {
  background-color: #1890ff !important;
}

/* 深色主题下的按钮样式 */
:root[data-theme="dark"] .btn-verify,
.dark-theme .btn-verify {
  background-color: #555 !important;
  color: var(--color-text-primary) !important;
}

:root[data-theme="dark"] .btn-verify:hover,
.dark-theme .btn-verify:hover {
  background-color: #555 !important;
}

.btn-cancel {
  background-color: var(--color-bg-muted);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-default);
}

.btn-verify:disabled {
  background-color: var(--color-disabled-bg);
  cursor: not-allowed;
}
</style> 