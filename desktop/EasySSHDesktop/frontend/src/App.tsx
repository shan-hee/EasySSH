import { startDesktopSync } from "./adapters/desktop-sync"
import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react"
import { RoutePending } from "@easyssh/app/components/route-pending"
import { Button } from "@easyssh/app/components/ui/button"
import { Link2 } from "lucide-react"
import { OpenShareDialog } from "./remote/open-share-dialog"
import { useTranslation } from "react-i18next"
import {
  DEFAULT_SYSTEM_CONFIG,
  SshWorkspace,
  WORKSPACE_CAPABILITY_PRESETS,
  WORKBENCH_VIEW,
  Workbench,
  WorkspaceShell,
  createTerminalWorkspaceSessionControllerAdapter,
  createTerminalWorkspaceSessionStoreAdapter,
  createWorkspaceAdapters,
  createWorkspaceCapabilitiesFromRuntime,
  createWorkspaceI18nAdapter,
  createWorkspaceSettingsAdapter,
  toast,
  useWorkbenchSessions,
  type DirectTransferOptions,
  type SshWorkspaceApiClient,
} from "@easyssh/app/desktop"
import { i18n, type Locale } from "@easyssh/app/i18n"
import { getEffectiveLocale, saveLocaleToStorage } from "@easyssh/app/utils/datetime"
import { createDesktopActivityLogAdapter, createDesktopTransferHistoryAdapter } from "./adapters/desktop-activity-log-adapter"
import { createDesktopAIAssistantAdapters } from "./adapters/desktop-ai-adapters"
import { createDesktopPreferenceAdapter, loadDesktopPreferenceSnapshot, type DesktopPreferenceSnapshot } from "./adapters/desktop-preferences"
import { createDesktopRuntime, loadDesktopRuntime, type DesktopRuntimeBindingInfo } from "./adapters/desktop-runtime"
import { createDesktopServerApi, saveDesktopVerifiedCredential } from "./adapters/desktop-server-api"
import { createDesktopDockerApi } from "./adapters/desktop-docker-api"
import { createDesktopMonitorApi } from "./adapters/desktop-monitor-api"
import { createDesktopScriptAdapters } from "./adapters/desktop-script-api"
import { desktopSystemInfoApi } from "./adapters/desktop-system-info"
import { createDesktopSftpApi } from "./adapters/desktop-sftp-api"
import { DesktopProviders } from "./shell/desktop-providers"
import { DesktopWindowActions } from "./shell/desktop-titlebar"
import { DesktopPageHeader } from "./shell/desktop-page-header"
import { DesktopViewBoundary } from "./shell/desktop-view-boundary"
import { desktopViews, preloadDesktopView, type DesktopView } from "./shell/desktop-view-registry"
import { DesktopUpdateFailureDialog } from "./shell/desktop-update-failure-dialog"
import { createDesktopTerminalSocket } from "./terminal/desktop-terminal-socket"
import { useFileTransfer, type FileTransferSftpApi } from "@easyssh/app/hooks/useFileTransfer"
import type { TransferJob, TransferStartOptions } from "@easyssh/app/desktop"

const restoreSessionTransfer = (job: TransferJob) => job.kind !== "sftp_transfer"

const DesktopAIAssistantView = desktopViews.ai.Component
const DesktopActivityLogsView = desktopViews["activity-logs"].Component
const DesktopBackupRestoreView = desktopViews["backup-restore"].Component
const DesktopSyncView = desktopViews.sync.Component
const DesktopScriptsView = desktopViews.scripts.Component
const DesktopSSHKeysView = desktopViews["ssh-keys"].Component
const DesktopTaskCenterView = desktopViews.tasks.Component

function App() {
  const [activeView, setActiveView] = useState<DesktopView>(WORKBENCH_VIEW)

  return (
    <DesktopProviders aiAssistantActive={activeView === "ai"}>
      <DesktopContent activeView={activeView} setActiveView={setActiveView} />
    </DesktopProviders>
  )
}

