<template>
  <div class="sftp-panel-container" :class="{ 'resizing': isResizing, 'closing': isClosing }" :style="{ width: width + 'px' }">
    <div class="sftp-panel-resizer" @mousedown="startResizing"></div>
    <div class="sftp-panel">
      <div class="sftp-panel-header">
        <h3>SFTP 文件管理器</h3>
        <button class="close-button" @click="close">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18">
            <path fill="#ffffff" d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"></path>
          </svg>
        </button>
      </div>
      <div class="sftp-panel-content">
        <!-- 错误提示 -->
        <div v-if="hasError" class="sftp-error-message">
          <el-alert :title="errorMessage" type="error" :closable="false" show-icon />
        </div>
        
        <!-- 上传/下载进度 -->
        <div v-if="isUploading || isDownloading" class="sftp-progress">
          <div class="sftp-progress-header">
            <div class="sftp-progress-title">
              <span class="sftp-progress-type">{{ isUploading ? '上传中' : '下载中' }}</span>
              <span v-if="transferSpeed > 0" class="sftp-speed">{{ formatTransferSpeed(transferSpeed) }}</span>
            </div>
            <span class="sftp-percentage">{{ Math.floor(isUploading ? uploadProgress : downloadProgress) }}%</span>
          </div>
          <div class="sftp-progress-bar-container">
            <div class="sftp-progress-bar" 
                :style="{ width: (isUploading ? uploadProgress : downloadProgress) + '%',
                          backgroundColor: getProgressColor(isUploading ? uploadProgress : downloadProgress) }">
            </div>
          </div>
          <div class="sftp-progress-info">
            <div v-if="isUploading" class="sftp-progress-filename">{{ currentUploadingFile }}</div>
            <button v-if="isUploading && uploadProgress < 100" class="sftp-cancel-button" @click="cancelUpload">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24">
                <path fill="currentColor" d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z" />
              </svg>
              取消
            </button>
          </div>
        </div>
        
        <!-- 编辑器 -->
        <div v-if="isEditing" class="sftp-editor-wrapper">
          <SftpEditor
            :sessionId="sessionId"
            :filePath="editingFilePath"
            :content="editingFileContent"
            @close="closeEditor"
            @save="handleEditorSave"
          />
        </div>
        
        <!-- SFTP文件浏览器 -->
        <div v-else class="sftp-file-explorer" 
          :class="{ 'sftp-drag-over': isDragOver }"
          @dragover.prevent="handleDragOver"
          @dragleave.prevent="handleDragLeave"
          @drop.prevent="handleDrop"
        >
          <!-- 路径导航 -->
          <SftpPathNavigator 
            :currentPath="currentPath" 
            @navigate="loadDirectoryContents"
            @refresh="refreshCurrentDirectory"
            @toggle-hidden-files="toggleHiddenFiles"
          />
          
          <!-- 工具栏 -->
          <SftpToolbar 
            @upload="uploadFile" 
            @upload-folder="uploadFolder"
            @new-folder="createNewFolder"
            @search="handleSearch"
          />
          
          <!-- 文件列表 -->
          <div class="sftp-file-list">
            <div class="sftp-file-list-header">
              <div class="sftp-file-name">名称</div>
              <div class="sftp-file-size">大小</div>
              <div class="sftp-file-date">修改日期</div>
              <div class="sftp-file-actions">操作</div>
            </div>
            
            <div class="sftp-file-list-content">
              <!-- 加载状态 -->
              <div v-if="isLoadingSftp" class="sftp-loading-files">
                <div class="sftp-loading-spinner">
                  <svg class="circular" viewBox="25 25 50 50">
                    <circle class="path" cx="50" cy="50" r="20" fill="none"/>
                  </svg>
                </div>
                <p>正在加载文件列表...</p>
              </div>
              
              <!-- 空文件夹提示 -->
              <div v-else-if="fileList.length === 0" class="sftp-empty-folder">
                <p>此文件夹为空</p>
              </div>
              
              <!-- 文件列表 -->
              <div v-else class="sftp-file-items">
                <SftpFileItem 
                  v-for="(file, index) in fileList" 
                  :key="index" 
                  :file="file" 
                  @item-click="handleItemClick"
                  @download="downloadFile"
                  @rename="renameFile"
                  @delete="deleteFile"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { defineComponent, ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { ElMessageBox, ElMessage, ElLoading } from 'element-plus'
import { sftpService } from '@/services/ssh'

// 导入子组件
import SftpFileItem from './components/SftpFileItem.vue'
import SftpToolbar from './components/SftpToolbar.vue'
import SftpPathNavigator from './components/SftpPathNavigator.vue'
import SftpEditor from './components/SftpEditor.vue'

// 导入可复用逻辑
import { useFileUtils } from './composables/useFileUtils'

export default defineComponent({
  name: 'SftpPanel',
  components: {
    SftpFileItem,
    SftpToolbar,
    SftpPathNavigator,
    SftpEditor
  },
  props: {
    sessionId: {
      type: String,
      required: true
    },
    width: {
      type: Number,
      default: 600
    },
    isClosing: {
      type: Boolean,
      default: false
    }
  },
  emits: ['close', 'resize', 'update:width'],
  setup(props, { emit }) {
    // SFTP面板状态
    const isResizing = ref(false)
    
    // SFTP文件管理器相关状态
    const isLoadingSftp = ref(true)
    const currentPath = ref('/')
    const fileList = ref([])
    const showHiddenFiles = ref(false)
    // 添加上传进度状态
    const uploadProgress = ref(0)
    const isUploading = ref(false)
    const downloadProgress = ref(0)
    const isDownloading = ref(false)
    // 添加传输速度相关状态
    const transferSpeed = ref(0) // 传输速度(字节/秒)
    const transferStartTime = ref(0) // 传输开始时间
    const transferredBytes = ref(0) // 已传输字节数
    const transferInterval = ref(null) // 速度计算定时器
    // 添加错误状态
    const hasError = ref(false)
    const errorMessage = ref('')
    // 拖拽上传状态
    const isDragOver = ref(false)
    
    // 添加当前上传文件名
    const currentUploadingFile = ref('');
    // 添加当前上传操作ID
    const currentUploadId = ref(null);
    
    // 添加编辑器相关状态
    const isEditing = ref(false);
    const editingFilePath = ref('');
    const editingFileContent = ref('');
    
    // 从可复用逻辑中获取工具函数
    const { formatFileSize, formatDate } = useFileUtils()
    
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
    
    // 监听sessionId的变化
    watch(() => props.sessionId, (newSessionId, oldSessionId) => {
      if (newSessionId !== oldSessionId && newSessionId) {
        console.log(`sessionId prop变化: ${oldSessionId} -> ${newSessionId}`);
        // 执行相同的文件列表刷新逻辑，但不进行完整的SFTP重新初始化
        isLoadingSftp.value = true;
        
        // 创建SFTP会话并选择初始目录
        (async () => {
          try {
            await sftpService.createSftpSession(newSessionId);
            
            // 尝试进入/root目录，如果不存在则使用当前路径
            let initialPath = '/root';
            if (sftpService.activeSftpSessions.has(newSessionId)) {
              const sftpSession = sftpService.activeSftpSessions.get(newSessionId);
              try {
                await sftpService.listDirectory(newSessionId, initialPath);
                console.log(`/root目录存在，使用它作为初始目录`);
              } catch (error) {
                console.log(`/root目录不存在，使用默认路径: ${sftpSession.currentPath}`);
                initialPath = sftpSession.currentPath || '/';
              }
            }
            
            // 加载目录内容
            await loadDirectoryContents(initialPath);
            isLoadingSftp.value = false;
          } catch (error) {
            isLoadingSftp.value = false;
            showError(`会话切换失败: ${error.message || '未知错误'}`);
            console.error('会话切换失败:', error);
          }
        })();
      }
    });
    
    // 重置错误状态
    const resetError = () => {
      hasError.value = false;
      errorMessage.value = '';
    };
    
    // 显示错误消息
    const showError = (message) => {
      hasError.value = true;
      errorMessage.value = message;
      ElMessage.error(message);
    };
    
    // 关闭SFTP面板
    const close = () => {
      emit('close');
    }
    
    // 监听会话变更事件
    const handleSessionChanged = (event) => {
      const newSessionId = event.detail;
      console.log(`SFTP会话变更: ${newSessionId}`);
      
      // 显示加载状态
      isLoadingSftp.value = true;
      // 不立即清空文件列表，保持UI稳定
      
      try {
        // 延迟一会儿等SFTP连接准备好，避免并发问题
        setTimeout(async () => {
          try {
            console.log(`开始创建SFTP会话: ${newSessionId}`);
            
            // 创建SFTP会话
            const sessionResult = await sftpService.createSftpSession(newSessionId);
            console.log(`SFTP会话创建结果:`, sessionResult);
            
            // 尝试进入/root目录，如果不存在则使用当前路径
            let initialPath = '/root';
            if (sftpService.activeSftpSessions.has(newSessionId)) {
              const sftpSession = sftpService.activeSftpSessions.get(newSessionId);
              try {
                await sftpService.listDirectory(newSessionId, initialPath);
                console.log(`/root目录存在，使用它作为初始目录`);
              } catch (error) {
                console.log(`/root目录不存在，使用默认路径: ${sftpSession.currentPath}`);
                initialPath = sftpSession.currentPath || '/';
              }
            }
            
            // 加载目录内容
            console.log(`加载目录内容: ${initialPath}`);
            await loadDirectoryContents(initialPath);
            
            isLoadingSftp.value = false;
            console.log(`SFTP会话切换完成: ${newSessionId}`);
          } catch (error) {
            isLoadingSftp.value = false;
            showError(`加载SFTP文件列表失败: ${error.message || '未知错误'}`);
            console.error('加载SFTP文件列表失败:', error);
          }
        }, 300);
      } catch (error) {
        isLoadingSftp.value = false;
        showError(`切换SFTP会话失败: ${error.message || '未知错误'}`);
        console.error('切换SFTP会话失败:', error);
      }
    };
    
    // 开始调整SFTP面板宽度
    const startResizing = (event) => {
      // 设置正在调整状态
      isResizing.value = true;
      
      // 记录初始鼠标位置和面板宽度
      const startX = event.clientX;
      const startWidth = props.width;
      
      // 创建鼠标移动和释放事件处理函数
      const handleMouseMove = (moveEvent) => {
        // 计算鼠标移动距离
        const deltaX = moveEvent.clientX - startX;
        
        // 计算新宽度（从右向左拖动，所以是减法）
        const newWidth = startWidth - deltaX;
        
        // 计算最大宽度为窗口宽度的90%
        const maxWidth = window.innerWidth * 0.95;
        
        // 设置宽度范围在 300px 到 窗口宽度的90% 之间
        if (newWidth >= 300 && newWidth <= maxWidth) {
          emit('update:width', newWidth);
          emit('resize', newWidth);
        }
      };
      
      const handleMouseUp = () => {
        // 移除事件监听器
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        
        // 重置调整状态
        isResizing.value = false;
      };
      
      // 添加事件监听器
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    
    // SFTP文件管理器方法
    // 加载当前目录文件列表
    const loadDirectoryContents = async (path) => {
      resetError();
      
      // 显示加载状态
      isLoadingSftp.value = true;
      // 不立即清空文件列表，保持UI稳定状态
      
      try {
        // 确保有会话ID
        if (!props.sessionId) {
          throw new Error('没有活动的SSH会话，无法使用SFTP');
        }
        
        console.log(`加载目录内容: 会话ID=${props.sessionId}, 路径=${path}`);
        
        // 使用SFTP服务加载目录内容
        const rawFiles = await sftpService.listDirectory(props.sessionId, path);
        
        // 确保返回值是数组
        const files = Array.isArray(rawFiles) ? rawFiles : [];
        
        // 确保数据格式正确
        const processedFiles = files.map(file => ({
          ...file,
          // 确保size是数字类型
          size: typeof file.size === 'string' ? parseInt(file.size, 10) : file.size,
          // 确保日期是Date对象
          modifiedTime: file.modifiedTime instanceof Date ? 
            file.modifiedTime : 
            (file.modifiedTime ? new Date(file.modifiedTime) : new Date())
        }));
        
        // 确保始终有一个返回上层目录的选项，除非在根目录
        if (path !== '/' && !processedFiles.some(file => file.name === '..')) {
          processedFiles.unshift({
            name: '..',
            isDirectory: true,
            size: 0,
            modifiedTime: new Date()
          });
        }
        
        // 如果不显示隐藏文件，过滤掉以点开头的文件（保留".."）
        let filteredFiles = processedFiles;
        if (!showHiddenFiles.value) {
          filteredFiles = processedFiles.filter(file => 
            file.name === '..' || !file.name.startsWith('.')
          );
        }
        
        // 对文件列表进行排序：文件夹在前，文件在后，然后按名称排序
        filteredFiles.sort((a, b) => {
          // 如果是返回上层目录的特殊项(..)，始终排在最前面
          if (a.name === '..') return -1;
          if (b.name === '..') return 1;
          
          // 文件夹排在文件前面
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          
          // 同类型按名称字母顺序排序
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });
        
        // 更新文件列表和当前路径
        fileList.value = filteredFiles;
        currentPath.value = path;
        isLoadingSftp.value = false;
      } catch (error) {
        console.error('加载目录内容失败:', error);
        showError(`加载目录内容失败: ${error.message}`);
        // 如果出错，提供一个空列表
        fileList.value = [];
        isLoadingSftp.value = false;
      }
    };
    
    // 刷新当前目录
    const refreshCurrentDirectory = async () => {
      console.log(`开始刷新目录: ${currentPath.value}`);
      try {
        await loadDirectoryContents(currentPath.value);
        console.log(`目录刷新成功: ${currentPath.value}`);
      } catch (error) {
        console.error(`目录刷新失败: ${error.message}`);
        // 出错时不抛出异常，以避免中断流程
      }
    };
    
    // 处理文件项单击事件
    const handleItemClick = async (file) => {
      // 如果是文件，则打开查看器
      if (!file.isDirectory) {
        if (isTextFile(file.name)) {
          // 如果是文本文件，打开编辑器
          openEditor(file);
        } else {
          // 如果是二进制文件，提示下载
          const confirmed = await ElMessageBox.confirm(
            `${file.name} 可能是二进制文件，是否下载?`,
            '文件查看',
            {
              confirmButtonText: '下载',
              cancelButtonText: '取消',
              type: 'info'
            }
          ).catch(() => false);
          
          if (confirmed) {
            downloadFile(file);
          }
        }
        return;
      }
      
      // 如果是目录，则进入该目录
      // 显示加载指示器
      isLoadingSftp.value = true;
      // 不立即清空文件列表，保持UI稳定
      
      try {
        // 处理上级目录
        if (file.name === '..') {
          // 获取父目录路径
          const parentPath = currentPath.value.split('/').slice(0, -1).join('/') || '/';
          await loadDirectoryContents(parentPath);
        } else {
          // 构建新的路径
          const newPath = currentPath.value === '/' ? 
            currentPath.value + file.name : 
            currentPath.value + '/' + file.name;
          
          await loadDirectoryContents(newPath);
        }
      } catch (error) {
        console.error('打开目录失败:', error);
        showError(`打开目录失败: ${error.message}`);
        isLoadingSftp.value = false;
      }
    };
    
    // 创建新文件夹
    const createNewFolder = () => {
      resetError();
      
      ElMessageBox.prompt('请输入文件夹名称', '新建文件夹', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        inputPattern: /^[^\\/:\*\?"<>\|]+$/,
        inputErrorMessage: '文件夹名称不能包含非法字符'
      }).then(async ({ value }) => {
        if (value) {
          try {
            const fullPath = currentPath.value === '/' ? 
              currentPath.value + value : 
              currentPath.value + '/' + value;
            
            // 创建与文件列表加载一致的加载状态
            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'sftp-loading-files';
            loadingDiv.innerHTML = `
              <div class="sftp-loading-spinner">
                <svg class="circular" viewBox="25 25 50 50">
                  <circle class="path" cx="50" cy="50" r="20" fill="none"/>
                </svg>
              </div>
              <p>创建文件夹中...</p>
            `;
            
            // 将加载状态添加到文件列表区域
            const fileListContent = document.querySelector('.sftp-file-list-content');
            if (fileListContent) {
              fileListContent.appendChild(loadingDiv);
            }
            
            // 调用SFTP服务创建文件夹
            await sftpService.createDirectory(props.sessionId, fullPath);
            
            // 移除加载状态
            if (fileListContent && loadingDiv.parentNode === fileListContent) {
              fileListContent.removeChild(loadingDiv);
            }
            
            ElMessage.success(`文件夹 ${value} 创建成功`);
            
            // 刷新目录以显示新文件夹
            refreshCurrentDirectory();
          } catch (error) {
            // 移除加载状态
            const loadingDiv = document.querySelector('.sftp-file-list-content .sftp-loading-files');
            if (loadingDiv && loadingDiv.parentNode) {
              loadingDiv.parentNode.removeChild(loadingDiv);
            }
            
            console.error('创建文件夹失败:', error);
            showError(`创建文件夹失败: ${error.message}`);
          }
        }
      }).catch(() => {
        // 用户取消
      });
    };
    
    // 上传文件
    const uploadFile = () => {
      resetError();
      
      // 创建一个隐藏的文件输入元素
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.style.display = 'none';
      fileInput.multiple = true; // 支持多选
      document.body.appendChild(fileInput);
      
      // 监听文件选择事件
      fileInput.addEventListener('change', async () => {
        if (fileInput.files && fileInput.files.length > 0) {
          // 使用新函数处理多个文件或文件夹
          await uploadMultipleFiles(fileInput.files);
        }
        
        // 从DOM中移除文件输入元素
        document.body.removeChild(fileInput);
      });
      
      // 触发文件选择对话框
      fileInput.click();
    };
    
    // 上传文件夹
    const uploadFolder = () => {
      resetError();
      
      // 创建一个隐藏的文件输入元素
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.style.display = 'none';
      fileInput.webkitdirectory = true; // 支持选择文件夹
      fileInput.multiple = true; // 必须设置multiple才能正确获取文件夹内的所有文件
      document.body.appendChild(fileInput);
      
      // 监听文件选择事件
      fileInput.addEventListener('change', async () => {
        if (fileInput.files && fileInput.files.length > 0) {
          // 使用新函数处理多个文件或文件夹
          await uploadMultipleFiles(fileInput.files);
        }
        
        // 从DOM中移除文件输入元素
        document.body.removeChild(fileInput);
      });
      
      // 触发文件选择对话框
      fileInput.click();
    };

    // 上传多个文件或整个文件夹
    const uploadMultipleFiles = async (files) => {
      if (!files || files.length === 0) return;
      
      // 对于大于10个文件的上传，先确认
      if (files.length > 10) {
        try {
          await ElMessageBox.confirm(
            `您选择了${files.length}个文件，确定要全部上传吗？`, 
            '批量上传确认', 
            {
              confirmButtonText: '全部上传',
              cancelButtonText: '取消',
              type: 'warning'
            }
          );
        } catch (e) {
          return; // 用户取消了上传
        }
      }
      
      // 重置上传状态
      isUploading.value = true;
      uploadProgress.value = 0;
      transferSpeed.value = 0;
      transferredBytes.value = 0;
      transferStartTime.value = Date.now();
      
      // 收集所有需要创建的目录路径，使用Set去重
      const dirsToCreate = new Set();
      const totalSize = Array.from(files).reduce((total, file) => total + file.size, 0);
      let uploadedSize = 0;
      let completedFiles = 0;
      
      // 存储上传失败的文件
      const failedFiles = [];
      
      // 更新全局进度条信息
      currentUploadingFile.value = `批量上传中`;
      
      // 预处理：收集所有需要创建的目录
      for (const file of files) {
        let relativePath = file.webkitRelativePath || file.name;
        
        if (relativePath.includes('/')) {
          // 提取目录结构
          const pathParts = relativePath.split('/');
          pathParts.pop(); // 移除文件名，只保留路径部分
          
          if (pathParts.length > 0) {
            let currentDirPath = currentPath.value === '/' ? '/' : currentPath.value + '/';
            let partialPath = '';
            
            for (const part of pathParts) {
              partialPath += (partialPath ? '/' : '') + part;
              const dirPath = currentDirPath === '/' ? 
                currentDirPath + partialPath : 
                currentDirPath + '/' + partialPath;
              
              dirsToCreate.add(dirPath);
            }
          }
        }
      }
      
      // 创建所有目录
      for (const dirPath of dirsToCreate) {
        try {
          console.log(`创建目录: ${dirPath}`);
          await sftpService.createDirectory(props.sessionId, dirPath);
        } catch (dirError) {
          // 忽略目录已存在的错误
          if (!dirError.message.includes('已存在')) {
            console.warn(`创建目录失败: ${dirPath}`, dirError);
          }
        }
      }
      
      // 设置进度更新函数
      const updateBatchProgress = (fileProgress, fileSize) => {
        // 计算当前文件的已上传大小
        const fileUploaded = fileSize * (fileProgress / 100);
        
        // 更新总进度 - 防止超过100%
        const totalProgress = Math.min(100, Math.floor(((uploadedSize + fileUploaded) / totalSize) * 100));
        uploadProgress.value = totalProgress;
        
        // 更新传输速度
        const now = Date.now();
        const timeDelta = (now - transferStartTime.value) / 1000;
        if (timeDelta > 0) {
          transferSpeed.value = (uploadedSize + fileUploaded) / timeDelta;
        }
      };
      
      // 实际成功上传的文件大小
      let actualUploadedSize = 0;
      
      // 开始上传文件
      for (let i = 0; i < files.length; i++) {
        // 如果上传被取消，则停止
        if (!isUploading.value) break;
        
        const file = files[i];
        
        // 更新当前上传文件名和进度信息（移除百分比显示）
        currentUploadingFile.value = file.name;
        
        try {
          // 获取文件的相对路径部分
          let relativePath = file.webkitRelativePath || file.name;
          
          // 构建完整的远程路径
          let remotePath;
          if (relativePath.includes('/')) {
            remotePath = currentPath.value === '/' ? 
              currentPath.value + relativePath : 
              currentPath.value + '/' + relativePath;
          } else {
            remotePath = currentPath.value === '/' ? 
              currentPath.value + file.name : 
              currentPath.value + '/' + file.name;
          }
          
          // 记录文件大小，用于进度计算
          const fileSize = file.size;
          console.log(`上传文件: ${remotePath} (${formatFileSize(fileSize)})`);
          
          // 跟踪当前文件上传进度，防止重复计算
          let lastFileProgress = 0;
          
          // 上传单个文件
          await sftpService.uploadFile(
            props.sessionId,
            file,
            remotePath,
            (progress, operationId) => {
              // 保存操作ID用于取消
              if (operationId && !currentUploadId.value) {
                currentUploadId.value = operationId;
              }
              
              // 更新整体进度 - 每次进度回调都实时更新
              updateBatchProgress(progress, fileSize);
              
              // 当单个文件上传完成时
              if (progress >= 100) {
                console.log(`文件完成上传: ${remotePath}`);
                // 重置最后进度以避免重复计算
                lastFileProgress = 100;
              }
            }
          );
          
          // 单个文件上传完成，添加到已上传大小
          uploadedSize += fileSize;
          actualUploadedSize += fileSize; // 记录实际上传成功的大小
          completedFiles++;
          
          // 重新计算总体进度 - 确保不超过100%
          uploadProgress.value = Math.min(100, Math.floor((uploadedSize / totalSize) * 100));
          
        } catch (error) {
          console.error(`上传失败: ${file.name}`, error);
          failedFiles.push({ name: file.name, error: error.message });
          // 继续上传下一个文件，不中断整个过程
        }
      }
      
      console.log(`所有文件上传完成，准备显示结果和刷新目录...`);
      
      // 添加一个强制执行标记
      let finishExecuted = false;
      
      // 创建一个完成上传的函数，确保只执行一次
      const finishUpload = async () => {
        // 如果已经执行过，直接返回
        if (finishExecuted) return;
        finishExecuted = true;
        
        console.log("执行文件上传完成操作");
        
        // 全部上传完成，显示结果 - 使用实际成功上传的文件数量和大小
        if (failedFiles.length > 0) {
          // 有失败的文件
          const failMessage = `上传完成，成功${completedFiles}个文件(${formatFileSize(actualUploadedSize)})，失败${failedFiles.length}个文件`;
          ElMessage.warning(failMessage);
          console.warn('上传失败的文件:', failedFiles);
        } else {
          // 全部成功
          ElMessage.success(`成功上传${completedFiles}个文件，总大小${formatFileSize(actualUploadedSize)}`);
        }
        
        // 重置上传状态
        isUploading.value = false;
        uploadProgress.value = 100; // 确保进度条显示完成
        
        // 清除计时器
        if (transferInterval.value) {
          clearInterval(transferInterval.value);
          transferInterval.value = null;
        }
        
        // 一次性刷新目录
        try {
          console.log("开始刷新目录...");
          await loadDirectoryContents(currentPath.value);
          console.log("目录刷新完成");
        } catch (error) {
          console.error("刷新目录失败:", error);
        }
      };
      
      // 立即调用完成函数
      await finishUpload();
      
      // 不再需要设置备用超时，上面的函数已经确保会执行
    };
    
    // 获取进度条颜色
    const getProgressColor = (progress) => {
      if (progress < 30) return '#ff9800'; // 橙色
      if (progress < 70) return '#42a5f5'; // 蓝色
      return '#4caf50'; // 绿色
    };
    
    // 取消上传
    const cancelUpload = async () => {
      try {
        // 获取当前上传文件的远程路径
        const remotePath = currentPath.value === '/' ? 
          currentPath.value + currentUploadingFile.value : 
          currentPath.value + '/' + currentUploadingFile.value;
        
        // 先取消上传操作（如果正在进行）
        if (currentUploadId.value) {
          try {
            await sftpService.cancelFileOperation(props.sessionId, currentUploadId.value);
            console.log('已取消上传操作:', currentUploadId.value);
          } catch (error) {
            console.warn('取消上传操作失败:', error);
            // 继续执行删除文件操作
          }
        }
        
        // 然后删除远程文件
        try {
          await sftpService.delete(props.sessionId, remotePath, false); // false表示这是文件而非目录
          console.log('已删除文件:', remotePath);
          ElMessage.success(`已取消上传并删除文件: ${currentUploadingFile.value}`);
        } catch (error) {
          console.warn('删除文件失败:', error);
          ElMessage.info(`已取消上传，但删除文件失败: ${error.message}`);
        }
        
        // 重置上传状态
        isUploading.value = false;
        uploadProgress.value = 0;
        transferSpeed.value = 0;
        currentUploadingFile.value = '';
        currentUploadId.value = null;
        
        // 清除计时器
        if (transferInterval.value) {
          clearInterval(transferInterval.value);
          transferInterval.value = null;
        }
        
        // 刷新目录以反映变化
        refreshCurrentDirectory();
      } catch (error) {
        console.error('取消上传失败:', error);
        showError(`取消上传失败: ${error.message}`);
      }
    };
    
    // 上传文件到服务器
    const uploadFileToServer = async (file, customRemotePath, isBatchUpload = false) => {
      try {
        // 仅当不是批量上传的一部分时才重置传输状态
        if (!isBatchUpload) {
          isUploading.value = true;
          uploadProgress.value = 0;
          transferSpeed.value = 0;
          transferredBytes.value = 0;
          transferStartTime.value = Date.now();
        }
        
        currentUploadingFile.value = file.name; // 设置当前上传文件名
        currentUploadId.value = null; // 重置操作ID
        
        // 清除之前的计时器
        if (transferInterval.value) {
          clearInterval(transferInterval.value);
          transferInterval.value = null;
        }
        
        // 使用自定义远程路径或构建默认远程路径
        const remotePath = customRemotePath || (currentPath.value === '/' ? 
          currentPath.value + file.name : 
          currentPath.value + '/' + file.name);
        
        // 定义进度回调函数
        const progressCallback = (progress, operationId) => {
          // 保存操作ID用于取消上传
          if (operationId && !currentUploadId.value) {
            currentUploadId.value = operationId;
          }
          
          // 如果是批量上传的一部分，不更新总进度
          if (isBatchUpload) return;
          
          const now = Date.now();
          const newTransferredBytes = Math.floor(file.size * progress / 100);
          const bytesDelta = newTransferredBytes - transferredBytes.value;
          const timeDelta = (now - transferStartTime.value) / 1000;
          
          // 更新进度
          uploadProgress.value = progress;
          
          // 只有当有实际进度变化时才更新速度
          if (bytesDelta > 0 && timeDelta > 0) {
            // 计算当前速度 (bytes/s)
            const currentSpeed = bytesDelta / timeDelta;
            
            // 更新传输速度 (使用加权平均实现平滑过渡)
            transferSpeed.value = transferSpeed.value === 0 ? 
              currentSpeed : (transferSpeed.value * 0.7 + currentSpeed * 0.3);
            
            // 更新状态
            transferredBytes.value = newTransferredBytes;
            transferStartTime.value = now;
          }
          
          // 当上传完成时(进度为100%)
          if (progress >= 100 && !isBatchUpload) {
            // 记录上传完成时间
            const uploadEndTime = Date.now();
            const totalTimeSeconds = ((uploadEndTime - transferStartTime.value) / 1000).toFixed(2);
            
            // 延迟关闭上传状态并刷新目录
            setTimeout(() => {
              isUploading.value = false;
              currentUploadId.value = null; // 清除操作ID
              
              // 清除计时器
              if (transferInterval.value) {
                clearInterval(transferInterval.value);
                transferInterval.value = null;
              }
              
              // 确保刷新当前目录
              refreshCurrentDirectory();
              console.log('已刷新目录:', currentPath.value);
            }, 1500);
          }
        };
        
        // 调用SFTP服务上传文件
        await sftpService.uploadFile(
          props.sessionId,
          file,
          remotePath,
          progressCallback
        );
        
        // 确保进度为100%（仅对单文件上传）
        if (!isBatchUpload && uploadProgress.value < 100) {
          uploadProgress.value = 100;
          
          // 如果回调没有触发100%的进度，在这里显示成功消息
          ElMessage.success(`文件 ${file.name} 上传成功`);
          
          // 确保刷新目录
          setTimeout(() => {
            isUploading.value = false;
            // 清除计时器
            if (transferInterval.value) {
              clearInterval(transferInterval.value);
              transferInterval.value = null;
            }
            // 刷新当前目录
            refreshCurrentDirectory();
            console.log('已刷新目录:', currentPath.value);
          }, 1500);
        } else if (!isBatchUpload) {
          // 如果已经处理了100%进度，只显示成功消息
          ElMessage.success(`文件 ${file.name} 上传成功`);
        }
        
      } catch (error) {
        console.error('上传文件失败:', error);
        
        if (!isBatchUpload) {
          showError(`上传文件失败: ${error.message}`);
          isUploading.value = false;
          currentUploadId.value = null; // 清除操作ID
          
          // 清除计时器
          if (transferInterval.value) {
            clearInterval(transferInterval.value);
            transferInterval.value = null;
          }
        }
        
        // 重新抛出错误，让调用者知道发生了错误
        throw error;
      }
    };
    
    // 下载文件
    const downloadFile = async (file) => {
      resetError();
      
      try {
        // 重置传输状态
        isDownloading.value = true;
        downloadProgress.value = 0;
        transferSpeed.value = 0;
        
        // 构建远程路径
        const remotePath = currentPath.value === '/' ? 
          currentPath.value + file.name : 
          currentPath.value + '/' + file.name;
        
        // 定义进度回调函数
        const progressCallback = (progress) => {
          downloadProgress.value = progress;
          // 根据进度更新传输速度
          updateTransferSpeed(file.size, progress, downloadProgress.value);
        };
        
        // 调用SFTP服务下载文件
        const blob = await sftpService.downloadFile(
          props.sessionId,
          remotePath,
          progressCallback
        );
        
        // 创建下载链接
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        
        // 清理
        setTimeout(() => {
          URL.revokeObjectURL(url);
          document.body.removeChild(a);
        }, 100);
        
        ElMessage.success(`文件 ${file.name} 下载成功`);
      } catch (error) {
        console.error('下载文件失败:', error);
        showError(`下载文件失败: ${error.message}`);
      } finally {
        // 延迟关闭下载状态
        setTimeout(() => {
          isDownloading.value = false;
        }, 500);
      }
    };
    
    // 重命名文件
    const renameFile = (file) => {
      resetError();
      
      ElMessageBox.prompt('请输入新名称', '重命名', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        inputValue: file.name,
        inputPattern: /^[^\\/:\*\?"<>\|]+$/,
        inputErrorMessage: '名称不能包含非法字符'
      }).then(async ({ value }) => {
        if (value && value !== file.name) {
          try {
            // 构建原路径和新路径
            const oldPath = currentPath.value === '/' ? 
              currentPath.value + file.name : 
              currentPath.value + '/' + file.name;
            
            const newPath = currentPath.value === '/' ? 
              currentPath.value + value : 
              currentPath.value + '/' + value;
            
            // 创建与文件列表加载一致的加载状态
            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'sftp-loading-files';
            loadingDiv.innerHTML = `
              <div class="sftp-loading-spinner">
                <svg class="circular" viewBox="25 25 50 50">
                  <circle class="path" cx="50" cy="50" r="20" fill="none"/>
                </svg>
              </div>
              <p>重命名中...</p>
            `;
            
            // 将加载状态添加到文件列表区域
            const fileListContent = document.querySelector('.sftp-file-list-content');
            if (fileListContent) {
              fileListContent.appendChild(loadingDiv);
            }
            
            // 调用SFTP服务重命名文件
            await sftpService.rename(props.sessionId, oldPath, newPath);
            
            // 移除加载状态
            if (fileListContent && loadingDiv.parentNode === fileListContent) {
              fileListContent.removeChild(loadingDiv);
            }
            
            ElMessage.success(`重命名成功: ${file.name} -> ${value}`);
            
            // 刷新目录以显示新名称
            refreshCurrentDirectory();
          } catch (error) {
            // 移除加载状态
            const loadingDiv = document.querySelector('.sftp-file-list-content .sftp-loading-files');
            if (loadingDiv && loadingDiv.parentNode) {
              loadingDiv.parentNode.removeChild(loadingDiv);
            }
            
            console.error('重命名失败:', error);
            showError(`重命名失败: ${error.message}`);
          }
        }
      }).catch(() => {
        // 用户取消
      });
    };
    
    // 删除文件
    const deleteFile = (file) => {
      resetError();
      
      // 如果是文件夹，使用不同的确认信息
      const confirmMessage = file.isDirectory ? 
        `确定要删除文件夹 ${file.name} 及其所有内容吗？此操作无法撤销。` : 
        `确定要删除 ${file.name} 吗？此操作无法撤销。`;
      
      ElMessageBox.confirm(
        confirmMessage, 
        '删除确认', 
        {
          confirmButtonText: '删除',
          cancelButtonText: '取消',
          type: 'warning'
        }
      ).then(async () => {
        try {
          // 构建完整路径
          const fullPath = currentPath.value === '/' ? 
            currentPath.value + file.name : 
            currentPath.value + '/' + file.name;
          
          // 创建与文件列表加载一致的加载状态
          const loadingDiv = document.createElement('div');
          loadingDiv.className = 'sftp-loading-files';
          loadingDiv.innerHTML = `
            <div class="sftp-loading-spinner">
              <svg class="circular" viewBox="25 25 50 50">
                <circle class="path" cx="50" cy="50" r="20" fill="none"/>
              </svg>
            </div>
            <p>${file.isDirectory ? '删除文件夹中...' : '删除文件中...'}</p>
          `;
          
          // 将加载状态添加到文件列表区域
          const fileListContent = document.querySelector('.sftp-file-list-content');
          if (fileListContent) {
            fileListContent.appendChild(loadingDiv);
          }
          
          if (file.isDirectory) {
            // 使用快速删除方法代替递归删除
            console.log(`使用快速删除方法删除文件夹: ${fullPath}`);
            await sftpService.fastDeleteDirectory(props.sessionId, fullPath);
          } else {
            // 删除单个文件
            await sftpService.delete(props.sessionId, fullPath, false);
          }
          
          // 移除加载状态
          if (fileListContent && loadingDiv.parentNode === fileListContent) {
            fileListContent.removeChild(loadingDiv);
          }
          
          ElMessage.success(`${file.isDirectory ? '文件夹' : '文件'} ${file.name} 已删除`);
          
          // 刷新目录以移除已删除文件
          refreshCurrentDirectory();
        } catch (error) {
          // 移除加载状态
          const loadingDiv = document.querySelector('.sftp-file-list-content .sftp-loading-files');
          if (loadingDiv && loadingDiv.parentNode) {
            loadingDiv.parentNode.removeChild(loadingDiv);
          }
          
          console.error('删除失败:', error);
          showError(`删除失败: ${error.message}`);
        }
      }).catch(() => {
        // 用户取消
      });
    };
    
    // 处理拖拽上传
    const handleDrop = async (event) => {
      isDragOver.value = false;
      event.preventDefault();
      
      // 重置上传状态，确保可以正确开始新的上传
      isUploading.value = true;
      uploadProgress.value = 0;
      
      // 获取拖拽的文件
      const files = event.dataTransfer.files;
      if (files && files.length > 0) {
        try {
          // 处理所有文件，可能包括文件夹
          // 通过webkitGetAsEntry API来识别文件和文件夹
          const items = event.dataTransfer.items;
          if (items) {
            // 检查是否支持webkitGetAsEntry
            if (items[0].webkitGetAsEntry) {
              const entries = [];
              for (let i = 0; i < items.length; i++) {
                const entry = items[i].webkitGetAsEntry();
                if (entry) {
                  entries.push(entry);
                }
              }
              
              // 处理所有文件和目录
              await processEntries(entries);
            } else {
              // 如果不支持webkitGetAsEntry，使用旧方法处理
              await uploadMultipleFiles(files);
            }
          } else {
            // 如果不支持items，直接使用files处理
            await uploadMultipleFiles(files);
          }
        } catch (error) {
          console.error('拖放上传处理失败:', error);
          ElMessage.error(`上传失败: ${error.message}`);
          
          // 确保重置上传状态
          isUploading.value = false;
          
          // 清除计时器
          if (transferInterval.value) {
            clearInterval(transferInterval.value);
            transferInterval.value = null;
          }
          
          // 刷新目录
          refreshCurrentDirectory();
        }
      } else {
        // 如果没有文件，重置上传状态
        isUploading.value = false;
      }
    };
    
    // 处理文件系统条目（可能是文件或文件夹）
    const processEntries = async (entries) => {
      // 确认批量上传
      if (entries.length > 1) {
        try {
          await ElMessageBox.confirm(
            `您选择了${entries.length}个项目，确定要全部上传吗？`, 
            '批量上传确认', 
            {
              confirmButtonText: '全部上传',
              cancelButtonText: '取消',
              type: 'warning'
            }
          );
        } catch (e) {
          isUploading.value = false; // 用户取消，重置上传状态
          return; // 用户取消了上传
        }
      }
      
      // 用于追踪文件总数和已处理文件数
      let totalFiles = 0;
      let processedFiles = 0;
      let totalBytes = 0;
      let uploadedBytes = 0;
      
      // 提前计算文件总数和总大小
      const countFiles = async (entry) => {
        if (entry.isFile) {
          totalFiles++;
          return new Promise((resolve) => {
            entry.file(file => {
              totalBytes += file.size;
              resolve();
            }, () => resolve());
          });
        } else if (entry.isDirectory) {
          const dirReader = entry.createReader();
          return new Promise((resolve) => {
            dirReader.readEntries(async (entries) => {
              const promises = [];
              for (const childEntry of entries) {
                promises.push(countFiles(childEntry));
              }
              await Promise.all(promises);
              resolve();
            }, () => resolve());
          });
        }
      };
      
      // 计算所有条目中的文件总数和大小
      const countPromises = [];
      for (const entry of entries) {
        countPromises.push(countFiles(entry));
      }
      await Promise.all(countPromises);
      
      console.log(`总共需要上传 ${totalFiles} 个文件，总大小 ${formatFileSize(totalBytes)}`);
      
      // 如果没有文件需要上传，结束处理
      if (totalFiles === 0) {
        isUploading.value = false;
        ElMessage.info('选择的文件夹为空，没有文件需要上传');
        return;
      }
      
      // 设置初始上传状态
      isUploading.value = true;
      uploadProgress.value = 0;
      transferSpeed.value = 0;
      transferStartTime.value = Date.now();
      
      // 开始定期更新速度
      let lastUpdateTime = Date.now();
      let lastUploadedBytes = 0;
      
      // 清除之前的计时器
      if (transferInterval.value) {
        clearInterval(transferInterval.value);
        transferInterval.value = null;
      }
      
      // 创建计时器来更新传输速度 - 更频繁地更新UI
      transferInterval.value = setInterval(() => {
        const now = Date.now();
        const timeDelta = (now - lastUpdateTime) / 1000;
        if (timeDelta > 0) {
          const bytesDelta = uploadedBytes - lastUploadedBytes;
          if (bytesDelta > 0) {
            const currentSpeed = bytesDelta / timeDelta;
            transferSpeed.value = transferSpeed.value === 0 ? 
              currentSpeed : (transferSpeed.value * 0.7 + currentSpeed * 0.3);
          }
          lastUpdateTime = now;
          lastUploadedBytes = uploadedBytes;
        }
      }, 300); // 更高的更新频率
      
      // 重置上传ID
      currentUploadId.value = null;
      
      // 用于跟踪实际上传成功的文件
      let actualUploadedFiles = 0;
      let actualUploadedBytes = 0;
      
      try {
        // 处理每一个条目
        for (const entry of entries) {
          if (entry.isFile) {
            // 处理文件
            const result = await processFileEntry(entry, '', (file, bytesUploaded, isPartial) => {
              if (!isPartial) {
                processedFiles++;
                actualUploadedFiles++;
                actualUploadedBytes += bytesUploaded;
              }
              uploadedBytes += bytesUploaded;
              currentUploadingFile.value = file.name;
              uploadProgress.value = Math.floor((uploadedBytes / totalBytes) * 100);
            });
          } else if (entry.isDirectory) {
            // 处理目录
            await processDirectoryEntry(entry, '', (file, bytesUploaded, isPartial) => {
              if (!isPartial) {
                processedFiles++;
                actualUploadedFiles++;
                actualUploadedBytes += bytesUploaded;
              }
              uploadedBytes += bytesUploaded;
              currentUploadingFile.value = file.name;
              uploadProgress.value = Math.floor((uploadedBytes / totalBytes) * 100);
            });
          }
        }
        
        // 确保进度条显示100%
        uploadProgress.value = 100;
        
        // 显示完成消息 - 使用实际上传成功的文件数量和大小
        ElMessage.success(`成功上传了${actualUploadedFiles}个文件，总大小${formatFileSize(actualUploadedBytes)}`);
        
        // 重置状态并刷新
        isUploading.value = false;
        
        // 清除计时器
        if (transferInterval.value) {
          clearInterval(transferInterval.value);
          transferInterval.value = null;
        }
        
        // 最后只刷新一次
        refreshCurrentDirectory();
      } catch (error) {
        console.error('上传过程中发生错误:', error);
        ElMessage.error(`上传过程中发生错误: ${error.message}`);
        
        // 出错时也确保关闭进度条
        isUploading.value = false;
        
        // 清除计时器
        if (transferInterval.value) {
          clearInterval(transferInterval.value);
          transferInterval.value = null;
        }
        
        // 出错时也刷新一次
        refreshCurrentDirectory();
      }
    };
    
    // 处理文件条目
    const processFileEntry = async (fileEntry, path, onProgress) => {
      // 如果上传被取消，停止处理
      if (!isUploading.value && path !== '') {
        return;
      }
      
      return new Promise((resolve, reject) => {
        fileEntry.file(async (file) => {
          try {
            // 设置当前上传文件名以便在进度条中显示（移除百分比显示）
            currentUploadingFile.value = path ? `${path}/${file.name}` : file.name;
            
            // 构建远程路径
            const remotePath = path ? 
              (currentPath.value === '/' ? 
                currentPath.value + path + '/' + file.name : 
                currentPath.value + '/' + path + '/' + file.name) :
              (currentPath.value === '/' ? 
                currentPath.value + file.name : 
                currentPath.value + '/' + file.name);
            
            console.log(`上传文件: ${remotePath} (${formatFileSize(file.size)})`);
            
            // 跟踪上传的进度以避免重复计算
            let lastProgress = 0;
            
            // 上传文件并传递专门的进度回调
            await uploadFileToDirectoryBatch(file, remotePath, (progress, opId) => {
              // 保存操作ID用于取消上传
              if (opId && !currentUploadId.value) {
                currentUploadId.value = opId;
              }
              
              // 实时更新进度 - 每个百分比都更新
              // 为部分进度计算部分上传的字节
              const partialBytes = (file.size * progress / 100);
              
              // 当达到100%时回调上传完成
              if (progress >= 100 && typeof onProgress === 'function') {
                // 防止重复调用完成回调
                if (lastProgress < 100) {
                  onProgress(file, file.size);
                  lastProgress = 100;
                }
              } 
              // 实时更新部分进度
              else if (typeof onProgress === 'function' && progress > 0) {
                // 只计算增量进度，避免重复计算
                const progressDiff = progress - lastProgress;
                if (progressDiff > 0) {
                  const incrementalBytes = (file.size * progressDiff / 100);
                  onProgress(file, incrementalBytes, true);
                  lastProgress = progress;
                }
              }
            });
            
            resolve();
          } catch (error) {
            console.error(`处理文件失败: ${path}/${file.name}`, error);
            ElMessage.error(`上传 ${file.name} 失败: ${error.message}`);
            
            // 调用进度回调，即使失败也计入进度
            if (typeof onProgress === 'function') {
              onProgress(file, 0); // 失败时传0字节
            }
            
            resolve(); // 即使失败也继续下一个
          }
        }, (error) => {
          console.error(`读取文件失败: ${path}/${fileEntry.name}`, error);
          ElMessage.error(`读取 ${fileEntry.name} 失败`);
          
          // 调用进度回调，即使失败也计入进度
          if (typeof onProgress === 'function') {
            onProgress(file, 0);
          }
          
          resolve(); // 即使失败也继续下一个
        });
      });
    };
    
    // 处理目录条目
    const processDirectoryEntry = async (directoryEntry, path, onProgress) => {
      // 如果上传被取消，停止处理
      if (!isUploading.value && path !== '') {
        return;
      }
      
      // 构建新路径
      const newPath = path ? path + '/' + directoryEntry.name : directoryEntry.name;
      
      try {
        // 创建远程目录
        const remoteDirPath = currentPath.value === '/' ? 
          currentPath.value + newPath : 
          currentPath.value + '/' + newPath;
          
        console.log(`创建目录: ${remoteDirPath}`);
        
        try {
          // 创建远程目录
          await sftpService.createDirectory(props.sessionId, remoteDirPath);
        } catch (error) {
          // 忽略目录已存在的错误
          if (!error.message.includes('已存在')) {
            console.warn(`创建目录失败: ${remoteDirPath}`, error);
          }
        }
        
        // 读取目录内容
        const dirReader = directoryEntry.createReader();
        
        // 使用递归读取所有的文件和子目录
        const readEntries = async () => {
          return new Promise((resolve, reject) => {
            dirReader.readEntries(async (entries) => {
              try {
                // 如果还有条目，处理并继续读取
                if (entries.length > 0) {
                  const promises = [];
                  for (const entry of entries) {
                    if (entry.isFile) {
                      promises.push(processFileEntry(entry, newPath, onProgress));
                    } else if (entry.isDirectory) {
                      promises.push(processDirectoryEntry(entry, newPath, onProgress));
                    }
                  }
                  
                  // 等待所有子任务完成
                  await Promise.all(promises);
                  
                  // 继续读取，直到没有更多条目
                  await readEntries();
                }
                resolve();
              } catch (error) {
                console.error(`读取目录失败: ${newPath}`, error);
                resolve(); // 即使失败也继续
              }
            }, (error) => {
              console.error(`目录读取错误: ${newPath}`, error);
              resolve(); // 即使失败也继续
            });
          });
        };
        
        // 开始读取目录
        await readEntries();
        
      } catch (error) {
        console.error(`处理目录失败: ${newPath}`, error);
        ElMessage.error(`处理目录 ${directoryEntry.name} 失败: ${error.message}`);
      }
    };
    
    // 特殊的目录批量上传文件函数，不改变全局上传状态
    const uploadFileToDirectoryBatch = async (file, remotePath, progressCallback) => {
      return new Promise((resolve, reject) => {
        try {        
          // 调用SFTP服务上传文件
          sftpService.uploadFile(
            props.sessionId,
            file,
            remotePath,
            (progress, operationId) => {
              // 先调用原始回调 - 每次进度回调都实时更新
              if (typeof progressCallback === 'function') {
                progressCallback(progress, operationId);
              }
              
              // 当单个文件上传完成时
              if (progress >= 100) {
                // 只记录文件完成上传，不刷新目录
                console.log(`文件完成上传: ${remotePath}`);
                // 上传完成时解析Promise
                resolve();
              }
            }
          ).catch(error => {
            console.error(`上传文件失败: ${remotePath}`, error);
            reject(error);
          });
        } catch (error) {
          console.error(`初始化上传失败: ${remotePath}`, error);
          reject(error);
        }
      });
    };
    
    // 处理拖拽进入
    const handleDragOver = (event) => {
      event.preventDefault();
      isDragOver.value = true;
    };
    
    // 处理拖拽离开
    const handleDragLeave = (event) => {
      event.preventDefault();
      isDragOver.value = false;
    };
    
    // 格式化传输速度
    const formatTransferSpeed = (bytesPerSecond) => {
      if (bytesPerSecond < 1024) {
        return `${bytesPerSecond.toFixed(1)} B/s`;
      } else if (bytesPerSecond < 1024 * 1024) {
        return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
      } else {
        return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
      }
    };
    
    // 搜索文件
    const handleSearch = (query) => {
      console.log('接收到搜索查询:', query);
      
      // 如果搜索查询为空，显示所有文件
      if (!query || query.trim() === '') {
        console.log('搜索查询为空，刷新目录显示所有文件');
        refreshCurrentDirectory();
        return;
      }
      
      console.log('执行搜索:', query);
      
      // 获取原始文件列表的一个副本（如果需要刷新）
      const originalFileList = [...fileList.value]; 
      
      // 搜索当前目录中匹配的文件
      const lowercaseQuery = query.toLowerCase();
      const filteredFiles = originalFileList.filter(file => {
        // 始终保留上级目录选项
        if (file.name === '..') return true;
        
        // 文件名匹配查询
        return file.name.toLowerCase().includes(lowercaseQuery);
      });
      
      console.log(`搜索结果: 找到 ${filteredFiles.length} 个匹配项`);
      
      // 更新文件列表
      fileList.value = filteredFiles;
    };
    
    // 切换显示/隐藏隐藏文件
    const toggleHiddenFiles = (value) => {
      showHiddenFiles.value = value;
      refreshCurrentDirectory();
    };
    
    // 打开文件编辑器
    const openEditor = async (file) => {
      resetError();
      
      if (file.isDirectory) {
        return;
      }
      
      // 构建完整文件路径
      const fullPath = currentPath.value === '/' ? 
        currentPath.value + file.name : 
        currentPath.value + '/' + file.name;
      
      try {
        // 创建与文件列表加载一致的加载状态
        const loadingFileContentDiv = document.createElement('div');
        loadingFileContentDiv.className = 'sftp-loading-files';
        loadingFileContentDiv.innerHTML = `
          <div class="sftp-loading-spinner">
            <svg class="circular" viewBox="25 25 50 50">
              <circle class="path" cx="50" cy="50" r="20" fill="none"/>
            </svg>
          </div>
          <p>正在加载文件内容...</p>
        `;
        
        // 将加载状态添加到文件列表区域
        const fileListContent = document.querySelector('.sftp-file-list-content');
        if (fileListContent) {
          fileListContent.appendChild(loadingFileContentDiv);
        }
        
        // 获取文件内容
        const content = await sftpService.getFileContent(props.sessionId, fullPath);
        
        // 移除加载状态
        if (fileListContent && loadingFileContentDiv.parentNode === fileListContent) {
          fileListContent.removeChild(loadingFileContentDiv);
        }
        
        // 设置编辑器状态
        editingFilePath.value = fullPath;
        editingFileContent.value = content;
        isEditing.value = true;
      } catch (error) {
        // 移除加载状态
        const loadingFileContentDiv = document.querySelector('.sftp-file-list-content .sftp-loading-files');
        if (loadingFileContentDiv && loadingFileContentDiv.parentNode) {
          loadingFileContentDiv.parentNode.removeChild(loadingFileContentDiv);
        }
        
        console.error('加载文件内容失败:', error);
        showError(`加载文件内容失败: ${error.message}`);
      }
    };
    
    // 关闭编辑器
    const closeEditor = () => {
      isEditing.value = false;
      editingFilePath.value = '';
      editingFileContent.value = '';
    };
    
    // 处理编辑器保存事件
    const handleEditorSave = () => {
      // 刷新文件列表，以更新文件修改日期
      refreshCurrentDirectory();
    };
    
    // 初始化SFTP会话
    const initSftp = async () => {
      resetError();
      
      // 显示加载状态
      isLoadingSftp.value = true;
      
      try {
        // 如果会话ID无效，显示错误
        if (!props.sessionId) {
          showError('无效的会话ID');
          isLoadingSftp.value = false;
          return;
        }
        
        console.log(`初始化SFTP会话: ${props.sessionId}`);
        
        // 创建SFTP会话
        const result = await sftpService.createSftpSession(props.sessionId);
        
        // 获取初始路径
        let initialPath = '/root';
        if (sftpService.activeSftpSessions.has(props.sessionId)) {
          const sftpSession = sftpService.activeSftpSessions.get(props.sessionId);
          // 尝试加载/root目录，如果不存在则使用当前路径（通常是根目录）
          try {
            await sftpService.listDirectory(props.sessionId, initialPath);
            console.log(`/root目录存在，使用它作为初始目录`);
          } catch (error) {
            console.log(`/root目录不存在，使用默认路径: ${sftpSession.currentPath}`);
            initialPath = sftpSession.currentPath || '/';
          }
        }
        
        // 加载目录内容
        await loadDirectoryContents(initialPath);
        
        isLoadingSftp.value = false;
      } catch (error) {
        isLoadingSftp.value = false;
        showError(`初始化SFTP失败: ${error.message || '未知错误'}`);
        console.error('初始化SFTP会话失败:', error);
      }
    };
    
    // 组件挂载时初始化SFTP会话
    onMounted(() => {
      window.addEventListener('sftp:session-changed', handleSessionChanged);
      
      // 初始化SFTP连接
      initSftp();
    });
    
    // 组件卸载时清理资源
    onUnmounted(() => {
      window.removeEventListener('sftp:session-changed', handleSessionChanged);
      
      // 清理传输速度计算定时器
      if (transferInterval.value) {
        clearInterval(transferInterval.value);
        transferInterval.value = null;
      }
      
      // 关闭SFTP会话，清理资源
      try {
        if (props.sessionId) {
          console.log(`组件卸载，关闭SFTP会话: ${props.sessionId}`);
          // 检查会话是否仍然存在
          if (sftpService.activeSftpSessions && sftpService.activeSftpSessions.has(props.sessionId)) {
            sftpService.closeSftpSession(props.sessionId).catch(error => {
              console.error(`关闭SFTP会话失败: ${error.message || '未知错误'}`, error);
            });
          } else {
            console.log(`SFTP会话 ${props.sessionId} 已经关闭，跳过`);
          }
        }
      } catch (error) {
        console.error('清理SFTP资源时出错:', error);
      }
    });
    
    return {
      // 状态
      isResizing,
      isLoadingSftp,
      currentPath,
      fileList,
      uploadProgress,
      isUploading,
      downloadProgress,
      isDownloading,
      transferSpeed,
      hasError,
      errorMessage,
      isDragOver,
      showHiddenFiles,
      currentUploadingFile,
      currentUploadId,
      isEditing,
      editingFilePath,
      editingFileContent,
      
      // 方法
      close,
      startResizing,
      loadDirectoryContents,
      refreshCurrentDirectory,
      handleItemClick,
      createNewFolder,
      uploadFile,
      uploadFolder,
      downloadFile,
      renameFile,
      deleteFile,
      handleDragOver,
      handleDragLeave,
      handleDrop,
      handleSearch,
      toggleHiddenFiles,
      getProgressColor,
      cancelUpload,
      openEditor,
      closeEditor,
      handleEditorSave,
      
      // 格式化函数
      formatFileSize,
      formatDate,
      formatTransferSpeed,
      isTextFile
    };
  }
});
</script>

<style lang="scss">
/* SFTP加载动画样式 */
.sftp-loading-files {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100%;
  min-height: 150px;
  color: #909399;
  background-color: transparent;
  padding: 20px 0;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2;
  background-color: rgba(30, 30, 30, 0.7);
  border-radius: 4px;
  
  .sftp-loading-spinner {
    margin-bottom: 15px;
    
    .circular {
      height: 40px;
      width: 40px;
      animation: loading-rotate 2s linear infinite;
    }
    
    .path {
      stroke-dasharray: 90, 150;
      stroke-dashoffset: 0;
      stroke-width: 2;
      stroke: #409EFF;
      stroke-linecap: round;
      animation: loading-dash 1.5s ease-in-out infinite;
    }
  }
}

/* 文件列表相对定位，以便定位加载动画 */
.sftp-file-list {
  position: relative;
}

.sftp-file-list-content {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: calc(100% - 33px); /* 减去标题栏高度 */
}

@keyframes loading-rotate {
  100% {
    transform: rotate(360deg);
  }
}

@keyframes loading-dash {
  0% {
    stroke-dasharray: 1, 200;
    stroke-dashoffset: 0;
  }
  50% {
    stroke-dasharray: 90, 150;
    stroke-dashoffset: -40px;
  }
  100% {
    stroke-dasharray: 90, 150;
    stroke-dashoffset: -120px;
  }
}
</style> 