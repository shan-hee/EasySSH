import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ChevronDown, Cloud, Loader2, Settings2, toast } from "@easyssh/ssh-workspace/desktop"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { SyncStatus } from "@/lib/sync/types"
import { cn } from "@/lib/utils"
import { useIntentPreload } from "@/hooks/use-intent-preload"
import { preloadDesktopView } from "./desktop-view-registry"
import { desktopSyncAdapter, isDesktopSyncRunning } from "../adapters/desktop-sync"

export function DesktopSyncAction({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t } = useTranslation("desktop")
  const preloadHandlers = useIntentPreload(() => preloadDesktopView("sync"))
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [loadError, setLoadError] = useState("")
  const [syncing, setSyncing] = useState(isDesktopSyncRunning)
  const [busy, setBusy] = useState(false)
  const clicking = useRef(false)

  useEffect(() => {
    let disposed = false
    let loading = false
    let refreshAgain = false
    const refresh = async () => {
      setSyncing(isDesktopSyncRunning())
      if (loading) { refreshAgain = true; return }
      loading = true
      do {
        refreshAgain = false
        try {
          const next = await desktopSyncAdapter.status()
          if (!disposed) { setStatus(next); setLoadError("") }
        } catch (error) {
          if (!disposed) setLoadError(String(error))
        }
      } while (refreshAgain && !disposed)
      loading = false
    }
    const update = () => { void refresh() }
    update()
    const timer = window.setInterval(update, 15000)
    window.addEventListener("easyssh:sync-status-changed", update)
    window.addEventListener("easyssh:sync-applied", update)
    return () => {
      disposed = true
      window.clearInterval(timer)
      window.removeEventListener("easyssh:sync-status-changed", update)
      window.removeEventListener("easyssh:sync-applied", update)
    }
  }, [])

  const needsAttention = Boolean(loadError || status?.error || status?.conflicts.length)
  const configured = status?.connected && status.enabled
  const label = syncing ? t("syncRunningLabel") : !status?.connected ? t("syncConfigureLabel") : !status.enabled ? t("syncPausedLabel") : t("syncNowLabel")
  const stateLabel = needsAttention ? t("syncAttentionLabel") : syncing ? t("syncRunningLabel") : !status?.connected ? t("syncUnconfiguredLabel") : !status.enabled ? t("syncPausedLabel") : t("syncEnabledLabel")

  const handleClick = async () => {
    if (clicking.current || isDesktopSyncRunning()) return
    if (!configured || loadError) return
    clicking.current = true
    setBusy(true)
    try {
      // Re-read the binding so a recent pause or disconnect is respected.
      const current = await desktopSyncAdapter.status()
      setStatus(current)
      if (!current.connected || !current.enabled) {
        toast.info(t(current.connected ? "syncPausedLabel" : "syncConfigureLabel"))
        return
      }
      await desktopSyncAdapter.sync()
      const next = await desktopSyncAdapter.status()
      setStatus(next)
      if (!next.connected || !next.enabled) {
        toast.info(t(next.connected ? "syncPausedLabel" : "syncConfigureLabel"))
        return
      }
      if (next.conflicts.length) {
        toast.info(t("syncConflictsMessage"))
      } else {
        toast.success(t("syncCompleteMessage"))
      }
    } catch (error) {
      toast.error(String(error))
    } finally {
      clicking.current = false
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center [--wails-draggable:no-drag]" role="group" aria-label={t("syncLabel")}>
      <span className="inline-flex" title={`${label} · ${stateLabel}`}>
        <Button type="button" variant="ghost" size="icon-sm"
          className={cn("relative size-[30px] rounded-r-none", !configured && "text-muted-foreground")}
          disabled={busy || syncing || !configured || Boolean(loadError)}
          aria-label={label} onClick={() => void handleClick()}>
          {syncing || busy ? <Loader2 className="size-4 animate-spin" /> : <Cloud className="size-4" />}
          {needsAttention && <span className="absolute right-1 top-1 size-1.5 rounded-full bg-destructive" />}
        </Button>
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" className="h-[30px] !w-4 rounded-l-none px-0"
            aria-label={t("syncOptionsLabel")} title={t("syncOptionsLabel")}>
            <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 [--wails-draggable:no-drag]">
          {status?.account_name && <div className="truncate px-2 py-1 text-xs text-muted-foreground" title={status.account_name}>{status.account_name}</div>}
          {status?.last_sync && <div className="px-2 py-1 text-xs text-muted-foreground">{t("syncLastTimeLabel", { time: new Date(status.last_sync).toLocaleString() })}</div>}
          <DropdownMenuSeparator />
          <DropdownMenuItem {...preloadHandlers} onSelect={onOpenSettings}>
            <Settings2 className="size-4" />{t("syncSettingsLabel")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
