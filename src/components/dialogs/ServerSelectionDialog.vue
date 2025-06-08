<template>
  <el-dialog
    :model-value="visible"
    @update:model-value="$emit('update:visible', $event)"
    title="选择执行服务器"
    width="600px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    class="server-selection-dialog"
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
        <h4>选择服务器 ({{ selectedServers.length }}/{{ servers.length }})</h4>
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
                @change="(checked) => handleServerSelection(server.id, checked)"
              >
                <template #default>
                  <div class="server-info">
                    <div class="server-name">{{ server.name }}</div>
                    <div class="server-details">
                      <span class="host">{{ server.username }}@{{ server.host }}:{{ server.port }}</span>
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
        <el-alert
          title="请至少选择一个服务器"
          type="warning"
          :closable="false"
          show-icon
        />
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="handleCancel">取消</el-button>
        <el-button
          type="primary"
          :disabled="selectedServers.length === 0"
          :loading="executing"
          @click="handleExecute"
        >
          {{ executing ? '执行中...' : `全部运行 (${selectedServers.length})` }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script>
import { defineComponent, ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import apiService from '@/services/api.js'
import log from '@/services/log.js'

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
    const servers = ref([])
    const selectedServers = ref([])
    const executing = ref(false)
    const loading = ref(false)

    // 全选状态
    const selectAll = ref(false)
    const isIndeterminate = computed(() => {
      const selected = selectedServers.value.length
      const total = servers.value.length
      return selected > 0 && selected < total
    })

    // 加载服务器列表
    const loadServers = async () => {
      try {
        loading.value = true
        const response = await apiService.get('/connections')
        if (response && response.success) {
          servers.value = response.connections || []
          log.info('加载服务器列表成功', { count: servers.value.length })
        } else {
          throw new Error(response?.message || '获取服务器列表失败')
        }
      } catch (error) {
        log.error('加载服务器列表失败', error)
        ElMessage.error('加载服务器列表失败: ' + error.message)
        servers.value = []
      } finally {
        loading.value = false
      }
    }

    // 处理全选
    const handleSelectAll = (checked) => {
      if (checked) {
        selectedServers.value = servers.value.map(server => server.id)
      } else {
        selectedServers.value = []
      }
    }

    // 处理单个服务器选择
    const handleServerSelection = (serverId, checked) => {
      if (checked) {
        if (!selectedServers.value.includes(serverId)) {
          selectedServers.value.push(serverId)
        }
      } else {
        const index = selectedServers.value.indexOf(serverId)
        if (index > -1) {
          selectedServers.value.splice(index, 1)
        }
      }
      updateSelectAllState()
    }

    // 更新全选状态
    const updateSelectAllState = () => {
      const selected = selectedServers.value.length
      const total = servers.value.length
      selectAll.value = selected === total && total > 0
    }

    // 处理取消
    const handleCancel = () => {
      emit('update:visible', false)
      // 重置状态
      selectedServers.value = []
      selectAll.value = false
    }

    // 处理执行
    const handleExecute = async () => {
      if (selectedServers.value.length === 0) {
        ElMessage.warning('请至少选择一个服务器')
        return
      }

      try {
        executing.value = true
        
        // 获取选中的服务器信息
        const selectedServerList = servers.value.filter(server => 
          selectedServers.value.includes(server.id)
        )

        // 触发执行事件
        emit('execute', {
          script: props.script,
          servers: selectedServerList
        })

        // 关闭对话框
        emit('update:visible', false)
        
        // 重置状态
        selectedServers.value = []
        selectAll.value = false
        
      } catch (error) {
        log.error('执行脚本失败', error)
        ElMessage.error('执行脚本失败: ' + error.message)
      } finally {
        executing.value = false
      }
    }

    // 监听对话框显示状态
    watch(() => props.visible, (newVal) => {
      if (newVal) {
        loadServers()
      }
    })

    // 监听选中服务器变化
    watch(selectedServers, updateSelectAllState, { deep: true })

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
    }
  }
})
</script>

