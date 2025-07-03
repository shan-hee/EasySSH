import { createPinia } from 'pinia'
import { createStoragePlugin } from '@/plugins/pinia-storage-plugin'

// 创建pinia实例
const pinia = createPinia()

// 使用统一存储持久化插件
pinia.use(createStoragePlugin())

export default pinia