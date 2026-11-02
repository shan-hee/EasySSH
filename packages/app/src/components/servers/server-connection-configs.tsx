import { GrantManager } from "@/components/sharing/grant-manager"
import { PageLoading } from "@/components/page-loading"

import { useState, useEffect, useMemo, useRef, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { AddServerDialog } from "@/components/servers/add-server-dialog"
import { EditServerDialog } from "@/components/servers/edit-server-dialog"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { ServerSystemIcon } from "@/components/servers/server-system-icon"
import { ServerConnectionToolbar } from "@/components/servers/server-connection-toolbar"
import { SERVER_GRID_CLASSNAME, getServerItemClassName, ServerConnectionSummary } from "@/components/servers/server-connection-item"
import type { ServerFormData } from "@/components/servers/add-server-dialog"
import { serversApi, type Server } from "@/lib/api"
import { serverGroupsApi } from "@/lib/api/servers"
import { NO_SSH_KEY_ID, type CreateServerRequest, type ServerGroup, type UpdateServerRequest } from "@/lib/server-types"
import { sshKeyApi, type SSHKeyApi } from "@/lib/api/ssh-keys"

import { cn } from "@/lib/utils"
import { normalizeSSHAuthMethod, requiresPassword, requiresPrivateKey } from "@/lib/ssh-auth-methods"
import {
 Search,
 Plus,
 Server as ServerIcon,
 Edit,
 Copy,
 Trash2,
 } from "lucide-react"
import { toast } from "sonner"
import { getErrorMessage } from "@/lib/error-utils"
import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core"
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  rectSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { AnimatedList } from "@/components/motion/animated-list"
import { useAuthReady } from "@/hooks/use-auth-ready"
import { useTranslation } from "react-i18next"
import { useServerConnectionList } from "@/hooks/use-server-connection-list"
import { preloadTerminalConnection } from "@/lib/terminal-preload"
import { Spinner } from "@/components/ui/spinner"

/** 通过实例 HTTP API 访问服务器配置；桌面等宿主可传入自己的实现。 */
export const defaultServerConnectionConfigsApi: ServerConnectionConfigsApi = { ...serversApi, sshKeys: sshKeyApi, groups: serverGroupsApi, sharing: true }

type ViewMode = "grid" | "list"
type DragOverlaySize = { width: number; height: number } | null

const SERVER_VIEW_MODE_STORAGE_KEY = "easyssh:servers:connection-configs:view-mode"

function readStoredViewMode(defaultViewMode: ViewMode): ViewMode {
  if (typeof window === "undefined") {
    return defaultViewMode
  }

  try {
    const stored = window.localStorage.getItem(SERVER_VIEW_MODE_STORAGE_KEY)
    return stored === "grid" || stored === "list" ? stored : defaultViewMode
  } catch {
    return defaultViewMode
  }
}

interface ServerConnectionConfigsProps {
 onConnect?: (server: Server) => void
 defaultViewMode?: ViewMode
 serverApi?: ServerConnectionConfigsApi
 ready?: boolean
 toolbarActions?: ReactNode
}

export interface ServerConnectionConfigsApi {
 sharing?: boolean
 sshKeys: SSHKeyApi
 groups: {
 list: () => Promise<ServerGroup[]>
 create: (name: string) => Promise<ServerGroup>
 }
 getById: typeof serversApi.getById
 list: typeof serversApi.list
 create: typeof serversApi.create
 update: typeof serversApi.update
 delete: typeof serversApi.delete
 reorder: typeof serversApi.reorder
 getStatistics: typeof serversApi.getStatistics
}

function ServerItemBody({
  server,
  viewMode,
  showActions = true,
  sharing = false,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  server: Server
  viewMode: ViewMode
  showActions?: boolean
  sharing?: boolean
  onEdit?: (server: Server) => void
  onDuplicate?: (server: Server) => void
  onDelete?: (id: string) => void
}) {
  const { t } = useTranslation("servers")

  if (viewMode === "grid") {
    return (
      <>
        <ServerConnectionSummary server={server} icon={<ServerSystemIcon server={server} size={20} />} />

        {showActions && onEdit && onDuplicate && onDelete && (
          <div
            className="flex items-center justify-end gap-1"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {sharing && (
              <GrantManager
                server={server}
                compact
                triggerClassName="h-7 w-7 text-muted-foreground hover:text-muted-foreground [&_svg]:size-3.5"
              />
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:bg-transparent hover:text-muted-foreground dark:hover:bg-transparent"
              onClick={() => onDuplicate(server)}
              title={t("tooltipDuplicate")}
              aria-label={t("tooltipDuplicate")}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:bg-transparent hover:text-muted-foreground dark:hover:bg-transparent"
              onClick={() => onEdit(server)}
              title={t("tooltipEdit")}
              aria-label={t("tooltipEdit")}
            >
              <Edit className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-destructive hover:bg-transparent hover:text-destructive dark:hover:bg-transparent"
              onClick={() => onDelete(server.id)}
              title={t("tooltipDelete")}
              aria-label={t("tooltipDelete")}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </>
    )
  }

  return (
    <>
      <ServerSystemIcon server={server} size={20} />

      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
        <div className="min-w-0 sm:w-52 sm:flex-none md:w-56">
          <div className="flex min-w-0 items-center gap-2">
            <div className="truncate text-sm font-medium text-foreground">
              {server.name || server.host}
            </div>
          </div>
          <div className="truncate text-xs font-mono text-muted-foreground">
            {server.username}@{server.host}:{server.port}
          </div>
        </div>

        {server.description && (
          <div
            className="line-clamp-2 text-xs text-muted-foreground/80 sm:line-clamp-1 sm:flex-1 sm:text-left"
          >
            {server.description}
          </div>
        )}
      </div>

      {server.tags && server.tags.length > 0 && (
        <div className="col-start-2 flex max-w-full flex-wrap gap-1 overflow-hidden sm:col-start-auto sm:max-w-[12rem] sm:flex-shrink-0 md:max-w-[16rem]">
          {server.tags.map((tag) => (
            <Badge key={tag} variant="outline" className="max-w-[8rem] truncate text-xs">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {showActions && onEdit && onDuplicate && onDelete && (
        <div
          className="col-start-2 flex items-center justify-end gap-1 sm:col-start-auto sm:flex-shrink-0"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {sharing && <GrantManager server={server} compact />}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 hover:bg-transparent hover:text-foreground dark:hover:bg-transparent"
            onClick={() => onDuplicate(server)}
            title={t("tooltipDuplicate")}
            aria-label={t("tooltipDuplicate")}
          >
            <Copy className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 hover:bg-transparent hover:text-foreground dark:hover:bg-transparent"
            onClick={() => onEdit(server)}
            title={t("tooltipEdit")}
            aria-label={t("tooltipEdit")}
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-destructive hover:bg-transparent hover:text-destructive dark:hover:bg-transparent"
            onClick={() => onDelete(server.id)}
            title={t("tooltipDelete")}
            aria-label={t("tooltipDelete")}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )}
    </>
  )
}

function ServerDragPreview({
  server,
  viewMode,
  size,
}: {
  server: Server
  viewMode: ViewMode
  size: DragOverlaySize
}) {
  return (
    <div
      className={cn(getServerItemClassName(viewMode, false), "pointer-events-none shadow-lg opacity-95")}
      style={size ? { width: size.width, height: size.height } : undefined}
    >
      <ServerItemBody server={server} viewMode={viewMode} showActions={false} />
    </div>
  )
}

function ServerStaticItem({
  server,
  viewMode,
  onConnect,
}: {
  server: Server
  viewMode: ViewMode
  onConnect?: (id: string) => void
}) {
  return (
    <div
      className={getServerItemClassName(viewMode, !!onConnect)}
      role={onConnect ? "button" : undefined}
      tabIndex={onConnect ? 0 : undefined}
      onDoubleClick={() => onConnect?.(server.id)}
      onKeyDown={(event) => {
        if (!onConnect || (event.key !== "Enter" && event.key !== " ")) return
        event.preventDefault()
        onConnect(server.id)
      }}
    >
      <ServerItemBody server={server} viewMode={viewMode} showActions={false} />
    </div>
  )
}

// 可排序的服务器项组件
function SortableServerItem({
  server,
  viewMode,
  onConnect,
  onEdit,
  onDuplicate,
  onDelete,
  sharing,
  disabled,
}: {
  server: Server
  viewMode: ViewMode
  onConnect: (id: string) => void
  onEdit: (server: Server) => void
  onDuplicate: (server: Server) => void
  onDelete: (id: string) => void
  disabled: boolean
  sharing?: boolean
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: server.id, disabled })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition || 'transform 250ms ease', // 保留拖拽动画，缩短时长避免与 AnimatedList 冲突
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={getServerItemClassName(viewMode)}
      onDoubleClick={() => onConnect(server.id)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        onConnect(server.id)
      }}
    >
      <ServerItemBody
        server={server}
        viewMode={viewMode}
        onEdit={onEdit}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
        sharing={sharing}
      />
    </div>
  )
}

export function ServerConnectionConfigs({
 onConnect,
 defaultViewMode = "list",
 serverApi = defaultServerConnectionConfigsApi,
 ready: externalReady,
 toolbarActions,
}: ServerConnectionConfigsProps) {
 const authReady = useAuthReady()
 const ready = externalReady ?? authReady.ready
 const { t } = useTranslation("servers")
 const { t: tSharing } = useTranslation("sharing")
 const [searchTerm, setSearchTerm] = useState("")
 const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
 const [duplicatingServer, setDuplicatingServer] = useState<Server | null>(null)
 const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
 const [editingServer, setEditingServer] = useState<Server | null>(null)
 const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
 // 分组以 ID 筛选；'all' 表示全部。
 const [activeGroup, setActiveGroup] = useState<string>('all')
 const [groups, setGroups] = useState<ServerGroup[]>([])
 const [viewMode, setViewMode] = useState<ViewMode>(() => readStoredViewMode(defaultViewMode))
 const [draggedServer, setDraggedServer] = useState<Server | null>(null)
 const [dragOverlaySize, setDragOverlaySize] = useState<DragOverlaySize>(null)
 const [isMounted, setIsMounted] = useState(false)
 const [saving, setSaving] = useState(false)
 const scrollRef = useRef<HTMLDivElement>(null)
 const loadMoreRef = useRef<HTMLDivElement>(null)
 const history = useServerConnectionList({
   api: serverApi, ready, search: searchTerm, group: activeGroup,
   busy: saving || draggedServer !== null || isAddDialogOpen || isEditDialogOpen || deleteTargetId !== null,
 })
 const { servers, setServers, statistics, loading, loadingMore, hasMore, error, loadMore, reload: loadServers } = history
 const requestBusy = saving || draggedServer !== null || isAddDialogOpen || isEditDialogOpen || deleteTargetId !== null

 useEffect(() => {
   void preloadTerminalConnection().catch((error) => {
     console.error("Failed to preload terminal connection:", error)
   })
 }, [])

 useEffect(() => {
   const root = scrollRef.current
   const target = loadMoreRef.current
   if (!root || !target || loading || loadingMore || error || !hasMore || requestBusy || history.searchPending) return
   let active = true
   const observer = new IntersectionObserver(([entry]) => {
     if (active && entry?.isIntersecting) void loadMore()
   }, { root, rootMargin: "0px 0px 160px 0px" })
   observer.observe(target)
   return () => { active = false; observer.disconnect() }
 }, [error, hasMore, history.searchPending, loadMore, loading, loadingMore, requestBusy])

 // 统计以分组 ID 计数；名称仅用于展示，筛选按钮只显示有服务器的分组。
 const groupFilters = useMemo(() => {
 const counts = statistics?.by_group ?? {}
 return groups
 .filter((group) => (counts[group.id] ?? 0) > 0)
 .map((group) => [group.id, group.name, counts[group.id] ?? 0] as const)
 .sort(([, a], [, b]) => a.localeCompare(b, "zh-CN"))
 }, [groups, statistics])

 const availableGroups = useMemo(
 () => groups.map((group) => group.name).sort((a, b) => a.localeCompare(b, "zh-CN")),
 [groups]
 )

 useEffect(() => {
 if (!ready) return
 let active = true
 serverApi.groups.list()
 .then((items) => { if (active) setGroups(items) })
 .catch((error: unknown) => console.error("Failed to load server groups:", error))
 return () => { active = false }
 }, [ready, serverApi, statistics])

 /** 表单填写分组名称：沿用同名分组，没有时先创建。空名称表示不分组。 */
 const resolveGroupId = async (name: string | undefined): Promise<string> => {
 const trimmed = name?.trim() ?? ""
 if (!trimmed) return ""
 const existing = groups.find((group) => group.name === trimmed)
 ?? (await serverApi.groups.list()).find((group) => group.name === trimmed)
 if (existing) return existing.id
 const created = await serverApi.groups.create(trimmed)
 setGroups((current) => [...current.filter((group) => group.id !== created.id), created])
 return created.id
 }

 const availableTags = useMemo(() => {
 return Object.keys(statistics?.by_tag ?? {}).sort((a, b) => a.localeCompare(b, "zh-CN"))
 }, [statistics])

 const deleteTargetServer = useMemo(
 () => servers.find(server => server.id === deleteTargetId) || null,
 [deleteTargetId, servers]
 )

 const editInitialData = useMemo(() => (editingServer ? {
 name: editingServer.name,
 host: editingServer.host,
 port: editingServer.port?.toString() || "22",
 username: editingServer.username,
	 authMethod: normalizeSSHAuthMethod(editingServer.auth_method),
 password: "",
 sshKeyId: editingServer.ssh_key_id ?? "",
 rememberPassword: Boolean(editingServer.has_password),
 tags: editingServer.tags || [],
 description: editingServer.description || "",
 group: editingServer.group || "",
 jumpServer: editingServer.jump_server_id || "",
 autoConnect: false,
 keepAlive: true,
 } : undefined), [editingServer])

 const duplicateInitialData = useMemo<Partial<ServerFormData> | undefined>(() => {
 if (!duplicatingServer) return undefined

 return {
 name: t("duplicateName", { name: duplicatingServer.name || duplicatingServer.host }),
 host: duplicatingServer.host,
 port: duplicatingServer.port?.toString() || "22",
 username: duplicatingServer.username,
	 authMethod: normalizeSSHAuthMethod(duplicatingServer.auth_method),
 password: "",
 sshKeyId: duplicatingServer.ssh_key_id ?? "",
 rememberPassword: false,
 tags: duplicatingServer.tags || [],
 description: duplicatingServer.description || "",
 group: duplicatingServer.group || "",
 jumpServer: duplicatingServer.jump_server_id || "",
 autoConnect: false,
 keepAlive: true,
 }
 }, [duplicatingServer, t])

 // 配置拖拽传感器
 const sensors = useSensors(
   useSensor(PointerSensor, {
     activationConstraint: {
       distance: 8, // 移动8px后才激活拖拽，避免与点击事件冲突
     },
   })
 )

 useEffect(() => {
 if (statistics && activeGroup !== 'all' && !groupFilters.some(([groupId]) => groupId === activeGroup)) {
 setActiveGroup('all')
 }
 }, [activeGroup, groupFilters, statistics])

 // 客户端挂载检测
 useEffect(() => {
   setIsMounted(true)
 }, [])

 useEffect(() => {
   if (typeof window === "undefined") return

   try {
     window.localStorage.setItem(SERVER_VIEW_MODE_STORAGE_KEY, viewMode)
   } catch {
     // 忽略无可用本地存储的环境。
   }
 }, [viewMode])

 const handleConnect = (serverId: string) => {
 const server = servers.find(s => s.id === serverId)
 if (server) {
 onConnect?.(server)
 }
 }

 const handleEdit = (server: Server) => {
 setEditingServer(server)
 setIsEditDialogOpen(true)
 }

 const handleDuplicate = (server: Server) => {
 setDuplicatingServer(server)
 setIsAddDialogOpen(true)
 }

 const handleAddDialogOpenChange = (nextOpen: boolean) => {
 setIsAddDialogOpen(nextOpen)
 if (!nextOpen) {
 setDuplicatingServer(null)
 }
 }

 const handleRequestDelete = (serverId: string) => {
 setDeleteTargetId(serverId)
 }

 const handleDelete = async (serverId: string) => {
 if (saving) return
 setSaving(true)
 history.cancelPendingPage()
 try {
 // 认证基于 HttpOnly Cookie

 await serverApi.delete(serverId)
 toast.success(t("toastDeleteSuccess"))

 // 乐观更新：直接从本地列表移除，避免整个页面刷新
 history.remove(serverId)
 setDeleteTargetId(null)
 void history.refreshStatistics()
 } catch (error: unknown) {
 console.error("Failed to delete server:", error)
 toast.error(getErrorMessage(error, t("toastDeleteFailed")))
 } finally {
 setSaving(false)
 }
 }

 // 拖拽开始
 const handleDragStart = (event: DragStartEvent) => {
 history.cancelPendingPage()
 const server = servers.find(s => s.id === String(event.active.id))
 setDraggedServer(server || null)
 const initialRect = event.active.rect.current.initial
 setDragOverlaySize(initialRect
 ? { width: initialRect.width, height: initialRect.height }
 : null
 )
 }

 // 拖拽结束
 const handleDragEnd = async (event: DragEndEvent) => {
 const { active, over } = event
 setDraggedServer(null)
 setDragOverlaySize(null)

 if (!over || active.id === over.id) return
 if (saving) return

 const oldIndex = servers.findIndex(s => s.id === String(active.id))
 const newIndex = servers.findIndex(s => s.id === String(over.id))

 if (oldIndex !== -1 && newIndex !== -1) {
 const newOrder = arrayMove(servers, oldIndex, newIndex)

 // 乐观更新：立即更新 UI
 setSaving(true)
 history.cancelPendingPage()
 setServers(newOrder)

 // 调用后端 API 保存新顺序
 try {
 // 认证基于 HttpOnly Cookie

 const serverIds = newOrder.map(s => s.id)
 await serverApi.reorder(serverIds)
 toast.success(t("toastSortSaved"))
 } catch (error: unknown) {
 console.error("Failed to save server order:", error)
 toast.error(getErrorMessage(error, t("toastSortSaveFailed")))
 // 保存失败时恢复本地顺序，保留已加载的页面。
 setServers(servers)
 } finally {
 setSaving(false)
 }
 }
 }

 const handleDragCancel = () => {
 setDraggedServer(null)
 setDragOverlaySize(null)
 }

 const handleAddServer = async (data: ServerFormData) => {
 if (saving) return false
 setSaving(true)
 history.cancelPendingPage()
 try {
 // 认证基于 HttpOnly Cookie

 const serverData: CreateServerRequest = {
 name: data.name,
 host: data.host,
 port: parseInt(data.port) || 22,
 username: data.username,
	 auth_method: data.authMethod,
 group_id: await resolveGroupId(data.group),
 jump_server_id: data.jumpServer,
 tags: data.tags,
 description: data.description,
 ...(requiresPrivateKey(data.authMethod) && data.sshKeyId ? { ssh_key_id: data.sshKeyId } : {}),
 }

	 if (data.rememberPassword) {
	 if (requiresPassword(data.authMethod) && data.password) {
	 serverData.password = data.password
	 }
	 }

 await serverApi.create(serverData)

 toast.success(t("toastCreateSuccess"))
 handleAddDialogOpenChange(false)

 await Promise.all([loadServers(), history.refreshStatistics()])
 } catch (error: unknown) {
 console.error("Failed to add server:", error)
 toast.error(getErrorMessage(error, t("toastCreateFailed")))
 return false
 } finally {
 setSaving(false)
 }
 }

 const handleEditServer = async (data: ServerFormData) => {
 if (saving) return false
 setSaving(true)
 history.cancelPendingPage()
 try {
 // 认证基于 HttpOnly Cookie

 if (!editingServer) {
 toast.error(t("toastEditNotFound"))
 return false
 }

 const updateData: UpdateServerRequest = {
 name: data.name,
 host: data.host,
 port: parseInt(data.port) || 22,
 username: data.username,
	 auth_method: data.authMethod,
 group_id: await resolveGroupId(data.group),
 jump_server_id: data.jumpServer,
 tags: data.tags,
 description: data.description,
 }
 // 密钥认证未选择已保存密钥时解除原有关联，连接时再提供临时密钥。
 if (requiresPrivateKey(data.authMethod)) {
 updateData.ssh_key_id = data.sshKeyId || NO_SSH_KEY_ID
 }

	 const needsPassword = requiresPassword(data.authMethod)
	 if (needsPassword) {
	 if (data.rememberPassword && data.password) {
	 updateData.password = data.password
	 } else if (!data.rememberPassword && (editingServer.has_password || data.password)) {
	 updateData.password = ""
	 }
	 } else if (editingServer.has_password) {
	 updateData.password = ""
	 }

 const updatedServer = await serverApi.update(editingServer.id, updateData)
 if (serverApi.sharing && (editingServer.jump_server_id !== updatedServer.jump_server_id || editingServer.host !== updatedServer.host || editingServer.port !== updatedServer.port || editingServer.username !== updatedServer.username || editingServer.auth_method !== updatedServer.auth_method || updateData.password !== undefined || updateData.ssh_key_id !== undefined && updateData.ssh_key_id !== editingServer.ssh_key_id)) {
   const serverId = editingServer.id
   toast(tSharing("reviewAfterEdit"), { action: { label: tSharing("reviewGrants"), onClick: () => window.dispatchEvent(new CustomEvent("easyssh:review-sharing", { detail: { serverId } })) } })
 }

 toast.success(t("toastUpdateSuccess"))
 setIsEditDialogOpen(false)
 setEditingServer(null)

 // 乐观更新：只更新被修改的服务器，避免整个页面刷新
 setServers(prev => prev.map(s =>
 s.id === editingServer.id ? updatedServer : s
 ))
 if (searchTerm.trim() || activeGroup !== "all") await loadServers()
 void history.refreshStatistics()
 } catch (error: unknown) {
 console.error("Failed to update server:", error)
 toast.error(getErrorMessage(error, t("toastUpdateFailed")))
 return false
 } finally {
 setSaving(false)
 }
 }

 return (
 <>
 <div data-server-connection-configs className={"h-full flex flex-col overflow-hidden relative transition-colors bg-background text-foreground"}>

 <div className="flex min-h-0 flex-1 flex-col items-center px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
 <div className={cn("flex min-h-0 w-full flex-1 flex-col gap-3 transition-[max-width] duration-200", viewMode === "grid" ? "max-w-6xl" : "max-w-3xl")}>
 {/* 工具栏在加载、空列表和有数据时保持同一布局。 */}
 <ServerConnectionToolbar
   search={searchTerm}
   onSearchChange={setSearchTerm}
   viewMode={viewMode}
   onViewModeChange={setViewMode}
   total={statistics?.total ?? (loading ? "—" : servers.length)}
   groups={groupFilters}
   activeGroup={activeGroup}
   onGroupChange={setActiveGroup}
   disabled={saving || draggedServer !== null}
   actions={<>
     {toolbarActions}
     {serverApi.sharing && <GrantManager />}
     <Button onClick={() => setIsAddDialogOpen(true)} className="flex-1 shadow-sm sm:flex-none">
       <Plus className="mr-2 h-4 w-4" />
       {t("addServer")}
     </Button>
   </>}
 />

 {/* 与空状态共用占位高度，避免加载提示被 flex-1 推到页面中央。 */}
 {loading && (
 <PageLoading className="min-h-48 flex-none py-8" label={t("loadingList")} />
 )}

 {/* 服务器列表 */}
 {!loading && (servers.length > 0 || hasMore) && (
 <div ref={scrollRef} aria-busy={loadingMore} className="min-h-0 flex-1 overflow-y-auto pr-1 scrollbar-custom">
 {isMounted ? (
 <DndContext
 sensors={sensors}
 collisionDetection={closestCenter}
 onDragStart={handleDragStart}
 onDragEnd={handleDragEnd}
 onDragCancel={handleDragCancel}
 >
 <SortableContext
 items={servers.map(s => s.id)}
 strategy={viewMode === "grid" ? rectSortingStrategy : verticalListSortingStrategy}
 >
 <AnimatedList maxStaggerDelay={0.18} className={viewMode === "grid" ? SERVER_GRID_CLASSNAME : "space-y-2"}>
 {servers.map((server) => (
 <SortableServerItem
 key={server.id}
 server={server}
 viewMode={viewMode}
 onConnect={handleConnect}
 onEdit={handleEdit}
 onDuplicate={handleDuplicate}
 onDelete={handleRequestDelete}
 sharing={serverApi.sharing}
 disabled={saving || loadingMore || history.searchPending}
 />
 ))}
 </AnimatedList>
 </SortableContext>

 {createPortal(
 <DragOverlay adjustScale={false}>
 {draggedServer ? (
 <ServerDragPreview server={draggedServer} viewMode={viewMode} size={dragOverlaySize} />
 ) : null}
 </DragOverlay>,
 document.body
 )}
 </DndContext>
 ) : (
 // 服务端渲染时的静态列表
 <AnimatedList maxStaggerDelay={0.18} className={viewMode === "grid" ? SERVER_GRID_CLASSNAME : "space-y-2"}>
 {servers.map((server) => (
 <ServerStaticItem key={server.id} server={server} viewMode={viewMode} onConnect={handleConnect} />
 ))}
 </AnimatedList>
 )}
 {hasMore && !error && (
 <div ref={loadMoreRef} className="flex min-h-12 items-center justify-center text-sm text-muted-foreground">
 {loadingMore && <Spinner aria-label={t("loadingList")} />}
 </div>
 )}
 </div>
 )}

 {Boolean(error) && (
 <div role="alert" className="flex shrink-0 items-center justify-center gap-3 py-3 text-sm text-destructive">
 <span>{getErrorMessage(error, t("toastLoadFailed"))}</span>
 <Button variant="outline" size="sm" disabled={loading || loadingMore || requestBusy} onClick={() => void history.retry()}>{t("retryLoad")}</Button>
 </div>
 )}

 {/* 空状态 - 筛选后无结果 */}
 {!loading && !error && servers.length === 0 && (searchTerm.trim() !== "" || activeGroup !== "all") && (
 <div className="flex min-h-48 flex-none flex-col items-center justify-center gap-3 py-8 text-center">
 <div className={"inline-flex items-center justify-center w-12 h-12 rounded-lg border bg-card border-border"}>
 <Search className={"h-6 w-6 text-muted-foreground"} />
 </div>
 <div className="space-y-1">
 <p className={"text-sm text-muted-foreground"}>
 {t("emptyFilteredTitle")}
 </p>
 <p className={"text-xs text-muted-foreground/80"}>
 {t("emptyFilteredDescription")}
 </p>
 </div>
 </div>
 )}

 {/* 空状态 - 完全没有服务器 */}
 {!loading && !error && servers.length === 0 && !hasMore && !searchTerm.trim() && activeGroup === "all" && (
 <div className="flex min-h-48 flex-none flex-col items-center justify-center gap-3 py-8 text-center">
 <div className={"inline-flex items-center justify-center w-12 h-12 rounded-lg border bg-card border-border"}>
 <ServerIcon className={"h-6 w-6 text-muted-foreground"} />
 </div>
 <div className="space-y-1">
 <p className={"text-sm text-muted-foreground"}>
 {t("emptyAllTitle")}
 </p>
 <p className={"text-xs text-muted-foreground/80"}>
 {t("emptyAllDescription")}
 </p>
 </div>
 </div>
 )}
 </div>
 </div>
 </div>

 {/* 添加服务器弹窗 */}
 <AddServerDialog
 serverApi={serverApi}
 keyApi={serverApi.sshKeys}
 open={isAddDialogOpen}
 onOpenChange={handleAddDialogOpenChange}
 onSubmit={handleAddServer}
 availableGroups={availableGroups}
 availableTags={availableTags}
 title={duplicatingServer ? t("duplicateDialogTitle") : undefined}
 description={duplicatingServer ? t("duplicateDialogDescription") : undefined}
 initialData={duplicateInitialData}
 />

 {/* 编辑服务器弹窗 */}
 <EditServerDialog
 serverApi={serverApi}
 serverId={editingServer?.id}
 keyApi={serverApi.sshKeys}
 open={isEditDialogOpen}
 onOpenChange={setIsEditDialogOpen}
 onSubmit={handleEditServer}
 availableGroups={availableGroups}
 availableTags={availableTags}
 initialData={editInitialData}
 />

 <ConfirmDialog
 open={deleteTargetId !== null}
 onOpenChange={(nextOpen) => {
 if (!nextOpen) setDeleteTargetId(null)
 }}
 title={t("tooltipDelete")}
 description={deleteTargetServer?.name || deleteTargetServer?.host
 ? `${t("confirmDelete")}\n${deleteTargetServer.name || deleteTargetServer.host}`
 : t("confirmDelete")}
 confirmText={t("tooltipDelete")}
 variant="destructive"
 onConfirm={() => {
 if (deleteTargetId) {
 void handleDelete(deleteTargetId)
 }
 }}
 />
 </>
 )
}
