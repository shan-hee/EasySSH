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
  ListChecks,
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
import { DesktopInlineUpdateAction } from "./desktop-inline-update-action"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"

export type DesktopView = "terminal" | "ai" | "scripts" | "tasks" | "activity-logs" | "backup-restore"

const windowActionErrorMessage = "Failed to run window action:"
const githubLabel = "GitHub"
const githubUrl = "https://github.com/shan-hee/EasySSH"
const aboutRowClassName = "grid min-w-0 grid-cols-[86px_minmax(0,1fr)] items-center gap-3 border-b border-[color-mix(in_oklab,var(--border)_55%,transparent)] py-2 text-[13px] last:border-b-0"
const titlebarIconButtonClassName = "size-[30px] [--wails-draggable:no-drag]"
const windowButtonClassName = "inline-flex h-full w-[46px] items-center justify-center border-0 bg-transparent p-0 text-foreground outline-none transition-colors duration-150 [--wails-draggable:no-drag] hover:bg-[color-mix(in_oklab,var(--accent)_75%,transparent)] focus-visible:bg-[color-mix(in_oklab,var(--accent)_85%,transparent)] focus-visible:shadow-[inset_0_0_0_1px_var(--ring)]"

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
      <DialogContent className="w-[min(560px,calc(100vw-32px))] max-w-[min(560px,calc(100vw-32px))] sm:max-w-[min(560px,calc(100vw-32px))] [--wails-draggable:no-drag]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Info className="h-5 w-5" />
            {t("aboutDesktopTitle")}
          </DialogTitle>
          <DialogDescription>EasySSH</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className={aboutRowClassName}>
            <span className="text-muted-foreground">{t("desktopVersionLabel")}</span>
            <DesktopAboutVersionValue version={version} />
          </div>
          {rows.map(([label, value]) => (
            <div key={label} className={aboutRowClassName}>
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
  const hasInlineUpdateAction = Boolean(result?.has_update && result.latest_version)

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

  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 truncate font-medium" title={version}>{version}</span>
      <DesktopInlineUpdateAction initialResult={result} onResultChange={setResult} />
      {!hasInlineUpdateAction ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-[26px] min-w-[26px] shrink-0"
          disabled={checking}
          aria-label={t("updateCheckNowLabel")}
          title={t("updateCheckNowLabel")}
          onClick={handleCheckUpdate}
        >
          {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      ) : null}
    </span>
  )
}

function DesktopSettingsMenu({
  runtime,
  onOpenScripts,
  onOpenTasks,
  onOpenActivityLogs,
  onOpenBackupRestore,
}: {
  runtime: DesktopRuntimeBindingInfo | null
  onOpenScripts: () => void
  onOpenTasks: (taskID?: string) => void
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
            className={titlebarIconButtonClassName}
            aria-label={t("settingsLabel")}
            title={t("settingsLabel")}
          >
            <Menu className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[196px] [--wails-draggable:no-drag] [&_[data-slot=dropdown-menu-item]]:cursor-default">
          <DropdownMenuLabel>{t("settingsLabel")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onOpenScripts}>
            <FileText className="h-4 w-4" />
            <span>{t("scriptLibraryLabel")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onOpenTasks()}>
            <ListChecks className="h-4 w-4" />
            <span>{t("taskManagementLabel")}</span>
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
  onOpenTasks,
  onOpenActivityLogs,
  onOpenBackupRestore,
}: {
  runtime: DesktopRuntimeBindingInfo | null
  activeView: DesktopView
  locale: Locale
  onToggleAiAssistant: () => void
  onLocaleChange: (locale: Locale) => void
  onOpenScripts: () => void
  onOpenTasks: (taskID?: string) => void
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
    <header className="flex h-9 shrink-0 basis-9 items-center justify-between border-b border-[color-mix(in_oklab,var(--border)_45%,transparent)] bg-[color-mix(in_oklab,var(--background)_94%,transparent)] text-foreground backdrop-blur-md [--wails-draggable:drag]">
      <div className="flex h-full min-w-0 flex-1 items-center gap-2 px-3 [--wails-draggable:drag]">
        <img className="size-4 shrink-0" src="/favicon.ico" alt="" aria-hidden="true" />
        <span className="min-w-0 truncate text-xs leading-none">EasySSH</span>
      </div>
      <div className="flex h-full min-w-0 shrink-0 items-center gap-1 pl-2 [--wails-draggable:no-drag] [&_[data-radix-popper-content-wrapper]]:[--wails-draggable:no-drag] [&_[data-slot=button]]:size-[30px] [&_a]:[--wails-draggable:no-drag] [&_button]:[--wails-draggable:no-drag] [&_svg]:pointer-events-none">
        <DesktopSettingsMenu
          runtime={runtime}
          onOpenScripts={onOpenScripts}
          onOpenTasks={onOpenTasks}
          onOpenActivityLogs={onOpenActivityLogs}
          onOpenBackupRestore={onOpenBackupRestore}
        />
        {activeView !== "ai" && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={titlebarIconButtonClassName}
            aria-label={t("aiAssistantLabel")}
            title={t("aiAssistantLabel")}
            onClick={onToggleAiAssistant}
          >
            <Bot className="h-4 w-4" />
          </Button>
        )}
        <DesktopHeaderActions locale={locale} onLocaleChange={onLocaleChange} onOpenTask={onOpenTasks} />
        <div className="ml-1 flex h-full items-stretch [--wails-draggable:no-drag]" role="group" aria-label={t("windowControlsLabel")}>
          <button
            type="button"
            className={windowButtonClassName}
            aria-label={t("windowMinimizeLabel")}
            title={t("windowMinimizeLabel")}
            onClick={handleMinimize}
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={windowButtonClassName}
            aria-label={t("windowMaximizeLabel")}
            title={t("windowMaximizeLabel")}
            onClick={handleMaximize}
          >
            <Square className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={cn(
              windowButtonClassName,
              "hover:!bg-[oklch(0.577_0.245_27.325)] hover:text-white focus-visible:!bg-[oklch(0.577_0.245_27.325)] focus-visible:text-white"
            )}
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
