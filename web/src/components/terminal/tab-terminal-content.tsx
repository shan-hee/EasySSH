import { TERMINAL_MONITOR_INTERVAL_SECONDS } from "./terminal-settings"
import { SessionWorkspaceToolbar } from "@/components/tabs/session-workspace-toolbar"
/**
 * 单个页签的完整内容组件
 * 每个 TabsContent 渲染一个独立的 TabTerminalContent
 * 包含独立的 MonitorWebSocketProvider
 */

import React, { useEffect, useMemo, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { MonitorWebSocketProvider } from './monitor/contexts/MonitorWebSocketContext'
import { MonitorSkeleton } from './monitor/components/MonitorSkeleton'
import { Button } from '@/components/ui/button'
import { FolderOpen, Activity, Bot, Search, X } from 'lucide-react'
import { PageLoading } from '@/components/page-loading'
import { loadAiAssistantPanel, PreloadedAiAssistantPanel as AiAssistantPanel } from '@/lib/ai-assistant-preload'
import { NetworkLatencyPopover } from './network-latency-popover'
import { WebTerminal } from './web-terminal'
import { ConnectionLoader } from './connection-loader'
import { FileManagerPanel } from './file-manager-panel'
import type { AIAssistantWorkspaceAdapters } from '@/components/ai-agent/ai-assistant-workspace-view'
import { DockerPopover } from './docker'
import { ScriptLibraryPopover } from './script-library-popover'
import { SystemToolsPopover } from './system-tools-popover'
import { PanelPositionControl } from './panel-position-control'
import { useTerminalPanelLayout } from './use-terminal-panel-layout'
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

interface TabTerminalContentProps {
  session: TerminalSession
  isActive: boolean
  keyboardActive?: boolean
  settings: TerminalSettings
  chrome?: "full" | "toolbar" | "content"
  surface?: "normal" | "transparent"
  effectiveIsLoading: boolean
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
    isGlassTheme,
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
  const handleApplyScript = React.useCallback((content: string, execute: boolean) => {
    if (!isActive || !isTerminalReady || !terminalInputApiRef.current) return false
    terminalInputApiRef.current.applyScript(content, execute)
    return true
  }, [isActive, isTerminalReady])
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
  const hasWorkspaceBackground = isTerminalSession && (
    !!settings.backgroundImage || isGlassTheme
  )
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

  // CSS grid placement changes without reparenting panels or remounting the terminal.
  const panelPositions = {
    monitor: tabState.monitorPosition,
    files: tabState.fileManagerPosition,
    ai: tabState.aiPosition,
  }
  const monitorHeaderActions = isDesktopLayout ? (
    <PanelPositionControl position={tabState.monitorPosition} onChange={(monitorPosition) => setTabState(session.id, { monitorPosition })} />
  ) : undefined
  const monitorFallback = <div className="h-full w-full px-3 py-1.5"><MonitorSkeleton headerActions={monitorHeaderActions} /></div>
  const visiblePanels = ([
    ...(shouldReserveInlineMonitor ? ["monitor" as const] : []),
    ...(canUseFileManager ? ["files" as const] : []),
    ...(canUseAi ? ["ai" as const] : []),
  ])
  const { layoutRef, gridStyle: panelGridStyle, placement: panelPlacement, terminalColumn, handles: panelResizeHandles } = useTerminalPanelLayout({
    enabled: isDesktopLayout && shouldRenderBody,
    positions: panelPositions,
    visiblePanels,
    preferences: workspace?.adapters.preferences,
  })

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

        {/* 保留首次动画，否则循环光线会停在 opacity: 0 的末帧；退出仅影响覆盖层。 */}
        <AnimatePresence custom={session.connectionPhase}>
          {shouldRenderBody && effectiveIsLoading && isTerminalSession && (
            <div key="connection-loader" className="pointer-events-none absolute inset-0 z-[60]">
              <ConnectionLoader
                transparentBackground={hasWorkspaceBackground}
                serverName={connectionLoaderServerName}
                message={tTerminal(getConnectionLoaderMessageKey(session.connectionPhase))}
              />
            </div>
          )}
        </AnimatePresence>

        <div className={cn(
          "relative z-10 flex min-h-0 min-w-0 flex-col overflow-hidden",
          shouldRenderBody ? "flex-1" : "shrink-0"
        )}>
          {shouldReserveToolbar && (
            <SessionWorkspaceToolbar kind="terminal">
            <div
              data-terminal-toolbar
              className="flex min-h-8 items-stretch text-sm text-foreground transition-colors"
            >
              {/* 左侧工具图标组 */}
              {shouldRenderToolbarActions && (
                <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-3 py-1">
                {canUseSftpCapability && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 rounded-md transition-colors text-foreground hover:bg-accent/80 hover:text-accent-foreground"
                    aria-label={tTerminal("ariaFileManager")}
                    title={tTerminal("titleFileManagerWithShortcut")}
                    onClick={() => setTabState(session.id, { isFileManagerOpen: !isFileManagerOpen })}
                  >
                    <FolderOpen className="size-3.5" />
                  </Button>
                )}

                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 rounded-md transition-colors text-foreground hover:bg-accent/80 hover:text-accent-foreground"
                  aria-label={tSettings("findShortcut")}
                  title={settings.findShortcut ? `${tSettings("findShortcut")} (${settings.findShortcut})` : tSettings("findShortcut")}
                  disabled={!hasTerminalInputApi}
                  onClick={() => terminalInputApiRef.current?.toggleSearch()}
                >
                  <Search className="size-3.5" />
                </Button>

                {canShowLatency && <NetworkLatencyPopover sessionId={session.id} />}

                {canUseMonitorCapability && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "size-6 rounded-md transition-colors hover:bg-accent/80 hover:text-accent-foreground",
                      isMonitorButtonActive
                        ? "bg-accent text-accent-foreground"
                        : "text-foreground"
                    )}
                    aria-label={tTerminal("ariaMonitor")}
                    title={tTerminal("titleMonitor")}
                    onClick={toggleMonitor}
                  >
                    <Activity className="size-3.5" />
                  </Button>
                )}

                {canUseDockerCapability && isActive && (
                  <DockerPopover
                    serverId={session.serverId ?? ''}
                    sessionId={session.id}
                    isConnected={hasReadyServer}
                  />
                )}

                {isActive && (
                  <ScriptLibraryPopover
                    canExecute={isTerminalReady && hasTerminalInputApi}
                    sessionLabel={connectionLoaderServerName ?? ''}
                    onApplyScript={handleApplyScript}
                    onFocusTerminal={() => terminalInputApiRef.current?.focus()}
                  />
                )}

                {isActive && (["processes", "ports", "services"] as const).map((kind) => (
                  <SystemToolsPopover
                    key={kind}
                    kind={kind}
                    serverId={session.serverId ?? ''}
                    sessionLabel={connectionLoaderServerName ?? ''}
                    canExecute={hasReadyServer && hasTerminalInputApi}
                    onExecute={(command) => handleApplyScript(command, true)}
                    onFocusTerminal={() => terminalInputApiRef.current?.focus()}
                  />
                ))}

                {canUseAiCapability && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 rounded-md transition-colors text-foreground hover:bg-accent/80 hover:text-accent-foreground"
                    aria-label={tTerminal("ariaAiAssistant")}
                    title={tTerminal("titleAiAssistantWithShortcut")}
                    onPointerEnter={() => { void loadAiAssistantPanel().catch((error) => console.error('Failed to preload AI panel:', error)) }}
                    onPointerDown={() => { void loadAiAssistantPanel().catch((error) => console.error('Failed to preload AI panel:', error)) }}
                    onFocus={() => { void loadAiAssistantPanel().catch((error) => console.error('Failed to preload AI panel:', error)) }}
                    onClick={() => setTabState(session.id, { isAiInputOpen: !isAiInputOpen })}
                  >
                    <Bot className="size-3.5" />
                  </Button>
                )}
                </div>
              )}
            </div>
            </SessionWorkspaceToolbar>
          )}

          {/* All docked panels share one grid; placement preserves component state. */}
          {shouldRenderBody && (
          <div ref={layoutRef} data-terminal-layout className="relative grid min-h-0 min-w-0 flex-1 overflow-hidden" style={panelGridStyle}>
            {/* 监控面板 */}
            {isTerminalSession && isDesktopLayout && (
              <div
                data-terminal-panel
                className="flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden text-foreground"
                style={panelPlacement("monitor")}
                inert={!shouldReserveInlineMonitor}
                aria-hidden={!shouldReserveInlineMonitor}
              >
                <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                  {shouldMountInlineMonitor && (
                    <React.Suspense fallback={monitorFallback}>
                      <MonitorPanel headerActions={monitorHeaderActions} horizontal={tabState.monitorPosition === "bottom"} isLive={isActive && shouldReserveInlineMonitor} />
                    </React.Suspense>
                  )}
                </div>
              </div>
            )}

            {/* 终端区域 */}
            <div className="relative min-h-0 min-w-0 overflow-hidden" style={{ gridColumn: isDesktopLayout ? terminalColumn : 1, gridRow: 1 }}>
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
                  transparentBackground={hasWorkspaceBackground}
                  fontWeight={settings.fontWeight}
                  fontWeightBold={resolveTerminalBoldFontWeight(settings.fontWeight)}
                />
              ) : null}
            </div>

            {shouldReserveMobileMonitor && (
              <div
                className={cn(
                  'terminal-mobile-monitor-surface absolute inset-0 z-30 overflow-hidden border-t md:hidden',
                  'border-border/60 text-foreground shadow-2xl'
                )}
              >
                {!hasWorkspaceBackground && (
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 pointer-events-none"
                    style={{ backgroundColor: terminalSurfaceBackground }}
                  />
                )}
                <React.Suspense fallback={monitorFallback}>
                  <MonitorPanel className="relative h-full min-h-0 w-full" isLive={isActive} />
                </React.Suspense>
              </div>
            )}
          {isFileManagerSessionActive && (
            <FileManagerPanel
              position={tabState.fileManagerPosition}
              onPositionChange={(fileManagerPosition) => setTabState(session.id, { fileManagerPosition })}
              layoutStyle={panelPlacement("files")}
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
              backgroundColor={hasWorkspaceBackground ? undefined : terminalSurfaceBackground}
            />
          )}

          {shouldMountAi && (
            <React.Suspense fallback={canUseAi ? (
              <aside
                data-terminal-panel
                aria-label={tTerminal("ariaAiAssistant")}
                style={panelPlacement("ai")}
                className="absolute inset-0 z-40 flex min-h-0 min-w-0 w-full flex-col bg-background text-foreground md:relative md:inset-auto"
              >
                <div className="flex items-center justify-between border-b px-3 py-2">
                  <span className="text-sm">{tTerminal("ariaAiAssistant")}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={tTerminal("common:cancel")}
                    onClick={() => setTabState(session.id, { isAiInputOpen: false })}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
                <PageLoading className="min-h-0" delay={0} />
              </aside>
            ) : null}>
              <AiAssistantPanel
                position={tabState.aiPosition}
                onPositionChange={(aiPosition) => setTabState(session.id, { aiPosition })}
                layoutStyle={panelPlacement("ai")}
                isOpen={canUseAi}
                onClose={() => setTabState(session.id, { isAiInputOpen: false })}
                terminalSession={session}
                adapters={aiAssistantAdapters}
                backgroundColor={hasWorkspaceBackground ? undefined : terminalSurfaceBackground}
              />
            </React.Suspense>
          )}
          {panelResizeHandles}
          </div>
          )}
        </div>
      </div>
    </MonitorWebSocketProvider>
  )
}

export const TabTerminalContent = React.memo(TabTerminalContentComponent)
TabTerminalContent.displayName = 'TabTerminalContent'
