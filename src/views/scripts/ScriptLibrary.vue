<template>
  <div class="script-library-container">
    <div class="page-header">
      <h1>脚本库</h1>
      <button class="btn-primary" @click="createNewScript">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">
          <path fill="currentColor" d="M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z" />
        </svg>
        新建脚本
      </button>
    </div>

    <div class="script-categories">
      <div 
        class="tag-bubble"
        :class="{ active: selectedTags.length === 0 }"
        @click="clearTags"
      >
        <span>全部</span>
      </div>
      <div 
        v-for="tag in availableTags" 
        :key="tag"
        class="tag-bubble"
        :class="{ active: selectedTags.includes(tag) }"
        @click="toggleTag(tag)"
      >
        <span>{{ tag }}</span>
      </div>
    </div>

    <div class="scripts-panel">
      <div class="search-bar">
        <input 
          type="text" 
          v-model="searchQuery" 
          placeholder="搜索脚本..." 
          class="search-input"
        />
        <button class="btn-filter" @click="showFilterOptions = !showFilterOptions">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18">
            <path fill="currentColor" d="M14,12V19.88C14.04,20.18 13.94,20.5 13.71,20.71C13.32,21.1 12.69,21.1 12.3,20.71L10.29,18.7C10.06,18.47 9.96,18.16 10,17.87V12H9.97L4.21,4.62C3.87,4.19 3.95,3.56 4.38,3.22C4.57,3.08 4.78,3 5,3V3H19V3C19.22,3 19.43,3.08 19.62,3.22C20.05,3.56 20.13,4.19 19.79,4.62L14.03,12H14Z" />
          </svg>
          筛选
        </button>
        <div v-if="showFilterOptions" class="filter-dropdown">
          <div class="filter-option">
            <input type="checkbox" id="my-scripts" v-model="filterMyScripts">
            <label for="my-scripts">只显示我的脚本</label>
          </div>
          <div class="filter-option">
            <input type="checkbox" id="recent-scripts" v-model="filterRecentScripts">
            <label for="recent-scripts">最近使用</label>
          </div>
          <div class="filter-option">
            <input type="checkbox" id="favorite-scripts" v-model="filterFavoriteScripts">
            <label for="favorite-scripts">收藏的脚本</label>
          </div>
        </div>
      </div>

      <div class="scripts-table-container">
        <div v-if="filteredScripts.length === 0" class="no-scripts">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48">
            <path fill="#666" d="M19,3H5C3.89,3 3,3.89 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5C21,3.89 20.1,3 19,3M19,5V19H5V5H19Z" />
            <path fill="#666" d="M11,7H13V9H11V7M11,11H13V17H11V11Z" />
          </svg>
          <p>{{ noScriptsMessage }}</p>
          <button class="btn-secondary" @click="createNewScript">创建第一个脚本</button>
        </div>

        <table v-else class="scripts-table">
          <thead>
            <tr>
              <th class="script-name-column">名称</th>
              <th class="script-desc-column">备注</th>
              <th class="script-tags-column">标签</th>
              <th class="script-command-column">指令内容</th>
              <th class="script-actions-column">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="script in filteredScripts" :key="script.id" class="script-row">
              <td class="script-name">
                <div class="name-with-favorite">
                  <button class="btn-icon favorite-icon" @click="toggleFavorite(script)">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">
                      <path fill="currentColor" :d="script.isFavorite ? 'M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z' : 'M12,15.39L8.24,17.66L9.23,13.38L5.91,10.5L10.29,10.13L12,6.09L13.71,10.13L18.09,10.5L14.77,13.38L15.76,17.66M22,9.24L14.81,8.63L12,2L9.19,8.63L2,9.24L7.45,13.97L5.82,21L12,17.27L18.18,21L16.54,13.97L22,9.24Z'" />
                    </svg>
                  </button>
                  {{ script.name }}
                </div>
                <div class="script-meta">
                  <span>作者: {{ script.author }}</span> | 
                  <span>更新于: {{ formatDate(script.updatedAt) }}</span>
                </div>
              </td>
              <td class="script-description">{{ script.description }}</td>
              <td class="script-tags">
                <div class="tag-list">
                  <span 
                    v-for="tag in script.tags" 
                    :key="tag" 
                    class="script-tag"
                    @click="toggleTag(tag)"
                  >
                    {{ tag }}
                  </span>
                </div>
              </td>
              <td class="script-command">
                <code>{{ script.command }}</code>
              </td>
              <td class="script-actions">
                <el-button class="action-btn" circle size="small" link title="编辑" @click="editScript(script)">
                  <el-icon><Edit /></el-icon>
                </el-button>
                <el-button class="action-btn" circle size="small" link title="运行" @click="runScript(script)">
                  <el-icon><CaretRight /></el-icon>
                </el-button>
                <el-button class="action-btn" circle size="small" link title="删除" @click="deleteScript(script)">
                  <el-icon><Delete /></el-icon>
                </el-button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 编辑脚本弹窗 -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑脚本' : '新建脚本'"
      width="600px"
      :close-on-click-modal="false"
    >
      <el-form :model="scriptForm" label-position="top">
        <el-form-item label="脚本名称">
          <el-input v-model="scriptForm.name" placeholder="请输入脚本名称" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="scriptForm.description" type="textarea" :rows="2" placeholder="请输入备注信息" />
        </el-form-item>
        <el-form-item label="指令内容">
          <el-input v-model="scriptForm.command" type="textarea" :rows="4" placeholder="请输入指令内容" />
        </el-form-item>
        <el-form-item label="标签">
          <el-select
            v-model="scriptForm.tags"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="请选择或输入标签"
          >
            <el-option
              v-for="tag in availableTags"
              :key="tag"
              :label="tag"
              :value="tag"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" @click="saveScript">保存</el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script>
