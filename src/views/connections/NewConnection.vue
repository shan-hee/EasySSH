<template>
  <div class="new-connection-container">
    <div class="connection-header">
      <h1>连接配置</h1>
    </div>
    
    <div class="connection-content">
    <div class="connection-form-container">
        <div class="control-row">
          <div class="add-connection">
            <AddButton @click="showNewConnectionDialog" />
          </div>
          <div class="search-container">
            <SearchInput 
              v-model="searchQuery" 
              @search="handleSearch" 
            />
          </div>
        </div>
        
        <div class="connection-section">
          <h2>我的连接配置</h2>
          <div class="connection-rows">
            <!-- 加载状态指示器 -->
            <div v-if="connectionsLoading && !connectionsLoaded" class="loading-indicator">
              <div class="loading-spinner"></div>
              <span>正在加载连接数据...</span>
              <span v-if="connectionsRetryCount > 0" class="retry-info">
                (重试 {{ connectionsRetryCount }}/3)
              </span>
            </div>
            <!-- 错误状态指示器 -->
            <div v-else-if="connectionsError && !connectionsLoaded" class="error-indicator">
              <div class="error-icon">⚠️</div>
              <div class="error-content">
                <span class="error-message">连接数据加载失败</span>
                <button class="retry-btn" @click="retryLoadConnections">重试</button>
              </div>
            </div>
            <!-- 连接列表 -->
            <div v-else class="row-item" v-for="connection in filteredConnections" :key="connection.id" :data-pinned="isPinned(connection.id)" @click="handleLogin(connection)">
              <div class="row-item-left">
                <div class="icon-cell">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
                    <path fill="#a0a0a0" d="M4,1H20A1,1 0 0,1 21,2V6A1,1 0 0,1 20,7H4A1,1 0 0,1 3,6V2A1,1 0 0,1 4,1M4,9H20A1,1 0 0,1 21,10V14A1,1 0 0,1 20,15H4A1,1 0 0,1 3,14V10A1,1 0 0,1 4,9M4,17H20A1,1 0 0,1 21,18V22A1,1 0 0,1 20,23H4A1,1 0 0,1 3,22V18A1,1 0 0,1 4,17M9,5H10V3H9V5M9,13H10V11H9V13M9,21H10V19H9V21M5,3.5A1.5,1.5 0 0,0 6.5,5A1.5,1.5 0 0,0 5,6.5A1.5,1.5 0 0,0 3.5,5A1.5,1.5 0 0,0 5,3.5M5,11.5A1.5,1.5 0 0,0 6.5,13A1.5,1.5 0 0,0 5,14.5A1.5,1.5 0 0,0 3.5,13A1.5,1.5 0 0,0 5,11.5M5,19.5A1.5,1.5 0 0,0 6.5,21A1.5,1.5 0 0,0 5,22.5A1.5,1.5 0 0,0 3.5,21A1.5,1.5 0 0,0 5,19.5Z"></path>
                  </svg>
                </div>
                <div class="name-cell">{{ getDisplayName(connection) }}</div>
              </div>
              <div class="row-item-right">
                <div class="address-cell">{{ connection.host }}</div>
                <div class="actions-cell" @click.stop>
                  <el-button class="action-btn" circle size="small" link title="登录" @click.stop="handleLogin(connection)">
                    <el-icon><Connection /></el-icon>
                  </el-button>
                  <el-button class="action-btn" circle size="small" link :title="isPinned(connection.id) ? '取消置顶' : '置顶'" @click.stop="handleTop(connection)">
                    <template v-if="isPinned(connection.id)">
                      <svg id="ot-cancel-backtop" class="ruyi-icon ruyi-icon-ot-cancel-backtop" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
                        <g fill="none">
                          <path d="M2.5 1.48828H13.5V2.48828L2.5 2.48828V1.48828ZM4.48413 7.09557L2.63143 9.11668C2.49745 9.26285 2.46249 9.47438 2.54234 9.65588C2.62218 9.83738 2.80173 9.95455 3.00001 9.95455H5.22728V14C5.22728 14.2761 5.45114 14.5 5.72728 14.5H10.2727C10.5489 14.5 10.7727 14.2761 10.7727 14V13.3842L9.77274 12.3842V13.5H6.22728V9.45455C6.22728 9.1784 6.00343 8.95455 5.72728 8.95455H4.13663L5.1919 7.80334L4.48413 7.09557ZM10.5857 8.95455H11.8634L8.00001 4.73995L7.22099 5.58979L6.51321 4.88201L7.63143 3.66214C7.72614 3.55882 7.85986 3.5 8.00001 3.5C8.14016 3.5 8.27388 3.55882 8.36859 3.66214L13.3686 9.11668C13.5026 9.26285 13.5375 9.47438 13.4577 9.65588C13.3778 9.83738 13.1983 9.95455 13 9.95455H11.5857L10.5857 8.95455ZM13.8536 13.6347L3.36527 3.14645L2.65817 3.85355L13.1464 14.3418L13.8536 13.6347Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" fill-opacity="1"></path>
                        </g>
                      </svg>
                    </template>
                    <template v-else>
                      <svg id="ot-backtop" class="ruyi-icon ruyi-icon-ot-backtop" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
                        <g fill="none">
                          <path d="M2.5 1.48828L13.5 1.48828L13.5 2.48828L2.5 2.48828L2.5 1.48828Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" fill-opacity="1"></path>
                          <path d="M3 9.45455L8 4L13 9.45455H10.2727V14H5.72727V9.45455H3Z" stroke="currentColor" stroke-linejoin="round" stroke-opacity="1"></path>
                        </g>
                      </svg>
                    </template>
                  </el-button>
                  <el-button class="action-btn" circle size="small" link title="编辑" @click.stop="handleEdit(connection)">
                    <el-icon><Edit /></el-icon>
                  </el-button>
                  <el-button class="action-btn" circle size="small" link title="删除" @click.stop="handleDelete(connection)">
                    <el-icon><Delete /></el-icon>
                  </el-button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="connection-section">
          <div class="section-header">
            <h2>历史连接配置</h2>
            <button
              class="edit-btn"
              @click="toggleEditMode"
              :class="{ active: isEditMode }"
              title="编辑"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">
                <path fill="currentColor" d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z"/>
              </svg>
            </button>
          </div>
          <!-- 历史记录加载状态指示器 -->
          <div v-if="historyLoading && !historyLoaded" class="loading-indicator">
            <div class="loading-spinner"></div>
            <span>正在加载历史记录...</span>
            <span v-if="historyRetryCount > 0" class="retry-info">
              (重试 {{ historyRetryCount }}/3)
            </span>
          </div>
          <!-- 历史记录错误状态指示器 -->
          <div v-else-if="historyError && !historyLoaded" class="error-indicator">
            <div class="error-icon">⚠️</div>
            <div class="error-content">
              <span class="error-message">历史记录加载失败</span>
              <button class="retry-btn" @click="retryLoadHistory">重试</button>
            </div>
          </div>
          <!-- 历史记录列表 -->
          <transition-group
            v-else
            name="drag"
            class="connection-grid"
            :class="{ 'edit-mode': isEditMode }"
            tag="div"
          >
            <div
              class="connection-card"
              v-for="(connection, index) in filteredHistoryConnections"
              :key="`${connection.id}-${connection.timestamp}`"
              :class="{
                'floating': isEditMode,
                'swinging': isEditMode,
                'being-dragged': isEditMode && dragIndex === index
              }"
              :draggable="isEditMode"
              @click="!isEditMode && handleLogin(connection)"
              @dragstart="handleDragStart(index)"
              @dragover="handleDragOver($event)"
              @dragenter="handleDragEnter($event, index)"
              @dragend="handleDragEnd"
            >
              <div class="card-content">
                <div class="connection-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
                    <path fill="#a0a0a0" d="M4,1H20A1,1 0 0,1 21,2V6A1,1 0 0,1 20,7H4A1,1 0 0,1 3,6V2A1,1 0 0,1 4,1M4,9H20A1,1 0 0,1 21,10V14A1,1 0 0,1 20,15H4A1,1 0 0,1 3,14V10A1,1 0 0,1 4,9M4,17H20A1,1 0 0,1 21,18V22A1,1 0 0,1 20,23H4A1,1 0 0,1 3,22V18A1,1 0 0,1 4,17M9,5H10V3H9V5M9,13H10V11H9V13M9,21H10V19H9V21M5,3.5A1.5,1.5 0 0,0 6.5,5A1.5,1.5 0 0,0 5,6.5A1.5,1.5 0 0,0 3.5,5A1.5,1.5 0 0,0 5,3.5M5,11.5A1.5,1.5 0 0,0 6.5,13A1.5,1.5 0 0,0 5,14.5A1.5,1.5 0 0,0 3.5,13A1.5,1.5 0 0,0 5,11.5M5,19.5A1.5,1.5 0 0,0 6.5,21A1.5,1.5 0 0,0 5,22.5A1.5,1.5 0 0,0 3.5,21A1.5,1.5 0 0,0 5,19.5Z"></path>
                  </svg>
                </div>
                <div class="connection-details">
                  <div class="connection-name">{{ getDisplayName(connection) }}</div>
                  <div class="connection-address">{{ connection.host }}</div>
                </div>
              </div>
              <!-- 删除按钮 -->
              <div
                v-if="isEditMode"
                class="delete-btn"
                @click.stop="handleDeleteHistory(connection, index)"
                title="删除"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="8" height="8">
                  <path fill="currentColor" d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/>
                </svg>
              </div>
            </div>
          </transition-group>
        </div>
      </div>
    </div>
    
    <!-- 使用新的 Modal 组件 -->
    <Modal 
      v-model:visible="dialogVisible" 
      :title="isEdit ? '编辑连接' : '新建连接'"
      :tabs="['云服务器']"
      @close="resetConnectionForm"
      @confirm="saveConnection"
      customClass="connection-modal"
      :buttons="[
        { text: '取消', type: 'cancel', onClick: resetConnectionForm },
        { text: '保存', type: 'confirm', onClick: saveConnection },
        { text: '保存并连接', type: 'primary', onClick: saveAndConnect }
      ]"
    >
      <div class="connection-form">
        <div class="form-row form-row-two-columns">
          <div class="form-item">
            <label>云服务器公网IP或域名</label>
            <div class="input-wrapper">
              <input type="text" v-model="connectionForm.host" placeholder="请输入云服务器公网IP或域名" />
            </div>
          </div>
          
          <div class="form-item">
            <label>云服务器端口</label>
            <div class="input-wrapper">
              <input type="text" v-model="connectionForm.port" placeholder="22" />
            </div>
          </div>
        </div>
        
        <div class="form-row form-row-two-columns">
          <div class="form-item">
            <label>用户名</label>
            <div class="input-wrapper">
              <input type="text" v-model="connectionForm.username" placeholder="请输入用户名" />
            </div>
          </div>
          
          <div class="form-item">
            <label>备注 (选填)</label>
            <div class="input-wrapper">
              <input type="text" v-model="connectionForm.description" placeholder="请输入备注" />
            </div>
          </div>
        </div>
        
        <div class="form-row">
          <div class="form-item">
            <label>验证方式</label>
            <div class="auth-switcher">
              <button 
                :class="{'active': connectionForm.authType === 'password'}" 
                @click="connectionForm.authType = 'password'"
              >密码验证</button>
              <button 
                :class="{'active': connectionForm.authType === 'key'}" 
                @click="connectionForm.authType = 'key'"
              >秘钥验证</button>
            </div>
          </div>
        </div>
        
        <div class="form-row" v-if="connectionForm.authType === 'password'">
          <div class="form-item">
            <label>密码 (选填)</label>
            <div class="input-wrapper">
              <form>
                <input type="text" v-model="connectionForm.username" autocomplete="username" style="display:none;" />
                <input type="password" v-model="connectionForm.password" placeholder="请输入密码" autocomplete="current-password" />
              </form>
            </div>
            <div class="remember-password">
              <Checkbox
                v-model="connectionForm.rememberPassword"
                label="记住密码"
              />
            </div>
          </div>
        </div>
        
        <div class="form-row" v-else>
          <div class="form-item">
            <label>秘钥文件</label>
            <div class="input-wrapper key-file-wrapper">
              <input type="text" v-model="connectionForm.keyFile" placeholder="请选择秘钥文件" readonly @click="selectKeyFile" />
              <button class="select-file-btn" @click="selectKeyFile">选择密钥</button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  </div>
