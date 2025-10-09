import log from '@/services/log';

/**
 * 统一本地存储工具（浏览器 localStorage 封装）
 * - 为每个键提供过期时间（TTL）
 * - 可选的内存缓存，减少 JSON 解析与存储读取次数
 * - 统一的键名前缀/命名空间辅助
 * - 周期性清理已过期的存储项
 */
/**
 * 存储全局配置
 * - defaultExpiration: 新写入键的默认过期时间（毫秒）
 * - maxSize: 体积上限（仅用于信息展示，不在此处强制）
 * - cleanupInterval: 后台清理任务的时间间隔（毫秒）
 * - prefix: 默认键名前缀/命名空间
 * - enableMemoryCache: 是否启用内存缓存层
 */
type CacheConfig = {
  defaultExpiration: number;
  maxSize: number;
  cleanupInterval: number;
  prefix: string;
  enableMemoryCache: boolean;
};

const CACHE_CONFIG: CacheConfig = {
  defaultExpiration: 7 * 24 * 60 * 60 * 1000, // 7 days
  maxSize: 5 * 1024 * 1024, // 5 MB (informational)
  cleanupInterval: 30 * 60 * 1000, // 30 minutes
  prefix: 'easyssh:',
  enableMemoryCache: true
};

// 内存缓存结构：key -> { value, timestamp, expiration }
type MemoryEntry = { value: any; timestamp: number; expiration?: number };
const memoryCache = new Map<string, MemoryEntry>();
// 周期清理定时器 id（浏览器环境返回数字）
let cleanupTimer: number | null = null;
// 初始化标记（仅初始化一次）
let isInitialized = false;

export function initStorage(): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    if (isInitialized) return resolve(true);
    try {
      const testKey = '__storage_test__';
      localStorage.setItem(testKey, testKey);
      localStorage.removeItem(testKey);
      startCleanupTimer();
      isInitialized = true;
      resolve(true);
    } catch (e) {
      log.error('存储工具初始化失败', e);
      resolve(false);
    }
  });
}

/**
 * 生成带命名空间的存储键
 * @param {string} key 原始键名
 * @param {string} prefix 指定前缀（可选）
 * @returns {string} 带前缀的键名
 */
function getPrefixedKey(key: string, prefix: string = CACHE_CONFIG.prefix): string {
  return prefix ? `${prefix}${key}` : key;
}

/**
 * 从存储读取值（包含 TTL 与可选内存缓存）
 * @param {string} key 键名
 * @param {any} defaultValue 缺失/过期/解析失败时返回的默认值
 * @param {{usePrefix?:boolean,prefix?:string}} options 选项
 * @returns {any} 读取到的值
 */
export function getFromStorage(
  key: string,
  defaultValue: any = null,
  options: { usePrefix?: boolean; prefix?: string } = {}
) {
  try {
    const { usePrefix = true, prefix } = options;
    const finalKey = usePrefix ? getPrefixedKey(key, prefix) : key;

    if (CACHE_CONFIG.enableMemoryCache && memoryCache.has(finalKey)) {
      const cached = memoryCache.get(finalKey);
      if (cached && (!cached.expiration || cached.expiration > Date.now())) {
        return cached.value;
      }
      memoryCache.delete(finalKey);
    }

    const item = localStorage.getItem(finalKey);
    if (!item) return defaultValue;

    const storageItem = JSON.parse(item) as MemoryEntry;
    if (storageItem.expiration && storageItem.expiration < Date.now()) {
      localStorage.removeItem(finalKey);
      if (CACHE_CONFIG.enableMemoryCache) memoryCache.delete(finalKey);
      return defaultValue;
    }

    if (CACHE_CONFIG.enableMemoryCache) memoryCache.set(finalKey, storageItem);
    return storageItem.value;
  } catch (error) {
    log.error(`获取存储数据失败 [${key}]`, error);
    return defaultValue;
  }
}

/**
 * 将值写入存储（带 TTL，默认使用全局配置）
 * @param {string} key 键名
 * @param {any} value 要写入的值
 * @param {{expiration?:number,usePrefix?:boolean,prefix?:string}} options 选项
 * @returns {boolean} 是否写入成功
 */
export function saveToStorage(
  key: string,
  value: any,
  options: { expiration?: number; usePrefix?: boolean; prefix?: string } = {}
): boolean {
  try {
    const { expiration = CACHE_CONFIG.defaultExpiration, usePrefix = true, prefix } = options;
    const finalKey = usePrefix ? getPrefixedKey(key, prefix) : key;
    const now = Date.now();
    const storageItem: MemoryEntry = { value, timestamp: now, expiration: now + expiration };

    localStorage.setItem(finalKey, JSON.stringify(storageItem));
    if (CACHE_CONFIG.enableMemoryCache) memoryCache.set(finalKey, storageItem);
    if (!cleanupTimer) startCleanupTimer();
    return true;
  } catch (error) {
    log.error(`存储数据失败 [${key}]`, error);
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      cleanupExpiredItems();
      try {
        return saveToStorage(key, value, options);
      } catch (retryError) {
        log.error(`重试存储失败 [${key}]`, retryError);
      }
    }
    return false;
  }
}

/**
 * 删除存储项（同时清理内存缓存）
 */
export function removeFromStorage(
  key: string,
  options: { usePrefix?: boolean; prefix?: string } = {}
): boolean {
  try {
    const { usePrefix = true, prefix } = options;
    const finalKey = usePrefix ? getPrefixedKey(key, prefix) : key;
    localStorage.removeItem(finalKey);
    if (CACHE_CONFIG.enableMemoryCache) memoryCache.delete(finalKey);
    return true;
  } catch (error) {
    log.error(`删除存储数据失败 [${key}]`, error);
    return false;
  }
}

