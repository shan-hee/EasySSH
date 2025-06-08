<template>
  <div class="script-library-container">
    <div class="page-header">
      <h1>脚本库</h1>
      <div class="header-actions">
        <button class="btn-secondary" @click="importScripts">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">
            <path fill="currentColor" d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z" />
            <path fill="currentColor" d="M12,11L16,15H13V19H11V15H8L12,11Z" />
          </svg>
          导入脚本
        </button>
        <button class="btn-secondary" @click="exportScripts">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">
            <path fill="currentColor" d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z" />
            <path fill="currentColor" d="M12,13L8,9H11V5H13V9H16L12,13Z" />
          </svg>
          导出脚本
        </button>
        <button class="btn-primary" @click="createNewScript">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">
            <path fill="currentColor" d="M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z" />
          </svg>
          新建脚本
        </button>
      </div>
      <!-- 隐藏的文件输入元素 -->
      <input
        ref="fileInput"
        type="file"
        accept=".json"
        style="display: none"
        @change="handleFileImport"
      />
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

      <div class="scripts-table-container" ref="tableContainer">
        <div v-if="allFilteredScripts.length === 0" class="no-scripts">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48">
            <path fill="#666" d="M19,3H5C3.89,3 3,3.89 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5C21,3.89 20.1,3 19,3M19,5V19H5V5H19Z" />
            <path fill="#666" d="M11,7H13V9H11V7M11,11H13V17H11V11Z" />
          </svg>
          <p>{{ noScriptsMessage }}</p>
          <button class="btn-secondary" @click="createNewScript">创建第一个脚本</button>
        </div>

        <div v-else class="table-with-pagination">
          <table class="scripts-table">
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
              <tr v-for="script in filteredScripts" :key="`${script.source || 'public'}-${script.id}`" class="script-row">
                <td class="script-name">
                  <div class="name-with-favorite">
                    <button class="btn-icon favorite-icon" @click="toggleFavorite(script)">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">
                        <path fill="currentColor" :d="scriptLibraryService.isFavorite(script.id) ? 'M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z' : 'M12,15.39L8.24,17.66L9.23,13.38L5.91,10.5L10.29,10.13L12,6.09L13.71,10.13L18.09,10.5L14.77,13.38L15.76,17.66M22,9.24L14.81,8.63L12,2L9.19,8.63L2,9.24L7.45,13.97L5.82,21L12,17.27L18.18,21L16.54,13.97L22,9.24Z'" />
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
                  <!-- 只有用户脚本才显示编辑按钮 -->
                  <el-button
                    v-if="script.source === 'user'"
                    class="action-btn"
                    circle
                    size="small"
                    link
                    title="编辑"
                    @click="editScript(script)"
                  >
                    <el-icon><Edit /></el-icon>
                  </el-button>
                  <!-- 运行按钮对所有脚本都显示 -->
                  <el-button class="action-btn" circle size="small" link title="运行" @click="runScript(script)">
                    <el-icon><CaretRight /></el-icon>
                  </el-button>
                  <!-- 只有用户脚本才显示删除按钮 -->
                  <el-button
                    v-if="script.source === 'user'"
                    class="action-btn"
                    circle
                    size="small"
                    link
                    title="删除"
                    @click="deleteScript(script)"
                  >
                    <el-icon><Delete /></el-icon>
                  </el-button>
                </td>
              </tr>
            </tbody>
          </table>

          <!-- 分页组件 -->
          <div class="pagination-container" v-if="shouldShowPagination">
            <div class="custom-pagination">
              <!-- 总数显示 -->
              <span class="pagination-total">共 {{ allFilteredScripts.length }} 条</span>

              <!-- 每页显示数量选择器 -->
              <div class="page-size-selector">
                <span class="page-size-label">每页</span>
                <el-select
                  v-model="pageSize"
                  class="page-size-select"
                  filterable
                  allow-create
                  default-first-option
                  @change="handlePageSizeChange"
                  placeholder="输入或选择"
                >
                  <el-option
                    v-for="size in pageSizeOptions"
                    :key="size"
                    :label="`${size}`"
                    :value="size"
                  />
                </el-select>
                <span class="page-size-label">条</span>
              </div>

              <!-- 分页导航 -->
              <el-pagination
                v-model:current-page="currentPage"
                :total="allFilteredScripts.length"
                :page-size="pageSize"
                layout="prev, pager, next, jumper"
                background
                @current-change="handlePageChange"
                :hide-on-single-page="false"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 编辑脚本弹窗 -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑脚本' : '新建脚本'"
      width="600px"
      :close-on-click-modal="false"
      class="script-dialog"
      align-center
    >
      <!-- 添加标题分界线 -->
      <div class="script-tab">
        <div class="tab-item active">
          脚本配置
        </div>
      </div>

      <div class="script-form">
        <div class="form-row form-row-two-columns">
          <div class="form-item">
            <label>脚本名称</label>
            <div class="input-wrapper">
              <input type="text" v-model="scriptForm.name" placeholder="请输入脚本名称" />
            </div>
          </div>
          <div class="form-item">
            <label>备注</label>
            <div class="input-wrapper">
              <input type="text" v-model="scriptForm.description" placeholder="请输入备注信息" />
            </div>
          </div>
        </div>

        <div class="form-row">
          <div class="form-item">
            <label>指令内容</label>
            <div class="input-wrapper">
              <textarea v-model="scriptForm.command" rows="4" placeholder="请输入指令内容"></textarea>
            </div>
          </div>
        </div>

        <div class="form-row">
          <div class="form-item">
            <label>标签</label>
            <div class="input-wrapper">
              <el-select
                v-model="scriptForm.tags"
                multiple
                filterable
                allow-create
                default-first-option
                placeholder="请选择或输入标签"
                class="script-tags-select"
              >
                <el-option
                  v-for="tag in availableTags"
                  :key="tag"
                  :label="tag"
                  :value="tag"
                />
              </el-select>
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" @click="saveScript">保存</el-button>
        </span>
      </template>
    </el-dialog>

    <!-- 服务器选择对话框 -->
    <ServerSelectionDialog
      v-model:visible="serverSelectionVisible"
      :script="selectedScript"
      @execute="handleScriptExecution"
    />

    <!-- 脚本执行结果对话框 -->
    <ScriptExecutionDialog
      v-model:visible="executionResultVisible"
      :script="executingScript"
      :execution-results="executionResults"
      @retry="handleRetryExecution"
    />
  </div>
