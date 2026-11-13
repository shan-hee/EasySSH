import { retentionChoices, type RetentionAdapter, type RetentionDays } from "@easyssh/app/components/settings/retention-panel"
import { DesktopRetentionService, DesktopService } from "../../bindings/github.com/easyssh/easyssh-desktop/internal/app"

// The same keys and fallback as internal/app/desktopretention.go.
const taskKey = "retention.taskDays"
const logKey = "retention.logDays"
const defaultDays: RetentionDays = 90

function days(value: string | undefined): RetentionDays {
  const parsed = Number(value)
  return value !== undefined && value !== "" && (retentionChoices as readonly number[]).includes(parsed) ? parsed as RetentionDays : defaultDays
}

export const desktopRetentionAdapter: RetentionAdapter = {
  async load() {
    const preferences = await DesktopService.ListPreferences()
    return { task_retention_days: days(preferences[taskKey]), log_retention_days: days(preferences[logKey]) }
  },
  async save(config) {
    await DesktopService.SetPreference(taskKey, String(config.task_retention_days))
    await DesktopService.SetPreference(logKey, String(config.log_retention_days))
  },
  async run() {
    return await DesktopRetentionService.Run()
  },
}
