import type { components } from "@/generated/openapi"

export type RuntimeProfile = "web" | "desktop"

export type AppCapability =
  | "servers"
  | "terminal"
  | "sftp"
  | "transfers"
  | "scripts"
  | "automation"
  | "monitoring"
  | "docker"
  | "ai"
  | "activity_log"
  | "backup"
  | "settings"
  | "audit"
  | "login_logs"
  | "notifications"
  | "security_policy"
  | "desktop_data_dir"
  | "open_data_dir"
  | "portable_mode"

export type RuntimePrincipal = components["schemas"]["RuntimePrincipal"]

export interface RuntimeInfo {
  profile: RuntimeProfile
  principal: RuntimePrincipal
  single_user: boolean
  portable: boolean
  managed: boolean
  data_dir?: string
  version?: string
  capabilities: Partial<Record<AppCapability, boolean>> & Record<string, boolean | undefined>
}
