<template>
  <el-dialog
    v-model="visible"
    title="编辑文件权限"
    width="500px"
    :before-close="handleClose"
    class="sftp-permissions-dialog"
  >
    <div
      v-if="file"
      class="permissions-content"
    >
      <div class="file-info">
        <div class="file-icon">
          <svg
            v-if="file.isDirectory"
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
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
            width="24"
            height="24"
            viewBox="0 0 24 24"
            class="file-icon"
          >
            <path
              fill="currentColor"
              d="M13,9V3.5L18.5,9M6,2C4.89,2 4,2.89 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2H6Z"
            />
          </svg>
        </div>
        <div class="file-details">
          <div class="file-name">
            {{ file.name }}
          </div>
          <div class="file-type">
            {{ file.isDirectory ? '文件夹' : '文件' }}
          </div>
        </div>
      </div>

      <div class="permissions-section">
        <h4>权限设置</h4>

        <!-- 数字权限输入 -->
        <div class="numeric-permissions">
          <label>数字权限：</label>
          <el-input
            v-model="numericPermissions"
            placeholder="例如: 755"
            maxlength="3"
            class="numeric-input"
            @input="handleNumericChange"
          />
          <span class="permission-display">{{ formatPermissions(currentPermissions) }}</span>
        </div>

        <!-- 权限表格 -->
        <div class="permissions-table">
          <table>
            <thead>
              <tr>
                <th />
                <th>读取 (r)</th>
                <th>写入 (w)</th>
                <th>执行 (x)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="permission-label">
                  所有者
                </td>
                <td>
                  <el-checkbox
                    v-model="permissions.owner.read"
                    @change="updateNumericPermissions"
                  />
                </td>
                <td>
                  <el-checkbox
                    v-model="permissions.owner.write"
                    @change="updateNumericPermissions"
                  />
                </td>
                <td>
                  <el-checkbox
                    v-model="permissions.owner.execute"
                    @change="updateNumericPermissions"
                  />
                </td>
              </tr>
              <tr>
                <td class="permission-label">
                  群组
                </td>
                <td>
                  <el-checkbox
                    v-model="permissions.group.read"
                    @change="updateNumericPermissions"
                  />
                </td>
                <td>
                  <el-checkbox
                    v-model="permissions.group.write"
                    @change="updateNumericPermissions"
                  />
                </td>
                <td>
                  <el-checkbox
                    v-model="permissions.group.execute"
                    @change="updateNumericPermissions"
                  />
                </td>
              </tr>
              <tr>
                <td class="permission-label">
                  其他
                </td>
                <td>
                  <el-checkbox
                    v-model="permissions.other.read"
                    @change="updateNumericPermissions"
                  />
                </td>
                <td>
                  <el-checkbox
                    v-model="permissions.other.write"
                    @change="updateNumericPermissions"
                  />
                </td>
                <td>
                  <el-checkbox
                    v-model="permissions.other.execute"
                    @change="updateNumericPermissions"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 常用权限快捷设置 -->
        <div class="quick-permissions">
          <h5>常用权限</h5>
          <div class="quick-buttons">
            <el-button
              size="small"
              @click="setQuickPermission('755')"
            >
              755 (rwxr-xr-x)
            </el-button>
            <el-button
              size="small"
              @click="setQuickPermission('644')"
            >
              644 (rw-r--r--)
            </el-button>
            <el-button
              size="small"
              @click="setQuickPermission('600')"
            >
              600 (rw-------)
            </el-button>
            <el-button
              size="small"
              @click="setQuickPermission('777')"
            >
              777 (rwxrwxrwx)
            </el-button>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="handleClose">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="saving"
          @click="handleSave"
        >
          保存
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script>
import { defineComponent, ref, computed, watch } from 'vue';
import { ElDialog, ElInput, ElCheckbox, ElButton, ElMessage } from 'element-plus';

