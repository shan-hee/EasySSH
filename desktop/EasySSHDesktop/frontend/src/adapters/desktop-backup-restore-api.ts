import { Call } from "@wailsio/runtime"
import type { BackupRestoreAdapter, ConflictStrategy } from "@easyssh/ssh-workspace/desktop"

interface DesktopBackupExportResult {
  filename?: string
  content?: string
}

const desktopBackupExportMethod = "github.com/easyssh/easyssh-desktop.DesktopBackupService.ExportBackup"
const desktopBackupRestoreMethod = "github.com/easyssh/easyssh-desktop.DesktopBackupService.RestoreBackup"

export function createDesktopBackupRestoreAdapter(): BackupRestoreAdapter {
  return {
    supportsConfig: false,

    async exportBackup(options) {
      const result = await Call.ByName(desktopBackupExportMethod, {
        include_config: false,
        include_database: options.include_database,
      }) as DesktopBackupExportResult

      return {
        blob: new Blob([result.content || ""], { type: "application/json;charset=utf-8" }),
        filename: result.filename,
      }
    },

    async restoreBackup(file, options) {
      await Call.ByName(desktopBackupRestoreMethod, {
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
