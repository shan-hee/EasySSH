import { TERMINAL_MONITOR_INTERVAL_SECONDS } from "./terminal-settings"
import { SessionWorkspaceToolbar } from "@/components/tabs/session-workspace-toolbar"
/**
 * 单个页签的完整内容组件
 * 每个 TabsContent 渲染一个独立的 TabTerminalContent
 * 包含独立的 MonitorWebSocketProvider
 */

import React, { useEffect, useMemo, useState } from 'react'
import { MonitorWebSocketProvider } from './monitor/contexts/MonitorWebSocketContext'
import { MonitorSkeleton } from './monitor/components/MonitorSkeleton'
import { Button } from '@/components/ui/button'
import { FolderOpen, Activity, Bot, Search } from 'lucide-react'
import { NetworkLatencyPopover } from './network-latency-popover'
import { WebTerminal } from './web-terminal'
import {
  ConnectionLoader,
  type ConnectionLoaderOutcome,
} from './connection-loader'
import { FileManagerPanel } from './file-manager-panel'
import type { AIAssistantWorkspaceAdapters } from '@/components/ai-agent/ai-assistant-workspace-view'
import { DockerPopover } from './docker'
import { useSftpSession } from '@/hooks/useSftpSession'
import { cn } from '@/lib/utils'
import { useTabUIStore } from '@/stores/tab-ui-store'
import { useOptionalSshWorkspace } from '@/components/ssh-workspace/ssh-workspace'
import { assertCompleteSftpSessionApi } from '@/lib/session/sftp-session-api'
import { createWorkspaceTransferAuthTicketProviderAdapter } from '@/lib/session/workspace-adapters'
import type { TerminalConnectionPhase, TerminalSession } from './types'
import {
  buildTerminalCompletionConfig,
  buildTerminalCompletionFetchOptions,
  resolveTerminalBoldFontWeight,
  buildTerminalCompletionProviderFlags,
  type TerminalSettings,
} from './terminal-settings'
import type { WorkspaceTransferTask } from "@/lib/session/workspace"
import { useTranslation } from "react-i18next"
import type { TerminalInputApi } from "./use-terminal-container-api"
import { useEffectiveThemeMode } from "@/hooks/use-effective-theme-mode"
import { getTerminalTheme } from "./terminal-themes"
import {
  resolveTerminalAppThemeMode,
  resolveTerminalThemeName,
} from "./use-terminal-renderer-settings"

const loadMonitorPanel = () => (
  import("./monitor/MonitorPanel").then((module) => ({ default: module.MonitorPanel }))
)
const MonitorPanel = React.lazy(loadMonitorPanel)
const loadAiAssistantPanel = () => (
  import("./ai-assistant-panel").then((module) => ({ default: module.AiAssistantPanel }))
)
const AiAssistantPanel = React.lazy(loadAiAssistantPanel)

const monitorFallback = <div className="h-full w-[280px] px-3 py-1.5"><MonitorSkeleton /></div>

const DESKTOP_TERMINAL_LAYOUT_QUERY = '(min-width: 768px)'
const DEFAULT_TERMINAL_SFTP_INITIAL_PATH = '/root'
const BACKGROUND_WEBGL_HIBERNATE_DELAY_MS = 5_000

type ConnectionLoaderMessageKey =
  | "connectionLoaderConnecting"
  | "connectionLoaderPreparing"
  | "connectionLoaderTransport"
  | "connectionLoaderSsh"
  | "connectionLoaderAuthenticating"
  | "connectionLoaderReconnecting"
  | "connectionLoaderSuccess"
  | "connectionLoaderFailed"
  | "connectionLoaderClosed"

type InternalBackHandler = {
  handle: () => boolean | Promise<boolean>
}

const getConnectionLoaderMessageKey = (
  phase: TerminalConnectionPhase
): ConnectionLoaderMessageKey => {
  if (phase === "idle" || phase === "ticket") {
    return "connectionLoaderPreparing"
  }

  if (phase === "ws_connecting") {
    return "connectionLoaderTransport"
  }

  if (phase === "ssh_connecting") {
    return "connectionLoaderSsh"
  }

  if (phase === "authenticating") {
    return "connectionLoaderAuthenticating"
  }

  if (phase === "reconnecting") {
    return "connectionLoaderReconnecting"
  }

  return "connectionLoaderConnecting"
}

