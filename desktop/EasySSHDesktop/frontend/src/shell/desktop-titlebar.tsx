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
  FileText,
  FolderOpen,
  Info,
  Menu,
  Minus,
  RefreshCw,
  Square,
  X,
  toast,
} from "@easyssh/ssh-workspace/desktop"
import type { Locale } from "@/i18n"
import {
  ActivityLogService,
  DesktopActivityLogStatus,
  DesktopService,
  type DesktopActivityLogItem,
} from "../../bindings/github.com/easyssh/easyssh-desktop"
import type { DesktopRuntimeBindingInfo } from "../adapters/desktop-runtime"
import { DesktopHeaderActions } from "./desktop-header-actions"
import { useTranslation } from "react-i18next"

export type DesktopView = "terminal" | "ai" | "scripts"

const windowActionErrorMessage = "Failed to run window action:"
const githubLabel = "GitHub"
const githubUrl = "https://github.com/shan-hee/EasySSH"

type DesktopTranslator = ReturnType<typeof useTranslation>["t"]

function formatDesktopDateTime(value: string | undefined, locale: string) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(locale, { hour12: false })
}

function formatDesktopDuration(milliseconds?: number) {
  if (!milliseconds) return "-"
  if (milliseconds < 1000) return `${milliseconds}ms`
  const seconds = Math.round(milliseconds / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function formatDesktopStatus(status: DesktopActivityLogStatus, t: DesktopTranslator) {
  if (status === DesktopActivityLogStatus.DesktopActivityLogFailure) return t("statusFailure")
  if (status === DesktopActivityLogStatus.DesktopActivityLogWarning) return t("statusWarning")
  return t("statusSuccess")
}

function formatDesktopAction(action: string, t: DesktopTranslator) {
  switch (action) {
    case "ssh_connect":
      return t("actionSshConnect")
    case "ssh_disconnect":
      return t("actionSshDisconnect")
    case "sftp_upload":
      return t("actionSftpUpload")
    case "sftp_download":
      return t("actionSftpDownload")
    case "sftp_delete":
      return t("actionSftpDelete")
    case "sftp_rename":
      return t("actionSftpRename")
    case "sftp_mkdir":
      return t("actionSftpMkdir")
    case "monitoring_query":
      return t("actionMonitoringQuery")
    case "script_execute":
      return t("actionScriptExecute")
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
  const { t, i18n } = useTranslation("desktop")
  const { t: tCommon } = useTranslation("common")
  const [items, setItems] = useState<DesktopActivityLogItem[]>([])
  const [loading, setLoading] = useState(false)

  const loadItems = useCallback(async () => {
    try {
      setLoading(true)
      const result = await ActivityLogService.List({ page: 1, limit: 50 })
      setItems(result.items || [])
    } catch (error) {
      console.error(t("desktopActionErrorMessage"), error)
      toast.error(t("desktopActionErrorMessage"))
    } finally {
      setLoading(false)
    }
  }, [t])

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
                {t("activityLogLabel")}
              </DialogTitle>
              <DialogDescription>{t("recentActivityDescription")}</DialogDescription>
            </div>
            <Button variant="ghost" size="icon-sm" title={t("refreshLabel")} aria-label={t("refreshLabel")} onClick={() => void loadItems()} disabled={loading}>
              <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            </Button>
          </div>
        </DialogHeader>

        <div className="easyssh-desktop-activity-list scrollbar-custom">
          {loading && items.length === 0 ? (
            <div className="easyssh-desktop-empty-state">{tCommon("loading")}</div>
          ) : items.length === 0 ? (
            <div className="easyssh-desktop-empty-state">{t("noActivityLabel")}</div>
          ) : (
            items.map((item) => (
              <div key={item.id} className="easyssh-desktop-activity-item">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <div className="min-w-0 truncate text-sm font-medium">{formatDesktopAction(item.action, t)}</div>
                  <span className="easyssh-desktop-status-badge">{formatDesktopStatus(item.status, t)}</span>
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground" title={item.resource}>
                  {item.resource || "-"}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{formatDesktopDateTime(item.createdAt, i18n.language)}</span>
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
  const { t } = useTranslation("desktop")
  const rows = [
    [t("desktopVersionLabel"), runtime?.version || t("desktopUnknownLabel")],
    [t("desktopPlatformLabel"), runtime?.platform || t("desktopUnknownLabel")],
    [t("desktopArchLabel"), runtime?.arch || t("desktopUnknownLabel")],
    [t("desktopDataDirLabel"), runtime?.dataDir || t("desktopUnknownLabel")],
  ] as const

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="easyssh-desktop-about-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Info className="h-5 w-5" />
            {t("aboutDesktopTitle")}
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
  onOpenScripts,
}: {
  runtime: DesktopRuntimeBindingInfo | null
  onOpenScripts: () => void
}) {
  const { t } = useTranslation("desktop")
  const [activityLogOpen, setActivityLogOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)

  const handleOpenDataDir = useCallback(() => {
    void DesktopService.OpenDataDir().catch((error) => {
      console.error(t("desktopActionErrorMessage"), error)
      toast.error(t("dataDirOpenFailedMessage"))
    })
  }, [t])

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="easyssh-desktop-titlebar-menu-button"
            aria-label={t("settingsLabel")}
            title={t("settingsLabel")}
          >
            <Menu className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="easyssh-desktop-settings-menu">
          <DropdownMenuLabel>{t("settingsLabel")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onOpenScripts}>
            <FileText className="h-4 w-4" />
            <span>{t("scriptLibraryLabel")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setActivityLogOpen(true)}>
            <Activity className="h-4 w-4" />
            <span>{t("activityLogLabel")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleOpenDataDir}>
            <FolderOpen className="h-4 w-4" />
            <span>{t("openDataDirLabel")}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setAboutOpen(true)}>
            <Info className="h-4 w-4" />
            <span>{t("aboutDesktopLabel")}</span>
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
  locale,
  onToggleAiAssistant,
  onLocaleChange,
  onOpenScripts,
}: {
  runtime: DesktopRuntimeBindingInfo | null
  activeView: DesktopView
  locale: Locale
  onToggleAiAssistant: () => void
  onLocaleChange: (locale: Locale) => void
  onOpenScripts: () => void
}) {
  const { t } = useTranslation("desktop")
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
        <DesktopSettingsMenu
          runtime={runtime}
          onOpenScripts={onOpenScripts}
        />
        {activeView !== "ai" && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="easyssh-desktop-titlebar-ai-button"
            aria-label={t("aiAssistantLabel")}
            title={t("aiAssistantLabel")}
            onClick={onToggleAiAssistant}
          >
            <Bot className="h-4 w-4" />
          </Button>
        )}
        <DesktopHeaderActions locale={locale} onLocaleChange={onLocaleChange} />
        <div className="easyssh-desktop-window-controls" role="group" aria-label={t("windowControlsLabel")}>
          <button
            type="button"
            className="easyssh-desktop-window-button"
            aria-label={t("windowMinimizeLabel")}
            title={t("windowMinimizeLabel")}
            onClick={handleMinimize}
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="easyssh-desktop-window-button"
            aria-label={t("windowMaximizeLabel")}
            title={t("windowMaximizeLabel")}
            onClick={handleMaximize}
          >
            <Square className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="easyssh-desktop-window-button easyssh-desktop-window-button-close"
            aria-label={t("windowCloseLabel")}
            title={t("windowCloseLabel")}
            onClick={handleClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  )
}
