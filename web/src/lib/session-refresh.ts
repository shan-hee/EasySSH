import { useAuthStore } from "@/stores/auth-store"
import { getApiUrl } from "@/lib/config"
import { clearCSRFToken, ensureCSRFToken, updateCSRFTokenFromHeaders } from "@/lib/csrf"

export interface RefreshTokenResult {
  accessToken: string
  expiresIn: number
}

export class RefreshTokenError extends Error {
  status: number
  detail: unknown

  constructor(status: number, detail: unknown) {
    super(`Refresh failed: ${status}`)
    this.name = "RefreshTokenError"
    this.status = status
    this.detail = detail
  }
}

export class SessionRefreshSuspendedError extends Error {
  constructor() {
    super("Session refresh is suspended")
    this.name = "SessionRefreshSuspendedError"
  }
}

let refreshPromise: Promise<RefreshTokenResult> | null = null
let refreshSuspended = false

export function isRefreshTokenError(error: unknown): error is RefreshTokenError {
  return error instanceof RefreshTokenError
}

async function readResponseDetail(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") || ""
  try {
    return contentType.includes("application/json")
      ? await response.json()
      : await response.text()
  } catch {
    return null
  }
}

async function requestRefreshToken(): Promise<RefreshTokenResult> {

  // 统一走 API 前缀 /api/v1，后端在 /api/v1/oauth/token 暴露刷新端点
  const apiBase = getApiUrl()
  const url = `${apiBase}/oauth/token`
  const requestRefresh = async () => {
    const csrfToken = await ensureCSRFToken(apiBase)
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({ grant_type: "refresh_token" }),
      credentials: "include",
    })
    updateCSRFTokenFromHeaders(res.headers, { trusted: true })
    return res
  }

  let res = await requestRefresh()
  if (res.status === 403) {
    const detail = await res.clone().json().catch(() => null)
    if (
      detail &&
      typeof detail === "object" &&
      "error" in detail &&
      (detail as { error?: string }).error === "csrf_token_invalid"
    ) {
      clearCSRFToken()
      res = await requestRefresh()
    }
  }

  if (!res.ok) {
    throw new RefreshTokenError(res.status, await readResponseDetail(res))
  }

  const json = (await res.json()) as
    | { access_token?: string; expires_in?: number }
    | { data?: { access_token?: string; expires_in?: number } }

  const payload =
    json && typeof json === "object" && "data" in json && json.data
      ? json.data!
      : (json as { access_token?: string; expires_in?: number })

  if (!payload.access_token) {
    throw new RefreshTokenError(500, {
      error: "invalid_refresh_response",
      message: "Missing access_token in refresh response",
    })
  }

  const expiresIn =
    typeof payload.expires_in === "number" ? payload.expires_in : 0

  useAuthStore.getState().setToken(payload.access_token, expiresIn)

  return {
    accessToken: payload.access_token,
    expiresIn,
  }
}

/**
 * 唯一的 refresh_token 刷新入口。
 * 同一页面内的启动恢复、定时刷新和并发 401 共用一个请求。
 */
export async function refreshAccessToken(): Promise<RefreshTokenResult> {
  if (refreshSuspended) {
    throw new SessionRefreshSuspendedError()
  }

  if (refreshPromise) {
    return refreshPromise
  }

  refreshPromise = requestRefreshToken()
  try {
    return await refreshPromise
  } finally {
    refreshPromise = null
  }
}

/**
 * 阻止新的刷新请求，并等待已经在途的刷新结束。
 * 用于登出，避免刷新响应在登出清 Cookie 后再次写回认证 Cookie。
 */
export async function suspendSessionRefresh(): Promise<void> {
  refreshSuspended = true
  const activeRefresh = refreshPromise
  if (!activeRefresh) return
  try {
    await activeRefresh
  } catch {
    // 登出仍应继续；刷新失败不改变暂停状态。
  }
}

export function resumeSessionRefresh(): void {
  refreshSuspended = false
}

/**
 * 确保当前 Access Token 在指定时间窗口内仍然有效。
 * 无法判断过期时间时沿用现有 token；没有 token 或临近过期时统一刷新。
 */
export async function ensureFreshAccessToken(minValidityMs = 30_000): Promise<string> {
  const { accessToken, expiresAt } = useAuthStore.getState()
  if (
    accessToken &&
    (expiresAt === null || expiresAt - Date.now() > minValidityMs)
  ) {
    return accessToken
  }

  const result = await refreshAccessToken()
  return result.accessToken
}
