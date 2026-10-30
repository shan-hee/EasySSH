import { InstanceBackupPanel, webInstanceBackupAdapter, type InstanceBackupAdapter } from "./instance-backup-panel"

export function BackupRestoreTab({
  adapter = webInstanceBackupAdapter,
}: {
  adapter?: InstanceBackupAdapter
} = {}) {
  return (
    <div className="min-w-0 p-4">
      <InstanceBackupPanel adapter={adapter} />
    </div>
  )
}
