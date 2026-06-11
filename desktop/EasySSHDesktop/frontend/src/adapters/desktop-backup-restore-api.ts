import type { BackupRestoreAdapter, ConflictStrategy } from "@easyssh/ssh-workspace/desktop"
import { DesktopBackupService } from "../../bindings/github.com/easyssh/easyssh-desktop"

export function createDesktopBackupRestoreAdapter(): BackupRestoreAdapter {
  return {
    supportsConfig: false,

    async exportBackup(options) {
      const result = await DesktopBackupService.ExportBackup({
        include_config: false,
        include_database: options.include_database,
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
        conflict_strategy: normalizeConflictStrategy(options.conflict_strategy),
      })
    },
  }
}

function normalizeConflictStrategy(value: ConflictStrategy) {
  return value === "skip" || value === "overwrite" || value === "error"
    ? value
    : "error"
}
