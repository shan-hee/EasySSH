<template>
  <el-dialog
    :model-value="visible"
    @update:model-value="$emit('update:visible', $event)"
    title="脚本执行结果"
    width="90%"
    :close-on-click-modal="false"
    class="script-execution-dialog"
    top="5vh"
  >
    <div class="execution-content">
      <!-- 脚本信息 -->
      <div class="script-header">
        <h3>{{ script?.name }}</h3>
        <code class="script-command">{{ script?.command }}</code>
      </div>

      <div class="execution-layout">
        <!-- 左侧：服务器列表 -->
        <div class="server-list-panel">
          <div class="panel-header">
            <h4>执行服务器 ({{ executionResults.length }})</h4>
            <div class="status-summary">
              <span class="success-count">成功: {{ successCount }}</span>
              <span class="failed-count">失败: {{ failedCount }}</span>
              <span class="running-count" v-if="runningCount > 0">执行中: {{ runningCount }}</span>
            </div>
          </div>
          
          <div class="server-items">
            <div
              v-for="(result, index) in executionResults"
              :key="result.server.id"
              class="server-item"
              :class="{ 
                active: selectedServerIndex === index,
                success: result.status === 'success',
                failed: result.status === 'failed',
                running: result.status === 'running'
              }"
              @click="selectServer(index)"
            >
              <div class="server-info">
                <div class="server-name">{{ result.server.name }}</div>
                <div class="server-host">{{ result.server.username }}@{{ result.server.host }}:{{ result.server.port }}</div>
              </div>
              <div class="status-icon">
                <el-icon v-if="result.status === 'success'" class="success-icon">
                  <Check />
                </el-icon>
                <el-icon v-else-if="result.status === 'failed'" class="failed-icon">
                  <Close />
                </el-icon>
                <el-icon v-else-if="result.status === 'running'" class="running-icon">
                  <Loading />
                </el-icon>
                <el-icon v-else class="pending-icon">
                  <Clock />
                </el-icon>
              </div>
            </div>
          </div>
        </div>

        <!-- 右侧：执行结果详情 -->
        <div class="result-detail-panel">
          <div class="panel-header">
            <h4 v-if="selectedResult">
              {{ selectedResult.server.name }} - 执行结果
            </h4>
            <h4 v-else>请选择服务器查看执行结果</h4>
          </div>

          <div v-if="selectedResult" class="result-content">
            <div class="result-meta">
              <div class="meta-item">
                <span class="label">状态:</span>
                <span class="value" :class="selectedResult.status">
                  {{ getStatusText(selectedResult.status) }}
                </span>
              </div>
              <div class="meta-item" v-if="selectedResult.executedAt">
                <span class="label">执行时间:</span>
                <span class="value">{{ formatTime(selectedResult.executedAt) }}</span>
              </div>
              <div class="meta-item" v-if="selectedResult.duration">
                <span class="label">耗时:</span>
                <span class="value">{{ selectedResult.duration }}ms</span>
              </div>
            </div>

            <!-- 标准输出 -->
            <div v-if="selectedResult.stdout" class="output-section">
              <h5>标准输出 (stdout)</h5>
              <pre class="output-content stdout">{{ selectedResult.stdout }}</pre>
            </div>

            <!-- 错误输出 -->
            <div v-if="selectedResult.stderr" class="output-section">
              <h5>错误输出 (stderr)</h5>
              <pre class="output-content stderr">{{ selectedResult.stderr }}</pre>
            </div>

            <!-- 执行中状态 -->
            <div v-if="selectedResult.status === 'running'" class="running-status">
              <el-icon class="loading-icon"><Loading /></el-icon>
              <span>正在执行中...</span>
            </div>

            <!-- 错误信息 -->
            <div v-if="selectedResult.error" class="error-section">
              <h5>错误信息</h5>
              <pre class="output-content error">{{ selectedResult.error }}</pre>
            </div>
          </div>

          <div v-else class="no-selection">
            <el-icon><Document /></el-icon>
            <p>请从左侧选择服务器查看执行结果</p>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="handleClose">关闭</el-button>
        <el-button type="primary" @click="handleRetry" :disabled="!hasFailedServers">
          重试失败的服务器
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script>
import { defineComponent, ref, computed, watch } from 'vue'
import { Check, Close, Loading, Clock, Document } from '@element-plus/icons-vue'

