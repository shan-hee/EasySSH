<template>
  <div
    class="sftp-file-item sftp-inline-editor"
    :class="{ 'sftp-file-directory': type === 'folder' }"
  >
    <div class="sftp-file-name">
      <svg
        v-if="type === 'folder'"
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        class="folder-icon"
      >
        <path
          fill="currentColor"
          d="M20,6H12L10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6M20,18H4V8H20V18M13,11H16V14H13V17H11V14H8V11H11V8H13V11Z"
        />
      </svg>
      <svg
        v-else
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        class="file-icon"
      >
        <path
          fill="currentColor"
          d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"
        />
      </svg>

      <!-- 编辑容器 -->
      <div class="sftp-edit-container">
        <input
          ref="editInput"
          v-model="inputName"
          class="sftp-file-name-input"
          :class="{ 'sftp-input-error': hasValidationError }"
          :disabled="isCreating"
          :placeholder="placeholder"
          @keydown.enter="confirmCreate"
          @keydown.esc="cancelCreate"
          @input="validateInput"
          @click.stop
        />

        <!-- 确认和取消按钮 -->
        <div class="sftp-edit-actions">
          <!-- 确认按钮 -->
          <button
            class="sftp-edit-action-btn sftp-confirm-btn"
            :disabled="isCreating || hasValidationError || !inputName.trim()"
            :title="getCreateConfirmTitle()"
            @click.stop="confirmCreate"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M9,20.42L2.79,14.21L5.62,11.38L9,14.77L18.88,4.88L21.71,7.71L9,20.42Z"
              />
            </svg>
          </button>

          <!-- 取消按钮 -->
          <button
            class="sftp-edit-action-btn sftp-cancel-btn"
            :disabled="isCreating"
            :title="getCreateCancelTitle()"
            @click.stop="cancelCreate"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"
              />
            </svg>
          </button>

          <!-- 加载状态 -->
          <div v-if="isCreating" class="sftp-rename-loading">
            <svg class="sftp-rename-spinner" viewBox="0 0 16 16">
              <circle
                cx="8"
                cy="8"
                r="6"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-dasharray="18.85"
                stroke-dashoffset="18.85"
              >
                <animate
                  attributeName="stroke-dasharray"
                  dur="1.5s"
                  values="0 18.85;9.425 9.425;0 18.85"
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="stroke-dashoffset"
                  dur="1.5s"
                  values="0;-9.425;-18.85"
                  repeatCount="indefinite"
                />
              </circle>
            </svg>
          </div>
        </div>
      </div>
    </div>
    <div class="sftp-file-size">-</div>
    <div class="sftp-file-date">-</div>
    <div class="sftp-file-actions">
      <!-- 空的操作区域，保持布局一致 -->
    </div>
  </div>
</template>

<script>
import { defineComponent, ref, nextTick, computed } from 'vue';
import { ElMessage } from 'element-plus';
import log from '@/services/log';