<style scoped>
.server-selection-dialog {
  --el-dialog-border-radius: 8px;
}

.server-selection-dialog :deep(.el-dialog) {
  background-color: #2a2a2a;
  border: 1px solid #444;
}

.server-selection-dialog :deep(.el-dialog__header) {
  background-color: #2a2a2a;
  border-bottom: 1px solid #444;
  color: #e0e0e0;
}

.server-selection-dialog :deep(.el-dialog__title) {
  color: #e0e0e0;
}

.server-selection-dialog :deep(.el-dialog__body) {
  background-color: #2a2a2a;
  color: #e0e0e0;
}

.dialog-content {
  max-height: 500px;
  overflow-y: auto;
}

.script-info {
  margin-bottom: 24px;
  padding: 16px;
  background-color: #333;
  border-radius: 6px;
  border: 1px solid #444;
}

.script-info h4 {
  margin: 0 0 12px 0;
  color: #e0e0e0;
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
  color: #b0b0b0;
  min-width: 50px;
}

.detail-item .value {
  color: #e0e0e0;
}

.detail-item code.value {
  background-color: #444;
  padding: 2px 6px;
  border-radius: 3px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  color: #e0e0e0;
}

.server-selection h4 {
  margin: 0 0 16px 0;
  color: #e0e0e0;
  font-size: 14px;
  font-weight: 600;
}

.select-all-row {
  padding: 8px 0;
  border-bottom: 1px solid #444;
  margin-bottom: 12px;
}

.server-items {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.server-item {
  padding: 12px;
  border: 1px solid #444;
  border-radius: 6px;
  transition: all 0.2s ease;
  background-color: #333;
}

.server-item:hover {
  border-color: #409eff;
  background-color: #3a3a3a;
}

.server-item.selected {
  border-color: #409eff;
  background-color: #2a4a6b;
}

.server-info {
  margin-left: 8px;
}

.server-name {
  font-weight: 500;
  color: #e0e0e0;
  margin-bottom: 4px;
}

.server-details {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: #b0b0b0;
}

.server-details .host {
  font-family: 'Consolas', 'Monaco', monospace;
}

.server-details .group {
  color: #888;
}

.no-selection {
  margin-top: 16px;
}

.no-selection :deep(.el-alert) {
  background-color: #2a2a1a !important;
  border-color: #555500 !important;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

/* Element Plus 组件样式覆盖 */
.server-selection-dialog :deep(.el-checkbox) {
  color: #e0e0e0;
}

.server-selection-dialog :deep(.el-checkbox__label) {
  color: #e0e0e0;
}

.server-selection-dialog :deep(.el-checkbox__input.is-checked .el-checkbox__inner) {
  background-color: #409eff;
  border-color: #409eff;
}

.server-selection-dialog :deep(.el-checkbox__inner) {
  background-color: #444;
  border-color: #666;
}

.server-selection-dialog :deep(.el-checkbox__inner:hover) {
  border-color: #409eff;
}

.server-selection-dialog :deep(.el-alert) {
  background-color: #2a2a2a;
  border: 1px solid #555;
}

.server-selection-dialog :deep(.el-alert.el-alert--warning) {
  background-color: #3a2f1a;
  border-color: #664d00;
}

.server-selection-dialog :deep(.el-alert__title) {
  color: #e0e0e0;
}

.server-selection-dialog :deep(.el-alert--warning .el-alert__title) {
  color: #ffd666;
}

.server-selection-dialog :deep(.el-alert__icon) {
  color: #ffd666;
}

.server-selection-dialog :deep(.el-button) {
  background-color: #444;
  border-color: #666;
  color: #e0e0e0;
}

.server-selection-dialog :deep(.el-button:hover) {
  background-color: #555;
  border-color: #777;
}

.server-selection-dialog :deep(.el-button--primary) {
  background-color: #409eff;
  border-color: #409eff;
}

.server-selection-dialog :deep(.el-button--primary:hover) {
  background-color: #66b1ff;
  border-color: #66b1ff;
}
</style>