</template>

<script>
import { ref, computed, nextTick, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/store/user'
import { useLocalConnectionsStore } from '@/store/localConnections'
import { useTabStore } from '@/store/tab'
import { useSessionStore } from '@/store/session'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Document, CaretBottom, ArrowUp, Edit, Delete, Search, Monitor, Connection, Top } from '@element-plus/icons-vue'
import Modal from '@/components/common/Modal.vue'
import AddButton from '@/components/common/AddButton.vue'
import SearchInput from '@/components/common/SearchInput.vue'
import Checkbox from '@/components/common/Checkbox.vue'
import log from '@/services/log'

export default {
  name: 'NewConnection',
  components: {
    Document, 
    CaretBottom,
    ArrowUp,
    Edit,
    Delete,
    Search,
    Monitor,
    Modal,
    AddButton,
    SearchInput,
    Checkbox,
    Connection,
    Top
  },
  setup() {
    const userStore = useUserStore()
    const localConnectionsStore = useLocalConnectionsStore()
    const tabStore = useTabStore()
    const sessionStore = useSessionStore()
    const router = useRouter()
    
    // 获取显示名称的方法
    const getDisplayName = (connection) => {
      if (connection.description && connection.description.trim()) {
        return connection.description
      }
      return `${connection.username}@${connection.host}`
    }

    // 获取连接列表
    const connections = computed(() => {
      return userStore.isLoggedIn ? userStore.connections : localConnectionsStore.getAllConnections
    })

    // 获取收藏连接（智能按需加载）
    const favoriteConnections = computed(() => {
      const connections = userStore.isLoggedIn ? userStore.favoriteConnections : localConnectionsStore.getFavoriteConnections

      // 如果用户已登录且收藏数据为空且尚未加载，触发按需加载
      if (userStore.isLoggedIn && connections.length === 0 && !userStore.favoritesLoaded && !userStore.favoritesLoading) {
        log.debug('检测到需要收藏数据，触发按需加载')
        // 异步触发加载，不阻塞当前计算
        setTimeout(() => {
          userStore.loadFavoritesOnDemand().catch(error => {
            log.warn('按需加载收藏数据失败:', error)
          })
        }, 100)
      }

      return connections
    })

    // 获取历史记录（智能按需加载）
    const historyConnections = computed(() => {
      const connections = userStore.isLoggedIn ? userStore.historyConnections : localConnectionsStore.getHistory

      // 如果用户已登录且历史记录为空且尚未加载，触发按需加载
      if (userStore.isLoggedIn && connections.length === 0 && !userStore.historyLoaded && !userStore.historyLoading) {
        log.debug('检测到需要历史记录，触发按需加载')
        // 异步触发加载，不阻塞当前计算
        setTimeout(() => {
          userStore.loadHistoryOnDemand().catch(error => {
            log.warn('按需加载历史记录失败:', error)
          })
        }, 100)
      }

      return connections
    })

    // 搜索相关
    const searchQuery = ref('')

    // 编辑模式相关
    const isEditMode = ref(false)
    const dragIndex = ref('')
    const enterIndex = ref('')

    // 过滤后的连接列表
    const filteredConnections = computed(() => {
      if (!searchQuery.value || !searchQuery.value.trim()) {
        return connections.value
      }

      const query = searchQuery.value.toLowerCase().trim()
      return connections.value.filter(connection => {
        const displayName = getDisplayName(connection).toLowerCase()
        const host = connection.host.toLowerCase()
        const username = connection.username.toLowerCase()
        const description = (connection.description || '').toLowerCase()

        return displayName.includes(query) ||
               host.includes(query) ||
               username.includes(query) ||
               description.includes(query)
      })
    })

    // 过滤后的历史连接列表
    const filteredHistoryConnections = computed(() => {
      if (!searchQuery.value || !searchQuery.value.trim()) {
        return historyConnections.value
      }

      const query = searchQuery.value.toLowerCase().trim()
      return historyConnections.value.filter(connection => {
        const displayName = getDisplayName(connection).toLowerCase()
        const host = connection.host.toLowerCase()
        const username = connection.username.toLowerCase()
        const description = (connection.description || '').toLowerCase()

        return displayName.includes(query) ||
               host.includes(query) ||
               username.includes(query) ||
               description.includes(query)
      })
    })

    // 防抖函数用于优化API请求
    let reorderTimeout = null
    const debouncedReorderHistory = (newOrder) => {
      // 清除之前的定时器
      if (reorderTimeout) {
        clearTimeout(reorderTimeout)
      }

      // 设置新的定时器，延迟500ms后执行API请求
      reorderTimeout = setTimeout(() => {
        if (userStore.isLoggedIn) {
          userStore.reorderHistoryConnections(newOrder)
        } else {
          localConnectionsStore.reorderHistoryConnections(newOrder)
        }
        log.debug('防抖后同步历史连接排序到服务器')
      }, 500)
    }
    
    // 添加新连接
    const addConnection = (connection) => {
      if (userStore.isLoggedIn) {
        userStore.addConnection(connection)
      } else {
        localConnectionsStore.addConnection(connection)
      }
    }
    
    // 更新连接
    const updateConnection = (id, connection) => {
      if (userStore.isLoggedIn) {
        userStore.updateConnection(id, connection)
      } else {
        localConnectionsStore.updateConnection(id, connection)
      }
    }
    
    // 删除连接
    const deleteConnection = (id) => {
      if (userStore.isLoggedIn) {
        userStore.deleteConnection(id)
      } else {
        localConnectionsStore.deleteConnection(id)
      }
    }
    
    // 添加到收藏
    const addToFavorites = (id) => {
      if (userStore.isLoggedIn) {
        userStore.addToFavorites(id)
      } else {
        localConnectionsStore.addToFavorites(id)
      }
    }
    
    // 从收藏移除
    const removeFromFavorites = (id) => {
      if (userStore.isLoggedIn) {
        userStore.removeFromFavorites(id)
      } else {
        localConnectionsStore.removeFromFavorites(id)
      }
    }
    
    // 检查是否已收藏
    const isFavorite = (id) => {
      return userStore.isLoggedIn ? userStore.isFavorite(id) : localConnectionsStore.isFavorite(id)
    }
    
    // 检查是否已置顶
    const isPinned = (id) => {
      return userStore.isLoggedIn ? userStore.isPinned(id) : localConnectionsStore.isPinned(id)
    }
    
    // 搜索处理函数
    const handleSearch = (query) => {
      // 只在搜索查询发生实际变化时记录日志
      if (searchQuery.value !== query) {
        log.debug('连接配置搜索', { query, previousQuery: searchQuery.value })
        searchQuery.value = query
      }
    }

    // 编辑模式相关方法
    const toggleEditMode = () => {
      isEditMode.value = !isEditMode.value
      log.debug('切换编辑模式', { isEditMode: isEditMode.value })
    }

    // 简化的拖拽相关方法 - 基于参考代码重新实现
    const handleDragStart = (index) => {
      dragIndex.value = index
      log.debug('开始拖拽', { index })

      // 添加一个小延迟确保拖拽状态正确应用
      nextTick(() => {
        const draggedCard = document.querySelector('.connection-card.being-dragged')
        if (draggedCard) {
          draggedCard.style.transform = 'scale(1.02)'
        }
      })
    }

    const handleDragEnter = (e, index) => {
      e.preventDefault()
      if (dragIndex.value !== index && dragIndex.value !== '') {
        // 直接操作过滤后的历史连接数组，参考示例代码的简洁实现
        const currentList = [...filteredHistoryConnections.value]

        // 执行拖拽移动操作
        const moving = currentList[dragIndex.value]
        currentList.splice(dragIndex.value, 1)
        currentList.splice(index, 0, moving)

        // 更新拖拽索引到新位置
        dragIndex.value = index

        // 如果当前没有搜索过滤，直接更新原始数组
        if (!searchQuery.value || !searchQuery.value.trim()) {
          // 直接更新本地状态
          if (userStore.isLoggedIn) {
            userStore.updateHistoryOrder(currentList)
          } else {
            localConnectionsStore.updateHistoryOrder(currentList)
          }

          // 使用防抖函数延迟API请求
          nextTick(() => {
            debouncedReorderHistory(currentList)
          })
        } else {
          // 如果有搜索过滤，需要重新构建完整的历史数组
          const fullHistory = userStore.isLoggedIn ?
            [...userStore.historyConnections] :
            [...localConnectionsStore.getHistory]

          // 创建一个新的完整历史数组，保持过滤项的新顺序，未过滤项保持原位置
          const reorderedHistory = []
          const filteredItems = new Set(currentList.map(item => `${item.id}-${item.timestamp}`))

          // 先添加重新排序后的过滤项
          currentList.forEach(item => {
            reorderedHistory.push(item)
          })

          // 再添加未被过滤的项，保持它们的相对位置
          fullHistory.forEach(item => {
            const itemKey = `${item.id}-${item.timestamp}`
            if (!filteredItems.has(itemKey)) {
              reorderedHistory.push(item)
            }
          })

          // 更新本地状态
          if (userStore.isLoggedIn) {
            userStore.updateHistoryOrder(reorderedHistory)
          } else {
            localConnectionsStore.updateHistoryOrder(reorderedHistory)
          }

          // 使用防抖函数延迟API请求
          nextTick(() => {
            debouncedReorderHistory(reorderedHistory)
          })
        }

        log.debug('拖拽移动', {
          from: dragIndex.value,
          to: index,
          hasFilter: !!(searchQuery.value && searchQuery.value.trim())
        })
      }
    }

    const handleDragOver = (e) => {
      e.preventDefault()
    }

    const handleDragEnd = () => {
      // 清理状态
      const previousDragIndex = dragIndex.value
      dragIndex.value = ''
      enterIndex.value = ''

      // 确保所有卡片的样式都被重置
      nextTick(() => {
        const allCards = document.querySelectorAll('.connection-card')
        allCards.forEach(card => {
          card.style.transform = ''
        })
      })

      log.debug('拖拽结束', { previousDragIndex })
    }

    // 删除历史连接
    const handleDeleteHistory = async (connection, index) => {
      try {
        await ElMessageBox.confirm(
          `确定要删除连接 "${getDisplayName(connection)}" 的历史记录吗？`,
          '确认删除',
          {
            confirmButtonText: '确定',
            cancelButtonText: '取消',
            type: 'warning',
          }
        )

        if (userStore.isLoggedIn) {
          userStore.removeFromHistory(connection.id, connection.timestamp)
        } else {
          localConnectionsStore.removeFromHistory(connection.id, connection.timestamp)
        }

        ElMessage.success('历史记录已删除')
        log.debug('删除历史连接', { connection: getDisplayName(connection), index })
      } catch {
        // 用户取消删除
      }
    }
    
    // 新建连接弹窗相关
    const dialogVisible = ref(false)
    const isEdit = ref(false)
    const isFromHistory = ref(false) // 标识是否来自历史连接的编辑
    const connectionForm = ref({
      id: null,
      name: '',
      host: '',
      port: 22,
      username: '',
      authType: 'password',
      password: '',
      keyFile: '',
      favorite: false,
      description: '',
      rememberPassword: false
    })
    
    // 显示新建连接对话框
    const showNewConnectionDialog = () => {
      isEdit.value = false
      isFromHistory.value = false
      resetConnectionForm()
      dialogVisible.value = true
    }

    // 重置连接表单
    const resetConnectionForm = () => {
      connectionForm.value = {
        id: null,
        name: '',
        host: '',
        port: 22,
        username: '',
        authType: 'password',
        password: '',
        keyFile: '',
        favorite: false,
        description: '',
        rememberPassword: false
      }
      isFromHistory.value = false
      // 关闭对话框
      dialogVisible.value = false
    }
    
    // 验证表单数据
    const validateForm = () => {
      if (!connectionForm.value.host?.trim()) {
        ElMessage.error('请输入云服务器公网IP或域名')
        return false
      }
      
      if (!connectionForm.value.username?.trim()) {
        ElMessage.error('请输入用户名')
        return false
      }
      
      if (connectionForm.value.authType === 'password' && !connectionForm.value.password?.trim()) {
        ElMessage.error('请输入密码')
        return false
      }
      
      if (connectionForm.value.authType === 'key' && !connectionForm.value.keyFile?.trim()) {
        ElMessage.error('请选择密钥文件')
        return false
      }
      
      return true
    }
    
    // 检查连接是否已存在于我的连接配置中，返回连接对象或null
    const findExistingConnection = (connection) => {
      const myConnections = userStore.isLoggedIn ? userStore.connections : localConnectionsStore.getAllConnections
      return myConnections.find(conn =>
        conn.host === connection.host &&
        conn.port === connection.port &&
        conn.username === connection.username
      ) || null
    }



    // 保存连接
    const saveConnection = () => {
      if (!validateForm()) {
        return
      }

      if (isEdit.value) {
        // 检查是否是从历史连接编辑的，且在我的连接配置中不存在
        if (isFromHistory.value) {
          const existingConnection = findExistingConnection(connectionForm.value)

          if (!existingConnection) {
            // 如果连接不存在于我的连接配置中，则添加为新连接
            if (userStore.isLoggedIn) {
              const connectionId = userStore.addConnection(connectionForm.value)
              // 检查是否是更新了现有连接
              if (connectionId !== connectionForm.value.id) {
                ElMessage.success('连接已存在，已更新连接信息')
              } else {
                ElMessage.success('连接已保存到我的连接配置')
              }
            } else {
              const connectionId = localConnectionsStore.addConnection(connectionForm.value)
              // 检查是否是更新了现有连接
              if (connectionId !== connectionForm.value.id) {
                ElMessage.success('连接已存在，已更新连接信息')
              } else {
                ElMessage.success('连接已保存到我的连接配置')
              }
            }
          } else {
            // 更新已有连接，使用现有连接的ID
            const updatedConnection = { ...connectionForm.value, id: existingConnection.id }
            if (userStore.isLoggedIn) {
              userStore.updateConnection(existingConnection.id, updatedConnection)
            } else {
              localConnectionsStore.updateConnection(existingConnection.id, updatedConnection)
            }
            ElMessage.success('连接已更新')
          }
        } else {
          // 更新已有连接（来自我的连接配置的编辑）
          if (userStore.isLoggedIn) {
            userStore.updateConnection(connectionForm.value.id, connectionForm.value)
          } else {
            localConnectionsStore.updateConnection(connectionForm.value.id, connectionForm.value)
          }
          ElMessage.success('连接已更新')
        }
      } else {
        // 添加新连接到我的连接配置
        if (userStore.isLoggedIn) {
          userStore.addConnection(connectionForm.value)
        } else {
          localConnectionsStore.addConnection(connectionForm.value)
        }
        ElMessage.success('连接已保存')
      }

      dialogVisible.value = false
    }
    
    // 选择密钥文件
    const selectKeyFile = () => {
      // 创建一个隐藏的文件输入元素
      const fileInput = document.createElement('input')
      fileInput.type = 'file'
      fileInput.accept = '.pem,.ppk,.key'
      
      // 监听文件选择事件
      fileInput.onchange = (event) => {
        const file = event.target.files[0]
        if (file) {
          connectionForm.value.keyFile = file.path || file.name
        }
      }
      
      // 触发文件选择对话框
      fileInput.click()
    }
    
    // 保存并连接
    const saveAndConnect = () => {
      if (!validateForm()) {
        return
      }

      let connectionId;

      // 生成新的会话ID，确保每次都是新会话
      const sessionId = Date.now().toString();

      // 先保存连接 - 关键修复：始终使用用户当前输入的数据，而不是已有数据
      if (isEdit.value) {
        // 检查是否是从历史连接编辑的
        if (isFromHistory.value) {
          // 从历史连接编辑：检查是否已存在相同配置的连接
          const existingConnection = findExistingConnection(connectionForm.value)

          if (!existingConnection) {
            // 如果连接不存在于我的连接配置中，则添加为新连接
            // 使用用户当前输入的表单数据
            if (userStore.isLoggedIn) {
              connectionId = userStore.addConnection(connectionForm.value)
            } else {
              connectionId = localConnectionsStore.addConnection(connectionForm.value)
            }
          } else {
            // 如果连接已存在，更新该连接的信息为用户当前输入的数据
            // 这确保了用户的修改会被保存，而不是使用旧数据
            connectionId = existingConnection.id;
            if (userStore.isLoggedIn) {
              userStore.updateConnection(connectionId, connectionForm.value)
            } else {
              localConnectionsStore.updateConnection(connectionId, connectionForm.value)
            }
          }
        } else {
          // 来自我的连接配置的编辑：直接更新
          connectionId = connectionForm.value.id;
          if (userStore.isLoggedIn) {
            userStore.updateConnection(connectionId, connectionForm.value)
          } else {
            localConnectionsStore.updateConnection(connectionId, connectionForm.value)
          }
        }
      } else {
        // 添加新连接到我的连接配置
        if (userStore.isLoggedIn) {
          connectionId = userStore.addConnection(connectionForm.value)
        } else {
          connectionId = localConnectionsStore.addConnection(connectionForm.value)
        }
      }

      // 准备用于连接的数据 - 始终使用用户当前输入的表单数据
      const connectionDataForSession = {
        ...connectionForm.value,
        id: sessionId, // 会话使用独立的ID
        originalConnectionId: connectionId, // 保存原始连接ID以便需要时可以引用
        title: connectionForm.value.name || `${connectionForm.value.username}@${connectionForm.value.host}`,
      }

      // 添加到历史记录 - 使用用户输入的数据，但保留连接ID
      const historyData = {
        ...connectionForm.value,
        id: connectionId // 历史记录使用连接配置的ID
      }

      if (userStore.isLoggedIn) {
        userStore.addToHistory(historyData)
      } else {
        localConnectionsStore.addToHistory(historyData)
      }

      // 关闭对话框
      dialogVisible.value = false

      // 获取当前标签页索引
      const currentTabIndex = tabStore.activeTabIndex
      const currentTab = tabStore.tabs[currentTabIndex]

      // 更新当前标签为终端标签
      if (currentTab && (currentTab.type === 'newConnection' || currentTab.path.includes('/connections'))) {
        // 更新标签的路径、类型和数据
        tabStore.updateTab(currentTabIndex, {
          title: connectionDataForSession.title,
          type: 'terminal',
          path: `/terminal/${sessionId}`,
          data: { connectionId: sessionId }
        })

        // 在会话存储中注册会话，使用用户输入的连接数据
        sessionStore.registerSession(sessionId, connectionDataForSession)

        // 导航到终端页面，使用新的会话ID
        router.push(`/terminal/${sessionId}`)
      } else {
        // 如果当前标签不是新建连接标签，则创建新标签
        tabStore.addTerminal(sessionId)

        // 在会话存储中注册会话，使用用户输入的连接数据
        sessionStore.registerSession(sessionId, connectionDataForSession)

        // 导航到终端页面，使用新的会话ID
        router.push(`/terminal/${sessionId}`)
      }
    }
    
    // 处理登录
    const handleLogin = async (connection) => {
      try {
      // 检查是否记住密码
      if (!connection.rememberPassword || !connection.password) {
        // 如果没有记住密码，先弹出编辑框让用户输入密码
        isEdit.value = true
        isFromHistory.value = true // 标识这是来自历史连接的编辑

        // 创建一个新的对象来存储编辑的连接信息
        const editedConnection = { ...connection }

        // 确保保留认证方式
        editedConnection.authType = connection.authType || 'password'

        // 如果是密码认证但没记住密码，清空密码字段让用户重新输入
        if (editedConnection.authType === 'password') {
          editedConnection.password = ''
        }

        connectionForm.value = editedConnection
        dialogVisible.value = true
        return
      }

        // 生成新的会话ID，确保每次都是新会话
        const sessionId = Date.now().toString();

      // 添加到历史记录
      if (userStore.isLoggedIn) {
          await userStore.addToHistory(connection)
      } else {
        localConnectionsStore.addToHistory(connection)
      }

      // 获取当前标签页索引
      const currentTabIndex = tabStore.activeTabIndex
      const currentTab = tabStore.tabs[currentTabIndex]

      // 准备连接信息
      const connectionInfo = {
        ...connection,
        id: sessionId,
        originalConnectionId: connection.id,
        title: connection.name || `${connection.username}@${connection.host}`,
      }

      // 更新当前标签为终端标签
      if (currentTab && (currentTab.type === 'newConnection' || currentTab.path.includes('/connections'))) {
        // 保存原始标签数据用于回滚
        const originalTabData = {
          title: currentTab.title,
          type: currentTab.type,
          path: currentTab.path,
          data: currentTab.data
        }

        // 更新标签的路径、类型和数据
        tabStore.updateTab(currentTabIndex, {
          title: connectionInfo.title,
          type: 'terminal',
          path: `/terminal/${sessionId}`,
          data: {
            connectionId: sessionId,
            originalTabData: originalTabData // 保存原始数据用于回滚
          }
        })

        // 在会话存储中注册会话
        sessionStore.registerSession(sessionId, connectionInfo)

        // 导航到终端页面
        router.push(`/terminal/${sessionId}`)
      } else {
        // 创建新标签页，使用新的会话ID
        tabStore.addTerminal(sessionId)

        // 在会话存储中注册会话
        sessionStore.registerSession(sessionId, connectionInfo)

        // 导航到终端页面
        router.push(`/terminal/${sessionId}`)
      }
      } catch (error) {
        console.error('连接创建失败:', error)
        ElMessage.error('连接创建失败，请重试')

        // 如果连接失败，执行回滚操作
        if (sessionId) {
          // 调用页签回滚逻辑
          tabStore.connectionFailed(sessionId, error.message || '连接失败')

          // 清理会话存储
          if (sessionStore.removeSession) {
            sessionStore.removeSession(sessionId)
          }
        }
      }
    }
    
    // 处理置顶
    const handleTop = (connection) => {
      if (userStore.isLoggedIn) {
        userStore.togglePin(connection.id)
      } else {
        localConnectionsStore.togglePin(connection.id)
      }
      ElMessage.success(isPinned(connection.id) ? '已置顶' : '已取消置顶')
    }
    
    // 处理编辑
    const handleEdit = (connection) => {
      isEdit.value = true
      isFromHistory.value = false // 来自我的连接配置的编辑，不是历史连接

      // 创建一个新的对象来存储编辑的连接信息
      const editedConnection = { ...connection }

      // 确保保留认证方式
      editedConnection.authType = connection.authType || 'password'

      // 如果是密码认证但没记住密码，则不填充密码字段
      if (editedConnection.authType === 'password' && !connection.rememberPassword) {
        editedConnection.password = ''
      }

      connectionForm.value = editedConnection
      dialogVisible.value = true
    }
    
    // 处理删除
    const handleDelete = (connection) => {
      if (userStore.isLoggedIn) {
        userStore.deleteConnection(connection.id)
      } else {
        localConnectionsStore.deleteConnection(connection.id)
      }
      ElMessage.success('删除成功')
    }

    // 重试加载连接数据
    const retryLoadConnections = async () => {
      try {
        userStore.clearError('connections')
        await userStore.loadConnectionsOnDemand()
        log.debug('连接数据重试加载成功')
      } catch (error) {
        log.warn('连接数据重试加载失败', error)
      }
    }

    // 重试加载历史记录
    const retryLoadHistory = async () => {
      try {
        userStore.clearError('history')
        await userStore.loadHistoryOnDemand()
        log.debug('历史记录重试加载成功')
      } catch (error) {
        log.warn('历史记录重试加载失败', error)
      }
    }

    // 重试加载收藏数据
    const retryLoadFavorites = async () => {
      try {
        userStore.clearError('favorites')
        await userStore.loadFavoritesOnDemand()
        log.debug('收藏数据重试加载成功')
      } catch (error) {
        log.warn('收藏数据重试加载失败', error)
      }
    }

    // 组件挂载时按需加载连接数据
    onMounted(async () => {
      if (userStore.isLoggedIn) {
        try {
          await userStore.loadConnectionsOnDemand()
          log.debug('连接管理页面：连接数据按需加载完成')
        } catch (error) {
          log.warn('连接管理页面：按需加载连接数据失败', error)
        }
      }
    })

    return {
      connections,
      favoriteConnections,
      historyConnections,
      filteredConnections,
      filteredHistoryConnections,
      getDisplayName,
      addConnection,
      updateConnection,
      deleteConnection,
      addToFavorites,
      removeFromFavorites,
      isFavorite,
      isPinned,
      Search,
      dialogVisible,
      isEdit,
      connectionForm,
      showNewConnectionDialog,
      saveConnection,
      saveAndConnect,
      resetConnectionForm,
      selectKeyFile,
      searchQuery,
      handleSearch,
      handleLogin,
      handleTop,
      handleEdit,
      handleDelete,
      // 编辑模式相关
      isEditMode,
      dragIndex,
      enterIndex,
      toggleEditMode,
      handleDragStart,
      handleDragOver,
      handleDragEnter,
      handleDragEnd,
      handleDeleteHistory,
      // 按需加载状态
      connectionsLoading: computed(() => userStore.connectionsLoading),
      connectionsLoaded: computed(() => userStore.connectionsLoaded),
      connectionsError: computed(() => userStore.connectionsError),
      connectionsRetryCount: computed(() => userStore.connectionsRetryCount),
      historyLoading: computed(() => userStore.historyLoading),
      historyLoaded: computed(() => userStore.historyLoaded),
      historyError: computed(() => userStore.historyError),
      historyRetryCount: computed(() => userStore.historyRetryCount),
      favoritesLoading: computed(() => userStore.favoritesLoading),
      favoritesLoaded: computed(() => userStore.favoritesLoaded),
      favoritesError: computed(() => userStore.favoritesError),
      favoritesRetryCount: computed(() => userStore.favoritesRetryCount),
      // 重试方法
      retryLoadConnections,
      retryLoadHistory,
      retryLoadFavorites
    }
  }
}
</script>

