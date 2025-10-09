<template>
  <el-dialog
    :model-value="visible"
    title="选择执行服务器"
    width="600px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    class="server-selection-dialog"
    @update:model-value="$emit('update:visible', $event)"
  >
    <div class="dialog-content">
      <div class="script-info">
        <h4>脚本信息</h4>
        <div class="script-details">
          <div class="detail-item">
            <span class="label">名称:</span>
            <span class="value">{{ script?.name }}</span>
          </div>
          <div class="detail-item">
            <span class="label">命令:</span>
            <code class="value">{{ script?.command }}</code>
          </div>
        </div>
      </div>

      <div class="server-selection">
        <h4>选择服务器 (<span class="tabular-nums">{{ selectedServers.length }}</span>/<span class="tabular-nums">{{ servers.length }}</span>)</h4>
        <div class="server-list">
          <div class="select-all-row">
            <el-checkbox
              v-model="selectAll"
              :indeterminate="isIndeterminate"
              @change="handleSelectAll"
            >
              全选
            </el-checkbox>
          </div>

          <div class="server-items">
            <div
              v-for="server in servers"
              :key="server.id"
              class="server-item"
              :class="{ selected: selectedServers.includes(server.id) }"
            >
              <el-checkbox
                :model-value="selectedServers.includes(server.id)"
                @change="checked => handleServerSelection(server.id, checked)"
              >
                <template #default>
                  <div class="server-info">
                    <div class="server-name">
                      {{ server.name }}
                    </div>
                    <div class="server-details">
                      <span class="host"
                        >{{ server.username }}@{{ server.host }}:{{ server.port }}</span
                      >
                      <span class="group">{{ server.group }}</span>
                    </div>
                  </div>
                </template>
              </el-checkbox>
            </div>
          </div>
        </div>
      </div>

      <div v-if="selectedServers.length === 0" class="no-selection">
        <el-alert title="请至少选择一个服务器" type="warning" :closable="false" show-icon />
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="handleCancel"> 取消 </el-button>
        <el-button
          type="primary"
          :disabled="selectedServers.length === 0"
          :loading="executing"
          @click="handleExecute"
        >
          <template v-if="executing">执行中...</template>
          <template v-else>全部运行 (<span class="tabular-nums">{{ selectedServers.length }}</span>)</template>
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script>
import { defineComponent, ref, computed, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { useUserStore } from '@/store/user';
import { useLocalConnectionsStore } from '@/store/localConnections';
import log from '@/services/log';

export default defineComponent({
  name: 'ServerSelectionDialog',
  props: {
    visible: {
      type: Boolean,
      default: false
    },
    script: {
      type: Object,
      default: null
    }
  },
  emits: ['update:visible', 'execute'],
  setup(props, { emit }) {
    const servers = ref([]);
    const selectedServers = ref([]);
    const executing = ref(false);
    const loading = ref(false);

    // 全选状态
    const selectAll = ref(false);
    const isIndeterminate = computed(() => {
      const selected = selectedServers.value.length;
      const total = servers.value.length;
      return selected > 0 && selected < total;
    });

    // 加载服务器列表（优化为按需加载模式）
    const loadServers = async () => {
      try {
        loading.value = true;

        const userStore = useUserStore();

        if (userStore.isLoggedIn) {
          // 并发确保连接相关数据已加载，然后直接读 store
          await userStore.ensureConnectionsData();
          servers.value = userStore.connections || [];
          log.info('从Store加载服务器列表成功', { count: servers.value.length });
          return;
        }

        // 未登录场景：使用本地连接存储
        const localStore = useLocalConnectionsStore();
        servers.value = localStore.getAllConnections || [];
        log.info('未登录：从本地连接存储加载服务器列表成功', { count: servers.value.length });
      } catch (error) {
        log.error('加载服务器列表失败', error);
        ElMessage.error(`加载服务器列表失败: ${error.message}`);
        servers.value = [];
      } finally {
        loading.value = false;
      }
    };

    // 处理全选
    const handleSelectAll = checked => {
      if (checked) {
        selectedServers.value = servers.value.map(server => server.id);
      } else {
        selectedServers.value = [];
      }
    };

    // 处理单个服务器选择
    const handleServerSelection = (serverId, checked) => {
      if (checked) {
        if (!selectedServers.value.includes(serverId)) {
          selectedServers.value.push(serverId);
        }
      } else {
        const index = selectedServers.value.indexOf(serverId);
        if (index > -1) {
          selectedServers.value.splice(index, 1);
        }
      }
      updateSelectAllState();
    };

    // 更新全选状态
    const updateSelectAllState = () => {
      const selected = selectedServers.value.length;
      const total = servers.value.length;
      selectAll.value = selected === total && total > 0;
    };

    // 处理取消
    const handleCancel = () => {
      emit('update:visible', false);
      // 重置状态
      selectedServers.value = [];
      selectAll.value = false;
    };

    // 处理执行
    const handleExecute = async () => {
      if (selectedServers.value.length === 0) {
        ElMessage.warning('请至少选择一个服务器');
        return;
      }

      try {
        executing.value = true;

        // 获取选中的服务器信息
        const selectedServerList = servers.value.filter(server =>
          selectedServers.value.includes(server.id)
        );

        // 触发执行事件
        emit('execute', {
          script: props.script,
          servers: selectedServerList
        });

        // 关闭对话框
        emit('update:visible', false);

        // 重置状态
        selectedServers.value = [];
        selectAll.value = false;
      } catch (error) {
        log.error('执行脚本失败', error);
        ElMessage.error(`执行脚本失败: ${error.message}`);
      } finally {
        executing.value = false;
      }
    };

    // 监听对话框显示状态
    watch(
      () => props.visible,
      newVal => {
        if (newVal) {
          loadServers();
        }
      }
    );

    // 监听选中服务器变化
    watch(selectedServers, updateSelectAllState, { deep: true });

    return {
      servers,
      selectedServers,
      executing,
      loading,
      selectAll,
      isIndeterminate,
      handleSelectAll,
      handleServerSelection,
      updateSelectAllState,
      handleCancel,
      handleExecute
    };
  }
});
</script>

<style scoped>
.server-selection-dialog {
  --el-dialog-border-radius: 8px;
}

.server-selection-dialog :deep(.el-dialog) {
  background-color: var(--dialog-bg);
  border: 1px solid var(--dialog-border);
}

.server-selection-dialog :deep(.el-dialog__header) {
  background-color: var(--dialog-header-bg);
  border-bottom: 1px solid var(--dialog-border);
  color: var(--dialog-title-color);
}

.server-selection-dialog :deep(.el-dialog__title) {
  color: var(--dialog-title-color);
}

.server-selection-dialog :deep(.el-dialog__body) {
  background-color: var(--dialog-bg);
  color: var(--color-text-primary);
}

.dialog-content {
  max-height: 500px;
  overflow-y: auto;
}

.script-info {
  margin-bottom: 24px;
  padding: 16px;
  background-color: var(--color-bg-muted);
  border-radius: var(--radius-lg, 6px);
  border: 1px solid var(--color-border-default);
}

.script-info h4 {
  margin: 0 0 12px 0;
  color: var(--color-text-primary);
  font-size: 14px;
  font-weight: 600;
}

.script-details {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.detail-item .label {
  font-weight: 500;
  color: var(--color-text-secondary);
  min-width: 50px;
}

.detail-item .value {
  color: var(--color-text-primary);
}

.detail-item code.value {
  background-color: var(--color-bg-muted);
  padding: 2px 6px;
  border-radius: 3px;
  /* 统一等宽字体变量 */
  font-family: var(--font-family-mono);
  font-size: 13px;
  color: var(--color-text-primary);
}

.server-selection h4 {
  margin: 0 0 16px 0;
  color: var(--color-text-primary);
  font-size: 14px;
  font-weight: 600;
}

.select-all-row {
  padding: 8px 0;
  border-bottom: 1px solid var(--color-border-default);
  margin-bottom: 12px;
}

.server-items {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.server-item {
  padding: 12px;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md, 6px);
  transition: all var(--theme-transition-duration) var(--theme-transition-timing);
  background-color: var(--color-bg-muted);
}

.server-item:hover {
  border-color: var(--color-primary);
  background-color: var(--color-hover-bg);
}

.server-item.selected {
  border-color: var(--color-primary);
  background-color: var(--color-selected-bg);
}

.server-info {
  margin-left: 8px;
}

.server-name {
  font-weight: 500;
  color: var(--color-text-primary);
  margin-bottom: 4px;
}

.server-details {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.server-details .host {
  /* 统一等宽字体变量 */
  font-family: var(--font-family-mono);
}

.server-details .group {
  color: var(--color-text-placeholder);
}

.no-selection {
  margin-top: 16px;
}

.no-selection :deep(.el-alert) {
  background-color: var(--color-warning-bg);
  border-color: var(--color-warning);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

/* Element Plus 组件样式覆盖 */
.server-selection-dialog :deep(.el-checkbox) {
  color: var(--color-text-primary);
}

.server-selection-dialog :deep(.el-checkbox__label) {
  color: var(--color-text-primary);
}

.server-selection-dialog :deep(.el-checkbox__input.is-checked .el-checkbox__inner) {
  background-color: var(--color-primary);
  border-color: var(--color-primary);
}

.server-selection-dialog :deep(.el-checkbox__inner) {
  background-color: var(--color-bg-container);
  border-color: var(--color-border-default);
}

.server-selection-dialog :deep(.el-checkbox__inner:hover) {
  border-color: var(--color-primary);
}

.server-selection-dialog :deep(.el-alert) {
  background-color: var(--color-bg-container);
  border: 1px solid var(--color-border-default);
}

.server-selection-dialog :deep(.el-alert.el-alert--warning) {
  background-color: var(--color-warning-bg);
  border-color: var(--color-warning);
}

.server-selection-dialog :deep(.el-alert__title) {
  color: var(--color-text-primary);
}

.server-selection-dialog :deep(.el-alert--warning .el-alert__title) {
  color: var(--color-warning);
}

.server-selection-dialog :deep(.el-alert__icon) {
  color: var(--color-warning);
}

.server-selection-dialog :deep(.el-button) {
  /* 使用 Element Plus 提供的按钮CSS变量，避免与库样式竞争顺序 */
  --el-button-bg-color: var(--color-bg-muted);
  --el-button-border-color: var(--color-border-default);
  --el-button-text-color: var(--color-text-primary);
  --el-button-hover-bg-color: var(--color-hover-bg);
  --el-button-hover-border-color: var(--color-border-dark);
  --el-button-hover-text-color: var(--color-text-primary);
  --el-button-disabled-bg-color: var(--btn-disabled-bg);
  --el-button-disabled-text-color: var(--btn-disabled-color);
  --el-button-disabled-border-color: var(--color-border-default);
}

.server-selection-dialog :deep(.el-button--primary) {
  --el-button-bg-color: var(--btn-primary-bg);
  --el-button-border-color: var(--btn-primary-bg);
  --el-button-text-color: var(--btn-primary-text);
  --el-button-hover-bg-color: var(--btn-primary-hover-bg);
  --el-button-hover-border-color: var(--btn-primary-hover-bg);
  --el-button-hover-text-color: var(--btn-primary-text);
}
</style>
