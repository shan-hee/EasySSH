/**
 * Pinia统一存储持久化插件
 * 基于统一存储工具实现的Pinia持久化插件，替代pinia-plugin-persistedstate
 */
import storageService from '@/services/storage';
import log from '@/services/log';

/**
 * 创建Pinia存储持久化插件
 * @param {Object} options 插件选项
 * @returns {Function} Pinia插件函数
 */
export function createStoragePlugin(options = {}) {
  const defaultOptions = {
    key: storeId => `store.${storeId}`,
    storageType: 'persistent', // 'persistent' | 'session' | 'temp'
    paths: null, // 要持久化的路径，null表示全部
    beforeRestore: null, // 恢复前的钩子
    afterRestore: null, // 恢复后的钩子
    serializer: {
      serialize: JSON.stringify,
      deserialize: JSON.parse
    }
  };

  const config = { ...defaultOptions, ...options };

  return ({ store, options: storeOptions }) => {
    // 检查store是否启用了持久化
    const persistConfig = storeOptions.persist;
    if (!persistConfig) return;

    // 合并配置
    const storeConfig = typeof persistConfig === 'boolean' ? {} : persistConfig;

    const finalConfig = {
      ...config,
      ...storeConfig,
      key: storeConfig.key || config.key(store.$id)
    };

    // 恢复状态
    restoreState(store, finalConfig);

    // 监听状态变化并持久化
    store.$subscribe(
      (mutation, state) => {
        persistState(store, state, finalConfig);
      },
      { detached: true }
    );
  };
}

/**
 * 恢复store状态
 * @param {Object} store Pinia store实例
 * @param {Object} config 配置对象
 */
function restoreState(store, config) {
  try {
    // 执行恢复前钩子
    if (config.beforeRestore) {
      config.beforeRestore(store);
    }

    // 从存储获取数据
    const storedData = getStorageData(config.key, config.storageType);

    if (storedData) {
      // 反序列化数据
      const data = config.serializer.deserialize(storedData);

      // 如果指定了paths，只恢复指定的路径
      if (config.paths && Array.isArray(config.paths)) {
        config.paths.forEach(path => {
          if (data.hasOwnProperty(path)) {
            store.$patch({ [path]: data[path] });
          }
        });
      } else {
        // 恢复全部状态
        store.$patch(data);
      }
    }

    // 执行恢复后钩子
    if (config.afterRestore) {
      config.afterRestore(store);
    }
  } catch (error) {
    log.error(`恢复Store状态失败: ${store.$id}`, error);
  }
}

/**
 * 持久化store状态
 * @param {Object} store Pinia store实例
 * @param {Object} state 当前状态
 * @param {Object} config 配置对象
 */
function persistState(store, state, config) {
  try {
    let dataToSave = state;

    // 如果指定了paths，只保存指定的路径
    if (config.paths && Array.isArray(config.paths)) {
      dataToSave = {};
      config.paths.forEach(path => {
        if (state.hasOwnProperty(path)) {
          dataToSave[path] = state[path];
        }
      });
    }

    // 序列化数据
    const serializedData = config.serializer.serialize(dataToSave);

    // 保存到存储
    const success = setStorageData(config.key, serializedData, config.storageType);

    if (!success) {
      log.warn(`Store状态持久化失败: ${store.$id}`);
    }
  } catch (error) {
    log.error(`持久化Store状态失败: ${store.$id}`, error);
  }
}

/**
 * 从存储获取数据
 * @param {string} key 存储键
 * @param {string} storageType 存储类型
 * @returns {string|null} 存储的数据
 */
function getStorageData(key, storageType) {
  try {
    switch (storageType) {
    case 'session':
      return sessionStorage.getItem(key);
    case 'temp':
      // 临时存储，使用内存缓存
      return null; // 暂时不实现
    case 'persistent':
    default:
      return storageService.getItem(key);
    }
  } catch (error) {
    log.error(`获取存储数据失败: ${key}`, error);
    return null;
  }
}

/**
 * 保存数据到存储
 * @param {string} key 存储键
 * @param {string} data 要保存的数据
 * @param {string} storageType 存储类型
 * @returns {boolean} 是否保存成功
 */
function setStorageData(key, data, storageType) {
  try {
    switch (storageType) {
    case 'session':
      sessionStorage.setItem(key, data);
      return true;
    case 'temp':
      // 临时存储，使用内存缓存
      return true; // 暂时不实现
    case 'persistent':
    default:
      return storageService.setItem(key, data);
    }
  } catch (error) {
    log.error(`保存存储数据失败: ${key}`, error);
    return false;
  }
}

/**
 * 预定义的存储配置
 */
export const STORAGE_CONFIGS = {
  // 用户相关数据 - 持久存储
  USER: {
    storageType: 'persistent',
    key: 'user',
    paths: [
      'token',
      'userInfo',
      'preferences',
      'connections',
      'favorites',
      'history',
      'pinnedConnections'
    ]
  },

  // 本地连接 - 持久存储
  LOCAL_CONNECTIONS: {
    storageType: 'persistent',
    key: 'local_connections'
  },

  // 会话数据 - 会话存储
  SESSION: {
    storageType: 'session',
    key: 'session'
  },

  // 终端状态 - 会话存储
  TERMINAL: {
    storageType: 'session',
    key: 'terminal'
  },

  // 标签页状态 - 会话存储
  TABS: {
    storageType: 'session',
    key: 'tabs'
  }
};

// 默认导出插件创建函数
export default createStoragePlugin;