<style scoped>
.new-connection-container {
  padding: 20px;
  height: 100%;
  overflow-y: auto;
  background-color: var(--color-bg-page);
  max-width: 850px;
  margin: 0 auto;
  font-weight: bold;
  color: var(--color-text-primary);
}

.connection-header {
  margin-bottom: 30px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.connection-header h1 {
  font-size: 20px;
  color: var(--color-text-primary);
  font-weight: bold;
}

.control-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.search-container {
  width: 280px;
}

.connection-content {
  display: flex;
  flex-direction: column;
}

.connection-section {
  margin-bottom: 30px;
}

h2 {
  font-size: 16px;
  margin-bottom: 15px;
  font-weight: bold;
  color: var(--color-text-primary);
}

.connection-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 15px;
}

.connection-card {
  padding: 15px;
  border-radius: 4px;
  background-color: var(--card-bg);
  color: var(--card-text);
  cursor: pointer;
  transition: background-color var(--theme-transition-duration) var(--theme-transition-timing);
  box-shadow: none !important;
  position: relative;
}

/* 保留悬浮时的背景色变化，移除浮动效果 */
.connection-card:hover {
  background-color: var(--card-hover-bg);
  transform: none !important;
  box-shadow: none !important;
  outline: none !important;
}

.card-content {
  padding: 0px !important;
  display: flex;
  align-items: center;
}

