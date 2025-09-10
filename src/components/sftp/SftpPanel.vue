<template>
  <div
    class="sftp-panel-container"
    :class="{ resizing: isResizing, closing: isClosing }"
    :style="{ width: width + 'px' }"
  >
    <div class="sftp-panel-resizer" @mousedown="startResizing" />
    <div class="sftp-panel">
      <div class="sftp-panel-header">
        <h3>SFTP 文件管理器</h3>
        <button class="close-button" @click="close">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18">
            <path
              fill="currentColor"
              d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"
            />
          </svg>
        </button>
      </div>
      <div class="sftp-panel-content">
        <!-- 错误提示 -->
        <div v-if="hasError" class="sftp-error-message">
          <el-alert :title="errorMessage" type="error" :closable="false" show-icon />
        </div>

        <!-- 下载进度已移至全局通知区域 -->

        <!-- 编辑器 -->
        <div v-if="isEditing" class="sftp-editor-wrapper">
          <sftp-editor
            :session-id="sessionId"
            :file-path="editingFilePath"
            :content="editingFileContent"
            @close="closeEditor"
            @save="handleEditorSave"
          />
        </div>

        <!-- SFTP文件浏览器 -->
        <div
          v-else
          class="sftp-file-explorer"
          :class="{ 'sftp-drag-over': isDragOver }"
          @dragover.prevent="handleDragOver"
          @dragleave.prevent="handleDragLeave"
          @drop.prevent="handleDrop"
        >
          <!-- 路径导航 -->
          <sftp-path-navigator
            :current-path="currentPath"
            @navigate="loadDirectoryContents"
            @refresh="refreshCurrentDirectory"
            @toggle-hidden-files="toggleHiddenFiles"
          />

          <!-- 工具栏 -->
          <sftp-toolbar
            @upload="uploadFile"
            @upload-folder="uploadFolder"
            @new-folder="startCreateFolder"
            @new-file="startCreateFile"
            @search="handleSearch"
          />

          <!-- 文件列表 -->
          <div class="sftp-file-list">
            <div class="sftp-file-list-header">
              <div
                class="sftp-file-name sortable-header"
                :class="{ active: isActiveSort('name') }"
                @click="toggleSort('name')"
              >
                <span class="header-text">
                  名称
                  <span class="sort-indicator">{{ getSortIndicator('name') }}</span>
                </span>
              </div>
              <div
                class="sftp-file-size sortable-header"
                :class="{ active: isActiveSort('size') }"
                @click="toggleSort('size')"
              >
                <span class="header-text">
                  大小
                  <span class="sort-indicator">{{ getSortIndicator('size') }}</span>
                </span>
              </div>
              <div
                class="sftp-file-date sortable-header"
                :class="{ active: isActiveSort('date') }"
                @click="toggleSort('date')"
              >
                <span class="header-text">
                  修改日期
                  <span class="sort-indicator">{{ getSortIndicator('date') }}</span>
                </span>
              </div>
              <div class="sftp-file-actions">操作</div>
            </div>

            <div class="sftp-file-list-content">
              <!-- 加载状态 -->
              <div v-if="isLoadingSftp" class="sftp-loading-files">
                <div class="sftp-loading-spinner">
                  <svg class="circular" viewBox="25 25 50 50">
                    <circle class="path" cx="50" cy="50" r="20" fill="none" />
                  </svg>
                </div>
                <p>正在加载文件列表...</p>
              </div>

              <!-- SFTP初始化错误（内联显示） -->
              <div v-else-if="hasInitError" class="sftp-init-error">
                <div class="sftp-error-icon">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    width="48"
                    height="48"
                    fill="currentColor"
                  >
                    <path
                      d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"
                    />
                  </svg>
                </div>
                <div class="sftp-error-content">
                  <h3>SFTP连接失败</h3>
                  <p class="sftp-error-message">
                    {{ initErrorMessage }}
                  </p>
                  <div class="sftp-error-actions">
                    <button class="sftp-retry-button" @click="initSftp">重新连接</button>
                  </div>
                </div>
              </div>

              <!-- 非加载状态的内容容器 -->
              <div v-else class="sftp-content-container">
                <!-- 内联编辑器（新建文件夹或文件时显示） -->
                <sftp-inline-editor
                  v-if="isCreating"
                  ref="inlineEditor"
                  :type="creatingType"
                  @create="handleCreate"
                  @cancel="cancelCreate"
                />

                <!-- 空文件夹提示 -->
                <div v-if="sortedFileList.length === 0 && !isCreating" class="sftp-empty-folder">
                  <p>此文件夹为空</p>
                </div>

                <!-- 文件列表 -->
                <div v-if="sortedFileList.length > 0" class="sftp-file-items">
                  <sftp-file-item
                    v-for="(file, index) in sortedFileList"
                    :key="index"
                    :file="file"
                    :session-id="sessionId"
                    :current-path="currentPath"
                    @item-click="handleItemClick"
                    @download="downloadFile"
                    @delete="deleteFile"
                    @refresh="refreshCurrentDirectory"
                    @permissions="handlePermissions"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 权限编辑对话框 -->
    <sftp-permissions-dialog
      v-if="selectedFileForPermissions"
      v-model="showPermissionsDialog"
      :file="selectedFileForPermissions"
      @save="handlePermissionsSave"
    />
  </div>
</template>

<script>
import { defineComponent, ref, nextTick, onMounted, onUnmounted, watch, computed } from 'vue';
import { ElMessageBox, ElMessage } from 'element-plus';
import { sftpService } from '@/services/ssh';
import log from '@/services/log';
import { SFTP_CONSTANTS } from '@/services/constants';

// 导入子组件
import SftpFileItem from './components/SftpFileItem.vue';
import SftpInlineEditor from './components/SftpInlineEditor.vue';
import SftpToolbar from './components/SftpToolbar.vue';
import SftpPathNavigator from './components/SftpPathNavigator.vue';
import { defineAsyncComponent } from 'vue';
const SftpEditor = defineAsyncComponent(() => import('./components/SftpEditor.vue'));
import SftpPermissionsDialog from './components/SftpPermissionsDialog.vue';

// 导入可复用逻辑
import { useFileUtils } from './composables/useFileUtils';
import { useSortable } from './composables/useSortable';

