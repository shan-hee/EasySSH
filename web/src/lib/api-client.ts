import { getApiUrl as getApiUrlFromConfig } from "@/lib/config"
import { resolveAPIErrorMessage } from "@/lib/api-error"
import { useAuthStore } from "@/stores/auth-store"
import {
  ensureFreshAccessToken,
  isTerminalRefreshTokenError,
  refreshAccessToken,
} from "@/lib/session-refresh"
import { clearCSRFToken, ensureCSRFToken, updateCSRFTokenFromHeaders } from "@/lib/csrf"
import {
  buildLockedLoginRedirectUrl,
  buildLoginRedirectUrl,
  getAuthLockInfo,
  getCurrentBrowserPath,
  isLoginPath,
} from "@/lib/auth-redirect"

// 重新导出 getApiUrl 以便其他模块使用
export function getApiUrl(path: string = ""): string {
  const baseUrl = getApiUrlFromConfig()
  return path ? `${baseUrl}${path}` : baseUrl
}

// 全局 401 处理标记，避免重复跳转
let hasRedirectedFor401 = false

/**
 * 重置全局 401 重定向标记
 * - 典型场景: 进入登录页 / 登录成功后，开始新的认证周期
 */
export function resetUnauthorizedRedirectFlag() {
  hasRedirectedFor401 = false
}

function handleGlobalUnauthorized() {
  const currentPath = getCurrentBrowserPath()
  if (isLoginPath(currentPath)) {
    return
  }

  if (hasRedirectedFor401) return
  hasRedirectedFor401 = true
  useAuthStore.getState().clearToken()

  try {
    window.location.href = buildLoginRedirectUrl(currentPath)
  } catch {
    window.location.href = "/login"
  }
}

// 全局账户锁定处理标记，避免重复跳转
let hasRedirectedForLocked = false

/**
 * 重置全局账户锁定重定向标记
 */
export function resetAccountLockedRedirectFlag() {
  hasRedirectedForLocked = false
}

function handleAccountLocked(detail: unknown) {
  const currentPath = getCurrentBrowserPath()
  // 已在登录页时收到锁定错误，忽略
  if (isLoginPath(currentPath)) {
    return
  }

  if (hasRedirectedForLocked) return
  hasRedirectedForLocked = true
  useAuthStore.getState().clearToken()

  try {
    window.location.href = buildLockedLoginRedirectUrl(getAuthLockInfo(detail), currentPath)
  } catch {
    window.location.href = "/login?locked=true"
  }
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

/**
 * API 错误类型
 */
export interface ApiError extends Error {
  status: number
  detail: unknown
}

/**
 * 类型守卫:检查是否为 ApiError
 */
export function isApiError(error: unknown): error is ApiError {
  return (
    error instanceof Error &&
    'status' in error &&
    typeof (error as ApiError).status === 'number'
  )
}

function shouldOmitAuthHeader(url: string): boolean {
  return (
    url.includes("/oauth/authorize") ||
    url.includes("/oauth/token") ||
    url.includes("/oauth/google/verify")
  )
}

function getURLPathname(url: string): string {
  try {
    return new URL(url, "http://easyssh.local").pathname
  } catch {
    return url
  }
}

function getCanonicalAPIPath(url: string): string {
  const pathname = getURLPathname(url)
  const apiPrefixIndex = pathname.indexOf("/api/v1/")
  return apiPrefixIndex >= 0
    ? pathname.slice(apiPrefixIndex + "/api/v1".length)
    : pathname
}

function isAuthCredentialEndpoint(url: string): boolean {
  const pathname = getCanonicalAPIPath(url)
  return (
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/oauth/") ||
    pathname.startsWith("/users/me/oauth/")
  )
}

function matchesEndpoint(url: string, endpoint: string): boolean {
  return getCanonicalAPIPath(url) === endpoint
}

function requiresCSRFToken(url: string, method: HttpMethod): boolean {
  if (method === "GET") return false

  return (
    matchesEndpoint(url, "/oauth/token") ||
    matchesEndpoint(url, "/oauth/logout") ||
    matchesEndpoint(url, "/oauth/google/verify") ||
    matchesEndpoint(url, "/users/me/oauth/google/link")
  )
}

function shouldHandleUnauthorizedGlobally(url: string): boolean {
  return !(
    url.includes("/oauth/authorize") ||
    url.includes("/oauth/token") ||
    url.includes("/oauth/google/verify") ||
    url.includes("/auth/2fa/verify") ||
    url.includes("/auth/status")
  )
}

function shouldHandleAccountLockedGlobally(url: string): boolean {
  return !(
    url.includes("/oauth/google/verify") ||
    url.includes("/users/me/oauth/google/link")
  )
}

type ApiFetchOptions = {
  method?: HttpMethod
  headers?: HeadersInit
  body?: unknown
  signal?: AbortSignal
  timeout?: number // 超时时间(毫秒),默认 30000ms
  retry?: boolean // 是否启用重试,默认 true
  maxRetries?: number // 最大重试次数,默认 3
}

/**
 * 延迟函数
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 判断错误是否可重试
 */
function isRetryableError(error: unknown): boolean {
  if (isApiError(error)) {
    // 5xx 服务器错误可重试
    return error.status >= 500 && error.status < 600
  }
  // 网络错误可重试
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return true
  }
  return false
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const {
    timeout = 30000,
    retry = true,
    maxRetries = 3,
    ...fetchOptions
  } = options

  // 实现重试逻辑
  let lastError: unknown
  const method = fetchOptions.method ?? "GET"
  const attempts = retry && method === "GET" ? Math.max(1, maxRetries + 1) : 1

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await apiFetchInternal<T>(path, { ...fetchOptions, timeout })
    } catch (error) {
      lastError = error

      // 最后一次尝试或不可重试的错误,直接抛出
      if (attempt === attempts - 1 || !isRetryableError(error)) {
        throw error
      }

      // 指数退避: 2^attempt * 1000ms (1s, 2s, 4s...)
      const backoffMs = Math.pow(2, attempt) * 1000 + Math.floor(Math.random() * 250)
      console.warn(`[apiFetch] Retry ${attempt + 1}/${maxRetries} after ${backoffMs}ms`, error)
      await sleep(backoffMs)
    }
  }

  throw lastError
}

