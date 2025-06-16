<template>
  <div class="dashboard-container">
    <h1 class="dashboard-title">控制面板</h1>
    <div class="row" style="display: flex; gap: 20px; margin-bottom: 20px;">
      <div class="dashboard-card" style="flex: 1;">
        <div class="card-header">
          <span>连接状态</span>
          <button class="btn btn-text">查看全部</button>
        </div>
        <div class="card-content">
          <div class="status-item">
            <div class="status-label">活跃连接</div>
            <div class="status-value">3</div>
          </div>
          <div class="status-item">
            <div class="status-label">总连接数</div>
            <div class="status-value">12</div>
          </div>
          <div class="status-item">
            <div class="status-label">最近活动</div>
            <div class="status-value">今天 12:30</div>
          </div>
        </div>
      </div>
      
      <div class="dashboard-card" style="flex: 1;">
        <div class="card-header">
          <span>快速操作</span>
        </div>
        <div class="card-content">
          <button class="btn btn-primary quick-action-btn">
            <img src="@/assets/icons/icon-add-connection.svg" width="24" height="24" class="icon" /> 新建连接
          </button>
          <button class="btn btn-default quick-action-btn">
            <img src="@/assets/icons/icon-refresh.svg" width="24" height="24" class="icon" /> 刷新状态
          </button>
          <button class="btn btn-default quick-action-btn">
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
          <button class="btn btn-text">查看全部</button>
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
                  <button class="btn btn-text">连接</button>
                  <button class="btn btn-text">编辑</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      
      <div class="dashboard-card" style="flex: 1;">
        <div class="card-header">
          <span>活动日志</span>
          <button class="btn btn-text">清除</button>
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
import { ref, computed } from 'vue'

export default {
  name: 'Dashboard',
  setup() {
    // 获取应用版本号
    const appVersion = computed(() => {
      return import.meta.env.VITE_APP_VERSION || '1.0.0'
    })
    const recentConnections = ref([
      {
        name: '开发服务器',
        host: 'dev.example.com',
        lastConnected: '2023-12-10 14:30'
      },
      {
        name: '测试环境',
        host: 'test.example.com',
        lastConnected: '2023-12-09 10:15'
      },
      {
        name: '生产服务器',
        host: 'prod.example.com',
        lastConnected: '2023-12-05 18:22'
      }
    ])

    const activityLog = ref([
      {
        content: '连接到服务器 dev.example.com',
        time: '10分钟前',
        type: 'primary'
      },
      {
        content: '创建了新连接 backup-server',
        time: '2小时前',
        type: 'success'
      },
      {
        content: '修改了连接设置',
        time: '昨天 18:30',
        type: 'info'
      },
      {
        content: '系统自动备份完成',
        time: '2天前',
        type: 'info'
      }
    ])

    return {
      appVersion,
      recentConnections,
      activityLog
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

.dashboard-title {
  color: #a0a0a0;
  margin-bottom: 20px;
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

.btn-default:hover {
  color: #1890ff;
  border-color: #1890ff;
  background-color: #111;
}

.btn-primary {
  background-color: #1890ff;
  color: white;
  border: none;
}

.btn-primary:hover {
  background-color: #40a9ff;
}

.icon {
  margin-right: 5px;
}
</style> 