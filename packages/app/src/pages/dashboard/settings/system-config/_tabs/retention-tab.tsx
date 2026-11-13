import { RetentionPanel, type RetentionAdapter } from "@/components/settings/retention-panel"
import { settingsApi } from "@/lib/api/settings"

const adapter: RetentionAdapter = {
  load: settingsApi.getRetentionSettings,
  save: async (config) => { await settingsApi.saveRetentionSettings(config) },
  run: settingsApi.runRetention,
  listDeleted: settingsApi.listRecycleBin,
  restoreDeleted: async (id) => { await settingsApi.restoreRecycleBinEntry(id) },
  discardDeleted: settingsApi.deleteRecycleBinEntry,
}

export function RetentionTab() {
  return <RetentionPanel adapter={adapter} />
}
