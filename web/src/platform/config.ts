/**
 * Web 前端与 API 同源：生产由 Go 服务托管静态文件，开发经 Vite 代理转发 /api。
 */
export function getApiUrl(): string {
  return "/api/v1"
}

/** 由服务端绝对路径得到同源 WebSocket 地址。 */
export function getWsUrl(path: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${protocol}//${window.location.host}${path}`
}