.connection-icon {
  margin-right: 15px;
  font-size: 20px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.server-icon {
  font-size: 20px;
}

.connection-details {
  flex-grow: 1;
}

.connection-name {
  margin-bottom: 4px;
  font-weight: bold;
  color: var(--color-text-primary);
}

.connection-address {
  color: var(--color-text-regular);
  font-weight: normal;
}

.connection-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.row-item {
  display: flex;
  align-items: center;
  padding: 12px 15px;
  background-color: var(--card-bg);
  color: var(--card-text);
  border-radius: 4px;
  position: relative;
  cursor: pointer;
}

.row-item:hover {
  background-color: var(--card-hover-bg);
  border-color: var(--color-border-default);
}

.row-item-left {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 25%;
}

.row-item-right {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 75%;
}

.icon-cell {
  display: flex;
  align-items: center;
}

.name-cell {
  font-weight: bold;
  color: var(--color-text-primary);
}

.address-cell {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  color: var(--color-text-regular);
  text-align: left;
  width: 15%;
  font-weight: normal;
}

.connection-address {
  color: var(--color-text-regular);
  font-weight: normal;
}

.actions-cell {
  margin-left: auto;
  display: flex;
  gap: 8px;
}

.action-btn {
  height: 24px;
  width: 24px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.action-btn svg,
.action-btn .el-icon {
  width: 16px;
  height: 16px;
  font-size: 16px;
}

.action-btn:hover svg path {
  fill: var(--color-primary);
}

.action-btn .pinned {
  color: var(--color-primary);
  font-weight: bold;
}

/* 模态框样式 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 9999;
}

.modal-container {
  width: 500px;
  background-color: var(--color-bg-page);
  border: 1px solid var(--color-border-default);
  border-radius: 4px;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
}

.modal-header {
  padding: 12px 15px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: var(--color-bg-muted);
}

.modal-header span {
  color: var(--color-text-primary);
  font-size: 16px;
  font-weight: bold;
}

.close-btn {
  cursor: pointer;
  font-size: 20px;
  color: var(--color-text-regular);
}

.modal-tab {
  display: flex;
  border-bottom: none;
  padding: 0 15px;
}

.tab-item {
  padding: 10px 15px;
  color: var(--color-primary);
  font-weight: bold;
  position: relative;
}

.tab-item.active::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0;
  width: 100%;
  height: 2px;
  background-color: var(--color-primary);
}

.modal-body {
  padding: 15px;
  background-color: var(--color-bg-page);
}

.form-row {
  margin-bottom: 16px;
  width: 100%;
}

.form-row-two-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 15px;
}

.form-item {
  width: 100%;
  padding: 0 20px;
}

.form-item label {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: normal;
  color: var(--color-text-primary);
}

.input-wrapper {
  width: 100%;
}

.form-item input {
  width: 100%;
  height: 36px;
  background-color: transparent;
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  color: var(--color-text-primary);
  padding: 0 10px;
  box-sizing: border-box;
  outline: none;
  font-weight: normal;
}

.form-item input:focus {
  border-color: var(--color-primary);
}

.form-item input::placeholder {
  color: var(--color-text-placeholder);
}

.auth-switcher {
  display: flex;
  border-radius: 6px;
  overflow: hidden;
  background-color: var(--color-bg-muted);
  border: 1px solid var(--color-border-default);
  width: 48%;  /* 调整为一半宽度 */
}

.auth-switcher button {
  flex: 1;
  background-color: transparent;
  border: none;
  padding: 8px 10px;
  color: var(--color-text-regular);
  cursor: pointer;
  outline: none;
  font-weight: normal;
  transition: background-color 0.3s;
}

.auth-switcher button.active {
  background-color: var(--btn-primary-bg);
  color: var(--btn-primary-text);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 15px;
  background-color: var(--color-bg-muted);
}

.btn-cancel {
  padding: 8px 20px;
  background-color: var(--color-bg-muted);
  border: 1px solid var(--color-border-default);
  border-radius: 4px;
  color: var(--color-text-primary);
  cursor: pointer;
  font-weight: bold;
}

.btn-confirm {
  padding: 8px 20px;
  background-color: var(--btn-primary-bg);
  border: none;
  border-radius: 4px;
  color: var(--btn-primary-text);
  cursor: pointer;
  font-weight: bold;
}

/* 动画相关样式 */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.4s ease;
}