/**
 * 清空存储；可选择仅清理指定前缀的数据
 */
export function clearStorage(options: { onlyPrefixed?: boolean; prefix?: string } = {}): boolean {
  try {
    const { onlyPrefixed = false, prefix = CACHE_CONFIG.prefix } = options;
    if (onlyPrefixed) {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) keysToRemove.push(k);
      }
      keysToRemove.forEach(k => {
        localStorage.removeItem(k);
        if (CACHE_CONFIG.enableMemoryCache) memoryCache.delete(k);
      });
    } else {
      localStorage.clear();
      if (CACHE_CONFIG.enableMemoryCache) memoryCache.clear();
    }
    return true;
  } catch (error) {
    log.error('清空存储失败', error);
    return false;
  }
}

/**
 * 计算存储占用信息（数量与体积估算）
 * @returns {{itemCount:number,totalSize:number,totalSizeKB:number,maxSize:number,usagePercent:number}|null}
 */
export function getStorageInfo():
  | { itemCount: number; totalSize: number; totalSizeKB: number; maxSize: number; usagePercent: number }
  | null {
  try {
    let totalSize = 0;
    let itemCount = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const v = localStorage.getItem(k);
      if (v) {
        totalSize += v.length;
        itemCount++;
      }
    }
    return {
      itemCount,
      totalSize,
      totalSizeKB: Math.round(totalSize / 1024),
      maxSize: CACHE_CONFIG.maxSize,
      usagePercent: Math.round((totalSize / CACHE_CONFIG.maxSize) * 100)
    };
  } catch (error) {
    log.error('获取存储信息失败', error);
    return null;
  }
}

/**
 * 清理已过期的本地存储项与内存缓存
 * @returns {number} 删除数量
 */
export function cleanupExpiredItems(): number {
  try {
    const now = Date.now();
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      try {
        const item = localStorage.getItem(k);
        if (item) {
          const storageItem = JSON.parse(item) as MemoryEntry;
          if (storageItem.expiration && storageItem.expiration < now) keysToRemove.push(k);
        }
      } catch (_) {
        continue;
      }
    }
    keysToRemove.forEach(k => {
      localStorage.removeItem(k);
      memoryCache.delete(k);
    });
    for (const [k, it] of memoryCache.entries()) {
      if (it.expiration && it.expiration < now) memoryCache.delete(k);
    }
    log.info(`清理了 ${keysToRemove.length} 个过期存储项`);
    return keysToRemove.length;
  } catch (error) {
    log.error('清理过期存储项失败', error);
    return 0;
  }
}

/**
 * 启动周期清理定时器
 */
function startCleanupTimer(): void {
  if (cleanupTimer) window.clearInterval(cleanupTimer);
  cleanupTimer = window.setInterval(() => cleanupExpiredItems(), CACHE_CONFIG.cleanupInterval);
}

/**
 * 停止周期清理定时器
 */
export function stopCleanupTimer(): void {
  if (cleanupTimer) {
    window.clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

/**
 * 判断键是否存在且未过期
 */
export function hasValidKey(
  key: string,
  options: { usePrefix?: boolean; prefix?: string } = {}
): boolean {
  try {
    const { usePrefix = true, prefix } = options;
    const finalKey = usePrefix ? getPrefixedKey(key, prefix) : key;
    const item = localStorage.getItem(finalKey);
    if (!item) return false;
    const storageItem = JSON.parse(item) as MemoryEntry;
    return !storageItem.expiration || storageItem.expiration > Date.now();
  } catch (_) {
    return false;
  }
}

/**
 * 获取所有存储键名；支持仅返回指定前缀与去除前缀
 */
export function getAllKeys(
  options: { onlyPrefixed?: boolean; prefix?: string; stripPrefix?: boolean } = {}
): string[] {
  try {
    const { onlyPrefixed = false, prefix = CACHE_CONFIG.prefix, stripPrefix = false } = options;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (onlyPrefixed) {
        if (k.startsWith(prefix)) keys.push(stripPrefix ? k.substring(prefix.length) : k);
      } else {
        keys.push(k);
      }
    }
    return keys;
  } catch (error) {
    log.error('获取存储键名失败', error);
    return [];
  }
}

/**
 * 生成基于指定命名空间前缀的便捷实例
 */
export function createPrefixedStorage(prefix: string) {
  return {
    get: (k: string, def?: any) => getFromStorage(k, def, { prefix }),
    set: (k: string, v: any, o: { expiration?: number; usePrefix?: boolean; prefix?: string } = {}) =>
      saveToStorage(k, v, { ...o, prefix }),
    remove: (k: string) => removeFromStorage(k, { prefix }),
    clear: () => clearStorage({ onlyPrefixed: true, prefix }),
    has: (k: string) => hasValidKey(k, { prefix }),
    keys: () => getAllKeys({ onlyPrefixed: true, prefix, stripPrefix: true })
  };
}

// 浏览器环境下自动初始化，并在页面卸载时停止定时器
if (typeof window !== 'undefined') {
  initStorage().then(success => {
    if (!success) log.warn('存储工具初始化失败，某些功能可能不可用');
  });
  window.addEventListener('beforeunload', stopCleanupTimer);
}

export default {
  init: initStorage,
  getFromStorage,
  saveToStorage,
  removeFromStorage,
  clearStorage,
  getStorageInfo,
  cleanupExpiredItems,
  stopCleanupTimer,
  hasValidKey,
  getAllKeys,
  createPrefixedStorage,
  config: CACHE_CONFIG
};
