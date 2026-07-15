import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "@easyssh/ssh-workspace/desktop"
import { useTranslation } from "react-i18next"
import {
  desktopUpdateApi,
  type DesktopUpdateCheckResult,
  type DesktopUpdateProgress,
  type DesktopUpdateStatus,
} from "../adapters/desktop-update-api"
import { cn } from "@/lib/utils"

type DesktopInlineUpdateActionProps = {
  initialResult?: DesktopUpdateCheckResult | null
  onResultChange?: (result: DesktopUpdateCheckResult | null) => void
}

export function DesktopInlineUpdateAction({
  initialResult = null,
  onResultChange,
}: DesktopInlineUpdateActionProps) {
  const { t } = useTranslation("desktop")
  const [result, setResult] = useState<DesktopUpdateCheckResult | null>(initialResult)
  const [progress, setProgress] = useState<DesktopUpdateProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const resultRef = useRef<DesktopUpdateCheckResult | null>(initialResult)
  const mountedRef = useRef(true)

  const status = progress?.status ?? result?.status ?? "idle"
  const latestVersion = progress?.latest_version || result?.latest_version || ""
  const hasUpdate = Boolean(result?.has_update || latestVersion)
  const progressValue = useMemo(() => getProgressValue(status, progress), [progress, status])
  const visible = hasUpdate && status !== "idle" && status !== "checking" && status !== "up_to_date"

  const updateResult = useCallback(
    (next: DesktopUpdateCheckResult | null) => {
      resultRef.current = next
      setResult(next)
      onResultChange?.(next)
    },
    [onResultChange],
  )

  useEffect(() => {
    resultRef.current = initialResult
    setResult(initialResult)
  }, [initialResult])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    return desktopUpdateApi.onProgress((next) => {
      if (!mountedRef.current) {
        return
      }
      setProgress(next)
      const previous = resultRef.current
      if (!previous) {
        const updated = resultFromProgress(next)
        resultRef.current = updated
        setResult(updated)
        onResultChange?.(updated)
        return
      }
      const updated = {
        ...previous,
        status: next.status,
        latest_version: next.latest_version || previous.latest_version,
        release_url: next.release_url || previous.release_url,
        error: next.error,
      }
      resultRef.current = updated
      setResult(updated)
      onResultChange?.(updated)
    })
  }, [onResultChange])

  const handleClick = useCallback(() => {
    if (busy || status === "downloading" || status === "verifying") {
      return
    }

    if (status === "ready") {
      setBusy(true)
      void desktopUpdateApi.restartToUpdate()
        .catch(() => {
          toast.error(t("updateRestartFailedTitle"))
        })
        .finally(() => {
          if (mountedRef.current) {
            setBusy(false)
          }
        })
      return
    }

    if (!hasUpdate || !result?.has_update) {
      return
    }

    setBusy(true)
    setProgress({
      status: "downloading",
      current_version: result.current_version,
      latest_version: result.latest_version,
      release_url: result.release_url,
    })
    void desktopUpdateApi.installUpdate()
      .then((next) => {
        if (!mountedRef.current) {
          return
        }
        setProgress(null)
        updateResult(next)
      })
      .catch((error) => {
        if (!mountedRef.current) {
          return
        }
        const message = getErrorMessage(error)
        setProgress({
          status: "error",
          current_version: result.current_version,
          latest_version: result.latest_version,
          error: message,
          release_url: result.release_url,
        })
        toast.error(t("updateInstallFailedTitle"))
      })
      .finally(() => {
        if (mountedRef.current) {
          setBusy(false)
        }
      })
  }, [busy, hasUpdate, result, status, t, updateResult])

  if (!visible) {
    return null
  }

  const label = inlineUpdateLabel(status, latestVersion, progressValue, t)
  const title = inlineUpdateTitle(status, latestVersion, progressValue, t)
  const disabled = busy || status === "downloading" || status === "verifying"

  const className = cn(
    "inline-flex max-w-[132px] shrink-0 appearance-none items-center gap-[3px] whitespace-nowrap rounded-full border border-[color-mix(in_oklab,var(--primary)_50%,transparent)] bg-[color-mix(in_oklab,var(--primary)_18%,transparent)] px-2 py-0.5 font-sans text-xs font-semibold leading-[1.3] text-[color-mix(in_oklab,var(--primary)_78%,var(--foreground))] transition-colors duration-150 [--wails-draggable:no-drag] [&:not(:disabled):hover]:border-[color-mix(in_oklab,var(--primary)_68%,transparent)] [&:not(:disabled):hover]:bg-[color-mix(in_oklab,var(--primary)_24%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color-mix(in_oklab,var(--ring)_70%,transparent)] disabled:cursor-default disabled:opacity-[0.82]",
    (status === "downloading" || status === "verifying") && "min-w-[58px] justify-center border-[color-mix(in_oklab,var(--primary)_40%,transparent)] bg-[linear-gradient(90deg,color-mix(in_oklab,var(--primary)_28%,transparent)_0%,color-mix(in_oklab,var(--primary)_14%,transparent)_100%)]",
    status === "ready" && "border-[color-mix(in_oklab,var(--primary)_62%,transparent)] bg-primary text-primary-foreground [&:not(:disabled):hover]:border-[color-mix(in_oklab,var(--primary)_75%,var(--foreground))] [&:not(:disabled):hover]:bg-[color-mix(in_oklab,var(--primary)_86%,var(--foreground))]",
    status === "error" && "border-[color-mix(in_oklab,var(--destructive)_55%,transparent)] bg-[color-mix(in_oklab,var(--destructive)_14%,transparent)] text-[color-mix(in_oklab,var(--destructive)_84%,var(--foreground))]"
  )

  return (
    <button
      type="button"
      className={className}
      data-status={status}
      disabled={disabled}
      title={title}
      aria-label={title}
      onClick={handleClick}
    >
      {status === "available" ? <span aria-hidden="true">↑</span> : null}
      <span>{label}</span>
    </button>
  )
}

function resultFromProgress(progress: DesktopUpdateProgress): DesktopUpdateCheckResult {
  const hasUpdate = (
    progress.status === "available" ||
    progress.status === "downloading" ||
    progress.status === "verifying" ||
    progress.status === "ready" ||
    progress.status === "error"
  ) && Boolean(progress.latest_version)

  return {
    current_version: progress.current_version,
    latest_version: progress.latest_version || "",
    has_update: hasUpdate,
    status: progress.status,
    release_url: progress.release_url,
    error: progress.error,
  }
}

function getProgressValue(status: DesktopUpdateStatus, progress: DesktopUpdateProgress | null) {
  if (status === "ready" || status === "verifying") {
    return 100
  }
  if (!progress?.total || !progress.written) {
    return 0
  }
  return Math.max(0, Math.min(100, Math.round((progress.written / progress.total) * 100)))
}

function inlineUpdateLabel(
  status: DesktopUpdateStatus,
  latestVersion: string,
  progressValue: number,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (status === "downloading" || status === "verifying") return t("updateInlineProgressLabel", { progress: progressValue })
  if (status === "ready") return t("updateInlineInstallLabel")
  if (status === "error") return t("updateInlineRetryLabel")
  return latestVersion
}

function inlineUpdateTitle(
  status: DesktopUpdateStatus,
  latestVersion: string,
  progressValue: number,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (status === "downloading" || status === "verifying") {
    return t("updateInlineProgressTitle", { progress: progressValue })
  }
  if (status === "ready") return t("updateInlineInstallTitle")
  if (status === "error") return t("updateInlineRetryTitle")
  return t("updateInlineDownloadTitle", { version: latestVersion })
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
