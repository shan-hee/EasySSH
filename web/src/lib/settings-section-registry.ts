import { createPreloadableComponent } from "@/lib/preloadable-component"
import { preloadNamespaces } from "@/i18n"
import type { ComponentType } from "react"

function section(load: () => Promise<{ default: ComponentType }>, namespaces: string[]) {
  return createPreloadableComponent(async () => {
    const [module] = await Promise.all([load(), preloadNamespaces(["settingsCommon", "settingsValidation", ...namespaces])])
    return module
  })
}

export const settingsSections = {
  basic: section(() => import("@/pages/dashboard/settings/system-config/_tabs/basic-tab").then(m => ({ default: m.BasicTab })), ["settingsSystemBasic"]),
  authentication: section(() => import("@/pages/dashboard/settings/security-center/_tabs/authentication-tab").then(m => ({ default: m.AuthenticationTab })), ["settingsAuthentication"]),
  "access-control": section(() => import("@/pages/dashboard/settings/security-center/_tabs/access-control-tab").then(m => ({ default: m.AccessControlTab })), ["settingsSecurityAccess"]),
  workspace: section(() => import("@/pages/dashboard/settings/security-center/_tabs/workspace-tab").then(m => ({ default: m.WorkspaceTab })), ["settingsWorkspace"]),
  "scheduled-tasks": section(() => import("@/pages/dashboard/settings/system-config/_tabs/scheduled-tasks-tab").then(m => ({ default: m.ScheduledTasksTab })), ["settingsScheduledTasks"]),
  network: section(() => import("@/pages/dashboard/settings/security-center/_tabs/network-security-tab").then(m => ({ default: m.NetworkSecurityTab })), ["settingsNetworkDeployment"]),
  "file-transfer": section(() => import("@/pages/dashboard/settings/system-config/_tabs/file-transfer-tab").then(m => ({ default: m.FileTransferTab })), ["settingsSystemFileTransfer"]),
  "ai-config": section(() => import("@/pages/dashboard/settings/integrations/_tabs/ai-config-wrapper").then(m => ({ default: m.AIConfigWrapper })), ["settingsIntegrationsAI"]),
  "notification-config": section(() => import("@/pages/dashboard/settings/integrations/_tabs/notification-config-wrapper").then(m => ({ default: m.NotificationConfigWrapper })), ["settingsIntegrationsEmail", "settingsIntegrationsWebhook", "settingsIntegrationsDingTalk", "settingsIntegrationsWeCom"]),
  backup: section(() => import("@/components/settings/backup-restore-tab").then(m => ({ default: m.BackupRestoreTab })), ["settingsManagementBackup"]),
}

export type SettingsSectionId = keyof typeof settingsSections
export function getSettingsSection(url: string) {
  const requested = new URLSearchParams(url.split("?", 2)[1]).get("section") || "basic"
  return Object.hasOwn(settingsSections, requested) ? settingsSections[requested as SettingsSectionId] : settingsSections.basic
}