export default defineComponent({
  name: 'SftpPanel',
  components: {
    SftpFileItem,
    SftpInlineEditor,
    SftpToolbar,
    SftpPathNavigator,
    SftpEditor,
    SftpPermissionsDialog
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
    const isResizing = ref(false);

    // SFTP文件管理器相关状态
    const isLoadingSftp = ref(true);
    const currentPath = ref('/');

    // 排序功能
    const { toggleSort, sortFiles, getSortIndicator, isActiveSort } = useSortable();

    // 原始文件列表（未排序）
    const rawFileList = ref([]);

    // 计算属性：排序后的文件列表
    const sortedFileList = computed(() => {
      return sortFiles(rawFileList.value);
    });

    // 内联创建状态
    const isCreating = ref(false);
    const creatingType = ref('folder'); // 'folder' 或 'file'
    const inlineEditor = ref(null);
    const showHiddenFiles = ref(false);
    // 添加上传进度状态
    const uploadProgress = ref(0);
    const isUploading = ref(false);
    const downloadProgress = ref(0);
    const isDownloading = ref(false);
    // 添加传输速度相关状态
    const transferSpeed = ref(0); // 传输速度(字节/秒)
    const transferStartTime = ref(0); // 传输开始时间
    const transferredBytes = ref(0); // 已传输字节数
    const transferInterval = ref(null); // 速度计算定时器
    // 添加错误状态
    const hasError = ref(false);
    const errorMessage = ref('');
    const hasInitError = ref(false);
    const initErrorMessage = ref('');
    // 拖拽上传状态
    const isDragOver = ref(false);
    // 权限编辑状态
    const showPermissionsDialog = ref(false);
    const selectedFileForPermissions = ref(null);

    // 添加当前上传文件名
    const currentUploadingFile = ref('');
    // 添加当前上传操作ID
    const currentUploadId = ref(null);

    // 上传通知引用，需要在组件级别定义以便取消函数访问
    let currentUploadNotification = null;

    // 添加编辑器相关状态
    const isEditing = ref(false);
    const editingFilePath = ref('');
    const editingFileContent = ref('');

    // 从可复用逻辑中获取工具函数
    const { formatFileSize, formatDate } = useFileUtils();

    // 判断是否是文本文件
    const isTextFile = filename => {
      if (!filename) return false;

      const textExtensions = [
        // 编程语言
        'js',
        'jsx',
        'ts',
        'tsx',
        'html',
        'htm',
        'css',
        'scss',
        'sass',
        'less',
        'py',
        'rb',
        'php',
        'java',
        'c',
        'cpp',
        'h',
        'hpp',
        'cs',
        'go',
        'rs',
        'swift',
        'kt',
        'dart',
        'sh',
        'bash',
        'ps1',
        'bat',
        'cmd',

        // 数据格式
        'json',
        'xml',
        'yaml',
        'yml',
        'toml',
        'ini',
        'conf',
        'properties',

        // 文本文档
        'txt',
        'md',
        'markdown',
        'rst',
        'tex',
        'log',

        // 配置文件
        'env',
        'gitignore',
        'dockerignore',
        'dockerfile',
        'editorconfig',
        'gitattributes',
        'npmrc',
        'prettierrc',
        'eslintrc'
      ];

      const ext = filename.split('.').pop().toLowerCase();
      return textExtensions.includes(ext);
    };

    // 监听sessionId的变化
    watch(
      () => props.sessionId,
      (newSessionId, oldSessionId) => {
        if (newSessionId !== oldSessionId && newSessionId) {
          log.debug(`sessionId prop变化: ${oldSessionId} -> ${newSessionId}`);
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
                  log.debug('/root目录存在，使用它作为初始目录');
                } catch (error) {
                  log.debug(`/root目录不存在，使用默认路径: ${sftpSession.currentPath}`);
                  initialPath = sftpSession.currentPath || '/';
                }
              }

              // 加载目录内容
              await loadDirectoryContents(initialPath);
              isLoadingSftp.value = false;
            } catch (error) {
              isLoadingSftp.value = false;
              showError(`会话切换失败: ${error.message || '未知错误'}`);
              log.error('会话切换失败:', error);
            }
          })();
        }
      }
    );

    // 重置错误状态
    const resetError = () => {
      hasError.value = false;
      errorMessage.value = '';
      hasInitError.value = false;
      initErrorMessage.value = '';
    };

    // 显示错误消息
    const showError = message => {
      hasError.value = true;
      errorMessage.value = message;
      ElMessage.error(message);
    };

    // 显示SFTP初始化错误（内联显示）
    const showInitError = message => {
      hasInitError.value = true;
      initErrorMessage.value = message;
      // 初始化错误不显示弹窗，只显示内联错误
    };

    // 关闭SFTP面板
    const close = () => {
      emit('close');
    };

    // 监听会话变更事件
    const handleSessionChanged = event => {
      const newSessionId = event.detail;
      log.debug(`SFTP会话变更: ${newSessionId}`);

      // 显示加载状态
      isLoadingSftp.value = true;
      // 不立即清空文件列表，保持UI稳定

      try {
        // 延迟一会儿等SFTP连接准备好，避免并发问题
        setTimeout(async () => {
          try {
            log.debug(`开始创建SFTP会话: ${newSessionId}`);

            // 创建SFTP会话
            const sessionResult = await sftpService.createSftpSession(newSessionId);
            log.debug('SFTP会话创建结果:', sessionResult);

            // 尝试进入/root目录，如果不存在则使用当前路径
            let initialPath = '/root';
            if (sftpService.activeSftpSessions.has(newSessionId)) {
              const sftpSession = sftpService.activeSftpSessions.get(newSessionId);
              try {
                await sftpService.listDirectory(newSessionId, initialPath);
                log.debug('/root目录存在，使用它作为初始目录');
              } catch (error) {
                log.debug(`/root目录不存在，使用默认路径: ${sftpSession.currentPath}`);
                initialPath = sftpSession.currentPath || '/';
              }
            }

            // 加载目录内容
            log.debug(`加载目录内容: ${initialPath}`);
            await loadDirectoryContents(initialPath);

            isLoadingSftp.value = false;
            log.debug(`SFTP会话切换完成: ${newSessionId}`);
          } catch (error) {
            isLoadingSftp.value = false;
            showInitError(`加载SFTP文件列表失败: ${error.message || '未知错误'}`);
            log.error('加载SFTP文件列表失败:', error);
          }
        }, 300);
      } catch (error) {
        isLoadingSftp.value = false;
        showInitError(`切换SFTP会话失败: ${error.message || '未知错误'}`);
        log.error('切换SFTP会话失败:', error);
      }
    };

    // 开始调整SFTP面板宽度
    const startResizing = event => {
      // 设置正在调整状态
      isResizing.value = true;

      // 记录初始鼠标位置和面板宽度
      const startX = event.clientX;
      const startWidth = props.width;

      // 创建鼠标移动和释放事件处理函数
      const handleMouseMove = moveEvent => {
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
    };

    // SFTP文件管理器方法
    // 加载当前目录文件列表
    const loadDirectoryContents = async path => {
      resetError();

      // 显示加载状态
      isLoadingSftp.value = true;
      // 不立即清空文件列表，保持UI稳定状态

      try {
        // 确保有会话ID
        if (!props.sessionId) {
          throw new Error('没有活动的SSH会话，无法使用SFTP');
        }

        log.debug(`加载目录内容: 会话ID=${props.sessionId}, 路径=${path}`);

        // 使用SFTP服务加载目录内容
        const rawFiles = await sftpService.listDirectory(props.sessionId, path);

        // 确保返回值是数组
        const files = Array.isArray(rawFiles) ? rawFiles : [];

        // 确保数据格式正确并移除返回上层目录的选项
        const processedFiles = files
          .map(file => ({
            ...file,
            // 确保size是数字类型
            size: typeof file.size === 'string' ? parseInt(file.size, 10) : file.size,
            // 确保日期是Date对象
            modifiedTime:
              file.modifiedTime instanceof Date
                ? file.modifiedTime
                : file.modifiedTime
                  ? new Date(file.modifiedTime)
                  : new Date()
          }))
          .filter(file => file.name !== '..'); // 移除返回上层目录的选项，因为已有路径导航栏

        // 如果不显示隐藏文件，过滤掉以点开头的文件
        let filteredFiles = processedFiles;
        if (!showHiddenFiles.value) {
          filteredFiles = processedFiles.filter(file => !file.name.startsWith('.'));
        }

        // 更新原始文件列表和当前路径
        rawFileList.value = filteredFiles;
        currentPath.value = path;
        isLoadingSftp.value = false;
      } catch (error) {
        log.error('加载目录内容失败:', error);
        showError(`加载目录内容失败: ${error.message}`);
        // 如果出错，提供一个空列表
        rawFileList.value = [];
        isLoadingSftp.value = false;
      }
    };

    // 刷新当前目录
    const refreshCurrentDirectory = async () => {
      log.debug(`开始刷新目录: ${currentPath.value}`);
      try {
        await loadDirectoryContents(currentPath.value);
        log.debug(`目录刷新成功: ${currentPath.value}`);
      } catch (error) {
        log.error(`目录刷新失败: ${error.message}`);
        // 出错时不抛出异常，以避免中断流程
      }
    };

    // 处理文件项单击事件
    const handleItemClick = async file => {
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
        // 构建新的路径
        const newPath =
          currentPath.value === '/'
            ? currentPath.value + file.name
            : `${currentPath.value}/${file.name}`;

        if (file.isDirectory) {
          // 进入子目录
          await loadDirectoryContents(newPath);
        } else {
          // 处理文件点击（可以在这里添加文件预览或下载逻辑）
          log.debug('点击文件:', file.name);
        }
      } catch (error) {
        log.error('打开目录失败:', error);
        showError(`打开目录失败: ${error.message}`);
        isLoadingSftp.value = false;
      }
    };

    // 开始创建文件夹（内联模式）
    const startCreateFolder = async () => {
      resetError();
      isCreating.value = true;
      creatingType.value = 'folder';

      // 等待DOM更新后聚焦输入框
      await nextTick();
      if (inlineEditor.value) {
        inlineEditor.value.focusInput();
      }
    };

    // 开始创建文件（内联模式）
    const startCreateFile = async () => {
      resetError();
      isCreating.value = true;
      creatingType.value = 'file';

      // 等待DOM更新后聚焦输入框
      await nextTick();
      if (inlineEditor.value) {
        inlineEditor.value.focusInput();
      }
    };

    // 处理创建操作
    const handleCreate = async ({ name, type }) => {
      try {
        const fullPath =
          currentPath.value === '/' ? currentPath.value + name : `${currentPath.value}/${name}`;

        // 执行实际的创建操作
        if (type === 'folder') {
          // 创建文件夹
          log.debug(`开始创建文件夹: ${fullPath}`);
          await sftpService.createDirectory(props.sessionId, fullPath);
          log.debug(`文件夹创建成功: ${fullPath}`);
          ElMessage.success(`文件夹 ${name} 创建成功`);
        } else {
          // 创建文件
          log.debug(`开始创建文件: ${fullPath}`);
          await sftpService.createFile(props.sessionId, fullPath);
          log.debug(`文件创建成功: ${fullPath}`);
          ElMessage.success(`文件 ${name} 创建成功`);
        }

        // 取消创建状态
        cancelCreate();

        // 重置内联编辑器的动画状态
        if (inlineEditor.value) {
          inlineEditor.value.resetCreating();
        }

        // 刷新目录显示新创建的项目
        log.debug(`${type === 'folder' ? '文件夹' : '文件'}创建成功，刷新目录显示: ${fullPath}`);
        await refreshCurrentDirectory();
      } catch (error) {
        // 立即重置创建状态，停止动画
        cancelCreate();

        // 重置内联编辑器的动画状态
        if (inlineEditor.value) {
          inlineEditor.value.resetCreating();
        }

        console.error(`创建${type === 'folder' ? '文件夹' : '文件'}失败:`, error);
        showError(`创建${type === 'folder' ? '文件夹' : '文件'}失败: ${error.message}`);
      }
    };

    // 取消创建
    const cancelCreate = () => {
      isCreating.value = false;
      creatingType.value = 'folder';
    };

    // 处理全局点击事件，清除创建状态
    const handleGlobalClick = event => {
      if (!isCreating.value) return;

      // 检查点击是否在内联编辑器内部
      const inlineEditorElement = inlineEditor.value?.$el;
      if (inlineEditorElement && inlineEditorElement.contains(event.target)) {
        return; // 点击在编辑器内部，不清除状态
      }

      // 检查点击是否在工具栏的创建按钮上
      const target = event.target;
      if (
        target.closest('.sftp-toolbar') &&
        (target.closest('[data-action="new-folder"]') || target.closest('[data-action="new-file"]'))
      ) {
        return; // 点击在创建按钮上，不清除状态
      }

      // 其他地方的点击都清除创建状态
      isCreating.value = false;
      log.debug('全局点击清除创建状态');
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

    // 验证文件大小
    const validateFileSize = file => {
      const maxSize = SFTP_CONSTANTS.MAX_UPLOAD_SIZE;
      if (file.size > maxSize) {
        const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
        const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(0);
        ElMessage.error(`文件 "${file.name}" 大小为 ${fileSizeMB}MB，超过最大限制 ${maxSizeMB}MB`);
        return false;
      }
      return true;
    };

    // 上传多个文件或整个文件夹
    const uploadMultipleFiles = async files => {
      if (!files || files.length === 0) return;

      // 验证所有文件大小
      const invalidFiles = [];
      const validFiles = [];

      for (const file of files) {
        if (validateFileSize(file)) {
          validFiles.push(file);
        } else {
          invalidFiles.push(file);
        }
      }

      // 如果有无效文件，显示错误信息
      if (invalidFiles.length > 0) {
        if (validFiles.length === 0) {
          // 所有文件都无效，直接返回
          return;
        } else {
          // 部分文件无效，询问是否继续上传有效文件
          try {
            await ElMessageBox.confirm(
              `${invalidFiles.length} 个文件超过大小限制将被跳过，是否继续上传其余 ${validFiles.length} 个文件？`,
              '文件大小限制',
              {
                confirmButtonText: '继续上传',
                cancelButtonText: '取消',
                type: 'warning'
              }
            );
          } catch (e) {
            return; // 用户取消了上传
          }
        }
      }

      // 使用有效文件继续上传流程
      const filesToUpload = validFiles;

      // 检查是否包含文件夹（通过检查文件的webkitRelativePath属性）
      const hasDirectories = Array.from(filesToUpload).some(
        file => file.webkitRelativePath && file.webkitRelativePath.includes('/')
      );

      if (hasDirectories) {
        // 如果包含文件夹，使用文件夹上传处理（文件夹上传有自己的进度通知）
        await uploadFileToDirectoryBatch(filesToUpload);
        return;
      }

      // 对于大于10个文件的上传，先确认
      if (filesToUpload.length > 10) {
        try {
          await ElMessageBox.confirm(
            `您选择了${filesToUpload.length}个文件，确定要全部上传吗？`,
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

      // 显示上传开始的消息通知
      let uploadCancelled = false; // 标记是否被用户取消

      // 创建上传进度条HTML（响应式弹性布局）
      const createUploadProgressHTML = (
        progress,
        currentFile,
        fileIndex,
        totalFiles,
        speedText
      ) => {
        const progressText =
          totalFiles > 1
            ? `上传进度: ${Math.floor(progress)}%${speedText ? ` (${speedText})` : ''}(${fileIndex}/${totalFiles})`
            : `上传进度: ${Math.floor(progress)}%${speedText ? ` (${speedText})` : ''}`;

        const fileName =
          currentFile.length > 30 ? `${currentFile.substring(0, 27)}...` : currentFile;

        return `
          <div class="sftp-progress-container sftp-upload-progress">
            <div class="sftp-progress-content">
              <div class="sftp-progress-text">${progressText}</div>
              <div class="sftp-progress-file">${fileName}</div>
              <div class="sftp-progress-bar">
                <div class="sftp-progress-fill" style="width: ${progress}%;"></div>
              </div>
            </div>
          </div>
        `;
      };

      // 创建带取消功能的通知
      const createUploadNotification = (message, isProgressNotification = false) => {
        const notification = ElMessage.info({
          message,
          duration: 0, // 不自动关闭
          showClose: true,
          dangerouslyUseHTMLString: isProgressNotification,
          customClass: isProgressNotification ? 'upload-progress-notification' : '',
          onClose: () => {
            // 用户点击关闭按钮时触发取消上传
            if (!uploadCancelled && isUploading.value) {
              uploadCancelled = true;
              // 直接调用取消上传，不需要额外的日志，因为cancelUpload函数内部已经有了
              cancelUpload();
            }
          }
        });
        return notification;
      };

      // 创建初始进度通知
      const initialProgress = createUploadProgressHTML(
        0,
        filesToUpload[0].name,
        1,
        filesToUpload.length,
        ''
      );
      currentUploadNotification = createUploadNotification(initialProgress, true);

      // 重置上传状态（保留原有逻辑以防其他地方依赖）
      isUploading.value = true;
      uploadProgress.value = 0;
      transferSpeed.value = 0;
      transferredBytes.value = 0;
      transferStartTime.value = Date.now();

      // 收集所有需要创建的目录路径，使用Set去重
      const dirsToCreate = new Set();
      const totalSize = Array.from(filesToUpload).reduce((total, file) => total + file.size, 0);
      let uploadedSize = 0;
      let completedFiles = 0;

      // 存储上传失败的文件
      const failedFiles = [];

      // 更新全局进度条信息
      currentUploadingFile.value = '批量上传中';

      // 预处理：收集所有需要创建的目录
      for (const file of filesToUpload) {
        const relativePath = file.webkitRelativePath || file.name;

        if (relativePath.includes('/')) {
          // 提取目录结构
          const pathParts = relativePath.split('/');
          pathParts.pop(); // 移除文件名，只保留路径部分

          if (pathParts.length > 0) {
            const currentDirPath = currentPath.value === '/' ? '/' : `${currentPath.value}/`;
            let partialPath = '';

            for (const part of pathParts) {
              partialPath += (partialPath ? '/' : '') + part;
              const dirPath =
                currentDirPath === '/'
                  ? currentDirPath + partialPath
                  : `${currentDirPath}/${partialPath}`;

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
      const updateBatchProgress = (fileProgress, fileSize, currentFileName, fileIndex) => {
        // 计算当前文件的已上传大小
        const fileUploaded = fileSize * (fileProgress / 100);

        // 更新总进度 - 防止超过100%
        const totalProgress = Math.min(
          100,
          Math.floor(((uploadedSize + fileUploaded) / totalSize) * 100)
        );
        uploadProgress.value = totalProgress;

        // 更新传输速度
        const now = Date.now();
        const timeDelta = (now - transferStartTime.value) / 1000;
        let speedText = '';
        if (timeDelta > 0) {
          transferSpeed.value = (uploadedSize + fileUploaded) / timeDelta;
          speedText = formatTransferSpeed(transferSpeed.value);
        }

        // 更新进度通知
        if (currentUploadNotification && !uploadCancelled) {
          const progressHTML = createUploadProgressHTML(
            totalProgress,
            currentFileName,
            fileIndex,
            filesToUpload.length,
            speedText
          );
          const notificationEl = document.querySelector(
            '.upload-progress-notification .el-message__content'
          );
          if (notificationEl) {
            notificationEl.innerHTML = progressHTML;
          }
        }
      };

      // 实际成功上传的文件大小
      let actualUploadedSize = 0;

      // 开始上传文件
      for (let i = 0; i < filesToUpload.length; i++) {
        // 如果上传被取消，则停止
        if (!isUploading.value || uploadCancelled) {
          log.info('上传被取消，停止处理剩余文件');
          break;
        }

        const file = filesToUpload[i];

        // 更新当前上传文件名和进度信息
        currentUploadingFile.value = file.name;

        try {
          // 获取文件的相对路径部分
          const relativePath = file.webkitRelativePath || file.name;

          // 构建完整的远程路径
          let remotePath;
          if (relativePath.includes('/')) {
            remotePath =
              currentPath.value === '/'
                ? currentPath.value + relativePath
                : `${currentPath.value}/${relativePath}`;
          } else {
            remotePath =
              currentPath.value === '/'
                ? currentPath.value + file.name
                : `${currentPath.value}/${file.name}`;
          }

          // 记录文件大小，用于进度计算
          const fileSize = file.size;
          log.debug(`上传文件: ${remotePath} (${formatFileSize(fileSize)})`);

          // 跟踪当前文件上传进度，防止重复计算
          let _lastFileProgress = 0;
          let fileCompleted = false; // 防止重复记录完成日志

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
              updateBatchProgress(progress, fileSize, file.name, i + 1);

              // 当单个文件上传完成时，只记录一次
              if (progress >= 100 && !fileCompleted) {
                fileCompleted = true;
                log.debug(`文件完成上传: ${remotePath}`);
                // 重置最后进度以避免重复计算
                _lastFileProgress = 100;
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
          log.error(`上传失败: ${file.name}`, error);
          failedFiles.push({ name: file.name, error: error.message });
          // 继续上传下一个文件，不中断整个过程
        }
      }

      log.debug('所有文件上传完成，准备显示结果和刷新目录...');

      // 添加一个强制执行标记
      let finishExecuted = false;

      // 创建一个完成上传的函数，确保只执行一次
      const finishUpload = async () => {
        // 如果已经执行过，直接返回
        if (finishExecuted) return;
        finishExecuted = true;

        log.debug('执行文件上传完成操作');

        // 关闭上传通知
        if (currentUploadNotification) {
          currentUploadNotification.close();
        }

        // 检查是否被用户取消
        if (uploadCancelled) {
          // 用户取消时不显示额外消息，因为cancelUpload函数已经显示了"上传已取消"
          log.info('用户取消上传，部分文件已上传');
        } else {
          // 全部上传完成，显示结果 - 使用实际成功上传的文件数量和大小
          if (failedFiles.length > 0) {
            // 有失败的文件
            const failMessage = `上传完成，成功${completedFiles}个文件(${formatFileSize(actualUploadedSize)})，失败${failedFiles.length}个文件`;
            ElMessage.warning(failMessage);
            log.warn('上传失败的文件:', failedFiles);
          } else {
            // 全部成功
            ElMessage.success(
              `成功上传${completedFiles}个文件，总大小${formatFileSize(actualUploadedSize)}`
            );
          }
        }

        // 重置上传状态
        isUploading.value = false;
        uploadProgress.value = 100; // 确保进度条显示完成

        // 清除计时器
        if (transferInterval.value) {
          clearInterval(transferInterval.value);
          transferInterval.value = null;
        }

        // 一次性刷新目录（仅在未被取消时刷新，因为取消时cancelUpload已经刷新了）
        if (!uploadCancelled) {
          try {
            log.debug('开始刷新目录...');
            await loadDirectoryContents(currentPath.value);
            log.debug('目录刷新完成');
          } catch (error) {
            log.error('刷新目录失败:', error);
          }
        }
      };

      // 立即调用完成函数
      await finishUpload();

      // 不再需要设置备用超时，上面的函数已经确保会执行
    };

    // 获取进度条颜色
    const getProgressColor = progress => {
      const computedStyle = getComputedStyle(document.documentElement);
      if (progress < 30) return computedStyle.getPropertyValue('--sftp-progress-low').trim();
      if (progress < 70) return computedStyle.getPropertyValue('--sftp-progress-medium').trim();
      return computedStyle.getPropertyValue('--sftp-progress-high').trim();
    };

    // 取消上传
    const cancelUpload = async () => {
      log.info('用户取消了文件上传');

      // 立即显示取消确认消息
      ElMessage.info('上传已取消');

      if (currentUploadId.value) {
        try {
          await sftpService.cancelUpload(props.sessionId, currentUploadId.value);
          log.debug('已取消上传操作:', currentUploadId.value);
        } catch (error) {
          log.warn('取消上传操作失败:', error);
        }
      }

      // 关闭上传通知
      if (currentUploadNotification) {
        currentUploadNotification.close();
      }

      // 临时删除已部分上传的文件
      if (isUploading.value && currentUploadingFile.value) {
        const remotePath = `${currentPath.value === '/' ? '' : currentPath.value}/${currentUploadingFile.value}`;
        try {
          await sftpService.deleteFile(props.sessionId, remotePath);
          log.debug('已删除文件:', remotePath);
        } catch (error) {
          // 忽略文件不存在的情况
          log.warn('删除文件失败:', error);
        }
      }

      // 重置状态
      isUploading.value = false;
      uploadProgress.value = 0;
      currentUploadingFile.value = '';

      // 手动取消事件处理
      try {
        if (currentUploadId.value) {
          await sftpService.cancelUpload(props.sessionId, currentUploadId.value);
        }
      } catch (error) {
        log.error('取消上传失败:', error);
      } finally {
        currentUploadId.value = null;
      }

      // 立即刷新目录
      try {
        log.debug('开始刷新目录...');
        await loadDirectoryContents(currentPath.value);
        log.debug('目录刷新完成');
      } catch (error) {
        log.error('刷新目录失败:', error);
      }
    };

    // 上传文件到服务器
    const _uploadFileToServer = async (file, customRemotePath, isBatchUpload = false) => {
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
        const remotePath =
          customRemotePath ||
          (currentPath.value === '/'
            ? currentPath.value + file.name
            : `${currentPath.value}/${file.name}`);

        // 定义进度回调函数
        const progressCallback = (progress, operationId) => {
          // 保存操作ID用于取消上传
          if (operationId && !currentUploadId.value) {
            currentUploadId.value = operationId;
          }

          // 如果是批量上传的一部分，不更新总进度
          if (isBatchUpload) return;

          const now = Date.now();
          const newTransferredBytes = Math.floor((file.size * progress) / 100);
          const bytesDelta = newTransferredBytes - transferredBytes.value;
          const timeDelta = (now - transferStartTime.value) / 1000;

          // 更新进度
          uploadProgress.value = progress;

          // 只有当有实际进度变化时才更新速度
          if (bytesDelta > 0 && timeDelta > 0) {
            // 计算当前速度 (bytes/s)
            const currentSpeed = bytesDelta / timeDelta;

            // 更新传输速度 (使用加权平均实现平滑过渡)
            transferSpeed.value =
              transferSpeed.value === 0
                ? currentSpeed
                : transferSpeed.value * 0.7 + currentSpeed * 0.3;

            // 更新状态
            transferredBytes.value = newTransferredBytes;
            transferStartTime.value = now;
          }

          // 当上传完成时(进度为100%)
          if (progress >= 100 && !isBatchUpload) {
            // 记录上传完成时间
            const uploadEndTime = Date.now();
            const _totalTimeSeconds = ((uploadEndTime - transferStartTime.value) / 1000).toFixed(2);

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
              log.debug('已刷新目录:', currentPath.value);
            }, 1500);
          }
        };

        // 调用SFTP服务上传文件
        await sftpService.uploadFile(props.sessionId, file, remotePath, progressCallback);

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
            log.debug('已刷新目录:', currentPath.value);
          }, 1500);
        } else if (!isBatchUpload) {
          // 如果已经处理了100%进度，只显示成功消息
          ElMessage.success(`文件 ${file.name} 上传成功`);
        }
      } catch (error) {
        log.error('上传文件失败:', error);

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

    // 下载文件或文件夹
    const downloadFile = async file => {
      // 根据文件类型选择不同的下载方法
      if (file.isDirectory) {
        await downloadFolder(file);
      } else {
        await downloadSingleFile(file);
      }
    };

    // 下载单个文件
    const downloadSingleFile = async file => {
      resetError();

      // 立即显示下载确认消息
      ElMessage.info(`正在下载文件 ${file.name}...`);

      // 创建下载进度通知（外部声明，try/catch 内部均可访问）
      let progressNotification = null;

      try {
        // 重置传输状态
        isDownloading.value = true;
        downloadProgress.value = 0;
        transferSpeed.value = 0;
        transferStartTime.value = Date.now();

        // 构建远程路径
        const remotePath =
          currentPath.value === '/'
            ? currentPath.value + file.name
            : `${currentPath.value}/${file.name}`;

        // 进度通知的创建在首次渲染时进行

        // 创建进度条HTML（响应式弹性布局）
        const createProgressHTML = (progress, speedText) => {
          return `
            <div class="sftp-progress-container">
              <div class="sftp-progress-content">
                <div class="sftp-progress-text">下载进度: ${Math.floor(progress)}%${speedText ? ` (${speedText})` : ''}</div>
                <div class="sftp-progress-bar">
                  <div class="sftp-progress-fill" style="width: ${progress}%;"></div>
                </div>
              </div>
              <button class="sftp-progress-cancel-btn download-cancel-btn" title="取消">
                <svg viewBox="0 0 16 16" width="16" height="16">
                  <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" fill="currentColor"/>
                </svg>
              </button>
            </div>
          `;
        };

        // 更新进度条内容（避免重新创建取消按钮）
        const updateProgressContent = (notificationEl, progress, speedText) => {
          const textEl = notificationEl.querySelector('.sftp-progress-text');
          const fillEl = notificationEl.querySelector('.sftp-progress-fill');

          if (textEl) {
            textEl.textContent = `下载进度: ${Math.floor(progress)}%${speedText ? ` (${speedText})` : ''}`;
          }
          if (fillEl) {
            fillEl.style.width = `${progress}%`;
          }
        };

        // 定义进度回调函数（平滑渲染 + 取消）
        let lastBytes = 0;
        let lastTs = Date.now();
        let lastPct = 0;
        let lastRenderTs = 0;
        let singleCompleted = false;

        // 用于保存operationId的变量
        let singleOpId = null;

        const progressCallback = (progress, meta) => {
          // 第一次进度回调时，如果还没有operationId，从meta中获取
          if (!singleOpId && meta && meta.operationId) {
            singleOpId = meta.operationId;
          }

          // 优先使用服务端的bytes统计（压缩后的准确进度）
          if (meta && typeof meta.bytesTransferred === 'number') {
            let pct = 0;
            // 对于压缩下载，优先使用estimatedSize计算更准确的进度
            if (typeof meta.estimatedSize === 'number' && meta.estimatedSize > 0) {
              pct = Math.min(
                100,
                Math.max(0, Math.floor((meta.bytesTransferred / meta.estimatedSize) * 1000) / 10)
              );
            } else if (typeof meta.totalBytes === 'number' && meta.totalBytes > 0) {
              pct = Math.min(
                100,
                Math.max(0, Math.floor((meta.bytesTransferred / meta.totalBytes) * 1000) / 10)
              );
            }
            if (!singleCompleted && pct >= 100) pct = 99;
            if (pct < lastPct) pct = lastPct;
            downloadProgress.value = pct;
          } else if (typeof progress === 'number') {
            let pct = typeof progress === 'number' ? progress : 0;
            if (!singleCompleted && pct >= 100) pct = 99;
            if (pct < lastPct) pct = lastPct;
            downloadProgress.value = pct;
          }

          // 计算传输速度
          let speedText = '';
          const now = Date.now();
          if (meta && typeof meta.bytesTransferred === 'number') {
            const deltaBytes = meta.bytesTransferred - lastBytes;
            const deltaTime = (now - lastTs) / 1000;
            if (deltaBytes >= 0 && deltaTime > 0) {
              transferSpeed.value = deltaBytes / deltaTime;
              speedText = formatTransferSpeed(transferSpeed.value);
              lastBytes = meta.bytesTransferred;
              lastTs = now;
            }
          } else {
            const timeDelta = (now - transferStartTime.value) / 1000;
            if (timeDelta > 0) {
              transferSpeed.value = (file.size * (downloadProgress.value || 0)) / 100 / timeDelta;
              speedText = formatTransferSpeed(transferSpeed.value);
            }
          }

          // 节流渲染：>=0.2% 或 250ms
          const shouldRender = downloadProgress.value - lastPct >= 0.2 || now - lastRenderTs >= 250;
          if (!shouldRender) return;
          lastPct = downloadProgress.value;
          lastRenderTs = now;

          // 更新或创建进度通知
          if (!progressNotification) {
            progressNotification = ElMessage({
              message: createProgressHTML(downloadProgress.value, speedText),
              type: 'info',
              duration: 0, // 不自动关闭
              showClose: false,
              dangerouslyUseHTMLString: true,
              customClass: 'download-progress-notification'
            });
          } else {
            const notificationEl = document.querySelector(
              '.download-progress-notification .el-message__content'
            );
            if (notificationEl) {
              // 使用新的更新方法，避免重新创建按钮
              updateProgressContent(notificationEl, downloadProgress.value, speedText);
            }
          }

          // 绑定取消
          const cancelBtn = document.querySelector(
            '.download-progress-notification .download-cancel-btn'
          );
          if (cancelBtn && !cancelBtn._bound) {
            cancelBtn._bound = true;
            cancelBtn.addEventListener('click', () => {
              if (singleOpId) sftpService.cancelOperation(singleOpId);
              if (progressNotification) progressNotification.close();
              ElMessage.info('已取消下载');
            });
          }
        };

        // 调用SFTP服务下载文件
        const { blob } = await sftpService.downloadFileBinary(
          props.sessionId,
          remotePath,
          progressCallback
        );
        singleCompleted = true;

        // 关闭进度通知
        if (progressNotification) {
          progressNotification.close();
        }

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

        log.info(`文件下载完成: ${file.name}, 大小: ${blob.size} 字节`);

        ElMessage.success({
          message: `文件 ${file.name} 下载成功`,
          type: 'success',
          duration: 3000
        });
      } catch (error) {
        // 检查是否是用户主动取消的操作
        if (error.message && error.message.includes('操作已取消')) {
          // 用户主动取消，不显示错误信息，记录信息级日志
          log.info('用户取消了文件下载操作');
          return;
        }

        log.error('下载文件失败:', error);

        // 关闭进度通知
        if (progressNotification) {
          progressNotification.close();
        }

        // 根据错误类型提供更友好的错误信息
        let errorMessage = '下载文件失败';
        if (error.message.includes('超时')) {
          errorMessage = '下载文件超时，请检查网络连接';
        } else if (error.message.includes('权限')) {
          errorMessage = `没有权限访问文件 "${file.name}"`;
        } else if (error.message.includes('不存在')) {
          errorMessage = `文件 "${file.name}" 不存在或已被删除`;
        } else if (error.message.includes('太大')) {
          errorMessage = `文件 "${file.name}" 太大，无法下载`;
        } else if (error.message.includes('已取消')) {
          ElMessage.info('已取消下载');
          return;
        } else {
          errorMessage = `下载文件失败: ${error.message}`;
        }

        showError(errorMessage);

        // 显示错误通知
        ElMessage.error({
          message: errorMessage,
          duration: 5000
        });
      } finally {
        // 延迟关闭下载状态
        setTimeout(() => {
          isDownloading.value = false;
        }, 500);
      }
    };

    // 下载文件夹
    const downloadFolder = async folder => {
      resetError();

      // 显示确认对话框
      try {
        await ElMessageBox.confirm(
          `确定要下载文件夹 "${folder.name}" 吗？\n\n文件夹将被压缩后下载，可能需要一些时间。`,
          '下载文件夹',
          {
            confirmButtonText: '开始下载',
            cancelButtonText: '取消',
            type: 'info',
            distinguishCancelAndClose: true
          }
        );
      } catch (action) {
        // 用户取消下载
        if (action === 'cancel' || action === 'close') {
          return;
        }
      }

      // 立即显示下载确认消息
      ElMessage.info(`正在打包并下载文件夹 ${folder.name}...`);

      // 创建文件夹下载进度通知（移到try外部）
      let progressNotification = null;

      try {
        // 重置传输状态
        isDownloading.value = true;
        downloadProgress.value = 0;
        transferSpeed.value = 0;
        transferStartTime.value = Date.now();

        // 构建远程路径
        const remotePath =
          currentPath.value === '/'
            ? currentPath.value + folder.name
            : `${currentPath.value}/${folder.name}`;

        // 创建进度条HTML（响应式弹性布局）
        const createProgressHTML = (progress, speedText, phaseText) => {
          return `
            <div class="sftp-progress-container">
              <div class="sftp-progress-content">
                <div class="sftp-progress-text">
                  <span class="sftp-progress-phase">${phaseText || '准备中'}</span>
                  <span class="sftp-progress-sep"> | </span>
                  <span class="sftp-progress-pct">进度: ${Math.floor(progress)}%</span>
                  <span class="sftp-progress-speed">(${speedText || ''})</span>
                </div>
                <div class="sftp-progress-bar">
                  <div class="sftp-progress-fill" style="width: ${progress}%;"></div>
                </div>
              </div>
              <button class="sftp-progress-cancel-btn download-cancel-btn" title="取消">
                <svg viewBox="0 0 16 16" width="16" height="16">
                  <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" fill="currentColor"/>
                </svg>
              </button>
            </div>
          `;
        };

        // 更新进度条内容（避免重新创建取消按钮）
        const updateProgressContent = (notificationEl, progress, speedText, phaseText) => {
          const textEl = notificationEl.querySelector('.sftp-progress-text');
          const fillEl = notificationEl.querySelector('.sftp-progress-fill');

          if (textEl) {
            textEl.innerHTML = `
              <span class="sftp-progress-phase">${phaseText || '准备中'}</span>
              <span class="sftp-progress-sep"> | </span>
              <span class="sftp-progress-pct">进度: ${Math.floor(progress)}%</span>
              <span class="sftp-progress-speed">(${speedText || ''})</span>
            `;
          }
          if (fillEl) {
            fillEl.style.width = `${progress}%`;
          }
        };

        // 定义进度回调函数
        // 记录上次字节数用于计算实时速度
        let lastBytes = 0;
        let lastTs = Date.now();
        // 速度平滑与防闪烁
        let speedEma = 0; // 指数滑动平均
        let lastSpeedUpdateTs = 0;
        const SPEED_HOLD_MS = 1500; // 1.5s 内无新采样，保留上次速度
        const SPEED_ALPHA = 0.25; // EMA 系数
        // 滑动窗口平均，降低瞬时尖峰
        const SPEED_WINDOW_MS = 2000; // 2秒窗口
        const speedSamples = []; // [{ts, bytes}]
        let lastRenderedPct = 0;
        let lastRenderTs = 0;
        let isCompleted = false;

        // 用于保存operationId的变量
        let currentOperationId = null;

        const progressCallback = (progress, meta) => {
          // 第一次进度回调时，如果还没有operationId，从meta中获取
          if (!currentOperationId && meta && meta.operationId) {
            currentOperationId = meta.operationId;
          }

          // 阶段说明
          let phaseText = '准备中';
          if (meta && typeof meta.phase === 'string') {
            switch (meta.phase) {
              case 'transferring':
                phaseText = '传输中';
                break;
              case 'completed':
                phaseText = '完成';
                break;
              case 'preparing':
                phaseText = '准备中';
                break;
              default:
                phaseText = meta.phase; // 原样显示
            }
          }
          // 优先使用服务端的字节统计计算百分比（压缩后的准确进度）
          if (meta && typeof meta.bytesTransferred === 'number') {
            let pct = 0;
            // 对于压缩下载，优先使用estimatedSize计算更准确的进度
            if (typeof meta.estimatedSize === 'number' && meta.estimatedSize > 0) {
              pct = Math.min(
                100,
                Math.max(0, Math.floor((meta.bytesTransferred / meta.estimatedSize) * 1000) / 10)
              );
            } else if (typeof meta.totalBytes === 'number' && meta.totalBytes > 0) {
              pct = Math.min(
                100,
                Math.max(0, Math.floor((meta.bytesTransferred / meta.totalBytes) * 1000) / 10)
              );
            }
            if (!isCompleted && pct >= 100) pct = 99; // 完成前最多到99，避免100来回跳
            if (pct < lastRenderedPct) pct = lastRenderedPct; // 保证单调不减
            downloadProgress.value = pct;
          } else if (typeof progress === 'number') {
            let pct = progress;
            if (!isCompleted && pct >= 100) pct = 99;
            if (pct < lastRenderedPct) pct = lastRenderedPct;
            downloadProgress.value = pct;
          }

          // 计算传输速度（基于bytes delta）+ EMA 平滑 + 保留上次值避免闪烁
          let speedText = '';
          const now = Date.now();
          if (meta && typeof meta.bytesTransferred === 'number') {
            const deltaBytes = meta.bytesTransferred - lastBytes;
            const deltaTime = (now - lastTs) / 1000;

            // 更新滑动窗口样本
            speedSamples.push({ ts: now, bytes: meta.bytesTransferred });
            // 移除过期样本
            while (speedSamples.length > 1 && now - speedSamples[0].ts > SPEED_WINDOW_MS) {
              speedSamples.shift();
            }

            // 计算窗口平均速度（至少覆盖250ms以避免极小时间片）
            let avgBps = 0;
            if (speedSamples.length >= 2) {
              const first = speedSamples[0];
              const last = speedSamples[speedSamples.length - 1];
              const dt = (last.ts - first.ts) / 1000;
              if (dt >= 0.25) {
                const db = Math.max(0, last.bytes - first.bytes);
                avgBps = db / dt;
              }
            }

            if (avgBps > 0) {
              transferSpeed.value = avgBps;
              speedText = formatTransferSpeed(transferSpeed.value);
            } else if (deltaBytes >= 0 && deltaTime > 0) {
              // 回退使用 EMA
              const instant = deltaBytes / deltaTime;
              speedEma =
                speedEma === 0 ? instant : SPEED_ALPHA * instant + (1 - SPEED_ALPHA) * speedEma;
              transferSpeed.value = speedEma;
              speedText = formatTransferSpeed(transferSpeed.value);
            }

            lastBytes = meta.bytesTransferred;
            lastTs = now;
            lastSpeedUpdateTs = now;
          } else {
            // 回退：按时间和进度估算
            const timeDelta = (now - transferStartTime.value) / 1000;
            if (timeDelta > 0 && typeof downloadProgress.value === 'number') {
              transferSpeed.value = (downloadProgress.value * 1024 * 1024) / timeDelta; // 估算
              speedText = formatTransferSpeed(transferSpeed.value);
              lastSpeedUpdateTs = now;
            }
          }

          // 本次未得到新速度，但仍在保持期内，沿用上次速度以避免闪烁
          if (!speedText && lastSpeedUpdateTs && now - lastSpeedUpdateTs <= SPEED_HOLD_MS) {
            speedText = formatTransferSpeed(transferSpeed.value);
          }

          // 节流渲染，避免闪烁：1%变化或150ms间隔才更新
          const shouldRender =
            downloadProgress.value - lastRenderedPct >= 0.2 || now - lastRenderTs >= 250;
          if (!shouldRender) return;
          lastRenderedPct = downloadProgress.value;
          lastRenderTs = now;

          // 更新或创建进度通知
          if (!progressNotification) {
            progressNotification = ElMessage({
              message: createProgressHTML(downloadProgress.value, speedText, phaseText),
              type: 'info',
              duration: 0, // 不自动关闭
              showClose: false,
              dangerouslyUseHTMLString: true,
              customClass: 'download-progress-notification'
            });
          } else {
            // 使用新的更新方法，避免重新创建按钮
            const notificationEl = document.querySelector(
              '.download-progress-notification .el-message__content'
            );
            if (notificationEl) {
              updateProgressContent(notificationEl, downloadProgress.value, speedText, phaseText);
            }
          }

          // 绑定取消按钮点击（每次更新后重新绑定）
          const cancelBtn = document.querySelector(
            '.download-progress-notification .download-cancel-btn'
          );
          if (cancelBtn && !cancelBtn._bound) {
            cancelBtn._bound = true;
            cancelBtn.addEventListener('click', () => {
              if (currentOperationId) {
                sftpService.cancelOperation(currentOperationId);
              }
              if (progressNotification) progressNotification.close();
              ElMessage.info('已取消下载');
            });
          }
        };

        // 调用SFTP服务下载文件夹（传入正确的进度回调）
        const result = await sftpService.downloadFolder(
          props.sessionId,
          remotePath,
          progressCallback
        );
        isCompleted = true;

        // 关闭进度通知
        if (progressNotification) {
          progressNotification.close();
        }

        // 验证下载结果
        if (!result.blob || !(result.blob instanceof Blob)) {
          throw new Error('下载失败: 无效的文件数据');
        }

        if (typeof result.blob.size !== 'number' || result.blob.size <= 0) {
          throw new Error('下载失败: 文件大小无效');
        }

        // 创建下载链接
        let url;
        try {
          url = URL.createObjectURL(result.blob);
        } catch (urlError) {
          log.warn('创建下载链接失败，尝试备用方案', { error: urlError.message });

          try {
            // 备用方案: 重新创建Blob对象
            const newBlob = new Blob([result.blob], {
              type: result.blob.type || 'application/octet-stream'
            });
            url = URL.createObjectURL(newBlob);
          } catch (retryError) {
            log.error('下载链接创建失败', { error: retryError.message });
            throw new Error('无法创建下载链接，请重试');
          }
        }
        const a = document.createElement('a');
        a.href = url;
        a.download = result.filename || `${folder.name}`;
        document.body.appendChild(a);
        a.click();

        // 清理
        setTimeout(() => {
          URL.revokeObjectURL(url);
          document.body.removeChild(a);
        }, 100);

        const sizeText =
          result.blob.size > 1024 * 1024
            ? `${(result.blob.size / 1024 / 1024).toFixed(2)}MB`
            : `${(result.blob.size / 1024).toFixed(1)}KB`;

        log.info(`文件夹下载完成: ${folder.name}, 大小: ${sizeText}`);

        // 显示下载完成消息
        ElMessage.success({
          message: `文件夹 ${folder.name} 下载成功 (${sizeText})`,
          type: 'success',
          duration: 3000
        });

        // 如果有跳过的文件，显示详细报告
        if (result && (result.skippedFiles?.length > 0 || result.errorFiles?.length > 0)) {
          showDownloadReport(folder.name, result);
        }
      } catch (error) {
        // 检查是否是用户主动取消的操作
        if (error.message && error.message.includes('操作已取消')) {
          // 用户主动取消，不显示错误信息，记录信息级日志
          log.info('用户取消了文件夹下载操作');
          return;
        }

        log.error('下载文件夹失败:', error);

        // 关闭进度通知
        if (progressNotification) {
          progressNotification.close();
        }

        // 根据错误类型提供更友好的错误信息
        let errorMessage = '下载文件夹失败';
        if (error.message.includes('超时')) {
          errorMessage = '下载文件夹超时，请检查网络连接或尝试下载较小的文件夹';
        } else if (error.message.includes('权限')) {
          errorMessage = `没有权限访问文件夹 "${folder.name}"`;
        } else if (error.message.includes('不存在')) {
          errorMessage = `文件夹 "${folder.name}" 不存在或已被删除`;
        } else if (error.message.includes('ZIP')) {
          errorMessage = `压缩文件夹时出错: ${error.message}`;
        } else if (error.message.includes('已取消')) {
          ElMessage.info('已取消下载');
          return;
        } else {
          errorMessage = `下载文件夹失败: ${error.message}`;
        }

        showError(errorMessage);

        // 显示错误通知
        ElMessage.error({
          message: errorMessage,
          duration: 5000
        });
      } finally {
        // 延迟关闭下载状态
        setTimeout(() => {
          isDownloading.value = false;
        }, 500);
      }
    };

    // 显示下载报告
    const showDownloadReport = (folderName, result) => {
      const { summary, skippedFiles, errorFiles } = result;

      let reportContent = '<div style="text-align: left;">';
      reportContent += `<h4>文件夹 "${folderName}" 下载报告</h4>`;
      reportContent += `<p><strong>总计:</strong> ${summary.totalFiles} 个文件</p>`;
      reportContent += `<p><strong>已包含:</strong> ${summary.includedFiles} 个文件</p>`;

      if (summary.skippedCount > 0) {
        reportContent += `<p><strong>已跳过:</strong> ${summary.skippedCount} 个文件</p>`;
        reportContent += '<details><summary>查看跳过的文件</summary><ul>';
        skippedFiles.forEach(file => {
          reportContent += `<li><code>${file.path}</code><br><small>原因: ${file.reason}</small></li>`;
        });
        reportContent += '</ul></details>';
      }

      if (summary.errorCount > 0) {
        reportContent += `<p><strong>错误:</strong> ${summary.errorCount} 个文件</p>`;
        reportContent += '<details><summary>查看错误文件</summary><ul>';
        errorFiles.forEach(file => {
          reportContent += `<li><code>${file.path}</code><br><small>错误: ${file.reason}</small></li>`;
        });
        reportContent += '</ul></details>';
      }

      reportContent += '</div>';

      ElMessageBox.alert(reportContent, '下载报告', {
        dangerouslyUseHTMLString: true,
        confirmButtonText: '确定',
        type: 'info'
      }).catch(() => {
        // 用户取消或关闭弹窗，静默处理
      });
    };

    // 删除文件
    const deleteFile = file => {
      resetError();

      // 如果是文件夹，使用不同的确认信息
      const confirmMessage = file.isDirectory
        ? `确定要删除文件夹 ${file.name} 及其所有内容吗？此操作无法撤销。`
        : `确定要删除 ${file.name} 吗？此操作无法撤销。`;

      ElMessageBox.confirm(confirmMessage, '删除确认', {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning'
      })
        .then(async () => {
          try {
            // 构建完整路径
            const fullPath =
              currentPath.value === '/'
                ? currentPath.value + file.name
                : `${currentPath.value}/${file.name}`;

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
              // 使用通用删除方法删除文件夹
              log.debug(`删除文件夹: ${fullPath}`);
              await sftpService.delete(props.sessionId, fullPath, true);
            } else {
              // 删除单个文件
              log.debug(`删除文件: ${fullPath}`);
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
            const loadingDiv = document.querySelector(
              '.sftp-file-list-content .sftp-loading-files'
            );
            if (loadingDiv && loadingDiv.parentNode) {
              loadingDiv.parentNode.removeChild(loadingDiv);
            }

            log.error('删除失败:', error);
            showError(`删除失败: ${error.message}`);
          }
        })
        .catch(() => {
          // 用户取消
        });
    };

    // 处理拖拽上传
    const handleDrop = async event => {
      isDragOver.value = false;
      event.preventDefault();

      // 清除创建状态（拖拽上传时取消任何正在进行的创建操作）
      if (isCreating.value) {
        isCreating.value = false;
        log.debug('拖拽上传时清除创建状态');
      }

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
          log.error('拖放上传处理失败:', error);
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
    const processEntries = async entries => {
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
      let _processedFiles = 0;
      let totalBytes = 0;
      // const uploadedBytes = 0; // 未使用，保留注释以便后续统计扩展
      let currentFileBytes = 0; // 当前文件已上传字节数

      // 提前计算文件总数和总大小
      const countFiles = async entry => {
        if (entry.isFile) {
          totalFiles++;
          return new Promise(resolve => {
            entry.file(
              file => {
                totalBytes += file.size;
                resolve();
              },
              () => resolve()
            );
          });
        } else if (entry.isDirectory) {
          const dirReader = entry.createReader();
          return new Promise(resolve => {
            dirReader.readEntries(
              async entries => {
                const promises = [];
                for (const childEntry of entries) {
                  promises.push(countFiles(childEntry));
                }
                await Promise.all(promises);
                resolve();
              },
              () => resolve()
            );
          });
        }
      };

      // 计算所有条目中的文件总数和大小
      const countPromises = [];
      for (const entry of entries) {
        countPromises.push(countFiles(entry));
      }
      await Promise.all(countPromises);

      log.debug(`总共需要上传 ${totalFiles} 个文件，总大小 ${formatFileSize(totalBytes)}`);

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

      // 创建文件夹上传进度条HTML（响应式弹性布局）
      const createFolderUploadProgressHTML = (
        progress,
        currentFile,
        processedFiles,
        totalFiles,
        speedText
      ) => {
        const progressText = `上传进度: ${Math.floor(progress)}%${speedText ? ` (${speedText})` : ''}(${processedFiles}/${totalFiles})`;
        const fileName =
          currentFile.length > 30 ? `${currentFile.substring(0, 27)}...` : currentFile;

        return `
          <div class="sftp-progress-container sftp-upload-progress">
            <div class="sftp-progress-content">
              <div class="sftp-progress-text">${progressText}</div>
              <div class="sftp-progress-file">${fileName}</div>
              <div class="sftp-progress-bar">
                <div class="sftp-progress-fill" style="width: ${progress}%;"></div>
              </div>
            </div>
          </div>
        `;
      };

      // 创建文件夹上传进度通知
      const folderUploadNotification = ElMessage({
        message: createFolderUploadProgressHTML(0, '准备上传...', 0, totalFiles, ''),
        type: 'info',
        duration: 0, // 不自动关闭
        showClose: true,
        dangerouslyUseHTMLString: true,
        customClass: 'upload-progress-notification',
        onClose: () => {
          // 用户点击关闭按钮时触发取消上传
          if (isUploading.value) {
            cancelUpload();
          }
        }
      });

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
          const currentTotalBytes = actualUploadedBytes + currentFileBytes;
          const bytesDelta = currentTotalBytes - lastUploadedBytes;
          if (bytesDelta > 0) {
            const currentSpeed = bytesDelta / timeDelta;
            transferSpeed.value =
              transferSpeed.value === 0
                ? currentSpeed
                : transferSpeed.value * 0.7 + currentSpeed * 0.3;
          }
          lastUpdateTime = now;
          lastUploadedBytes = currentTotalBytes;
        }
      }, 300); // 更高的更新频率

      // 重置上传ID
      currentUploadId.value = null;

      // 用于跟踪实际上传成功的文件
      let actualUploadedFiles = 0;
      let actualUploadedBytes = 0;
      let currentFileIndex = 0; // 当前正在处理的文件索引

      try {
        // 处理每一个条目
        for (const entry of entries) {
          if (entry.isFile) {
            currentFileIndex++; // 增加当前文件索引
            // 处理文件
            await processFileEntry(entry, '', (file, bytesUploaded, isPartial) => {
              if (!isPartial) {
                // 文件完成时
                _processedFiles++;
                actualUploadedFiles++;
                actualUploadedBytes += file.size; // 使用完整文件大小
                currentFileBytes = 0; // 重置当前文件字节
              } else {
                // 部分进度时，更新当前文件的已上传字节
                currentFileBytes = bytesUploaded;
              }

              // 计算总进度：已完成文件的字节 + 当前文件的部分字节
              const totalUploadedBytes = actualUploadedBytes + currentFileBytes;
              const progress = Math.min(100, Math.floor((totalUploadedBytes / totalBytes) * 100));

              currentUploadingFile.value = file.name;
              uploadProgress.value = progress;

              // 更新文件夹上传进度通知
              const speedText = formatTransferSpeed(transferSpeed.value);
              const progressHTML = createFolderUploadProgressHTML(
                progress,
                file.name,
                currentFileIndex,
                totalFiles,
                speedText
              );
              const notificationEl = document.querySelector(
                '.upload-progress-notification .el-message__content'
              );
              if (notificationEl) {
                notificationEl.innerHTML = progressHTML;
              }
            });
          } else if (entry.isDirectory) {
            // 处理目录
            await processDirectoryEntry(entry, '', (file, bytesUploaded, isPartial) => {
              if (!isPartial) {
                // 文件完成时
                _processedFiles++;
                actualUploadedFiles++;
                actualUploadedBytes += file.size; // 使用完整文件大小
                currentFileIndex++; // 目录中的文件也要增加索引
                currentFileBytes = 0; // 重置当前文件字节
              } else {
                // 部分进度时，更新当前文件的已上传字节
                currentFileBytes = bytesUploaded;
              }

              // 计算总进度：已完成文件的字节 + 当前文件的部分字节
              const totalUploadedBytes = actualUploadedBytes + currentFileBytes;
              const progress = Math.min(100, Math.floor((totalUploadedBytes / totalBytes) * 100));

              currentUploadingFile.value = file.name;
              uploadProgress.value = progress;

              // 更新文件夹上传进度通知
              const speedText = formatTransferSpeed(transferSpeed.value);
              const progressHTML = createFolderUploadProgressHTML(
                progress,
                file.name,
                currentFileIndex,
                totalFiles,
                speedText
              );
              const notificationEl = document.querySelector(
                '.upload-progress-notification .el-message__content'
              );
              if (notificationEl) {
                notificationEl.innerHTML = progressHTML;
              }
            });
          }
        }

        // 确保进度条显示100%
        uploadProgress.value = 100;

        // 关闭文件夹上传进度通知
        if (folderUploadNotification) {
          folderUploadNotification.close();
        }

        // 显示完成消息 - 使用实际上传成功的文件数量和大小
        ElMessage.success(
          `成功上传了${actualUploadedFiles}个文件，总大小${formatFileSize(actualUploadedBytes)}`
        );

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
        log.error('上传过程中发生错误:', error);

        // 关闭文件夹上传进度通知
        if (folderUploadNotification) {
          folderUploadNotification.close();
        }

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

      return new Promise((resolve, _reject) => {
        fileEntry.file(
          async file => {
            try {
              // 设置当前上传文件名以便在进度条中显示（移除百分比显示）
              currentUploadingFile.value = path ? `${path}/${file.name}` : file.name;

              // 构建远程路径
              const remotePath = path
                ? currentPath.value === '/'
                  ? `${currentPath.value + path}/${file.name}`
                  : `${currentPath.value}/${path}/${file.name}`
                : currentPath.value === '/'
                  ? currentPath.value + file.name
                  : `${currentPath.value}/${file.name}`;

              log.debug(`上传文件: ${remotePath} (${formatFileSize(file.size)})`);

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
                const _partialBytes = (file.size * progress) / 100;

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
                    const incrementalBytes = (file.size * progressDiff) / 100;
                    onProgress(file, incrementalBytes, true);
                    lastProgress = progress;
                  }
                }
              });

              resolve();
            } catch (error) {
              log.error(`处理文件失败: ${path}/${file.name}`, error);
              ElMessage.error(`上传 ${file.name} 失败: ${error.message}`);

              // 调用进度回调，即使失败也计入进度
              if (typeof onProgress === 'function') {
                onProgress(file, 0); // 失败时传0字节
              }

              resolve(); // 即使失败也继续下一个
            }
          },
          error => {
            log.error(`读取文件失败: ${path}/${fileEntry.name}`, error);
            ElMessage.error(`读取 ${fileEntry.name} 失败`);

            // 调用进度回调，即使失败也计入进度
            if (typeof onProgress === 'function') {
              onProgress(fileEntry, 0);
            }

            resolve(); // 即使失败也继续下一个
          }
        );
      });
    };

    // 处理目录条目
    const processDirectoryEntry = async (directoryEntry, path, onProgress) => {
      // 如果上传被取消，停止处理
      if (!isUploading.value && path !== '') {
        return;
      }

      // 构建新路径
      const newPath = path ? `${path}/${directoryEntry.name}` : directoryEntry.name;

      try {
        // 创建远程目录
        const remoteDirPath =
          currentPath.value === '/'
            ? currentPath.value + newPath
            : `${currentPath.value}/${newPath}`;

        log.debug(`创建目录: ${remoteDirPath}`);

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
          return new Promise((resolve, _reject) => {
            dirReader.readEntries(
              async entries => {
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
                  log.error(`读取目录失败: ${newPath}`, error);
                  resolve(); // 即使失败也继续
                }
              },
              error => {
                log.error(`目录读取错误: ${newPath}`, error);
                resolve(); // 即使失败也继续
              }
            );
          });
        };

        // 开始读取目录
        await readEntries();
      } catch (error) {
        log.error(`处理目录失败: ${newPath}`, error);
        ElMessage.error(`处理目录 ${directoryEntry.name} 失败: ${error.message}`);
      }
    };

    // 特殊的目录批量上传文件函数，不改变全局上传状态
    const uploadFileToDirectoryBatch = async (file, remotePath, progressCallback) => {
      return new Promise((resolve, reject) => {
        let fileCompleted = false; // 防止重复记录和解析

        try {
          // 调用SFTP服务上传文件
          sftpService
            .uploadFile(props.sessionId, file, remotePath, (progress, operationId) => {
              // 先调用原始回调 - 每次进度回调都实时更新
              if (typeof progressCallback === 'function') {
                progressCallback(progress, operationId);
              }

              // 当单个文件上传完成时，只处理一次
              if (progress >= 100 && !fileCompleted) {
                fileCompleted = true;
                // 只记录文件完成上传，不刷新目录
                log.debug(`文件完成上传: ${remotePath}`);
                // 上传完成时解析Promise
                resolve();
              }
            })
            .catch(error => {
              if (!fileCompleted) {
                log.error(`上传文件失败: ${remotePath}`, error);
                reject(error);
              }
            });
        } catch (error) {
          if (!fileCompleted) {
            log.error(`初始化上传失败: ${remotePath}`, error);
            reject(error);
          }
        }
      });
    };

    // 处理拖拽进入
    const handleDragOver = event => {
      event.preventDefault();
      isDragOver.value = true;
    };

    // 处理拖拽离开
    const handleDragLeave = event => {
      event.preventDefault();
      isDragOver.value = false;
    };

    // 格式化传输速度
    const formatTransferSpeed = bytesPerSecond => {
      if (bytesPerSecond < 1024) {
        return `${bytesPerSecond.toFixed(1)} B/s`;
      } else if (bytesPerSecond < 1024 * 1024) {
        return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
      } else {
        return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
      }
    };

    // 搜索文件
    const handleSearch = query => {
      log.debug('接收到搜索查询:', query);

      // 如果搜索查询为空，显示所有文件
      if (!query || query.trim() === '') {
        log.debug('搜索查询为空，刷新目录显示所有文件');
        refreshCurrentDirectory();
        return;
      }

      log.debug('执行搜索:', query);

      // 获取原始文件列表的一个副本（如果需要刷新）
      const originalFileList = [...rawFileList.value];

      // 搜索当前目录中匹配的文件
      const lowercaseQuery = query.toLowerCase();
      const filteredFiles = originalFileList.filter(file => {
        // 文件名匹配查询
        return file.name.toLowerCase().includes(lowercaseQuery);
      });

      log.debug(`搜索结果: 找到 ${filteredFiles.length} 个匹配项`);

      // 更新文件列表
      rawFileList.value = filteredFiles;
    };

    // 切换显示/隐藏隐藏文件
    const toggleHiddenFiles = value => {
      showHiddenFiles.value = value;
      refreshCurrentDirectory();
    };

    // 处理权限编辑
    const handlePermissions = file => {
      selectedFileForPermissions.value = file;
      showPermissionsDialog.value = true;
    };

    // 保存权限
    const handlePermissionsSave = async (file, newPermissions) => {
      try {
        // 构建完整文件路径
        const fullPath =
          currentPath.value === '/'
            ? currentPath.value + file.name
            : `${currentPath.value}/${file.name}`;

        log.info('修改文件权限:', {
          file: file.name,
          path: fullPath,
          permissions: newPermissions.toString(8)
        });

        // 调用SFTP服务的权限修改方法
        await sftpService.changePermissions(props.sessionId, fullPath, newPermissions);

        // 刷新目录以更新权限显示
        await refreshCurrentDirectory();

        ElMessage.success('权限修改成功');
      } catch (error) {
        log.error('权限修改失败:', error);
        throw error;
      }
    };

    // 打开文件编辑器
    const openEditor = async file => {
      resetError();

      if (file.isDirectory) {
        return;
      }

      // 构建完整文件路径
      const fullPath =
        currentPath.value === '/'
          ? currentPath.value + file.name
          : `${currentPath.value}/${file.name}`;

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
        const loadingFileContentDiv = document.querySelector(
          '.sftp-file-list-content .sftp-loading-files'
        );
        if (loadingFileContentDiv && loadingFileContentDiv.parentNode) {
          loadingFileContentDiv.parentNode.removeChild(loadingFileContentDiv);
        }

        log.error('加载文件内容失败:', error);
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
          showInitError('无效的会话ID');
          isLoadingSftp.value = false;
          return;
        }

        log.debug(`初始化SFTP会话: ${props.sessionId}`);

        // 创建SFTP会话
        await sftpService.createSftpSession(props.sessionId);

        // 获取初始路径
        let initialPath = '/root';
        if (sftpService.activeSftpSessions.has(props.sessionId)) {
          const sftpSession = sftpService.activeSftpSessions.get(props.sessionId);
          // 尝试加载/root目录，如果不存在则使用当前路径（通常是根目录）
          try {
            await sftpService.listDirectory(props.sessionId, initialPath);
            log.debug('/root目录存在，使用它作为初始目录');
          } catch (error) {
            log.debug(`/root目录不存在，使用默认路径: ${sftpSession.currentPath}`);
            initialPath = sftpSession.currentPath || '/';
          }
        }

        // 加载目录内容
        await loadDirectoryContents(initialPath);

        isLoadingSftp.value = false;
      } catch (error) {
        isLoadingSftp.value = false;
        showInitError(`初始化SFTP失败: ${error.message || '未知错误'}`);
        log.error('初始化SFTP会话失败:', error);
      }
    };

    // 组件挂载时初始化SFTP会话
    onMounted(() => {
      window.addEventListener('sftp:session-changed', handleSessionChanged);

      // 添加全局点击监听，用于清除创建状态
      document.addEventListener('click', handleGlobalClick, true);

      // 初始化SFTP连接
      initSftp();
    });

    // 组件卸载时清理资源
    onUnmounted(() => {
      window.removeEventListener('sftp:session-changed', handleSessionChanged);

      // 移除全局点击监听
      document.removeEventListener('click', handleGlobalClick, true);

      // 清理传输速度计算定时器
      if (transferInterval.value) {
        clearInterval(transferInterval.value);
        transferInterval.value = null;
      }

      // 关闭SFTP会话，清理资源
      try {
        if (props.sessionId) {
          log.debug(`组件卸载，关闭SFTP会话: ${props.sessionId}`);
          // 检查会话是否仍然存在
          if (
            sftpService.activeSftpSessions &&
            sftpService.activeSftpSessions.has(props.sessionId)
          ) {
            sftpService.closeSftpSession(props.sessionId).catch(error => {
              log.error(`关闭SFTP会话失败: ${error.message || '未知错误'}`, error);
            });
          } else {
            log.debug(`SFTP会话 ${props.sessionId} 已经关闭，跳过`);
          }
        }
      } catch (error) {
        log.error('清理SFTP资源时出错:', error);
      }
    });

    return {
      // 状态
      isResizing,
      isLoadingSftp,
      currentPath,
      sortedFileList,
      uploadProgress,
      isUploading,
      downloadProgress,
      isDownloading,
      transferSpeed,
      hasError,
      errorMessage,
      hasInitError,
      initErrorMessage,
      isDragOver,
      showHiddenFiles,
      currentUploadingFile,
      currentUploadId,
      isEditing,
      editingFilePath,
      editingFileContent,
      isCreating,
      creatingType,
      inlineEditor,
      showPermissionsDialog,
      selectedFileForPermissions,

      // 方法
      close,
      startResizing,
      loadDirectoryContents,
      refreshCurrentDirectory,
      handleItemClick,
      startCreateFolder,
      startCreateFile,
      handleCreate,
      cancelCreate,
      uploadFile,
      uploadFolder,
      downloadFile,
      downloadSingleFile,
      downloadFolder,
      showDownloadReport,
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
      handlePermissions,
      handlePermissionsSave,
      initSftp,

      // 排序功能
      toggleSort,
      getSortIndicator,
      isActiveSort,

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
  color: var(--sftp-loading-color);
  background-color: var(--sftp-loading-bg);
  padding: 20px 0;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2;
  border-radius: 4px;
  backdrop-filter: blur(4px);

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
      stroke: var(--sftp-loading-spinner-color);
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

/* 主题特定样式已迁移到主题文件中 */
</style>
<style>
/* SFTP进度条样式 */
.sftp-progress-container {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 280px;
  max-width: 400px;
  width: max-content;
}

.sftp-progress-content {
  flex: 1;
  min-width: 0;
}

.sftp-progress-text {
  margin-bottom: 6px;
  font-size: 13px;
  color: var(--color-text-primary, #333);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sftp-progress-file {
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--color-text-secondary, #666);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sftp-progress-bar {
  width: 100%;
  height: 6px;
  background-color: #f0f0f0;
  border-radius: 3px;
  overflow: hidden;
}

.sftp-progress-fill {
  height: 100%;
  background-color: var(--color-primary, #409eff);
  transition: width 0.2s linear;
  border-radius: 3px;
}

.sftp-upload-progress .sftp-progress-fill {
  background-color: #67c23a;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .sftp-progress-container {
    max-width: 90vw;
    min-width: 260px;
  }

  .sftp-progress-text {
    font-size: 12px;
  }

  .sftp-progress-file {
    font-size: 11px;
  }
  /* 进度条跟随容器宽度 */
  .sftp-progress-bar {
    width: 100%;
  }
}

@media (max-width: 480px) {
  .sftp-progress-container {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .sftp-progress-bar {
    width: 100%;
  }
}

/* 进度条取消按钮样式 */
.sftp-progress-cancel-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 1px solid transparent;
  background: transparent;
  color: #999;
  cursor: pointer;
  border-radius: 50%;
  transition: border-color 0.15s ease;
  padding: 0;
  flex-shrink: 0;
  position: relative;
  isolation: isolate;
  will-change: border-color;
}

.sftp-progress-cancel-btn:hover {
  border-color: #999;
}

.sftp-progress-cancel-btn:active {
  border-color: #666;
}

.sftp-progress-cancel-btn svg {
  pointer-events: none;
  position: relative;
  z-index: 1;
}

/* 通知框样式优化 */
.download-progress-notification,
.upload-progress-notification {
  width: auto !important;
  min-width: auto !important;
  max-width: none !important;
}

.download-progress-notification .el-message__content,
.upload-progress-notification .el-message__content {
  line-height: 1.4;
  padding: 0;
}

/* SFTP初始化错误内联显示样式 */
.sftp-init-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 300px;
  padding: 40px 20px;
  text-align: center;
  color: var(--color-text-primary, #333);
}

.sftp-error-icon {
  margin-bottom: 24px;
  color: #f56565;
  opacity: 0.8;
}

.sftp-error-content h3 {
  margin: 0 0 16px 0;
  font-size: 20px;
  font-weight: 500;
  color: var(--color-text-primary, #333);
}

.sftp-error-content .sftp-error-message {
  margin: 0 0 24px 0;
  font-size: 14px;
  color: var(--color-text-secondary, #666);
  line-height: 1.5;
  max-width: 400px;
}

.sftp-error-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
}

.sftp-retry-button {
  padding: 10px 20px;
  background: var(--color-primary, #409eff);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.sftp-retry-button:hover {
  background: var(--color-primary-dark, #337ecc);
}

.sftp-retry-button:active {
  transform: translateY(1px);
}

/* 响应式调整 */
@media (max-width: 768px) {
  .sftp-init-error {
    min-height: 250px;
    padding: 30px 15px;
  }

  .sftp-error-content h3 {
    font-size: 18px;
  }

  .sftp-error-content .sftp-error-message {
    font-size: 13px;
  }
}
</style>
