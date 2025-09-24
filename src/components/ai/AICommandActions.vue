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
    <button class="ai-action-btn ai-action-edit" title="编辑命令" @click="handleEdit">
      <svg viewBox="0 0 24 24" width="14" height="14">
        <path
          fill="currentColor"
          d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z"
        />
      </svg>
      <span v-if="!isMobile">编辑</span>
    </button>

    <!-- 添加到脚本库按钮 -->
    <button class="ai-action-btn ai-action-save" title="添加到脚本库" @click="handleAddToScripts">
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
</template>

<script setup>
import { computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import scriptLibraryService from '../../services/scriptLibrary.js';
import { validateCommand } from '../../services/ai/ai-message-parser.js';
import log from '@/services/log';

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

const handleEdit = async () => {
  try {
    const { value: editedCommand } = await ElMessageBox.prompt('编辑命令：', '命令编辑器', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputValue: props.command,
      inputType: 'textarea',
      inputPlaceholder: '请输入命令...',
      inputValidator: value => {
        if (!value || !value.trim()) {
          return '命令不能为空';
        }
        return true;
      }
    });

    if (editedCommand && editedCommand.trim() !== props.command) {
      emit('edit', editedCommand.trim());
      ElMessage.success('命令已更新');
    }
  } catch {
    // 用户取消编辑
  }
};

const handleAddToScripts = async () => {
  try {
    // 生成默认脚本名称和描述
    const defaultName = generateScriptName();
    const defaultDescription = `从AI助手添加的${props.language}脚本`;

    // 弹出对话框让用户输入脚本信息
    const { value: scriptInfo } = await ElMessageBox.prompt(
      `
        <div style="text-align: left;">
          <p><strong>脚本名称：</strong></p>
          <input type="text" id="script-name" value="${defaultName}" style="width: 100%; margin-bottom: 10px; padding: 5px; border: 1px solid #ddd; border-radius: 4px;" />
          <p><strong>脚本描述：</strong></p>
          <textarea id="script-description" style="width: 100%; height: 60px; padding: 5px; border: 1px solid #ddd; border-radius: 4px; resize: vertical;">${defaultDescription}</textarea>
        </div>
      `,
      '添加到脚本库',
      {
        confirmButtonText: '添加',
        cancelButtonText: '取消',
        dangerouslyUseHTMLString: true,
        beforeClose: (action, instance, done) => {
          if (action === 'confirm') {
            const name = document.getElementById('script-name')?.value?.trim();
            const description = document.getElementById('script-description')?.value?.trim();

            if (!name) {
              ElMessage.error('脚本名称不能为空');
              return;
            }

            instance.inputValue = { name, description };
          }
          done();
        }
      }
    );

    if (scriptInfo) {
      const { name, description } = scriptInfo;

      // 创建脚本数据
      const scriptData = {
        name: name || defaultName,
        description: description || defaultDescription,
        command: props.command,
        language: props.language,
        category: 'ai-generated',
        tags: ['ai', props.language],
        source: 'ai-assistant',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // 添加到脚本库
      const newScript = scriptLibraryService.addUserScript(scriptData);

      if (newScript) {
        emit('add-to-scripts', scriptData);
        ElMessage.success(`脚本 "${name}" 已添加到脚本库`);
      } else {
        ElMessage.error('添加脚本失败');
      }
    }
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('添加脚本时发生错误');
      log.error('添加脚本错误', error);
    }
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
</style>
