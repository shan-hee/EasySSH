import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Browser } from "@wailsio/runtime"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { Download, ExternalLink, Loader2, RefreshCw, RotateCw } from "@easyssh/ssh-workspace/desktop"
import { toast } from "@easyssh/ssh-workspace/desktop"
import { useTranslation } from "react-i18next"
import {
  desktopUpdateApi,
  type DesktopUpdateCheckResult,
  type DesktopUpdateProgress,
  type DesktopUpdateStatus,
} from "../adapters/desktop-update-api"

const lastDesktopUpdateCheckKey = "easyssh:last-desktop-update-check"
const updateCheckIntervalMs = 24 * 60 * 60 * 1000

type DesktopUpdateDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  autoCheck?: boolean
  checkRequest?: number
}

export function DesktopUpdateDialog({ open, onOpenChange, autoCheck = true, checkRequest = 0 }: DesktopUpdateDialogProps) {
  const { t } = useTranslation("desktop")
  const [result, setResult] = useState<DesktopUpdateCheckResult | null>(null)
  const [progress, setProgress] = useState<DesktopUpdateProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const handledCheckRequestRef = useRef(0)

  const status = progress?.status ?? result?.status ?? "idle"
  const canInstall = result?.has_update && status === "available"
  const canRestart = status === "ready"
  const isWorking = busy || status === "checking" || status === "downloading" || status === "verifying"
  const progressValue = useMemo(() => {
    if (!progress?.total || !progress.written) {
      return status === "ready" ? 100 : 0
    }
    return Math.max(0, Math.min(100, Math.round((progress.written / progress.total) * 100)))
  }, [progress?.total, progress?.written, status])

  const loadStatus = useCallback(async () => {
    try {
      const next = await desktopUpdateApi.getStatus()
      setResult(next)
    } catch {
      // The status endpoint is best-effort on first paint.
    }
  }, [])

  const checkForUpdates = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (busy) {
        return
      }
      setBusy(true)
      setProgress({ status: "checking", current_version: result?.current_version ?? "" })
      localStorage.setItem(lastDesktopUpdateCheckKey, String(Date.now()))
      try {
        const next = await desktopUpdateApi.checkForUpdate()
        setResult(next)
        setProgress(null)

        if (next.has_update) {
          if (options.silent) {
            toast(t("updateAvailableTitle", { version: next.latest_version }), {
              action: {
                label: t("updateOpenDialogLabel"),
                onClick: () => onOpenChange(true),
              },
            })
          } else {
            onOpenChange(true)
          }
        } else if (!options.silent) {
          toast.success(t("updateLatestTitle"))
        }
      } catch (error) {
        setProgress({ status: "error", current_version: result?.current_version ?? "", error: getErrorMessage(error) })
        if (!options.silent) {
          toast.error(t("updateCheckFailedTitle"))
        }
      } finally {
        setBusy(false)
      }
    },
    [busy, onOpenChange, result?.current_version, t],
  )

  const installUpdate = useCallback(async () => {
    if (!canInstall) {
      return
    }
    setBusy(true)
    try {
      const next = await desktopUpdateApi.installUpdate()
      setResult(next)
    } catch (error) {
      setProgress({ status: "error", current_version: result?.current_version ?? "", error: getErrorMessage(error) })
      toast.error(t("updateInstallFailedTitle"))
    } finally {
      setBusy(false)
    }
  }, [canInstall, result?.current_version, t])

  const restartToUpdate = useCallback(async () => {
    try {
      await desktopUpdateApi.restartToUpdate()
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }, [])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  useEffect(() => {
    if (!open || checkRequest <= 0) {
      return
    }
    if (handledCheckRequestRef.current === checkRequest) {
      return
    }
    handledCheckRequestRef.current = checkRequest
    void checkForUpdates()
  }, [checkForUpdates, checkRequest, open])

  useEffect(() => {
    return desktopUpdateApi.onProgress((next) => {
      setProgress(next)
      setResult((prev) => prev ? { ...prev, status: next.status, error: next.error } : prev)
      if (next.status === "ready") {
        onOpenChange(true)
      }
      if (next.status === "error" && next.error) {
        onOpenChange(true)
      }
    })
  }, [onOpenChange])

  useEffect(() => {
    if (!autoCheck) {
      return
    }
    const raw = localStorage.getItem(lastDesktopUpdateCheckKey)
    const lastCheckedAt = raw ? Number(raw) : 0
    if (Number.isFinite(lastCheckedAt) && Date.now() - lastCheckedAt < updateCheckIntervalMs) {
      return
    }
    const timer = window.setTimeout(() => {
      void checkForUpdates({ silent: true })
    }, 4000)
    return () => window.clearTimeout(timer)
  }, [autoCheck, checkForUpdates])

  const title = dialogTitle(status, result, t)
  const description = dialogDescription(status, result, progress, t)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="easyssh-desktop-update-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="easyssh-desktop-update-version-grid">
            <span className="text-muted-foreground">{t("desktopVersionLabel")}</span>
            <span>{result?.current_version || progress?.current_version || t("desktopUnknownLabel")}</span>
            <span className="text-muted-foreground">{t("updateLatestVersionLabel")}</span>
            <span>{result?.latest_version || progress?.latest_version || t("desktopUnknownLabel")}</span>
            {result?.artifact?.filename ? (
              <>
                <span className="text-muted-foreground">{t("updateArtifactLabel")}</span>
                <span className="min-w-0 truncate" title={result.artifact.filename}>{result.artifact.filename}</span>
              </>
            ) : null}
          </div>

          {status === "downloading" || status === "verifying" || status === "ready" ? (
            <div className="space-y-2">
              <Progress value={progressValue} />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{status === "verifying" ? t("updateVerifyingLabel") : t("updateDownloadingLabel")}</span>
                <span>{progressValue}%</span>
              </div>
            </div>
          ) : null}

          {status === "error" && (progress?.error || result?.error) ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {progress?.error || result?.error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          {result?.release_url ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void Browser.OpenURL(result.release_url || "")
              }}
            >
              <ExternalLink className="h-4 w-4" />
              {t("updateViewReleaseLabel")}
            </Button>
          ) : null}
          <Button type="button" variant="outline" disabled={isWorking} onClick={() => void checkForUpdates()}>
            {status === "checking" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {t("updateCheckNowLabel")}
          </Button>
          {canInstall ? (
            <Button type="button" disabled={isWorking} onClick={() => void installUpdate()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {t("updateInstallLabel")}
            </Button>
          ) : null}
          {canRestart ? (
            <Button type="button" onClick={() => void restartToUpdate()}>
              <RotateCw className="h-4 w-4" />
              {t("updateRestartLabel")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function dialogTitle(
  status: DesktopUpdateStatus,
  result: DesktopUpdateCheckResult | null,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (status === "ready") return t("updateReadyTitle")
  if (status === "error") return t("updateCheckFailedTitle")
  if (result?.has_update) return t("updateAvailableTitle", { version: result.latest_version })
  if (status === "up_to_date") return t("updateLatestTitle")
  return t("updateDialogTitle")
}

function dialogDescription(
  status: DesktopUpdateStatus,
  result: DesktopUpdateCheckResult | null,
  progress: DesktopUpdateProgress | null,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (status === "checking") return t("updateCheckingDescription")
  if (status === "downloading") return t("updateDownloadingDescription")
  if (status === "verifying") return t("updateVerifyingDescription")
  if (status === "ready") return t("updateReadyDescription")
  if (status === "error") return progress?.error || result?.error || t("updateCheckFailedDescription")
  if (result?.has_update) return t("updateAvailableDescription")
  if (status === "up_to_date") return t("updateLatestDescription")
  return t("updateDialogDescription")
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  if (typeof error === "string") {
    return error
  }
  return "Update failed"
}
