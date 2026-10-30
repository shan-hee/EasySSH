import type { AuthStatusResponse } from "@easyssh/app/lib/api/auth"
import { DASHBOARD_PATH } from "../shell/workspace-routes"

export type AuthGatePage = "home" | "login" | "dashboard" | "setup"

export type AuthRedirectDecision =
  | { type: "stay" }
  | { type: "redirect"; href: string }

interface AuthRedirectOptions {
  currentPath?: string | null
}

/** 所有者打开或登录 Web 后先进入仪表盘概览，再由概览进入终端与文件。 */
export const AUTHENTICATED_FALLBACK = DASHBOARD_PATH
const INITIAL_SETUP_PATH = "/setup"

export function getAuthRedirectDecision(
  page: AuthGatePage,
  authStatus: AuthStatusResponse | null,
  options: AuthRedirectOptions = {},
): AuthRedirectDecision {
  if (!authStatus) {
    return page === "login" || page === "setup"
      ? stay()
      : redirect(buildLoginRedirectUrl(options.currentPath))
  }

  if (authStatus.need_init) {
    return page === "setup" ? stay() : redirect(INITIAL_SETUP_PATH)
  }

  if (authStatus.is_authenticated) {
    if (page === "dashboard") {
      return stay()
    }

    const nextPath = page === "login" ? getLoginNextPath(options.currentPath) : null
    return redirect(nextPath ?? AUTHENTICATED_FALLBACK)
  }

  return page === "login"
    ? stay()
    : redirect(buildLoginRedirectUrl(page === "setup" ? null : options.currentPath))
}

export function buildLoginRedirectUrl(nextPath?: string | null): string {
  const params = new URLSearchParams()
  const safeNext = getSafeAuthNextPath(nextPath)

  if (safeNext) {
    params.set("next", safeNext)
  }

  const query = params.toString()
  return query ? `/login?${query}` : "/login"
}

export function getLoginNextPath(loginPath?: string | null): string | null {
  if (!loginPath) {
    return null
  }

  try {
    const url = new URL(loginPath, "http://easyssh.local")
    return getSafeAuthNextPath(url.searchParams.get("next"))
  } catch {
    return null
  }
}

export function getCurrentBrowserPath(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

export function getSafeAuthNextPath(path?: string | null): string | null {
  const safePath = getSafeInternalPath(path)

  if (!safePath || safePath === "/" || isLoginPath(safePath)) {
    return null
  }

  return safePath
}

export function getSafeInternalPath(path?: string | null): string | null {
  if (!path || !path.startsWith("/") || path.startsWith("//")) {
    return null
  }

  return path
}

export function isLoginPath(path?: string | null): boolean {
  if (!path) {
    return false
  }

  try {
    const url = new URL(path, "http://easyssh.local")
    return url.pathname === "/login"
  } catch {
    return path === "/login"
  }
}

function stay(): AuthRedirectDecision {
  return { type: "stay" }
}

function redirect(href: string): AuthRedirectDecision {
  return { type: "redirect", href }
}
