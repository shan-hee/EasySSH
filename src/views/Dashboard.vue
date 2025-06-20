<template>
  <div class="dashboard-container">
    <div class="dashboard-header">
      <h1 class="dashboard-title">控制面板</h1>
      <div class="dashboard-actions">
        <span class="last-update">
          最后更新: {{ lastUpdateTime || '未更新' }}
        </span>
      </div>
    </div>
    <div class="row" style="display: flex; gap: 20px; margin-bottom: 20px;">
      <div class="dashboard-card" style="flex: 1;">
        <div class="card-header">
          <span>连接状态</span>
          <button class="btn btn-text" @click="handleViewAllConnections">查看全部</button>
        </div>
        <div class="card-content">
          <div class="status-item">
            <div class="status-label">活跃连接</div>
            <div class="status-value">{{ connectionStats.activeConnections }}</div>
          </div>
          <div class="status-item">
            <div class="status-label">总连接数</div>
            <div class="status-value">{{ connectionStats.totalConnections }}</div>
          </div>
          <div class="status-item">
            <div class="status-label">最近活动</div>
            <div class="status-value">{{ connectionStats.lastActivity }}</div>
          </div>
        </div>
      </div>
      
      <div class="dashboard-card" style="flex: 1;">
        <div class="card-header">
          <span>快速操作</span>
        </div>
        <div class="card-content">
          <button class="btn btn-primary quick-action-btn" @click="handleNewConnection">
            <img src="@/assets/icons/icon-add-connection.svg" width="24" height="24" class="icon" /> 新建连接
          </button>
          <button
            class="btn btn-default quick-action-btn"
            @click="refreshDashboardData"
            :disabled="isLoading"
          >
            <img src="@/assets/icons/icon-refresh.svg" width="24" height="24" class="icon" />
            <span v-if="isLoading">刷新中...</span>
            <span v-else>刷新状态</span>
          </button>
          <button class="btn btn-default quick-action-btn" @click="handleSettings">
            <img src="@/assets/icons/icon-settings.svg" width="24" height="24" class="icon" /> 设置
          </button>
        </div>
      </div>
      
      <div class="dashboard-card" style="flex: 1;">
        <div class="card-header">
          <span>系统信息</span>
        </div>
        <div class="card-content">
          <div class="status-item">
            <div class="status-label">版本</div>
            <div class="status-value">{{ appVersion }}</div>
          </div>
          <div class="status-item">
            <div class="status-label">最后更新</div>
            <div class="status-value">2023-12-01</div>
          </div>
          <div class="status-item">
            <div class="status-label">运行状态</div>
            <div class="status-value">
              <span class="tag tag-success">正常</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <div class="row" style="display: flex; gap: 20px;">
      <div class="dashboard-card" style="flex: 2;">
        <div class="card-header">
          <span>最近连接</span>
          <button class="btn btn-text" @click="handleViewAllRecentConnections">查看全部</button>
        </div>
        <div class="recent-connections">
          <table class="connection-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>主机</th>
                <th>最后连接时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(conn, index) in recentConnections" :key="index">
                <td>{{ conn.name }}</td>
                <td>{{ conn.host }}</td>
                <td>{{ conn.lastConnected }}</td>
                <td>
                  <button class="btn btn-text" @click="handleConnectToServer(conn)">连接</button>
                  <button class="btn btn-text" @click="handleEditConnection(conn)">编辑</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      
      <div class="dashboard-card" style="flex: 1;">
        <div class="card-header">
          <span>活动日志</span>
          <button class="btn btn-text" @click="handleClearActivityLog">清除</button>
        </div>
        <div class="activity-log">
          <div class="timeline">
            <div class="timeline-item" v-for="(activity, index) in activityLog" :key="index">
              <div class="timeline-marker"></div>
              <div class="timeline-content">
                <p>{{ activity.content }}</p>
                <span class="timeline-time">{{ activity.time }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/store/user'
import log from '@/services/log'

export default {
  name: 'Dashboard',
  setup() {
    const router = useRouter()
    const userStore = useUserStore()

    // 获取应用版本号
    const appVersion = computed(() => {
      return import.meta.env.VITE_APP_VERSION || '1.0.0'
    })

    // 响应式数据状态
    const isLoading = ref(false)
    const lastUpdateTime = ref(null)

    // 计算实际的连接统计数据
    const connectionStats = computed(() => {
      const connections = userStore.connections || []
      const history = userStore.history || []

      // 获取最近24小时的活动
      const now = new Date()
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      const recentActivity = history.filter(item => {
        const itemDate = new Date(item.connectedAt || item.timestamp)
        return itemDate > yesterday
      })

      return {
        totalConnections: connections.length,
        activeConnections: recentActivity.length,
        lastActivity: history.length > 0 ?
          new Date(history[0].connectedAt || history[0].timestamp).toLocaleString('zh-CN') :
          '暂无记录'
      }
    })

    // 获取最近连接数据
    const recentConnections = computed(() => {
      const connections = userStore.connections || []
      const history = userStore.history || []

      // 合并连接信息和历史记录
      return history.slice(0, 3).map(historyItem => {
        const connection = connections.find(conn => conn.id === historyItem.connectionId)
        return {
          id: connection?.id || historyItem.connectionId,
          name: connection?.name || historyItem.name || '未知连接',
          host: connection?.host || historyItem.host || '未知主机',
          lastConnected: new Date(historyItem.connectedAt || historyItem.timestamp).toLocaleString('zh-CN')
        }
      })
    })

    // 刷新Dashboard数据
    const refreshDashboardData = async () => {
      try {
        isLoading.value = true
        log.debug('开始刷新Dashboard数据')

        // 强制刷新连接数据
        await userStore.loadConnectionsFromServer(true)

        lastUpdateTime.value = new Date().toLocaleString('zh-CN')
        log.info('Dashboard数据刷新完成')
      } catch (error) {
        log.error('刷新Dashboard数据失败', error)
      } finally {
        isLoading.value = false
      }
    }

    // 按钮处理方法
    const handleNewConnection = () => {
      log.info('跳转到新建连接页面')
      router.push('/connections/new')
    }

    const handleSettings = () => {
      log.info('跳转到设置页面')
      router.push('/settings')
    }

    const handleViewAllConnections = () => {
      log.info('查看所有连接状态')
      // 可以跳转到连接管理页面或显示详细连接列表
      router.push('/connections')
    }

    const handleViewAllRecentConnections = () => {
      log.info('查看所有最近连接')
      // 可以跳转到连接历史页面
      router.push('/connections')
    }

    const handleConnectToServer = (connection) => {
      log.info('跳转到连接配置界面', { name: connection.name, host: connection.host })
      // 跳转到连接配置界面
      router.push('/connections/new')
    }

    const handleEditConnection = (connection) => {
      log.info('跳转到连接配置界面', { name: connection.name })
      // 跳转到连接配置界面
      router.push('/connections/new')
    }

    const handleClearActivityLog = () => {
      log.info('清除活动日志')
      // 清除用户Store中的历史记录
      if (userStore.clearHistory) {
        userStore.clearHistory()
        log.info('活动日志已清除')
      } else {
        log.warn('清除历史记录功能未实现')
      }
    }

    // 生成活动日志
    const activityLog = computed(() => {
      const history = userStore.history || []
      const connections = userStore.connections || []

      return history.slice(0, 4).map(item => {
        const connection = connections.find(conn => conn.id === item.connectionId)
        const timeAgo = getTimeAgo(new Date(item.connectedAt || item.timestamp))

        return {
          content: `连接到服务器 ${connection?.name || item.name || '未知服务器'}`,
          time: timeAgo,
          type: 'primary'
        }
      })
    })

    // 计算时间差的辅助函数
    const getTimeAgo = (date) => {
      const now = new Date()
      const diff = now - date
      const minutes = Math.floor(diff / (1000 * 60))
      const hours = Math.floor(diff / (1000 * 60 * 60))
      const days = Math.floor(diff / (1000 * 60 * 60 * 24))

      if (minutes < 60) {
        return `${minutes}分钟前`
      } else if (hours < 24) {
        return `${hours}小时前`
      } else {
        return `${days}天前`
      }
    }

    // 组件挂载时刷新数据
    onMounted(() => {
      log.debug('Dashboard组件已挂载，开始初始化数据')

      // 设置初始更新时间
      lastUpdateTime.value = new Date().toLocaleString('zh-CN')

      // 如果用户已登录但数据为空，则刷新数据
      if (userStore.isLoggedIn && userStore.connections.length === 0) {
        refreshDashboardData()
      }

      // 监听数据刷新事件
      window.addEventListener('dashboard:refresh', refreshDashboardData)
    })

    // 组件卸载时清理事件监听器
    onUnmounted(() => {
      window.removeEventListener('dashboard:refresh', refreshDashboardData)
    })

    return {
      appVersion,
      recentConnections,
      activityLog,
      connectionStats,
      isLoading,
      lastUpdateTime,
      refreshDashboardData,
      handleNewConnection,
      handleSettings,
      handleViewAllConnections,
      handleViewAllRecentConnections,
      handleConnectToServer,
      handleEditConnection,
      handleClearActivityLog
    }
  }
}
</script>

<style>
.dashboard-container {
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;
  color: #e0e0e0;
}

.dashboard-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.dashboard-title {
  color: #a0a0a0;
  margin: 0;
}

.dashboard-actions {
  display: flex;
  align-items: center;
  gap: 15px;
}

.last-update {
  font-size: 12px;
  color: #999;
}

.dashboard-card {
  background-color: #252526;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
  margin-bottom: 20px;
  overflow: hidden;
  border: 1px solid #333;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px;
  border-bottom: 1px solid #333;
  font-weight: bold;
  background-color: #2d2d2d;
}

.card-content {
  padding: 15px;
}

.status-item {
  display: flex;
  justify-content: space-between;
  margin-bottom: 15px;
}

.status-label {
  color: #a0a0a0;
  font-size: 14px;
}

.status-value {
  font-weight: 500;
  font-size: 14px;
}

.quick-action-btn {
  display: block;
  width: 100%;
  margin-bottom: 10px;
  text-align: left;
}

.btn-text {
  border: none;
  background: none;
  color: #1890ff;
  cursor: pointer;
  padding: 0;
}

.btn-text:hover {
  color: #40a9ff;
  text-decoration: underline;
}

.tag {
  display: inline-block;
  padding: 2px 8px;
  font-size: 12px;
  border-radius: 4px;
}

.tag-success {
  background-color: #162312;
  border: 1px solid #274916;
  color: #52c41a;
}

.connection-table {
  width: 100%;
  border-collapse: collapse;
}

.connection-table th, 
.connection-table td {
  text-align: left;
  padding: 12px 8px;
  border-bottom: 1px solid #333;
}

.connection-table th {
  font-weight: 500;
  color: #a0a0a0;
}

.activity-log {
  height: 300px;
  overflow: hidden;
  padding: 0 15px;
}

.timeline {
  position: relative;
  padding-left: 20px;
}

.timeline::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background-color: #444;
}

.timeline-item {
  position: relative;
  margin-bottom: 20px;
}

.timeline-marker {
  position: absolute;
  left: -24px;
  top: 4px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #1890ff;
}

.timeline-content {
  padding-bottom: 10px;
}

.timeline-content p {
  margin: 0 0 4px 0;
}

.timeline-time {
  font-size: 12px;
  color: #a0a0a0;
}

.btn {
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.3s ease;
}

.btn-default {
  background-color: #333;
  color: #e0e0e0;
  border: 1px solid #444;
}

.btn-default:hover:not(:disabled) {
  color: #1890ff;
  border-color: #1890ff;
  background-color: #111;
}

.btn-default:disabled {
  background-color: #222;
  color: #666;
  border-color: #333;
  cursor: not-allowed;
  opacity: 0.6;
}

.btn-primary {
  background-color: #1890ff;
  color: white;
  border: none;
}



.icon {
  margin-right: 5px;
}
</style> 