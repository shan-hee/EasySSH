<template>
  <!-- SFTP文件管理器使用自定义 SVG -->
  <svg
    v-if="name === 'file-manager'"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    :class="['toolbar-icon', `toolbar-icon--${name}`]"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M6.667 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5.333"
      style="display: inline"
      fill="none"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
    />
    <g
      style="display: inline"
      fill="none"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path
        stroke-width="2"
        d="M8 7q0-1-2-1H4Q2 6 2 8t2 2h2q2 0 2 2t-2 2H4q-2 0-2-1"
        transform="matrix(.35228 0 0 .65414 8.997 13.45)"
      />
      <path
        stroke-width="2.145"
        d="M12.072 6.072v7.856m0-7.856h5.856M12.072 10h4.685"
        transform="matrix(.35228 0 0 .65414 8.997 13.45)"
      />
      <path
        stroke-width="2"
        d="M22 6h6m-3 0v8m7-8v8m0-8h4q2 0 2 2t-2 2h-4"
        transform="matrix(.35228 0 0 .65414 8.997 13.45)"
      />
    </g>
  </svg>
  <!-- 其他图标使用 Lucide 图标 -->
  <icon
    v-else
    :icon="iconName"
    :width="size"
    :height="size"
    :class="['toolbar-icon', `toolbar-icon--${name}`]"
  />
</template>

<script>
import { defineComponent, computed } from 'vue';
import { Icon } from '@iconify/vue';

export default defineComponent({
  name: 'ToolbarIcon',
  components: {
    Icon
  },
  props: {
    name: {
      type: String,
      required: true,
      validator: value => {
        const validIcons = ['file-manager', 'network', 'monitoring', 'ai'];
        return validIcons.includes(value);
      }
    },
    size: {
      type: [String, Number],
      default: 18
    }
  },
  setup(props) {
    // 映射图标名称到 Lucide 图标
    const iconName = computed(() => {
      const iconMap = {
        network: 'lucide:globe',
        monitoring: 'lucide:activity-square',
        ai: 'lucide:bot'
      };
      return iconMap[props.name] || 'lucide:help-circle';
    });

    return {
      iconName
    };
  }
});
</script>

<style scoped>
.toolbar-icon {
  display: inline-block;
  vertical-align: middle;
  transition: color var(--transition-base);
  color: var(--sidebar-nav-color);
}

/* 浅色主题下的默认状态 - 使用更浅的颜色增加对比度 */
:root[data-theme='light'] .toolbar-icon {
  color: var(--color-text-secondary);
}

/* 激活状态 - 使用指定的亮色 */
.toolbar-icon.icon-active {
  opacity: 1;
}

/* 深色主题下的激活状态 */
:root[data-theme='dark'] .toolbar-icon.icon-active {
  color: #ffffff;
}

/* 浅色主题下的激活状态 */
:root[data-theme='light'] .toolbar-icon.icon-active {
  color: #303133;
}
</style>
