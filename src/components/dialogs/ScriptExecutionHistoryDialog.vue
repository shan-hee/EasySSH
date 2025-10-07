<template>
  <el-dialog
    :model-value="visible"
    title="脚本执行历史"
    width="90%"
    :close-on-click-modal="false"
    class="script-execution-history-dialog"
    top="6vh"
    :destroy-on-close="true"
    @update:model-value="$emit('update:visible', $event)"
    @closed="onClosed"
  >
    <div class="toolbar history-card">
      <div class="filters">
        <el-select
          v-model="selectedConnectionId"
          filterable
          clearable
          placeholder="按服务器筛选"
          class="conn-filter"
          :teleported="false"
          :popper-options="{ strategy: 'fixed' }"
          @change="reload"
        >
          <el-option :value="''" label="全部服务器" />
          <el-option
            v-for="conn in connections"
            :key="conn.id"
            :label="conn.name"
            :value="conn.id"
          />
        </el-select>

        <button class="btn btn-secondary" :disabled="loading" @click="reload">
          刷新
        </button>
      </div>
      <div class="meta">
        <span>共 {{ total }} 条</span>
      </div>
    </div>

    <div class="history-card">
      <table v-if="visible" class="scripts-table">
        <thead>
          <tr>
            <th class="time-col">时间</th>
            <th class="server-col">服务器</th>
            <th class="host-col">主机</th>
            <th class="code-col">退出码</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(row, idx) in history" :key="row.id || idx">
            <tr class="script-row" @click="toggleExpand(idx)">
              <td class="mono">
                <span class="expander" :class="{ open: isExpanded(idx) }"></span>
                {{ formatTime(row.executed_at) }}
              </td>
              <td>{{ row.server_name }}</td>
              <td><span class="mono">{{ row.username }}@{{ row.host }}:{{ row.port }}</span></td>
              <td>
                <span class="tag" :class="row.exit_code === 0 ? 'tag-success' : 'tag-danger'">
                  {{ row.exit_code === undefined || row.exit_code === null ? '-' : row.exit_code }}
                </span>
              </td>
            </tr>
            <tr class="expand-row">
              <td colspan="4">
                <div class="expand-content" v-show="isExpanded(idx)">
                  <div class="detail">
                    <div class="meta-row">
                      <span>命令：</span>
                      <code class="mono">{{ row.command }}</code>
                    </div>
                    <div class="output" v-if="row.stdout">
                      <h5>stdout</h5>
                      <pre>{{ row.stdout }}</pre>
                    </div>
                    <div class="output error" v-if="row.stderr">
                      <h5>stderr</h5>
                      <pre>{{ row.stderr }}</pre>
                    </div>
                  </div>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <div class="pagination-container">
      <div class="custom-pagination">
        <!-- 总数显示 -->
        <span class="pagination-total">共 <span class="tabular-nums">{{ total }}</span> 条</span>

        <!-- 每页显示数量选择器 -->
        <div class="page-size-selector">
          <span class="page-size-label">每页</span>
          <el-select
            v-model="limit"
            class="page-size-select"
            filterable
            allow-create
            default-first-option
            placeholder="请选择或输入"
            placement="bottom-start"
            :fallback-placements="['top-start','bottom-start','top-end']"
            :popper-options="{
              strategy: 'fixed',
              modifiers: [
                {
                  name: 'flip',
                  options: {
                    fallbackPlacements: ['top-start','bottom-start','top-end'],
                    boundary: 'clippingParents',
                    padding: 8
                  }
                },
                {
                  name: 'preventOverflow',
                  options: { boundary: 'clippingParents', altBoundary: true, tether: true, padding: 8 }
                }
              ]
            }"
            :teleported="false"
            @change="handlePageSizeChange"
          >
            <el-option
              v-for="size in pageSizeOptions"
              :key="size"
              :label="`${size}`"
              :value="size"
            />
          </el-select>
          <span class="page-size-label">条</span>
        </div>

        <!-- 分页导航 -->
        <el-pagination
          v-model:current-page="page"
          :total="total"
          :page-size="limit"
          layout="prev, pager, next, jumper"
          background
          :hide-on-single-page="false"
          @current-change="handlePageChange"
        />
      </div>
    </div>
  </el-dialog>
</template>

