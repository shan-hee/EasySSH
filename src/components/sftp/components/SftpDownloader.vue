<template>
  <div class="sftp-downloader">
    <div v-if="currentDownloads.length > 0" class="sftp-download-list">
      <div 
        v-for="(item, index) in currentDownloads" 
        :key="index"
        class="sftp-download-item"
      >
        <div class="sftp-download-item-info">
          <span class="sftp-download-item-name" :title="item.name">{{ item.name }}</span>
          <span class="sftp-download-item-progress">{{ item.progress }}%</span>
        </div>
        <div class="sftp-download-progress-bar">
          <div 
            class="sftp-download-progress-fill"
            :style="{ width: `${item.progress}%` }"
          ></div>
        </div>
        <div class="sftp-download-item-status">
          <span v-if="item.status === 'completed'" class="status-completed">完成</span>
          <span v-else-if="item.status === 'error'" class="status-error">错误</span>
          <span v-else class="status-pending">下载中</span>
        </div>
      </div>
    </div>
    
    <div v-else class="sftp-no-downloads">
      没有正在下载的文件
    </div>
  </div>
</template>

<script>
import { defineComponent, ref } from 'vue'

export default defineComponent({
  name: 'SftpDownloader',
  props: {
    destination: {
      type: String,
      default: ''
    }
  },
  emits: ['download-complete', 'download-error'],
  setup(props, { emit }) {
    const currentDownloads = ref([])
    
    /**
     * 开始下载文件
     * @param {Object} fileInfo 文件信息对象，包含文件名、大小和路径
     */
    const startDownload = (fileInfo) => {
      const downloadItem = {
        id: Date.now() + Math.random().toString(36).substr(2, 9),
        name: fileInfo.name,
        size: fileInfo.size || 0,
        path: fileInfo.path,
        progress: 0,
        status: 'pending'
      }
      
      currentDownloads.value.push(downloadItem)
      
      // 模拟下载过程
      simulateDownload(downloadItem)
      
      return downloadItem.id
    }
    
    /**
     * 模拟下载过程
     * 在实际应用中，这里会使用SFTP客户端的下载API
     */
    const simulateDownload = (downloadItem) => {
      const index = currentDownloads.value.indexOf(downloadItem)
      if (index === -1) return
      
      let progress = 0
      const interval = setInterval(() => {
        progress += Math.random() * 8
        
        if (progress >= 100) {
          progress = 100
          clearInterval(interval)
          
          downloadItem.progress = 100
          downloadItem.status = 'completed'
          
          // 通知下载完成
          emit('download-complete', {
            id: downloadItem.id,
            name: downloadItem.name,
            path: downloadItem.path,
            destination: props.destination
          })
          
          // 延迟移除已完成的下载项
          setTimeout(() => {
            const currentIndex = currentDownloads.value.findIndex(item => item.id === downloadItem.id)
            if (currentIndex !== -1) {
              currentDownloads.value.splice(currentIndex, 1)
            }
          }, 5000)
        } else {
          downloadItem.progress = Math.floor(progress)
        }
      }, 300)
    }
    
    /**
     * 取消下载
     * @param {String} downloadId 下载项ID
     */
    const cancelDownload = (downloadId) => {
      const index = currentDownloads.value.findIndex(item => item.id === downloadId)
      if (index !== -1) {
        currentDownloads.value.splice(index, 1)
        return true
      }
      return false
    }
    
    /**
     * 清除所有已完成的下载
     */
    const clearCompleted = () => {
      currentDownloads.value = currentDownloads.value.filter(
        item => item.status !== 'completed'
      )
    }
    
    return {
      currentDownloads,
      startDownload,
      cancelDownload,
      clearCompleted
    }
  }
})
</script>

<style scoped>
.sftp-downloader {
  margin-bottom: 16px;
}

.sftp-download-list {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid #333;
  border-radius: 4px;
  background-color: #1e1e1e;
}

.sftp-download-item {
  padding: 12px;
  border-bottom: 1px solid #333;
  position: relative;
}

.sftp-download-item:last-child {
  border-bottom: none;
}

.sftp-download-item-info {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 13px;
}

.sftp-download-item-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  color: #ddd;
}

.sftp-download-item-progress {
  color: #0a84ff;
  margin-left: 10px;
}

.sftp-download-progress-bar {
  height: 4px;
  background-color: #333;
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 8px;
}

.sftp-download-progress-fill {
  height: 100%;
  background-color: #0a84ff;
  transition: width 0.3s ease;
}

.sftp-download-item-status {
  font-size: 12px;
  text-align: right;
}

.status-completed {
  color: #4cd964;
}

.status-error {
  color: #ff3b30;
}

.status-pending {
  color: #aaa;
}

.sftp-no-downloads {
  padding: 20px;
  text-align: center;
  color: #888;
  font-size: 14px;
  background-color: #1e1e1e;
  border: 1px solid #333;
  border-radius: 4px;
}
</style> 