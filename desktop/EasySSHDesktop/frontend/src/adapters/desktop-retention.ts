import { retentionChoices, type RecycleBinEntry, type RetentionAdapter, type RetentionDays } from "@easyssh/app/components/settings/retention-panel"
import { DesktopRetentionService, DesktopService } from "../../bindings/github.com/easyssh/easyssh-desktop/internal/app"

// The same keys and fallback as internal/app/desktopretention.go.
const taskKey = "retention.taskDays"
const logKey = "retention.logDays"
const deletedKey = "retention.deletedDays"

function days(value: string | undefined, fallback: RetentionDays): RetentionDays {
  const parsed = Number(value)
  return value !== undefined && value !== "" && (retentionChoices as readonly number[]).includes(parsed) ? parsed as RetentionDays : fallback
}

export const desktopRetentionAdapter: RetentionAdapter = {
  async load() {
    const preferences = await DesktopService.ListPreferences()
    return {
      task_retention_days: days(preferences[taskKey], 90),
      log_retention_days: days(preferences[logKey], 90),
      deleted_retention_days: days(preferences[deletedKey], 30),
    }
  },
  async save(config) {
    await DesktopService.SetPreference(taskKey, String(config.task_retention_days))
    await DesktopService.SetPreference(logKey, String(config.log_retention_days))
    await DesktopService.SetPreference(deletedKey, String(config.deleted_retention_days))
  },
  async run() {
    return await DesktopRetentionService.Run()
  },
  async listDeleted() {
    return await DesktopRetentionService.ListRecycleBin() as RecycleBinEntry[]
  },
  async restoreDeleted(id) {
    await DesktopRetentionService.RestoreRecycleBinEntry(id)
    // Restored servers, scripts and conversations appear in views outside this panel.
    window.dispatchEvent(new Event("easyssh:sync-applied"))
  },
  async discardDeleted(id) {
    await DesktopRetentionService.DeleteRecycleBinEntry(id)
  },
}
