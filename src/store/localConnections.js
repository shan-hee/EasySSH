import { defineStore } from 'pinia';
import log from '@/services/log';

export const useLocalConnectionsStore = defineStore('localConnections', {
  state: () => ({
    connections: [], // 我的连接配置
    favorites: [], // 收藏的连接
    history: [], // 历史连接记录
    pinnedConnections: {} // 置顶信息
  }),

  persist: {
    key: 'local_connections',
    storageType: 'persistent'
  },

  actions: {
    getNextSortOrder() {
      if (!this.connections.length) {
        return 1;
      }
      const maxSortOrder = this.connections.reduce((max, conn) => {
        const current = typeof conn.sortOrder === 'number' ? conn.sortOrder : 0;
        return current > max ? current : max;
      }, 0);
      return maxSortOrder + 1;
    },

    // 添加新连接到我的连接配置
    addConnection(connection) {
      // 检查是否已存在相同的连接（去重）
      const existingConnection = this.connections.find(
        conn =>
          conn.host === connection.host &&
          conn.port === connection.port &&
          conn.username === connection.username
      );

      if (existingConnection) {
        // 如果连接已存在，更新现有连接信息
        Object.assign(existingConnection, connection, { id: existingConnection.id });
        log.debug('连接已存在，已更新连接信息');
        return existingConnection.id;
      }

      // 生成唯一ID
      connection.id = Date.now().toString();
      // 默认排序值追加到末尾
      if (typeof connection.sortOrder !== 'number') {
        connection.sortOrder = this.getNextSortOrder();
      }
      this.connections.push(connection);
      return connection.id;
    },

    // 更新连接
    updateConnection(id, connection) {
      const index = this.connections.findIndex(c => c.id === id);
      if (index !== -1) {
        const current = this.connections[index];
        const nextSortOrder =
          typeof connection.sortOrder === 'number' ? connection.sortOrder : current.sortOrder;
        this.connections[index] = { ...current, ...connection, sortOrder: nextSortOrder };
      }
    },

    // 删除连接
    deleteConnection(id) {
      this.connections = this.connections.filter(c => c.id !== id);
      this.favorites = this.favorites.filter(c => c !== id);
      this.history = this.history.filter(c => c.id !== id);
      delete this.pinnedConnections[id];
    },

    // 置顶/取消置顶连接
    togglePin(id) {
      if (this.pinnedConnections[id]) {
        delete this.pinnedConnections[id];
      } else {
        this.pinnedConnections[id] = Date.now();
      }
    },

    // 检查是否已置顶
    isPinned(id) {
      return !!this.pinnedConnections[id];
    },

    // 获取置顶时间
    getPinTime(id) {
      return this.pinnedConnections[id] || 0;
    },

    // 添加到收藏
    addToFavorites(id) {
      if (!this.favorites.includes(id)) {
        this.favorites.push(id);
      }
    },

    // 从收藏移除
    removeFromFavorites(id) {
      this.favorites = this.favorites.filter(fid => fid !== id);
    },

    // 添加到历史记录
    addToHistory(connection) {
      // 直接添加到历史记录开头，不去重
      this.history.unshift({
        id: connection.id,
        name: connection.name,
        host: connection.host,
        username: connection.username,
        port: connection.port,
        description: connection.description,
        timestamp: Date.now()
      });
      // 限制历史记录数量为20条
      if (this.history.length > 20) {
        this.history.pop();
      }
    },

    // 从历史记录中删除指定连接
    removeFromHistory(connectionId, timestamp) {
      this.history = this.history.filter(
        h => !(h.id === connectionId && h.timestamp === timestamp)
      );
    },

    // 重新排序历史连接
    reorderHistoryConnections(newOrder) {
      this.history = [...newOrder];
    },

    // 更新历史连接顺序（用于乐观更新）
    updateHistoryOrder(newOrder) {
      this.history = [...newOrder];
    },

    // 重排当前连接顺序（用于拖拽）
    reorderConnections(newOrder) {
      this.connections = newOrder.map((connection, index) => ({
        ...connection,
        sortOrder: index + 1
      }));
    }
  },

  getters: {
    // 获取所有连接（包含置顶排序）
    getAllConnections: state => {
      const pinnedList = [];
      const regularList = [];

      state.connections.forEach(connection => {
        if (state.pinnedConnections[connection.id]) {
          pinnedList.push(connection);
        } else {
          regularList.push(connection);
        }
      });

      pinnedList.sort((a, b) => {
        const timeA = state.pinnedConnections[a.id] || 0;
        const timeB = state.pinnedConnections[b.id] || 0;
        return timeB - timeA;
      });

      regularList.sort((a, b) => {
        const orderA = typeof a.sortOrder === 'number' ? a.sortOrder : 0;
        const orderB = typeof b.sortOrder === 'number' ? b.sortOrder : 0;
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        const timeA = a.createdAt || 0;
        const timeB = b.createdAt || 0;
        return timeA > timeB ? 1 : timeA < timeB ? -1 : 0;
      });

      return [...pinnedList, ...regularList];
    },

    // 获取收藏的连接
    getFavoriteConnections: state => {
      return state.connections.filter(c => state.favorites.includes(c.id));
    },

    // 获取历史记录
    getHistory: state => state.history,

    // 检查连接是否已收藏
    isFavorite: state => id => state.favorites.includes(id),

    // 通过ID获取连接信息
    getConnectionById: state => id => {
      return state.connections.find(connection => connection.id === id);
    }
  }
});
