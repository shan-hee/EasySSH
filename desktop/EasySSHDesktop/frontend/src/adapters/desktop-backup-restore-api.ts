import { Call } from "@wailsio/runtime"
import type { InstanceBackupAdapter } from "@easyssh/ssh-workspace/desktop"

export function createDesktopBackupRestoreAdapter(): InstanceBackupAdapter {
  return {
    nativeFilePicker: true,
    nativeRestart: true,
    list: () => Call.ByName("main.DesktopBackupService.ListInstanceBackups"),
    create: password => Call.ByName("main.DesktopBackupService.CreateInstanceBackup", password),
    upload: () => Call.ByName("main.DesktopBackupService.UploadInstanceBackup"),
    download: async record => { await Call.ByName("main.DesktopBackupService.DownloadInstanceBackup", record.id) },
    remove: async id => { await Call.ByName("main.DesktopBackupService.DeleteInstanceBackup", id) },
    inspect: (id, password) => Call.ByName("main.DesktopBackupService.InspectInstanceBackup", id, password),
    restore: (id, password) => Call.ByName("main.DesktopBackupService.RestoreInstanceBackup", id, password, true),
    activate: record => Call.ByName("main.DesktopBackupService.ActivateInstanceBackup", record.id, record.restored_to, true),
    rollback: () => Call.ByName("main.DesktopBackupService.RollbackInstance", true),
  }
}