</template>

<script>
import { defineComponent, ref, computed, watch, onMounted, nextTick } from 'vue'
import { Edit, Delete, CaretRight } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import scriptLibraryService from '@/services/scriptLibrary.js'
import ServerSelectionDialog from '@/components/dialogs/ServerSelectionDialog.vue'
import ScriptExecutionDialog from '@/components/dialogs/ScriptExecutionDialog.vue'
import apiService from '@/services/api.js'
import log from '@/services/log.js'

export default defineComponent({
  name: 'ScriptLibrary',
  components: {
    Edit,
    Delete,
    CaretRight,
    ServerSelectionDialog,
    ScriptExecutionDialog
  },
  setup() {
    const searchQuery = ref('')
    const showFilterOptions = ref(false)
    const filterMyScripts = ref(false)
    const filterRecentScripts = ref(false)
    const filterFavoriteScripts = ref(false)
    const selectedTags = ref([])

    // 分页相关
    const currentPage = ref(1)
    const pageSize = ref(10) // 默认每页10条，后续会根据容器高度动态调整
    const tableContainer = ref(null)
    const userHasChangedPageSize = ref(false) // 用户是否手动调整过页面大小
    const pageSizeOptions = ref([5, 10, 15, 20, 30, 50, 100]) // 页面大小选项

    // 导入导出相关
    const fileInput = ref(null)

    // 从脚本库服务获取数据
    const scripts = computed(() => scriptLibraryService.getAllScripts())

    // 获取所有可用的标签
    const availableTags = computed(() => {
      const tagSet = new Set()
      scripts.value.forEach(script => {
        script.tags.forEach(tag => tagSet.add(tag))
      })
      return Array.from(tagSet)
    })

    // 根据筛选条件过滤脚本（不分页）
    const allFilteredScripts = computed(() => {
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
        result = result.filter(script => script.source === 'user')
      }

      if (filterFavoriteScripts.value) {
        result = result.filter(script => scriptLibraryService.isFavorite(script.id))
      }

      if (filterRecentScripts.value) {
        const sevenDaysAgo = new Date()
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
        result = result.filter(script => {
          if (!script.updatedAt) return false
          const scriptDate = typeof script.updatedAt === 'string' ? new Date(script.updatedAt) : script.updatedAt
          return scriptDate >= sevenDaysAgo
        })
      }

      return result
    })

    // 总页数
    const totalPages = computed(() => {
      return Math.ceil(allFilteredScripts.value.length / pageSize.value)
    })

    // 是否显示分页组件
    const shouldShowPagination = computed(() => {
      const dataCount = allFilteredScripts.value.length

      // 如果没有数据，不显示分页
      if (dataCount === 0) return false

      // 如果用户手动调整过页面大小，始终显示分页组件（除非数据很少）
      if (userHasChangedPageSize.value && dataCount > 3) return true

      // 如果数据量大于默认的最小页面大小，显示分页组件
      if (dataCount > 5) return true

      // 如果有多页，显示分页组件
      if (totalPages.value > 1) return true

      return false
    })

    // 当前页显示的脚本（分页后）
    const filteredScripts = computed(() => {
      const start = (currentPage.value - 1) * pageSize.value
      const end = start + pageSize.value
      return allFilteredScripts.value.slice(start, end)
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
      currentPage.value = 1 // 重置到第一页
    }

    // 分页相关方法
    const handlePageChange = (page) => {
      currentPage.value = page

      // 页面变化后，检查是否需要滚动
      nextTick(() => {
        checkScrollNeed()
      })
    }

    const handlePageSizeChange = (size) => {
      // 验证输入值
      let validSize = parseInt(size)
      let showMessage = false
      let originalInput = size

      // 确保是有效数字
      if (isNaN(validSize) || validSize < 1) {
        validSize = 10 // 默认值
        if (originalInput !== '' && originalInput !== null && originalInput !== undefined) {
          ElMessage.warning('请输入有效的数字，已重置为默认值10')
          showMessage = true
        }
      }

      // 限制最大值
      if (validSize > 1000) {
        validSize = 1000
        ElMessage.warning('每页最多显示1000条数据，已调整为1000')
        showMessage = true
      }

      // 限制最小值
      if (validSize < 1) {
        validSize = 1
        ElMessage.warning('每页至少显示1条数据，已调整为1')
        showMessage = true
      }

      // 如果输入的值被调整了，给出提示
      if (!showMessage && parseInt(originalInput) !== validSize && originalInput !== validSize) {
        ElMessage.info(`已调整为 ${validSize} 条每页`)
      }

      pageSize.value = validSize
      currentPage.value = 1 // 重置到第一页
      userHasChangedPageSize.value = true // 标记用户已手动调整

      // 如果用户输入了新的值，添加到选项中
      if (!pageSizeOptions.value.includes(validSize) && validSize <= 100) {
        pageSizeOptions.value.push(validSize)
        pageSizeOptions.value.sort((a, b) => a - b)
      }

      // 页面大小变化后，检查是否需要滚动
      nextTick(() => {
        checkScrollNeed()
      })
    }

    // 检查是否需要滚动
    const checkScrollNeed = () => {
      if (!tableContainer.value) return

      nextTick(() => {
        const container = tableContainer.value
        const tableWithPagination = container.querySelector('.table-with-pagination')

        if (tableWithPagination) {
          const containerHeight = container.clientHeight
          const contentHeight = tableWithPagination.scrollHeight

          // 添加一些容差，避免因为像素差异导致的问题
          const tolerance = 5

          // 如果内容高度超过容器高度，允许滚动
          if (contentHeight > containerHeight + tolerance) {
            container.style.overflowY = 'auto'
            tableWithPagination.style.overflowY = 'visible'
          } else {
            // 否则隐藏滚动条
            container.style.overflowY = 'hidden'
            tableWithPagination.style.overflowY = 'hidden'
          }
        }
      })
    }

    // 计算最佳页面大小
    const calculateOptimalPageSize = () => {
      if (!tableContainer.value || allFilteredScripts.value.length === 0) return

      // 等待DOM更新完成后再计算
      nextTick(() => {
        const containerHeight = tableContainer.value.clientHeight

        // 查找实际的表头高度
        const tableHeader = tableContainer.value.querySelector('.scripts-table thead')
        const headerHeight = tableHeader ? tableHeader.offsetHeight : 50

        // 查找实际的分页组件高度（如果存在）
        const paginationEl = tableContainer.value.querySelector('.pagination-container')
        const paginationHeight = paginationEl ? paginationEl.offsetHeight : 65

        // 查找实际的行高度
        const firstRow = tableContainer.value.querySelector('.script-row')
        const rowHeight = firstRow ? firstRow.offsetHeight : 65

        // 计算可用高度，预留分页组件空间
        const reservedPaginationHeight = shouldShowPagination.value ? paginationHeight : 0
        const availableHeight = containerHeight - headerHeight - reservedPaginationHeight - 5
        const optimalRows = Math.floor(availableHeight / rowHeight)

        // 确保至少显示3行，最多15行
        let newPageSize = Math.max(3, Math.min(15, optimalRows))

        // 如果数据总量小于计算出的页面大小，则使用数据总量
        if (allFilteredScripts.value.length < newPageSize) {
          newPageSize = allFilteredScripts.value.length
        }

        // 只有当计算出的页面大小与当前不同时才更新
        if (newPageSize !== pageSize.value && newPageSize > 0) {
          pageSize.value = newPageSize
          currentPage.value = 1 // 重置到第一页
        }
      })
    }

    // 监听筛选条件变化，重置到第一页
    watch([searchQuery, selectedTags, filterMyScripts, filterRecentScripts, filterFavoriteScripts], () => {
      currentPage.value = 1
    })

    // 监听过滤后的脚本数量变化，重新计算页面大小
    watch(allFilteredScripts, () => {
      nextTick(() => {
        // 延迟计算，确保DOM已更新
        setTimeout(() => {
          calculateOptimalPageSize()
          checkScrollNeed()
        }, 50)
      })
    }, { immediate: true })

    // 监听当前页显示的脚本变化，检查滚动需求
    watch(filteredScripts, () => {
      nextTick(() => {
        setTimeout(() => {
          checkScrollNeed()
        }, 50)
      })
    })

    // 监听分页显示状态变化，重新计算和检查滚动
    watch(shouldShowPagination, () => {
      nextTick(() => {
        setTimeout(() => {
          calculateOptimalPageSize()
          checkScrollNeed()
        }, 50)
      })
    })

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
      if (!date) return '-'

      // 如果是字符串，转换为Date对象
      const dateObj = typeof date === 'string' ? new Date(date) : date

      // 检查是否是有效的日期
      if (isNaN(dateObj.getTime())) return '-'

      return dateObj.toLocaleDateString('zh-CN', {
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
      updatedAt: null
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
        updatedAt: null
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
      // 只允许编辑用户脚本
      if (script.source !== 'user') {
        ElMessage.warning('只能编辑自己创建的脚本')
        return
      }

      isEdit.value = true
      scriptForm.value = { ...script }
      dialogVisible.value = true
    }

    // 保存脚本
    const saveScript = async () => {
      if (!scriptForm.value.name) {
        ElMessage.warning('请输入脚本名称')
        return
      }
      if (!scriptForm.value.command) {
        ElMessage.warning('请输入指令内容')
        return
      }

      try {
        if (isEdit.value) {
          // 更新现有脚本
          const response = await apiService.put(`/scripts/user/${scriptForm.value.id}`, {
            name: scriptForm.value.name,
            description: scriptForm.value.description,
            command: scriptForm.value.command,
            tags: scriptForm.value.tags,
            category: '我的脚本'
          })

          if (response && response.success) {
            // 更新本地数据
            const allScripts = scriptLibraryService.getAllScripts()
            const index = allScripts.findIndex(s => s.id === scriptForm.value.id && s.source === 'user')
            if (index !== -1) {
              // 更新脚本库服务中的数据
              const userScripts = scriptLibraryService.getUserScripts()
              const userIndex = userScripts.findIndex(s => s.id === scriptForm.value.id)
              if (userIndex !== -1) {
                userScripts[userIndex] = {
                  ...response.script,
                  source: 'user'
                }
                scriptLibraryService.saveToLocal()
              }
            }
            ElMessage.success('脚本更新成功')
          } else {
            throw new Error(response?.message || '更新脚本失败')
          }
        } else {
          // 创建新脚本
          const response = await apiService.post('/scripts/user', {
            name: scriptForm.value.name,
            description: scriptForm.value.description,
            command: scriptForm.value.command,
            tags: scriptForm.value.tags,
            category: '我的脚本'
          })

          if (response && response.success) {
            // 添加到本地脚本库
            const newScript = {
              ...response.script,
              source: 'user'
            }
            scriptLibraryService.userScripts.value.push(newScript)
            scriptLibraryService.saveToLocal()
            ElMessage.success('脚本创建成功')
          } else {
            throw new Error(response?.message || '创建脚本失败')
          }
        }

        dialogVisible.value = false
        resetForm()
      } catch (error) {
        log.error('保存脚本失败:', error)
        ElMessage.error('保存脚本失败: ' + error.message)
      }
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
      ).then(async () => {
        try {
          // 如果是用户脚本，调用后端API删除
          if (script.source === 'user') {
            const response = await apiService.delete(`/scripts/user/${script.id}`)

            if (response && response.success) {
              // 从本地脚本库中删除
              const userScripts = scriptLibraryService.getUserScripts()
              const index = userScripts.findIndex(s => s.id === script.id)
              if (index !== -1) {
                userScripts.splice(index, 1)
                scriptLibraryService.saveToLocal()
              }
              ElMessage({
                type: 'success',
                message: '脚本删除成功'
              })
            } else {
              throw new Error(response?.message || '删除脚本失败')
            }
          } else {
            // 公开脚本不能删除
            ElMessage.warning('公开脚本不能删除')
          }
        } catch (error) {
          log.error('删除脚本失败:', error)
          ElMessage.error('删除脚本失败: ' + error.message)
        }
      }).catch(() => {
        ElMessage({
          type: 'info',
          message: '已取消删除'
        })
      })
    }

    // 服务器选择对话框状态
    const serverSelectionVisible = ref(false)
    const selectedScript = ref(null)

    // 脚本执行结果对话框状态
    const executionResultVisible = ref(false)
    const executingScript = ref(null)
    const executionResults = ref([])

    // 操作方法
    const runScript = (script) => {
      selectedScript.value = script
      serverSelectionVisible.value = true
    };

    const toggleFavorite = (script) => {
      scriptLibraryService.toggleFavorite(script.id);
    };

    // 处理脚本执行
    const handleScriptExecution = async ({ script, servers }) => {
      try {
        log.info('开始执行脚本', {
          scriptName: script.name,
          command: script.command,
          serverCount: servers.length
        })

        // 设置执行状态
        executingScript.value = script
        executionResults.value = servers.map(server => ({
          server,
          status: 'pending',
          stdout: '',
          stderr: '',
          error: null,
          executedAt: null,
          duration: null
        }))

        // 显示执行结果对话框
        executionResultVisible.value = true

        // 显示执行开始消息
        ElMessage.info(`开始在 ${servers.length} 台服务器上执行脚本: ${script.name}`)

        // 并发执行脚本
        const executionPromises = servers.map(async (server, index) => {
          const startTime = Date.now()

          // 更新状态为执行中
          executionResults.value[index].status = 'running'
          executionResults.value[index].executedAt = new Date().toISOString()

          try {
            const response = await apiService.post('/scripts/execute', {
              scriptId: script.id,
              scriptName: script.name,
              command: script.command,
              serverId: server.id,
              serverName: server.name,
              host: server.host,
              port: server.port,
              username: server.username
            })

            const duration = Date.now() - startTime

            if (response && response.success) {
              log.info(`脚本在服务器 ${server.name} 上执行成功`)

              // 更新执行结果
              executionResults.value[index] = {
                ...executionResults.value[index],
                status: 'success',
                stdout: response.result?.stdout || '',
                stderr: response.result?.stderr || '',
                duration
              }
            } else {
              throw new Error(response?.message || '执行失败')
            }
          } catch (error) {
            log.error(`脚本在服务器 ${server.name} 上执行失败`, error)

            const duration = Date.now() - startTime

            // 更新执行结果
            executionResults.value[index] = {
              ...executionResults.value[index],
              status: 'failed',
              error: error.message,
              duration
            }
          }
        })

        // 等待所有执行完成
        await Promise.all(executionPromises)

        // 统计执行结果
        const successCount = executionResults.value.filter(r => r.status === 'success').length
        const failureCount = executionResults.value.filter(r => r.status === 'failed').length

        // 显示执行结果
        if (failureCount === 0) {
          ElMessage.success(`脚本执行完成！成功: ${successCount} 台服务器`)
        } else if (successCount === 0) {
          ElMessage.error(`脚本执行失败！失败: ${failureCount} 台服务器`)
        } else {
          ElMessage.warning(`脚本执行完成！成功: ${successCount} 台，失败: ${failureCount} 台`)
        }

        // 记录脚本使用
        try {
          await apiService.post('/scripts/usage', {
            scriptId: script.id,
            scriptName: script.name,
            command: script.command
          })
        } catch (error) {
          log.warn('记录脚本使用失败', error)
        }

      } catch (error) {
        log.error('脚本执行过程中发生错误', error)
        ElMessage.error('脚本执行失败: ' + error.message)
      }
    };

    // 处理重试执行
    const handleRetryExecution = ({ script, servers }) => {
      handleScriptExecution({ script, servers })
    };

    // 导入脚本功能
    const importScripts = () => {
      if (fileInput.value) {
        fileInput.value.click()
      }
    }

    // 处理文件导入
    const handleFileImport = (event) => {
      const file = event.target.files[0]
      if (!file) return

      if (!file.name.endsWith('.json')) {
        ElMessage.error('请选择JSON格式的文件')
        return
      }

      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const importedData = JSON.parse(e.target.result)

          // 验证导入数据格式
          if (!Array.isArray(importedData)) {
            ElMessage.error('文件格式错误：应该是脚本数组')
            return
          }

          let importedCount = 0
          let skippedCount = 0

          importedData.forEach(scriptData => {
            // 验证必要字段
            if (!scriptData.name || !scriptData.command) {
              skippedCount++
              return
            }

            // 检查是否已存在同名脚本
            const existingScript = scripts.value.find(s => s.name === scriptData.name)
            if (existingScript) {
              skippedCount++
              return
            }

            // 创建新脚本
            const maxId = Math.max(...scripts.value.map(s => s.id), 0)
            const newScript = {
              id: maxId + importedCount + 1,
              name: scriptData.name,
              description: scriptData.description || '',
              command: scriptData.command,
              tags: Array.isArray(scriptData.tags) ? scriptData.tags : [],
              author: scriptData.author || '导入用户',
              updatedAt: new Date()
            }

            scripts.value.push(newScript)
            importedCount++
          })

          if (importedCount > 0) {
            ElMessage.success(`成功导入 ${importedCount} 个脚本${skippedCount > 0 ? `，跳过 ${skippedCount} 个重复或无效脚本` : ''}`)
          } else {
            ElMessage.warning('没有导入任何脚本，可能存在重复或格式错误')
          }

        } catch (error) {
          ElMessage.error('文件解析失败，请检查文件格式')
          console.error('Import error:', error)
        }
      }

      reader.readAsText(file)
      // 清空文件输入，允许重复选择同一文件
      event.target.value = ''
    }

    // 导出脚本功能
    const exportScripts = () => {
      if (scripts.value.length === 0) {
        ElMessage.warning('没有可导出的脚本')
        return
      }

      try {
        // 准备导出数据，移除不必要的字段
        const exportData = scripts.value.map(script => ({
          name: script.name,
          description: script.description,
          command: script.command,
          tags: script.tags,
          author: script.author,
          updatedAt: script.updatedAt
        }))

        // 创建下载链接
        const dataStr = JSON.stringify(exportData, null, 2)
        const dataBlob = new Blob([dataStr], { type: 'application/json' })
        const url = URL.createObjectURL(dataBlob)

        // 创建下载链接并触发下载
        const link = document.createElement('a')
        link.href = url
        link.download = `scripts_export_${new Date().toISOString().slice(0, 10)}.json`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)

        // 清理URL对象
        URL.revokeObjectURL(url)

        ElMessage.success(`成功导出 ${scripts.value.length} 个脚本`)
      } catch (error) {
        ElMessage.error('导出失败，请重试')
        console.error('Export error:', error)
      }
    }

    // 防抖函数
    const debounce = (func, wait) => {
      let timeout
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout)
          func(...args)
        }
        clearTimeout(timeout)
        timeout = setTimeout(later, wait)
      }
    }

    // 防抖的计算函数
    const debouncedCalculatePageSize = debounce(calculateOptimalPageSize, 300)

    // 防抖的滚动检查函数
    const debouncedCheckScroll = debounce(checkScrollNeed, 100)

    // 生命周期钩子
    onMounted(() => {
      // 初始计算
      nextTick(() => {
        calculateOptimalPageSize()
        checkScrollNeed()

        // 延迟再次计算，确保所有元素都已渲染完成
        setTimeout(() => {
          calculateOptimalPageSize()
          checkScrollNeed()
        }, 100)

        // 监听窗口大小变化，使用防抖
        window.addEventListener('resize', () => {
          debouncedCalculatePageSize()
          debouncedCheckScroll()
        })
      })
    })

    return {
      searchQuery,
      availableTags,
      selectedTags,
      filteredScripts,
      allFilteredScripts,
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
      saveScript,
      // 分页相关
      currentPage,
      pageSize,
      pageSizeOptions,
      totalPages,
      shouldShowPagination,
      tableContainer,
      handlePageChange,
      handlePageSizeChange,
      calculateOptimalPageSize,
      checkScrollNeed,
      // 导入导出相关
      fileInput,
      importScripts,
      exportScripts,
      handleFileImport,
      // 脚本库服务
      scriptLibraryService,
      // 服务器选择对话框
      serverSelectionVisible,
      selectedScript,
      handleScriptExecution,
      // 脚本执行结果对话框
      executionResultVisible,
      executingScript,
      executionResults,
      handleRetryExecution
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
  min-height: 0;
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

.header-actions {
  display: flex;
  gap: 12px;
  align-items: center;
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
  flex-wrap: wrap;
  min-height: auto;
  max-height: none;
  overflow: visible;
  padding-bottom: 8px;
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
  white-space: nowrap;
  flex-shrink: 0;
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
  min-height: 0;
  display: flex;
  flex-direction: column;
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
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden; /* 默认隐藏，通过JS动态控制 */
}

.scripts-table {
  width: 100%;
  border-collapse: collapse;
  color: #e0e0e0;
  table-layout: fixed;
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
  display: flex;
  align-items: center;
  background-color: #3a3a3a;
  color: #e0e0e0;
  border: none;
  border-radius: 4px;
  padding: 8px 16px;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.btn-secondary svg {
  margin-right: 8px;
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

/* 对话框按钮样式 */
.dialog-footer :deep(.el-button) {
  transition: all 0.3s ease;
}

/* 取消按钮悬浮效果 - 只高亮不变色 */
.dialog-footer :deep(.el-button:not(.el-button--primary):hover) {
  background-color: rgba(255, 255, 255, 0.1);
  border-color: #666;
  color: inherit;
}

/* 保存按钮保持原有的悬浮效果 */
.dialog-footer :deep(.el-button--primary:hover) {
  background-color: #1a68d1;
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

/* 分页相关样式 */
.table-with-pagination {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden; /* 默认隐藏，通过JS动态控制 */
}

.scripts-table {
  flex-shrink: 0;
  overflow: visible;
}

.pagination-container {
  margin-top: 8px;
  display: flex;
  justify-content: center;
  padding: 12px 0;
  border-top: 1px solid #333;
  flex-shrink: 0;
  background-color: #252525;
}

.custom-pagination {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  justify-content: center;
}

.pagination-total {
  color: #a0a0a0;
  font-size: 14px;
  white-space: nowrap;
}

.page-size-selector {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}

.page-size-label {
  color: #a0a0a0;
  font-size: 14px;
}

.page-size-select {
  width: 120px;
  min-width: 100px;
}

.page-size-select :deep(.el-select__wrapper) {
  background-color: #333;
  border-color: #444;
  color: #e0e0e0;
}

.page-size-select :deep(.el-select__wrapper:hover) {
  border-color: #2c7be5;
}

.page-size-select :deep(.el-select__wrapper.is-focused) {
  border-color: #2c7be5;
}

.page-size-select :deep(.el-input__inner) {
  color: #e0e0e0;
  text-align: center;
}

.page-size-select :deep(.el-select__caret) {
  color: #a0a0a0;
}

.page-size-select :deep(.el-select__caret:hover) {
  color: #2c7be5;
}

/* Element Plus 分页组件深度样式 */
:deep(.el-pagination) {
  --el-pagination-bg-color: #252525;
  --el-pagination-text-color: #e0e0e0;
  --el-pagination-border-radius: 4px;
  --el-pagination-button-color: #a0a0a0;
  --el-pagination-button-bg-color: #333;
  --el-pagination-button-disabled-color: #666;
  --el-pagination-button-disabled-bg-color: #2a2a2a;
  --el-pagination-hover-color: #2c7be5;
}

:deep(.el-pagination .el-pager li) {
  background-color: #333;
  color: #a0a0a0;
  border: 1px solid #444;
  margin: 0 2px;
}

:deep(.el-pagination .el-pager li:hover) {
  color: #2c7be5;
  border-color: #2c7be5;
}

:deep(.el-pagination .el-pager li.is-active) {
  background-color: #2c7be5;
  color: white;
  border-color: #2c7be5;
}

:deep(.el-pagination .btn-prev),
:deep(.el-pagination .btn-next) {
  background-color: #333;
  color: #a0a0a0;
  border: 1px solid #444;
}

:deep(.el-pagination .btn-prev:hover),
:deep(.el-pagination .btn-next:hover) {
  color: #2c7be5;
  border-color: #2c7be5;
}

:deep(.el-pagination .el-pagination__total) {
  color: #a0a0a0;
}

:deep(.el-pagination .el-pagination__jump) {
  color: #a0a0a0;
}

:deep(.el-select .el-select__wrapper) {
  background-color: #333;
  border-color: #444;
}

:deep(.el-select .el-select__wrapper:hover) {
  border-color: #2c7be5;
}

:deep(.el-input__wrapper) {
  background-color: #333;
  border-color: #444;
}

:deep(.el-input__wrapper:hover) {
  border-color: #2c7be5;
}

/* 页面大小选择器下拉选项样式 */
:deep(.el-select-dropdown) {
  background-color: #333;
  border-color: #444;
}

:deep(.el-select-dropdown .el-select-dropdown__item) {
  color: #e0e0e0;
  background-color: #333;
}

:deep(.el-select-dropdown .el-select-dropdown__item:hover) {
  background-color: #2c7be5;
  color: white;
}

:deep(.el-select-dropdown .el-select-dropdown__item.is-selected) {
  background-color: #2c7be5;
  color: white;
}

/* 脚本表单样式 - 与连接表单保持一致 */
.script-dialog :deep(.el-dialog__body) {
  padding: 15px;
  background-color: #121212;
}

/* 标题分界线样式 */
.script-tab {
  display: flex;
  border-bottom: 1px solid #3a3a3a;
  margin-bottom: 20px;
  padding: 0 15px;
}

.script-tab .tab-item {
  padding: 10px 15px;
  color: #fff;
  font-weight: bold;
  cursor: pointer;
  position: relative;
  text-align: center;
  padding-left: 0;
  padding-right: 0;
  display: inline-block;
  width: auto;
  font-size: 12px;
}

.script-tab .tab-item.active {
  color: #fff;
}

.script-tab .tab-item.active::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0;
  width: 100%;
  height: 2px;
  background-color: #fff;
}

.script-form {
  width: 100%;
}

.script-form .form-row {
  margin-bottom: 16px;
  width: 100%;
}

.script-form .form-row-two-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 15px;
}

.script-form .form-item {
  width: 100%;
  padding: 0 20px;
}

.script-form .form-item label {
  display: block;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: normal;
  color: #fff;
}

.script-form .input-wrapper {
  width: 100%;
}

.script-form .form-item input,
.script-form .form-item textarea {
  width: 100%;
  height: 36px;
  background-color: transparent;
  border: 1px solid #666;
  border-radius: 6px;
  color: #fff;
  padding: 0 10px;
  box-sizing: border-box;
  outline: none;
  font-weight: normal;
  transition: border-color 0.3s;
  font-family: inherit;
}

.script-form .form-item textarea {
  height: auto;
  padding: 10px 10px;
  resize: vertical;
  min-height: 80px;
}

.script-form .form-item input:focus,
.script-form .form-item textarea:focus {
  border-color: #0083d3;
  box-shadow: 0 0 0 1px rgba(0, 131, 211, 0.2);
}

.script-form .form-item input::placeholder,
.script-form .form-item textarea::placeholder {
  color: #666;
}

/* 标签选择器样式调整 */
.script-tags-select {
  width: 100%;
}

.script-tags-select :deep(.el-select__wrapper) {
  background-color: transparent;
  border: 1px solid #666;
  border-radius: 6px;
  color: #fff;
  min-height: 36px;
  padding: 0 10px;
  transition: border-color 0.3s;
}

.script-tags-select :deep(.el-select__wrapper:hover) {
  border-color: #0083d3;
}

.script-tags-select :deep(.el-select__wrapper.is-focused) {
  border-color: #0083d3;
  box-shadow: 0 0 0 1px rgba(0, 131, 211, 0.2);
}

.script-tags-select :deep(.el-select__placeholder) {
  color: #666;
}

.script-tags-select :deep(.el-tag) {
  background-color: #333;
  border-color: #444;
  color: #e0e0e0;
}

.script-tags-select :deep(.el-tag .el-tag__close) {
  color: #a0a0a0;
}

.script-tags-select :deep(.el-tag .el-tag__close:hover) {
  color: #fff;
}

/* 脚本弹窗定位样式 - 参考新建连接界面的Modal定位 */
.script-dialog :deep(.el-overlay) {
  display: flex;
  justify-content: center;
  align-items: center;
}

.script-dialog :deep(.el-dialog) {
  margin: 0;
  position: relative;
  transform: none;
}
</style> 