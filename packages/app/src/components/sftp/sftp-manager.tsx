import { Button } from "@/components/ui/button"
import { SessionWorkspaceToolbar } from "@/components/tabs/session-workspace-toolbar"

import { useRef, useMemo, useEffect, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { SftpSessionProvider } from "@/contexts/sftp-session-context"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { ChmodDialog } from "@/components/sftp/chmod-dialog"
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog"
import type { SftpDirectorySource } from "@/lib/session/sftp-directory-source"
import { SftpFileTreePane } from "./sftp-file-tree-pane"
import { useSftpTreeLayout } from "./use-sftp-tree-layout"
import { FolderTree } from "lucide-react"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import type { BatchDeleteResult } from "@/lib/session/sftp-operations"
import { DEFAULT_SFTP_DOWNLOAD_EXCLUDE_PATTERNS } from "@/lib/session/workspace-settings"
import type { SshWorkspacePreferenceAdapter } from "@/lib/session/workspace"
import type { TransferTaskActions } from "@/lib/session/transfer-controller"
import { useWorkspaceSftpTranslator } from "@/components/ssh-workspace/use-workspace-translator"
import { SftpWorkspaceToolbar } from "@/components/sftp/sftp-workspace-toolbar"
import { SftpFileToolbar } from "@/components/sftp/sftp-file-toolbar"
import { SftpFileBrowserPane } from "@/components/sftp/sftp-file-browser-pane"
import { SftpFileEditorPane } from "@/components/sftp/sftp-file-editor-pane"
import { useOptionalSshWorkspace } from "@/components/ssh-workspace/ssh-workspace"
import { useSftpFileBrowserController, type SftpFileBrowserItem } from "@/components/sftp/use-sftp-file-browser-controller"
import { useSftpDragDropController } from "@/components/sftp/use-sftp-drag-drop-controller"
import { useSftpFileActionController } from "@/components/sftp/use-sftp-file-action-controller"
import { useSftpWorkspaceHeaderController } from "@/components/sftp/use-sftp-workspace-header-controller"

export type SftpManagerFileItem = SftpFileBrowserItem

export interface SftpTerminalPathActions {
  onCopy: () => void | Promise<void>
  onInsert: () => void
  onEnter: () => void
}

export interface SftpManagerProps {
  directorySource: SftpDirectorySource
  keyboardShortcutsEnabled: boolean
  serverId: string
  serverName: string
  host: string
  username: string
  isConnected: boolean
  currentPath: string
  files: SftpManagerFileItem[]
  sessionId: string
  sessionLabel: string
  sessionColor?: string
  isFullscreen?: boolean
  chrome?: "full" | "toolbar" | "content"
  surface?: "normal" | "transparent"
  viewModeStorageKey?: string
  defaultViewMode?: "grid" | "list"
  showLoadingOverlay?: boolean
  pendingPath?: string | null
  failedPath?: string | null
  error?: string | null
  isLoading?: boolean // 是否正在加载文件列表
  onNavigate: (path: string) => void
  onNavigateBack?: () => void | Promise<void>
  canNavigateBack?: boolean
  onNavigateForward?: () => void | Promise<void>
  canNavigateForward?: boolean
  onInternalBackHandlerChange?: (
    handler: { handle: () => boolean | Promise<boolean> } | null
  ) => void
  onUpload: (files: FileList, onProgress?: (fileName: string, loaded: number, total: number) => void) => void
  onDownload: (fileName: string) => void
  onDelete: (fileName: string, isDirectory: boolean) => void
  onBatchDelete?: (fileNames: string[], hasDirectory: boolean) => Promise<BatchDeleteResult>
  onBatchDownload?: (fileNames: string[], excludePatterns?: string[]) => Promise<void>
  onCreateFolder: (name: string) => void
  onCreateFile?: (name: string) => void
  onRename: (oldName: string, newName: string) => void
  onDisconnect: () => void
  onRefresh: () => void
  onReadFile?: (fileName: string) => Promise<string>
  onSaveFile?: (fileName: string, content: string) => Promise<void>
  onRenameSession?: (newLabel: string) => void
  onToggleFullscreen?: () => void
  terminalPathActions?: SftpTerminalPathActions
  toolbarActions?: ReactNode
  /** 传输任务；未传入时使用工作区的传输管理。 */
  transfers?: TransferTaskActions
  preferences?: SshWorkspacePreferenceAdapter
}

export function SftpManager(props: SftpManagerProps) {
  const tSftp = useWorkspaceSftpTranslator()
  const workspace = useOptionalSshWorkspace()

  const {
    keyboardShortcutsEnabled,
    directorySource,
    host,
    username,
    isConnected,
    currentPath,
    files,
    sessionId,
    sessionLabel,
    sessionColor,
    serverId,
    serverName,
    isFullscreen = false,
    chrome = "full",
    surface = "normal",
    viewModeStorageKey = "easyssh:sftp:viewMode:sftp",
    defaultViewMode = "grid",
    isLoading = false,
    showLoadingOverlay = false,
    pendingPath = null,
    failedPath = null,
    error = null,
    onNavigate,
    onNavigateBack,
    canNavigateBack,
    onNavigateForward,
    canNavigateForward,
    onInternalBackHandlerChange,
    onUpload,
    onDownload,
    onDelete,
    onBatchDelete,
    onBatchDownload,
    onCreateFolder,
    onCreateFile,
    onRename,
    onDisconnect,
    onRefresh,
    onReadFile,
    onSaveFile,
    onRenameSession,
    onToggleFullscreen,
    terminalPathActions,
    toolbarActions,
    transfers: providedTransfers,
    preferences,
  } = props
  const treeLayout = useSftpTreeLayout(viewModeStorageKey, preferences ?? workspace?.adapters.preferences)
  const workspaceTransferManager = workspace?.adapters.transferManager
  const shouldRenderWorkspaceToolbar = chrome !== "content"
  const shouldRenderBody = chrome !== "toolbar"
  const shouldRenderFileToolbar = chrome !== "toolbar"
  const transfers = useMemo<TransferTaskActions | undefined>(() => {
    if (providedTransfers) return providedTransfers
    if (!workspaceTransferManager?.cancelTask || !workspaceTransferManager.removeTask) return undefined
    return {
      tasks: workspaceTransferManager.tasks,
      cancel: workspaceTransferManager.cancelTask,
      remove: workspaceTransferManager.removeTask,
      retry: workspaceTransferManager.retryTask,
    }
  }, [providedTransfers, workspaceTransferManager])
  // 面板只显示与当前服务器相关的任务；服务器间传输在源和目标两侧都可见。
  const serverTransfers = useMemo<TransferTaskActions | undefined>(() => transfers && {
    ...transfers,
    tasks: transfers.tasks.filter((task) => task.serverIds.includes(serverId)),
    retry: transfers.retry && ((taskId) => {
      const task = transfers.tasks.find((item) => item.id === taskId)
      // 重新上传到本服务器后刷新目录；失败结果由面板展示。
      return transfers.retry!(taskId).then(
        () => { if (task?.type !== "download" && task?.serverIds.at(-1) === serverId) onRefresh?.() },
        () => undefined,
      )
    }),
  }, [onRefresh, serverId, transfers])
  const {
    selectedFiles,
    setSelectedFiles,
    clearSelectedFiles,
    searchTerm,
    setSearchTerm,
    showHidden,
    toggleHidden,
    viewMode,
    setViewMode,
    sortBy,
    sortOrder,
    filteredFiles,
    handleSort,
    handleFileMouseDown,
    handleSelectAll,
  } = useSftpFileBrowserController({
    files,
    viewModeStorageKey,
    defaultViewMode,
    preferences: preferences ?? workspace?.adapters.preferences,
  })

  useEffect(() => {
    setSelectedFiles([])
  }, [currentPath, setSelectedFiles])
  useEffect(() => {
    const names = new Set(files.map((file) => file.name))
    setSelectedFiles((selected) => {
      const remaining = selected.filter((name) => names.has(name))
      return remaining.length === selected.length ? selected : remaining
    })
  }, [files, setSelectedFiles])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)
  const editingSessionLabelRef = useRef(false)

  const {
    isDragging,
    dropZoneRef,
    registerDragItem,
    draggedFileName,
    dragOverFolder,
    handleFileUpload,
  } = useSftpDragDropController({
    sessionId,
    currentPath,
    files,
    onRename,
    onUpload,
  })

  const excludePatterns = workspace?.adapters.settings?.sftp?.downloadExcludePatterns
    ?? DEFAULT_SFTP_DOWNLOAD_EXCLUDE_PATTERNS

  const {
    editingFile,
    editingFileName,
    creatingNew,
    editorState,
    pendingFilePath,
    handleEditorReady,
    handleOpenEditor,
    handleDraftChange,
    isSavingEditor,
    pendingLeave,
    leaveError,
    resolveLeave,
    leaveEditor,
    navigateWithGuard,
    chmodDialog,
    deleteConfirmDialog,
    setEditingFileName,
    setChmodDialogOpen,
    setDeleteConfirmDialogOpen,
    closeContextMenu,
    handleInputChange,
    handleFileDoubleClick,
    handleContextMenu,
    handleBlankContextMenu,
    finishRename,
    cancelRename,
    handleRenameBlur,
    finishCreate,
    cancelCreate,
    handleCreateBlur,
    startCreateNew,
    handleCloseEditor,
    handleSaveFile,
    handleFileAction,
    handleContextMenuAction,
    confirmDelete,
    handleChmod,
  } = useSftpFileActionController({
    keyboardShortcutsEnabled,
    serverId,
    currentPath,
    filteredFiles,
    selectedFiles,
    setSelectedFiles,
    clearSelectedFiles,
    onSelectAll: handleSelectAll,
    editInputRef,
    fileInputRef,
    excludePatterns,
    tSftp,
    notifier: workspace?.adapters.notifier,
    chmodFile: workspace?.adapters.apiClient?.sftp?.chmod,
    editingSessionLabelRef,
    onNavigate,
    onNavigateBack,
    canNavigateBack,
    onInternalBackHandlerChange,
    onDownload,
    onDelete,
    onBatchDelete,
    onBatchDownload,
    onCreateFolder,
    onCreateFile,
    onRename,
    onRefresh,
    onReadFile,
    onSaveFile,
    onUploadFiles: handleFileUpload,
  })

  const {
    pathInputValue,
    setPathInputValue,
    isEditingPath,
    setIsEditingPath,
    displayPath,
    pathSegments,
  } = useSftpWorkspaceHeaderController({
    sessionLabel,
    currentPath,
    isEditorOpen: editorState.isOpen,
    editorPath: editorState.filePath,
    onRenameSession,
    editingSessionLabelRef,
  })

  // Context value for nested components
  const sessionContextValue = useMemo(() => ({
    sessionId,
    sessionLabel,
    sessionColor,
    serverId,
    serverName,
    host,
    username,
    isConnected,
    isFullscreen,
    currentPath,
    files,
    onNavigate,
    onUpload,
    onDownload,
    onDelete,
    onCreateFolder,
    onRename,
    onDisconnect,
    onRefresh,
    onReadFile,
    onSaveFile,
    onRenameSession,
    onToggleFullscreen,
  }), [
    currentPath,
    files,
    host,
    isConnected,
    isFullscreen,
    onCreateFolder,
    onDownload,
    onNavigate,
    onRefresh,
    onRename,
    onRenameSession,
    onSaveFile,
    onReadFile,
    onUpload,
    onDelete,
    onDisconnect,
    onToggleFullscreen,
    serverId,
    serverName,
    sessionColor,
    sessionId,
    sessionLabel,
    username,
  ])

  // 主界面内容
  const managerContent = (
    <TooltipProvider delayDuration={300}>
      <SftpSessionProvider value={sessionContextValue}>
        <div
          ref={treeLayout.panelRef}
          className={cn(
            "flex min-w-0 w-full flex-col overflow-hidden rounded-none border-0 transition-colors",
            (surface !== "transparent" || isFullscreen) && "bg-background",
            shouldRenderBody ? "h-full" : "shrink-0",
            isFullscreen && "fixed inset-0 z-[9999]"
          )}
        >
      {shouldRenderWorkspaceToolbar && (
      <SessionWorkspaceToolbar kind="sftp">
      <SftpWorkspaceToolbar
        leadingAction={<Button ref={treeLayout.toggleRef} variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={treeLayout.toggle}
          aria-pressed={treeLayout.visible} aria-label={tSftp(treeLayout.visible ? "treeHide" : "treeShow")} title={tSftp(treeLayout.visible ? "treeHide" : "treeShow")}>
          <FolderTree className="size-3.5" />
        </Button>}
        displayPath={displayPath}
        pendingPath={showLoadingOverlay ? null : pendingPath ?? pendingFilePath}
        failedPath={failedPath}
        pathInputValue={pathInputValue}
        pathSegments={pathSegments}
        isEditingPath={isEditingPath}
        isEditorOpen={editorState.isOpen}
        onPathInputValueChange={setPathInputValue}
        onEditingPathChange={setIsEditingPath}
        onNavigate={navigateWithGuard}
        onNavigateBack={onNavigateBack ? () => leaveEditor(() => { void onNavigateBack() }) : undefined}
        canNavigateBack={canNavigateBack}
        onNavigateForward={onNavigateForward ? () => leaveEditor(() => { void onNavigateForward() }) : undefined}
        canNavigateForward={canNavigateForward}
        terminalPathActions={editorState.isOpen ? undefined : terminalPathActions}
        toolbarActions={toolbarActions}
        transfers={serverTransfers}
        isFullscreen={isFullscreen}
        onToggleFullscreen={onToggleFullscreen}
        onDisconnect={() => leaveEditor(onDisconnect)}
      />
      </SessionWorkspaceToolbar>
      )}

      {shouldRenderBody && <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {treeLayout.visible && treeLayout.narrow && <button tabIndex={-1} aria-label={tSftp("treeHide")} className="absolute inset-0 z-20 bg-black/15" onClick={treeLayout.dismiss} />}
        <aside
          hidden={!treeLayout.visible}
          aria-label={tSftp("treeLabel")}
          inert={!treeLayout.visible}
          className={cn("min-h-0 shrink-0 border-r bg-background", treeLayout.narrow ? "absolute inset-y-0 left-0 z-30 shadow-lg" : "relative")}
          style={{ width: treeLayout.actualWidth }}
        >
          <SftpFileTreePane key={`${serverId}:${sessionId}`} source={directorySource} currentPath={currentPath}
            editorPath={editorState.isOpen ? editorState.filePath : undefined} showHidden={showHidden} visible={treeLayout.visible}
            onNavigate={(path) => { navigateWithGuard(path); if (treeLayout.narrow) treeLayout.dismiss() }}
            onOpenFile={(path) => { handleOpenEditor(path); if (treeLayout.narrow) treeLayout.dismiss() }}
            onDismiss={treeLayout.dismiss}
          />
          {!treeLayout.narrow && <div role="separator" aria-orientation="vertical" tabIndex={0}
            aria-label={tSftp("treeResize")} aria-valuemin={160} aria-valuemax={treeLayout.maxWidth} aria-valuenow={Math.round(treeLayout.actualWidth)}
            className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none hover:bg-primary/20 focus-visible:bg-primary/20 focus-visible:outline-none"
            onPointerDown={(event) => {
              if (event.button !== 0) return
              event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
              treeLayout.resizeStart.current = { x: event.clientX, width: treeLayout.actualWidth }
            }}
            onPointerMove={(event) => {
              const start = treeLayout.resizeStart.current
              if (start) treeLayout.resize(start.width + event.clientX - start.x)
            }}
            onPointerUp={(event) => {
              if (!treeLayout.resizeStart.current) return
              treeLayout.resizeStart.current = null
              treeLayout.persist("width", String(treeLayout.actualWidth))
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
            }}
            onPointerCancel={() => { treeLayout.resizeStart.current = null }}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
              event.preventDefault(); event.stopPropagation()
              treeLayout.persist("width", String(treeLayout.resize(treeLayout.actualWidth + (event.key === "ArrowLeft" ? -16 : 16))))
            }}
          />}
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {editorState.isOpen ? (
        <SftpFileEditorPane
          key={editorState.filePath}
          onDraftChange={handleDraftChange}
          isBusy={isSavingEditor || (!!pendingFilePath && pendingFilePath !== editorState.filePath)}
          fileName={editorState.fileName}
          filePath={editorState.filePath}
          fileContent={editorState.content}
          isOpen={editorState.isOpen}
          keyboardShortcutsEnabled={keyboardShortcutsEnabled}
          onClose={handleCloseEditor}
          onReady={() => handleEditorReady(editorState.filePath)}
          onSave={handleSaveFile}
          onDownload={() => onDownload(editorState.filePath)}
        />
      ) : (
        <>
          {shouldRenderFileToolbar && (
          <SftpFileToolbar
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
            showHidden={showHidden}
            onToggleHidden={toggleHidden}
            selectedCount={selectedFiles.length}
            onRefresh={() => { if (!isLoading) onRefresh() }}
          />
          )}

          {error && (
            <div role="alert" className="flex shrink-0 items-center gap-2 border-b bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <span className="min-w-0 flex-1 break-words">{tSftp("directoryError", { path: failedPath ?? currentPath, message: error })}</span>
              <Button variant="ghost" size="sm" onClick={() => navigateWithGuard(failedPath ?? currentPath)}>{tSftp("retryDirectory")}</Button>
            </div>
          )}
          <SftpFileBrowserPane
            currentPath={currentPath}
            hasError={!!error}
            viewMode={viewMode}
            filteredFiles={filteredFiles}
            selectedFiles={selectedFiles}
            sortBy={sortBy}
            sortOrder={sortOrder}
            isDragging={isDragging}
            isLoading={isLoading}
            showLoadingOverlay={showLoadingOverlay}
            searchTerm={searchTerm}
            creatingNew={creatingNew}
            editingFile={editingFile}
            editingFileName={editingFileName}
            draggedFileName={draggedFileName}
            dragOverFolder={dragOverFolder}
            registerDragItem={registerDragItem}
            dropZoneRef={dropZoneRef}
            fileInputRef={fileInputRef}
            editInputRef={editInputRef}
            folderLabel={tSftp("itemTypeFolder")}
            onClearSelectedFiles={clearSelectedFiles}
            onOpenBlankContextMenu={handleBlankContextMenu}
            onCloseContextMenu={closeContextMenu}
            onCreateFolder={() => startCreateNew("folder")}
            onCreateFile={() => startCreateNew("file")}
            onUpload={() => fileInputRef.current?.click()}
            onRefresh={onRefresh}
            onEditingFileNameChange={setEditingFileName}
            onFinishCreate={finishCreate}
            onCancelCreate={cancelCreate}
            onCreateBlur={handleCreateBlur}
            onFinishRename={finishRename}
            onCancelRename={cancelRename}
            onRenameBlur={handleRenameBlur}
            onFileSelect={handleFileMouseDown}
            onFileDoubleClick={handleFileDoubleClick}
            onOpenFileContextMenu={handleContextMenu}
            onSort={handleSort}
            onAction={handleFileAction}
            onContextAction={handleContextMenuAction}
            onInputChange={handleInputChange}
          />
        </>
      )}
        </div>
      </div>}

      <AlertDialog open={!!pendingLeave} onOpenChange={(open) => { if (!open) void resolveLeave("cancel") }}>
        <AlertDialogContent overlayClassName="z-[10001]" containerClassName="z-[10002]">
          <AlertDialogHeader>
            <AlertDialogTitle>{tSftp("unsavedTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{tSftp("unsavedDescription", { name: editorState.fileName })}</AlertDialogDescription>
          </AlertDialogHeader>
          {leaveError && <p role="alert" className="text-sm text-destructive">{leaveError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSavingEditor}>{tSftp("unsavedCancel")}</AlertDialogCancel>
            <Button variant="outline" disabled={isSavingEditor} onClick={() => void resolveLeave("discard")}>{tSftp("unsavedDiscard")}</Button>
            <Button disabled={isSavingEditor} onClick={() => void resolveLeave("save")}>{tSftp(isSavingEditor ? "editorActionSaveSaving" : "unsavedSave")}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 权限修改对话框 */}
      {shouldRenderBody && (
      <>
      <ChmodDialog
        open={chmodDialog.isOpen}
        onOpenChange={setChmodDialogOpen}
        fileName={chmodDialog.fileName}
        currentPermissions={chmodDialog.permissions}
        onConfirm={handleChmod}
      />

      {/* 删除确认对话框 */}
      <ConfirmDialog
        open={deleteConfirmDialog.isOpen}
        onOpenChange={setDeleteConfirmDialogOpen}
        title={deleteConfirmDialog.fileNames.length > 0
          ? tSftp("deleteConfirmTitleBatch", { count: deleteConfirmDialog.fileNames.length })
          : tSftp("deleteConfirmTitle")}
        description={deleteConfirmDialog.isDirectory
          ? tSftp("deleteConfirmDescriptionDirectory")
          : tSftp("deleteConfirmDescription")}
        confirmText={tSftp("deleteConfirmButton")}
        variant="destructive"
        onConfirm={confirmDelete}
      />


      </>
      )}
      </div>
    </SftpSessionProvider>
    </TooltipProvider>
  )

  // 全屏模式 - 使用 Portal 渲染到 body
  if (isFullscreen) {
    return typeof window !== 'undefined'
      ? createPortal(managerContent, document.body)
      : null
  }

  // 嵌入模式
  return managerContent
}