<script>
import { defineComponent, ref, watch, onMounted, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { useUserStore } from '@/store/user';
import apiService from '@/services/api';
import log from '@/services/log';

export default defineComponent({
  name: 'ScriptExecutionHistoryDialog',
  props: {
    visible: { type: Boolean, default: false },
    script: { type: Object, default: null }
  },
  emits: ['update:visible'],
  setup(props) {
    const userStore = useUserStore();
    const connections = computed(() => userStore.connections || []);

    const loading = ref(false);
    const history = ref([]);
    const total = ref(0);
    const page = ref(1);
    const limit = ref(20);
    const selectedConnectionId = ref('');
    const pageSizeOptions = ref([10, 15, 20, 30, 50, 100]);

    const fetchConnectionsIfNeeded = async () => {
      try {
        if (userStore.isLoggedIn) {
          await userStore.ensureConnectionsData?.();
        }
      } catch (e) {
        log.warn('加载连接列表失败（忽略）', e);
      }
    };

    const fetchHistory = async () => {
      try {
        loading.value = true;
        const params = {
          page: page.value,
          limit: limit.value
        };
        if (selectedConnectionId.value) params.connectionId = selectedConnectionId.value;
        if (props.script?.id) params.scriptId = props.script.id;

        const resp = await apiService.get('/scripts/executions', params);
        if (resp && resp.success) {
          history.value = Array.isArray(resp.history) ? resp.history : [];
          total.value = resp.pagination && resp.pagination.total != null
            ? resp.pagination.total
            : history.value.length;
        } else {
          history.value = [];
          total.value = 0;
        }
      } catch (error) {
        log.error('获取执行历史失败', error);
        history.value = [];
        total.value = 0;
      } finally {
        loading.value = false;
      }
    };

    // 行展开（原生表格）
    const expanded = ref(new Set());
    const isExpanded = (idx) => expanded.value.has(idx);
    const toggleExpand = (idx) => {
      const next = new Set(expanded.value);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      expanded.value = next;
    };

    const reload = () => {
      page.value = 1;
      expanded.value = new Set();
      fetchHistory();
    };

    const handlePageChange = (p) => {
      page.value = p;
      fetchHistory();
    };
    // 每页条数选项
    // 注意：避免重复声明，统一在此处维护
    pageSizeOptions.value = [10, 15, 20, 30, 50, 100];

    const handlePageSizeChange = size => {
      // 验证输入值
      let validSize = parseInt(size);
      let showMessage = false;
      const originalInput = size;

      // 确保是有效数字
      if (isNaN(validSize) || validSize < 1) {
        validSize = 20; // 默认值
        if (originalInput !== '' && originalInput !== null && originalInput !== undefined) {
          ElMessage.warning('请输入有效的数字，已重置为默认值20');
          showMessage = true;
        }
      }

      // 限制最大值
      if (validSize > 1000) {
        validSize = 1000;
        ElMessage.warning('每页最多显示1000条数据，已调整为1000');
        showMessage = true;
      }

      // 限制最小值
      if (validSize < 1) {
        validSize = 1;
        ElMessage.warning('每页至少显示1条数据，已调整为1');
        showMessage = true;
      }

      // 如果输入的值被调整了，给出提示
      if (!showMessage && parseInt(originalInput) !== validSize && originalInput !== validSize) {
        ElMessage.info(`已调整为 ${validSize} 条每页`);
      }

      limit.value = validSize;
      page.value = 1; // 重置到第一页

      // 如果用户输入了新的值，添加到选项中
      if (!pageSizeOptions.value.includes(validSize) && validSize <= 100) {
        pageSizeOptions.value.push(validSize);
        pageSizeOptions.value.sort((a, b) => a - b);
      }

      fetchHistory();
    };

    const formatTime = (iso) => {
      try {
        return new Date(iso).toLocaleString();
      } catch (e) {
        return iso || '';
      }
    };

    watch(
      () => props.visible,
      async (v) => {
        if (v) {
          await fetchConnectionsIfNeeded();
          await fetchHistory();
        }
      }
    );

    onMounted(async () => {
      if (props.visible) {
        await fetchConnectionsIfNeeded();
        await fetchHistory();
      }
    });

    const onClosed = () => {
      // 关闭后卸载内部内容已由 destroy-on-close 处理
      // 这里重置可能的瞬时状态，避免下次打开触发 ResizeObserver 循环
      loading.value = false;
      expanded.value = new Set();
    };

    return {
      connections,
      loading,
      history,
      total,
      page,
      limit,
      pageSizeOptions,
      selectedConnectionId,
      reload,
      handlePageChange,
      handlePageSizeChange,
      formatTime,
      isExpanded,
      toggleExpand,
      onClosed
    };
  }
});
</script>

<style scoped>
.script-execution-history-dialog {
  /* 更好地适配中文字体（如安泽书体） */
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.filters {
  display: flex;
  gap: 12px;
  align-items: center;
}
.conn-filter { width: 260px; }
.meta { color: var(--color-text-secondary, #909399); }

/* Dialog 头部/主体与主题令牌对齐 */
.script-execution-history-dialog :deep(.el-dialog__header) {
  background: var(--color-bg-container, #1f1f1f);
  border-bottom: 1px solid var(--color-border-default, #2a2a2a);
  padding: 12px 16px;
}
.script-execution-history-dialog :deep(.el-dialog__title) {
  color: var(--color-text-primary, #e5e7eb);
  font-weight: 600;
}
.script-execution-history-dialog :deep(.el-dialog__body) {
  background: var(--color-bg-container, #1f1f1f);
  padding-top: 12px;
}

.history-card {
  background: var(--color-bg-container);
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  padding: 8px 12px;
}

/* Select 外观与主题色一致 */
.script-execution-history-dialog :deep(.el-select .el-input__wrapper) {
  background: var(--color-bg-muted, #2a2a2a);
  border-color: var(--color-border-default, #2a2a2a);
  box-shadow: none;
}
.script-execution-history-dialog :deep(.el-select:hover .el-input__wrapper) {
  border-color: var(--color-border-light, #3a3a3a);
}
.script-execution-history-dialog :deep(.el-select .el-input__inner::placeholder) {
  color: var(--color-text-secondary, #909399);
}

/* Table 主题化 */
.history-table { border-radius: 6px; overflow: hidden; }
.history-table :deep(.el-table) {
  background: var(--color-bg-container, #1f1f1f);
  color: var(--color-text-primary, #e5e7eb);
  border: none;
  border-radius: 6px;
  /* 映射 Element Plus 表格变量到系统主题令牌 */
  --el-table-header-bg-color: var(--color-bg-muted, #2a2a2a);
  --el-table-header-text-color: var(--color-text-secondary, #b3b6bd);
  --el-table-text-color: var(--color-text-primary, #e5e7eb);
  --el-table-border-color: var(--color-border-default, #2a2a2a);
  --el-table-tr-bg-color: var(--color-bg-container, #1f1f1f);
  --el-table-expanded-cell-bg-color: var(--color-bg-subtle, #252525);
  --el-table-row-hover-bg-color: var(--color-hover-bg);
  --el-table-current-row-bg-color: var(--color-active-bg);
}
.history-table :deep(.el-table__header th) {
  background: var(--color-bg-muted, #2a2a2a);
  color: var(--color-text-secondary, #b3b6bd);
  font-weight: 500;
  border-bottom: 1px solid var(--color-border-default, #2a2a2a);
  padding: 10px 12px;
}
.history-table :deep(.el-table__row td) {
  background: var(--color-bg-container, #1f1f1f);
  border-bottom: 1px solid var(--color-border-default, #2a2a2a);
  padding: 10px 12px;
}
.history-table :deep(.el-table__cell) {
  background: inherit;
}
.history-table :deep(.el-table__row--striped > td) {
  background: var(--color-bg-container, #1f1f1f) !important;
}
.history-table :deep(.el-table__row:hover > td),
.history-table :deep(.el-table__body tr.hover-row > td) {
  background: var(--color-hover-bg) !important;
}
.history-table :deep(.el-table__row.current-row > td),
.history-table :deep(.el-table__body tr.current-row > td) {
  background: var(--color-active-bg) !important;
}
.history-table :deep(.el-table--striped .el-table__body tr.el-table__row--striped td) {
  background: var(--color-bg-subtle, #252525);
}
.history-table :deep(.cell) {
  font-size: 14px; /* 与脚本库单元格字号一致 */
  line-height: 1.45;
}
.history-table :deep(.el-table__expanded-cell) {
  background: var(--color-bg-subtle, #252525);
}

/* Tag 成功/失败配色更柔和 */
.history-table :deep(.el-tag) {
  border: 1px solid var(--color-border-default, #2a2a2a);
}
.history-table :deep(.el-tag.el-tag--success) {
  color: var(--color-success, #67c23a);
  background-color: color-mix(in srgb, var(--color-success, #67c23a) 12%, transparent);
  border-color: color-mix(in srgb, var(--color-success, #67c23a) 30%, transparent);
}
.history-table :deep(.el-tag.el-tag--danger) {
  color: var(--color-error, #f56c6c);
  background-color: color-mix(in srgb, var(--color-error, #f56c6c) 12%, transparent);
  border-color: color-mix(in srgb, var(--color-error, #f56c6c) 30%, transparent);
}

/* 原生表格样式（与脚本库保持一致） */
.scripts-table {
  width: 100%;
  border-collapse: collapse;
  color: var(--color-text-primary);
  table-layout: fixed;
}
.scripts-table th {
  text-align: left;
  padding: 12px;
  background-color: var(--color-bg-muted);
  border-bottom: 2px solid var(--color-border-default);
  font-weight: 500;
  font-size: 14px;
}
.scripts-table td {
  padding: 12px;
  border-bottom: 1px solid var(--color-border-default);
  vertical-align: middle;
  background: var(--color-bg-container);
}
.script-row:hover td {
  background-color: var(--color-hover-bg);
}
.expand-row td {
  background: transparent;
  padding: 0;
  border-bottom: none;
}
.expander {
  display: inline-block;
  width: 0; height: 0;
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
  border-left: 6px solid var(--color-text-secondary);
  margin-right: 8px;
  transition: transform var(--transition-base);
}
.expander.open { transform: rotate(90deg); }

/* 展开动画容器 */
.expand-content {
  overflow: hidden;
  border-top: 1px solid var(--color-border-default);
  background: var(--color-bg-subtle);
  padding: 8px 12px;
}

/* 移除展开动画：保持即时展开/收起 */

/* 原生标签 */
.tag {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 12px;
  border: 1px solid var(--color-border-default);
}
.tag-success {
  color: var(--color-success);
  background-color: color-mix(in srgb, var(--color-success) 12%, transparent);
  border-color: color-mix(in srgb, var(--color-success) 30%, transparent);
}
.tag-danger {
  color: var(--color-error);
  background-color: color-mix(in srgb, var(--color-error) 12%, transparent);
  border-color: color-mix(in srgb, var(--color-error) 30%, transparent);
}

.mono { font-family: var(--font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace); }
.detail { padding: 8px 12px; }
.detail .meta-row { margin-bottom: 8px; }
.output { margin-top: 8px; }
.output h5 { margin: 0 0 6px; font-size: 13px; }
.output pre {
  margin: 0; padding: 8px; border: 1px solid var(--color-border-default);
  background: var(--color-bg-subtle); max-height: 200px; overflow: auto;
}
.output.error pre { border-color: var(--color-error-border, #f56c6c); }

/* 分页容器样式 - 与脚本库保持一致 */
.pagination-container {
  margin-top: 8px;
  display: flex;
  justify-content: center;
  padding: 12px 0;
  border-top: 1px solid var(--color-border-default);
  flex-shrink: 0;
  background-color: var(--color-bg-container);
}

.custom-pagination {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  justify-content: center;
}

.pagination-total {
  color: var(--color-text-secondary);
  font-size: 14px;
  white-space: nowrap;
}

.tabular-nums {
  font-variant-numeric: tabular-nums;
}

.page-size-selector {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}

.page-size-label {
  color: var(--color-text-secondary);
  font-size: 14px;
}

.page-size-select {
  width: 120px;
  min-width: 100px;
}

/* 使用系统主题令牌统一分页与选择器的外观 */
.custom-pagination :deep(.el-pagination.is-background .el-pager li),
.custom-pagination :deep(.el-pagination.is-background .btn-prev),
.custom-pagination :deep(.el-pagination.is-background .btn-next) {
  background-color: var(--color-bg-container);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-default);
  border-radius: 4px;
  transition: all var(--theme-transition-duration) var(--theme-transition-timing);
}

.custom-pagination :deep(.el-pagination.is-background .el-pager li:hover),
.custom-pagination :deep(.el-pagination.is-background .btn-prev:hover),
.custom-pagination :deep(.el-pagination.is-background .btn-next:hover) {
  background-color: var(--color-hover-bg);
  border-color: var(--color-border-dark);
  color: var(--color-text-primary);
}

.custom-pagination :deep(.el-pagination.is-background .el-pager li.is-active) {
  background-color: var(--color-primary);
  border-color: var(--color-primary);
  color: var(--color-bg-container);
}

.custom-pagination :deep(.el-pagination .el-pagination__editor .el-input__wrapper) {
  background-color: var(--color-bg-muted);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-default);
  border-radius: 4px;
  box-shadow: none;
}

.custom-pagination :deep(.el-pagination .el-pagination__editor .el-input__wrapper:hover),
.custom-pagination :deep(.el-pagination .el-pagination__editor .el-input__wrapper.is-focus) {
  border-color: var(--color-primary);
  box-shadow: none;
}

.custom-pagination :deep(.el-pagination .el-input__inner::placeholder) {
  color: var(--color-text-placeholder);
}

/* 每页选择器样式 */
.page-size-select :deep(.el-select__wrapper) {
  background-color: transparent;
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  min-height: 36px;
  padding: 0 10px;
  transition: border-color 0.3s;
  box-shadow: none;
}

.page-size-select :deep(.el-select__wrapper:hover),
.page-size-select :deep(.el-select__wrapper.is-focused) {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 1px var(--color-focus-ring);
}

.page-size-select :deep(.el-select__placeholder) {
  color: var(--color-text-placeholder);
}

.page-size-select :deep(.el-input__inner) {
  color: var(--color-text-primary);
  text-align: center;
}

.page-size-select :deep(.el-select__caret) {
  color: var(--color-text-secondary);
}

.page-size-select :deep(.el-select__caret:hover) {
  color: var(--color-primary);
}

/* 下拉选项样式 */
.script-execution-history-dialog :deep(.el-select__popper .el-select-dropdown) {
  background-color: var(--color-bg-container);
  border: 1px solid var(--color-border-default);
  max-height: min(40vh, 260px);
  overflow: auto;
}

.script-execution-history-dialog :deep(.el-select-dropdown__item) {
  color: var(--color-text-primary);
  background-color: var(--color-bg-container);
}

.script-execution-history-dialog :deep(.el-select-dropdown__item:hover) {
  background-color: var(--color-hover-bg);
  color: var(--color-primary);
}

.script-execution-history-dialog :deep(.el-select-dropdown__item.is-selected) {
  background-color: var(--color-primary);
  color: var(--color-bg-container);
}

/* Pagination 贴合主题 */
.script-execution-history-dialog :deep(.el-pagination) {
  --el-pagination-bg-color: var(--color-bg-container, #1f1f1f);
  --el-pagination-button-bg-color: var(--color-bg-muted, #2a2a2a);
  --el-pagination-button-color: var(--color-text-primary, #e5e7eb);
  --el-pagination-hover-color: var(--color-text-primary);
}
.script-execution-history-dialog :deep(.el-pagination .btn-prev, .el-pagination .btn-next, .el-pagination .el-pager li) {
  background: var(--color-bg-muted, #2a2a2a);
  border: 1px solid var(--color-border-default, #2a2a2a);
  min-width: 28px;
  height: 28px;
  line-height: 28px;
  border-radius: 6px;
}
.script-execution-history-dialog :deep(.el-pagination .el-pager li.is-active) {
  background: var(--color-primary, #aaaaaa) !important;
  border-color: var(--color-primary, #aaaaaa) !important;
  color: var(--btn-primary-text, #1a1a1a) !important;
}
.script-execution-history-dialog :deep(.el-pagination .el-pager li:hover) {
  color: var(--color-text-primary) !important;
  background: var(--color-hover-bg) !important;
}

/* 自定义滚动条以适配主题 */
.script-execution-history-dialog :deep(.el-table__body-wrapper::-webkit-scrollbar) { height: 8px; width: 8px; }
.script-execution-history-dialog :deep(.el-table__body-wrapper::-webkit-scrollbar-thumb) {
  background: var(--color-border-default, #2a2a2a);
  border-radius: 4px;
}
.script-execution-history-dialog :deep(.el-table__body-wrapper::-webkit-scrollbar-track) {
  background: transparent;
}
</style>
