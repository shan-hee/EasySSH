<template>
  <div
    class="sftp-file-item"
    :class="{
      'sftp-file-directory': file.isDirectory,
      'sftp-file-editing': isEditing
    }"
    @click="handleItemClick"
  >
    <div class="sftp-file-name">
      <svg
        v-if="file.isDirectory"
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        class="folder-icon"
      >
        <path
          fill="currentColor"
          d="M10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6H12L10,4Z"
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
          d="M13,9V3.5L18.5,9M6,2C4.89,2 4,2.89 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2H6Z"
        />
      </svg>

      <!-- 编辑模式：显示输入框和操作按钮 -->
      <div v-if="isEditing" class="sftp-edit-container">
        <input
          ref="editInput"
          v-model="editingName"
          class="sftp-file-name-input"
          :class="{ 'sftp-input-error': hasValidationError }"
          :disabled="isRenaming"
          @keydown.enter="confirmRename"
          @keydown.esc="cancelRename"
          @input="validateInput"
          @click.stop
        />

        <!-- 确认和取消按钮 -->
        <div class="sftp-edit-actions">
          <!-- 确认按钮 -->
          <button
            class="sftp-edit-action-btn sftp-confirm-btn"
            :disabled="isRenaming || hasValidationError || !editingName.trim()"
            title="确认重命名"
            @click.stop="confirmRename"
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
            :disabled="isRenaming"
            title="取消重命名"
            @click.stop="cancelRename"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"
              />
            </svg>
          </button>

          <!-- 加载状态 -->
          <div v-if="isRenaming" class="sftp-rename-loading">
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

      <!-- 显示模式：预览类文件直接打开，其他文件弹出下载确认 -->
      <template v-else>
        <span
          v-if="isPreviewable"
          class="sftp-file-name-text"
          @click.stop="onFileNameClick"
        >
          {{ file.name }}
        </span>
        <el-popconfirm
          v-else
          v-model:visible="showDownloadConfirm"
          trigger="manual"
          :title="getDownloadTitle(file)"
          confirm-button-text="下载"
          cancel-button-text="取消"
          :width="320"
          popper-class="sftp-popconfirm"
          placement="right"
          @confirm="handleDownloadConfirm"
          @cancel="hideDownloadConfirm"
        >
          <template #reference>
            <span @click.stop="onFileNameClick">{{ file.name }}</span>
          </template>
        </el-popconfirm>
      </template>
    </div>
    <div class="sftp-file-size tabular-nums">
      {{ formatFileSize(file.size, file.isDirectory) }}
    </div>
    <div class="sftp-file-date tabular-nums">
      {{ formatDate(file.modifiedTime) }}
    </div>
    <div class="sftp-file-actions">
      <!-- 目录下载需要确认，文件直接下载 -->
      <template v-if="file.isDirectory">
        <el-popconfirm
          :title="getDownloadFolderTitle(file)"
          confirm-button-text="开始下载"
          cancel-button-text="取消"
          :width="320"
          popper-class="sftp-popconfirm"
          placement="left"
          @confirm="$emit('download', file)"
        >
          <template #reference>
            <button class="sftp-action-button" title="下载" @click.stop>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
                <path fill="currentColor" d="M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z" />
              </svg>
            </button>
          </template>
        </el-popconfirm>
      </template>
      <template v-else>
        <button class="sftp-action-button" title="下载" @click.stop="$emit('download', file)">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
            <path fill="currentColor" d="M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z" />
          </svg>
        </button>
      </template>
      <button class="sftp-action-button" title="重命名" @click.stop="startRename">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
          <path
            fill="currentColor"
            d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z"
          />
        </svg>
      </button>
      <button class="sftp-action-button" title="权限" @click.stop="$emit('permissions', file)">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
          <path
            fill="currentColor"
            d="M12,17A2,2 0 0,0 14,15C14,13.89 13.1,13 12,13A2,2 0 0,0 10,15A2,2 0 0,0 12,17M18,8A2,2 0 0,1 20,10V20A2,2 0 0,1 18,22H6A2,2 0 0,1 4,20V10C4,8.89 4.9,8 6,8H7V6A5,5 0 0,1 12,1A5,5 0 0,1 17,6V8H18M12,3A3,3 0 0,0 9,6V8H15V6A3,3 0 0,0 12,3Z"
          />
        </svg>
      </button>
      <el-popconfirm
        :title="getDeleteTitle(file)"
        confirm-button-text="删除"
        cancel-button-text="取消"
        confirm-button-type="danger"
        :width="320"
        popper-class="sftp-popconfirm"
        placement="left"
        @confirm="$emit('delete', file)"
      >
        <template #reference>
          <button class="sftp-action-button" title="删除" @click.stop>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z"
              />
            </svg>
          </button>
        </template>
      </el-popconfirm>
    </div>
  </div>
