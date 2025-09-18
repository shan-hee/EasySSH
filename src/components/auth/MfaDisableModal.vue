<template>
  <modal
    v-model:visible="isVisible"
    title="禁用两步验证"
    custom-class="mfa-disable-modal"
    :hide-footer="true"
    :width="500"
    :max-width="'90vw'"
    @close="handleClose"
  >
    <div class="mfa-disable-container">
      <template v-if="currentStep === 'confirm'">
        <div class="warning-icon">
          <svg viewBox="0 0 24 24" width="50" height="50">
            <path
              fill="currentColor"
              d="M1,21h22L12,2L1,21z M13,18h-2v-2h2V18z M13,14h-2V8h2V14z"
            />
          </svg>
        </div>
        <div class="disable-title">确定要禁用两步验证吗？</div>
        <div class="disable-description">
          禁用两步验证将降低您账户的安全性。禁用后，您只需要使用用户名和密码即可登录系统。
        </div>
        <div class="btn-container">
          <button class="btn btn-cancel" @click="handleClose">取消</button>
          <button class="btn btn-danger" @click="goToVerify">禁用</button>
        </div>
      </template>

      <template v-else-if="currentStep === 'verify'">
        <div class="verify-icon">
          <svg viewBox="0 0 24 24" width="50" height="50">
            <path
              fill="currentColor"
              d="M12,1L3,5v6c0,5.55 3.84,10.74 9,12 5.16,-1.26 9,-6.45 9,-12V5L12,1zM11,7h2v2h-2V7zM11,11h2v6h-2V11z"
            />
          </svg>
        </div>
        <div class="verify-title">验证身份</div>
        <div class="verify-subtitle">请输入身份验证器应用中的 6 位验证码</div>
        <div class="verify-input-container">
          <div class="code-inputs">
            <template v-for="(digit, index) in 6" :key="index">
              <input
                ref="codeInputs"
                v-model="codeDigits[index]"
                type="tel"
                maxlength="1"
                inputmode="numeric"
                pattern="[0-9]*"
                class="code-input"
                @keydown="handleKeyDown($event, index)"
                @paste="handlePaste"
                @keyup.enter="handleEnterKey"
              />
              <span v-if="index < 5" class="code-separator" />
            </template>
          </div>
        </div>
        <div v-if="verifyError" class="verify-error">
          {{ verifyError }}
        </div>
        <div class="btn-container">
          <button class="btn btn-back" @click="currentStep = 'confirm'">返回</button>
          <button
            class="btn btn-disable"
            :disabled="verificationCode.length !== 6 || isVerifying"
            @click="disableMfa"
          >
            {{ isVerifying ? '验证中...' : '确认禁用' }}
          </button>
        </div>
      </template>
    </div>
  </modal>
</template>

<script>
import { defineComponent, ref, computed, watch, nextTick } from 'vue';
import Modal from '@/components/common/Modal.vue';
import mfaService from '@/services/mfa';
import { ElMessage } from 'element-plus';
import log from '@/services/log';
import { useUserStore } from '@/store/user';

