import type { TFunction } from "i18next"
import { isApiError } from "@/lib/api-client"

const AUTH_ERROR_KEYS = {
  invalid_credentials: "errorInvalidCredentials",
  account_locked: "errorAccountLocked",
  ip_locked: "errorIpLocked",
  invalid_temp_token: "errorInvalidTempToken",
  invalid_code: "errorInvalidTwoFactorCode",
  invalid_grant: "errorInvalidGrant",
  invalid_client: "errorInvalidClient",
  invalid_request: "errorInvalidRequest",
  validation_error: "errorInvalidRequest",
  unsupported_grant_type: "errorInvalidRequest",
  invalid_token: "errorInvalidToken",
  csrf_token_invalid: "errorCsrfTokenInvalid",
  oauth_disabled: "errorOAuthDisabled",
  oauth_not_configured: "errorOAuthNotConfigured",
  email_not_verified: "errorEmailNotVerified",
  registration_disabled: "errorRegistrationDisabled",
  oauth_account_conflict: "errorOAuthAccountConflict",
  too_frequent: "errorTooFrequent",
  service_unavailable: "errorServiceUnavailable",
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