export default defineComponent({
  name: 'ScriptExecutionDialog',
  components: {
    Check,
    Close,
    Loading,
    Clock,
    Document
  },
  props: {
    visible: {
      type: Boolean,
      default: false
    },
    script: {
      type: Object,
      default: null
    },
    executionResults: {
      type: Array,
      default: () => []
    }
  },
  emits: ['update:visible', 'retry'],
  setup(props, { emit }) {
    const selectedServerIndex = ref(0)

    // 计算属性
    const selectedResult = computed(() => {
      if (props.executionResults.length > 0 && selectedServerIndex.value >= 0) {
        return props.executionResults[selectedServerIndex.value]
      }
      return null
    })

    const successCount = computed(() => {
      return props.executionResults.filter(r => r.status === 'success').length
    })

    const failedCount = computed(() => {
      return props.executionResults.filter(r => r.status === 'failed').length
    })

    const runningCount = computed(() => {
      return props.executionResults.filter(r => r.status === 'running').length
    })

    const hasFailedServers = computed(() => {
      return failedCount.value > 0
    })

    // 方法
    const selectServer = (index) => {
      selectedServerIndex.value = index
    }

    const getStatusText = (status) => {
      const statusMap = {
        success: '成功',
        failed: '失败',
        running: '执行中',
        pending: '等待中'
      }
      return statusMap[status] || '未知'
    }

    const formatTime = (timestamp) => {
      if (!timestamp) return '-'
      return new Date(timestamp).toLocaleString('zh-CN')
    }

    const handleClose = () => {
      emit('update:visible', false)
    }

    const handleRetry = () => {
      const failedServers = props.executionResults
        .filter(r => r.status === 'failed')
        .map(r => r.server)
      
      emit('retry', {
        script: props.script,
        servers: failedServers
      })
    }

    // 监听执行结果变化，自动选择第一个
    watch(() => props.executionResults, (newResults) => {
      if (newResults.length > 0 && selectedServerIndex.value >= newResults.length) {
        selectedServerIndex.value = 0
      }
    }, { immediate: true })

    return {
      selectedServerIndex,
      selectedResult,
      successCount,
      failedCount,
      runningCount,
      hasFailedServers,
      selectServer,
      getStatusText,
      formatTime,
      handleClose,
      handleRetry
    }
  }
})
</script>

<style scoped>
.script-execution-dialog {
  --el-dialog-border-radius: 8px;
}

.script-execution-dialog :deep(.el-dialog) {
  background-color: #2a2a2a;
  border: 1px solid #444;
  max-height: 90vh;
}

.script-execution-dialog :deep(.el-dialog__header) {
  background-color: #2a2a2a;
  border-bottom: 1px solid #444;
  color: #e0e0e0;
}

.script-execution-dialog :deep(.el-dialog__title) {
  color: #e0e0e0;
}

.script-execution-dialog :deep(.el-dialog__body) {
  background-color: #2a2a2a;
  color: #e0e0e0;
  padding: 0;
  height: 70vh;
  overflow: hidden;
}