import { defineComponent, ref, computed } from 'vue'
import { Edit, Delete, CaretRight } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'

export default defineComponent({
  name: 'ScriptLibrary',
  components: {
    Edit,
    Delete,
    CaretRight
  },
  setup() {
    const searchQuery = ref('')
    const showFilterOptions = ref(false)
    const filterMyScripts = ref(false)
    const filterRecentScripts = ref(false)
    const filterFavoriteScripts = ref(false)
    const selectedTags = ref([])

    // 示例数据
    const scripts = ref([
      {
        id: 1,
        name: '系统信息收集脚本',
        description: '收集服务器系统信息，包括CPU、内存、磁盘使用情况等。',
        author: '管理员',
        tags: ['系统', '监控', '信息收集'],
        updatedAt: new Date('2023-12-01'),
        isFavorite: true,
        command: 'free -h && df -h && cat /proc/cpuinfo | grep "model name" | head -1'
      },
      {
        id: 2,
        name: '网络连接检测',
        description: '检测服务器与指定目标的网络连接状态。',
        author: '网络管理员',
        tags: ['网络', '诊断', '连接测试'],
        updatedAt: new Date('2023-11-15'),
        isFavorite: false,
        command: 'ping -c 4 google.com && traceroute baidu.com'
      },
      {
        id: 3,
        name: '数据库备份脚本',
        description: '自动备份MySQL/PostgreSQL数据库并上传到指定位置。',
        author: '数据库管理员',
        tags: ['数据库', '备份', 'MySQL', 'PostgreSQL'],
        updatedAt: new Date('2023-10-28'),
        isFavorite: true,
        command: 'mysqldump -u root -p mydb > /backup/mydb_$(date +%Y%m%d).sql && gzip /backup/mydb_$(date +%Y%m%d).sql'
      }
    ])

    // 获取所有可用的标签
    const availableTags = computed(() => {
      const tagSet = new Set()
      scripts.value.forEach(script => {
        script.tags.forEach(tag => tagSet.add(tag))
      })
      return Array.from(tagSet)
    })

    // 根据筛选条件过滤脚本
    const filteredScripts = computed(() => {
      let result = scripts.value
      
      // 根据标签筛选
      if (selectedTags.value.length > 0) {
        result = result.filter(script => 
          selectedTags.value.every(tag => script.tags.includes(tag))
        )
      }
      
      // 根据搜索词筛选
      if (searchQuery.value) {
        const query = searchQuery.value.toLowerCase()
        result = result.filter(script => 
          script.name.toLowerCase().includes(query) || 
          script.description.toLowerCase().includes(query) ||
          script.tags.some(tag => tag.toLowerCase().includes(query))
        )
      }
      
      // 根据其他筛选条件
      if (filterMyScripts.value) {
        result = result.filter(script => script.author === '管理员')
      }
      
      if (filterFavoriteScripts.value) {
        result = result.filter(script => script.isFavorite)
      }
      
      if (filterRecentScripts.value) {
        const sevenDaysAgo = new Date()
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
        result = result.filter(script => script.updatedAt >= sevenDaysAgo)
      }
      
      return result
    })

    // 标签操作方法
    const toggleTag = (tag) => {
      const index = selectedTags.value.indexOf(tag)
      if (index === -1) {
        selectedTags.value.push(tag)
      } else {
        selectedTags.value.splice(index, 1)
      }
    }

    const clearTags = () => {
      selectedTags.value = []
    }

    // 无脚本时显示的消息
    const noScriptsMessage = computed(() => {
      if (searchQuery.value) {
        return '没有找到匹配的脚本'
      } else if (selectedTags.value.length > 0) {
        return `没有找到包含所选标签的脚本`
      } else if (filterMyScripts.value) {
        return '您还没有创建任何脚本'
      } else if (filterFavoriteScripts.value) {
        return '您还没有收藏任何脚本'
      } else {
        return '脚本库为空，创建第一个脚本吧'
      }
    })

    // 格式化日期
    const formatDate = (date) => {
      return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
    };

    // 编辑弹窗相关
    const dialogVisible = ref(false)
    const isEdit = ref(false)
    const scriptForm = ref({
      id: null,
      name: '',
      description: '',
      command: '',
      tags: [],
      author: '管理员', // 这里可以从用户状态获取
      updatedAt: null,
      isFavorite: false
    })

    // 重置表单
    const resetForm = () => {
      scriptForm.value = {
        id: null,
        name: '',
        description: '',
        command: '',
        tags: [],
        author: '管理员',
        updatedAt: null,
        isFavorite: false
      }
    }

    // 创建新脚本
    const createNewScript = () => {
      isEdit.value = false
      resetForm()
      dialogVisible.value = true
    }

    // 编辑脚本
    const editScript = (script) => {
      isEdit.value = true
      scriptForm.value = { ...script }
      dialogVisible.value = true
    }

    // 保存脚本
    const saveScript = () => {
      if (!scriptForm.value.name) {
        ElMessage.warning('请输入脚本名称')
        return
      }
      if (!scriptForm.value.command) {
        ElMessage.warning('请输入指令内容')
        return
      }

      const now = new Date()
      if (isEdit.value) {
        // 更新现有脚本
        const index = scripts.value.findIndex(s => s.id === scriptForm.value.id)
        if (index !== -1) {
          scripts.value[index] = {
            ...scriptForm.value,
            updatedAt: now
          }
          ElMessage.success('脚本更新成功')
        }
      } else {
        // 创建新脚本
        const newScript = {
          ...scriptForm.value,
          id: scripts.value.length + 1,
          updatedAt: now
        }
        scripts.value.push(newScript)
        ElMessage.success('脚本创建成功')
      }
      
      dialogVisible.value = false
      resetForm()
    }

    // 删除脚本
    const deleteScript = (script) => {
      ElMessageBox.confirm(
        '确定要删除这个脚本吗？此操作不可恢复。',
        '删除确认',
        {
          confirmButtonText: '确定',
          cancelButtonText: '取消',
          type: 'warning',
          draggable: true,
          closeOnClickModal: false
        }
      ).then(() => {
        const index = scripts.value.findIndex(s => s.id === script.id)
        if (index !== -1) {
          scripts.value.splice(index, 1)
          ElMessage({
            type: 'success',
            message: '脚本删除成功'
          })
        }
      }).catch(() => {
        ElMessage({
          type: 'info',
          message: '已取消删除'
        })
      })
    }

    // 操作方法
    const runScript = (script) => {
      console.log('运行脚本', script.id);
      // 实现运行脚本的逻辑
    };

    const toggleFavorite = (script) => {
      script.isFavorite = !script.isFavorite;
    };

    return {
      searchQuery,
      availableTags,
      selectedTags,
      filteredScripts,
      showFilterOptions,
      filterMyScripts,
      filterRecentScripts,
      filterFavoriteScripts,
      noScriptsMessage,
      formatDate,
      createNewScript,
      editScript,
      runScript,
      deleteScript,
      toggleFavorite,
      toggleTag,
      clearTags,
      dialogVisible,
      isEdit,
      scriptForm,
      saveScript
    }
  }
})
</script>

