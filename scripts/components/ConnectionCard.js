/**
 * 连接卡片组件
 * 显示服务器连接信息的卡片组件
 */

export default {
  name: 'ConnectionCard',
  
  props: {
    // 连接信息对象
    connection: {
      type: Object,
      required: true,
      validator: (connection) => {
        return connection && connection.id && connection.name && connection.host;
      }
    },
    // 是否在浮动容器内
    inContainer: {
      type: Boolean,
      default: true
    }
  },
  
  template: `
    <div :class="['connection-card', {'connection-card--in-container': inContainer}]" :data-id="connection.id">
      <div class="connection-card__header">
        <div class="connection-card__icon">
          <i class="fas fa-server"></i>
        </div>
        <div class="connection-card__name">{{ connection.name }}</div>
        <div class="connection-card__favorite" @click="toggleFavorite">
          <i :class="['fas', connection.favorite ? 'fa-star' : 'fa-star-o']"></i>
        </div>
      </div>
      <div class="connection-card__host">{{ connection.host }}</div>
      <div class="connection-card__time">{{ connection.lastConnect }}</div>
      <div class="connection-card__footer">
        <button class="connection-card__connect-btn" @click="connect">连接</button>
        <button class="connection-card__edit-btn" @click="edit">
          <i class="fas fa-edit"></i>
        </button>
      </div>
    </div>
  `,
  
  methods: {
    /**
     * 连接到服务器
     */
    connect() {
      this.$emit('connect', this.connection);
    },
    
    /**
     * 编辑连接
     */
    edit() {
      this.$emit('edit', this.connection);
    },
    
    /**
     * 切换收藏状态
     */
    toggleFavorite(event) {
      // 阻止事件冒泡，避免触发卡片点击事件
      event.stopPropagation();
      
      // 创建连接的副本并切换收藏状态
      const connection = { ...this.connection };
      connection.favorite = !connection.favorite;
      
      this.$emit('favorite-change', connection);
    }
  },
  
  computed: {
    /**
     * 连接状态类
     */
    statusClass() {
      // 这里可以根据连接状态返回不同的类
      return 'connection-card--offline';
    }
  },
  
  mounted() {
    // 可以在这里添加卡片加载时的动画效果
    this.$el.style.opacity = '0';
    this.$el.style.transform = 'translateY(20px)';
    
    setTimeout(() => {
      this.$el.style.opacity = '1';
      this.$el.style.transform = 'translateY(0)';
      this.$el.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    }, 100);
  }
};
