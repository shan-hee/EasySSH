import * as DesktopBackupService from "../../bindings/github.com/easyssh/easyssh-desktop/internal/app/desktopbackupservice"
import type { InstanceBackupAdapter } from "@easyssh/app/desktop"

type BackupList = Awaited<ReturnType<InstanceBackupAdapter["list"]>>
type BackupRecord = Awaited<ReturnType<InstanceBackupAdapter["create"]>>
type ActivationOperation = Awaited<ReturnType<NonNullable<InstanceBackupAdapter["rollback"]>>>

// 桌面服务以字符串返回状态枚举，值域与实例契约一致。
export function createDesktopBackupRestoreAdapter(): InstanceBackupAdapter {
  return {
    nativeFilePicker: true,
    nativeRestart: true,
    list: async () => await DesktopBackupService.ListInstanceBackups() as BackupList,
    create: async password => await DesktopBackupService.CreateInstanceBackup(password) as BackupRecord,
    upload: async () => await DesktopBackupService.UploadInstanceBackup() as BackupRecord | null,
    download: async record => { await DesktopBackupService.DownloadInstanceBackup(record.id) },
    remove: async id => { await DesktopBackupService.DeleteInstanceBackup(id) },
    inspect: async (id, password) => await DesktopBackupService.InspectInstanceBackup(id, password) as BackupRecord,
    restore: async (id, password) => await DesktopBackupService.RestoreInstanceBackup(id, password, true) as BackupRecord,
    activate: async record => await DesktopBackupService.ActivateInstanceBackup(record.id, record.restored_to ?? "", true) as ActivationOperation,
    rollback: async () => await DesktopBackupService.RollbackInstance(true) as ActivationOperation,
  }
}
