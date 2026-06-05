
import React, { useEffect, useRef, useCallback, startTransition } from "react"
import { PageHeader } from "@/components/page-header"
import { SshWorkspace } from "@easyssh/ssh-workspace"
import { SessionTabBar } from "@/components/tabs/session-tab-bar"
import { SessionSplitDropOverlay } from "@/components/tabs/session-split-drop-overlay"
import {
  SessionSplitPane,
  type SessionSplitPaneHeaderBackground,
} from "@/components/tabs/session-split-pane"
import { SessionSplitView } from "@/components/tabs/session-split-view"
import { ServerConnectionConfigs } from "@/components/servers/server-connection-configs"
import { SftpSessionCard } from "@/components/sftp/sftp-session-card"
import { DragPreviewToolbar, SortableSession, type CrossSessionDragData } from "@/components/sftp/sftp-session-sortable"
import { cn } from "@/lib/utils"
import {
 DndContext,
 closestCenter,
 KeyboardSensor,
 PointerSensor,
 useSensor,
 useSensors,
 DragEndEvent,
 DragStartEvent,
 DragOverlay,
} from '@dnd-kit/core'
import {
 arrayMove,
 SortableContext,
 sortableKeyboardCoordinates,
 rectSortingStrategy,
} from '@dnd-kit/sortable'
import { createPortal } from 'react-dom'
import { operationRecordsApi, sftpApi, type Server as ApiServer, type FileInfo } from "@/lib/api"
import { createAuthTicket } from "@/lib/auth-ticket"
import { toast } from "@/components/ui/sonner"
import { getErrorMessage } from "@/lib/error-utils"
import { useFileTransfer } from "@/hooks/useFileTransfer"
import {
  performDelete,
  performCreateFolder,
  performCreateFile,
  performRename,
  performSaveFile,
  performBatchDelete,
} from "@/lib/session/sftp-operations"
import { useClientAuth } from "@/components/client-auth-provider"
import { useSystemConfig } from "@/hooks/use-system-config"
import { getEffectiveLocale, getEffectiveTimezone } from "@/utils/datetime"
import { useTranslation } from "react-i18next"
import { convertSftpFileInfo, type SftpFileItem } from "@/lib/sftp-file-utils"
import { loadSftpDirectory } from "@/lib/session/sftp-directory"
import { createSftpSessionApi } from "@/lib/session/sftp-session-api"
import type { SftpWorkspaceSession } from "@/lib/session/workspace"
import { createBrowserWorkspacePreferenceAdapter, createWorkspaceAdapters, createWorkspaceAuthTicketProviderAdapter, createWorkspaceI18nAdapter, createWorkspaceNotifierAdapter, createWorkspaceSettingsAdapter, createWorkspaceTransferAuthTicketProviderAdapter, createWorkspaceTransferManagerAdapter } from "@/lib/session/workspace-adapters"
import { createWorkspaceTransferHistoryAdapter } from "@/lib/session/web-workspace-adapters"
import { createSftpWorkspaceSessionControllerAdapter, createSftpWorkspaceSessionStoreAdapter, useSftpSessionStore } from "@/stores/sftp-session-store"
import { WORKSPACE_CAPABILITY_PRESETS, createWorkspaceCapabilitiesFromRuntime, useRuntime } from "@/shell/runtime"
import type { TerminalSession } from "@/components/terminal/types"
import { useSessionSplitWorkspace } from "@/hooks/use-session-split-workspace"
import { hasSplitPaneDragSession } from "@/lib/session/split-pane-drag"

type ComponentFile = SftpFileItem
type SftpSession = SftpWorkspaceSession

const SFTP_SPLIT_PANE_BACKGROUND: SessionSplitPaneHeaderBackground = {
  color: "var(--background)",
}

const getSessionConnectionSubtitle = (session: Pick<SftpSession, "username" | "host">) => {
  if (session.username && session.host) return `${session.username}@${session.host}`
  return session.username || session.host || undefined
}

// 会话标识颜色列表（常量）
const SESSION_COLORS = [
  "var(--chart-1)",
  "var(--status-connected)",
  "var(--status-warning)",
  "var(--status-danger)",
  "var(--chart-4)",
  "var(--chart-5)",
]

const SFTP_CONFIG_TAB_ID = "sftp-config"
const SFTP_WORKSPACE_TAB_ID = "__sftp-workspace__"
const WORKSPACE_TAB_LABEL = "工作空间"

