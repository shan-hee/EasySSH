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
        <svg viewBox="0 0 24 24" width="50" height="50">
          <path fill="#0083d3" d="M12,1L3,5v6c0,5.55 3.84,10.74 9,12 5.16,-1.26 9,-6.45 9,-12V5L12,1zM11,7h2v2h-2V7zM11,11h2v6h-2V11z" />
        </svg>
      </div>
      <div class="verify-title">
        双因素身份验证
      </div>
      <div class="verify-subtitle">
        请输入身份验证器应用中的 6 位验证码
      </div>
      <div class="verify-input-container">
        <input 
          type="text" 
          v-model="verificationCode" 
          class="verify-input" 
          maxlength="6" 
          placeholder="输入6位验证码"
          @input="handleCodeInput"
          autofocus
        />
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
import { defineComponent, ref, watch, computed } from 'vue'
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
    
    // 使用计算属性处理双向绑定
    const isVisible = computed({
      get: () => props.show,
      set: (value) => emit('update:show', value)
    })
    
    const verificationCode = ref('')
    const verifyError = ref('')
    const isVerifying = ref(false)
    
    // 监听弹窗显示状态
    watch(() => props.show, (newVal) => {
      if (newVal) {
        // 弹窗打开时，重置状态
        verificationCode.value = ''
        verifyError.value = ''
        isVerifying.value = false
      }
    })
    
    // 处理验证码输入
    const handleCodeInput = (e) => {
      // 只允许输入数字
      verificationCode.value = e.target.value.replace(/[^0-9]/g, '')
      
      // 清除之前的错误
      if (verifyError.value) {
        verifyError.value = ''
      }
    }
    
    // 验证代码
    const verifyCode = async () => {
      if (verificationCode.value.length !== 6) {
        verifyError.value = '请输入6位验证码'
        return
      }
      
      isVerifying.value = true
      
      try {
        // 验证MFA代码
        const result = await userStore.verifyMfaCode(verificationCode.value, props.userInfo)
        
        if (result.success) {
          emit('success')
          handleClose()
        } else {
          verifyError.value = result.error || '验证码不正确，请重试'
        }
      } catch (error) {
        console.error('MFA验证失败:', error)
        verifyError.value = '验证失败，请重试'
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
      verificationCode,
      verifyError,
      isVerifying,
      handleCodeInput,
      verifyCode,
      handleClose
    }
  }
})
</script>

<style scoped>
.mfa-verify-container {
  padding: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.verify-icon {
  margin-bottom: 20px;
}

.verify-title {
  font-size: 18px;
  font-weight: bold;
  color: #fff;
  margin-bottom: 10px;
  text-align: center;
}

.verify-subtitle {
  font-size: 14px;
  color: #ccc;
  margin-bottom: 20px;
  text-align: center;
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

.btn-verify {
  background-color: #0083d3;
  color: #fff;
}

.btn-verify:hover {
  background-color: #0096f2;
}

.btn-cancel {
  background-color: #3f3f3f;
  color: #fff;
}

.btn-cancel:hover {
  background-color: #4f4f4f;
}

.btn-verify:disabled {
  background-color: #666;
  cursor: not-allowed;
}
</style> 