</template>

<script>
import { defineComponent, ref, nextTick, computed } from 'vue';
import log from '@/services/log';
import { useFileUtils } from '../composables/useFileUtils';
import { ElMessage } from 'element-plus';
import sftpService from '@/services/ssh/sftp-service';

export default defineComponent({
  name: 'SftpFileItem',
  props: {
    file: {
      type: Object,
      required: true
    },
    sessionId: {
      type: String,
      required: true
    },
    currentPath: {
      type: String,
      required: true
    }
  },
  emits: ['item-click', 'download', 'delete', 'refresh', 'permissions'],
  setup(props, { emit }) {
    // 从composable获取格式化方法
    const { formatFileSize, formatDate } = useFileUtils();

    // 编辑状态管理
    const isEditing = ref(false);
    const editingName = ref('');
    const editInput = ref(null);
    const isRenaming = ref(false);
    const hasValidationError = ref(false);
    const validationErrorMessage = ref('');

    // 文件名验证正则表达式和规则
    const fileNamePattern = /^[^\\/:*?"<>|]+$/;
    const maxFileNameLength = 255;

    // 验证文件名
    const validateFileName = name => {
      if (!name || name.trim() === '') {
        return { valid: false, message: '文件名不能为空' };
      }

      const trimmedName = name.trim();

      if (trimmedName.length > maxFileNameLength) {
        return { valid: false, message: `文件名长度不能超过${maxFileNameLength}个字符` };
      }

      if (!fileNamePattern.test(trimmedName)) {
        return { valid: false, message: '文件名不能包含以下字符: \\ / : * ? " < > |' };
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
        return { valid: false, message: '文件名不能只是一个点' };
      }

      if (trimmedName === '..') {
        return { valid: false, message: '文件名不能是两个点' };
      }

      return { valid: true, message: '' };
    };

    // 实时输入验证
    const validateInput = () => {
      const validation = validateFileName(editingName.value);
      hasValidationError.value = !validation.valid;
      validationErrorMessage.value = validation.message;
    };

    // 处理文件项点击：目录或文本文件直接交由父组件；二进制文件触发就地下载确认
    const showDownloadConfirm = ref(false);
    const isPreviewable = computed(() => {
      const f = props.file;
      if (!f) return false;
      return f.isDirectory || isTextFile(f.name);
    });

    const handleItemClick = () => {
      if (isEditing.value) return;
      const f = props.file;
      if (isPreviewable.value) {
        showDownloadConfirm.value = false;
        emit('item-click', f);
      } else {
        showDownloadConfirm.value = true; // 在文件名单元格右侧弹出确认
      }
    };

    const onFileNameClick = () => {
      if (isPreviewable.value) {
        showDownloadConfirm.value = false;
        emit('item-click', props.file);
      } else {
        showDownloadConfirm.value = true;
      }
    };

    const hideDownloadConfirm = () => {
      showDownloadConfirm.value = false;
    };

    const handleDownloadConfirm = () => {
      emit('download', props.file);
      hideDownloadConfirm();
    };

    // 开始重命名
    const startRename = async () => {
      if (isRenaming.value) return;

      isEditing.value = true;
      editingName.value = props.file.name;

      // 重置验证状态
      hasValidationError.value = false;
      validationErrorMessage.value = '';

      // 等待DOM更新后聚焦输入框
      await nextTick();
      if (editInput.value) {
        editInput.value.focus();
        editInput.value.select();
      }
    };

    // 取消重命名
    const cancelRename = () => {
      isEditing.value = false;
      editingName.value = '';
      hasValidationError.value = false;
      validationErrorMessage.value = '';
    };

    // 确认重命名
    const confirmRename = async () => {
      const newName = editingName.value.trim();

      // 使用新的验证逻辑
      const validation = validateFileName(newName);
      if (!validation.valid) {
        ElMessage.error(validation.message);
        hasValidationError.value = true;
        validationErrorMessage.value = validation.message;
        return;
      }

      // 如果名称没有变化，直接取消编辑
      if (newName === props.file.name) {
        cancelRename();
        return;
      }

      await performRename(newName);
    };

    // 处理输入框失焦（不再自动保存，用户需要点击确认按钮）
    const handleInputBlur = () => {
      // 移除自动保存逻辑，用户需要明确点击确认或取消按钮
    };

    // 删除/下载确认标题（包含名称截断，避免弹窗变形）
    const truncateName = (name, n = 28) => {
      if (!name) return '';
      return name.length > n ? name.slice(0, n - 1) + '…' : name;
    };
    const getDeleteTitle = file =>
      file && file.isDirectory
        ? `确定要删除文件夹 "${truncateName(file.name)}" 及其所有内容吗？`
        : `确定要删除文件 "${truncateName(file?.name || '')}" 吗？`;

    // 执行重命名操作
    const performRename = async newName => {
      if (isRenaming.value) return;

      isRenaming.value = true;

      try {
        // 构建原路径和新路径
        const oldPath =
          props.currentPath === '/'
            ? props.currentPath + props.file.name
            : `${props.currentPath}/${props.file.name}`;

        const newPath =
          props.currentPath === '/'
            ? props.currentPath + newName
            : `${props.currentPath}/${newName}`;

        // 调用SFTP服务重命名文件
        await sftpService.rename(props.sessionId, oldPath, newPath);

        ElMessage.success(`重命名成功: ${props.file.name} -> ${newName}`);

        // 取消编辑状态
        cancelRename();

        // 通知父组件刷新
        emit('refresh');
      } catch (error) {
        log.error('重命名失败', error);
        ElMessage.error(`重命名失败: ${error.message}`);
      } finally {
        isRenaming.value = false;
      }
    };

    // 判断是否是文本文件
    const isTextFile = filename => {
      if (!filename) return false;

      const textExtensions = [
        // 编程语言
        'js',
        'jsx',
        'ts',
        'tsx',
        'html',
        'htm',
        'css',
        'scss',
        'sass',
        'less',
        'py',
        'rb',
        'php',
        'java',
        'c',
        'cpp',
        'h',
        'hpp',
        'cs',
        'go',
        'rs',
        'swift',
        'kt',
        'dart',
        'sh',
        'bash',
        'ps1',
        'bat',
        'cmd',

        // 数据格式
        'json',
        'xml',
        'yaml',
        'yml',
        'toml',
        'ini',
        'conf',
        'properties',

        // 文本文档
        'txt',
        'md',
        'markdown',
        'rst',
        'tex',
        'log',

        // 配置文件
        'env',
        'gitignore',
        'dockerignore',
        'dockerfile',
        'editorconfig',
        'gitattributes',
        'npmrc',
        'prettierrc',
        'eslintrc'
      ];

      const ext = filename.split('.').pop().toLowerCase();
      return textExtensions.includes(ext);
    };

    // 下载确认标题
    const getDownloadTitle = file => `确定要下载文件 "${truncateName(file?.name || '')}" 吗？`;
    const getDownloadFolderTitle = file => `确定要下载文件夹 "${truncateName(file?.name || '')}" 吗？`;

    return {
      formatFileSize,
      formatDate,
      showDownloadConfirm,
      onFileNameClick,
      hideDownloadConfirm,
      handleDownloadConfirm,
      getDeleteTitle,
      getDownloadTitle,
      getDownloadFolderTitle,
      isTextFile,
      isPreviewable,
      isEditing,
      editingName,
      editInput,
      isRenaming,
      hasValidationError,
      validationErrorMessage,
      handleItemClick,
      startRename,
      cancelRename,
      confirmRename,
      handleInputBlur,
      validateInput
    };
  }
});
</script>

<style scoped>
.sftp-file-item {
  display: grid;
  grid-template-columns: minmax(200px, 3fr) minmax(80px, 1fr) minmax(150px, 1fr) minmax(80px, 1fr);
  width: 100%;
  padding: 0;
  border-bottom: 1px solid var(--color-border-default);
  font-size: 13px;
  color: var(--color-text-primary);
  cursor: pointer;
  position: relative;
}

.sftp-file-item:hover {
  background-color: rgba(64, 158, 255, 0.1);
}

.sftp-file-item:active {
  background-color: rgba(64, 158, 255, 0.15);
}

/* 移除文件夹的特殊伪元素，统一悬浮效果 */
.sftp-file-item.sftp-file-directory:after {
  display: none;
}

.sftp-file-item > div {
  padding: 8px 12px;
  display: flex;
  align-items: center;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sftp-file-item > div.sftp-file-name {
  overflow: hidden;
}

.sftp-file-name span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-left: 8px;
}

.sftp-file-name svg {
  flex-shrink: 0;
  /* 图标颜色由具体的 .folder-icon 和 .file-icon 类控制 */
}

.sftp-file-item > div.sftp-file-size,
.sftp-file-item > div.sftp-file-date,
.sftp-file-item > div.sftp-file-actions {
  justify-content: flex-end;
}

.sftp-file-item.sftp-file-directory {
  color: var(--color-primary);
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
  color: var(--color-text-primary);
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
  box-shadow: 0 1px 3px var(--color-shadow-light);
}

.sftp-file-name-input:focus {
  border-color: var(--color-primary-light);
  box-shadow: 0 0 0 2px var(--color-primary-lighter);
}

.sftp-file-name-input.sftp-input-error {
  border-color: var(--color-danger);
  background-color: var(--color-danger-light);
}

.sftp-file-name-input.sftp-input-error:focus {
  border-color: var(--color-danger);
  box-shadow: 0 0 0 2px var(--color-danger-lighter);
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
  position: relative;
  z-index: 5;
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
  transition: background-color var(--theme-transition-duration) var(--theme-transition-timing);
  padding: 0;
  background: transparent;
  position: relative;
  z-index: 10;
}

.sftp-edit-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 确认按钮 */
.sftp-confirm-btn {
  color: var(--color-success);
  background: var(--color-success-light);
  border: 1px solid var(--color-success-lighter);
}

.sftp-confirm-btn:hover:not(:disabled) {
  background: var(--color-success-lighter);
}

.sftp-confirm-btn:active:not(:disabled) {
  background: var(--color-success-light);
}

/* 取消按钮 */
.sftp-cancel-btn {
  color: var(--color-danger);
  background: var(--color-danger-light);
  border: 1px solid var(--color-danger-lighter);
}

.sftp-cancel-btn:hover:not(:disabled) {
  background: var(--color-danger-lighter);
}

.sftp-cancel-btn:active:not(:disabled) {
  background: var(--color-danger-light);
}

/* 重命名加载状态 */
.sftp-rename-loading {
  display: inline-flex;
  align-items: center;
  margin-left: 4px;
}

.sftp-rename-spinner {
  width: 14px;
  height: 14px;
  color: var(--color-primary);
}

.sftp-file-item > div.sftp-file-actions {
  justify-content: flex-end;
  display: flex;
  gap: 2px;
  padding-right: 8px;
  position: relative;
  z-index: 5;
}

.sftp-action-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  width: 28px;
  height: 28px;
  color: var(--color-text-secondary);
  cursor: pointer;
  border-radius: 4px;
  opacity: 0.7;
  transition:
    opacity var(--theme-transition-duration) var(--theme-transition-timing),
    background-color var(--theme-transition-duration) var(--theme-transition-timing),
    color var(--theme-transition-duration) var(--theme-transition-timing);
  padding: 0;
  margin: 0 1px;
  position: relative;
  z-index: 10;
}

