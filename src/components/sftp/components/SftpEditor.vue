<template>
  <div class="sftp-editor-container" :class="{ 'fullscreen': isFullscreen }">
    <div class="sftp-editor-header">
      <div class="sftp-editor-path">
        <span>{{ fileName }}</span>
        <span class="sftp-editor-status" v-if="isDirty">*</span>
      </div>
      <div class="sftp-editor-controls">
        <button class="sftp-editor-btn" @click="save" :disabled="!isDirty || isSaving">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
            <path fill="currentColor" d="M15,9H5V5H15M12,19A3,3 0 0,1 9,16A3,3 0 0,1 12,13A3,3 0 0,1 15,16A3,3 0 0,1 12,19M17,3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V7L17,3Z" />
          </svg>
          保存
        </button>
        <button class="sftp-editor-btn" @click="toggleFullscreen">
          <svg v-if="!isFullscreen" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
            <path fill="currentColor" d="M5,5H10V7H7V10H5V5M19,5V10H17V7H14V5H19M5,19V14H7V17H10V19H5M19,19H14V17H17V14H19V19Z" />
          </svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
            <path fill="currentColor" d="M14,14H19V16H16V19H14V14M5,14H10V19H8V16H5V14M8,5H10V10H5V8H8V5M19,8V10H14V5H16V8H19Z" />
          </svg>
        </button>
        <button class="sftp-editor-btn close" @click="close">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
            <path fill="currentColor" d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z" />
          </svg>
        </button>
      </div>
    </div>
    <div class="sftp-editor-body">
      <div ref="editorContainer" class="editor-container"></div>
    </div>
    <div class="sftp-editor-footer">
      <div class="sftp-editor-status-bar">
        <span>{{ getFileType() }}</span>
        <span>{{ cursor.line }}:{{ cursor.ch }}</span>
      </div>
    </div>
  </div>
</template>

<script>
import { defineComponent, ref, onMounted, watch, nextTick, onBeforeUnmount } from 'vue'
import { ElMessageBox, ElMessage, ElLoading } from 'element-plus'
import { sftpService } from '@/services/ssh'

// CodeMirror 6 Imports
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { searchKeymap } from '@codemirror/search'
import { foldGutter, bracketMatching, syntaxHighlighting, HighlightStyle, indentOnInput } from '@codemirror/language'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'
import { tags } from '@lezer/highlight'

