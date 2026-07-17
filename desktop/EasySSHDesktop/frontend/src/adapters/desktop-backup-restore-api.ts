import type { BackupRestoreAdapter } from "@easyssh/ssh-workspace/desktop"
import { DesktopBackupService } from "../../bindings/github.com/easyssh/easyssh-desktop"

export function createDesktopBackupRestoreAdapter(): BackupRestoreAdapter {
  return {
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

    async restoreBackup(file, options) {
      await DesktopBackupService.RestoreBackup({
        content: await file.text(),
        include_config: false,
        include_database: options.include_database,
        conflict_strategy: options.conflict_strategy,
        age_passphrase: options.age_passphrase || "",
        age_identities: options.age_identities || [],
      })
    },
  }
}
