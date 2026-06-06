/**
 * 单个页签的完整内容组件
 * 每个 TabsContent 渲染一个独立的 TabTerminalContent
 * 包含独立的 MonitorWebSocketProvider
 */

import React, { useEffect, useState } from 'react'
import { MonitorWebSocketProvider } from './monitor/contexts/MonitorWebSocketContext'
import { Button } from '@/components/ui/button'
import { FolderOpen, Activity, Bot } from 'lucide-react'
import { NetworkLatencyPopover } from './network-latency-popover'
import { MonitorPanel } from './monitor/MonitorPanel'
import { WebTerminal } from './web-terminal'
import { ServerConnectionConfigs, type ServerConnectionConfigsApi } from "@/components/servers/server-connection-configs"
import { ConnectionLoader } from './connection-loader'
import {
  FileManagerPanel,
  FILE_MANAGER_PANEL_ANIMATION_MS,
} from './file-manager-panel'
import { AiAssistantPanel } from './ai-assistant-panel'
import { DockerPopover } from './docker'
import { useSftpSession } from '@/hooks/useSftpSession'
import type { FileTransferSftpApi } from '@/hooks/useFileTransfer'
import { cn } from '@/lib/utils'
import { useTabUIStore } from '@/stores/tab-ui-store'
import { useOptionalSshWorkspace } from '@/components/ssh-workspace/ssh-workspace'
import { createWorkspaceTransferAuthTicketProviderAdapter } from '@/lib/session/workspace-adapters'
import type { TerminalConnectionPhase, TerminalSession } from './types'
import type { TerminalSettings } from './terminal-settings-dialog'
import type { Server } from "@/lib/server-types"
import { useTranslation } from "react-i18next"
import { getTerminalTheme, withTerminalBackgroundOpacity } from './terminal-themes'
import { useEffectiveThemeMode } from '@/hooks/use-effective-theme-mode'

const DESKTOP_TERMINAL_LAYOUT_QUERY = '(min-width: 768px)'

type ConnectionLoaderMessageKey =
  | "connectionLoaderConnecting"
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

interface TabTerminalContentProps {
  session: TerminalSession
  isActive: boolean
  settings: TerminalSettings
  chrome?: "full" | "toolbar" | "content"
  surface?: "normal" | "transparent"
  effectiveIsLoading: boolean
  loaderState: "entering" | "loading" | "exiting"
  onAnimationComplete: () => void
  isFullscreen: boolean
  onCommand: (command: string) => void
  onConnectionPhaseChange: (phase: TerminalConnectionPhase) => void
  onAuthCancelled: () => void
  onToggleFullscreen: () => void
  onStartConnectionFromConfig: (server: Server) => void
  serverApi?: ServerConnectionConfigsApi
  serverConfigsReady?: boolean
  onInternalBackHandlerChange?: (
    sessionId: string,
    handler: InternalBackHandler | null
  ) => void
  onInternalBackAvailabilityChange?: (sessionId: string, available: boolean) => void
}

