import type { ComponentType } from "react"
import { preloadNamespaces } from "@/i18n"
import { createPreloadableComponent } from "@/lib/preloadable-component"

function view<Props extends object>(
  titleKey: string,
  load: () => Promise<{ default: ComponentType<Props> }>,
  namespaces: string[],
) {
  const resource = createPreloadableComponent(async () => {
    const [module] = await Promise.all([load(), preloadNamespaces(["common", "desktop", ...namespaces])])
    return module
  })
  return { ...resource, titleKey }
}

export const desktopViews = {
  ai: view("aiAssistantLabel", async () => { const m = await import("./desktop-ai-assistant-view"); return { default: m.DesktopAIAssistantView } }, ["aiAssistant", "accountSettings"]),
  scripts: view("scriptLibraryLabel", async () => { const m = await import("./desktop-scripts-view"); return { default: m.DesktopScriptsView } }, ["scripts", "servers"]),
  "ssh-keys": view("keyPairsLabel", async () => { const m = await import("./desktop-ssh-keys-view"); return { default: m.DesktopSSHKeysView } }, ["accountSettings", "servers"]),
  tasks: view("taskManagementLabel", async () => { const m = await import("./desktop-task-center-view"); return { default: m.DesktopTaskCenterView } }, ["taskCenter"]),
  "activity-logs": view("activityLogLabel", async () => { const m = await import("./desktop-activity-logs-view"); return { default: m.DesktopActivityLogsView } }, ["logsAudit"]),
  "backup-restore": view("backupRestoreLabel", async () => { const m = await import("./desktop-backup-restore-view"); return { default: m.DesktopBackupRestoreView } }, ["settingsManagementBackup"]),
  sync: view("syncSettingsLabel", async () => { const m = await import("./desktop-sync-view"); return { default: m.DesktopSyncView } }, ["settingsManagementBackup"]),
}

export type DesktopContentView = keyof typeof desktopViews
export type DesktopView = "terminal" | DesktopContentView

export function preloadDesktopView(view: DesktopContentView) {
  // A failed speculative load is shown by the content boundary on navigation.
  void desktopViews[view].preload().catch(() => undefined)
}