.sftp-file-item:hover .sftp-action-button {
  opacity: 1;
}

.sftp-action-button svg {
  transition: fill var(--theme-transition-fast) var(--theme-transition-timing);
}

.sftp-action-button:hover {
  background-color: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.sftp-action-button:hover svg {
  fill: var(--color-text-primary);
}

/* 响应式设计 */
@media (max-width: 600px) {
  .sftp-file-item {
    grid-template-columns: minmax(150px, 2fr) minmax(60px, 1fr) minmax(100px, 1fr) minmax(90px, 1fr);
  }

  .sftp-action-button {
    width: 24px;
    height: 24px;
    margin: 0;
    padding: 0;
  }

  .sftp-file-name-input {
    font-size: 12px;
    padding: 2px 6px;
    max-width: 100px;
    min-width: 80px;
  }

  .sftp-edit-action-btn {
    width: 20px;
    height: 20px;
  }

  .sftp-rename-spinner {
    width: 12px;
    height: 12px;
  }
}

/* 超小屏幕适配 */
@media (max-width: 480px) {
  .sftp-file-item {
    grid-template-columns: minmax(120px, 2fr) minmax(50px, 1fr) minmax(80px, 1fr) minmax(80px, 1fr);
    font-size: 12px;
  }

  .sftp-file-name-input {
    font-size: 11px;
    padding: 1px 4px;
    max-width: 80px;
    min-width: 60px;
  }

  .sftp-action-button {
    width: 20px;
    height: 20px;
  }

  .sftp-edit-action-btn {
    width: 18px;
    height: 18px;
  }

  .sftp-rename-spinner {
    width: 10px;
    height: 10px;
  }
}

/* 图标颜色 - 在所有主题下保持一致 */
.folder-icon {
  color: #d89614; /* 文件夹图标：橙黄色 */
}

.file-icon {
  color: rgb(128, 203, 196); /* 文件图标：青绿色 */
}

/* 高分辨率屏幕优化 */
@media (min-width: 1200px) {
  .sftp-file-name-input {
    max-width: 300px;
  }
}

/* 使用主题变量替代主题特定样式 */
.sftp-file-item {
  border-bottom-color: var(--sftp-file-item-border);
  color: var(--sftp-file-item-color);
}

.sftp-file-item:hover {
  background-color: var(--sftp-file-item-hover-bg);
}

.sftp-file-item:active {
  background-color: var(--sftp-file-item-active-bg);
}

/* 使用主题变量替代主题特定样式 */
.sftp-file-item.sftp-file-directory {
  color: var(--sftp-file-directory-color);
}

/* 使用主题变量替代主题特定样式 */
.sftp-file-name-input {
  background: var(--sftp-file-name-input-bg);
  border-color: var(--sftp-file-name-input-border);
  color: var(--sftp-file-name-input-color);
  box-shadow: 0 1px 3px var(--sftp-file-name-input-shadow);
}

.sftp-file-name-input:focus {
  border-color: var(--sftp-file-name-input-focus-border);
  box-shadow: 0 0 0 2px var(--sftp-file-name-input-focus-shadow);
}

.sftp-file-name-input.sftp-input-error {
  border-color: var(--sftp-file-name-input-error-border);
  background-color: var(--sftp-file-name-input-error-bg);
}

.sftp-file-name-input.sftp-input-error:focus {
  border-color: var(--sftp-file-name-input-error-border);
  box-shadow: 0 0 0 2px var(--sftp-file-name-input-error-shadow);
}

.sftp-confirm-btn {
  color: var(--sftp-confirm-btn-color);
  background: var(--sftp-confirm-btn-bg);
  border-color: var(--sftp-confirm-btn-border);
}

.sftp-confirm-btn:hover:not(:disabled) {
  background: var(--sftp-confirm-btn-hover-bg);
}

.sftp-cancel-btn {
  color: var(--sftp-cancel-btn-color);
  background: var(--sftp-cancel-btn-bg);
  border-color: var(--sftp-cancel-btn-border);
}

.sftp-cancel-btn:hover:not(:disabled) {
  background: var(--sftp-cancel-btn-hover-bg);
}

.sftp-rename-spinner {
  color: var(--sftp-rename-spinner-color);
}

.sftp-action-button {
  color: var(--sftp-action-button-color);
}

.sftp-action-button:hover {
  background-color: var(--sftp-action-button-hover-bg);
  color: var(--sftp-action-button-hover-color);
}

/* 所有主题特定样式已迁移到主题变量 */
</style>
    // 删除确认标题
    const getDeleteTitle = file =>
      file.isDirectory
        ? `确定要删除文件夹 "${file.name}" 及其所有内容吗？`
        : `确定要删除文件 "${file.name}" 吗？`;