const createSftpConfigTabId = () => (
  `sftp-config-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
)

const createSftpConfigTab = (id: string): TerminalSession => ({
  id,
  serverName: "sftp",
  host: "",
  username: "",
  shouldConnect: false,
  connectionPhase: "idle",
  status: "disconnected",
  lastActivity: 0,
  type: "config",
  pinned: false,
})

export default function SftpPage() {
 const { runtime } = useRuntime()
 const { user } = useClientAuth()
 const { data: systemConfig } = useSystemConfig()
 const effectiveLocale = getEffectiveLocale(user, systemConfig || null)
 const effectiveTimezone = getEffectiveTimezone(user, systemConfig || null)
 const { t: tCommon } = useTranslation("common")
 const { t: tSftp } = useTranslation("sftp")
 const { t: tTerminal } = useTranslation("terminal")

 const convertFileInfo = useCallback(
   (file: FileInfo): ComponentFile =>
     convertSftpFileInfo(file, {
       locale: effectiveLocale,
       timezone: effectiveTimezone,
       showDirSizeDash: true,
     }),
   [effectiveLocale, effectiveTimezone],
 )
 const sftpSessionApi = React.useMemo(() => createSftpSessionApi(sftpApi), [])
 // 认证改为基于 HttpOnly Cookie，不再需要前端 token

 // SFTP 工作区会话状态进入 runtime store，页面只保留业务编排。
 const sessions = useSftpSessionStore((state) => state.sessions)
 const configTabIds = useSftpSessionStore((state) => state.configTabIds)
 const nextSessionId = useSftpSessionStore((state) => state.nextSessionId)
 const fullscreenSessionId = useSftpSessionStore((state) => state.fullscreenSessionId)
 const storedActiveSessionId = useSftpSessionStore((state) => state.activeSessionId)
 const activeId = useSftpSessionStore((state) => state.activeId)
 const setSessions = useSftpSessionStore((state) => state.setSessions)
 const setConfigTabIds = useSftpSessionStore((state) => state.setConfigTabIds)
 const setNextSessionId = useSftpSessionStore((state) => state.setNextSessionId)
 const setFullscreenSessionId = useSftpSessionStore((state) => state.setFullscreenSessionId)
 const setStoredActiveSessionId = useSftpSessionStore((state) => state.setActiveSessionId)
 const setActiveId = useSftpSessionStore((state) => state.setActiveId)
 const workspaceSplitLayout = useSftpSessionStore((state) => state.splitLayout)
 const setWorkspaceSplitLayout = useSftpSessionStore((state) => state.setSplitLayout)
 const activeSessionId = storedActiveSessionId ?? SFTP_CONFIG_TAB_ID
 const setActiveSessionId = setStoredActiveSessionId
 const sessionsRef = useRef<SftpSession[]>([])

 // 始终保持 ref 指向最新会话，便于稳定回调访问（避免 useEffect 的一帧滞后）
 sessionsRef.current = sessions

 const workspaceAuthTicketProvider = React.useMemo(() => createWorkspaceAuthTicketProviderAdapter(createAuthTicket), [])
 const transferAuthTicketProvider = React.useMemo(
   () => createWorkspaceTransferAuthTicketProviderAdapter(workspaceAuthTicketProvider),
   [workspaceAuthTicketProvider],
 )

 // 文件传输管理
 const fileTransfer = useFileTransfer({
   createTicket: transferAuthTicketProvider,
 })
 const {
   tasks: transferTasks,
   uploadFile,
   clearCompleted,
   cancelTask,
   directTransfer,
 } = fileTransfer
 const transferTasksRef = useRef(transferTasks)
 transferTasksRef.current = transferTasks
 const workspaceSessionStore = React.useMemo(
   () => createSftpWorkspaceSessionStoreAdapter(() => transferTasksRef.current),
   [],
 )
 const workspaceSessionController = React.useMemo(() => createSftpWorkspaceSessionControllerAdapter(), [])
 const workspacePreferences = React.useMemo(() => createBrowserWorkspacePreferenceAdapter(), [])
 const workspaceTransferHistory = React.useMemo(() => createWorkspaceTransferHistoryAdapter(operationRecordsApi), [])
 const workspaceAdapters = React.useMemo(() => createWorkspaceAdapters({
   apiClient: {
     sftp: sftpSessionApi,
   },
   i18n: createWorkspaceI18nAdapter({
     locale: effectiveLocale,
     timezone: effectiveTimezone,
     common: tCommon,
     terminal: tTerminal,
     sftp: tSftp,
   }),
   notifier: createWorkspaceNotifierAdapter(toast),
   settings: createWorkspaceSettingsAdapter({
     sftp: {
       downloadExcludePatterns: systemConfig?.download_exclude_patterns,
     },
   }),
   preferences: workspacePreferences,
   authTicketProvider: workspaceAuthTicketProvider,
   sessionStore: workspaceSessionStore,
   sessionController: workspaceSessionController,
   transferManager: createWorkspaceTransferManagerAdapter({
     tasks: transferTasks,
     downloadFile: (serverId, remotePath) => {
       sftpSessionApi.downloadFile(serverId, remotePath)
     },
     batchDownload: (serverId, remotePaths, mode, excludePatterns) => (
       sftpSessionApi.batchDownload(serverId, remotePaths, mode, excludePatterns)
     ),
     uploadFile,
     directTransfer,
     createTransferTask: fileTransfer.createTransferTask,
     addTask: fileTransfer.addTask,
     updateTask: fileTransfer.updateTask,
     removeTask: fileTransfer.removeTask,
     clearAll: fileTransfer.clearAll,
     clearCompleted,
     cancelTask,
     cancelDirectTransfer: fileTransfer.cancelDirectTransfer,
     history: workspaceTransferHistory,
   }),
 }), [
   cancelTask,
   clearCompleted,
   directTransfer,
   effectiveLocale,
   effectiveTimezone,
   fileTransfer.addTask,
   fileTransfer.cancelDirectTransfer,
   fileTransfer.clearAll,
   fileTransfer.createTransferTask,
   fileTransfer.removeTask,
   fileTransfer.updateTask,
   workspaceAuthTicketProvider,
   systemConfig?.download_exclude_patterns,
   tCommon,
   tSftp,
   tTerminal,
   sftpSessionApi,
   transferTasks,
   uploadFile,
   workspacePreferences,
   workspaceSessionController,
   workspaceSessionStore,
   workspaceTransferHistory,
 ])
 const workspaceCapabilities = React.useMemo(() => (
   createWorkspaceCapabilitiesFromRuntime(runtime, WORKSPACE_CAPABILITY_PRESETS.webSftp)
 ), [runtime])

 const sessionIdSet = React.useMemo(
   () => new Set(sessions.map((session) => session.id)),
   [sessions]
 )
 const configTabIdSet = React.useMemo(() => new Set(configTabIds), [configTabIds])
 const isActiveConfigTab = configTabIdSet.has(activeSessionId)
 const sessionTabItems = React.useMemo<TerminalSession[]>(() => (
   sessions.map<TerminalSession>((session) => ({
     id: session.id,
     serverId: session.serverId,
     serverName: session.label || session.serverName,
     host: session.host,
     username: session.username,
     shouldConnect: true,
     connectionPhase: session.isConnected ? "ready" : "ssh_connecting",
     status: session.isConnected ? "connected" : "reconnecting",
     lastActivity: Date.now(),
     type: "terminal",
     pinned: false,
   }))
 ), [sessions])
 const setActiveSessionIdFromTab = useCallback((sessionId: string) => {
   setActiveSessionId(sessionId)
   setFullscreenSessionId((current) => (
     current && current !== sessionId ? null : current
   ))
 }, [setFullscreenSessionId])
 const {
   splitLayout,
   setSplitLayout,
   tabDropSide,
   tabDropTargetId,
   draggingSplitSessionId,
   hiddenSplitSessionId,
   isSplitPanePreviewActive,
   workspaceDropRef,
   detachedSessionIds,
   workspaceSessionIds,
   visibleSessionIds,
   visibleSessionIdSet,
   isMultiSessionGrid,
   tabSessions,
   tabActiveId,
   handleChangeActiveSession: handleChangeTab,
   handleDetachSession: handleDetachTab,
   handleTabDragStart,
   handleTabDragMove,
   handleTabDragEnd,
   handleTabDragCancel,
   handleSplitPaneDragStart,
   handleWorkspaceNativeDragOver,
   handleWorkspaceNativeDrop,
   handleWorkspaceNativeDragLeave,
   handleSplitPaneDragEnd,
   handleSplitPaneDropToTab,
   handleRestoreDetachedSession,
   handleSplitResize,
   syncSplitLayout,
   removeSessionFromWorkspace,
 } = useSessionSplitWorkspace({
   sessions: sessionTabItems,
   workspaceSessions: sessionTabItems,
   activeSessionId,
   splitLayout: workspaceSplitLayout,
   setSplitLayout: setWorkspaceSplitLayout,
   workspaceTab: {
     id: SFTP_WORKSPACE_TAB_ID,
     label: WORKSPACE_TAB_LABEL,
   },
   isActiveConfigSession: isActiveConfigTab,
   isDisabled: !!fullscreenSessionId,
   setActiveSessionId: setActiveSessionIdFromTab,
   onWorkspaceSessionActivated: () => {
     setFullscreenSessionId(null)
   },
   onSessionDroppedToWorkspace: () => {
     setFullscreenSessionId(null)
   },
   buildTabSessions: ({ hasWorkspace, workspaceTabSession, workspaceSessionIds, sessions }) => {
     const workspaceSessionIdSet = new Set(workspaceSessionIds)
     const visibleTabs = hasWorkspace
       ? [
           workspaceTabSession,
           ...sessions.filter((session) => !workspaceSessionIdSet.has(session.id)),
         ]
       : sessions

     return [
       ...visibleTabs,
       ...configTabIds.map(createSftpConfigTab),
     ]
   },
 })

 useEffect(() => {
   syncSplitLayout(sessionIdSet)
   if (sessions.length === 0 && configTabIds.length === 0) {
     setConfigTabIds([SFTP_CONFIG_TAB_ID])
     setActiveSessionId(SFTP_CONFIG_TAB_ID)
     return
   }
   if (sessions.length === 0) {
     if (!configTabIdSet.has(activeSessionId)) {
       setActiveSessionId(configTabIds[0] ?? SFTP_CONFIG_TAB_ID)
     }
     return
   }
   if (!sessionIdSet.has(activeSessionId) && !configTabIdSet.has(activeSessionId)) {
     setActiveSessionId(sessions[0].id ?? configTabIds[0] ?? SFTP_CONFIG_TAB_ID)
   }
 }, [activeSessionId, configTabIds, configTabIdSet, sessionIdSet, sessions, syncSplitLayout])

 const handleReorderTabs = useCallback((newOrderIds: string[]) => {
   setSessions((current) => {
     const map = new Map(current.map((session) => [session.id, session]))
     const ordered = newOrderIds
       .map((id) => map.get(id))
       .filter((session): session is SftpSession => Boolean(session))
     const orderedIds = new Set(ordered.map((session) => session.id))
     const remaining = current.filter((session) => !orderedIds.has(session.id))

     return [...ordered, ...remaining]
   })
   setConfigTabIds((current) => {
     const ordered = newOrderIds.filter((id) => current.includes(id))
     const orderedIds = new Set(ordered)
     const remaining = current.filter((id) => !orderedIds.has(id))

     return [...ordered, ...remaining]
   })
 }, [setSessions])

 const handleNewTab = useCallback(() => {
   const configTabId = createSftpConfigTabId()

   setConfigTabIds((current) => [...current, configTabId])
   setActiveSessionId(configTabId)
   setFullscreenSessionId(null)
   setActiveId(null)
 }, [setActiveId, setFullscreenSessionId])

 // 配置拖拽传感器 - 最小化激活约束
 const sensors = useSensors(
 useSensor(PointerSensor, {
 activationConstraint: {
 distance: 5, // 更小的激活距离
 },
 }),
 useSensor(KeyboardSensor, {
 coordinateGetter: sortableKeyboardCoordinates,
 })
 )

 // 处理拖拽开始 - 直接更新状态
 const handleDragStart = React.useCallback((event: DragStartEvent) => {
 setActiveId(event.active.id as string)
 }, [setActiveId])

 // 处理拖拽结束 - 使用 useCallback 缓存
 const handleDragEnd = React.useCallback((event: DragEndEvent) => {
 const { active, over } = event

 if (over && active.id !== over.id) {
 setSessions((items) => {
 const oldIndex = items.findIndex((item) => item.id === String(active.id))
 const newIndex = items.findIndex((item) => item.id === String(over.id))

 return arrayMove(items, oldIndex, newIndex)
 })
 }

 // 清除拖拽状态
 setActiveId(null)
 }, [setActiveId, setSessions])

 // 使用 useMemo 缓存当前拖拽的会话信息，避免重复查找
 const draggedSession = React.useMemo(
 () => activeId ? sessions.find(s => s.id === activeId) : null,
 [activeId, sessions]
 )

 // ESC键退出全屏
 useEffect(() => {
 const handleKeyDown = (e: KeyboardEvent) => {
 if (e.key === 'Escape' && fullscreenSessionId) {
 setFullscreenSessionId(null)
 }
 }

 window.addEventListener('keydown', handleKeyDown)
 return () => window.removeEventListener('keydown', handleKeyDown)
 }, [fullscreenSessionId, setFullscreenSessionId])

 // 切换全屏模式（稳定回调，避免全局重渲染）
 const toggleFullscreen = useCallback((sessionId: string) => {
   setFullscreenSessionId(prev => (prev === sessionId ? null : sessionId))
 }, [setFullscreenSessionId])

 // 处理跨会话文件拖放 - 使用直连传输 (rsync/scp)
 const handleCrossSessionDrop = useCallback(async (targetSessionId: string, dragData: CrossSessionDragData) => {
   const targetSession = sessionsRef.current.find(s => s.id === targetSessionId)
   const sourceSession = sessionsRef.current.find(s => s.id === dragData.sourceSessionId)

   if (!targetSession || !sourceSession) return
   if (!targetSession.isConnected || !sourceSession.isConnected) {
     toast.error(tSftp("toastTransferSessionNotConnected"))
     return
   }

   // 如果是同一服务器，提示用户使用复制/移动
   if (sourceSession.serverId === targetSession.serverId) {
     toast.error(tSftp("toastTransferSameServer"))
     return
   }

   const fileName = dragData.fileName
   const sourcePath = dragData.filePath
   const targetPath = targetSession.currentPath

   try {
     // 使用直连传输（rsync/scp），带实时进度
     await directTransfer(
       sourceSession.serverId,
       sourcePath,
       targetSession.serverId,
       targetPath,
       sourceSession.serverName,
       targetSession.serverName,
       fileName
     )

     // 传输成功后刷新目标会话的文件列表
     try {
       const directory = await loadSftpDirectory({
         serverId: targetSession.serverId,
         path: targetPath,
         convertFileInfo,
         withParentEntry: true,
         api: sftpSessionApi,
       })

       setSessions(prev =>
         prev.map(s =>
           s.id === targetSessionId
             ? { ...s, files: directory.files }
             : s
         )
       )
     } catch {
       // 刷新失败不影响传输结果
     }

     toast.success(tSftp("toastTransferSuccess", {
       file: fileName,
       size: "-"
     }))
 } catch (err) {
     toast.error(getErrorMessage(err, tSftp("toastTransferFailed")))
   }
 }, [tSftp, convertFileInfo, directTransfer, setSessions, sftpSessionApi])

 // 快速创建并连接到服务器
 const handleQuickConnect = async (server: ApiServer) => {

 const configTabIdToReplace = configTabIdSet.has(activeSessionId) ? activeSessionId : null

 // 不限制离线服务器的连接，让用户尝试连接
 // 连接失败时会显示错误信息

 const sessionId = `session-${nextSessionId}`
 // 在SFTP页面使用根目录，在终端页面使用用户主目录
 const initialPath = "/"
 const serverDisplayName = server.name || `${server.username}@${server.host}:${server.port}`
 const newSession: SftpSession = {
 id: sessionId,
 serverId: server.id,
 serverName: serverDisplayName,
 host: server.host,
 username: server.username,
 currentPath: initialPath,
 pathBackStack: [],
 pathForwardStack: [],
 files: [],
 isConnected: false,
 isLoading: true, // 初始加载状态
 label: serverDisplayName,
 color: SESSION_COLORS[(nextSessionId - 1) % SESSION_COLORS.length],
 }
 setSessions(prev => [...prev, newSession])
 setNextSessionId(prev => prev + 1)
 if (configTabIdToReplace) {
   setConfigTabIds(prev => prev.filter(id => id !== configTabIdToReplace))
 }
 setActiveSessionId(sessionId)
 setFullscreenSessionId(null)

 // 连接并加载文件列表
 try {
 const directory = await loadSftpDirectory({
 serverId: server.id,
 path: initialPath,
 convertFileInfo,
 withParentEntry: true,
 api: sftpSessionApi,
 })

 setSessions(prev =>
 prev.map(s =>
 s.id === sessionId
 ? { ...s, currentPath: directory.path, isConnected: true, isLoading: false, files: directory.files }
 : s
 )
 )
 } catch (error: unknown) {
 console.error("Failed to load directory:", error)
 toast.error(getErrorMessage(error, tSftp("toastLoadDirectoryFailed")))

 // 连接失败，移除会话
 setSessions(prev => prev.filter(s => s.id !== sessionId))
 if (configTabIdToReplace) {
   setConfigTabIds(prev => (
     prev.includes(configTabIdToReplace) ? prev : [...prev, configTabIdToReplace]
   ))
 }
 setActiveSessionId(prev => (prev === sessionId ? configTabIdToReplace ?? SFTP_CONFIG_TAB_ID : prev))
 }
 }

 // 刷新会话文件列表
 const handleRefreshSession = useCallback(async (sessionId: string) => {
 const session = sessionsRef.current.find(s => s.id === sessionId)
 if (!session || !session.isConnected) return

 // 设置加载状态
 setSessions(prev =>
 prev.map(s => (s.id === sessionId ? { ...s, isLoading: true } : s))
 )

 try {
 const directory = await loadSftpDirectory({
 serverId: session.serverId,
 path: session.currentPath,
 convertFileInfo,
 withParentEntry: true,
 api: sftpSessionApi,
 })

 // 使用 startTransition 降低状态更新优先级
 startTransition(() => {
   setSessions(prev =>
     prev.map(s => (s.id === sessionId ? { ...s, isLoading: false, files: directory.files } : s))
   )
 })

 toast.success(tSftp("toastRefreshSuccess"))
 } catch (error: unknown) {
 console.error("Failed to refresh:", error)
 setSessions(prev =>
 prev.map(s => (s.id === sessionId ? { ...s, isLoading: false } : s))
 )
 toast.error(getErrorMessage(error, tSftp("toastRefreshFailed")))
 }
 }, [tSftp, convertFileInfo, setSessions, sftpSessionApi])

 // 断开连接
 const handleDisconnect = useCallback((sessionId: string) => {
   const remainingSessions = sessionsRef.current.filter(session => session.id !== sessionId)
   removeSessionFromWorkspace(sessionId)
   if (remainingSessions.length === 0) {
     setConfigTabIds(prev => (prev.length > 0 ? prev : [SFTP_CONFIG_TAB_ID]))
   }
   setActiveSessionId(prev => (
     prev === sessionId
       ? remainingSessions[0]?.id ?? configTabIds[0] ?? SFTP_CONFIG_TAB_ID
       : prev
   ))
   setSessions(prev => prev.filter(session => session.id !== sessionId))
   setFullscreenSessionId(prev => (prev === sessionId ? null : prev))
   setActiveId(prev => (prev === sessionId ? null : prev))
 }, [configTabIds, removeSessionFromWorkspace, setActiveId, setFullscreenSessionId, setSessions])

 const handleCloseTab = useCallback((sessionId: string) => {
   if (sessionId === SFTP_WORKSPACE_TAB_ID) {
     if (workspaceSessionIds.length === 0) {
       setSplitLayout(null)
       return
     }

     const workspaceSessionIdSet = new Set(workspaceSessionIds)
     const remainingSessions = sessionsRef.current.filter((session) => !workspaceSessionIdSet.has(session.id))

     setSplitLayout(null)
     if (remainingSessions.length === 0) {
       setConfigTabIds((current) => (current.length > 0 ? current : [SFTP_CONFIG_TAB_ID]))
     }
     setActiveSessionId((current) => (
       current && workspaceSessionIdSet.has(current)
         ? remainingSessions[0]?.id ?? configTabIds[0] ?? SFTP_CONFIG_TAB_ID
         : current
     ))
     setSessions((current) => current.filter((session) => !workspaceSessionIdSet.has(session.id)))
     setFullscreenSessionId((current) => (
       current && workspaceSessionIdSet.has(current) ? null : current
     ))
     setActiveId((current) => (
       current && workspaceSessionIdSet.has(current) ? null : current
     ))
     return
   }

   if (configTabIdSet.has(sessionId)) {
     const remainingConfigTabIds = configTabIds.filter(id => id !== sessionId)
     const nextSessionId = sessionsRef.current[0]?.id

     if (configTabIds.length <= 1 && !nextSessionId) {
       setActiveSessionId(sessionId)
       return
     }

     setConfigTabIds(remainingConfigTabIds)
     setActiveSessionId(prev => {
       if (prev !== sessionId) return prev

       const currentIndex = configTabIds.findIndex(id => id === sessionId)
       return (
         remainingConfigTabIds[currentIndex] ??
         remainingConfigTabIds[currentIndex - 1] ??
         nextSessionId ??
         SFTP_CONFIG_TAB_ID
       )
     })
     setFullscreenSessionId(null)
     setActiveId(null)
     return
   }

   handleDisconnect(sessionId)
 }, [
   configTabIds,
   configTabIdSet,
   handleDisconnect,
   setActiveId,
   setSplitLayout,
   setFullscreenSessionId,
   setSessions,
   workspaceSessionIds,
 ])

 // 重命名会话标签
 const handleRenameSession = useCallback((sessionId: string, newLabel: string) => {
 setSessions(prev => prev.map(session =>
 session.id === sessionId
 ? { ...session, label: newLabel }
 : session
 ))
 }, [setSessions])

 // 导航到目录
 const handleNavigate = useCallback(async (sessionId: string, path: string) => {
 const session = sessionsRef.current.find(s => s.id === sessionId)
 if (!session || !session.isConnected) return

 // 设置加载状态
 setSessions(prev =>
 prev.map(s => (s.id === sessionId ? { ...s, isLoading: true } : s))
 )

 try {
 const directory = await loadSftpDirectory({
 serverId: session.serverId,
 path,
 convertFileInfo,
 withParentEntry: true,
 api: sftpSessionApi,
 })

 // 使用 startTransition 降低状态更新优先级,避免阻塞 UI
 startTransition(() => {
   setSessions(prev =>
     prev.map(s =>
       {
         if (s.id !== sessionId) return s

         if (directory.path === s.currentPath) {
           return { ...s, isLoading: false, files: directory.files }
         }

         return {
           ...s,
           currentPath: directory.path,
           isLoading: false,
           files: directory.files,
           pathBackStack: [...(s.pathBackStack ?? []), s.currentPath].slice(-50),
           pathForwardStack: [],
         }
       }
     )
   )
 })
 } catch (error: unknown) {
 console.error("Failed to navigate:", error)
 setSessions(prev =>
 prev.map(s => (s.id === sessionId ? { ...s, isLoading: false } : s))
 )
 toast.error(getErrorMessage(error, tSftp("toastLoadDirectoryFailed")))
}
 }, [tSftp, convertFileInfo, setSessions, sftpSessionApi])

 // 回到上一次访问的目录
 const handleNavigateBack = useCallback(async (sessionId: string) => {
 const session = sessionsRef.current.find(s => s.id === sessionId)
 const previousPath = session?.pathBackStack?.[session.pathBackStack.length - 1]
 if (!session || !session.isConnected || !previousPath) return

 setSessions(prev =>
 prev.map(s => (s.id === sessionId ? { ...s, isLoading: true } : s))
 )

 try {
 const directory = await loadSftpDirectory({
 serverId: session.serverId,
 path: previousPath,
 convertFileInfo,
 withParentEntry: true,
 api: sftpSessionApi,
 })

 startTransition(() => {
   setSessions(prev =>
     prev.map(s => {
       if (s.id !== sessionId) return s

       const nextForwardStack = directory.path === s.currentPath
         ? (s.pathForwardStack ?? [])
         : [...(s.pathForwardStack ?? []), s.currentPath].slice(-50)

       return {
         ...s,
         currentPath: directory.path,
         isLoading: false,
         files: directory.files,
         pathBackStack: (s.pathBackStack ?? []).slice(0, -1),
         pathForwardStack: nextForwardStack,
       }
     })
   )
 })
 } catch (error: unknown) {
 console.error("Failed to navigate back:", error)
 setSessions(prev =>
 prev.map(s => (s.id === sessionId ? { ...s, isLoading: false } : s))
 )
 toast.error(getErrorMessage(error, tSftp("toastLoadDirectoryFailed")))
 }
 }, [tSftp, convertFileInfo, setSessions, sftpSessionApi])

 // 前进到下一次访问的目录
 const handleNavigateForward = useCallback(async (sessionId: string) => {
 const session = sessionsRef.current.find(s => s.id === sessionId)
 const nextPath = session?.pathForwardStack?.[session.pathForwardStack.length - 1]
 if (!session || !session.isConnected || !nextPath) return

 setSessions(prev =>
 prev.map(s => (s.id === sessionId ? { ...s, isLoading: true } : s))
 )

 try {
 const directory = await loadSftpDirectory({
 serverId: session.serverId,
 path: nextPath,
 convertFileInfo,
 withParentEntry: true,
 api: sftpSessionApi,
 })

 startTransition(() => {
   setSessions(prev =>
     prev.map(s => {
       if (s.id !== sessionId) return s

       const nextBackStack = directory.path === s.currentPath
         ? (s.pathBackStack ?? [])
         : [...(s.pathBackStack ?? []), s.currentPath].slice(-50)

       return {
         ...s,
         currentPath: directory.path,
         isLoading: false,
         files: directory.files,
         pathBackStack: nextBackStack,
         pathForwardStack: (s.pathForwardStack ?? []).slice(0, -1),
       }
     })
   )
 })
 } catch (error: unknown) {
 console.error("Failed to navigate forward:", error)
 setSessions(prev =>
 prev.map(s => (s.id === sessionId ? { ...s, isLoading: false } : s))
 )
 toast.error(getErrorMessage(error, tSftp("toastLoadDirectoryFailed")))
 }
 }, [tSftp, convertFileInfo, setSessions, sftpSessionApi])

 // 上传文件（接入统一上传任务 UI）
 const handleUpload = useCallback(async (
   sessionId: string,
   uploadFiles: FileList,
   onProgress?: (fileName: string, loaded: number, total: number) => void
 ) => {
   const session = sessionsRef.current.find(s => s.id === sessionId)
   if (!session || !session.isConnected) return

   const files = Array.from(uploadFiles)
   let successCount = 0
   let failCount = 0

  for (const file of files) {
     try {
       await uploadFile(
         session.serverId,
         session.currentPath,
         file,
         onProgress
           ? (loaded, total) => {
               onProgress(file.name, loaded, total)
             }
           : undefined,
         true // 启用 WebSocket 进度（与终端文件管理器保持一致）
       )
       successCount++
     } catch (error: unknown) {
       console.error(`Failed to upload ${file.name}:`, error)
       failCount++
   }
  }

  if (successCount > 0) {
    toast.success(tSftp("toastUploadSuccess", { count: successCount }))
     // 刷新文件列表
     await handleRefreshSession(sessionId)
  }

  if (failCount > 0) {
    toast.error(tSftp("toastUploadFailed", { count: failCount }))
  }
 }, [tSftp, uploadFile, handleRefreshSession])

 // 下载文件
 const handleDownload = useCallback((sessionId: string, fileName: string) => {
 const session = sessionsRef.current.find(s => s.id === sessionId)
 if (!session || !session.isConnected) return

 const filePath = `${session.currentPath}/${fileName}`.replace("//", "/")

 // 直接触发浏览器下载，由浏览器自带下载管理器处理
 sftpSessionApi.downloadFile(session.serverId, filePath)
 toast.success(tSftp("toastDownloadStartSingle", { file: fileName }))
 }, [tSftp, sftpSessionApi])

 /**
  * 创建多会话文件列表更新器
  * 用于桥接通用操作函数和多会话状态管理
  */
 const createSessionFilesUpdater = useCallback(
   (sessionId: string): React.Dispatch<React.SetStateAction<ComponentFile[]>> => {
     return (action) => {
       setSessions(prev =>
         prev.map(s => {
           if (s.id !== sessionId) return s
           const newFiles = typeof action === 'function' ? action(s.files) : action
           return { ...s, files: newFiles }
         })
       )
     }
   },
   [setSessions]
 )

 // 删除文件 (使用通用函数)
 const handleDelete = useCallback(
   (sessionId: string, fileName: string) => {
     const session = sessionsRef.current.find(s => s.id === sessionId)
     if (!session || !session.isConnected) return

     return performDelete({
       serverId: session.serverId,
       currentPath: session.currentPath,
       fileName,
       t: tSftp,
       notifier: toast,
       setFiles: createSessionFilesUpdater(sessionId),
       api: sftpSessionApi,
     })
   },
   [tSftp, createSessionFilesUpdater, sftpSessionApi]
 )

 // 创建文件夹 (使用通用函数)
 const handleCreateFolder = useCallback(
   (sessionId: string, name: string) => {
     const session = sessionsRef.current.find(s => s.id === sessionId)
     if (!session || !session.isConnected) return

     return performCreateFolder({
       serverId: session.serverId,
       currentPath: session.currentPath,
       name,
       t: tSftp,
       notifier: toast,
       setFiles: createSessionFilesUpdater(sessionId),
       convertFileInfo,
       api: sftpSessionApi,
     })
   },
   [tSftp, createSessionFilesUpdater, convertFileInfo, sftpSessionApi]
 )

 // 创建文件 (使用通用函数)
 const handleCreateFile = useCallback(
   (sessionId: string, name: string) => {
     const session = sessionsRef.current.find(s => s.id === sessionId)
     if (!session || !session.isConnected) return

     return performCreateFile({
       serverId: session.serverId,
       currentPath: session.currentPath,
       name,
       t: tSftp,
       notifier: toast,
       setFiles: createSessionFilesUpdater(sessionId),
       convertFileInfo,
       api: sftpSessionApi,
     })
   },
   [tSftp, createSessionFilesUpdater, convertFileInfo, sftpSessionApi]
 )

 // 重命名 (使用通用函数)
 const handleRename = useCallback(
   (sessionId: string, oldName: string, newName: string) => {
     const session = sessionsRef.current.find(s => s.id === sessionId)
     if (!session || !session.isConnected) return

     return performRename({
       serverId: session.serverId,
       currentPath: session.currentPath,
       oldName,
       newName,
       t: tSftp,
       notifier: toast,
       setFiles: createSessionFilesUpdater(sessionId),
       api: sftpSessionApi,
     })
   },
   [tSftp, createSessionFilesUpdater, sftpSessionApi]
 )

 // 读取文件
 const handleReadFile = useCallback(async (sessionId: string, fileName: string): Promise<string> => {
 const session = sessionsRef.current.find(s => s.id === sessionId)
 if (!session || !session.isConnected) {
 throw new Error("SFTP session is not connected")
 }

 const filePath = `${session.currentPath}/${fileName}`.replace("//", "/")

 try {
 const content = await sftpSessionApi.readFile(session.serverId, filePath)
 return content
 } catch (error: unknown) {
 console.error("Failed to read file:", error)
 toast.error(getErrorMessage(error, tSftp("toastReadFileFailed")))
 throw error
 }
 }, [tSftp, sftpSessionApi])

 // 保存文件 (使用通用函数)
 const handleSaveFile = useCallback(
   async (sessionId: string, fileName: string, content: string): Promise<void> => {
     const session = sessionsRef.current.find(s => s.id === sessionId)
     if (!session || !session.isConnected) {
       throw new Error("SFTP session is not connected")
     }

     await performSaveFile({
       serverId: session.serverId,
       currentPath: session.currentPath,
       fileName,
       content,
       t: tSftp,
       notifier: toast,
       setFiles: createSessionFilesUpdater(sessionId),
       convertFileInfo,
       api: sftpSessionApi,
     })
   },
   [tSftp, createSessionFilesUpdater, convertFileInfo, sftpSessionApi]
 )

 // 批量删除文件 (使用通用函数)
 const handleBatchDelete = useCallback(
   (sessionId: string, fileNames: string[]) => {
     const session = sessionsRef.current.find(s => s.id === sessionId)
     if (!session || !session.isConnected) {
       throw new Error("SFTP session is not connected")
     }

     return performBatchDelete({
       serverId: session.serverId,
       currentPath: session.currentPath,
       fileNames,
       t: tSftp,
       notifier: toast,
       setFiles: createSessionFilesUpdater(sessionId),
       api: sftpSessionApi,
     })
   },
   [tSftp, createSessionFilesUpdater, sftpSessionApi]
 )

 // 批量下载文件（文件管理器固定使用推荐的快速下载方案）
 const handleBatchDownload = useCallback(async (
   sessionId: string,
   fileNames: string[],
   excludePatterns?: string[]
 ) => {
   const session = sessionsRef.current.find(s => s.id === sessionId)
   if (!session || !session.isConnected) {
     throw new Error("SFTP session is not connected")
   }

   // 构建完整路径
   const filePaths = fileNames.map(fileName =>
     `${session.currentPath}/${fileName}`.replace("//", "/")
   )

  try {
    await sftpSessionApi.batchDownload(session.serverId, filePaths, "fast", excludePatterns)
    toast.success(tSftp("toastBatchDownloadStart", { count: fileNames.length }))
  } catch (error: unknown) {
    console.error("Failed to batch download:", error)
    toast.error(getErrorMessage(error, tSftp("toastBatchDownloadFailed")))
     throw error
   }
 }, [tSftp, sftpSessionApi])

 const renderSftpSessionCard = (
   session: SftpSession,
   isFullscreenSession = false,
   chrome: "full" | "toolbar" | "content" = "full",
   surface: "normal" | "transparent" = "normal"
 ) => (
 <SftpSessionCard
   session={session}
   isFullscreen={isFullscreenSession}
   chrome={chrome}
   surface={surface}
   connectingText={tSftp("connecting")}
   onNavigateSession={handleNavigate}
   onNavigateBackSession={handleNavigateBack}
   onNavigateForwardSession={handleNavigateForward}
   onUploadSession={handleUpload}
   onDownloadSession={handleDownload}
   onDeleteSession={handleDelete}
   onBatchDeleteSession={handleBatchDelete}
   onBatchDownloadSession={handleBatchDownload}
   onCreateFolderSession={handleCreateFolder}
   onCreateFileSession={handleCreateFile}
   onRenameSessionFile={handleRename}
   onDisconnectSession={handleDisconnect}
   onRefreshSession={handleRefreshSession}
   onReadFileSession={handleReadFile}
   onSaveFileSession={handleSaveFile}
   onRenameSessionLabel={handleRenameSession}
   onToggleFullscreen={toggleFullscreen}
 />
 )

 const renderSplitLeaf = useCallback((sessionId: string): React.ReactNode => {
   const session = sessions.find((item) => item.id === sessionId)
   if (!session) return null

   return (
     <SortableSession
       key={session.id}
       session={session}
       onCrossSessionDrop={handleCrossSessionDrop}
       dropOverlayTexts={{
         title: tSftp("crossSessionDropTitle"),
         description: tSftp("crossSessionDropDescription"),
       }}
     >
       <SessionSplitPane
         sessionId={session.id}
         title={session.label || session.serverName}
         subtitle={getSessionConnectionSubtitle(session)}
         status={session.isConnected ? "connected" : "reconnecting"}
         isActive={activeSessionId === session.id}
         background={SFTP_SPLIT_PANE_BACKGROUND}
         onFocus={() => setActiveSessionId(session.id)}
         onDragStart={() => handleSplitPaneDragStart(session.id)}
         onDragEnd={handleSplitPaneDragEnd}
         dropOverlay={<SessionSplitDropOverlay side={tabDropTargetId === session.id ? tabDropSide : null} />}
       >
         {renderSftpSessionCard(session, false, "content", "transparent")}
       </SessionSplitPane>
     </SortableSession>
   )
 }, [
   activeSessionId,
   handleSplitPaneDragEnd,
   handleSplitPaneDragStart,
   handleCrossSessionDrop,
   renderSftpSessionCard,
   sessions,
   tSftp,
   tabDropSide,
   tabDropTargetId,
 ])

 const activeSftpSession = sessions.find((session) => session.id === activeSessionId) ?? null
 const ignoredToolbarSessionId = isSplitPanePreviewActive ? draggingSplitSessionId : null
 const workspaceToolbarSession = isMultiSessionGrid
   ? sessions.find((session) => (
       session.id === activeSessionId &&
       session.id !== ignoredToolbarSessionId &&
       visibleSessionIdSet.has(session.id)
     ))
     ?? sessions.find((session) => (
       session.id !== ignoredToolbarSessionId && visibleSessionIdSet.has(session.id)
     ))
     ?? sessions.find((session) => visibleSessionIdSet.has(session.id))
     ?? null
   : null

 const handleWorkspaceSplitDragOverCapture = useCallback((event: React.DragEvent<HTMLElement>) => {
   if (!hasSplitPaneDragSession(event.dataTransfer)) return
   handleWorkspaceNativeDragOver(event)
   event.stopPropagation()
 }, [handleWorkspaceNativeDragOver])

 const handleWorkspaceSplitDropCapture = useCallback((event: React.DragEvent<HTMLElement>) => {
   if (!hasSplitPaneDragSession(event.dataTransfer)) return
   handleWorkspaceNativeDrop(event)
   event.stopPropagation()
 }, [handleWorkspaceNativeDrop])

 // 加载状态 - 直接显示界面，服务器列表异步加载
 // 与快速连接界面保持一致，不使用骨架屏

 return (
 <SshWorkspace
   adapters={workspaceAdapters}
   capabilities={workspaceCapabilities}
   layout="web"
 >
 <PageHeader title={tSftp("title")} />

 <div className="flex min-h-0 flex-1 flex-col p-3 pt-0 sm:p-4 sm:pt-0">
 <div className={cn(
   "flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border shadow-2xl transition-colors",
   "border-border/60 bg-background/70 text-foreground backdrop-blur-md"
 )}>
 <SessionTabBar
   sessions={tabSessions}
   activeId={tabActiveId}
   onChangeActive={handleChangeTab}
   onNewSession={handleNewTab}
   onCloseSession={handleCloseTab}
   onDuplicateSession={() => {}}
   onCloseOthers={() => {}}
   onCloseAll={() => {
     setSessions([])
     setSplitLayout(null)
     setConfigTabIds([SFTP_CONFIG_TAB_ID])
     setActiveSessionId(SFTP_CONFIG_TAB_ID)
     setFullscreenSessionId(null)
     setActiveId(null)
   }}
   onTogglePin={() => {}}
   onReorder={handleReorderTabs}
   isFullscreen={!!fullscreenSessionId}
   onToggleFullscreen={fullscreenSessionId ? () => setFullscreenSessionId(null) : undefined}
   hideBreadcrumb
   onDetachSession={handleDetachTab}
   canDetachSession={(session) => session.type !== "config" && session.id !== SFTP_WORKSPACE_TAB_ID}
   canCloseSession={() => true}
   detachedSessionIds={detachedSessionIds}
   showContextMenu={false}
   onTabDragStart={handleTabDragStart}
   onTabDragMove={handleTabDragMove}
   onTabDragEnd={handleTabDragEnd}
   onTabDragCancel={handleTabDragCancel}
   onRestoreDetachedSession={handleRestoreDetachedSession}
   onSplitPaneDropToTab={handleSplitPaneDropToTab}
 />
 <div
   ref={workspaceDropRef}
   className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
   onDragOverCapture={handleWorkspaceSplitDragOverCapture}
   onDropCapture={handleWorkspaceSplitDropCapture}
   onDragOver={handleWorkspaceNativeDragOver}
   onDrop={handleWorkspaceNativeDrop}
   onDragLeave={handleWorkspaceNativeDragLeave}
 >
 {isActiveConfigTab ? (
 <ServerConnectionConfigs
   defaultViewMode="grid"
   onConnect={handleQuickConnect}
 />
 ) : fullscreenSessionId ? (
 // 全屏模式 - 只显示一个会话
 <div className="relative min-h-0 flex-1 overflow-hidden">
 {sessions.filter(s => s.id === fullscreenSessionId).map(session => (
 <div key={session.id} className="h-full min-h-0" data-session-id={session.id}>
 {renderSftpSessionCard(session, true)}
 </div>
 ))}
 </div>
 ) : (
 <DndContext
 sensors={sensors}
 collisionDetection={closestCenter}
 onDragStart={handleDragStart}
 onDragEnd={handleDragEnd}
 >
 <SortableContext
 items={visibleSessionIds}
 strategy={rectSortingStrategy}
 >
 {isMultiSessionGrid && splitLayout ? (
 <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
 {workspaceToolbarSession && renderSftpSessionCard(workspaceToolbarSession, false, "toolbar")}
 <div className="relative flex min-h-0 flex-1 overflow-auto p-2">
 <SessionSplitView
 node={splitLayout}
 renderLeaf={renderSplitLeaf}
 onResize={handleSplitResize}
 hiddenSessionId={hiddenSplitSessionId}
 />
 </div>
 </div>
 ) : activeSftpSession ? (
 <SortableSession
 key={activeSftpSession.id}
 session={activeSftpSession}
 onCrossSessionDrop={handleCrossSessionDrop}
 dropOverlayTexts={{
   title: tSftp("crossSessionDropTitle"),
   description: tSftp("crossSessionDropDescription"),
 }}
 >
 <div
 data-split-session-id={activeSftpSession.id}
 className="relative h-full min-h-0 min-w-0 flex-1 overflow-hidden"
 onMouseDown={() => setActiveSessionId(activeSftpSession.id)}
 >
 <SessionSplitDropOverlay
 side={tabDropTargetId === activeSftpSession.id ? tabDropSide : null}
 edgeInset="workspace"
 topOffset={40}
 />
 {renderSftpSessionCard(activeSftpSession, false, "full")}
 </div>
 </SortableSession>
 ) : null}
 </SortableContext>

 {/* VSCode 风格的轻量级拖拽预览 - 只显示工具栏 */}
 {createPortal(
 <DragOverlay dropAnimation={null}>
 {draggedSession ? (
 <DragPreviewToolbar
 sessionLabel={draggedSession.label}
 sessionColor={draggedSession.color}
 host={draggedSession.host}
 />
 ) : null}
 </DragOverlay>,
 document.body
 )}
 </DndContext>
 )}
 </div>
 </div>
 </div>
 </SshWorkspace>
 )
}
