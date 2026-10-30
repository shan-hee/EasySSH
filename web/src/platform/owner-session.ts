import { getApiUrl } from "./config"

type Listener = () => void

let authenticated = false
let csrfToken: string | null = null
let csrfRequest: Promise<string> | null = null
const listeners = new Set<Listener>()

function setAuthenticated(next: boolean) {
  if (authenticated === next) return
  authenticated = next
  listeners.forEach((listener) => listener())
}

/**
 * 浏览器所有者会话。会话令牌只在 HttpOnly Cookie 中；这里记录是否已登录，
 * 并缓存修改请求所需的 CSRF 令牌（同一会话内不变）。
 */
export const ownerSession = {
  isAuthenticated(): boolean {
    return authenticated
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  /** 登录、初始化成功或状态确认已登录后调用；登录响应会直接带回 CSRF 令牌。 */
  begin(csrf?: string) {
    if (csrf) csrfToken = csrf
    setAuthenticated(true)
  },

  end() {
    csrfToken = null
    csrfRequest = null
    setAuthenticated(false)
  },

  /** 返回当前会话的 CSRF 令牌；`refresh` 时向服务端重新读取。会话失效时抛出带 status 的错误。 */
  csrf(refresh = false): Promise<string> {
    if (!refresh && csrfToken) return Promise.resolve(csrfToken)
    csrfRequest ??= fetch(`${getApiUrl()}/owner/csrf`, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw Object.assign(new Error(`CSRF ${response.status}`), { status: response.status })
        }
        const body = await response.json() as { csrf_token: string }
        csrfToken = body.csrf_token
        return body.csrf_token
      })
      .finally(() => {
        csrfRequest = null
      })
    return csrfRequest
  },
}