.execution-content {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.script-header {
  padding: 16px;
  border-bottom: 1px solid #444;
  background-color: #333;
}

.script-header h3 {
  margin: 0 0 8px 0;
  color: #e0e0e0;
  font-size: 16px;
}

.script-command {
  background-color: #444;
  padding: 8px 12px;
  border-radius: 4px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  color: #e0e0e0;
  display: block;
}

.execution-layout {
  flex: 1;
  display: flex;
  min-height: 0;
}

.server-list-panel {
  width: 300px;
  border-right: 1px solid #444;
  display: flex;
  flex-direction: column;
}

.result-detail-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.panel-header {
  padding: 12px 16px;
  border-bottom: 1px solid #444;
  background-color: #333;
}

.panel-header h4 {
  margin: 0 0 8px 0;
  color: #e0e0e0;
  font-size: 14px;
}

.status-summary {
  display: flex;
  gap: 16px;
  font-size: 12px;
}

.success-count {
  color: #67c23a;
}

.failed-count {
  color: #f56c6c;
}

.running-count {
  color: #409eff;
}

.server-items {
  flex: 1;
  overflow-y: auto;
}

.server-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #444;
  cursor: pointer;
  transition: all 0.2s ease;
}

.server-item:hover {
  background-color: #3a3a3a;
}

.server-item.active {
  background-color: #2a4a6b;
  border-left: 3px solid #409eff;
}

.server-item.success {
  border-left: 3px solid #67c23a;
}

.server-item.failed {
  border-left: 3px solid #f56c6c;
}

.server-item.running {
  border-left: 3px solid #409eff;
}

.server-info {
  flex: 1;
}

.server-name {
  font-weight: 500;
  color: #e0e0e0;
  margin-bottom: 4px;
}

.server-host {
  font-size: 12px;
  color: #b0b0b0;
  font-family: 'Consolas', 'Monaco', monospace;
}

.status-icon {
  margin-left: 8px;
}

.success-icon {
  color: #67c23a;
}

.failed-icon {
  color: #f56c6c;
}

.running-icon {
  color: #409eff;
  animation: spin 1s linear infinite;
}

.pending-icon {
  color: #909399;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.result-content {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
}

.result-meta {
  display: flex;
  gap: 24px;
  margin-bottom: 16px;
  padding: 12px;
  background-color: #333;
  border-radius: 4px;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.meta-item .label {
  font-weight: 500;
  color: #b0b0b0;
}

.meta-item .value {
  color: #e0e0e0;
}

.meta-item .value.success {
  color: #67c23a;
}

.meta-item .value.failed {
  color: #f56c6c;
}

.meta-item .value.running {
  color: #409eff;
}

.output-section {
  margin-bottom: 16px;
}

.output-section h5 {
  margin: 0 0 8px 0;
  color: #e0e0e0;
  font-size: 14px;
}

.output-content {
  background-color: #1e1e1e;
  border: 1px solid #444;
  border-radius: 4px;
  padding: 12px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
}

.output-content.stdout {
  color: #e0e0e0;
}

.output-content.stderr {
  color: #f56c6c;
}

.output-content.error {
  color: #f56c6c;
}

.running-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  background-color: #333;
  border-radius: 4px;
  color: #409eff;
}

.loading-icon {
  animation: spin 1s linear infinite;
}

.error-section {
  margin-bottom: 16px;
}

.error-section h5 {
  margin: 0 0 8px 0;
  color: #f56c6c;
  font-size: 14px;
}

.no-selection {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
}

.no-selection .el-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px;
  border-top: 1px solid var(--color-border-default);
  background-color: var(--color-bg-muted);
}

/* Element Plus 组件样式覆盖 */
.script-execution-dialog :deep(.el-button) {
  background-color: var(--color-bg-muted);
  border-color: var(--color-border-default);
  color: var(--color-text-primary);
}

.script-execution-dialog :deep(.el-button:hover) {
  background-color: var(--color-hover-bg);
  border-color: var(--color-border-dark);
}

.script-execution-dialog :deep(.el-button--primary) {
  background-color: var(--color-primary);
  border-color: var(--color-primary);
}

.script-execution-dialog :deep(.el-button--primary:hover) {
  background-color: #66b1ff;
  border-color: #66b1ff;
}

.script-execution-dialog :deep(.el-button:disabled) {
  background-color: #333;
  border-color: #555;
  color: #666;
}
</style>