export default defineComponent({
  name: 'MfaDisableModal',
  components: {
    Modal
  },
  props: {
    visible: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:visible', 'mfa-disable-complete', 'mfa-disable-cancelled'],
  setup(props, { emit }) {
    // 使用计算属性处理双向绑定
    const isVisible = computed({
      get: () => props.visible,
      set: value => emit('update:visible', value)
    });

    const currentStep = ref('confirm');
    const verificationCode = ref('');
    const codeDigits = ref(['', '', '', '', '', '']);
    const verifyError = ref('');
    const isVerifying = ref(false);
    const codeInputs = ref([]);
    const MAX_RETRY_ATTEMPTS = 3;
    const retryCount = ref(0);
    const userStore = useUserStore();

    // 监听数字输入变化，更新验证码
    watch(
      codeDigits,
      newDigits => {
        verificationCode.value = newDigits.join('');

        // 自动聚焦到下一个输入框
        const emptyIndex = newDigits.findIndex(d => d === '');
        const lastFilledIndex = emptyIndex > 0 ? emptyIndex - 1 : -1;

        if (lastFilledIndex >= 0 && lastFilledIndex < 5) {
          nextTick(() => {
            if (codeInputs.value && codeInputs.value[lastFilledIndex + 1]) {
              codeInputs.value[lastFilledIndex + 1].focus();
            }
          });
        }

        // 清除之前的错误
        if (verifyError.value) {
          verifyError.value = '';
        }
      },
      { deep: true }
    );

    // 监听弹窗显示状态
    watch(
      () => props.visible,
      newVal => {
        if (newVal) {
          // 弹窗打开时，重置状态
          currentStep.value = 'confirm';
          verificationCode.value = '';
          codeDigits.value = ['', '', '', '', '', ''];
          verifyError.value = '';
          isVerifying.value = false;
        }
      }
    );

    // 进入验证步骤
    const goToVerify = () => {
      currentStep.value = 'verify';
      // 等待DOM更新后聚焦第一个输入框
      nextTick(() => {
        if (codeInputs.value && codeInputs.value[0]) {
          codeInputs.value[0].focus();
        }
      });
    };

    // 处理键盘事件
    const handleKeyDown = (e, index) => {
      // 退格键处理
      if (e.key === 'Backspace') {
        if (!codeDigits.value[index] && index > 0) {
          codeDigits.value[index - 1] = '';
          nextTick(() => {
            if (codeInputs.value && codeInputs.value[index - 1]) {
              codeInputs.value[index - 1].focus();
            }
          });
        }
      }
    };

    // 处理回车键确认
    const handleEnterKey = () => {
      if (verificationCode.value.length === 6) {
        disableMfa();
      }
    };

    // 处理粘贴事件
    const handlePaste = e => {
      e.preventDefault();
      const pasteData = e.clipboardData.getData('text');
      const digits = pasteData.replace(/[^0-9]/g, '').substring(0, 6);

      if (digits) {
        // 更新各个输入框中的数字
        for (let i = 0; i < 6; i++) {
          codeDigits.value[i] = i < digits.length ? digits[i] : '';
        }

        // 聚焦最后一个有值的输入框的下一个，或者最后一个
        const focusIndex = Math.min(digits.length, 5);
        nextTick(() => {
          if (codeInputs.value && codeInputs.value[focusIndex]) {
            codeInputs.value[focusIndex].focus();
          }
        });
      }
    };

    // 禁用MFA
    const disableMfa = async () => {
      // 格式校验
      if (verificationCode.value.length !== 6 || !/^\d{6}$/.test(verificationCode.value)) {
        verifyError.value = '请输入6位数字验证码';
        // 新增：失败时聚焦最后一个输入框
        nextTick(() => {
          if (codeInputs.value && codeInputs.value[5]) {
            codeInputs.value[5].focus();
          }
        });
        return;
      }
      if (retryCount.value >= MAX_RETRY_ATTEMPTS) {
        verifyError.value = '错误次数过多，请稍后再试或联系管理员';
        // 新增：失败时聚焦最后一个输入框
        nextTick(() => {
          if (codeInputs.value && codeInputs.value[5]) {
            codeInputs.value[5].focus();
          }
        });
        return;
      }
      isVerifying.value = true;
      try {
        // 调用服务禁用MFA，传入当前用户的mfaSecret
        const result = await mfaService.disableMfa(
          verificationCode.value,
          userStore.userInfo.mfaSecret
        );
        if (result.success) {
          if (result.user) {
            log.info('用户信息已更新', { mfaEnabled: result.user.mfaEnabled });
            emit('mfa-disable-complete', { user: result.user });
          }
          ElMessage.success('已成功禁用两步验证');
          handleClose();
        } else {
          retryCount.value++;
          if (retryCount.value >= MAX_RETRY_ATTEMPTS) {
            verifyError.value = '错误次数过多，请稍后再试或联系管理员';
          } else {
            verifyError.value = result.message || '验证码无效或已过期，请重试';
          }
          log.warn('禁用MFA失败', result);
          // 新增：失败时聚焦最后一个输入框
          nextTick(() => {
            if (codeInputs.value && codeInputs.value[5]) {
              codeInputs.value[5].focus();
            }
          });
        }
      } catch (error) {
        retryCount.value++;
        verifyError.value = '禁用失败，请稍后重试';
        log.error('禁用MFA异常', error);
        // 新增：失败时聚焦最后一个输入框
        nextTick(() => {
          if (codeInputs.value && codeInputs.value[5]) {
            codeInputs.value[5].focus();
          }
        });
      } finally {
        isVerifying.value = false;
      }
    };

    // 关闭弹窗
    const handleClose = () => {
      isVisible.value = false;
      emit('mfa-disable-cancelled');
    };

    return {
      isVisible,
      currentStep,
      verificationCode,
      codeDigits,
      verifyError,
      isVerifying,
      codeInputs,
      goToVerify,
      handleKeyDown,
      handlePaste,
      disableMfa,
      handleClose,
      handleEnterKey
    };
  }
});
</script>

<style scoped>
.mfa-disable-container {
  padding: 0; /* 统一由外层 modal-container 提供 20px 内边距 */
  display: flex;
  flex-direction: column;
  align-items: center;
}

.warning-icon,
.verify-icon {
  margin-bottom: 20px;
}

.warning-icon svg {
  color: var(--color-warning);
}

.verify-icon svg {
  color: var(--color-info);
}

.disable-title,
.verify-title {
  font-size: 20px;
  font-weight: bold;
  color: var(--color-text-primary);
  margin-bottom: 15px;
  text-align: center;
}

.disable-description,
.verify-subtitle {
  font-size: 14px;
  color: var(--color-text-secondary);
  text-align: center;
  margin-bottom: 30px;
  line-height: 1.5;
  max-width: 450px;
}

.btn-container {
  display: flex;
  justify-content: center;
  gap: 15px;
  margin-top: 20px;
}

.btn {
  padding: 8px 20px;
  border: none;
  border-radius: 4px;
  font-weight: bold;
  cursor: pointer;
  min-width: 100px;
  height: 40px;
  font-size: 14px;
  transition: all 0.3s;
}

.btn-cancel {
  background-color: var(--color-bg-muted);
  border: 1px solid var(--color-border-default);
  color: var(--color-text-primary);
}

.btn-danger,
.btn-disable {
  background-color: var(--color-error);
  color: var(--color-bg-container);
}

.btn-back {
  background-color: var(--color-bg-muted);
  border: 1px solid var(--color-border-default);
  color: var(--color-text-primary);
}

.btn:hover {
  opacity: 0.9;
}

.btn:disabled {
  background-color: var(--color-disabled-bg);
  cursor: not-allowed;
  opacity: 0.7;
}

/* 验证码输入样式 */
.verify-input-container {
  width: 100%;
  margin: 30px 0;
}

/* .code-input 与容器样式已统一到 src/assets/styles/components/forms.css */

.code-separator {
  width: 8px;
}

.verify-error {
  color: var(--color-error);
  margin-top: 15px;
  text-align: center;
  font-size: 14px;
}

/* 弹窗圆角与标题分隔线统一在 Modal.vue 控制 */
</style>
