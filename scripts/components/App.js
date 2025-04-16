/**
 * App主应用组件
 * 整合其他子组件，作为应用的入口组件
 */

import Sidebar from './Sidebar.js';
import ConnectionList from './ConnectionList.js';
import ServerModal from './ServerModal.js';
import ThemeManager from '../modules/theme.js';
import ConnectionManager from '../modules/connections.js';

export default {
  name: 'App',
  
  components: {
    Sidebar,
    ConnectionList,
    ServerModal
  },
  
  data() {
    return {
      // 应用标题
      appTitle: 'Easyssh',
      // 应用版本
      version: 'v1.0',
      // 应用描述
      description: '轻量级、安全、高效的SSH连接管理工具，为开发者提供极致体验',
      // 连接列表
      connections: [],
      // 模态框是否可见
      modalVisible: false,
      // 模态框模式
      modalMode: 'create',
      // 当前编辑的连接
      currentConnection: null
    };
  },
  
  template: `
    <div class="app">
      <div class="app-header">
        <div class="app-header__left">
          <span class="app-header__logo">{{ appTitle }}</span>
          <i class="fas fa-chevron-down app-header__dropdown"></i>
          <div class="app-header__menu">
            <ul class="app-header__menu-list">
              <li class="app-header__menu-item" data-href="/service">
                <i class="fas fa-link app-header__menu-icon"></i> 连接配置
              </li>
              <li class="app-header__menu-item" data-href="/setting">
                <i class="fas fa-cog app-header__menu-icon"></i> 设置中心
              </li>
              <li class="app-header__menu-item" data-href="/docs">
                <i class="fas fa-book app-header__menu-icon"></i> 使用文档
              </li>
            </ul>
          </div>
        </div>
        <div class="app-header__center">
          <div class="app-header__tabs">
            <!-- 标签将在这里动态生成 -->
          </div>
          <div class="app-header__tab-add" id="addTab">
            <i class="fas fa-plus"></i>
          </div>
        </div>
        <div class="app-header__right">
          <div class="app-header__action theme-toggle" id="themeToggle" @click="toggleTheme">
            <i class="fas fa-moon theme-toggle__icon"></i>
          </div>
          <div class="app-header__action">
            <i class="fas fa-bell"></i>
            <span class="app-header__badge"></span>
          </div>
        </div>
      </div>
      
      <div class="main">
        <sidebar 
          @toggle="handleMenuToggle" 
          @navigate="handleNavigate"
        />
        
        <div class="content">
          <div class="container">
            <div class="header-content">
              <div class="title-area">
                <h3>{{ appTitle }} <span class="version">{{ version }}</span></h3>
                <p>{{ description }}</p>
              </div>
              <div class="quick-actions">
                <button class="btn btn--primary" @click="openCreateServerModal">
                  <i class="fas fa-plus"></i>
                  <span>创建服务器</span>
                </button>
                <button class="btn btn--secondary" id="importBtn">
                  <i class="fas fa-file-import"></i>
                  <span>导入配置</span>
                </button>
              </div>
            </div>
            
            <div class="row">
              <div class="col-12">
                <div class="feature-card feature-card--security">
                  <div class="feature-card__icon">
                    <i class="fas fa-shield-alt"></i>
                  </div>
                  <div class="feature-card__content">
                    <h4 class="feature-card__title">安全连接</h4>
                    <p class="feature-card__description">支持多种加密协议，确保数据传输安全可靠，保障远程连接的私密性与完整性</p>
                  </div>
                </div>
              </div>
              
              <div class="col-12">
                <div class="feature-card feature-card--performance">
                  <div class="feature-card__icon">
                    <i class="fas fa-bolt"></i>
                  </div>
                  <div class="feature-card__content">
                    <h4 class="feature-card__title">高性能</h4>
                    <p class="feature-card__description">极速响应，支持多会话并行管理，低延迟连接确保命令实时执行，提升工作效率</p>
                  </div>
                </div>
              </div>
              
              <div class="col-12">
                <div class="feature-card feature-card--tools">
                  <div class="feature-card__icon">
                    <i class="fas fa-tools"></i>
                  </div>
                  <div class="feature-card__content">
                    <h4 class="feature-card__title">丰富功能</h4>
                    <p class="feature-card__description">支持文件传输、端口转发、会话保存、命令记录等多种专业功能，满足各类远程管理需求</p>
                  </div>
                </div>
              </div>
            </div>
            
            <div class="card">
              <connection-list 
                :connections="connections"
                @connect="handleConnect"
                @edit="handleEdit"
                @favorite-change="handleFavoriteChange"
              />
            </div>
          </div>
        </div>
      </div>
      
      <server-modal 
        :visible.sync="modalVisible"
        :mode="modalMode"
        :connection="currentConnection"
        @create="handleCreateConnection"
        @update="handleUpdateConnection"
      />
    </div>
  `,
  
  mounted() {
    // 初始化连接列表
    this.loadConnections();
  },
  
  methods: {
    /**
     * 加载连接列表
     */
    loadConnections() {
      this.connections = ConnectionManager.getRecentConnections();
    },
    
    /**
     * 处理菜单折叠切换
     * @param {boolean} collapsed 菜单折叠状态
     */
    handleMenuToggle(collapsed) {
      console.log(`菜单状态: ${collapsed ? '折叠' : '展开'}`);
    },
    
    /**
     * 处理导航
     * @param {string} href 导航链接
     * @param {string} id 菜单项ID
     */
    handleNavigate(href, id) {
      console.log(`导航到: ${href}, 菜单项: ${id}`);
      // 这里可以实现路由导航
    },
    
    /**
     * 切换主题
     */
    toggleTheme() {
      ThemeManager.toggleTheme();
    },
    
    /**
     * 打开创建服务器模态框
     */
    openCreateServerModal() {
      this.modalMode = 'create';
      this.currentConnection = null;
      this.modalVisible = true;
    },
    
    /**
     * 处理连接到服务器
     * @param {Object} connection 连接信息
     */
    handleConnect(connection) {
      console.log(`连接到服务器: ${connection.name}`);
      ConnectionManager.connectToServer(connection.id);
    },
    
    /**
     * 处理编辑连接
     * @param {Object} connection 连接信息
     */
    handleEdit(connection) {
      console.log(`编辑连接: ${connection.name}`);
      this.modalMode = 'edit';
      this.currentConnection = connection;
      this.modalVisible = true;
    },
    
    /**
     * 处理收藏状态变更
     * @param {Object} connection 连接信息
     */
    handleFavoriteChange(connection) {
      console.log(`${connection.favorite ? '添加到' : '从'}收藏夹${connection.favorite ? '' : '移除'}: ${connection.name}`);
      ConnectionManager.toggleFavorite(connection.id);
      this.loadConnections(); // 重新加载连接列表
    },
    
    /**
     * 处理创建连接
     * @param {Object} connection 连接信息
     */
    handleCreateConnection(connection) {
      console.log(`创建连接: ${connection.name}`);
      // 这里应该调用连接管理模块来保存连接
      // 例如：ConnectionManager.addConnection(connection);
      
      // 重新加载连接列表
      this.loadConnections();
    },
    
    /**
     * 处理更新连接
     * @param {Object} connection 连接信息
     */
    handleUpdateConnection(connection) {
      console.log(`更新连接: ${connection.name}`);
      // 这里应该调用连接管理模块来更新连接
      // 例如：ConnectionManager.updateConnection(connection);
      
      // 重新加载连接列表
      this.loadConnections();
    }
  }
};
