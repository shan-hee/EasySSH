/**
 * 连接列表组件
 * 用于显示最近连接列表
 */

import ConnectionCard from './ConnectionCard.js';

export default {
  name: 'ConnectionList',
  
  components: {
    ConnectionCard
  },
  
  props: {
    // 连接列表
    connections: {
      type: Array,
      default: () => []
    },
    // 列表标题
    title: {
      type: String,
      default: '最近连接'
    },
    // 是否显示标题
    showTitle: {
      type: Boolean,
      default: true
    },
    // 空列表提示文本
    emptyText: {
      type: String,
      default: '暂无连接记录'
    }
  },
  
  template: `
    <div class="connection-list">
      <div v-if="showTitle" class="connection-list__header">
        <h4 class="connection-list__title">{{ title }} <i class="fas fa-clock"></i></h4>
      </div>
      
      <div class="row">
        <template v-if="connections.length > 0">
          <div class="col-md-4 col-sm-6 col-xs-12" v-for="connection in connections" :key="connection.id">
            <connection-card 
              :connection="connection"
              @connect="handleConnect"
              @edit="handleEdit"
              @favorite-change="handleFavoriteChange"
            />
          </div>
        </template>
        <div v-else class="col-12">
          <div class="connection-list__empty">
            <i class="fas fa-info-circle"></i>
            <p>{{ emptyText }}</p>
          </div>
        </div>
      </div>
    </div>
  `,
  
  methods: {
    /**
     * 处理连接事件
     * @param {Object} connection 连接信息
     */
    handleConnect(connection) {
      this.$emit('connect', connection);
    },
    
    /**
     * 处理编辑事件
     * @param {Object} connection 连接信息
     */
    handleEdit(connection) {
      this.$emit('edit', connection);
    },
    
    /**
     * 处理收藏状态变更事件
     * @param {Object} connection 连接信息
     */
    handleFavoriteChange(connection) {
      this.$emit('favorite-change', connection);
    }
  },
  
  computed: {
    /**
     * 是否显示空列表提示
     */
    showEmpty() {
      return this.connections.length === 0;
    }
  }
};
