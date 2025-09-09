import { ref, computed } from 'vue';

/**
 * 可排序的composable
 * 提供文件列表排序功能
 */
export function useSortable() {
  // 排序状态
  const sortField = ref(null); // 当前排序字段：name, size, date, type, null(无排序)
  const sortOrder = ref('asc'); // 排序方向：asc(升序), desc(降序), null(默认)

  // 排序字段配置
  const sortFields = {
    name: {
      label: '名称',
      getValue: file => file.name.toLowerCase(),
      compare: (a, b, order) => {
        const aVal = a.name.toLowerCase();
        const bVal = b.name.toLowerCase();
        const result = aVal.localeCompare(bVal, undefined, { sensitivity: 'base' });
        return order === 'asc' ? result : -result;
      }
    },
    size: {
      label: '大小',
      getValue: file => (file.isDirectory ? -1 : file.size || 0),
      compare: (a, b, order) => {
        // 文件夹始终排在前面（除非都是文件夹）
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;

        const aSize = a.isDirectory ? 0 : a.size || 0;
        const bSize = b.isDirectory ? 0 : b.size || 0;
        const result = aSize - bSize;
        return order === 'asc' ? result : -result;
      }
    },
    date: {
      label: '修改日期',
      getValue: file => (file.modifiedTime ? new Date(file.modifiedTime).getTime() : 0),
      compare: (a, b, order) => {
        const aTime = a.modifiedTime ? new Date(a.modifiedTime).getTime() : 0;
        const bTime = b.modifiedTime ? new Date(b.modifiedTime).getTime() : 0;
        const result = aTime - bTime;
        return order === 'asc' ? result : -result;
      }
    },
    type: {
      label: '类型',
      getValue: file => (file.isDirectory ? 'folder' : getFileExtension(file.name)),
      compare: (a, b, order) => {
        // 文件夹始终排在前面
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;

        const aType = a.isDirectory ? 'folder' : getFileExtension(a.name);
        const bType = b.isDirectory ? 'folder' : getFileExtension(b.name);
        const result = aType.localeCompare(bType);
        return order === 'asc' ? result : -result;
      }
    }
  };

  // 获取文件扩展名
  const getFileExtension = filename => {
    if (!filename) return '';
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : '';
  };

  // 切换排序 - 三种状态循环：无排序 -> 升序 -> 降序 -> 无排序
  const toggleSort = field => {
    if (sortField.value === field) {
      // 如果是同一个字段，按照三种状态循环
      if (sortOrder.value === 'asc') {
        sortOrder.value = 'desc';
      } else if (sortOrder.value === 'desc') {
        // 回到默认状态（无排序）
        sortField.value = null;
        sortOrder.value = 'asc';
      }
    } else {
      // 如果是不同字段，设置新字段并开始升序
      sortField.value = field;
      sortOrder.value = 'asc';
    }
  };

  // 默认排序：文件夹在前，然后按名称排序
  const defaultSort = files => {
    return [...files].sort((a, b) => {
      // 文件夹排在文件前面
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;

      // 同类型按名称字母顺序排序
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
  };

  // 排序文件列表
  const sortFiles = files => {
    if (!files || !Array.isArray(files)) return [];

    // 如果没有设置排序字段，使用默认排序
    if (!sortField.value) {
      return defaultSort(files);
    }

    const sortConfig = sortFields[sortField.value];
    if (!sortConfig) return defaultSort(files);

    return [...files].sort((a, b) => sortConfig.compare(a, b, sortOrder.value));
  };

  // 获取排序指示器
  const getSortIndicator = field => {
    if (sortField.value !== field) return '';
    return sortOrder.value === 'asc' ? '↑' : '↓';
  };

  // 检查字段是否为当前排序字段
  const isActiveSort = field => {
    return sortField.value === field;
  };

  // 计算属性：当前排序配置
  const currentSortConfig = computed(() => {
    return sortField.value ? sortFields[sortField.value] : null;
  });

  return {
    // 状态
    sortField,
    sortOrder,
    sortFields,

    // 方法
    toggleSort,
    sortFiles,
    getSortIndicator,
    isActiveSort,

    // 计算属性
    currentSortConfig
  };
}
