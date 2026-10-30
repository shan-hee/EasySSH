import type { TFunction } from "i18next"
import { isApiError } from "@easyssh/app/lib/api-client"

const AUTH_ERROR_KEYS = {
  invalid_credentials: "errorInvalidCredentials",
  login_temporarily_locked: "errorLoginTemporarilyLocked",
  already_initialized: "errorAlreadyInitialized",
  invalid_request: "errorInvalidRequest",
  invalid_origin: "errorInvalidOrigin",
  internal_error: "errorServiceUnavailable",
} as const satisfies Record<string, string>

export function getAuthErrorCode(error: unknown): string | null {
  if (!isApiError(error) || typeof error.detail !== "object" || error.detail === null) {
    return null
  }

  const code = (error.detail as { error?: unknown }).error
  return typeof code === "string" && code.trim() !== "" ? code : null
}

export function getAuthErrorMessage(
  error: unknown,
  t: TFunction<"auth">,
  fallback: string,
): string {
  const code = getAuthErrorCode(error)
  const key = code && code in AUTH_ERROR_KEYS
    ? AUTH_ERROR_KEYS[code as keyof typeof AUTH_ERROR_KEYS]
    : null
  if (key) {
    return t(key)
  }

  if (isApiError(error)) {
    if (error.status === 429) return t("errorTooFrequent")
    if (error.status >= 500) return t("errorServiceUnavailable")
  }

  return fallback
}
