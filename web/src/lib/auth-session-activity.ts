const AUTH_ACTIVITY_KEY = "easyssh_auth_last_activity"
const AUTH_IDLE_EXPIRED_KEY = "easyssh_auth_idle_expired"

function getStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

function readTimestamp(key: string): number | null {
  const raw = getStorage()?.getItem(key)
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

export function getLastAuthActivity(): number | null {
  return readTimestamp(AUTH_ACTIVITY_KEY)
}

export function recordAuthActivity(timestamp = Date.now()): void {
  getStorage()?.setItem(AUTH_ACTIVITY_KEY, String(timestamp))
}

export function markAuthIdleExpired(timestamp = Date.now()): void {
  getStorage()?.setItem(AUTH_IDLE_EXPIRED_KEY, String(timestamp))
}

export function isAuthIdleExpired(): boolean {
  return readTimestamp(AUTH_IDLE_EXPIRED_KEY) !== null
}

export function hasAuthActivityTimedOut(timeoutMinutes: number, now = Date.now()): boolean {
  const lastActivity = getLastAuthActivity()
  return (
    lastActivity !== null &&
    timeoutMinutes > 0 &&
    now - lastActivity >= timeoutMinutes * 60_000
  )
}

export function beginAuthenticatedSession(): void {
  const storage = getStorage()
  storage?.removeItem(AUTH_IDLE_EXPIRED_KEY)
  recordAuthActivity()
}

export function clearAuthenticatedSessionState(): void {
  const storage = getStorage()
  storage?.removeItem(AUTH_ACTIVITY_KEY)
  storage?.removeItem(AUTH_IDLE_EXPIRED_KEY)
}

export const authSessionStorageKeys = {
  activity: AUTH_ACTIVITY_KEY,
  idleExpired: AUTH_IDLE_EXPIRED_KEY,
} as const
