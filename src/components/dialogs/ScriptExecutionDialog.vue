<template>
  <el-dialog
    :model-value="visible"
    title="脚本执行结果"
    width="90%"
    :close-on-click-modal="false"
    class="script-execution-dialog"
    top="5vh"
    @update:model-value="$emit('update:visible', $event)"
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
              <span v-if="runningCount > 0" class="running-count">执行中: {{ runningCount }}</span>
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
                <div class="server-name">
                  {{ result.server.name }}
                </div>
                <div class="server-host">
                  {{ result.server.username }}@{{ result.server.host }}:{{ result.server.port }}
                </div>
              </div>
              <div class="status-icon">
                <el-icon v-if="result.status === 'success'" class="success-icon">
                  <check />
                </el-icon>
                <el-icon v-else-if="result.status === 'failed'" class="failed-icon">
                  <close />
                </el-icon>
                <el-icon v-else-if="result.status === 'running'" class="running-icon">
                  <loading />
                </el-icon>
                <el-icon v-else class="pending-icon">
                  <clock />
                </el-icon>
              </div>
            </div>
          </div>
        </div>

        <!-- 右侧：执行结果详情 -->
        <div class="result-detail-panel">
          <div class="panel-header">
            <h4 v-if="selectedResult">{{ selectedResult.server.name }} - 执行结果</h4>
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
              <div v-if="selectedResult.executedAt" class="meta-item">
                <span class="label">执行时间:</span>
                <span class="value">{{ formatTime(selectedResult.executedAt) }}</span>
              </div>
              <div v-if="selectedResult.duration" class="meta-item">
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
              <el-icon class="loading-icon">
                <loading />
              </el-icon>
              <span>正在执行中...</span>
            </div>

            <!-- 错误信息 -->
            <div v-if="selectedResult.error" class="error-section">
              <h5>错误信息</h5>
              <pre class="output-content error">{{ selectedResult.error }}</pre>
            </div>
          </div>

          <div v-else class="no-selection">
            <el-icon><document /></el-icon>
            <p>请从左侧选择服务器查看执行结果</p>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="handleClose"> 关闭 </el-button>
        <el-button type="primary" :disabled="!hasFailedServers" @click="handleRetry">
          重试失败的服务器
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script>
import { defineComponent, ref, computed, watch } from 'vue';
import { Check, Close, Loading, Clock, Document } from '@element-plus/icons-vue';

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
    const selectedServerIndex = ref(0);

    // 计算属性
    const selectedResult = computed(() => {
      if (props.executionResults.length > 0 && selectedServerIndex.value >= 0) {
        return props.executionResults[selectedServerIndex.value];
      }
      return null;
    });

    const successCount = computed(() => {
      return props.executionResults.filter(r => r.status === 'success').length;
    });

    const failedCount = computed(() => {
      return props.executionResults.filter(r => r.status === 'failed').length;
    });

    const runningCount = computed(() => {
      return props.executionResults.filter(r => r.status === 'running').length;
    });

    const hasFailedServers = computed(() => {
      return failedCount.value > 0;
    });

    // 方法
    const selectServer = index => {
      selectedServerIndex.value = index;
    };

    const getStatusText = status => {
      const statusMap = {
        success: '成功',
        failed: '失败',
        running: '执行中',
        pending: '等待中'
      };
      return statusMap[status] || '未知';
    };

    const formatTime = timestamp => {
      if (!timestamp) return '-';
      return new Date(timestamp).toLocaleString('zh-CN');
    };

    const handleClose = () => {
      emit('update:visible', false);
    };

    const handleRetry = () => {
      const failedServers = props.executionResults
        .filter(r => r.status === 'failed')
        .map(r => r.server);

      emit('retry', {
        script: props.script,
        servers: failedServers
      });
    };

    // 监听执行结果变化，自动选择第一个
    watch(
      () => props.executionResults,
      newResults => {
        if (newResults.length > 0 && selectedServerIndex.value >= newResults.length) {
          selectedServerIndex.value = 0;
        }
      },
      { immediate: true }
    );

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
    };
  }
});
</script>

<style scoped>
.script-execution-dialog {
  --el-dialog-border-radius: 8px;
}

.script-execution-dialog :deep(.el-dialog) {
  background-color: var(--dialog-bg);
  border: 1px solid var(--dialog-border);
  max-height: 90vh;
}

