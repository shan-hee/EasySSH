import { RetentionPanel, type RetentionAdapter } from "@/components/settings/retention-panel"
import { settingsApi } from "@/lib/api/settings"

const adapter: RetentionAdapter = {
  load: settingsApi.getRetentionSettings,
  save: async (config) => { await settingsApi.saveRetentionSettings(config) },
  run: settingsApi.runRetention,
}

export function RetentionTab() {
  return <RetentionPanel adapter={adapter} />
}
