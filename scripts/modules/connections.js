/**
 * 连接管理模块
 * 负责处理SSH连接相关的功能，包括最近连接管理
 */

import { apiConfig, storageConfig } from '../core/config.js';
import { saveToStorage, getFromStorage } from '../utils/storage.js';

// 保存的最近连接列表
let recentConnections = [];

// 最大保存连接数
const MAX_RECENT_CONNECTIONS = 10;

/**
 * 初始化连接管理器
 */
function init() {
  // 从本地存储加载最近连接
  loadRecentConnections();
  
  // 渲染最近连接列表
  renderRecentConnections();
  
  // 设置连接相关事件
  setupConnectionEvents();
  
  console.log('连接管理初始化完成');
}

/**
 * 加载最近连接数据
 */
function loadRecentConnections() {
  const savedConnections = getFromStorage(storageConfig.keys.recentConnections);
  
  if (savedConnections && Array.isArray(savedConnections)) {
    recentConnections = savedConnections;
    console.log(`已加载 ${recentConnections.length} 个最近连接`);
  }
}

/**
 * 渲染最近连接到UI
 */
function renderRecentConnections() {
  const container = document.getElementById('recentConnectionsList');
  if (!container) return;
  
  // 清空容器
  container.innerHTML = '';
  
  if (recentConnections.length === 0) {
    // 显示空状态
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    emptyState.innerHTML = `
      <i class="fas fa-info-circle"></i>
      <p>无最近连接记录</p>
    `;
    container.appendChild(emptyState);
    return;
  }
  
  // 创建连接列表
  const list = document.createElement('ul');
  list.className = 'connections-list';
  
  recentConnections.forEach((connection, index) => {
    const item = document.createElement('li');
    item.className = 'connection-item';
    item.dataset.id = connection.id;
    
    item.innerHTML = `
      <div class="connection-info">
        <div class="connection-name">${connection.name || '未命名连接'}</div>
        <div class="connection-host">${connection.host}:${connection.port}</div>
      </div>
      <div class="connection-actions">
        <button class="btn-connect" title="连接">
          <i class="fas fa-plug"></i>
        </button>
        <button class="btn-edit" title="编辑">
          <i class="fas fa-edit"></i>
        </button>
        <button class="btn-remove" title="删除">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    `;
    
    list.appendChild(item);
  });
  
  container.appendChild(list);
}

/**
 * 设置连接相关事件
 */
function setupConnectionEvents() {
  // 使用事件委托处理连接项操作
  document.addEventListener('click', function(event) {
    // 连接按钮
    if (event.target.matches('.btn-connect, .btn-connect *')) {
      const item = findParentConnectionItem(event.target);
      if (item) {
        const connectionId = item.dataset.id;
        connectToServer(connectionId);
      }
    }
    
    // 编辑按钮
    if (event.target.matches('.btn-edit, .btn-edit *')) {
      const item = findParentConnectionItem(event.target);
      if (item) {
        const connectionId = item.dataset.id;
        editConnection(connectionId);
      }
    }
    
    // 删除按钮
    if (event.target.matches('.btn-remove, .btn-remove *')) {
      const item = findParentConnectionItem(event.target);
      if (item) {
        const connectionId = item.dataset.id;
        removeConnection(connectionId);
      }
    }
    
    // 新建连接按钮
    if (event.target.matches('#newConnectionBtn, #newConnectionBtn *')) {
      showNewConnectionForm();
    }
  });
}

/**
 * 辅助函数:查找父级连接项
 * @param {HTMLElement} element 当前元素
 * @returns {HTMLElement|null} 父级连接项元素
 */
function findParentConnectionItem(element) {
  while (element && !element.matches('.connection-item')) {
    element = element.parentElement;
  }
  return element;
}

/**
 * 添加新连接
 * @param {Object} connection 连接信息
 */
function addConnection(connection) {
  // 生成唯一ID
  if (!connection.id) {
    connection.id = 'conn_' + Date.now();
  }
  
  // 检查是否已存在相同连接
  const existingIndex = recentConnections.findIndex(
    conn => conn.host === connection.host && conn.port === connection.port
  );
  
  if (existingIndex !== -1) {
    // 如果已存在，移除旧的
    recentConnections.splice(existingIndex, 1);
  }
  
  // 添加到开头
  recentConnections.unshift(connection);
  
  // 保持最大连接数限制
  if (recentConnections.length > MAX_RECENT_CONNECTIONS) {
    recentConnections = recentConnections.slice(0, MAX_RECENT_CONNECTIONS);
  }
  
  // 保存到本地存储
  saveToStorage(storageConfig.keys.recentConnections, recentConnections);
  
  // 重新渲染
  renderRecentConnections();
  
  console.log(`添加连接: ${connection.name || '未命名'} (${connection.host}:${connection.port})`);
}

/**
 * 删除连接
 * @param {string} connectionId 连接ID
 */
function removeConnection(connectionId) {
  const index = recentConnections.findIndex(conn => conn.id === connectionId);
  
  if (index !== -1) {
    const removed = recentConnections.splice(index, 1)[0];
    
    // 保存到本地存储
    saveToStorage(storageConfig.keys.recentConnections, recentConnections);
    
    // 重新渲染
    renderRecentConnections();
    
    console.log(`删除连接: ${removed.name || '未命名'} (${removed.host}:${removed.port})`);
  }
}

/**
 * 编辑连接
 * @param {string} connectionId 连接ID
 */
function editConnection(connectionId) {
  const connection = recentConnections.find(conn => conn.id === connectionId);
  
  if (connection) {
    console.log(`编辑连接: ${connection.name || '未命名'} (${connection.host}:${connection.port})`);
    
    // 触发编辑连接事件
    document.dispatchEvent(new CustomEvent('editConnection', { 
      detail: { connection } 
    }));
  }
}

/**
 * 连接到服务器
 * @param {string} connectionId 连接ID
 */
function connectToServer(connectionId) {
  const connection = recentConnections.find(conn => conn.id === connectionId);
  
  if (connection) {
    console.log(`连接到服务器: ${connection.name || '未命名'} (${connection.host}:${connection.port})`);
    
    // 添加到最近连接（会移到最前面）
    addConnection(connection);
    
    // 触发连接事件
    document.dispatchEvent(new CustomEvent('startConnection', { 
      detail: { connection } 
    }));
  }
}

/**
 * 显示新建连接表单
 */
function showNewConnectionForm() {
  console.log('显示新建连接表单');
  
  // 触发显示新建连接表单事件
  document.dispatchEvent(new CustomEvent('showNewConnectionForm'));
}

/**
 * 获取最近连接列表
 * @returns {Array} 最近连接数组
 */
function getRecentConnections() {
  return [...recentConnections];
}

export default {
  init,
  addConnection,
  removeConnection,
  editConnection,
  connectToServer,
  getRecentConnections,
  renderRecentConnections
};