export default defineComponent({
  name: 'SftpEditor',
  props: {
    sessionId: {
      type: String,
      required: true
    },
    filePath: {
      type: String,
      required: true
    },
    content: {
      type: String,
      default: ''
    }
  },
  emits: ['close', 'save'],
  setup(props, { emit }) {
    const editorContainer = ref(null)
    const editorView = ref(null)
    const originalContent = ref(props.content)
    const isDirty = ref(false)
    const isSaving = ref(false)
    const isFullscreen = ref(true)
    const fileName = ref(props.filePath.split('/').pop())
    const cursor = ref({ line: 1, ch: 0 })
    const isComponentMounted = ref(false)
    
    // 获取文件类型显示名称
    const getFileType = () => {
      const fileExt = fileName.value.split('.').pop().toLowerCase()
      const fileTypeMap = {
        'js': 'JavaScript',
        'jsx': 'JavaScript (React)',
        'ts': 'TypeScript',
        'tsx': 'TypeScript (React)',
        'html': 'HTML',
        'css': 'CSS',
        'scss': 'SCSS',
        'sass': 'SASS',
        'less': 'LESS',
        'py': 'Python',
        'sh': 'Shell',
        'bash': 'Bash',
        'php': 'PHP',
        'rb': 'Ruby',
        'go': 'Go',
        'java': 'Java',
        'c': 'C',
        'cpp': 'C++',
        'h': 'C Header',
        'hpp': 'C++ Header',
        'json': 'JSON',
        'yaml': 'YAML',
        'yml': 'YAML',
        'xml': 'XML',
        'md': 'Markdown',
        'conf': 'Config',
        'ini': 'INI',
        'dockerfile': 'Dockerfile',
        'nginx': 'Nginx',
        'txt': 'Plain Text'
      }
      
      return fileTypeMap[fileExt] || 'Plain Text'
    }
    
    // 获取文件对应的语言模式
    const getLanguageSupport = () => {
      const fileExt = fileName.value.split('.').pop().toLowerCase()
      const langMap = {
        'js': javascript(),
        'jsx': javascript({ jsx: true }),
        'ts': javascript({ typescript: true }),
        'tsx': javascript({ jsx: true, typescript: true }),
        // 其他语言可根据需要添加
      }
      
      return langMap[fileExt] || javascript()
    }
    
    // 自定义语法高亮样式
    const customHighlightStyle = HighlightStyle.define([
      { tag: tags.keyword, color: '#c678dd' },
      { tag: tags.comment, color: '#5c6370', fontStyle: 'italic' },
      { tag: tags.definition, color: '#61afef' },
      { tag: tags.variableName, color: '#e06c75' },
      { tag: tags.string, color: '#98c379' },
      { tag: tags.number, color: '#d19a66' },
      { tag: tags.operator, color: '#56b6c2' },
      { tag: tags.punctuation, color: '#abb2bf' },
      { tag: tags.propertyName, color: '#e06c75' },
      { tag: tags.function(tags.variableName), color: '#61afef' },
      { tag: tags.className, color: '#e5c07b' }
    ])
    
    // 语言配置模块，可以动态更新
    const languageConf = new Compartment()
    
    // 创建编辑器状态
    const createEditorState = (content) => {
      const languageSupport = getLanguageSupport()
      
      return EditorState.create({
        doc: content,
        extensions: [
          // 基础设置
          lineNumbers(),
          highlightActiveLine(),
          history(),
          bracketMatching(),
          foldGutter(),
          indentOnInput(),
          
          // 主题
          oneDark,
          syntaxHighlighting(customHighlightStyle),
          
          // 键盘映射
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            indentWithTab,
            {
              key: 'Mod-s',
              run: () => {
                save()
                return true
              }
            },
            {
              key: 'F11',
              run: () => {
                toggleFullscreen()
                return true
              }
            },
            {
              key: 'Escape',
              run: () => {
                if (isFullscreen.value) {
                  isFullscreen.value = false
                  return true
                }
                return false
              }
            }
          ]),
          
          // 文档变更监听
          EditorView.updateListener.of(update => {
            if (update.docChanged) {
              const content = update.state.doc.toString()
              isDirty.value = content !== originalContent.value
            }
            
            if (update.selectionSet) {
              const pos = update.state.selection.main.head
              const line = update.state.doc.lineAt(pos)
              cursor.value = {
                line: line.number,
                ch: pos - line.from
              }
            }
          }),
          
          // 动态语言支持
          languageConf.of(languageSupport)
        ]
      })
    }
    
    // 初始化编辑器
    const initEditor = () => {
      if (!editorContainer.value || !isComponentMounted.value) return
      
      try {
        // 创建编辑器状态
        const state = createEditorState(originalContent.value)
        
        // 创建编辑器视图
        editorView.value = new EditorView({
          state,
          parent: editorContainer.value
        })
      } catch (error) {
        console.error('初始化编辑器失败:', error)
        ElMessage.error('初始化编辑器失败，请刷新页面重试')
      }
    }
    
    // 获取编辑器内容
    const getEditorContent = () => {
      if (!editorView.value) return ''
      return editorView.value.state.doc.toString()
    }
    
    // 保存文件
    const save = async () => {
      if (!isDirty.value || isSaving.value) return
      
      isSaving.value = true
      let loading = null
      let saveTimeout = null
      
      try {
        console.log('[SftpEditor] 开始保存:', props.filePath)
        const content = getEditorContent()
        
        loading = ElLoading.service({
          lock: true,
          text: '保存文件中...',
          background: 'rgba(0, 0, 0, 0.7)'
        })
        
        // 创建上传任务
        const saveTask = new Promise(async (resolve, reject) => {
          try {
            // 超时保护 - 3秒
            saveTimeout = setTimeout(() => {
              console.log('[SftpEditor] 上传超时')
              resolve({ timedOut: true })
            }, 3000)
            
            // 上传文件
            const tempFile = new File([content], fileName.value, { type: 'text/plain' })
            
            await sftpService.uploadFile(
              props.sessionId, 
              tempFile, 
              props.filePath, 
              (progress) => {
                // 只在收到100%进度时处理
                if (progress === 100) {
                  console.log(`[SftpEditor] 上传完成(100%)`)
                  
                  // 清除超时
                  if (saveTimeout) {
                    clearTimeout(saveTimeout)
                    saveTimeout = null
                  }
                  
                  // 立即完成
                  resolve({ complete: true })
                }
              }
            )
            
            // 清除超时
            if (saveTimeout) {
              clearTimeout(saveTimeout)
              saveTimeout = null
            }
            
            resolve({ success: true })
          } catch (error) {
            if (saveTimeout) {
              clearTimeout(saveTimeout)
              saveTimeout = null
            }
            reject(error)
          }
        })
        
        // 等待保存任务完成
        const result = await saveTask
        
        // 关闭加载指示器
        if (loading) {
          loading.close()
          loading = null
        }
        
        ElMessage.success('文件保存成功')
        
        // 更新状态
        originalContent.value = content
        isDirty.value = false
        
        // 触发保存事件
        emit('save')
      } catch (error) {
        console.error('[SftpEditor] 保存失败:', error.message)
        
        if (loading) {
          loading.close()
          loading = null
        }
        
        if (saveTimeout) {
          clearTimeout(saveTimeout)
          saveTimeout = null
        }
        
        ElMessage.error(`保存文件失败: ${error.message}`)
      } finally {
        isSaving.value = false
      }
    }
    
    // 切换全屏显示
    const toggleFullscreen = () => {
      isFullscreen.value = !isFullscreen.value
      
      // 全屏切换后刷新编辑器布局
      nextTick(() => {
        if (editorView.value) {
          editorView.value.requestMeasure()
        }
      })
    }
    
    // 关闭编辑器
    const close = async () => {
      if (isDirty.value) {
        try {
          await ElMessageBox.confirm(
            '当前文件有未保存的修改，确定要关闭吗？',
            '关闭确认',
            {
              confirmButtonText: '不保存',
              cancelButtonText: '取消',
              type: 'warning',
              distinguishCancelAndClose: true,
              closeOnClickModal: false
            }
          )
          emit('close')
        } catch (action) {
          if (action === 'cancel') {
            return
          }
          // 用户点击确认按钮，关闭编辑器
          emit('close')
        }
      } else {
        emit('close')
      }
    }
    
    // 全局键盘事件处理
    const handleGlobalKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        // 全局阻止浏览器默认保存行为
        event.preventDefault()
        
        // 如果编辑器处于活动状态，则触发保存
        if (isDirty.value && !isSaving.value) {
          save()
        }
      }
    }
    
    // 生命周期钩子
    onMounted(() => {
      window.addEventListener('keydown', handleGlobalKeyDown)
      isComponentMounted.value = true
      nextTick(() => {
        initEditor()
      })
    })
    
    onBeforeUnmount(() => {
      window.removeEventListener('keydown', handleGlobalKeyDown)
      
      // 销毁编辑器
      if (editorView.value) {
        editorView.value.destroy()
        editorView.value = null
      }
    })
    
    // 监听文件内容变化
    watch(() => props.content, (newContent) => {
      if (editorView.value && newContent !== getEditorContent()) {
        // 更新编辑器内容
        const transaction = editorView.value.state.update({
          changes: {
            from: 0,
            to: editorView.value.state.doc.length,
            insert: newContent
          }
        })
        
        editorView.value.dispatch(transaction)
        originalContent.value = newContent
        isDirty.value = false
      }
    })
    
    return {
      editorContainer,
      fileName,
      isDirty,
      isSaving,
      isFullscreen,
      cursor,
      save,
      close,
      toggleFullscreen,
      getFileType
    }
  }
})
</script>