export default defineComponent({
  name: 'SftpPermissionsDialog',
  components: {
    ElDialog,
    ElInput,
    ElCheckbox,
    ElButton
  },
  props: {
    modelValue: {
      type: Boolean,
      default: false
    },
    file: {
      type: Object,
      default: () => null
    }
  },
  emits: ['update:modelValue', 'save'],
  setup(props, { emit }) {
    const saving = ref(false);

    // 对话框可见性
    const visible = computed({
      get: () => props.modelValue,
      set: value => emit('update:modelValue', value)
    });

    // 权限状态
    const permissions = ref({
      owner: { read: false, write: false, execute: false },
      group: { read: false, write: false, execute: false },
      other: { read: false, write: false, execute: false }
    });

    const numericPermissions = ref('');
    const currentPermissions = ref(0);

    // 初始化权限
    const initPermissions = () => {
      if (props.file && props.file.permissions !== undefined) {
        const mode = props.file.permissions;
        currentPermissions.value = mode;
        parsePermissions(mode);
      } else {
        // 如果没有文件或权限信息，设置默认值
        currentPermissions.value = 0o644;
        parsePermissions(0o644);
      }
    };

    // 解析权限数字为复选框状态
    const parsePermissions = mode => {
      // 提取文件权限部分 (去掉文件类型位)
      const perms = mode & 0o777;

      permissions.value.owner.read = !!(perms & 0o400);
      permissions.value.owner.write = !!(perms & 0o200);
      permissions.value.owner.execute = !!(perms & 0o100);

      permissions.value.group.read = !!(perms & 0o040);
      permissions.value.group.write = !!(perms & 0o020);
      permissions.value.group.execute = !!(perms & 0o010);

      permissions.value.other.read = !!(perms & 0o004);
      permissions.value.other.write = !!(perms & 0o002);
      permissions.value.other.execute = !!(perms & 0o001);

      numericPermissions.value = perms.toString(8).padStart(3, '0');
    };

    // 更新数字权限
    const updateNumericPermissions = () => {
      let perms = 0;

      if (permissions.value.owner.read) perms |= 0o400;
      if (permissions.value.owner.write) perms |= 0o200;
      if (permissions.value.owner.execute) perms |= 0o100;

      if (permissions.value.group.read) perms |= 0o040;
      if (permissions.value.group.write) perms |= 0o020;
      if (permissions.value.group.execute) perms |= 0o010;

      if (permissions.value.other.read) perms |= 0o004;
      if (permissions.value.other.write) perms |= 0o002;
      if (permissions.value.other.execute) perms |= 0o001;

      numericPermissions.value = perms.toString(8).padStart(3, '0');
      currentPermissions.value = perms;
    };

    // 处理数字权限输入
    const handleNumericChange = value => {
      if (!/^\d{0,3}$/.test(value)) {
        return;
      }

      if (value.length === 3) {
        const perms = parseInt(value, 8);
        if (perms <= 0o777) {
          parsePermissions(perms);
          currentPermissions.value = perms;
        }
      }
    };

    // 格式化权限显示
    const formatPermissions = mode => {
      const perms = mode & 0o777;
      let result = '';

      // 所有者权限
      result += perms & 0o400 ? 'r' : '-';
      result += perms & 0o200 ? 'w' : '-';
      result += perms & 0o100 ? 'x' : '-';

      // 群组权限
      result += perms & 0o040 ? 'r' : '-';
      result += perms & 0o020 ? 'w' : '-';
      result += perms & 0o010 ? 'x' : '-';

      // 其他权限
      result += perms & 0o004 ? 'r' : '-';
      result += perms & 0o002 ? 'w' : '-';
      result += perms & 0o001 ? 'x' : '-';

      return result;
    };

    // 设置快捷权限
    const setQuickPermission = perm => {
      numericPermissions.value = perm;
      handleNumericChange(perm);
    };

    // 关闭对话框
    const handleClose = () => {
      visible.value = false;
    };

    // 保存权限
    const handleSave = async () => {
      if (!props.file) {
        ElMessage.error('没有选择文件');
        return;
      }

      try {
        saving.value = true;
        const newPermissions = parseInt(numericPermissions.value, 8);
        await emit('save', props.file, newPermissions);
        ElMessage.success('权限修改成功');
        handleClose();
      } catch (error) {
        ElMessage.error(`权限修改失败: ${error.message}`);
      } finally {
        saving.value = false;
      }
    };

    // 监听文件变化，重新初始化权限
    watch(() => props.file, initPermissions, { immediate: true });

    return {
      visible,
      saving,
      permissions,
      numericPermissions,
      currentPermissions,
      updateNumericPermissions,
      handleNumericChange,
      formatPermissions,
      setQuickPermission,
      handleClose,
      handleSave
    };
  }
});
</script>

<style scoped>
.permissions-content {
  padding: 16px 0;
}

.file-info {
  display: flex;
  align-items: center;
  margin-bottom: 24px;
  padding: 16px;
  background-color: var(--color-bg-muted);
  border-radius: 8px;
}

.file-icon {
  margin-right: 12px;
}

.folder-icon {
  color: #d89614;
}

.file-icon svg {
  color: rgb(128, 203, 196);
}

.file-details {
  flex: 1;
}

.file-name {
  font-weight: 500;
  font-size: 16px;
  color: var(--color-text-primary);
  margin-bottom: 4px;
}

.file-type {
  font-size: 14px;
  color: var(--color-text-secondary);
}

.permissions-section h4 {
  margin: 0 0 16px 0;
  color: var(--color-text-primary);
  font-size: 16px;
  font-weight: 500;
}

.numeric-permissions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
}

.numeric-permissions label {
  font-weight: 500;
  color: var(--color-text-primary);
  min-width: 80px;
}

.numeric-input {
  width: 100px;
}

.permission-display {
  font-family: monospace;
  font-size: 14px;
  color: var(--color-text-secondary);
  background-color: var(--color-bg-container);
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid var(--color-border-default);
}

.permissions-table {
  margin-bottom: 24px;
}

.permissions-table table {
  width: 100%;
  border-collapse: collapse;
}

.permissions-table th,
.permissions-table td {
  padding: 12px 8px;
  text-align: center;
  border-bottom: 1px solid var(--color-border-default);
}

.permissions-table th {
  background-color: var(--color-bg-muted);
  font-weight: 500;
  color: var(--color-text-primary);
}

.permission-label {
  text-align: left !important;
  font-weight: 500;
  color: var(--color-text-primary);
}

.quick-permissions h5 {
  margin: 0 0 12px 0;
  color: var(--color-text-primary);
  font-size: 14px;
  font-weight: 500;
}

.quick-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
