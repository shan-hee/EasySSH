import { useCallback, useEffect, useMemo, useState } from "react"
import { Clipboard as WailsClipboard } from "@wailsio/runtime"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Clipboard, FileText, FolderOpen, TriangleAlert, toast } from "@easyssh/ssh-workspace/desktop"
import { useTranslation } from "react-i18next"
import {
  clearDesktopUpdateFailureNotice,
  getDesktopUpdateFailureNotice,
  openDesktopPathInFileManager,
  type DesktopUpdateFailureNotice,
} from "../adapters/desktop-runtime"

let lastShownUpdateFailureKey = ""

export function DesktopUpdateFailureDialog() {
  const { t } = useTranslation("desktop")
  const [notice, setNotice] = useState<DesktopUpdateFailureNotice | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let mounted = true
    let loading = false

    const loadNotice = async () => {
      if (loading) return
      loading = true
      try {
        const next = await getDesktopUpdateFailureNotice()
        if (!mounted || !next) return
        const key = updateFailureNoticeKey(next)
        if (key && key === lastShownUpdateFailureKey) return
        lastShownUpdateFailureKey = key
        setNotice(next)
        setOpen(true)
        void clearDesktopUpdateFailureNotice()
        toast.error(t("updateFailureToastTitle"), {
          description: next.relaunched_original
            ? t("updateFailureRelaunchedDescription")
            : t("updateFailureNotRelaunchedDescription"),
        })
      } catch (error) {
        console.error("Failed to load update failure notice:", error)
      } finally {
        loading = false
      }
    }

    void loadNotice()
    const timer = window.setInterval(() => {
      void loadNotice()
    }, 3000)

    return () => {
      mounted = false
      window.clearInterval(timer)
    }
  }, [t])

  const manualCommand = useMemo(() => notice ? createManualReplaceCommand(notice) : "", [notice])

  const handleCopyCommand = useCallback(() => {
    if (!manualCommand) return
    void WailsClipboard.SetText(manualCommand)
      .then(() => toast.success(t("updateFailureCopySuccess")))
      .catch(() => toast.error(t("updateFailureCopyFailed")))
  }, [manualCommand, t])

  const handleOpenPath = useCallback((path?: string) => {
    if (!path) return
    void openDesktopPathInFileManager(path)
      .catch((error) => {
        console.error("Failed to open update path:", error)
        toast.error(t("updateFailureOpenPathFailed"))
      })
  }, [t])

  if (!notice) {
    return null
  }

  const rows = [
    [t("updateFailureStageLabel"), notice.stage],
    [t("updateFailureReasonLabel"), notice.message],
    [t("updateFailureTargetLabel"), notice.target],
    [t("updateFailureSourceLabel"), notice.new_path || t("desktopUnknownLabel")],
    [t("updateFailureBackupLabel"), notice.backup || t("desktopUnknownLabel")],
    [t("updateFailureLogLabel"), notice.log_path || t("desktopUnknownLabel")],
  ] as const

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[min(720px,calc(100vh-32px))] w-[min(720px,calc(100vw-32px))] max-w-[min(720px,calc(100vw-32px))] overflow-auto sm:max-w-[min(720px,calc(100vw-32px))] [--wails-draggable:no-drag]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TriangleAlert className="h-5 w-5 text-destructive" />
            {t("updateFailureDialogTitle")}
          </DialogTitle>
          <DialogDescription>
            {notice.relaunched_original
              ? t("updateFailureRelaunchedDescription")
              : t("updateFailureNotRelaunchedDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-w-0 gap-2 rounded-lg border border-[color-mix(in_oklab,var(--border)_70%,transparent)] p-3 text-[13px]">
          {rows.map(([label, value]) => (
            <div key={label} className="grid min-w-0 grid-cols-[92px_minmax(0,1fr)] items-start gap-3">
              <span className="text-muted-foreground">{label}</span>
              <span className="min-w-0 break-all font-medium" title={value}>{value}</span>
            </div>
          ))}
        </div>

        <div className="grid min-w-0 gap-2 border-t border-[color-mix(in_oklab,var(--border)_65%,transparent)] pt-3">
          <div className="text-sm font-medium">{t("updateFailureManualTitle")}</div>
          <p className="text-sm text-muted-foreground">{t("updateFailureManualDescription")}</p>
          <pre className="max-h-[180px] overflow-auto whitespace-pre-wrap break-all rounded-lg border border-[color-mix(in_oklab,var(--border)_70%,transparent)] bg-[color-mix(in_oklab,var(--muted)_60%,transparent)] p-2.5 text-xs leading-normal">{manualCommand || t("updateFailureManualUnavailable")}</pre>
        </div>

        <DialogFooter>
          {notice.log_path ? (
            <Button type="button" variant="outline" onClick={() => handleOpenPath(notice.log_path)}>
              <FileText className="h-4 w-4" />
              {t("updateFailureOpenLogLabel")}
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => handleOpenPath(notice.target)}>
            <FolderOpen className="h-4 w-4" />
            {t("updateFailureOpenFolderLabel")}
          </Button>
          <Button type="button" disabled={!manualCommand} onClick={handleCopyCommand}>
            <Clipboard className="h-4 w-4" />
            {t("updateFailureCopyCommandLabel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function updateFailureNoticeKey(notice: DesktopUpdateFailureNotice): string {
  return [notice.failed_at, notice.stage, notice.message, notice.target].join("|")
}

function createManualReplaceCommand(notice: DesktopUpdateFailureNotice): string {
  const source = notice.manual_replace_source || notice.new_path
  const target = notice.manual_replace_target || notice.target
  if (!source || !target) {
    return ""
  }

  const workingDir = parentPath(target)
  return [
    `$source = '${escapePowerShellSingleQuoted(source)}'`,
    `$target = '${escapePowerShellSingleQuoted(target)}'`,
    "Stop-Process -Name EasySSH -ErrorAction SilentlyContinue",
    "Copy-Item -LiteralPath $source -Destination $target -Force",
    workingDir
      ? `Start-Process -FilePath $target -WorkingDirectory '${escapePowerShellSingleQuoted(workingDir)}'`
      : "Start-Process -FilePath $target",
  ].join("\n")
}

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''")
}

function parentPath(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "")
  const index = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"))
  return index > 0 ? normalized.slice(0, index) : ""
}