const getConnectionLoaderExitMessageKey = (
  phase: TerminalConnectionPhase
): ConnectionLoaderMessageKey => {
  if (phase === "failed") {
    return "connectionLoaderFailed"
  }

  if (phase === "closed" || phase === "idle") {
    return "connectionLoaderClosed"
  }

  return "connectionLoaderSuccess"
}

const getConnectionLoaderOutcome = (
  phase: TerminalConnectionPhase
): ConnectionLoaderOutcome => {
  if (phase === "failed") return "error"
  if (phase === "closed" || phase === "idle") return "neutral"
  return "success"
}

interface TabTerminalContentProps {
  session: TerminalSession
  isActive: boolean
  keyboardActive?: boolean
  settings: TerminalSettings
  chrome?: "full" | "toolbar" | "content"
  surface?: "normal" | "transparent"
  effectiveIsLoading: boolean
  loaderState: "entering" | "loading" | "exiting"
  onAnimationComplete: (sessionId: string) => void
  onCommand: (sessionId: string, command: string) => void
  onConnectionPhaseChange?: (sessionId: string, phase: TerminalConnectionPhase) => void
  onAuthCancelled?: (sessionId: string) => void
  aiAssistantAdapters?: AIAssistantWorkspaceAdapters
  onInternalBackHandlerChange?: (
    sessionId: string,
    handler: InternalBackHandler | null
  ) => void
  onInternalBackAvailabilityChange?: (sessionId: string, available: boolean) => void
  onSftpPathChange?: (sessionId: string, path: string) => void
  initialSftpPath?: string
  sftpRefreshRequestVersion?: number
  externalTransferTasks?: WorkspaceTransferTask[]
  onClearExternalCompletedTransfers?: () => void
  onCancelExternalTransfer?: (taskId: string) => void
}

