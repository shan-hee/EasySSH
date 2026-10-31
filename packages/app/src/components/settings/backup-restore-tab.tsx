import { InstanceBackupPanel, webInstanceBackupAdapter, type InstanceBackupAdapter } from "./instance-backup-panel"

export function BackupRestoreTab({
  adapter = webInstanceBackupAdapter,
  showHeader = true,
}: {
  adapter?: InstanceBackupAdapter
  /** The settings page already titles the section; standalone hosts keep the panel heading. */
  showHeader?: boolean
} = {}) {
  return (
    <div className="min-w-0 p-4">
      <InstanceBackupPanel adapter={adapter} showHeader={showHeader} />
    </div>
  )
}

export function SettingsBackupTab() {
  return <BackupRestoreTab showHeader={false} />
}