async function apiFetchInternal<T>(path: string, options: Omit<ApiFetchOptions, 'retry' | 'maxRetries'> = {}): Promise<T> {
  // 构建请求URL
  // 如果path是完整URL则直接使用
  // 否则使用统一的API URL配置
  let url: string
  if (path.startsWith("http")) {
    url = path
  } else {
    const apiUrl = getApiUrl()
    url = `${apiUrl}${path}`
  }

  const headers: HeadersInit = {
    Accept: "application/json",
    ...options.headers,
  }
  const method = options.method ?? "GET"

  const signals: AbortSignal[] = []
  if (options.signal) signals.push(options.signal)
  if (options.timeout) signals.push(AbortSignal.timeout(options.timeout))
  const signal = signals.length > 1
    ? AbortSignal.any(signals)
    : signals[0]

  const init: RequestInit = {
    method,
    headers,
    signal,
  }

  if (options.body !== undefined && options.body !== null) {
    if (typeof options.body === "string" || options.body instanceof FormData) {
      init.body = options.body as string | FormData
    } else {
      ;(headers as Record<string, string>)["Content-Type"] = "application/json"
      init.body = JSON.stringify(options.body)
    }
  }

  const res = await openapiTransportFetch(url, init)

  if (!res.ok) {
    const contentType = res.headers.get("content-type") || ""
    let detail: unknown
    try {
      if (contentType.includes("application/json")) {
        detail = await res.json()
      } else {
        detail = await res.text()
      }
    } catch {
      detail = "Failed to parse error response"
    }

    if (
      shouldHandleAccountLockedGlobally(url) &&
      res.status === 403 &&
      typeof detail === 'object' &&
      detail !== null
    ) {
      const errorDetail = detail as { error?: string }
      if (errorDetail.error === 'account_locked') {
        handleAccountLocked(detail)
      }
    }

    const fallbackMessage = `API ${res.status} ${res.statusText}`
    throw Object.assign(new Error(resolveAPIErrorMessage(detail, fallbackMessage)), {
      status: res.status,
      detail,
    })
  }

  const contentType = res.headers.get("content-type") || ""
  if (contentType.includes("application/json")) {
    return await res.json() as T
  }
  return (await res.text()) as unknown as T
}

/**
 * openapi-fetch 的底层传输实现。
 *
 * 这里仅负责浏览器级横切能力，不解析或改写 JSON 响应形状；响应体必须按
 * shared/openapi.yaml 中声明的结构由 openapi-fetch 处理。
 */
