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
        v-for="category in categories" 
        :key="category.id"
        class="category-bubble"
        :class="{ active: selectedCategory === category.id }"
        @click="selectedCategory = category.id"
      >
        <h3>{{ category.name }}</h3>
        <span class="script-count">{{ category.count }} 个脚本</span>
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

      <div class="scripts-list">
        <div v-if="filteredScripts.length === 0" class="no-scripts">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48">
            <path fill="#666" d="M19,3H5C3.89,3 3,3.89 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5C21,3.89 20.1,3 19,3M19,5V19H5V5H19Z" />
            <path fill="#666" d="M11,7H13V9H11V7M11,11H13V17H11V11Z" />
          </svg>
          <p>{{ noScriptsMessage }}</p>
          <button class="btn-secondary" @click="createNewScript">创建第一个脚本</button>
        </div>

        <div 
          v-for="script in filteredScripts" 
          :key="script.id"
          class="script-card"
        >
          <div class="script-header">
            <h3>{{ script.name }}</h3>
            <div class="script-actions">
              <button class="btn-icon" @click="toggleFavorite(script)">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">
                  <path fill="currentColor" :d="script.isFavorite ? 'M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z' : 'M12,15.39L8.24,17.66L9.23,13.38L5.91,10.5L10.29,10.13L12,6.09L13.71,10.13L18.09,10.5L14.77,13.38L15.76,17.66M22,9.24L14.81,8.63L12,2L9.19,8.63L2,9.24L7.45,13.97L5.82,21L12,17.27L18.18,21L16.54,13.97L22,9.24Z'" />
                </svg>
              </button>
              <button class="btn-icon" @click="editScript(script)">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">
                  <path fill="currentColor" d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z" />
                </svg>
              </button>
              <button class="btn-icon" @click="runScript(script)">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">
                  <path fill="currentColor" d="M8,5.14V19.14L19,12.14L8,5.14Z" />
                </svg>
              </button>
            </div>
          </div>
          <div class="script-info">
            <p class="script-description">{{ script.description }}</p>
            <div class="script-meta">
              <span class="script-author">作者: {{ script.author }}</span>
              <span class="script-updated">更新于: {{ formatDate(script.updatedAt) }}</span>
            </div>
            <div class="script-tags">
              <span 
                v-for="tag in script.tags" 
                :key="tag"
                class="tag"
              >
                {{ tag }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { defineComponent, ref, computed } from 'vue'

export default defineComponent({
  name: 'ScriptLibrary',
  setup() {
    const selectedCategory = ref('all')
    const searchQuery = ref('')
    const showFilterOptions = ref(false)
    const filterMyScripts = ref(false)
    const filterRecentScripts = ref(false)
    const filterFavoriteScripts = ref(false)

    // 示例数据
    const categories = ref([
      { id: 'all', name: '全部', count: 12, icon: 'M3,6H21V8H3V6M3,11H21V13H3V11M3,16H21V18H3V16Z' },
      { id: 'system', name: '系统管理', count: 5, icon: 'M15,5H17V3H15M15,21H17V19H15M11,5H13V3H11M11,21H13V19H11M7,5H9V3H7M7,21H9V19H7M3,5H5V3H3M3,21H5V19H3M8,17H16V15H8M8,13H16V11H8M8,9H16V7H8' },
      { id: 'network', name: '网络工具', count: 3, icon: 'M17,22V20H20V17H22V20.5C22,20.89 21.84,21.24 21.54,21.54C21.24,21.84 20.89,22 20.5,22H17M7,22H3.5C3.11,22 2.76,21.84 2.46,21.54C2.16,21.24 2,20.89 2,20.5V17H4V20H7V22M17,2H20.5C20.89,2 21.24,2.16 21.54,2.46C21.84,2.76 22,3.11 22,3.5V7H20V4H17V2M7,2V4H4V7H2V3.5C2,3.11 2.16,2.76 2.46,2.46C2.76,2.16 3.11,2 3.5,2H7M13,17.25C13,17.38 12.97,17.5 12.91,17.59C12.85,17.68 12.76,17.75 12.65,17.79C12.55,17.83 12.44,17.83 12.34,17.8C12.24,17.77 12.15,17.7 12.09,17.61L7.62,11.42C7.5,11.26 7.5,11.04 7.62,10.88L12.09,4.7C12.15,4.61 12.24,4.54 12.34,4.5C12.44,4.47 12.55,4.47 12.65,4.52C12.76,4.56 12.85,4.63 12.91,4.72C12.97,4.81 13,4.93 13,5.06V17.25Z' },
      { id: 'backup', name: '备份恢复', count: 2, icon: 'M12,3A9,9 0 0,0 3,12H0L4,16L8,12H5A7,7 0 0,1 12,5A7,7 0 0,1 19,12A7,7 0 0,1 12,19C10.5,19 9.09,18.5 7.94,17.7L6.5,19.14C8.04,20.3 9.94,21 12,21A9,9 0 0,0 21,12A9,9 0 0,0 12,3M14,12A2,2 0 0,0 12,10A2,2 0 0,0 10,12A2,2 0 0,0 12,14A2,2 0 0,0 14,12Z' },
      { id: 'deploy', name: '部署工具', count: 2, icon: 'M3,3H11V7.34L16.66,1.69L22.31,7.34L16.66,13H21V21H13V13H16.66L11,7.34V13H3V3M3,5V11H9V5H3Z' }
    ])

    const scripts = ref([
      {
        id: 1,
        name: '系统信息收集脚本',
        description: '收集服务器系统信息，包括CPU、内存、磁盘使用情况等。',
        author: '管理员',
        category: 'system',
        updatedAt: new Date('2023-12-01'),
        isFavorite: true,
        tags: ['系统', '监控', '信息收集']
      },
      {
        id: 2,
        name: '网络连接检测',
        description: '检测服务器与指定目标的网络连接状态。',
        author: '网络管理员',
        category: 'network',
        updatedAt: new Date('2023-11-15'),
        isFavorite: false,
        tags: ['网络', '诊断', '连接测试']
      },
      {
        id: 3,
        name: '数据库备份脚本',
        description: '自动备份MySQL/PostgreSQL数据库并上传到指定位置。',
        author: '数据库管理员',
        category: 'backup',
        updatedAt: new Date('2023-10-28'),
        isFavorite: true,
        tags: ['数据库', '备份', 'MySQL', 'PostgreSQL']
      }
    ])

    // 根据筛选条件过滤脚本
    const filteredScripts = computed(() => {
      let result = scripts.value;
      
      // 根据分类筛选
      if (selectedCategory.value !== 'all') {
        result = result.filter(script => script.category === selectedCategory.value);
      }
      
      // 根据搜索词筛选
      if (searchQuery.value) {
        const query = searchQuery.value.toLowerCase();
        result = result.filter(script => 
          script.name.toLowerCase().includes(query) || 
          script.description.toLowerCase().includes(query) ||
          script.tags.some(tag => tag.toLowerCase().includes(query))
        );
      }
      
      // 根据其他筛选条件
      if (filterMyScripts.value) {
        // 假设当前用户是"管理员"
        result = result.filter(script => script.author === '管理员');
      }
      
      if (filterFavoriteScripts.value) {
        result = result.filter(script => script.isFavorite);
      }
      
      if (filterRecentScripts.value) {
        // 获取最近7天的脚本
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        result = result.filter(script => script.updatedAt >= sevenDaysAgo);
      }
      
      return result;
    });

    // 无脚本时显示的消息
    const noScriptsMessage = computed(() => {
      if (searchQuery.value) {
        return '没有找到匹配的脚本';
      } else if (selectedCategory.value !== 'all') {
        return `${categories.value.find(c => c.id === selectedCategory.value)?.name || ''} 分类下暂无脚本`;
      } else if (filterMyScripts.value) {
        return '您还没有创建任何脚本';
      } else if (filterFavoriteScripts.value) {
        return '您还没有收藏任何脚本';
      } else {
        return '脚本库为空，创建第一个脚本吧';
      }
    });

    // 格式化日期
    const formatDate = (date) => {
      return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
    };

    // 操作方法
    const createNewScript = () => {
      console.log('创建新脚本');
      // 实现创建脚本的逻辑
    };

    const editScript = (script) => {
      console.log('编辑脚本', script.id);
      // 实现编辑脚本的逻辑
    };

    const runScript = (script) => {
      console.log('运行脚本', script.id);
      // 实现运行脚本的逻辑
    };

    const toggleFavorite = (script) => {
      script.isFavorite = !script.isFavorite;
    };

    return {
      selectedCategory,
      searchQuery,
      categories,
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
      toggleFavorite
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
  gap: 16px;
  margin-bottom: 24px;
  overflow-x: auto;
  padding-bottom: 8px;
}

.category-bubble {
  background-color: #252525;
  border-radius: 20px;
  padding: 8px 16px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  border: 1px solid #333;
}

.category-bubble.active {
  background-color: #2c7be5;
  border-color: #2c7be5;
}

.category-bubble h3 {
  margin: 0 0 4px 0;
  font-size: 14px;
  font-weight: 500;
}

.script-count {
  font-size: 12px;
  color: #888;
}

.active .script-count,
.active .category-bubble h3 {
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

.scripts-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.script-card {
  background-color: #2a2a2a;
  border-radius: 6px;
  padding: 16px;
  border: 1px solid #383838;
}

.script-card:hover {
  border-color: #444;
}

.script-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.script-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 500;
}

.script-actions {
  display: flex;
  gap: 8px;
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

.script-description {
  margin: 0 0 12px 0;
  font-size: 14px;
  color: #b0b0b0;
  line-height: 1.5;
}

.script-meta {
  display: flex;
  justify-content: space-between;
  margin-bottom: 12px;
  font-size: 12px;
  color: #888;
}

.script-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag {
  background-color: #333;
  color: #a0a0a0;
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 12px;
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
</style> 