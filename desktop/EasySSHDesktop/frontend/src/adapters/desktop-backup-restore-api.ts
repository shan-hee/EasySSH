import { Call } from "@wailsio/runtime"
import type { BackupRestoreAdapter } from "@easyssh/ssh-workspace/desktop"
import { DesktopBackupService } from "../../bindings/github.com/easyssh/easyssh-desktop"

export function createDesktopBackupRestoreAdapter(): BackupRestoreAdapter {
  return {
    instanceBackup: {
      nativeFilePicker: true,
      list: () => Call.ByName("main.DesktopBackupService.ListInstanceBackups"),
      create: password => Call.ByName("main.DesktopBackupService.CreateInstanceBackup", password),
      upload: () => Call.ByName("main.DesktopBackupService.UploadInstanceBackup"),
      download: async record => { await Call.ByName("main.DesktopBackupService.DownloadInstanceBackup", record.id) },
      remove: async id => { await Call.ByName("main.DesktopBackupService.DeleteInstanceBackup", id) },
      inspect: (id, password) => Call.ByName("main.DesktopBackupService.InspectInstanceBackup", id, password),
      restore: (id, password) => Call.ByName("main.DesktopBackupService.RestoreInstanceBackup", id, password, true),
    },
    supportsConfig: false,
    supportsSensitive: true,

    async exportBackup(options) {
      const result = await DesktopBackupService.ExportBackup({
        include_config: false,
        include_database: options.include_database,
        include_sensitive: Boolean(options.include_sensitive),
        age_passphrase: options.age_passphrase || "",
        age_recipients: options.age_recipients || [],
      })

      return {
        blob: new Blob([result.content || ""], { type: "application/json;charset=utf-8" }),
        filename: result.filename,
      }
    },

    previewBackup: (file, options) => importApplicationData("PreviewBackup", file, options),
    restoreBackup: (file, options) => importApplicationData("RestoreBackup", file, options),
  }
}

async function importApplicationData(method: "PreviewBackup" | "RestoreBackup", file: File, options: Parameters<BackupRestoreAdapter["restoreBackup"]>[1]): ReturnType<BackupRestoreAdapter["restoreBackup"]> {
  const result = await Call.ByName(`main.DesktopBackupService.${method}`, {
    content: await file.text(),
    include_config: false,
    include_database: options.include_database,
    conflict_strategy: options.conflict_strategy,
    age_passphrase: options.age_passphrase || "",
    age_identities: options.age_identities || [],
  }) as { inserted: number; updated: number; skipped: number; ignored_fields: string[] | null }
  return {
    message: method === "PreviewBackup" ? "Application data preview" : "Application data imported",
    conflict_strategy: options.conflict_strategy,
    ignored_fields: result.ignored_fields || [],
    summary: { database: { tables: 0, inserted: result.inserted, updated: result.updated, skipped: result.skipped } },
  }
}
