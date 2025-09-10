<template>
  <svg
    :width="size"
    :height="size"
    :viewBox="viewBox"
    :class="['themed-icon', `themed-icon--${name}`]"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path :d="iconPath" fill="currentColor" />
  </svg>
</template>

<script>
import { defineComponent, computed } from 'vue';

export default defineComponent({
  name: 'ThemedIcon',
  props: {
    name: {
      type: String,
      required: true,
      validator: value => {
        const validIcons = [
          'add-connection',
          'refresh',
          'settings',
          'console',
          'terminal',
          'file-manager',
          'monitoring',
          'network'
        ];
        return validIcons.includes(value);
      }
    },
    size: {
      type: [String, Number],
      default: 24
    }
  },
  setup(props) {
    // 图标路径数据映射
    const iconPaths = {
      'add-connection': 'M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z',
      refresh:
        'M17.65,6.35C16.2,4.9 14.21,4 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20C15.73,20 18.84,17.45 19.73,14H17.65C16.83,16.33 14.61,18 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6C13.66,6 15.14,6.69 16.22,7.78L13,11H20V4L17.65,6.35Z',
      settings:
        'M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z',
      console:
        'M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3M9 17H7V10H9V17M13 17H11V7H13V17M17 17H15V13H17V17Z',
      terminal:
        'M20,19V7H4V19H20M20,3A2,2 0 0,1 22,5V19A2,2 0 0,1 20,21H4A2,2 0 0,1 2,19V5C2,3.89 2.9,3 4,3H20M13,17V15H18V17H13M9.58,13L5.57,9H8.4L11.7,12.3C12.09,12.69 12.09,13.33 11.7,13.72L8.42,17H5.59L9.58,13Z',
      'file-manager':
        'M10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6H12L10,4Z',
      monitoring:
        'M3,3H21V5H3V3M4,6H20V21H4V6M6,8V19H11V8H6M13,8V19H18V8H13M8,17H9V10H8V17M15,17H16V12H15V17Z',
      network:
        'M17,3A2,2 0 0,1 19,5V15A2,2 0 0,1 17,17H13V19H14A1,1 0 0,1 15,20H22V22H15A1,1 0 0,1 14,23H10A1,1 0 0,1 9,22H2V20H9A1,1 0 0,1 10,19H11V17H7A2,2 0 0,1 5,15V5A2,2 0 0,1 7,3H17M7,5V15H17V5H7Z'
    };

    // 计算图标路径
    const iconPath = computed(() => {
      return iconPaths[props.name] || '';
    });

    // 计算viewBox
    const viewBox = computed(() => {
      return '0 0 24 24';
    });

    return {
      iconPath,
      viewBox
    };
  }
});
</script>

<style scoped>
.themed-icon {
  display: inline-block;
  vertical-align: middle;
  transition: color var(--transition-base);
  color: var(--sidebar-nav-color);
}

/* 在按钮中的图标样式 */
.btn .themed-icon {
  margin-right: 8px;
}

.btn:last-child .themed-icon {
  margin-right: 0;
}

/* 悬停和激活状态 - 图标颜色保持不变 */
.btn:hover .themed-icon,
.btn:active .themed-icon {
  color: var(--sidebar-nav-color);
}

/* 禁用状态 */
.btn:disabled .themed-icon {
  color: var(--color-text-disabled);
}

/* 主按钮中的图标 */
.btn-primary .themed-icon {
  color: inherit;
}

.btn-primary:hover .themed-icon {
  color: inherit;
}

.btn-primary:active .themed-icon {
  color: inherit;
}
</style>
