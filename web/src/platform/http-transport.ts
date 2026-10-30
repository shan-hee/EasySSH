import type { PlatformTransport } from "@easyssh/app/contracts/platform-transport"
import { getApiUrl, getWsUrl } from "./config"
import { ownerSession } from "./owner-session"
import { buildLoginRedirectUrl, getCurrentBrowserPath, isLoginPath } from "./auth-redirect"

/** 无需所有者会话的接口：不附加 CSRF，401 由调用方按业务错误处理。 */
const PUBLIC_PATHS = new Set(["/owner/status", "/owner/login", "/owner/initialize", "/owner/csrf", "/public/branding"])

/** 会话缺失、过期或 CSRF 不匹配时服务端返回的错误码。 */
const SESSION_ENDED_ERRORS = new Set(["owner_authentication_required", "invalid_access"])

/** 认证失效时不跳转登录页的页面。 */
const UNAUTHORIZED_EXEMPT_PAGES = new Set(["/setup", "/instance-restart"])

let redirectingToLogin = false

/** 同源 API 请求返回 `/api/v1` 之后的路径；其他地址返回 null，不附加会话凭据。 */
function sameOriginAPIPath(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.origin)
    if (parsed.origin !== window.location.origin) return null
    const base = getApiUrl()
    return parsed.pathname.startsWith(`${base}/`) ? parsed.pathname.slice(base.length) : null
  } catch {
    return null
  }
}

function isMutation(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS"
}

async function sessionEnded(response: Response): Promise<boolean> {
  if (response.status !== 401) return false
  const detail = await response.clone().json().catch(() => null) as { error?: unknown } | null
  return typeof detail?.error === "string" && SESSION_ENDED_ERRORS.has(detail.error)
}

function handleSessionEnded() {
  ownerSession.end()
  const currentPath = getCurrentBrowserPath()
  if (UNAUTHORIZED_EXEMPT_PAGES.has(window.location.pathname) || isLoginPath(currentPath) || redirectingToLogin) return
  redirectingToLogin = true
  window.location.href = buildLoginRedirectUrl(currentPath)
}

/**
 * 浏览器 API 请求：会话由 HttpOnly Cookie 承载，修改请求附加 CSRF 令牌。
 * CSRF 失效时重新读取一次并重试；会话结束时跳转登录页。不解析或改写响应体。
 */
async function browserFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const sourceRequest = input instanceof Request ? input : undefined
  const method = (init.method ?? sourceRequest?.method ?? "GET").toUpperCase()
  const path = sameOriginAPIPath(sourceRequest?.url ?? String(input))
  const ownerRoute = path !== null && !PUBLIC_PATHS.has(path)
  const needsCSRF = ownerRoute && isMutation(method)
  // 流式请求体只能发送一次，不能在刷新 CSRF 后重试。
  const replayable = !sourceRequest && !(init.body instanceof ReadableStream)

  const send = (csrf: string | undefined) => {
    const headers = new Headers(sourceRequest?.headers)
    new Headers(init.headers).forEach((value, key) => headers.set(key, value))
    if (!headers.has("Accept")) headers.set("Accept", "application/json")
    if (csrf) headers.set("X-CSRF-Token", csrf)
    return fetch(input, { ...init, method, headers, credentials: "same-origin" })
  }

  const csrf = needsCSRF ? await ownerSession.csrf().catch(() => undefined) : undefined
  let response = await send(csrf)
  if (!ownerRoute || !(await sessionEnded(response))) return response

  if (needsCSRF && replayable) {
    const fresh = await ownerSession.csrf(true).catch(() => undefined)
    if (fresh && fresh !== csrf) {
      response = await send(fresh)
      if (!(await sessionEnded(response))) return response
    }
  }
  handleSessionEnded()
  return response
}

/** 浏览器所有者会话的平台传输。 */
export const browserTransport: PlatformTransport = {
  apiBaseUrl: getApiUrl,
  webSocketUrl: getWsUrl,
  fetch: browserFetch,
  requestHeaders: async (method): Promise<Record<string, string>> => (
    isMutation(method.toUpperCase()) ? { "X-CSRF-Token": await ownerSession.csrf() } : {}
  ),
  hasCredentials: ownerSession.isAuthenticated,
  subscribeCredentials: ownerSession.subscribe,
}
