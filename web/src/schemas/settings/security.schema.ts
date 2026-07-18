import { z } from "zod"

export const workspaceConfigSchema = z.object({
  max_tabs: z
    .number()
    .min(1, "settingsValidation.maxTabsMin")
    .max(200, "settingsValidation.maxTabsMax"),
  inactive_minutes: z
    .number()
    .min(5, "settingsValidation.inactiveMinutesMin")
    .max(1440, "settingsValidation.inactiveMinutesMax"),
  hibernate: z.boolean(),
})

export const loginSessionSchema = z.object({
  session_timeout: z.number().min(5).max(1440),
  remember_login: z.boolean(),
})

export const loginSecuritySchema = z.object({
  login_limit: z.number().min(1).max(100),
  api_limit: z.number().min(10).max(10000),
  two_fa_limit: z.number().min(1).max(20),
  password_pwned_check_enabled: z.boolean(),
})

export const webSecuritySchema = z.object({
  trusted_proxies: z.string().min(1),
  cookie_secure_mode: z.enum(["auto", "always", "never"]),
  cookie_domain: z.string(),
  cookie_same_site: z.enum(["lax", "strict", "none"]),
  csrf_trusted_origins: z.string(),
  content_security_policy: z.string(),
  geoip_database_path: z.string(),
})

// CORS配置 Schema
export const corsConfigSchema = z.object({
  allowed_origins: z.array(z.string().min(1)),
})

// 网络安全配置 Schema (包含 IP 白名单/黑名单)
export const networkSecuritySchema = z.object({
  allowlist_ips: z.string().optional(),
  blocklist_ips: z.string().optional(),
})

// 导出类型
export type WorkspaceConfigFormData = z.infer<typeof workspaceConfigSchema>
export type LoginSessionFormData = z.infer<typeof loginSessionSchema>
export type LoginSecurityFormData = z.infer<typeof loginSecuritySchema>
export type WebSecurityFormData = z.infer<typeof webSecuritySchema>
export type CORSConfigFormData = z.infer<typeof corsConfigSchema>
export type NetworkSecurityFormData = z.infer<typeof networkSecuritySchema>
