<template>
  <div class="dashboard-container">
    <h1 class="dashboard-title">EasySSH 控制台</h1>
    <div class="row" style="display: flex; gap: 20px; margin-bottom: 20px;">
      <div class="dashboard-card" style="flex: 1;">
        <div class="card-header">
          <span>服务器状态</span>
          <button class="btn btn-text">查看全部</button>
        </div>
        <div class="card-content">
          <div class="status-item">
            <div class="status-label">活跃连接</div>
            <div class="status-value">3</div>
          </div>
          <div class="status-item">
            <div class="status-label">已保存服务器</div>
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
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" class="icon">
              <path fill="#ffffff" d="M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z" />
            </svg> 新建连接
          </button>
          <button class="btn btn-default quick-action-btn">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" class="icon">
              <path fill="#a0a0a0" d="M17.65,6.35C16.2,4.9 14.21,4 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20C15.73,20 18.84,17.45 19.73,14H17.65C16.83,16.33 14.61,18 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6C13.66,6 15.14,6.69 16.22,7.78L13,11H20V4L17.65,6.35Z" />
            </svg> 刷新状态
          </button>
          <button class="btn btn-default quick-action-btn">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" class="icon">
              <path fill="#a0a0a0" d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z" />
            </svg> 设置
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
            <div class="status-value">1.0.0</div>
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
import { ref } from 'vue'

export default {
  name: 'Dashboard',
  setup() {
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