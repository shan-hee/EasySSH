<template>
    <div class="sftp-file-list">
      <div class="sftp-file-list-header">
        <div class="sftp-file-list-column name">文件名</div>
        <div class="sftp-file-list-column size">大小</div>
        <div class="sftp-file-list-column date">修改日期</div>
        <div class="sftp-file-list-column type">类型</div>
        <div class="sftp-file-list-column permissions">权限</div>
      </div>
      
      <div class="sftp-file-list-body">
        <div v-if="loading" class="sftp-file-list-loading">
          <div class="sftp-spinner"></div>
          <span>加载中...</span>
        </div>
        
        <div v-else-if="error" class="sftp-file-list-error">
          {{ error }}
        </div>
        
        <template v-else-if="files.length === 0">
          <div class="sftp-file-list-empty">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24">
              <path fill="currentColor" d="M20,6H12L10,4H4A2,2 0 0,0 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8A2,2 0 0,0 20,6M20,18H4V6H9.17L11.17,8H20V18M12,14.59L15.59,11L17,12.41L13.41,16L17,19.59L15.59,21L12,17.41L8.41,21L7,19.59L10.59,16L7,12.41L8.41,11L12,14.59Z" />
            </svg>
            <p>此文件夹为空</p>
          </div>
        </template>
        
        <template v-else>
          <div 
            v-for="(file, index) in files" 
            :key="index"
            :class="['sftp-file-item', { selected: selectedFile === file.name }]"
            @click="selectFile(file)"
            @dblclick="navigateToFile(file)"
          >
            <div class="sftp-file-list-column name">
              <div class="sftp-file-icon">
                <svg v-if="file.type === 'directory'" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
                  <path fill="#FFD54F" d="M10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6H12L10,4Z" />
                </svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
                  <path fill="#90CAF9" d="M13,9V3.5L18.5,9M6,2C4.89,2 4,2.89 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2H6Z" />
                </svg>
              </div>
              <span>{{ file.name }}</span>
            </div>
            <div class="sftp-file-list-column size">{{ formatFileSize(file.size) }}</div>
            <div class="sftp-file-list-column date">{{ formatDate(file.modifyTime) }}</div>
            <div class="sftp-file-list-column type">{{ file.type === 'directory' ? '文件夹' : getFileType(file.name) }}</div>
            <div class="sftp-file-list-column permissions">{{ file.permissions || '-' }}</div>
          </div>
        </template>
      </div>
    </div>
  </template>
  
  <script>
  import { defineComponent, ref } from 'vue'
  
  export default defineComponent({
    name: 'SftpFileList',
    props: {
      files: {
        type: Array,
        default: () => []
      },
      loading: {
        type: Boolean,
        default: false
      },
      error: {
        type: String,
        default: ''
      }
    },
    emits: ['select-file', 'navigate'],
    setup(props, { emit }) {
      const selectedFile = ref('')
      
      const formatFileSize = (size) => {
        if (size === undefined || size === null) return '-'
        if (size === 0) return '0 B'
        
        const units = ['B', 'KB', 'MB', 'GB', 'TB']
        const i = Math.floor(Math.log(size) / Math.log(1024))
        return parseFloat((size / Math.pow(1024, i)).toFixed(2)) + ' ' + units[i]
      }
      
      const formatDate = (timestamp) => {
        if (!timestamp) return '-'
        const date = new Date(timestamp)
        return date.toLocaleString()
      }
      
      const getFileType = (filename) => {
        if (!filename) return '-'
        const extension = filename.split('.').pop().toLowerCase()
        
        const typeMap = {
          txt: '文本文件',
          pdf: 'PDF文档',
          doc: 'Word文档',
          docx: 'Word文档',
          xls: 'Excel表格',
          xlsx: 'Excel表格',
          ppt: 'PPT演示文稿',
          pptx: 'PPT演示文稿',
          jpg: '图片',
          jpeg: '图片',
          png: '图片',
          gif: '图片',
          mp3: '音频',
          mp4: '视频',
          zip: '压缩文件',
          rar: '压缩文件',
          exe: '可执行文件',
          sh: '脚本文件',
          js: 'JavaScript文件',
          html: 'HTML文件',
          css: 'CSS文件',
          json: 'JSON文件'
        }
        
        return typeMap[extension] || extension
      }
      
      const selectFile = (file) => {
        selectedFile.value = file.name
        emit('select-file', file)
      }
      
      const navigateToFile = (file) => {
        if (file.type === 'directory') {
          emit('navigate', file.name)
        }
      }
      
      return {
        selectedFile,
        formatFileSize,
        formatDate,
        getFileType,
        selectFile,
        navigateToFile
      }
    }
  })
  </script>
  
  <style scoped>
  .sftp-file-list {
    width: 100%;
    border-radius: 4px;
    overflow: hidden;
    background-color: #252525;
  }
  
  .sftp-file-list-header {
    display: grid;
    grid-template-columns: 2fr 1fr 1.5fr 1fr 1fr;
    background-color: #333;
    color: #ddd;
    font-weight: bold;
    padding: 8px 12px;
    border-bottom: 1px solid #444;
    font-size: 12px;
  }
  
  .sftp-file-list-column {
    padding: 0 8px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .sftp-file-list-column.name {
    display: flex;
    align-items: center;
  }
  
  .sftp-file-icon {
    margin-right: 8px;
    display: flex;
    align-items: center;
  }
  
  .sftp-file-list-body {
    max-height: calc(100vh - 250px);
    overflow-y: auto;
  }
  
  .sftp-file-item {
    display: grid;
    grid-template-columns: 2fr 1fr 1.5fr 1fr 1fr;
    padding: 8px 12px;
    cursor: pointer;
    font-size: 13px;
    border-bottom: 1px solid #333;
    transition: background-color 0.2s;
  }
  
  .sftp-file-item:hover {
    background-color: #2a2a2a;
  }
  
  .sftp-file-item.selected {
    background-color: #37474F;
  }
  
  .sftp-file-list-loading,
  .sftp-file-list-empty,
  .sftp-file-list-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 0;
    color: #888;
    font-size: 14px;
  }
  
  .sftp-spinner {
    width: 24px;
    height: 24px;
    border: 3px solid rgba(255, 255, 255, 0.1);
    border-radius: 50%;
    border-top-color: #007acc;
    animation: spin 1s linear infinite;
    margin-bottom: 10px;
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  </style>