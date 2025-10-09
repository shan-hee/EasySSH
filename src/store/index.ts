import { createPinia } from 'pinia';
import { createStoragePlugin } from '@/plugins/pinia-storage-plugin';

// 创建pinia实例
const pinia = createPinia();

// 使用统一存储持久化插件
// JS 插件缺少类型声明，这里断言为 PiniaPlugin
pinia.use(createStoragePlugin() as any);

export default pinia;
