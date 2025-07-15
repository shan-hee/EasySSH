<template>
  <div class="sftp-toolbar">
    <button class="sftp-toolbar-button" @click="$emit('new-folder')">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
        <path fill="currentColor" d="M20,6H12L10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6M20,18H4V8H20V18M13,11H16V14H13V17H11V14H8V11H11V8H13V11Z" />
      </svg>
      <span class="sftp-file-action-button-label">新建文件夹</span>
    </button>
    <button class="sftp-toolbar-button" @click="$emit('new-file')">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
        <path fill="currentColor" d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z" />
      </svg>
      <span class="sftp-file-action-button-label">新建文件</span>
    </button>
    <button class="sftp-toolbar-button" @click="$emit('upload')">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
        <path fill="currentColor" d="M9,16V10H5L12,3L19,10H15V16H9M5,20V18H19V20H5Z" />
      </svg>
      <span class="sftp-file-action-button-label">上传文件</span>
    </button>
    <button class="sftp-toolbar-button" @click="$emit('upload-folder')">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
        <path fill="currentColor" d="M20,6H12L10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6M19,14L16,11V13H13V11L10,14L13,17V15H16V17L19,14Z" />
      </svg>
      <span class="sftp-file-action-button-label">上传文件夹</span>
    </button>
    
    <div style="flex: 1"></div>
    
    <div class="sftp-search-box">
      <input 
        type="text" 
        v-model="searchQuery" 
        @input="handleSearch"
        @keyup.enter="handleSearch"
        class="sftp-search-input" 
        placeholder="搜索文件..." 
      />
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" class="sftp-search-icon">
        <path fill="currentColor" d="M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z" />
      </svg>
      <button 
        v-if="searchQuery" 
        @click="clearSearch" 
        class="sftp-search-clear"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
          <path fill="currentColor" d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script>
import { defineComponent, ref } from 'vue'

export default defineComponent({
  name: 'SftpToolbar',
  emits: ['refresh', 'upload', 'upload-folder', 'new-folder', 'new-file', 'search', 'toggle-hidden-files'],
  setup(props, { emit }) {
    const searchQuery = ref('')
    const searchTimeout = ref(null)
    
    const handleSearch = () => {
      // 清除之前的定时器
      if (searchTimeout.value) {
        clearTimeout(searchTimeout.value)
      }
      
      // 设置新的定时器，延迟300ms执行搜索
      searchTimeout.value = setTimeout(() => {
        console.log('执行搜索:', searchQuery.value)
        emit('search', searchQuery.value)
        searchTimeout.value = null
      }, 300)
    }
    
    const clearSearch = () => {
      searchQuery.value = '';
      // 立即清除定时器并执行搜索
      if (searchTimeout.value) {
        clearTimeout(searchTimeout.value)
        searchTimeout.value = null
      }
      emit('search', '');
    }
    
    return {
      searchQuery,
      handleSearch,
      clearSearch
    }
  }
})
</script>

<style scoped>
.sftp-toolbar {
  display: flex;
  flex-wrap: wrap; /* 允许按钮在窄屏幕上换行 */
  gap: 8px;
  margin-bottom: 16px;
  width: 100%;
  align-items: center;
}

.sftp-toolbar-button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  height: 32px;
  background-color: var(--color-bg-container);
  border: none;
  border-radius: 4px;
  color: var(--color-text-primary);
  font-size: 12px;
  cursor: pointer;
  flex-grow: 0;
  white-space: nowrap;
}

.sftp-toolbar-button:hover {
  background-color: var(--color-bg-hover);
}

.sftp-search-box {
  position: relative;
  flex: 1;
  max-width: 240px;
  min-width: 120px;
}

.sftp-search-input {
  width: 100%;
  height: 32px;
  background-color: var(--color-bg-container);
  border: 1px solid var(--color-border-default);
  border-radius: 4px;
  color: var(--color-text-primary);
  font-size: 12px;
  padding: 0 32px 0 36px;
  outline: none;
}