export default defineComponent({
  name: 'SftpInlineEditor',
  props: {
    type: {
      type: String,
      required: true,
      validator: value => ['folder', 'file'].includes(value)
    }
  },
  emits: ['create', 'cancel'],
  setup(props, { emit }) {
    // 状态管理
    const inputName = ref('');
    const editInput = ref(null);
    const isCreating = ref(false);
    const hasValidationError = ref(false);
    const validationErrorMessage = ref('');

    // 计算属性
    const placeholder = computed(() => {
      return props.type === 'folder' ? '输入文件夹名称' : '输入文件名称';
    });

    // 文件名验证规则
    const fileNamePattern = /^[^\\/:*?"<>|]+$/;
    const maxFileNameLength = 255;

    // 验证文件名
    const validateFileName = name => {
      if (!name || name.trim() === '') {
        return {
          valid: false,
          message: `${props.type === 'folder' ? '文件夹' : '文件'}名不能为空`
        };
      }

      const trimmedName = name.trim();

      if (trimmedName.length > maxFileNameLength) {
        return { valid: false, message: `名称长度不能超过${maxFileNameLength}个字符` };
      }

      if (!fileNamePattern.test(trimmedName)) {
        return { valid: false, message: '名称不能包含以下字符: \\ / : * ? " < > |' };
      }

      // 检查是否为保留名称（Windows系统）
      const reservedNames = [
        'CON',
        'PRN',
        'AUX',
        'NUL',
        'COM1',
        'COM2',
        'COM3',
        'COM4',
        'COM5',
        'COM6',
        'COM7',
        'COM8',
        'COM9',
        'LPT1',
        'LPT2',
        'LPT3',
        'LPT4',
        'LPT5',
        'LPT6',
        'LPT7',
        'LPT8',
        'LPT9'
      ];
      if (reservedNames.includes(trimmedName.toUpperCase())) {
        return { valid: false, message: '不能使用系统保留名称' };
      }

      // 检查是否以点开头或结尾（某些系统不支持）
      if (trimmedName.startsWith('.') && trimmedName.length === 1) {
        return { valid: false, message: '名称不能只是一个点' };
      }

      if (trimmedName === '..') {
        return { valid: false, message: '名称不能是两个点' };
      }

      return { valid: true, message: '' };
    };

    // 实时输入验证
    const validateInput = () => {
      const validation = validateFileName(inputName.value);
      hasValidationError.value = !validation.valid;
      validationErrorMessage.value = validation.message;
    };

    // 标题文案
    const getCreateConfirmTitle = () => `确认创建${props.type === 'folder' ? '文件夹' : '文件'}`;
    const getCreateCancelTitle = () => `取消创建${props.type === 'folder' ? '文件夹' : '文件'}`;

    // 确认创建
    const confirmCreate = async () => {
      const name = inputName.value.trim();

      // 使用验证逻辑
      const validation = validateFileName(name);
      if (!validation.valid) {
        ElMessage.error(validation.message);
        hasValidationError.value = true;
        validationErrorMessage.value = validation.message;
        return;
      }

      isCreating.value = true;

      try {
        // 发送创建事件，等待父组件处理完成
        emit('create', { name, type: props.type });

        // 注意：不在这里重置状态，等待父组件调用 resetCreating()
      } catch (error) {
        log.error('创建失败', error);
        ElMessage.error(`创建${props.type === 'folder' ? '文件夹' : '文件'}失败: ${error.message}`);
        isCreating.value = false;
      }
    };

    // 取消创建
    const cancelCreate = () => {
      emit('cancel');
    };

    // 初始化时聚焦输入框
    const focusInput = async () => {
      await nextTick();
      if (editInput.value) {
        editInput.value.focus();
      }
    };

    // 暴露方法给父组件
    const resetCreating = () => {
      isCreating.value = false;
    };

    return {
      inputName,
      editInput,
      isCreating,
      hasValidationError,
      validationErrorMessage,
      placeholder,
      validateInput,
      getCreateConfirmTitle,
      getCreateCancelTitle,
      confirmCreate,
      cancelCreate,
      focusInput,
      resetCreating
    };
  }
});
</script>

<style scoped>
.folder-icon {
  color: var(--color-warning);
}

.file-icon {
  color: var(--color-info);
}
/* 继承SftpFileItem的样式 */
.sftp-inline-editor {
  display: grid;
  grid-template-columns: minmax(200px, 3fr) minmax(80px, 1fr) minmax(150px, 1fr) minmax(80px, 1fr);
  width: 100%;
  padding: 0;
  border-bottom: 1px solid #333;
  font-size: 13px;
  color: #e0e0e0;
  position: relative;
  background-color: rgba(66, 165, 245, 0.05);
  border: 1px solid rgba(66, 165, 245, 0.2);
}

.sftp-inline-editor > div {
  padding: 8px 12px;
  display: flex;
  align-items: center;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sftp-inline-editor > div.sftp-file-name {
  overflow: hidden;
}

.sftp-inline-editor.sftp-file-directory {
  color: #42a5f5;
}

/* 编辑容器样式 */
.sftp-edit-container {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 8px;
  flex: 1;
}

.sftp-file-name-input {
  background: var(--color-bg-container);
  border: 1px solid var(--color-primary);
  border-radius: 4px;
  color: #e0e0e0;
  font-size: 13px;
  font-family: inherit;
  font-weight: inherit;
  padding: 3px 8px;
  margin: 0;
  outline: none;
  flex: 1;
  min-width: 120px;
  max-width: 200px;
  transition: all var(--theme-transition-duration) var(--theme-transition-timing);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.sftp-file-name-input:focus,
.sftp-file-name-input:focus-visible {
  border-color: #64b5f6;
  box-shadow: 0 0 0 2px rgba(66, 165, 245, 0.2);
}

.sftp-file-name-input.sftp-input-error {
  border-color: #f56c6c;
  background-color: rgba(245, 108, 108, 0.1);
}

.sftp-file-name-input.sftp-input-error:focus,
.sftp-file-name-input.sftp-input-error:focus-visible {
  border-color: #f56c6c;
  box-shadow: 0 0 0 2px rgba(245, 108, 108, 0.2);
}

.sftp-file-name-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 编辑操作按钮容器 */
.sftp-edit-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* 编辑操作按钮 */
.sftp-edit-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all var(--theme-transition-duration) var(--theme-transition-timing);
  padding: 0;
  background: transparent;
}

.sftp-edit-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 确认按钮 */
.sftp-confirm-btn {
  color: #67c23a;
  background: rgba(103, 194, 58, 0.1);
}

.sftp-confirm-btn:hover:not(:disabled) {
  background: rgba(103, 194, 58, 0.2);
  color: #85ce61;
}

.sftp-confirm-btn:active:not(:disabled) {
  background: rgba(103, 194, 58, 0.3);
}

/* 取消按钮 */
.sftp-cancel-btn {
  color: #f56c6c;
  background: rgba(245, 108, 108, 0.1);
}

.sftp-cancel-btn:hover:not(:disabled) {
  background: rgba(245, 108, 108, 0.2);
  color: #f78989;
}

.sftp-cancel-btn:active:not(:disabled) {
  background: rgba(245, 108, 108, 0.3);
}

/* 加载状态 */
.sftp-rename-loading {
  display: inline-flex;
  align-items: center;
  margin-left: 4px;
}

.sftp-rename-spinner {
  width: 14px;
  height: 14px;
  color: #42a5f5;
}
</style>