.modal-fade-enter-active .modal-container {
  animation: slideDown 0.4s ease;
}

.modal-fade-leave-active .modal-container {
  animation: slideUp 0.4s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

@keyframes slideDown {
  from {
    transform: translateY(-50px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

@keyframes slideUp {
  from {
    transform: translateY(0);
    opacity: 1;
  }
  to {
    transform: translateY(-50px);
    opacity: 0;
  }
}

/* 新的表单样式 */
.connection-form {
  width: 100%;
}

/* 添加自定义模态框样式 */
:deep(.connection-modal) {
  border-radius: 8px;
}

:deep(.connection-modal .modal-header) {
  border-bottom: none;
}

:deep(.connection-modal .modal-tab) {
  padding: 0 15px;
  margin-bottom: 10px;
  border-bottom: 1px solid var(--color-border-default);
}

:deep(.connection-modal .tab-item) {
  color: var(--color-text-primary);
  padding-left: 0;
  padding-right: 0;
  display: inline-block;
  width: auto;
  font-size: 12px;
}

/* 默认显示分界线，不需要active状态 */
:deep(.connection-modal .tab-item::after) {
  content: '';
  position: absolute;
  bottom: -2px;
  left: 0;
  width: 100%;
  height: 2px;
  background-color: var(--color-primary);
}

:deep(.connection-modal .modal-footer) {
  border-top: none;
}

:deep(.connection-modal .btn-confirm) {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background-color: var(--color-bg-muted);
  border: 1px solid var(--color-border-default);
  width: 80px;
  height: 36px;
  font-weight: bold;
  font-size: 14px;
  color: var(--color-text-primary);
}

:deep(.connection-modal .btn-cancel) {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background-color: var(--color-bg-muted);
  border: 1px solid var(--color-border-default);
  width: 80px;
  height: 36px;
  font-weight: bold;
  font-size: 14px;
  color: var(--color-text-primary);
}

:deep(.connection-modal .btn-primary) {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background-color: var(--btn-primary-bg);
  height: 36px;
  font-weight: bold;
  font-size: 14px;
  color: var(--btn-primary-text);
}

:deep(.connection-modal .btn-primary:hover) {
  background-color: var(--btn-primary-hover-bg);
}

.key-file-wrapper {
  display: flex;
  align-items: center;
  position: relative;
  gap: 0;
}

.key-file-wrapper input {
  border-radius: 6px 0 0 6px;
  border-right: none;
  width: calc(100% - 75px);
  z-index: 1;
  cursor: pointer;
}

.key-file-wrapper input:focus {
  border-color: var(--color-primary);
  box-shadow: none;
}

.key-file-wrapper input:focus + .select-file-btn {
  border-color: var(--color-primary);
  background-color: var(--color-bg-muted);
}

.select-file-btn {
  height: 36px;
  min-width: 75px;
  background-color: var(--color-bg-muted);
  border: 1px solid var(--color-border-default);
  border-left: none;
  color: var(--color-text-primary);
  padding: 0;
  border-radius: 0 6px 6px 0;
  cursor: pointer;
  white-space: nowrap;
  font-size: 13px;
  transition: background-color 0.3s, border-color 0.3s;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 0;
}

.select-file-btn:hover {
  background-color: var(--color-hover-bg);
}

.remember-password {
  display: flex;
  align-items: center;
  margin-top: 10px;
  cursor: pointer;
}

.remember-password span {
  font-size: 12px;
  color: var(--color-text-primary);
  font-weight: normal;
}

/* 复选框样式已移至 components/forms.css 统一管理 */

/* 添加置顶项的样式 */
.row-item[data-pinned="true"] {
  background-color: var(--color-primary-lightest);
  border-color: var(--color-primary-light);
}

.row-item[data-pinned="true"]:hover {
  background-color: var(--color-primary-light);
}

.action-btn .pinned {
  color: var(--color-primary);
  font-weight: bold;
}

/* 编辑模式相关样式 */
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
}

.edit-btn {
  background: none;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: 6px;
  border-radius: 4px;
  transition: all var(--theme-transition-duration) var(--theme-transition-timing);
  display: flex;
  align-items: center;
  justify-content: center;
}

.edit-btn:hover {
  color: var(--color-text-primary);
  background-color: var(--color-hover-bg);
}

.edit-btn.active {
  color: var(--color-primary);
  background-color: var(--color-primary-lightest);
}

/* 删除按钮样式 */
.delete-btn {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 16px;
  height: 16px;
  background-color: transparent;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--theme-transition-duration) var(--theme-transition-timing);
  z-index: 10;
  border: 1.5px solid var(--color-text-secondary);
}

.delete-btn:hover {
  border-color: var(--color-danger);
}

.delete-btn svg {
  color: var(--color-text-secondary);
  width: 8px;
  height: 8px;
}

.delete-btn:hover svg {
  color: var(--color-danger);
}

/* 优化的拖拽样式 - 基于参考代码简化 */
.connection-grid {
  list-style: none;
}

/* Vue transition-group 拖拽移动动画 - 参考示例代码 */
.drag-move {
  transition: transform 0.3s ease;
}

/* Vue transition-group 进入和离开动画 */
.drag-enter-active, .drag-leave-active {
  transition: all 0.3s ease;
}

.drag-enter-from, .drag-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

.connection-card {
  cursor: pointer;
  transition: all var(--theme-transition-duration) var(--theme-transition-timing);
  position: relative;
  background-color: var(--card-bg);
  color: var(--card-text);
}

.connection-card:hover {
  background-color: var(--card-hover-bg);
}

/* 编辑模式下的拖拽样式 */
.connection-grid.edit-mode .connection-card {
  cursor: move;
  transition:
    transform var(--theme-transition-duration) var(--theme-transition-timing),
    box-shadow var(--theme-transition-duration) var(--theme-transition-timing),
    background-color var(--theme-transition-duration) var(--theme-transition-timing);
}

.connection-grid.edit-mode .connection-card:hover:not(.being-dragged) {
  background-color: var(--card-hover-bg);
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

/* 正在被拖拽的卡片样式 */
.connection-card.being-dragged {
  opacity: 0.8;
  transform: scale(1.02) !important;
  box-shadow: var(--shadow-lg) !important;
  z-index: 1000;
  background-color: var(--color-primary-lightest) !important;
  transition: none !important;
}

/* 确保非拖拽状态下的卡片保持正常 */
.connection-card:not(.being-dragged) {
  transform: none;
}

/* 风铃摆动效果 - 连续流畅摆动，不在0度停留 */
@keyframes windChimeSwing {
  0% {
    transform: rotate(0deg);
  }
  12.5% {
    transform: rotate(0.3deg);
  }
  25% {
    transform: rotate(0.3deg);
  }
  37.5% {
    transform: rotate(0.3deg);
  }
  50% {
    transform: rotate(0deg);
  }
  62.5% {
    transform: rotate(-0.3deg);
  }
  75% {
    transform: rotate(-0.5deg);
  }
  87.5% {
    transform: rotate(-0.3deg);
  }
  100% {
    transform: rotate(0deg);
  }
}

/* 测试动画 - 更明显的效果 */
@keyframes testSwing {
  0% {
    transform: rotate(0deg) scale(1);
  }
  25% {
    transform: rotate(10deg) scale(1.05);
  }
  50% {
    transform: rotate(0deg) scale(1);
  }
  75% {
    transform: rotate(-10deg) scale(1.05);
  }
  100% {
    transform: rotate(0deg) scale(1);
  }
}

/* 为不同的卡片添加不同的延迟，创造更自然的摆动效果 */
.connection-card.swinging {
  animation: windChimeSwing 0.3s linear infinite !important;
  transform-origin: top center !important;
}

.connection-card.swinging:nth-child(2n) {
  animation-delay: 0.02s !important;
  animation-duration: 0.35s !important;
}

.connection-card.swinging:nth-child(3n) {
  animation-delay: 0.04s !important;
  animation-duration: 0.25s !important;
}

.connection-card.swinging:nth-child(4n) {
  animation-delay: 0.06s !important;
  animation-duration: 0.4s !important;
}

.connection-card.swinging:nth-child(5n) {
  animation-delay: 0.08s !important;
  animation-duration: 0.2s !important;
}

.connection-card.swinging:nth-child(6n) {
  animation-delay: 0.1s !important;
  animation-duration: 0.45s !important;
}

/* 当卡片被拖拽时，暂停摆动动画并应用拖拽样式 */
.connection-card.swinging.being-dragged {
  animation: none !important;
  transform: scale(1.02) !important;
}

/* 加载指示器样式 */
.loading-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: var(--color-text-secondary);
  font-size: 14px;
  gap: 12px;
}

.loading-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--color-border-lighter);
  border-top: 2px solid var(--color-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

/* 错误指示器样式 */
.error-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: var(--color-danger);
  font-size: 14px;
  gap: 12px;
}

.error-icon {
  font-size: 20px;
}

.error-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.error-message {
  color: var(--color-danger);
}

.retry-btn {
  padding: 6px 12px;
  background-color: var(--color-primary);
  border: none;
  border-radius: 4px;
  color: var(--color-text-white);
  cursor: pointer;
  font-size: 12px;
  transition: background-color var(--theme-transition-duration) var(--theme-transition-timing);
}

.retry-btn:hover {
  background-color: var(--color-primary-hover);
}

.retry-info {
  color: var(--color-text-secondary);
  font-size: 12px;
  margin-left: 8px;
}
</style> 