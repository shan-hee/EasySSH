import { resolveAPIErrorMessage } from "@/lib/api-error"
import { getPlatformTransport } from "@/contracts/platform-transport"

/** API 地址；`path` 为 `/api/v1` 之后的路径。 */
export function getApiUrl(path: string = ""): string {
  const baseUrl = getPlatformTransport().apiBaseUrl()
  return path ? `${baseUrl}${path}` : baseUrl
}

/** WebSocket 地址；`path` 为服务端绝对路径，例如 `/api/v1/ssh/terminal/1`。 */
export function getWebSocketUrl(path: string): string {
  return getPlatformTransport().webSocketUrl(path)
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
  // 完整 URL 直接使用，否则拼接平台提供的 API 地址
  const url = path.startsWith("http") ? path : getApiUrl(path)

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

  // 凭据、刷新与账户锁定等认证失效处理由平台传输负责
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
 * openapi-fetch 的底层传输。
 *
 * 只委托平台传输附加凭据，不解析或改写 JSON 响应形状；响应体必须按
 * shared/openapi.yaml 中声明的结构由 openapi-fetch 处理。
 */
export function openapiTransportFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  return getPlatformTransport().fetch(input, init)
}

/**
 * 为 Blob、SSE 等不能使用 apiFetch JSON 解包的请求附加平台凭据。
 */
export function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  return getPlatformTransport().fetch(input, init)
}

/** XHR 等原始请求需要附加的平台认证请求头。 */
export function platformRequestHeaders(method: string): Promise<Record<string, string>> {
  return getPlatformTransport().requestHeaders(method)
}