function DesktopContent({ activeView, setActiveView }: {
  activeView: DesktopView
  setActiveView: Dispatch<SetStateAction<DesktopView>>
}) {
  useEffect(() => startDesktopSync(), [])
  const [locale, setLocale] = useState<Locale>(() => getEffectiveLocale(null, DEFAULT_SYSTEM_CONFIG))
  const [runtime, setRuntime] = useState<DesktopRuntimeBindingInfo | null>(null)
  const [runtimeLoaded, setRuntimeLoaded] = useState(false)
  const [preferenceSnapshot, setPreferenceSnapshot] = useState<DesktopPreferenceSnapshot | null>(null)
  const [requestedTaskRunID, setRequestedTaskRunID] = useState<string | null>(null)
  useEffect(() => {
    const open = (event: Event) => { const id = (event as CustomEvent<{ id: string }>).detail?.id; if (id) { setRequestedTaskRunID(id); setActiveView("tasks") } }
    window.addEventListener("easyssh:open-task", open)
    return () => window.removeEventListener("easyssh:open-task", open)
  }, [setActiveView])
  const [terminalSettingsOpen, setTerminalSettingsOpen] = useState(false)
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const { t: tSharing } = useTranslation("sharing")
  const { t: tCommon } = useTranslation("common")
  const { t: tTerminal } = useTranslation("terminal")
  const { t: tSftp } = useTranslation("sftp")

  const serverApi = useMemo(() => createDesktopServerApi(), [])
  const scriptAdapters = useMemo(() => createDesktopScriptAdapters(serverApi), [serverApi])
  const aiAssistantAdapters = useMemo(() => createDesktopAIAssistantAdapters(serverApi), [serverApi])
  const activityLog = useMemo(() => createDesktopActivityLogAdapter(), [])
  const transferHistory = useMemo(() => createDesktopTransferHistoryAdapter(), [])
  const workspaceSessionStore = useMemo(() => createTerminalWorkspaceSessionStoreAdapter(), [])
  const workspaceSessionController = useMemo(() => createTerminalWorkspaceSessionControllerAdapter(), [])
  const workspacePreferences = useMemo(() => createDesktopPreferenceAdapter(preferenceSnapshot ?? {}), [preferenceSnapshot])
  const desktopGateway = runtime?.gateway
  const desktopGatewayWsBaseUrl = desktopGateway?.wsBaseUrl
  const desktopGatewayToken = desktopGateway?.token
  const desktopTerminalGatewayReady = Boolean(desktopGatewayWsBaseUrl && desktopGatewayToken)
  const desktopTerminalTransportReady = desktopTerminalGatewayReady || runtimeLoaded
  const sftpApi = useMemo(() => createDesktopSftpApi(desktopGateway, runtimeLoaded), [desktopGateway, runtimeLoaded])
  const fileTransfer = useFileTransfer({
    api: sftpApi as FileTransferSftpApi,
    // 服务器间传输由终端的跨会话实例负责。
    restore: restoreSessionTransfer,
  })
  const monitorApi = useMemo(
    () => createDesktopMonitorApi(desktopGateway),
    [desktopGateway],
  )
  const dockerApi = useMemo(() => createDesktopDockerApi(), [])
  const terminalSocket = useMemo(() => createDesktopTerminalSocket(), [])
  const runtimeInfo = useMemo(() => createDesktopRuntime(runtime), [runtime])
  const capabilities = useMemo(() => (
    createWorkspaceCapabilitiesFromRuntime(runtimeInfo, WORKSPACE_CAPABILITY_PRESETS.desktop)
  ), [runtimeInfo])
  // 连接活动与最近连接时间由桌面服务在连接建立时记录。
  const workbench = useWorkbenchSessions()
  const { getCombinedSessions } = workbench

  const workspaceApi = useMemo<SshWorkspaceApiClient>(() => ({
    sftp: {
      ...sftpApi,
      directTransfer: (
        sourceServerId: string,
        sourcePath: string,
        targetServerId: string,
        targetPath: string,
        options: DirectTransferOptions & TransferStartOptions,
      ) => {
        const sourceSession = getCombinedSessions().find((session) => session.serverId === sourceServerId)
        const targetSession = getCombinedSessions().find((session) => session.serverId === targetServerId)

        return sftpApi.directTransfer?.(sourceServerId, sourcePath, targetServerId, targetPath, {
          ...options,
          sourceServerName: options.sourceServerName ?? sourceSession?.serverName ?? sourceServerId,
          sourceAuthMethod: options.sourceAuthMethod ?? sourceSession?.authMethod ?? "password",
          targetServerName: options.targetServerName ?? targetSession?.serverName ?? targetServerId,
          targetAuthMethod: options.targetAuthMethod ?? targetSession?.authMethod ?? "password",
        }) ?? Promise.reject(new Error("SFTP direct transfer is unavailable"))
      },
    },
    monitor: monitorApi,
    docker: dockerApi,
    scripts: scriptAdapters.scripts,
    systemInfo: desktopSystemInfoApi,
    terminal: {
      ...(desktopTerminalGatewayReady || !runtimeLoaded ? {} : { WebSocketCtor: terminalSocket }),
      createWebSocketUrl: ({ serverId, cols, rows, ticket }) => {
        const params = new URLSearchParams()
        params.set("serverId", serverId)
        params.set("cols", String(cols))
        params.set("rows", String(rows))
        if (desktopTerminalGatewayReady) {
          params.set("ticket", ticket || desktopGatewayToken || "desktop")
          return `${desktopGatewayWsBaseUrl}/terminal?${params.toString()}`
        }
        if (!runtimeLoaded) {
          throw new Error("desktop terminal runtime is not ready")
        }
        return `desktop://terminal?${params.toString()}`
      },
      saveVerifiedCredential: async ({ serverId, authMethod, secret, password, privateKey, privateKeyPassphrase }) => {
        await saveDesktopVerifiedCredential({ serverId, authMethod, secret, password, privateKey, privateKeyPassphrase })
      },
    },
  }), [desktopGatewayToken, desktopGatewayWsBaseUrl, desktopTerminalGatewayReady, dockerApi, getCombinedSessions, monitorApi, runtimeLoaded, scriptAdapters.scripts, sftpApi, terminalSocket])

  const handleLocaleChange = useCallback((nextLocale: Locale) => {
    if (nextLocale === locale) {
      return
    }

    saveLocaleToStorage(nextLocale)
    setLocale(nextLocale)
  }, [locale])

  const adapters = useMemo(() => createWorkspaceAdapters({
    apiClient: workspaceApi,
    authTicketProvider: async () => desktopGatewayToken ?? "desktop",
    i18n: createWorkspaceI18nAdapter({
      locale,
      timezone: "Asia/Shanghai",
      common: tCommon,
      terminal: tTerminal,
      sftp: tSftp,
      fallback: (key: string) => key,
    }),
    notifier: {
      success: (message) => toast.success(message),
      error: (message) => toast.error(message),
      action: (message, options) => toast(message, {
        description: options.description,
        action: {
          label: options.actionLabel,
          onClick: options.onAction,
        },
      }),
      promise: (promise, messages) => toast.promise(promise, messages),
    },
    settings: createWorkspaceSettingsAdapter({
      sftp: {
        downloadExcludePatterns: DEFAULT_SYSTEM_CONFIG.download_exclude_patterns,
      },
    }),
    preferences: workspacePreferences,
    transferManager: {
      tasks: fileTransfer.tasks,
      downloadFile: fileTransfer.downloadFile,
      batchDownload: fileTransfer.batchDownload,
      uploadFile: fileTransfer.uploadFile,
      directTransfer: fileTransfer.directTransfer,
      updateTask: fileTransfer.updateTask,
      removeTask: fileTransfer.removeTask,
      clearAll: fileTransfer.clearAll,
      retryTask: fileTransfer.retryTask,
      cancelTask: fileTransfer.cancelTask,
      history: transferHistory,
    },
    activityLog,
    sessionStore: workspaceSessionStore,
    sessionController: workspaceSessionController,
  }), [
    activityLog,
    locale,
    tCommon,
    tSftp,
    tTerminal,
    workspaceApi,
    desktopGatewayToken,
    fileTransfer.batchDownload,
    fileTransfer.cancelTask,
    fileTransfer.clearAll,
    fileTransfer.directTransfer,
    fileTransfer.downloadFile,
    fileTransfer.removeTask,
    fileTransfer.retryTask,
    fileTransfer.tasks,
    fileTransfer.updateTask,
    fileTransfer.uploadFile,
    transferHistory,
    workspacePreferences,
    workspaceSessionController,
    workspaceSessionStore,
  ])

  useEffect(() => {
    void i18n.changeLanguage(locale)
  }, [locale])

  useEffect(() => {
    let mounted = true

    loadDesktopRuntime()
      .then((runtimeInfo) => {
        if (mounted) {
          setRuntime(runtimeInfo)
        }
      })
      .catch((error) => {
        console.error("Failed to load desktop runtime:", error)
      })
      .finally(() => {
        if (mounted) {
          setRuntimeLoaded(true)
        }
      })

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    let mounted = true

    loadDesktopPreferenceSnapshot()
      .then((snapshot) => {
        if (mounted) setPreferenceSnapshot(snapshot)
      })
      .catch((error) => {
        console.error("Failed to load desktop preferences:", error)
        if (mounted) setPreferenceSnapshot({})
      })

    return () => {
      mounted = false
    }
  }, [])

  const handleToggleAiAssistant = useCallback(() => {
    preloadDesktopView("ai")
    setActiveView((current) => (current === "ai" ? WORKBENCH_VIEW : "ai"))
  }, [setActiveView])

  const handleOpenScripts = useCallback(() => {
    preloadDesktopView("scripts")
    setActiveView("scripts")
  }, [setActiveView])

  const handleOpenTasks = useCallback((taskID?: string) => {
    preloadDesktopView("tasks")
    setRequestedTaskRunID(taskID || null)
    setActiveView("tasks")
  }, [setActiveView])

  const handleOpenActivityLogs = useCallback(() => {
    preloadDesktopView("activity-logs")
    setActiveView("activity-logs")
  }, [setActiveView])

  const handleOpenBackupRestore = useCallback(() => {
    preloadDesktopView("backup-restore")
    setActiveView("backup-restore")
  }, [setActiveView])

  const handleOpenSync = useCallback(() => {
    preloadDesktopView("sync")
    setActiveView("sync")
  }, [setActiveView])
  const handleOpenSSHKeys = useCallback(() => {
    preloadDesktopView("ssh-keys")
    setActiveView("ssh-keys")
  }, [setActiveView])

  const handleReturnToWorkbench = useCallback(() => {
    setRequestedTaskRunID(null)
    setActiveView(WORKBENCH_VIEW)
  }, [setActiveView])

  const windowActions = (
    <DesktopWindowActions
      runtime={runtime}
      activeView={activeView}
      locale={locale}
      onToggleAiAssistant={handleToggleAiAssistant}
      onLocaleChange={handleLocaleChange}
      onOpenScripts={handleOpenScripts}
      onOpenSSHKeys={handleOpenSSHKeys}
      onOpenTasks={handleOpenTasks}
      onOpenActivityLogs={handleOpenActivityLogs}
      onOpenBackupRestore={handleOpenBackupRestore}
      onOpenSync={handleOpenSync}
    />
  )

  if (preferenceSnapshot === null) {
    return (
      <>
        <main className="flex h-full w-full min-h-0 min-w-0 isolate flex-col overflow-hidden bg-background text-foreground">
          <header className="flex h-10 shrink-0 items-stretch border-b border-border/60 bg-transparent [--wails-draggable:drag]">
            <div className="min-w-0 flex-1 [--wails-draggable:drag]" />
            {windowActions}
          </header>
          <RoutePending />
        </main>
        <DesktopUpdateFailureDialog />
      </>
    )
  }

  return (
    <SshWorkspace adapters={adapters} capabilities={capabilities} layout="desktop">
      <WorkspaceShell
        activeView={activeView}
        viewHeader={activeView !== WORKBENCH_VIEW && (
          <DesktopPageHeader view={activeView} onReturnToTerminal={handleReturnToWorkbench} actions={windowActions} />
        )}
        workbench={(
          <Workbench
            workbench={workbench}
            serverApi={serverApi}
            serverToolbarActions={(
              <Button
                variant="outline"
                size="icon"
                title={tSharing("openSharedLink")}
                aria-label={tSharing("openSharedLink")}
                onClick={() => setShareDialogOpen(true)}
              >
                <Link2 className="size-4" />
              </Button>
            )}
            serversReady
            terminalTransportReady={desktopTerminalTransportReady}
            aiAssistantAdapters={aiAssistantAdapters}
            hidePageHeader
            unframed
            settingsDialogOpen={terminalSettingsOpen}
            onSettingsDialogOpenChange={setTerminalSettingsOpen}
            tabBarEndContent={activeView === WORKBENCH_VIEW ? windowActions : undefined}
          />
        )}
        views={[
          {
            id: "ai",
            content: (
              <DesktopViewBoundary view="ai">
                <DesktopAIAssistantView active={activeView === "ai"} adapters={aiAssistantAdapters} locale={locale} />
              </DesktopViewBoundary>
            ),
          },
          {
            id: "scripts",
            content: (
              <DesktopViewBoundary view="scripts">
                <DesktopScriptsView adapters={scriptAdapters} locale={locale} />
              </DesktopViewBoundary>
            ),
          },
          {
            id: "tasks",
            content: (
              <DesktopViewBoundary view="tasks">
                <DesktopTaskCenterView
                  locale={locale}
                  requestedRunID={requestedTaskRunID}
                  onClearRequestedRun={() => setRequestedTaskRunID(null)}
                />
              </DesktopViewBoundary>
            ),
          },
          {
            id: "activity-logs",
            content: (
              <DesktopViewBoundary view="activity-logs">
                <DesktopActivityLogsView locale={locale} />
              </DesktopViewBoundary>
            ),
          },
          {
            id: "backup-restore",
            content: (
              <DesktopViewBoundary view="backup-restore">
                <DesktopBackupRestoreView locale={locale} />
              </DesktopViewBoundary>
            ),
          },
          {
            id: "ssh-keys",
            keepAlive: false,
            className: "flex-col",
            content: (
              <DesktopViewBoundary view="ssh-keys">
                <DesktopSSHKeysView locale={locale} />
              </DesktopViewBoundary>
            ),
          },
          {
            id: "sync",
            keepAlive: false,
            content: (
              <DesktopViewBoundary view="sync">
                <DesktopSyncView locale={locale} />
              </DesktopViewBoundary>
            ),
          },
        ]}
      />
      <DesktopUpdateFailureDialog />
      <OpenShareDialog open={shareDialogOpen} onOpenChange={setShareDialogOpen} />
    </SshWorkspace>
  )
}

export default App