function TabTerminalContentComponent({
  session,
  isActive,
  keyboardActive = isActive,
  settings,
  chrome = "full",
  surface = "normal",
  effectiveIsLoading,
  loaderState,
  onAnimationComplete,
  onCommand,
  onConnectionPhaseChange,
  onAuthCancelled,
  aiAssistantAdapters,
  onInternalBackHandlerChange,
  onInternalBackAvailabilityChange,
  onSftpPathChange,
  initialSftpPath = DEFAULT_TERMINAL_SFTP_INITIAL_PATH,
  sftpRefreshRequestVersion = 0,
  externalTransferTasks = [],
  onClearExternalCompletedTransfers,
  onCancelExternalTransfer,
}: TabTerminalContentProps) {
  const [sftpInternalBackHandler, setSftpInternalBackHandler] =
    useState<InternalBackHandler | null>(null)
  const [hasOpenedFileManager, setHasOpenedFileManager] = useState(false)
  const [hasOpenedAi, setHasOpenedAi] = useState(false)
  const [hasOpenedMonitor, setHasOpenedMonitor] = useState(false)
  const [sftpSessionInitialPath, setSftpSessionInitialPath] = useState(initialSftpPath)
  const terminalInputApiRef = React.useRef<TerminalInputApi | null>(null)
  const [hasTerminalInputApi, setHasTerminalInputApi] = useState(false)
  const lastSftpRefreshRequestVersionRef = React.useRef(sftpRefreshRequestVersion)
  const [isDesktopLayout, setIsDesktopLayout] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return true
    }

    return window.matchMedia(DESKTOP_TERMINAL_LAYOUT_QUERY).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }

    const mediaQuery = window.matchMedia(DESKTOP_TERMINAL_LAYOUT_QUERY)
    const handleChange = () => setIsDesktopLayout(mediaQuery.matches)

    handleChange()
    mediaQuery.addEventListener('change', handleChange)

    return () => {
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [])

  // 从 Store 获取当前页签的 UI 状态
  const tabState = useTabUIStore((state) => state.getTabState(session.id))
  const setTabState = useTabUIStore((state) => state.setTabState)
  const workspace = useOptionalSshWorkspace()
  const {
    mode: effectiveAppTheme,
    version: effectiveThemeVersion,
  } = useEffectiveThemeMode()
  const workspaceCapabilities = workspace?.capabilities
  const workspaceTheme = workspace?.adapters.theme
  const isDesktopWorkspace = workspace?.layout === "desktop"
  const canUseSftpCapability = workspaceCapabilities?.sftp !== false
  const canUseMonitorCapability = workspaceCapabilities?.monitor !== false
  const canUseAiCapability = workspaceCapabilities?.ai !== false
  const canUseDockerCapability = workspaceCapabilities?.docker !== false
  const canShowLatency = canUseMonitorCapability

  const isDesktopMonitorOpen = tabState.isMonitorOpen
  const isMobileMonitorOpen = tabState.isMobileMonitorOpen ?? false
  const isMonitorButtonActive = canUseMonitorCapability && (
    isDesktopLayout ? isDesktopMonitorOpen : isMobileMonitorOpen
  )
  const isFileManagerOpen = tabState.isFileManagerOpen
  const isAiInputOpen = tabState.isAiInputOpen

  const isTerminalSession = session.type === 'terminal'
  const isTerminalReady = session.connectionPhase === "ready"
  const hasReadyServer = isTerminalSession && isTerminalReady && !!session.serverId
  const canRenderInlinePanels = chrome === "full"
  const canMountFileManager = chrome !== "toolbar" && canUseSftpCapability && hasReadyServer
  const canUseFileManager = canMountFileManager && isActive && isFileManagerOpen
  const isFileManagerSessionActive = canMountFileManager && (
    canUseFileManager || hasOpenedFileManager
  )
  const canMountAi = canRenderInlinePanels && canUseAiCapability && isActive && isTerminalSession && !effectiveIsLoading
  const canUseAi = canMountAi && isAiInputOpen
  const shouldMountAi = canMountAi && (canUseAi || hasOpenedAi)
  // 连接覆盖层显示期间先按用户状态预留宽度，避免终端露出后再把面板从 0 推到 280px。
  // 连接期间预加载模块；数据订阅仍等 ready。关闭面板后保留图表实例。
  const shouldReserveInlineMonitor =
    canRenderInlinePanels &&
    canUseMonitorCapability &&
    isDesktopLayout &&
    isDesktopMonitorOpen &&
    (effectiveIsLoading || hasReadyServer)
  const shouldMountInlineMonitor =
    canRenderInlinePanels &&
    canUseMonitorCapability &&
    isDesktopLayout &&
    (isDesktopMonitorOpen || hasOpenedMonitor) &&
    hasReadyServer &&
    !!session.serverId
  const shouldReserveMobileMonitor =
    canRenderInlinePanels &&
    canUseMonitorCapability &&
    hasReadyServer &&
    isMobileMonitorOpen &&
    !isDesktopLayout
  const canUseMobileMonitor = isActive && shouldReserveMobileMonitor

  useEffect(() => {
    if (!hasReadyServer) {
      setHasOpenedMonitor(false)
    } else if (isDesktopMonitorOpen) {
      setHasOpenedMonitor(true)
    }
  }, [hasReadyServer, isDesktopMonitorOpen])

  useEffect(() => {
    if (!shouldReserveInlineMonitor || !isActive || !session.shouldConnect) return
    void loadMonitorPanel().catch((error) => console.error('Failed to preload monitor panel:', error))
  }, [isActive, session.shouldConnect, shouldReserveInlineMonitor])

  useEffect(() => {
    if (!canMountFileManager) {
      setHasOpenedFileManager(false)
      return
    }

    if (canUseFileManager) {
      setHasOpenedFileManager(true)
    }
  }, [canMountFileManager, canUseFileManager])

  useEffect(() => {
    if (!canMountAi) {
      setHasOpenedAi(false)
      return
    }
    if (canUseAi) {
      setHasOpenedAi(true)
    }
  }, [canMountAi, canUseAi])

  const transferAuthTicketProvider = React.useMemo(
    () => createWorkspaceTransferAuthTicketProviderAdapter(workspace?.adapters.authTicketProvider),
    [workspace?.adapters.authTicketProvider]
  )
  const workspaceSftpApi = workspace?.adapters.apiClient?.sftp
  if (isDesktopWorkspace && !workspaceSftpApi) {
    throw new Error("Desktop terminal file manager requires a desktop SFTP api adapter")
  }
  if (isDesktopWorkspace) {
    assertCompleteSftpSessionApi(workspaceSftpApi, "Desktop terminal file manager")
  }
  const workspaceMonitorApi = workspace?.adapters.apiClient?.monitor
  if (isDesktopWorkspace && canUseMonitorCapability && !workspaceMonitorApi) {
    throw new Error("Desktop terminal monitor requires a desktop monitor api adapter")
  }
  const sftpFileTransferOptions = React.useMemo(
    () => ({
      createTicket: transferAuthTicketProvider,
      uploadUsesProgressSocket: workspaceSftpApi?.uploadUsesProgressSocket ?? true,
      serverTransferUsesProgressSocket: workspaceSftpApi?.serverTransferUsesProgressSocket ?? true,
    }),
    [transferAuthTicketProvider, workspaceSftpApi]
  )
  const sftpTranslate = React.useMemo(
    () => workspace?.adapters.i18n
      ? ((key: string, params?: Record<string, string | number>) => (
          workspace.adapters.i18n.t("sftp", key, params)
        ))
      : undefined,
    [workspace?.adapters.i18n]
  )
  const sftpSessionOptions = React.useMemo(
    () => ({
      api: workspaceSftpApi,
      notifier: workspace?.adapters.notifier,
      t: sftpTranslate,
      fileTransferOptions: sftpFileTransferOptions,
      transferManager: workspace?.adapters.transferManager,
    }),
    [
      sftpFileTransferOptions,
      sftpTranslate,
      workspaceSftpApi,
      workspace?.adapters.notifier,
      workspace?.adapters.transferManager,
    ]
  )

  const handleTerminalInputApiChange = React.useCallback((api: TerminalInputApi | null) => {
    terminalInputApiRef.current = api
    setHasTerminalInputApi(api !== null)
  }, [])
  const handleSessionCommand = React.useCallback((command: string) => {
    onCommand(session.id, command)
  }, [onCommand, session.id])
  const handleSessionConnectionPhaseChange = React.useCallback((phase: TerminalConnectionPhase) => {
    onConnectionPhaseChange?.(session.id, phase)
  }, [onConnectionPhaseChange, session.id])
  const handleSessionAuthCancelled = React.useCallback(() => {
    onAuthCancelled?.(session.id)
  }, [onAuthCancelled, session.id])
  const handleInsertTerminalText = React.useCallback((text: string) => {
    terminalInputApiRef.current?.insertText(text)
  }, [])
  const handleExecuteTerminalCommand = React.useCallback((command: string) => {
    terminalInputApiRef.current?.executeCommand(command)
  }, [])
  const toggleMonitor = () => {
    setTabState(
      session.id,
      isDesktopLayout
        ? { isMonitorOpen: !isDesktopMonitorOpen }
        : { isMobileMonitorOpen: !isMobileMonitorOpen }
    )
  }

  // 首次打开才加载；切换页签、收起面板和调整分屏时保留目录与编辑器。
  const sftpSession = useSftpSession(
    isFileManagerSessionActive && session.serverId
      ? session.serverId
      : '',
    sftpSessionInitialPath,
    sftpSessionOptions
  )

  useEffect(() => {
    if (isFileManagerSessionActive) {
      return
    }

    setSftpSessionInitialPath(initialSftpPath)
  }, [initialSftpPath, isFileManagerSessionActive])

  useEffect(() => {
    if (!isFileManagerSessionActive || !session.serverId) {
      return
    }

    onSftpPathChange?.(session.id, sftpSession.currentPath)
  }, [
    onSftpPathChange,
    session.id,
    session.serverId,
    sftpSession.currentPath,
    isFileManagerSessionActive,
  ])

  useEffect(() => {
    if (lastSftpRefreshRequestVersionRef.current === sftpRefreshRequestVersion) {
      return
    }

    lastSftpRefreshRequestVersionRef.current = sftpRefreshRequestVersion
    if (isFileManagerSessionActive && session.serverId) {
      sftpSession.refresh()
    }
  }, [
    session.serverId,
    sftpRefreshRequestVersion,
    sftpSession,
    isFileManagerSessionActive,
  ])

  const externalTransferTaskIds = React.useMemo(
    () => new Set(externalTransferTasks.map((task) => task.id)),
    [externalTransferTasks]
  )
  const combinedTransferTasks = React.useMemo(
    () => externalTransferTasks.length > 0
      ? [...sftpSession.transferTasks, ...externalTransferTasks]
      : sftpSession.transferTasks,
    [externalTransferTasks, sftpSession.transferTasks]
  )
  const handleClearCompletedTransfers = React.useCallback(() => {
    sftpSession.clearCompletedTransfers()
    onClearExternalCompletedTransfers?.()
  }, [onClearExternalCompletedTransfers, sftpSession])
  const handleCancelTransfer = React.useCallback((taskId: string) => {
    if (externalTransferTaskIds.has(taskId)) {
      onCancelExternalTransfer?.(taskId)
      return
    }

    sftpSession.cancelTransfer(taskId)
  }, [externalTransferTaskIds, onCancelExternalTransfer, sftpSession])

  // 监控数据源跟随已就绪的终端页签保持订阅；后台面板仅暂停图表绘制，历史仍持续积累。
  const connectedServerId =
    hasReadyServer && session.serverId
      ? session.serverId
      : ''
  const monitorEnabled = canRenderInlinePanels && canUseMonitorCapability && hasReadyServer
  const { t: tTerminal } = useTranslation("terminal")
  const { t: tSettings } = useTranslation("terminalSettings")
  const pageBackgroundImageLayerOpacity = settings.backgroundImageOpacity / 100
  const terminalSurfaceBackground = useMemo(() => {
    // Workspace theme adapters may update in place; the version invalidates this memo.
    void effectiveThemeVersion
    const effectiveTerminalTheme = resolveTerminalThemeName(
      workspaceTheme?.terminalTheme,
      settings.theme,
    )
    const effectiveTerminalAppTheme = resolveTerminalAppThemeMode(
      workspaceTheme?.mode,
      effectiveAppTheme,
    )

    return getTerminalTheme(effectiveTerminalTheme, effectiveTerminalAppTheme).background
  }, [
    effectiveAppTheme,
    effectiveThemeVersion,
    settings.theme,
    workspaceTheme?.mode,
    workspaceTheme?.terminalTheme,
  ])
  const completionSettings = useMemo(() => ({
    completionMode: settings.completionMode,
    completionUseHistory: settings.completionUseHistory,
    completionUseScripts: settings.completionUseScripts,
    completionUseRemotePaths: settings.completionUseRemotePaths,
  }), [settings.completionMode, settings.completionUseHistory, settings.completionUseScripts, settings.completionUseRemotePaths])
  const completionConfig = useMemo(() => buildTerminalCompletionConfig(completionSettings), [completionSettings])
  const completionProviderEnabled = useMemo(() => buildTerminalCompletionProviderFlags(completionSettings), [completionSettings])
  const completionFetchOptions = useMemo(() => buildTerminalCompletionFetchOptions(completionSettings), [completionSettings])
  const pathCompletionCwd = sftpSession.currentPath || sftpSessionInitialPath || initialSftpPath
  const hasBackgroundImage = isTerminalSession && settings.backgroundImage.trim().length > 0
  const [enableTerminalWebgl, setEnableTerminalWebgl] = useState(
    () => isActive
  )

  useEffect(() => {
    if (isActive) {
      setEnableTerminalWebgl(true)
      return
    }

    const hibernateTimer = window.setTimeout(() => {
      setEnableTerminalWebgl(false)
    }, BACKGROUND_WEBGL_HIBERNATE_DELAY_MS)

    return () => window.clearTimeout(hibernateTimer)
  }, [isActive])
  const connectionLoaderServerName =
    session.username && session.host
      ? `${session.username}@${session.host}`
      : session.serverName || session.host || session.serverId
  // 工具栏外壳始终占用固定高度；连接完成只挂载操作内容，不再改变终端可用高度。
  const shouldReserveToolbar =
    chrome !== "content" &&
    isTerminalSession
  const shouldRenderToolbarActions = !effectiveIsLoading
  const shouldRenderBody = chrome !== "toolbar"
  const shouldRenderSurface = surface !== "transparent"

  const canHandleInternalBack = isActive && (
    canUseFileManager ||
    canUseAi ||
    canUseMobileMonitor
  )
  const handleInternalBack = React.useCallback(async () => {
    if (!isActive) {
      return false
    }

    if (canUseFileManager) {
      if (sftpInternalBackHandler) {
        const handled = await sftpInternalBackHandler.handle()
        if (handled) {
          return true
        }
      }

      setTabState(session.id, { isFileManagerOpen: false })
      return true
    }

    if (canUseAi) {
      setTabState(session.id, { isAiInputOpen: false })
      return true
    }

    if (canUseMobileMonitor) {
      setTabState(session.id, { isMobileMonitorOpen: false })
      return true
    }

    return false
  }, [
    canUseAi,
    canUseFileManager,
    canUseMobileMonitor,
    isActive,
    session.id,
    setTabState,
    sftpInternalBackHandler,
  ])

  useEffect(() => {
    onInternalBackHandlerChange?.(
      session.id,
      canHandleInternalBack ? { handle: handleInternalBack } : null
    )

    return () => {
      onInternalBackHandlerChange?.(session.id, null)
    }
  }, [
    canHandleInternalBack,
    handleInternalBack,
    onInternalBackHandlerChange,
    session.id,
  ])

  useEffect(() => {
    onInternalBackAvailabilityChange?.(session.id, canHandleInternalBack)

    return () => {
      onInternalBackAvailabilityChange?.(session.id, false)
    }
  }, [canHandleInternalBack, onInternalBackAvailabilityChange, session.id])

  return (
    <MonitorWebSocketProvider
      serverId={connectedServerId}
      enabled={monitorEnabled}
      interval={TERMINAL_MONITOR_INTERVAL_SECONDS}
      monitorApi={workspaceMonitorApi}
    >
      <div className={cn(
        "flex min-w-0 flex-col relative overflow-hidden",
        shouldRenderBody ? "flex-1 h-full" : "shrink-0"
      )}>
        {shouldRenderSurface && (
          <div
            aria-hidden="true"
            className={cn(
              "absolute inset-0 pointer-events-none transition-colors",
              !isTerminalSession && "bg-background",
            )}
            style={isTerminalSession ? { backgroundColor: terminalSurfaceBackground } : undefined}
          />
        )}

        {shouldRenderSurface && hasBackgroundImage && (
          <div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none bg-cover bg-center bg-no-repeat"
            style={{
              backgroundImage: `url(${settings.backgroundImage})`,
              opacity: pageBackgroundImageLayerOpacity,
            }}
          />
        )}

        {/* 加载动画覆盖层 - 覆盖整个页签内容 */}
        {shouldRenderBody && effectiveIsLoading && isTerminalSession && (
          <div className="absolute inset-0 z-[60]">
            <ConnectionLoader
              serverName={connectionLoaderServerName}
              message={tTerminal(getConnectionLoaderMessageKey(session.connectionPhase))}
              exitMessage={tTerminal(getConnectionLoaderExitMessageKey(session.connectionPhase))}
              state={loaderState}
              outcome={getConnectionLoaderOutcome(session.connectionPhase)}
              onAnimationComplete={() => onAnimationComplete(session.id)}
            />
          </div>
        )}

        <div data-terminal-layout className={cn(
          "relative z-10 flex min-h-0 min-w-0",
          shouldRenderBody ? "flex-1" : "shrink-0"
        )}>
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {shouldReserveToolbar && (
            <SessionWorkspaceToolbar kind="terminal">
            <div
              className="flex min-h-10 items-stretch text-sm text-foreground transition-colors"
            >
              {/* 左侧工具图标组 */}
              {shouldRenderToolbarActions && (
                <div className="flex min-w-0 flex-1 items-center gap-1 px-3 py-1.5">
                {canUseSftpCapability && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-md transition-colors text-foreground hover:bg-accent/80 hover:text-accent-foreground"
                    aria-label={tTerminal("ariaFileManager")}
                    title={tTerminal("titleFileManagerWithShortcut")}
                    onClick={() => setTabState(session.id, { isFileManagerOpen: !isFileManagerOpen })}
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                  </Button>
                )}

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-md transition-colors text-foreground hover:bg-accent/80 hover:text-accent-foreground"
                  aria-label={tSettings("findShortcut")}
                  title={settings.findShortcut ? `${tSettings("findShortcut")} (${settings.findShortcut})` : tSettings("findShortcut")}
                  disabled={!hasTerminalInputApi}
                  onClick={() => terminalInputApiRef.current?.toggleSearch()}
                >
                  <Search className="h-3.5 w-3.5" />
                </Button>

                {canShowLatency && <NetworkLatencyPopover sessionId={session.id} />}

                {canUseMonitorCapability && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-7 w-7 rounded-md transition-colors hover:bg-accent/80 hover:text-accent-foreground",
                      isMonitorButtonActive
                        ? "bg-accent text-accent-foreground"
                        : "text-foreground"
                    )}
                    aria-label={tTerminal("ariaMonitor")}
                    title={tTerminal("titleMonitor")}
                    onClick={toggleMonitor}
                  >
                    <Activity className="h-3.5 w-3.5" />
                  </Button>
                )}

                {canUseDockerCapability && isActive && (
                  <DockerPopover
                    serverId={session.serverId ?? ''}
                    sessionId={session.id}
                    isConnected={hasReadyServer}
                  />
                )}

                {canUseAiCapability && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-md transition-colors text-foreground hover:bg-accent/80 hover:text-accent-foreground"
                    aria-label={tTerminal("ariaAiAssistant")}
                    title={tTerminal("titleAiAssistantWithShortcut")}
                    onPointerEnter={() => { void loadAiAssistantPanel().catch((error) => console.error('Failed to preload AI panel:', error)) }}
                    onFocus={() => { void loadAiAssistantPanel().catch((error) => console.error('Failed to preload AI panel:', error)) }}
                    onClick={() => setTabState(session.id, { isAiInputOpen: !isAiInputOpen })}
                  >
                    <Bot className="h-3.5 w-3.5" />
                  </Button>
                )}
                </div>
              )}
            </div>
            </SessionWorkspaceToolbar>
          )}

          {/* 内容区域：监控面板 + 终端 */}
          {shouldRenderBody && (
          <div className="flex-1 min-h-0 min-w-0 relative flex overflow-hidden">
            {/* 监控面板 - 左侧固定 280px */}
            {isTerminalSession && isDesktopLayout && (
              <div
                data-terminal-panel
                className={cn(
                  'overflow-hidden text-foreground transition-[width,opacity,transform] duration-180 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                  shouldReserveInlineMonitor
                    ? 'h-full min-h-0 w-[280px] opacity-100 translate-x-0'
                    : 'w-0 opacity-0 -translate-x-4'
                )}
                inert={!shouldReserveInlineMonitor}
                aria-hidden={!shouldReserveInlineMonitor}
              >
                {shouldMountInlineMonitor && (
                  <React.Suspense fallback={monitorFallback}>
                    <MonitorPanel className="h-full min-h-0" isLive={isActive && shouldReserveInlineMonitor} />
                  </React.Suspense>
                )}
              </div>
            )}

            {/* 终端区域 */}
            <div className="flex-1 min-w-0 relative overflow-hidden">
              {isTerminalSession ? (
                <WebTerminal
                  key={`web-terminal-${session.id}`}
                  sessionId={session.id}
                  serverId={session.serverId}
                  serverName={session.serverName}
                  host={session.host}
                  username={session.username}
                  isActive={isActive}
                  shouldConnect={session.shouldConnect}
                  onConnectionPhaseChange={handleSessionConnectionPhaseChange}
                  onAuthCancelled={handleSessionAuthCancelled}
                  onCommand={handleSessionCommand}
                  onInputApiChange={handleTerminalInputApiChange}
                  theme={settings.theme}
                  fontSize={settings.fontSize}
                  fontFamily={settings.fontFamily}
                  lineHeight={settings.lineHeight}
                  autoReconnect={settings.autoReconnect}
                  multiLinePasteWarning={settings.multiLinePasteWarning}
                  findShortcut={settings.findShortcut}
                  zoomInShortcut={settings.zoomInShortcut}
                  zoomOutShortcut={settings.zoomOutShortcut}
                  zoomResetShortcut={settings.zoomResetShortcut}
                  cursorStyle={settings.cursorStyle}
                  cursorBlink={settings.cursorBlink}
                  scrollback={settings.scrollback}
                  rightClickPaste={settings.rightClickPaste}
                  copyOnSelect={settings.copyOnSelect}
                  copyShortcut={settings.copyShortcut}
                  pasteShortcut={settings.pasteShortcut}
                  clearShortcut={settings.clearShortcut}
                  completionConfig={completionConfig}
                  completionProviderEnabled={completionProviderEnabled}
                  completionFetchOptions={completionFetchOptions}
                  pathCompletionCwd={pathCompletionCwd}
                  enableWebgl={enableTerminalWebgl}
                  transparentBackground={hasBackgroundImage}
                  fontWeight={settings.fontWeight}
                  fontWeightBold={resolveTerminalBoldFontWeight(settings.fontWeight)}
                />
              ) : null}
            </div>

            {shouldReserveMobileMonitor && (
              <div
                className={cn(
                  'absolute inset-0 z-30 overflow-hidden border-t md:hidden',
                  'border-border/60 text-foreground shadow-2xl'
                )}
              >
                <div
                  aria-hidden="true"
                  className="absolute inset-0 pointer-events-none"
                  style={{ backgroundColor: terminalSurfaceBackground }}
                />
                {hasBackgroundImage && (
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 pointer-events-none bg-cover bg-center bg-no-repeat"
                    style={{
                      backgroundImage: `url(${settings.backgroundImage})`,
                      opacity: pageBackgroundImageLayerOpacity,
                    }}
                  />
                )}
                <React.Suspense fallback={monitorFallback}>
                  <MonitorPanel className="relative h-full min-h-0 w-full" isLive={isActive} />
                </React.Suspense>
              </div>
            )}
          </div>
          )}
          </div>

          {isFileManagerSessionActive && (
            <FileManagerPanel
              keyboardActive={keyboardActive}
              isOpen={canUseFileManager}
              onClose={() => setTabState(session.id, { isFileManagerOpen: false })}
              serverId={session.serverId ?? ''}
              serverName={session.serverName || ''}
              host={session.host || ''}
              username={session.username || ''}
              isConnected={isTerminalReady}
              sessionId={session.id}
              sessionLabel={session.serverName || 'Session'}
              currentPath={sftpSession.currentPath}
              files={sftpSession.files}
              isLoading={sftpSession.isLoading}
              onNavigate={sftpSession.navigate}
              onNavigateBack={sftpSession.goBack}
              canNavigateBack={sftpSession.canGoBack}
              onNavigateForward={sftpSession.goForward}
              canNavigateForward={sftpSession.canGoForward}
              onInternalBackHandlerChange={setSftpInternalBackHandler}
              onRefresh={sftpSession.refresh}
              onUpload={sftpSession.uploadFiles}
              onDownload={sftpSession.downloadFile}
              onDelete={sftpSession.deleteFile}
              onRename={sftpSession.renameFile}
              onCreateFolder={sftpSession.createFolder}
              onCreateFile={sftpSession.createFile}
              onBatchDelete={sftpSession.batchDeleteFiles}
              onBatchDownload={sftpSession.batchDownloadFiles}
              onReadFile={sftpSession.readFile}
              onSaveFile={sftpSession.saveFile}
              onInsertTerminalText={handleInsertTerminalText}
              onExecuteTerminalCommand={handleExecuteTerminalCommand}
              onDisconnect={() => setTabState(session.id, { isFileManagerOpen: false })}
              transferTasks={combinedTransferTasks}
              onClearCompletedTransfers={handleClearCompletedTransfers}
              onCancelTransfer={handleCancelTransfer}
              background={{
                color: terminalSurfaceBackground,
                image: hasBackgroundImage ? settings.backgroundImage : undefined,
                imageOpacity: pageBackgroundImageLayerOpacity,
              }}
            />
          )}

          {shouldMountAi && (
            <React.Suspense fallback={null}>
              <AiAssistantPanel
                isOpen={canUseAi}
                onClose={() => setTabState(session.id, { isAiInputOpen: false })}
                terminalSession={session}
                adapters={aiAssistantAdapters}
                background={{
                  color: terminalSurfaceBackground,
                  image: hasBackgroundImage ? settings.backgroundImage : undefined,
                  imageOpacity: pageBackgroundImageLayerOpacity,
                }}
              />
            </React.Suspense>
          )}

        </div>
      </div>
    </MonitorWebSocketProvider>
  )
}

export const TabTerminalContent = React.memo(TabTerminalContentComponent)
TabTerminalContent.displayName = 'TabTerminalContent'
