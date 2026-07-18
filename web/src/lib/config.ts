import { isViteProd, viteEnv } from "@/lib/vite-env"

/**
 * 统一的环境配置管理
 *
 * 纯 CSR 模式：前端静态文件由 Go 后端托管
 * 浏览器直接访问后端 API，无需代理
 */

/**
 * 开发环境默认后端地址（不包含 /api/v1）
 * - Vite 开发模式读取 VITE_BACKEND_URL
 * - 如需手动修改端口或主机名，可设置 VITE_BACKEND_URL
 */
const DEV_BACKEND_BASE_URL =
  viteEnv.VITE_BACKEND_URL?.trim() || "http://localhost:8520"

/**
 * 获取 API URL (带 /api/v1 路径)
 *
 * 开发模式：使用完整 URL 指向后端服务器
 * 生产模式：使用相对路径（前端由后端托管，同域）
 */
export function getApiUrl(): string {
  if (!isViteProd()) {
    return `${DEV_BACKEND_BASE_URL}/api/v1`
  }
  return '/api/v1'
}

/**
 * 获取 WebSocket Host（仅浏览器端）
 * 开发模式：使用后端服务器地址
 * 生产模式：使用当前页面的 host
 */
export function getWsHost(): string {
  // 开发环境与 API 使用同一个后端地址。
  if (!isViteProd()) {
    try {
      const url = new URL(DEV_BACKEND_BASE_URL)
      return url.host
    } catch {
      // 解析失败时回退到当前页面地址。
    }
  }

  // 生产环境由 Go 后端同源托管前端。
  return window.location.host
}

/**
 * 获取 WebSocket URL
 * 自动根据当前协议选择 ws:// 或 wss://
 * 纯 CSR 模式：直接使用原始路径，无需转换
 */
export function getWsUrl(path: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsHost = getWsHost()

  return `${protocol}//${wsHost}${path}`
}

/**
 * 环境配置对象
 */
export const config = {
  // API URL (带 /api/v1)
  apiUrl: getApiUrl(),

  // 客户端方法
  get wsHost() {
    return getWsHost()
  },

  getWsUrl,
}
