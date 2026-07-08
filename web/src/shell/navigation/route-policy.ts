import type { AppCapability, RuntimeInfo, RuntimeProfile } from "@/shell/runtime/types"
import { hasAllCapabilities } from "@/shell/runtime/capabilities"

export interface RoutePolicy {
  pattern: RegExp
  requiredCapabilities: AppCapability[]
  profiles?: RuntimeProfile[]
  adminOnly?: boolean
  fallbackPath: string
}

export const routePolicies: RoutePolicy[] = [
  { pattern: /^\/dashboard\/?$/, requiredCapabilities: ["servers"], profiles: ["web"], fallbackPath: "/dashboard/terminal" },
  { pattern: /^\/dashboard\/logs(?:\/|$)/, requiredCapabilities: ["audit"], profiles: ["web"], adminOnly: true, fallbackPath: "/dashboard/terminal" },
  { pattern: /^\/dashboard\/users(?:\/|$)/, requiredCapabilities: ["users"], profiles: ["web"], adminOnly: true, fallbackPath: "/dashboard/terminal" },
  { pattern: /^\/dashboard\/settings(?:\/|$)/, requiredCapabilities: ["settings"], profiles: ["web"], adminOnly: true, fallbackPath: "/dashboard/terminal" },
  { pattern: /^\/dashboard\/automation(?:\/|$)/, requiredCapabilities: ["automation"], profiles: ["web"], fallbackPath: "/dashboard/terminal" },
  { pattern: /^\/dashboard\/operation-logs(?:\/|$)/, requiredCapabilities: ["activity_log"], profiles: ["web"], fallbackPath: "/dashboard/terminal" },
  { pattern: /^\/dashboard\/ai-assistant(?:\/|$)/, requiredCapabilities: ["ai"], fallbackPath: "/dashboard/terminal" },
  { pattern: /^\/dashboard\/scripts(?:\/|$)/, requiredCapabilities: ["scripts"], fallbackPath: "/dashboard/terminal" },
  { pattern: /^\/dashboard\/sftp(?:\/|$)/, requiredCapabilities: ["servers", "terminal", "sftp"], fallbackPath: "/dashboard/terminal" },
  { pattern: /^\/dashboard\/terminal(?:\/|$)/, requiredCapabilities: ["servers", "terminal"], fallbackPath: "/dashboard" },
]

export function getRoutePolicy(pathname: string | null | undefined) {
  if (!pathname) {
    return null
  }

  return routePolicies.find((policy) => policy.pattern.test(pathname)) ?? null
}

export function isRouteAllowed(
  runtime: RuntimeInfo | null | undefined,
  pathname: string | null | undefined,
  isAdmin = false,
) {
  const policy = getRoutePolicy(pathname)
  if (!policy || !runtime) {
    return true
  }
  if (policy.adminOnly && !isAdmin) {
    return false
  }
  if (policy.profiles && !policy.profiles.includes(runtime.profile)) {
    return false
  }

  return hasAllCapabilities(runtime, policy.requiredCapabilities)
}

export function getRouteFallback(
  pathname: string | null | undefined,
  runtime?: RuntimeInfo | null,
  isAdmin = false,
) {
  const policyFallback = getRoutePolicy(pathname)?.fallbackPath
  if (!runtime) {
    return policyFallback ?? "/dashboard"
  }

  const candidates = [
    policyFallback,
    "/dashboard/terminal",
    "/dashboard/ai-assistant",
    "/dashboard/scripts",
    "/dashboard/sftp",
    "/dashboard",
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const candidate of candidates) {
    if (candidate === pathname) {
      continue
    }
    if (isRouteAllowed(runtime, candidate, isAdmin)) {
      return candidate
    }
  }

  return "/dashboard/error"
}
