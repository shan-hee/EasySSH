import { useCallback, useEffect, useState } from "react"
import { Browser, Window } from "@wailsio/runtime"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Activity,
  Bot,
  FolderOpen,
  Info,
  Menu,
  Minus,
  RefreshCw,
  Square,
  Terminal,
  X,
  toast,
} from "@easyssh/ssh-workspace/desktop"
import { DashboardHeaderActions } from "@/components/dashboard-header-actions"
import {
  ActivityLogService,
  DesktopActivityLogStatus,
  DesktopService,
  type DesktopActivityLogItem,
} from "../../bindings/github.com/easyssh/easyssh-desktop"
import type { DesktopRuntimeBindingInfo } from "../adapters/desktop-runtime"

export type DesktopView = "terminal" | "ai"

const windowActionErrorMessage = "Failed to run window action:"
const desktopActionErrorMessage = "\u684c\u9762\u8bbe\u7f6e\u64cd\u4f5c\u5931\u8d25"
const desktopSettingsLabel = "\u8bbe\u7f6e"
const desktopAiAssistantLabel = "AI \u52a9\u624b"
const terminalSettingsLabel = "\u7ec8\u7aef\u8bbe\u7f6e"
const activityLogLabel = "\u6d3b\u52a8\u8bb0\u5f55"
const openDataDirLabel = "\u6253\u5f00\u6570\u636e\u76ee\u5f55"
const aboutDesktopLabel = "\u5173\u4e8e EasySSH"
const aboutDesktopTitle = "\u5173\u4e8e EasySSH Desktop"
const recentActivityDescription = "\u6700\u8fd1 50 \u6761\u684c\u9762\u7aef\u8fde\u63a5\u4e0e\u64cd\u4f5c\u8bb0\u5f55"
const noActivityLabel = "\u6682\u65e0\u6d3b\u52a8\u8bb0\u5f55"
const loadingLabel = "\u52a0\u8f7d\u4e2d..."
const refreshLabel = "\u5237\u65b0"
const dataDirOpenFailedMessage = "\u6253\u5f00\u6570\u636e\u76ee\u5f55\u5931\u8d25"
const windowMinimizeLabel = "\u6700\u5c0f\u5316"
const windowMaximizeLabel = "\u6700\u5927\u5316"
const windowCloseLabel = "\u5173\u95ed"
const desktopVersionLabel = "\u7248\u672c"
const desktopPlatformLabel = "\u5e73\u53f0"
const desktopArchLabel = "\u67b6\u6784"
const desktopDataDirLabel = "\u6570\u636e\u76ee\u5f55"
const desktopUnknownLabel = "\u672a\u77e5"
const githubLabel = "GitHub"
const githubUrl = "https://github.com/shan-hee/EasySSH"

function formatDesktopDateTime(value?: string) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString("zh-CN", { hour12: false })
}