<style scoped>
.script-library-container {
  padding: 20px;
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  background-color: #1e1e1e;
  color: #e0e0e0;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.page-header h1 {
  font-size: 24px;
  font-weight: 500;
  color: #e0e0e0;
  margin: 0;
}

.btn-primary {
  display: flex;
  align-items: center;
  background-color: #2c7be5;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 8px 16px;
  font-size: 14px;
  cursor: pointer;
}

.btn-primary svg {
  margin-right: 8px;
}

.btn-primary:hover {
  background-color: #1a68d1;
}

.script-categories {
  display: flex;
  gap: 8px;
  margin-bottom: 24px;
  overflow-x: auto;
  padding-bottom: 8px;
  flex-wrap: wrap;
}

.tag-bubble {
  background-color: #252525;
  border-radius: 16px;
  padding: 6px 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  border: 1px solid #333;
  font-size: 13px;
  color: #b0b0b0;
  transition: all 0.2s ease;
}

.tag-bubble:hover {
  background-color: #2a2a2a;
  border-color: #444;
}

.tag-bubble.active {
  background-color: #2c7be5;
  border-color: #2c7be5;
  color: white;
}

.scripts-panel {
  flex: 1;
  background-color: #252525;
  border-radius: 8px;
  padding: 16px;
  border: 1px solid #333;
}