.sftp-search-input:focus {
  background-color: var(--color-bg-hover);
  border: 1px solid var(--color-primary);
}

.sftp-search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-text-secondary);
}

.sftp-search-clear {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  width: 24px;
  height: 24px;
  border-radius: 50%;
}

.sftp-search-clear:hover {
  background-color: var(--color-bg-hover);
}

@media (max-width: 450px) {
  .sftp-file-action-button-label {
    display: none;
  }

  .sftp-toolbar-button {
    padding: 0 8px;
    justify-content: center;
  }

  .sftp-search-box {
    max-width: 160px;
  }
}

/* 深色主题特定样式 */
:root[data-theme="dark"] .sftp-toolbar-button,
.dark-theme .sftp-toolbar-button,
html[data-theme="dark"] .sftp-toolbar-button {
  background-color: #2c2c2c !important;
  color: #e0e0e0 !important;
}

:root[data-theme="dark"] .sftp-toolbar-button:hover,
.dark-theme .sftp-toolbar-button:hover,
html[data-theme="dark"] .sftp-toolbar-button:hover {
  background-color: #3c3c3c !important;
}

:root[data-theme="dark"] .sftp-search-input,
.dark-theme .sftp-search-input,
html[data-theme="dark"] .sftp-search-input {
  background-color: #2c2c2c !important;
  color: #e0e0e0 !important;
  border: 1px solid #333333 !important;
}

:root[data-theme="dark"] .sftp-search-input:focus,
.dark-theme .sftp-search-input:focus,
html[data-theme="dark"] .sftp-search-input:focus {
  background-color: #3a3a3a !important;
  border: 1px solid var(--color-primary) !important;
}

:root[data-theme="dark"] .sftp-search-icon,
.dark-theme .sftp-search-icon,
html[data-theme="dark"] .sftp-search-icon {
  color: #aaa !important;
}

:root[data-theme="dark"] .sftp-search-clear,
.dark-theme .sftp-search-clear,
html[data-theme="dark"] .sftp-search-clear {
  color: #aaa !important;
}

:root[data-theme="dark"] .sftp-search-clear:hover,
.dark-theme .sftp-search-clear:hover,
html[data-theme="dark"] .sftp-search-clear:hover {
  background-color: rgba(255, 255, 255, 0.1) !important;
}

/* 浅色主题特定样式 */
:root[data-theme="light"] .sftp-toolbar-button,
.light-theme .sftp-toolbar-button,
html[data-theme="light"] .sftp-toolbar-button {
  background-color: #ffffff !important;
  color: #303133 !important;
  border: 1px solid #dcdfe6 !important;
}

:root[data-theme="light"] .sftp-toolbar-button:hover,
.light-theme .sftp-toolbar-button:hover,
html[data-theme="light"] .sftp-toolbar-button:hover {
  background-color: #f5f7fa !important;
}

:root[data-theme="light"] .sftp-search-input,
.light-theme .sftp-search-input,
html[data-theme="light"] .sftp-search-input {
  background-color: #ffffff !important;
  color: #303133 !important;
  border: 1px solid #dcdfe6 !important;
}

:root[data-theme="light"] .sftp-search-input:focus,
.light-theme .sftp-search-input:focus,
html[data-theme="light"] .sftp-search-input:focus {
  background-color: #ffffff !important;
  border-color: var(--color-primary) !important;
}

:root[data-theme="light"] .sftp-search-icon,
.light-theme .sftp-search-icon,
html[data-theme="light"] .sftp-search-icon {
  color: #909399 !important;
}

:root[data-theme="light"] .sftp-search-clear,
.light-theme .sftp-search-clear,
html[data-theme="light"] .sftp-search-clear {
  color: #909399 !important;
}

:root[data-theme="light"] .sftp-search-clear:hover,
.light-theme .sftp-search-clear:hover,
html[data-theme="light"] .sftp-search-clear:hover {
  background-color: #f5f7fa !important;
}
</style>