<template>
  <div 
    class="sftp-file-item"
    :class="{ 'sftp-file-directory': file.isDirectory }"
    @click="$emit('item-click', file)"
  >
    <div class="sftp-file-name">
      <svg v-if="file.isDirectory" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
        <path fill="#e8b339" d="M10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6H12L10,4Z" />
      </svg>
      <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
        <path fill="#80cbc4" d="M13,9V3.5L18.5,9M6,2C4.89,2 4,2.89 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2H6Z" />
      </svg>
      <span>{{ file.name }}</span>
    </div>
    <div class="sftp-file-size">{{ formatFileSize(file.size, file.isDirectory) }}</div>
    <div class="sftp-file-date">{{ formatDate(file.modifiedTime) }}</div>
    <div class="sftp-file-actions">
      <button class="sftp-action-button" @click.stop="$emit('download', file)">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
          <path fill="currentColor" d="M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z" />
        </svg>
      </button>
      <button class="sftp-action-button" @click.stop="$emit('rename', file)">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
          <path fill="currentColor" d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z" />
        </svg>
      </button>
      <button class="sftp-action-button" @click.stop="$emit('delete', file)">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
          <path fill="currentColor" d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script>
import { defineComponent } from 'vue'
import { useFileUtils } from '../composables/useFileUtils'

export default defineComponent({
  name: 'SftpFileItem',
  props: {
    file: {
      type: Object,
      required: true
    }
  },
  emits: ['item-click', 'download', 'rename', 'delete'],
  setup() {
    // 从composable获取格式化方法
    const { formatFileSize, formatDate } = useFileUtils();
    
    // 判断是否是文本文件
    const isTextFile = (filename) => {
      if (!filename) return false;
      
      const textExtensions = [
        // 编程语言
        'js', 'jsx', 'ts', 'tsx', 'html', 'htm', 'css', 'scss', 'sass', 'less',
        'py', 'rb', 'php', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs',
        'swift', 'kt', 'dart', 'sh', 'bash', 'ps1', 'bat', 'cmd',
        
        // 数据格式
        'json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'conf', 'properties',
        
        // 文本文档
        'txt', 'md', 'markdown', 'rst', 'tex', 'log',
        
        // 配置文件
        'env', 'gitignore', 'dockerignore', 'dockerfile', 'editorconfig',
        'gitattributes', 'npmrc', 'prettierrc', 'eslintrc'
      ];
      
      const ext = filename.split('.').pop().toLowerCase();
      return textExtensions.includes(ext);
    };
    
    return {
      formatFileSize,
      formatDate,
      isTextFile
    }
  }
})
</script>

<style scoped>
.sftp-file-item {
  display: grid;
  grid-template-columns: minmax(200px, 3fr) minmax(80px, 1fr) minmax(150px, 1fr) minmax(80px, 1fr);
  width: 100%;
  padding: 0;
  border-bottom: 1px solid #333;
  font-size: 13px;
  color: #e0e0e0;
  cursor: pointer;
  transition: background-color 0.15s ease;
  position: relative;
}

.sftp-file-item:hover {
  background-color: rgba(255, 255, 255, 0.05);
}

.sftp-file-item:active {
  background-color: rgba(255, 255, 255, 0.08);
}

.sftp-file-item.sftp-file-directory:after {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background-color: transparent;
  transition: background-color 0.15s ease;
  z-index: 1;
}

.sftp-file-item.sftp-file-directory:hover:after {
  background-color: rgba(66, 165, 245, 0.05);
}

.sftp-file-item.sftp-file-directory:active:after {
  background-color: rgba(66, 165, 245, 0.1);
}

.sftp-file-item > div {
  padding: 8px 12px;
  display: flex;
  align-items: center;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sftp-file-item > div.sftp-file-name {
  overflow: hidden;
}

.sftp-file-name span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-left: 8px;
}

.sftp-file-name svg {
  flex-shrink: 0;
  color: #aaa;
}

.sftp-file-item > div.sftp-file-size,
.sftp-file-item > div.sftp-file-date,
.sftp-file-item > div.sftp-file-actions {
  justify-content: flex-end;
}

.sftp-file-item.sftp-file-directory {
  color: #42a5f5;
}

.sftp-file-item > div.sftp-file-actions {
  justify-content: flex-end;
  display: flex;
  gap: 2px;
  padding-right: 8px;
  position: relative;
  z-index: 5;
}

.sftp-action-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  width: 28px;
  height: 28px;
  color: #aaa;
  cursor: pointer;
  border-radius: 4px;
  opacity: 0.7;
  transition: opacity 0.2s, background-color 0.2s, color 0.2s;
  padding: 0;
  margin: 0 1px;
  position: relative;
  z-index: 10;
}

.sftp-file-item:hover .sftp-action-button {
  opacity: 1;
}

.sftp-action-button:hover {
  background-color: rgba(255, 255, 255, 0.1);
  color: #fff;
}

/* 确保按钮在小屏幕上也可见 */
@media (max-width: 600px) {
  .sftp-file-item {
    grid-template-columns: minmax(150px, 2fr) minmax(60px, 1fr) minmax(100px, 1fr) minmax(90px, 1fr);
  }
  
  .sftp-action-button {
    width: 24px;
    height: 24px;
    margin: 0;
    padding: 0;
  }
}
</style> 