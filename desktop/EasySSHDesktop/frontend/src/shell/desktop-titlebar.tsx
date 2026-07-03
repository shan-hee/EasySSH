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
  ArchiveRestore,
  Bot,
  FileText,
  FolderOpen,
  Info,
  Loader2,
  Menu,
  Minus,
  RefreshCw,
  Square,
  X,
  toast,
} from "@easyssh/ssh-workspace/desktop"
import type { Locale } from "@/i18n"
import { DesktopService } from "../../bindings/github.com/easyssh/easyssh-desktop"
import type { DesktopRuntimeBindingInfo } from "../adapters/desktop-runtime"
import { DesktopHeaderActions } from "./desktop-header-actions"
import { desktopUpdateApi, type DesktopUpdateCheckResult } from "../adapters/desktop-update-api"
import { useTranslation } from "react-i18next"

export type DesktopView = "terminal" | "ai" | "scripts" | "activity-logs" | "backup-restore"

const windowActionErrorMessage = "Failed to run window action:"
const githubLabel = "GitHub"
const githubUrl = "https://github.com/shan-hee/EasySSH"

function runWindowAction(action: () => Promise<void>) {
  void action().catch((error) => {
    console.error(windowActionErrorMessage, error)
  })
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
  const version = runtime?.version || t("desktopUnknownLabel")
  const rows = [
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
          <DialogDescription>EasySSH</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="easyssh-desktop-about-row">
            <span className="text-muted-foreground">{t("desktopVersionLabel")}</span>
            <DesktopAboutVersionValue version={version} />
          </div>
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

function DesktopAboutVersionValue({ version }: { version: string }) {
  const { t } = useTranslation("desktop")
  const [result, setResult] = useState<DesktopUpdateCheckResult | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    let mounted = true

    desktopUpdateApi.getStatus()
      .then((next) => {
        if (mounted) setResult(next)
      })
      .catch(() => {
        // Best-effort: the inline action still lets the user check manually.
      })

    return () => {
      mounted = false
    }
  }, [])

  const handleCheckUpdate = useCallback(() => {
    if (checking) return

    setChecking(true)
    void desktopUpdateApi.checkForUpdate()
      .then((next) => {
        setResult(next)
        if (!next.has_update) {
          toast.success(t("updateLatestTitle"))
        }
      })
      .catch(() => {
        toast.error(t("updateCheckFailedTitle"))
      })
      .finally(() => setChecking(false))
  }, [checking, t])

  const updateVersion = result?.has_update ? result.latest_version : ""

  return (
    <span className="easyssh-desktop-about-version-value">
      <span className="min-w-0 truncate font-medium" title={version}>{version}</span>
      {updateVersion ? (
        <span className="easyssh-desktop-update-badge" title={t("updateAvailableTitle", { version: updateVersion })}>
          <span aria-hidden="true">↑</span>
          <span>{updateVersion}</span>
        </span>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="easyssh-desktop-about-update-button"
        disabled={checking}
        aria-label={t("updateCheckNowLabel")}
        title={t("updateCheckNowLabel")}
        onClick={handleCheckUpdate}
      >
        {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
      </Button>
    </span>
  )
}

function DesktopSettingsMenu({
  runtime,
  onOpenScripts,
  onOpenActivityLogs,
  onOpenBackupRestore,
}: {
  runtime: DesktopRuntimeBindingInfo | null
  onOpenScripts: () => void
  onOpenActivityLogs: () => void
  onOpenBackupRestore: () => void
}) {
  const { t } = useTranslation("desktop")
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
          <DropdownMenuItem onSelect={onOpenActivityLogs}>
            <Activity className="h-4 w-4" />
            <span>{t("activityLogLabel")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onOpenBackupRestore}>
            <ArchiveRestore className="h-4 w-4" />
            <span>{t("backupRestoreLabel")}</span>
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

      <DesktopAboutDialog
        open={aboutOpen}
        onOpenChange={setAboutOpen}
        runtime={runtime}
      />
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
  onOpenActivityLogs,
  onOpenBackupRestore,
}: {
  runtime: DesktopRuntimeBindingInfo | null
  activeView: DesktopView
  locale: Locale
  onToggleAiAssistant: () => void
  onLocaleChange: (locale: Locale) => void
  onOpenScripts: () => void
  onOpenActivityLogs: () => void
  onOpenBackupRestore: () => void
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
          onOpenActivityLogs={onOpenActivityLogs}
          onOpenBackupRestore={onOpenBackupRestore}
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
