<template>
  <div
    class="ai-command-actions"
    :class="{
      'ai-actions-mobile': isMobile,
      'ai-actions-dark': isDarkTheme
    }"
  >
    <!-- 执行按钮 -->
    <button
      class="ai-action-btn ai-action-execute"
      :title="getExecuteTitle()"
      :disabled="!canExecute"
      @click="handleExecute"
    >
      <svg viewBox="0 0 24 24" width="14" height="14">
        <path fill="currentColor" d="M8,5.14V19.14L19,12.14L8,5.14Z" />
      </svg>
      <span v-if="!isMobile">执行</span>
    </button>

    <!-- 编辑按钮 -->
    <button class="ai-action-btn ai-action-edit" title="编辑命令" @click="openEditModal">
      <svg viewBox="0 0 24 24" width="14" height="14">
        <path
          fill="currentColor"
          d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z"
        />
      </svg>
      <span v-if="!isMobile">编辑</span>
    </button>

    <!-- 添加到脚本库按钮 -->
    <button class="ai-action-btn ai-action-save" title="添加到脚本库" @click="openSaveModal">
      <svg viewBox="0 0 24 24" width="14" height="14">
        <path
          fill="currentColor"
          d="M17,3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V7L17,3M19,19H5V5H16.17L19,7.83V19M12,12C10.34,12 9,13.34 9,15C9,16.66 10.34,18 12,18C13.66,18 15,16.66 15,15C15,13.34 13.66,12 12,12Z"
        />
      </svg>
      <span v-if="!isMobile">保存</span>
    </button>

    <!-- 复制按钮 -->
    <button class="ai-action-btn ai-action-copy" title="复制命令" @click="handleCopy">
      <svg viewBox="0 0 24 24" width="14" height="14">
        <path
          fill="currentColor"
          d="M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z"
        />
      </svg>
      <span v-if="!isMobile">复制</span>
    </button>
  </div>

  <!-- 编辑命令弹窗（统一Modal风格） -->
  <Modal
    :visible="showEditModal"
    title="命令编辑器"
    :width="640"
    :maxWidth="'92vw'"
    :maxHeight="'85vh'"
    customClass="ai-modal"
    @update:visible="val => (showEditModal = val)"
  >
    <div>
      <label class="ai-save-label" for="ai-edit-input">命令内容：</label>
      <textarea
        id="ai-edit-input"
        class="ai-save-textarea"
        v-model="editValue"
        rows="10"
        placeholder="请输入命令..."
      />
    </div>

    <template #footer>
      <button class="btn modal-btn btn-cancel" @click="showEditModal = false">取消</button>
      <button class="btn modal-btn btn-confirm" @click="confirmEdit">确定</button>
    </template>
  </Modal>

  <!-- 保存到脚本库弹窗（统一Modal风格） -->
  <Modal
    :visible="showSaveModal"
    title="添加到脚本库"
    :width="640"
    :maxWidth="'92vw'"
    :maxHeight="'80vh'"
    customClass="ai-modal"
    @update:visible="val => (showSaveModal = val)"
  >
    <div class="ai-save-dialog">
      <label class="ai-save-label" for="save-name">脚本名称：</label>
      <input id="save-name" v-model="saveName" class="ai-save-input" type="text" />
      <label class="ai-save-label" for="save-desc">脚本描述：</label>
      <textarea id="save-desc" v-model="saveDescription" class="ai-save-textarea" rows="4" />
      <label class="ai-save-label" for="save-tags">标签（逗号分隔）：</label>
      <input id="save-tags" v-model="saveTags" class="ai-save-input" type="text" placeholder="例：ssh, network, deploy" />
    </div>

    <template #footer>
      <button class="btn modal-btn btn-cancel" @click="showSaveModal = false">取消</button>
      <button class="btn modal-btn btn-confirm" @click="confirmSave">添加</button>
    </template>
  </Modal>
  </template>

<script setup>
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import scriptLibraryService from '../../services/scriptLibrary';
import { validateCommand } from '../../services/ai/ai-message-parser';
import log from '@/services/log';
import Modal from '@/components/common/Modal.vue';