.script-execution-dialog :deep(.el-dialog__header) {
  background-color: var(--dialog-header-bg);
  border-bottom: 1px solid var(--dialog-border);
  color: var(--dialog-title-color);
}

.script-execution-dialog :deep(.el-dialog__title) {
  color: var(--dialog-title-color);
}

.script-execution-dialog :deep(.el-dialog__body) {
  background-color: var(--dialog-bg);
  color: var(--color-text-primary);
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
  border-bottom: 1px solid var(--color-border-default);
  background-color: var(--color-bg-muted);
}

.script-header h3 {
  margin: 0 0 8px 0;
  color: var(--color-text-primary);
  font-size: 16px;
}

.script-command {
  background-color: var(--color-bg-muted);
  padding: 8px 12px;
  border-radius: 4px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  color: var(--color-text-primary);
  display: block;
}

.execution-layout {
  flex: 1;
  display: flex;
  min-height: 0;
}

.server-list-panel {
  width: 300px;
  border-right: 1px solid var(--color-border-default);
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
  border-bottom: 1px solid var(--color-border-default);
  background-color: var(--color-bg-muted);
}

.panel-header h4 {
  margin: 0 0 8px 0;
  color: var(--color-text-primary);
  font-size: 14px;
}

.status-summary {
  display: flex;
  gap: 16px;
  font-size: 12px;
}

.success-count {
  color: var(--color-success);
}

.failed-count {
  color: var(--color-error);
}

.running-count {
  color: var(--color-info);
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
  border-bottom: 1px solid var(--color-border-default);
  cursor: pointer;
  transition: all var(--theme-transition-duration) var(--theme-transition-timing);
}

.server-item:hover {
  background-color: var(--color-hover-bg);
}

.server-item.active {
  background-color: var(--color-selected-bg);
  border-left: 3px solid var(--color-info);
}

.server-item.success {
  border-left: 3px solid var(--color-success);
}

.server-item.failed {
  border-left: 3px solid var(--color-error);
}

.server-item.running {
  border-left: 3px solid var(--color-info);
}

.server-info {
  flex: 1;
}

.server-name {
  font-weight: 500;
  color: var(--color-text-primary);
  margin-bottom: 4px;
}

.server-host {
  font-size: 12px;
  color: var(--color-text-secondary);
  font-family: 'Consolas', 'Monaco', monospace;
}

.status-icon {
  margin-left: 8px;
}

.success-icon {
  color: var(--color-success);
}

.failed-icon {
  color: var(--color-error);
}

.running-icon {
  color: var(--color-info);
  animation: spin 1s linear infinite;
}

.pending-icon {
  color: var(--color-text-secondary);
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
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
  background-color: var(--color-bg-muted);
  border-radius: 4px;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.meta-item .label {
  font-weight: 500;
  color: var(--color-text-secondary);
}

.meta-item .value {
  color: var(--color-text-primary);
}

.meta-item .value.success {
  color: var(--color-success);
}

.meta-item .value.failed {
  color: var(--color-error);
}

.meta-item .value.running {
  color: var(--color-info);
}

.output-section {
  margin-bottom: 16px;
}

.output-section h5 {
  margin: 0 0 8px 0;
  color: var(--color-text-primary);
  font-size: 14px;
}

.output-content {
  background-color: var(--color-bg-subtle);
  border: 1px solid var(--color-border-default);
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
  color: var(--color-text-primary);
}

.output-content.stderr {
  color: var(--color-error);
}

.output-content.error {
  color: var(--color-error);
}

.running-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  background-color: var(--color-bg-muted);
  border-radius: 4px;
  color: var(--color-info);
}

.loading-icon {
  animation: spin 1s linear infinite;
}

.error-section {
  margin-bottom: 16px;
}

.error-section h5 {
  margin: 0 0 8px 0;
  color: var(--color-error);
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
  background-color: var(--btn-primary-bg);
  border-color: var(--btn-primary-bg);
  color: var(--btn-primary-text);
}

.script-execution-dialog :deep(.el-button--primary:hover) {
  background-color: var(--btn-primary-hover-bg);
  border-color: var(--btn-primary-hover-bg);
}

.script-execution-dialog :deep(.el-button--primary:hover) {
  background-color: var(--color-primary-hover);
  border-color: var(--color-primary-hover);
}

.script-execution-dialog :deep(.el-button:disabled) {
  background-color: var(--btn-disabled-bg);
  border-color: var(--color-border-default);
  color: var(--btn-disabled-color);
}
</style>