.search-bar {
  display: flex;
  margin-bottom: 16px;
  position: relative;
}

.search-input {
  flex: 1;
  background-color: #333;
  border: 1px solid #444;
  border-radius: 4px;
  padding: 8px 12px;
  color: #e0e0e0;
  font-size: 14px;
}

.search-input:focus {
  outline: none;
  border-color: #2c7be5;
}

.btn-filter {
  background-color: #333;
  border: 1px solid #444;
  border-radius: 4px;
  margin-left: 8px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #a0a0a0;
  cursor: pointer;
}

.btn-filter:hover {
  background-color: #3a3a3a;
  color: #e0e0e0;
}

.filter-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  background-color: #333;
  border: 1px solid #444;
  border-radius: 4px;
  padding: 8px;
  z-index: 100;
  margin-top: 4px;
  min-width: 180px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.filter-option {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.filter-option:last-child {
  margin-bottom: 0;
}

.filter-option label {
  margin-left: 8px;
  font-size: 14px;
  cursor: pointer;
}

.scripts-table-container {
  overflow-x: auto;
}

.scripts-table {
  width: 100%;
  border-collapse: collapse;
  color: #e0e0e0;
}

.scripts-table th {
  text-align: left;
  padding: 12px;
  background-color: #2a2a2a;
  border-bottom: 2px solid #333;
  font-weight: 500;
  font-size: 14px;
}

.scripts-table td {
  padding: 12px;
  border-bottom: 1px solid #333;
  vertical-align: middle;
}

.script-row:hover {
  background-color: #2a2a2a;
}

.script-name-column {
  width: 20%;
}

.script-desc-column {
  width: 20%;
}

.script-tags-column {
  width: 15%;
}

.script-command-column {
  width: 35%;
}

.script-actions-column {
  width: 10%;
}

.script-name {
  font-weight: 500;
}

.name-with-favorite {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.favorite-icon {
  color: gold;
  padding: 0;
}

.script-meta {
  font-size: 12px;
  color: #888;
}

.script-description {
  font-size: 14px;
  color: #b0b0b0;
}

.script-command {
  font-family: inherit;
  font-size: 14px;
  padding: 4px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 0;
}

.script-command code {
  color: #ffffff;
  font-family: inherit;
}

.script-actions {
  text-align: left;
  white-space: nowrap;
}

.script-actions .btn-icon {
  display: inline-block;
  margin-left: 12px;
}

.script-actions .btn-icon:first-child {
  margin-left: 0;
}

.btn-icon {
  background: none;
  border: none;
  color: #a0a0a0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
}

.btn-icon:hover {
  background-color: rgba(255, 255, 255, 0.1);
  color: #e0e0e0;
}

.no-scripts {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 0;
  text-align: center;
}

.no-scripts svg {
  margin-bottom: 16px;
  opacity: 0.6;
}

.no-scripts p {
  margin: 0 0 20px 0;
  color: #888;
  font-size: 16px;
}

.btn-secondary {
  background-color: #3a3a3a;
  color: #e0e0e0;
  border: none;
  border-radius: 4px;
  padding: 8px 16px;
  font-size: 14px;
  cursor: pointer;
}

.btn-secondary:hover {
  background-color: #444;
}

/* 滚动条样式 */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: #222;
}

::-webkit-scrollbar-thumb {
  background: #444;
  border-radius: 4px;
}

.action-btn {
  font-size: 16px;
  color: #a0a0a0;
}

.action-btn:hover {
  color: #409EFF;
}

.dialog-footer {
  padding-top: 20px;
  text-align: right;
}

:deep(.el-form-item__label) {
  color: #e0e0e0;
}

:deep(.el-input__wrapper),
:deep(.el-textarea__inner) {
  background-color: #2a2a2a;
  border-color: #444;
  color: #e0e0e0;
}

:deep(.el-input__wrapper:hover),
:deep(.el-textarea__inner:hover) {
  border-color: #409EFF;
}

:deep(.el-select__tags) {
  background-color: transparent;
}

.script-tags {
  padding: 4px 0;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.script-tag {
  display: inline-block;
  background-color: #333;
  color: #b0b0b0;
  border-radius: 12px;
  padding: 2px 8px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.script-tag:hover {
  background-color: #2c7be5;
  color: white;
}
</style> 