/**
 * 宿主平台提供的网络与凭据能力。
 *
 * 共享代码只描述请求；网络地址、会话凭据、CSRF 以及认证失效后的处理由宿主实现：
 * Web 在 `web/src/platform` 注入浏览器实现，桌面接收分享时注入远端实例实现。
 * 未注入时调用会直接报错，避免请求被发往错误的来源。
 */
export interface PlatformTransport {
  /** API 根地址，包含 `/api/v1`。 */
  apiBaseUrl(): string
  /** 由服务端绝对路径（例如 `/api/v1/ssh/terminal/1`）得到 WebSocket 地址。 */
  webSocketUrl(path: string): string
  /** 发送 API 请求并按平台规则附加凭据；不解析或改写响应体。 */
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
  /** XHR 等无法经过 `fetch` 的请求需要附加的认证请求头，例如修改请求的 CSRF 令牌。 */
  requestHeaders(method: string): Promise<Record<string, string>>
  /** 当前是否持有有效会话。 */
  hasCredentials(): boolean
  /** 订阅会话变化，返回取消订阅函数。 */
  subscribeCredentials(listener: () => void): () => void
}

let installedTransport: PlatformTransport | null = null

/** 宿主在挂载应用前注入平台传输。 */
export function installPlatformTransport(transport: PlatformTransport): void {
  installedTransport = transport
}

export function getPlatformTransport(): PlatformTransport {
  if (!installedTransport) {
    throw new Error("Platform transport is not installed")
  }
  return installedTransport
}

export function getOptionalPlatformTransport(): PlatformTransport | null {
  return installedTransport
}
