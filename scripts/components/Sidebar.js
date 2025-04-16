/**
 * 侧边栏组件
 * 负责显示侧边栏菜单
 */

export default {
  name: 'Sidebar',
  
  data() {
    return {
      // 菜单是否折叠
      collapsed: false,
      // 菜单数据
      menuItems: [
        {
          id: 'service',
          title: '连接配置',
          icon: 'network-wired',
          href: '/service',
          shortcuts: ['Ctrl', 'L'],
          active: true
        },
        {
          id: 'setting',
          title: '设置中心',
          icon: 'cog',
          href: '/setting',
          shortcuts: ['Ctrl', 'S'],
          active: false
        },
        {
          id: 'favorites',
          title: '收藏夹',
          icon: 'star',
          href: '/favorites',
          shortcuts: ['Ctrl', 'F'],
          active: false
        },
        {
          id: 'history',
          title: '历史记录',
          icon: 'history',
          href: '/history',
          shortcuts: ['Ctrl', 'H'],
          active: false
        }
      ]
    };
  },
  
  template: `
    <div :class="['sidebar', {'sidebar--collapsed': collapsed}]">
      <div class="sidebar__toggle menu__toggle" id="menuToggle" @click="toggleMenu">
        <i class="fas fa-chevron-left"></i>
      </div>
      <div :class="['menu', {'menu--collapsed': collapsed}]">
        <ul class="menu__list">
          <li 
            v-for="item in menuItems" 
            :key="item.id"
            :class="['menu__item', {'menu__item--active': item.active}]"
            :data-href="item.href"
            @click="activateMenuItem(item)"
          >
            <div class="menu__icon-wrapper">
              <i :class="['fas', 'fa-' + item.icon, 'menu__icon']"></i>
            </div>
            <span class="menu__text">{{ item.title }}</span>
            <div class="menu__shortcut-group" v-if="item.shortcuts && item.shortcuts.length">
              <span class="menu__shortcut" v-for="(key, index) in item.shortcuts" :key="index">{{ key }}</span>
            </div>
            <div class="menu__tooltip">{{ item.title }}</div>
          </li>
        </ul>
      </div>
    </div>
  `,
  
  methods: {
    /**
     * 切换菜单折叠状态
     */
    toggleMenu() {
      this.collapsed = !this.collapsed;
      this.$emit('toggle', this.collapsed);
      
      // 保存状态到本地存储
      localStorage.setItem('menu_collapsed', this.collapsed);
    },
    
    /**
     * 激活菜单项
     * @param {Object} item 菜单项
     */
    activateMenuItem(item) {
      // 更新激活状态
      this.menuItems.forEach(menuItem => {
        menuItem.active = menuItem.id === item.id;
      });
      
      // 触发导航事件
      this.$emit('navigate', item.href, item.id);
    },
    
    /**
     * 设置指定ID的菜单项为激活状态
     * @param {string} id 菜单项ID
     */
    setActiveItem(id) {
      this.menuItems.forEach(menuItem => {
        menuItem.active = menuItem.id === id;
      });
    }
  },
  
  created() {
    // 从本地存储中恢复菜单状态
    const savedState = localStorage.getItem('menu_collapsed');
    if (savedState !== null) {
      this.collapsed = savedState === 'true';
    }
    
    // 根据当前路径设置激活菜单
    const currentPath = window.location.pathname;
    const matchingItem = this.menuItems.find(item => item.href === currentPath);
    
    if (matchingItem) {
      this.setActiveItem(matchingItem.id);
    }
  },
  
  mounted() {
    // 监听路由变化事件，实际应用中可能会使用Vue Router的钩子
    window.addEventListener('popstate', () => {
      const currentPath = window.location.pathname;
      const matchingItem = this.menuItems.find(item => item.href === currentPath);
      
      if (matchingItem) {
        this.setActiveItem(matchingItem.id);
      }
    });
  }
};