export function TabTerminalContent({
  session,
  isActive,
  settings,
  chrome = "full",
  surface = "normal",
  effectiveIsLoading,
  loaderState,
  onAnimationComplete,
  isFullscreen,
  onCommand,
  onConnectionPhaseChange,
  onAuthCancelled,
  onToggleFullscreen,
  onStartConnectionFromConfig,
  serverApi,
  serverConfigsReady,
  onInternalBackHandlerChange,
  onInternalBackAvailabilityChange,
}: TabTerminalContentProps) {
  // 浮动面板根容器
  const [floatingPanelRoot, setFloatingPanelRoot] = useState<HTMLDivElement | null>(null)
  const [sftpInternalBackHandler, setSftpInternalBackHandler] =
    useState<InternalBackHandler | null>(null)
  const [shouldRenderFileManager, setShouldRenderFileManager] = useState(false)
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
  const workspaceCapabilities = workspace?.capabilities
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

  const isTerminalReady = session.connectionPhase === "ready"
  const hasReadyServer = session.type !== 'config' && isTerminalReady && !!session.serverId
  const canRenderInlinePanels = chrome === "full"
  const canUseHeavyPanels = canRenderInlinePanels && isActive && hasReadyServer
  const canUseFileManager = canUseSftpCapability && canUseHeavyPanels && isFileManagerOpen
  const shouldKeepFileManagerMounted = canUseSftpCapability && canUseHeavyPanels && shouldRenderFileManager
  const canMountAi = canRenderInlinePanels && canUseAiCapability && isActive && session.type !== 'config' && !effectiveIsLoading
  const canUseAi = canMountAi && isAiInputOpen
  const shouldReserveInlineMonitor =
    canRenderInlinePanels &&
    canUseMonitorCapability &&
    isDesktopLayout &&
    hasReadyServer &&
    isDesktopMonitorOpen &&
    !!session.serverId
  const canUseMobileMonitor = canRenderInlinePanels && canUseMonitorCapability && canUseHeavyPanels && isMobileMonitorOpen && !isDesktopLayout
  const fileManagerPaneConfig = workspace?.adapters.panes?.fileManager
  const shouldMountFileManagerInTerminal = fileManagerPaneConfig?.mountMode !== 'page'
  const fileManagerMountContainer = shouldMountFileManagerInTerminal
    ? floatingPanelRoot || undefined
    : undefined

  useEffect(() => {
    if (!shouldMountFileManagerInTerminal) {
      setFloatingPanelRoot(null)
    }
  }, [shouldMountFileManagerInTerminal])

  const transferAuthTicketProvider = React.useMemo(
    () => createWorkspaceTransferAuthTicketProviderAdapter(workspace?.adapters.authTicketProvider),
    [workspace?.adapters.authTicketProvider]
  )
  const workspaceSftpApi = workspace?.adapters.apiClient?.sftp
  const sftpFileTransferApi = React.useMemo<FileTransferSftpApi | undefined>(() => {
    if (
      !workspaceSftpApi?.createUploadTask ||
      !workspaceSftpApi.listUploadTasks ||
      !workspaceSftpApi.cancelUploadTask ||
      !workspaceSftpApi.uploadFile ||
      !workspaceSftpApi.directTransfer ||
      !workspaceSftpApi.cancelTransfer
    ) {
      return undefined
    }

    return {
      createUploadTask: workspaceSftpApi.createUploadTask,
      listUploadTasks: workspaceSftpApi.listUploadTasks,
      cancelUploadTask: workspaceSftpApi.cancelUploadTask,
      uploadFile: workspaceSftpApi.uploadFile,
      directTransfer: workspaceSftpApi.directTransfer,
      cancelTransfer: workspaceSftpApi.cancelTransfer,
    }
  }, [workspaceSftpApi])
  const sftpFileTransferOptions = React.useMemo(
    () => ({
      api: sftpFileTransferApi,
      createTicket: transferAuthTicketProvider,
      uploadUsesProgressSocket: workspaceSftpApi?.uploadUsesProgressSocket ?? true,
    }),
    [sftpFileTransferApi, transferAuthTicketProvider, workspaceSftpApi]
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
      api: workspace?.adapters.apiClient?.sftp,
      notifier: workspace?.adapters.notifier,
      t: sftpTranslate,
      fileTransferOptions: sftpFileTransferOptions,
    }),
    [
      sftpFileTransferOptions,
      sftpTranslate,
      workspaceSftpApi,
      workspace?.adapters.notifier,
    ]
  )
  const toggleMonitor = () => {
    setTabState(
      session.id,
      isDesktopLayout
        ? { isMonitorOpen: !isDesktopMonitorOpen }
        : { isMobileMonitorOpen: !isMobileMonitorOpen }
    )
  }

  // SFTP 会话管理：只在当前页签且文件管理器打开时加载目录，避免隐藏页签继续触发列表渲染/请求
  const sftpSession = useSftpSession(
    shouldKeepFileManagerMounted && session.serverId
      ? session.serverId
      : '',
    '/root',
    sftpSessionOptions
  )

  // 监控数据源跟随已就绪的终端页签保持订阅。
  // 桌面端监控面板也保持实时模式，和终端一样只切换可见性，避免切回时图表从冻结快照重绘而闪一下。
  const connectedServerId =
    hasReadyServer && session.serverId
      ? session.serverId
      : ''
  const monitorEnabled = canRenderInlinePanels && canUseMonitorCapability && hasReadyServer
  const { t: tTerminal } = useTranslation("terminal")
  const { mode: effectiveAppTheme } = useEffectiveThemeMode()
  const shouldUseTerminalSurface = session.type !== 'config'
  const pageTheme = getTerminalTheme(settings.theme, effectiveAppTheme)
  const pageBackgroundColor = shouldUseTerminalSurface
    ? settings.opacity < 100
      ? withTerminalBackgroundOpacity(pageTheme.background, settings.opacity / 100)
      : pageTheme.background
    : 'transparent'
  const hasBackgroundImage = session.type !== 'config' && settings.backgroundImage.trim().length > 0
  const enableTerminalWebgl = true
  const connectionLoaderServerName =
    session.username && session.host
      ? `${session.username}@${session.host}`
      : session.serverName || session.host || session.serverId
  const shouldRenderToolbar =
    chrome !== "content" &&
    session.type !== 'config' &&
    !effectiveIsLoading
  const shouldRenderBody = chrome !== "toolbar"
  const shouldRenderSurface = surface !== "transparent"

  useEffect(() => {
    let frame = 0
    if (canUseFileManager) {
      frame = window.requestAnimationFrame(() => {
        setShouldRenderFileManager(true)
      })
      return () => window.cancelAnimationFrame(frame)
    }

    const timer = window.setTimeout(() => {
      setShouldRenderFileManager(false)
    }, FILE_MANAGER_PANEL_ANIMATION_MS)

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame)
      }
      window.clearTimeout(timer)
    }
  }, [canUseFileManager])

  const canHandleInternalBack = isActive && (
    isFullscreen ||
    canUseFileManager ||
    canUseAi ||
    canUseMobileMonitor
  )
  const handleInternalBack = React.useCallback(async () => {
    if (!isActive) {
      return false
    }

    if (isFullscreen) {
      onToggleFullscreen()
      return true
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
    isFullscreen,
    onToggleFullscreen,
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
      interval={settings.monitorInterval || 2}
      latencyIntervalMs={5000}
    >
      <div className={cn(
        "flex flex-col relative overflow-hidden",
        shouldRenderBody ? "flex-1 h-full" : "shrink-0"
      )}>
        {shouldRenderBody && shouldRenderSurface && (
          <div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none"
            style={{ backgroundColor: pageBackgroundColor }}
          />
        )}

        {shouldRenderBody && shouldRenderSurface && hasBackgroundImage && (
          <div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none bg-cover bg-center bg-no-repeat"
            style={{
              backgroundImage: `url(${settings.backgroundImage})`,
              opacity: settings.backgroundImageOpacity / 100,
            }}
          />
        )}

        {/* 加载动画覆盖层 - 覆盖整个页签内容 */}
        {shouldRenderBody && effectiveIsLoading && session.type !== 'config' && (
          <div className="absolute inset-0 z-[60]">
            <ConnectionLoader
              serverName={connectionLoaderServerName}
              message={tTerminal(getConnectionLoaderMessageKey(session.connectionPhase))}
              exitMessage={tTerminal(getConnectionLoaderExitMessageKey(session.connectionPhase))}
              state={loaderState}
              onAnimationComplete={onAnimationComplete}
            />
          </div>
        )}

        <div className={cn(
          "relative z-10 flex min-h-0 flex-col",
          shouldRenderBody ? "flex-1" : "shrink-0"
        )}>
          {shouldRenderToolbar && (
            <div
              className={cn(
                'border-b text-sm flex items-center px-3 py-1.5 backdrop-blur-md transition-colors',
                'border-border/60 bg-card/45 text-foreground shadow-sm'
              )}
            >
              {/* 左侧工具图标组 */}
              <div className="flex items-center gap-1">
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
                    onClick={() => setTabState(session.id, { isAiInputOpen: !isAiInputOpen })}
                  >
                    <Bot className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* 内容区域：监控面板 + 终端 */}
          {shouldRenderBody && (
          <div className="flex-1 min-h-0 relative flex">
            {/* 监控面板 - 左侧固定 280px */}
            {session.type !== 'config' && isDesktopLayout && (
              <div
                className={cn(
                  'transition-all duration-300 ease-out overflow-hidden border-r backdrop-blur-md',
                  'border-border/60 bg-card/35 text-foreground',
                  shouldReserveInlineMonitor
                    ? 'w-[280px] opacity-100 translate-x-0'
                    : 'w-0 opacity-0 -translate-x-4 border-r-0'
                )}
              >
                {shouldReserveInlineMonitor && <MonitorPanel />}
              </div>
            )}

            {/* 终端区域 */}
            <div className="flex-1 min-w-0 relative">
              {/* 文件管理器悬浮挂载根，位于终端容器内部 */}
              {shouldMountFileManagerInTerminal && (
                <div ref={setFloatingPanelRoot} className="absolute inset-0 pointer-events-none" />
              )}

              {session.type === 'config' ? (
                <ServerConnectionConfigs
                  onConnect={onStartConnectionFromConfig}
                  serverApi={serverApi}
                  ready={serverConfigsReady}
                />
              ) : (
                <WebTerminal
                  sessionId={session.id}
                  serverId={session.serverId}
                  serverName={session.serverName}
                  host={session.host}
                  username={session.username}
                  isActive={isActive}
                  shouldConnect={session.shouldConnect}
                  onConnectionPhaseChange={onConnectionPhaseChange}
                  onAuthCancelled={onAuthCancelled}
                  onCommand={onCommand}
                  theme={settings.theme}
                  fontSize={settings.fontSize}
                  fontFamily={settings.fontFamily}
                  cursorStyle={settings.cursorStyle}
                  cursorBlink={settings.cursorBlink}
                  scrollback={settings.scrollback}
                  rightClickPaste={settings.rightClickPaste}
                  copyOnSelect={settings.copyOnSelect}
                  copyShortcut={settings.copyShortcut}
                  pasteShortcut={settings.pasteShortcut}
                  clearShortcut={settings.clearShortcut}
                  completionEnabled={settings.completionEnabled}
                  completionTrigger={settings.completionTrigger}
                  completionAutoDelay={settings.completionAutoDelay}
                  completionMaxItems={settings.completionMaxItems}
                  completionShowIcon={settings.completionShowIcon}
                  completionShowDescription={settings.completionShowDescription}
                  enableWebgl={enableTerminalWebgl}
                  transparentBackground={surface === "transparent" || hasBackgroundImage}
                  backgroundOpacity={settings.opacity / 100}
                />
              )}
            </div>

            {canMountAi && (
              <AiAssistantPanel
                isOpen={canUseAi}
                onClose={() => setTabState(session.id, { isAiInputOpen: false })}
                terminalSession={session}
              />
            )}

            {canUseMobileMonitor && (
              <div
                className={cn(
                  'absolute inset-0 z-30 overflow-hidden border-t backdrop-blur-md md:hidden',
                  'border-border/60 bg-card/90 text-foreground shadow-2xl'
                )}
              >
                <MonitorPanel className="h-full min-h-0 w-full" isLive={isActive} />
              </div>
            )}
          </div>
          )}
        </div>

        {/* 文件管理器面板 - 渲染到 floatingPanelRootRef */}
        {shouldRenderBody && shouldKeepFileManagerMounted && (
          <FileManagerPanel
            isOpen={canUseFileManager}
            onClose={() => setTabState(session.id, { isFileManagerOpen: false })}
            mountContainer={fileManagerMountContainer}
            anchorTop={fileManagerPaneConfig?.anchorTop}
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
            onDisconnect={() => setTabState(session.id, { isFileManagerOpen: false })}
            transferTasks={sftpSession.transferTasks}
            onClearCompletedTransfers={sftpSession.clearCompletedTransfers}
            onCancelTransfer={sftpSession.cancelTransfer}
          />
        )}

      </div>
    </MonitorWebSocketProvider>
  )
}