function formatDesktopDuration(milliseconds?: number) {
  if (!milliseconds) return "-"
  if (milliseconds < 1000) return `${milliseconds}ms`
  const seconds = Math.round(milliseconds / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function formatDesktopStatus(status: DesktopActivityLogStatus) {
  if (status === DesktopActivityLogStatus.DesktopActivityLogFailure) return "\u5931\u8d25"
  if (status === DesktopActivityLogStatus.DesktopActivityLogWarning) return "\u8b66\u544a"
  return "\u6210\u529f"
}

function formatDesktopAction(action: string) {
  switch (action) {
    case "ssh_connect":
      return "SSH \u8fde\u63a5"
    case "ssh_disconnect":
      return "SSH \u65ad\u5f00"
    case "sftp_upload":
      return "SFTP \u4e0a\u4f20"
    case "sftp_download":
      return "SFTP \u4e0b\u8f7d"
    case "sftp_delete":
      return "SFTP \u5220\u9664"
    case "sftp_rename":
      return "SFTP \u91cd\u547d\u540d"
    case "sftp_mkdir":
      return "SFTP \u65b0\u5efa\u76ee\u5f55"
    case "monitoring_query":
      return "\u76d1\u63a7\u67e5\u8be2"
    default:
      return action || "-"
  }
}

function runWindowAction(action: () => Promise<void>) {
  void action().catch((error) => {
    console.error(windowActionErrorMessage, error)
  })
}

function DesktopActivityLogDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [items, setItems] = useState<DesktopActivityLogItem[]>([])
  const [loading, setLoading] = useState(false)

  const loadItems = useCallback(async () => {
    try {
      setLoading(true)
      const result = await ActivityLogService.List({ page: 1, limit: 50 })
      setItems(result.items || [])
    } catch (error) {
      console.error(desktopActionErrorMessage, error)
      toast.error(desktopActionErrorMessage)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      void loadItems()
    }
  }, [loadItems, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="easyssh-desktop-activity-dialog">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3 pr-8">
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                {activityLogLabel}
              </DialogTitle>
              <DialogDescription>{recentActivityDescription}</DialogDescription>
            </div>
            <Button variant="ghost" size="icon-sm" title={refreshLabel} aria-label={refreshLabel} onClick={() => void loadItems()} disabled={loading}>
              <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            </Button>
          </div>
        </DialogHeader>

        <div className="easyssh-desktop-activity-list scrollbar-custom">
          {loading && items.length === 0 ? (
            <div className="easyssh-desktop-empty-state">{loadingLabel}</div>
          ) : items.length === 0 ? (
            <div className="easyssh-desktop-empty-state">{noActivityLabel}</div>
          ) : (
            items.map((item) => (
              <div key={item.id} className="easyssh-desktop-activity-item">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <div className="min-w-0 truncate text-sm font-medium">{formatDesktopAction(item.action)}</div>
                  <span className="easyssh-desktop-status-badge">{formatDesktopStatus(item.status)}</span>
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground" title={item.resource}>
                  {item.resource || "-"}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{formatDesktopDateTime(item.createdAt)}</span>
                  <span>{formatDesktopDuration(item.durationMs)}</span>
                  {item.serverId ? <span>ID: {item.serverId}</span> : null}
                </div>
                {item.detail ? (
                  <div className="mt-2 rounded-md bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
                    {item.detail}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DesktopAboutDialog({
  open,
  onOpenChange,
  runtime,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  runtime: DesktopRuntimeBindingInfo | null
}) {
  const rows = [
    [desktopVersionLabel, runtime?.version || desktopUnknownLabel],
    [desktopPlatformLabel, runtime?.platform || desktopUnknownLabel],
    [desktopArchLabel, runtime?.arch || desktopUnknownLabel],
    [desktopDataDirLabel, runtime?.dataDir || desktopUnknownLabel],
  ] as const

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="easyssh-desktop-about-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Info className="h-5 w-5" />
            {aboutDesktopTitle}
          </DialogTitle>
          <DialogDescription>EasySSH Desktop</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {rows.map(([label, value]) => (
            <div key={label} className="easyssh-desktop-about-row">
              <span className="text-muted-foreground">{label}</span>
              <span className="min-w-0 truncate font-medium" title={value}>{value}</span>
            </div>
          ))}
        </div>

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => void Browser.OpenURL(githubUrl)}>
            {githubLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DesktopSettingsMenu({
  runtime,
  onOpenTerminalSettings,
}: {
  runtime: DesktopRuntimeBindingInfo | null
  onOpenTerminalSettings: () => void
}) {
  const [activityLogOpen, setActivityLogOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)

  const handleOpenDataDir = useCallback(() => {
    void DesktopService.OpenDataDir().catch((error) => {
      console.error(desktopActionErrorMessage, error)
      toast.error(dataDirOpenFailedMessage)
    })
  }, [])

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="easyssh-desktop-titlebar-menu-button"
            aria-label={desktopSettingsLabel}
            title={desktopSettingsLabel}
          >
            <Menu className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="easyssh-desktop-settings-menu">
          <DropdownMenuLabel>{desktopSettingsLabel}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onOpenTerminalSettings}>
            <Terminal className="h-4 w-4" />
            <span>{terminalSettingsLabel}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setActivityLogOpen(true)}>
            <Activity className="h-4 w-4" />
            <span>{activityLogLabel}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleOpenDataDir}>
            <FolderOpen className="h-4 w-4" />
            <span>{openDataDirLabel}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setAboutOpen(true)}>
            <Info className="h-4 w-4" />
            <span>{aboutDesktopLabel}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DesktopActivityLogDialog open={activityLogOpen} onOpenChange={setActivityLogOpen} />
      <DesktopAboutDialog open={aboutOpen} onOpenChange={setAboutOpen} runtime={runtime} />
    </>
  )
}

export function DesktopTitleBar({
  runtime,
  activeView,
  onToggleAiAssistant,
  onOpenTerminalSettings,
}: {
  runtime: DesktopRuntimeBindingInfo | null
  activeView: DesktopView
  onToggleAiAssistant: () => void
  onOpenTerminalSettings: () => void
}) {
  const handleMinimize = useCallback(() => {
    runWindowAction(() => Window.Minimise())
  }, [])

  const handleMaximize = useCallback(() => {
    runWindowAction(() => Window.ToggleMaximise())
  }, [])

  const handleClose = useCallback(() => {
    runWindowAction(() => Window.Close())
  }, [])

  return (
    <header className="easyssh-desktop-titlebar">
      <div className="easyssh-desktop-titlebar-drag">
        <img className="easyssh-desktop-titlebar-icon" src="/favicon.ico" alt="" aria-hidden="true" />
        <span className="easyssh-desktop-titlebar-title">EasySSH</span>
      </div>
      <div className="easyssh-desktop-titlebar-actions">
        <DesktopSettingsMenu runtime={runtime} onOpenTerminalSettings={onOpenTerminalSettings} />
        {activeView !== "ai" && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="easyssh-desktop-titlebar-ai-button"
            aria-label={desktopAiAssistantLabel}
            title={desktopAiAssistantLabel}
            onClick={onToggleAiAssistant}
          >
            <Bot className="h-4 w-4" />
          </Button>
        )}
        <DashboardHeaderActions />
        <div className="easyssh-desktop-window-controls" role="group" aria-label="Window controls">
          <button
            type="button"
            className="easyssh-desktop-window-button"
            aria-label={windowMinimizeLabel}
            title={windowMinimizeLabel}
            onClick={handleMinimize}
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="easyssh-desktop-window-button"
            aria-label={windowMaximizeLabel}
            title={windowMaximizeLabel}
            onClick={handleMaximize}
          >
            <Square className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="easyssh-desktop-window-button easyssh-desktop-window-button-close"
            aria-label={windowCloseLabel}
            title={windowCloseLabel}
            onClick={handleClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  )
}
