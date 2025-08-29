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
  transition: 
    background-color var(--theme-transition-duration) var(--theme-transition-timing),
    border-color var(--theme-transition-duration) var(--theme-transition-timing);
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

/* 深色主题样式已迁移到主题变量 */

/* 使用主题变量替代主题特定样式 */
.sftp-search-input:focus {
  background-color: var(--sftp-search-input-focus-bg);
  border: 1px solid var(--sftp-search-input-focus-border);
}

.sftp-search-icon {
  color: var(--sftp-search-icon-color) !important;
}

.sftp-search-clear {
  color: var(--sftp-search-clear-color) !important;
}

.sftp-search-clear:hover {
  background-color: var(--sftp-search-clear-hover-bg) !important;
}

/* 使用主题变量替代主题特定样式 */
.sftp-toolbar-button {
  background-color: var(--sftp-toolbar-button-bg) !important;
  color: var(--sftp-toolbar-button-color) !important;
  border: 1px solid var(--sftp-toolbar-button-border) !important;
}

.sftp-toolbar-button:hover {
  background-color: var(--sftp-toolbar-button-hover-bg) !important;
}

.sftp-search-input {
  background-color: var(--sftp-search-input-bg);
  color: var(--sftp-search-input-color);
  border: 1px solid var(--sftp-search-input-border);
  transition: 
    background-color var(--theme-transition-duration) var(--theme-transition-timing),
    border-color var(--theme-transition-duration) var(--theme-transition-timing),
    color var(--theme-transition-duration) var(--theme-transition-timing);
}

/* 浅色主题样式已迁移到主题变量 */

/* 浅色主题下的搜索图标样式 - 使用主题变量 */
:root[data-theme="light"] .sftp-search-icon,
.light-theme .sftp-search-icon,
html[data-theme="light"] .sftp-search-icon {
  color: var(--color-text-secondary);
}

:root[data-theme="light"] .sftp-search-clear,
.light-theme .sftp-search-clear,
html[data-theme="light"] .sftp-search-clear {
  color: var(--color-text-secondary);
}

:root[data-theme="light"] .sftp-search-clear:hover,
.light-theme .sftp-search-clear:hover,
html[data-theme="light"] .sftp-search-clear:hover {
  background-color: var(--color-bg-muted);
}
</style>