export async function openapiTransportFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const sourceRequest = input instanceof Request ? input : undefined
  const url = sourceRequest?.url ?? String(input)
  const method = (init.method?.toUpperCase() ?? sourceRequest?.method ?? "GET") as HttpMethod

  const request = async (): Promise<Response> => {
    const headers = new Headers(sourceRequest?.headers)
    new Headers(init.headers).forEach((value, key) => headers.set(key, value))
    if (!headers.has("Accept")) {
      headers.set("Accept", "application/json")
    }

    if (requiresCSRFToken(url, method)) {
      headers.set("X-CSRF-Token", await ensureCSRFToken(getApiUrl()))
    }

    if (!shouldOmitAuthHeader(url) && !headers.has("Authorization")) {
      const token = useAuthStore.getState().accessToken
      if (token) {
        headers.set("Authorization", `Bearer ${token}`)
      }
    }

    const credentials: RequestCredentials = isAuthCredentialEndpoint(url)
      ? "include"
      : (init.credentials ?? sourceRequest?.credentials ?? "same-origin")
    const timeoutSignal = AbortSignal.timeout(30_000)
    const sourceSignal = init.signal ?? sourceRequest?.signal
    const signal = sourceSignal
      ? AbortSignal.any([sourceSignal, timeoutSignal])
      : timeoutSignal
    const response = await fetch(input, {
      ...init,
      method,
      headers,
      credentials,
      signal,
    })
    updateCSRFTokenFromHeaders(response.headers, { trusted: credentials === "include" })
    return response
  }

  let response = await request()

  if (method !== "GET" && requiresCSRFToken(url, method) && response.status === 403) {
    const detail = await response.clone().json().catch(() => null)
    if (
      detail &&
      typeof detail === "object" &&
      "error" in detail &&
      (detail as { error?: string }).error === "csrf_token_invalid"
    ) {
      clearCSRFToken()
      response = await request()
    }
  }

  if (response.status === 401 && shouldHandleUnauthorizedGlobally(url)) {
    try {
      await refreshAccessToken()
    } catch (refreshError) {
      if (isTerminalRefreshTokenError(refreshError)) {
        handleGlobalUnauthorized()
      }
      throw refreshError
    }
    response = await request()
    if (response.status === 401) {
      handleGlobalUnauthorized()
    }
  }

  if (response.status === 403 && shouldHandleAccountLockedGlobally(url)) {
    const detail = await response.clone().json().catch(() => null)
    if (
      detail &&
      typeof detail === "object" &&
      "error" in detail &&
      (detail as { error?: string }).error === "account_locked"
    ) {
      handleAccountLocked(detail)
    }
  }

  return response
}

interface AuthenticatedFetchOptions {
  minValidityMs?: number
  retryUnauthorized?: boolean
}

/**
 * 为 Blob、SSE 等不能使用 apiFetch JSON 解包的请求提供统一鉴权。
 */
export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: AuthenticatedFetchOptions = {},
): Promise<Response> {
  const {
    minValidityMs = 30_000,
    retryUnauthorized = true,
  } = options

  try {
    await ensureFreshAccessToken(minValidityMs)
  } catch (refreshError) {
    if (isTerminalRefreshTokenError(refreshError)) {
      handleGlobalUnauthorized()
    }
    throw refreshError
  }

  const request = () => {
    const headers = new Headers(init.headers)
    const token = useAuthStore.getState().accessToken
    if (token) {
      headers.set("Authorization", `Bearer ${token}`)
    }
    if (!headers.has("Accept")) {
      headers.set("Accept", "application/json")
    }

    return fetch(input, {
      ...init,
      headers,
      credentials: init.credentials ?? "same-origin",
    })
  }

  let response = await request()
  if (response.status === 401 && retryUnauthorized) {
    try {
      await refreshAccessToken()
    } catch (refreshError) {
      if (isTerminalRefreshTokenError(refreshError)) {
        handleGlobalUnauthorized()
      }
      throw refreshError
    }

    response = await request()
    if (response.status === 401) {
      handleGlobalUnauthorized()
    }
  }

  if (response.status === 403 && shouldHandleAccountLockedGlobally(String(input))) {
    const detail = await response.clone().json().catch(() => null)
    if (
      detail &&
      typeof detail === "object" &&
      "error" in detail &&
      (detail as { error?: string }).error === "account_locked"
    ) {
      handleAccountLocked(detail)
    }
  }

  return response
}