<style lang="scss">
.sftp-editor-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background-color: #282c34;
  color: #abb2bf;
  border-radius: 4px;
  overflow: hidden;
  position: relative;
  z-index: 10;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.sftp-editor-container.fullscreen {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  border-radius: 0;
  box-shadow: none;
}

.sftp-editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  background-color: #21252b;
  border-bottom: 1px solid #181a1f;
}

.sftp-editor-path {
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
}

.sftp-editor-status {
  margin-left: 6px;
  color: #e5c07b;
}

.sftp-editor-controls {
  display: flex;
  align-items: center;
}

.sftp-editor-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid #181a1f;
  color: #abb2bf;
  border-radius: 4px;
  padding: 4px 8px;
  margin-left: 8px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s ease;
}

.sftp-editor-btn svg {
  margin-right: 4px;
}

.sftp-editor-btn:hover {
  background-color: rgba(255, 255, 255, 0.05);
  color: #ffffff;
}

.sftp-editor-btn:active {
  background-color: rgba(255, 255, 255, 0.1);
}

.sftp-editor-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.sftp-editor-btn.close:hover {
  background-color: rgba(224, 108, 117, 0.2);
  color: #e06c75;
  border-color: rgba(224, 108, 117, 0.3);
}

.sftp-editor-body {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.editor-container {
  height: 100%;
  width: 100%;
}

.sftp-editor-footer {
  display: flex;
  align-items: center;
  padding: 6px 12px;
  background-color: #21252b;
  border-top: 1px solid #181a1f;
  font-size: 12px;
}

.sftp-editor-status-bar {
  display: flex;
  justify-content: space-between;
  width: 100%;
  color: #abb2bf;
}

/* CodeMirror 自定义样式 */
.cm-editor {
  height: 100%;
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
}

.cm-scroller {
  overflow: auto;
}

.cm-gutters {
  background-color: #21252b;
  border-right: 1px solid #181a1f;
  color: #636d83;
}

.cm-activeLineGutter {
  background-color: rgba(255, 255, 255, 0.05);
}

.cm-content {
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
  padding: 4px 0;
}

.cm-lineNumbers .cm-gutterElement {
  padding: 0 8px;
}

/* 滚动条样式 */
.cm-scroller::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

.cm-scroller::-webkit-scrollbar-track {
  background: #21252b;
  border-radius: 4px;
}

.cm-scroller::-webkit-scrollbar-thumb {
  background: #3e4451;
  border-radius: 4px;
  border: 2px solid #21252b;
}

.cm-scroller::-webkit-scrollbar-thumb:hover {
  background: #4b5363;
}
</style> 