// Props
const props = defineProps({
  command: {
    type: String,
    required: true
  },
  language: {
    type: String,
    default: 'shell'
  },
  isMobile: {
    type: Boolean,
    default: false
  },
  isDarkTheme: {
    type: Boolean,
    default: false
  }
});

// Emits
const emit = defineEmits(['execute', 'edit', 'add-to-scripts']);

// 计算属性
const canExecute = computed(() => {
  // 检查是否是可执行的命令
  const executableLanguages = ['shell', 'bash', 'sh', 'zsh', 'fish', 'powershell', 'cmd'];
  return (
    executableLanguages.includes(props.language.toLowerCase()) && props.command.trim().length > 0
  );
});

// 方法
const getExecuteTitle = () => {
  if (!canExecute.value) {
    return `无法执行 ${props.language} 代码`;
  }
  return `在终端中执行此 ${props.language} 命令`;
};

const handleExecute = async () => {
  if (!canExecute.value) {
    ElMessage.warning('此类型的代码无法直接执行');
    return;
  }

  // 验证命令安全性
  const validation = validateCommand(props.command);
  if (!validation.isValid) {
    try {
      await ElMessageBox.confirm(
        `检测到潜在风险：${validation.reason}\n\n确定要执行此命令吗？`,
        '安全警告',
        {
          confirmButtonText: '仍要执行',
          cancelButtonText: '取消',
          type: 'warning',
          dangerouslyUseHTMLString: false
        }
      );
    } catch {
      return; // 用户取消
    }
  }

  emit('execute', props.command);
  ElMessage.success('命令已发送到终端');
};

// 保存弹窗 + 标签输入；编辑弹窗使用自定义 Modal
const showSaveModal = ref(false);
const showEditModal = ref(false);
const saveName = ref('');
const saveDescription = ref('');
const saveTags = ref('');
const editValue = ref('');

const openEditModal = () => {
  editValue.value = props.command;
  showEditModal.value = true;
};

const confirmEdit = () => {
  const value = (editValue.value || '').trim();
  if (!value) {
    ElMessage.error('命令不能为空');
    return;
  }
  if (value !== props.command) {
    emit('edit', value);
    ElMessage.success('命令已更新');
  }
  showEditModal.value = false;
};

const openSaveModal = () => {
  saveName.value = generateScriptName();
  saveDescription.value = `从AI助手添加的${props.language}脚本`;
  saveTags.value = `ai, ${props.language}`;
  showSaveModal.value = true;
};

