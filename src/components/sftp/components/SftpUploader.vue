<template>
  <div class="sftp-uploader">
    <div
      class="sftp-upload-dropzone"
      :class="{ active: isDragging }"
      @dragenter.prevent="onDragEnter"
      @dragleave.prevent="onDragLeave"
      @dragover.prevent
      @drop.prevent="onDrop"
    >
      <div class="sftp-upload-inner">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="32"
          height="32"
          viewBox="0 0 24 24"
        >
          <path
            fill="currentColor"
            d="M9,16V10H5L12,3L19,10H15V16H9M5,20V18H19V20H5Z"
          />
        </svg>
        <p class="sftp-upload-text">
          拖放文件至此或
          <span
            class="sftp-upload-button"
            @click="triggerFileInput"
          >选择文件</span>
        </p>
        <p
          v-if="currentUploads.length > 0"
          class="sftp-upload-status"
        >
          正在上传: {{ currentUploads.length }} 个文件
        </p>
      </div>

      <input
        ref="fileInput"
        type="file"
        multiple
        class="sftp-file-input"
        @change="onFileSelected"
      >
    </div>

    <div
      v-if="currentUploads.length > 0"
      class="sftp-upload-list"
    >
      <div
        v-for="(file, index) in currentUploads"
        :key="index"
        class="sftp-upload-item"
      >
        <div class="sftp-upload-item-info">
          <span class="sftp-upload-item-name">{{ file.name }}</span>
          <span class="sftp-upload-item-progress">{{ file.progress }}%</span>
        </div>
        <div class="sftp-upload-progress-bar">
          <div
            class="sftp-upload-progress-fill"
            :style="{ width: `${file.progress}%` }"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { defineComponent, ref } from 'vue';

export default defineComponent({
  name: 'SftpUploader',
  props: {
    currentPath: {
      type: String,
      required: true
    }
  },
  emits: ['upload-complete', 'upload-error'],
  setup(props, { emit }) {
    const fileInput = ref(null);
    const isDragging = ref(false);
    const currentUploads = ref([]);

    const triggerFileInput = () => {
      fileInput.value.click();
    };

    const onDragEnter = () => {
      isDragging.value = true;
    };

    const onDragLeave = event => {
      // 仅当离开最外层容器时才设置为false
      if (event.target === event.currentTarget) {
        isDragging.value = false;
      }
    };

    const onDrop = event => {
      isDragging.value = false;
      const files = Array.from(event.dataTransfer.files);
      processFiles(files);
    };

    const onFileSelected = event => {
      const files = Array.from(event.target.files);
      processFiles(files);
      // 重置文件输入，以便可以再次选择相同的文件
      event.target.value = null;
    };

    const processFiles = files => {
      if (!files.length) return;

      files.forEach(file => {
        // 添加到上传列表
        const uploadFile = {
          file,
          name: file.name,
          size: file.size,
          progress: 0,
          status: 'pending'
        };

        currentUploads.value.push(uploadFile);

        // 模拟上传过程
        simulateUpload(uploadFile);
      });
    };

    const simulateUpload = uploadFile => {
      // 在实际应用中，这里会使用SFTP客户端的上传API
      // 这里仅作为演示，模拟上传进度

      const index = currentUploads.value.indexOf(uploadFile);
      if (index === -1) return;

      let progress = 0;
      const interval = setInterval(() => {
        progress += Math.random() * 10;

        if (progress >= 100) {
          progress = 100;
          clearInterval(interval);

          uploadFile.progress = 100;
          uploadFile.status = 'completed';

          // 通知上传完成
          emit('upload-complete', {
            file: uploadFile.file,
            path: props.currentPath
          });

          // 从列表中移除完成的上传（延迟一会儿以显示完成状态）
          setTimeout(() => {
            const currentIndex = currentUploads.value.indexOf(uploadFile);
            if (currentIndex !== -1) {
              currentUploads.value.splice(currentIndex, 1);
            }
          }, 2000);
        } else {
          uploadFile.progress = Math.floor(progress);
        }
      }, 200);
    };

    return {
      fileInput,
      isDragging,
      currentUploads,
      triggerFileInput,
      onDragEnter,
      onDragLeave,
      onDrop,
      onFileSelected
    };
  }
});
</script>

<style scoped>
.sftp-uploader {
  margin-bottom: 16px;
}

.sftp-upload-dropzone {
  border: 2px dashed #444;
  border-radius: 6px;
  padding: 20px;
  text-align: center;
  transition: all 0.3s;
  position: relative;
  background-color: #1e1e1e;
}

.sftp-upload-dropzone.active {
  border-color: #0a84ff;
  background-color: #0a84ff10;
}

.sftp-upload-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #ccc;
}

.sftp-upload-text {
  margin: 10px 0;
  font-size: 14px;
}

.sftp-upload-button {
  color: #0a84ff;
  cursor: pointer;
  text-decoration: underline;
}

.sftp-upload-status {
  font-size: 12px;
  color: #aaa;
  margin-top: 5px;
}

.sftp-file-input {
  display: none;
}

.sftp-upload-list {
  margin-top: 16px;
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid #333;
  border-radius: 4px;
  background-color: #1e1e1e;
}

.sftp-upload-item {
  padding: 10px;
  border-bottom: 1px solid #333;
}

.sftp-upload-item:last-child {
  border-bottom: none;
}

.sftp-upload-item-info {
  display: flex;
  justify-content: space-between;
  margin-bottom: 6px;
  font-size: 13px;
}

.sftp-upload-item-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  color: #ddd;
  max-width: calc(100% - 50px); /* 为进度百分数留出空间 */
}

.sftp-upload-item-progress {
  color: #0a84ff;
  margin-left: 10px;
  white-space: nowrap;
}

.sftp-upload-progress-bar {
  height: 6px; /* 与主面板进度条保持一致 */
  background-color: #333;
  border-radius: 3px; /* 与主面板进度条保持一致 */
  overflow: hidden;
}

.sftp-upload-progress-fill {
  height: 100%;
  background-color: #67c23a; /* 与主面板上传进度条颜色保持一致 */
  transition: width 0.2s linear; /* 与主面板进度条保持一致 */
  border-radius: 3px;
}
</style>
