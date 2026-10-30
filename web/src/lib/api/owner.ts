import { apiFetch } from "@easyssh/app/lib/api-client"
import type { components } from "@easyssh/app/generated/openapi"

type Schemas = components["schemas"]

export type OwnerStatus = Schemas["OwnerStatus"]
export type OwnerPublic = Schemas["OwnerPublic"]
export type OwnerLoginInput = Schemas["OwnerLoginInput"]
export type OwnerLoginResult = Schemas["OwnerLoginResult"]
export type OwnerInitializeInput = Schemas["OwnerInitializeInput"]
export type OwnerProfileInput = Schemas["OwnerProfileInput"]
export type OwnerPasswordInput = Schemas["OwnerPasswordInput"]
export type OwnerTwoFactorSetup = Schemas["OwnerTwoFactorSetup"]
export type OwnerSession = Schemas["OwnerSession"]
export type OwnerNotificationsInput = Schemas["OwnerNotificationsInput"]
export type OwnerMonitorInput = Schemas["OwnerMonitorInput"]
export type PublicBranding = Schemas["PublicBranding"]

/** 实例所有者的会话、资料与安全设置。 */
export const ownerApi = {
  status(): Promise<OwnerStatus> {
    return apiFetch<OwnerStatus>("/owner/status")
  },

  /** 登录前可读的实例名称、Logo 与默认语言。 */
  branding(): Promise<PublicBranding> {
    return apiFetch<PublicBranding>("/public/branding")
  },

  initialize(input: OwnerInitializeInput): Promise<OwnerLoginResult> {
    return apiFetch<OwnerLoginResult>("/owner/initialize", { method: "POST", body: input })
  },

  login(input: OwnerLoginInput): Promise<OwnerLoginResult> {
    return apiFetch<OwnerLoginResult>("/owner/login", { method: "POST", body: input })
  },

  logout(): Promise<void> {
    return apiFetch<void>("/owner/logout", { method: "POST" })
  },

  profile(): Promise<OwnerPublic> {
    return apiFetch<OwnerPublic>("/owner/profile")
  },

  updateProfile(input: OwnerProfileInput): Promise<void> {
    return apiFetch<void>("/owner/profile", { method: "PUT", body: input })
  },

  changePassword(input: OwnerPasswordInput): Promise<void> {
    return apiFetch<void>("/owner/password", { method: "PUT", body: input })
  },

  setupTwoFactor(password: string): Promise<OwnerTwoFactorSetup> {
    return apiFetch<OwnerTwoFactorSetup>("/owner/2fa/setup", { method: "POST", body: { password } })
  },

  /** 启用后返回一次性恢复码，只在此时可见。 */
  async enableTwoFactor(code: string): Promise<string[]> {
    const result = await apiFetch<Schemas["OwnerRecoveryCodes"]>("/owner/2fa/enable", { method: "POST", body: { code } })
    return result.recovery_codes
  },

  disableTwoFactor(code: string): Promise<void> {
    return apiFetch<void>("/owner/2fa/disable", { method: "POST", body: { code } })
  },

  async sessions(): Promise<OwnerSession[]> {
    const result = await apiFetch<Schemas["OwnerSessionList"]>("/owner/sessions")
    return result.items
  },

  revokeSession(sessionId: string): Promise<void> {
    return apiFetch<void>(`/owner/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" })
  },

  revokeOtherSessions(): Promise<void> {
    return apiFetch<void>("/owner/sessions/revoke-others", { method: "POST" })
  },

  updateNotifications(input: OwnerNotificationsInput): Promise<void> {
    return apiFetch<void>("/owner/notifications", { method: "PUT", body: input })
  },
}