const confirmSave = () => {
  const name = (saveName.value || '').trim();
  const description = (saveDescription.value || '').trim();
  if (!name) {
    ElMessage.error('脚本名称不能为空');
    return;
  }

  // 解析标签（逗号/中文逗号分隔），与默认标签去重合并
  const parsedTags = (saveTags.value || '')
    .split(/[,，]/)
    .map(s => s.trim())
    .filter(Boolean);
  const defaultTags = ['ai', props.language].filter(Boolean);
  const tags = Array.from(new Set([...defaultTags, ...parsedTags]));

  const scriptData = {
    name,
    description,
    command: props.command,
    language: props.language,
    category: 'ai-generated',
    tags,
    source: 'ai-assistant',
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const newScript = scriptLibraryService.addUserScript(scriptData);
  if (newScript) {
    emit('add-to-scripts', scriptData);
    ElMessage.success(`脚本 "${name}" 已添加到脚本库`);
    showSaveModal.value = false;
  } else {
    ElMessage.error('添加脚本失败');
  }
};

const handleCopy = async () => {
  try {
    await navigator.clipboard.writeText(props.command);
    ElMessage.success('命令已复制到剪贴板');
  } catch (error) {
    // 降级方案：使用传统的复制方法
    try {
      const textArea = document.createElement('textarea');
      textArea.value = props.command;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      ElMessage.success('命令已复制到剪贴板');
    } catch (fallbackError) {
      ElMessage.error('复制失败，请手动复制');
    }
  }
};

const generateScriptName = () => {
  // 从命令中生成一个合适的脚本名称
  const command = props.command.trim();

  // 提取第一个命令
  const firstLine = command.split('\n')[0];
  const parts = firstLine.split(' ');
  const mainCommand = parts[0];

  // 尝试从命令中提取有意义的信息
  let scriptName = mainCommand;

  // 根据不同命令类型生成更有意义的名称
  if (mainCommand === 'git') {
    const subCommand = parts[1];
    if (subCommand) {
      scriptName = `git_${subCommand}`;
    }
  } else if (mainCommand === 'docker') {
    const subCommand = parts[1];
    if (subCommand) {
      scriptName = `docker_${subCommand}`;
    }
  } else if (mainCommand === 'npm' || mainCommand === 'yarn') {
    const subCommand = parts[1];
    if (subCommand) {
      scriptName = `${mainCommand}_${subCommand}`;
    }
  } else if (mainCommand === 'find') {
    scriptName = 'find_files';
  } else if (mainCommand === 'grep') {
    scriptName = 'search_text';
  } else if (mainCommand === 'curl' || mainCommand === 'wget') {
    scriptName = 'download_file';
  } else if (mainCommand === 'ssh') {
    scriptName = 'ssh_connect';
  } else if (mainCommand === 'tar') {
    scriptName = 'archive_files';
  }

  // 生成时间戳
  const now = new Date();
  const timestamp = now.toISOString().slice(5, 16).replace(/[-:]/g, '').replace('T', '_');

  return `${scriptName}_${timestamp}`;
};
</script>

<style scoped>
.ai-command-actions {
  display: flex;
  gap: 4px;
  align-items: center;
  flex-wrap: wrap;
}

.ai-action-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg-elevated);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: all var(--transition-fast);
  white-space: nowrap;
}

.ai-action-btn:hover:not(:disabled) {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
  border-color: var(--color-border-hover);
}

.ai-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ai-action-execute {
  color: var(--color-success);
  border-color: var(--color-success-border);
}

.ai-action-execute:hover:not(:disabled) {
  background: var(--color-success-bg);
  border-color: var(--color-success);
}

.ai-action-edit {
  color: var(--color-warning);
  border-color: var(--color-warning-border);
}

.ai-action-edit:hover {
  background: var(--color-warning-bg);
  border-color: var(--color-warning);
}

.ai-action-save {
  color: var(--color-primary);
  border-color: var(--color-primary-border);
}

.ai-action-save:hover {
  background: var(--color-primary-bg);
  border-color: var(--color-primary);
}

.ai-action-copy {
  color: var(--color-info);
  border-color: var(--color-info-border);
}

.ai-action-copy:hover {
  background: var(--color-info-bg);
  border-color: var(--color-info);
}

/* 移动端适配 */
.ai-actions-mobile .ai-action-btn {
  padding: 6px;
  min-width: 32px;
  justify-content: center;
}

.ai-actions-mobile .ai-action-btn span {
  display: none;
}

/* 深色主题适配 */
.ai-actions-dark .ai-action-btn {
  background: var(--color-bg-elevated-dark);
  border-color: var(--color-border-dark);
  color: var(--color-text-secondary-dark);
}

.ai-actions-dark .ai-action-btn:hover:not(:disabled) {
  background: var(--color-bg-hover-dark);
  color: var(--color-text-primary-dark);
  border-color: var(--color-border-hover-dark);
}

/* 统一风格的表单控件（在自定义 Modal 内） */
.ai-save-label {
  display: block;
  margin: 8px 0 6px;
  font-size: var(--font-size-sm);
  color: var(--color-text-regular);
}

.ai-save-input,
.ai-save-textarea {
  width: 100%;
  padding: 8px 10px;
  background-color: var(--color-bg-muted);
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  color: var(--color-text-primary);
  outline: none;
}

.ai-save-input:hover,
.ai-save-textarea:hover,
.ai-save-input:focus,
.ai-save-textarea:focus,
.ai-save-input:focus-visible,
.ai-save-textarea:focus-visible {
  border-color: var(--color-primary);
}
</style>
