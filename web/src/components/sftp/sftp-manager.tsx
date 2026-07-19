
import { useRef, useMemo, useCallback, useEffect, type ChangeEvent } from "react"
import { createPortal } from "react-dom"
import { SftpSessionProvider } from "@/contexts/sftp-session-context"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { ChmodDialog } from "@/components/sftp/chmod-dialog"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import type { BatchDeleteResult } from "@/lib/session/sftp-operations"
import { DEFAULT_SFTP_DOWNLOAD_EXCLUDE_PATTERNS } from "@/lib/session/workspace-settings"
import type { SshWorkspacePreferenceAdapter, WorkspaceTransferTask } from "@/lib/session/workspace"
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
import type { TransferJob } from "@/lib/api/transfer-jobs"

export type SftpManagerFileItem = SftpFileBrowserItem

export interface SftpTerminalPathActions {
  onCopy: () => void | Promise<void>
  onInsert: () => void
  onEnter: () => void
}

export interface SftpManagerProps {
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
  // 传输任务管理(从外部传入)
  transferTasks?: WorkspaceTransferTask[]
  backgroundTransferJobs?: TransferJob[]
  onClearCompletedTransfers?: () => void
  onCancelTransfer?: (taskId: string) => void
  onCreateBackgroundUpload?: (files: FileList) => void | Promise<void>
  onCreateBackgroundDownload?: (fileName: string) => void | Promise<void>
  onCancelBackgroundTransfer?: (jobId: string) => void
  onDeleteBackgroundTransfer?: (jobId: string) => void
  onDownloadBackgroundArtifact?: (jobId: string) => void
  preferences?: SshWorkspacePreferenceAdapter
}

export function SftpManager(props: SftpManagerProps) {
  const tSftp = useWorkspaceSftpTranslator()
  const workspace = useOptionalSshWorkspace()

  const {
    keyboardShortcutsEnabled,
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
    transferTasks,
    backgroundTransferJobs,
    onClearCompletedTransfers,
    onCancelTransfer,
    onCreateBackgroundUpload,
    onCreateBackgroundDownload,
    onCancelBackgroundTransfer,
    onDeleteBackgroundTransfer,
    onDownloadBackgroundArtifact,
    preferences,
  } = props
  const workspaceTransferManager = workspace?.adapters.transferManager
  const shouldRenderWorkspaceToolbar = chrome !== "content"
  const shouldRenderBody = chrome !== "toolbar"
  const shouldRenderFileToolbar = chrome !== "toolbar"
  const effectiveTransferTasks = transferTasks ?? workspaceTransferManager?.tasks ?? []
  const effectiveClearCompletedTransfers = onClearCompletedTransfers ?? workspaceTransferManager?.clearCompleted
  const effectiveCancelTransfer = onCancelTransfer ?? workspaceTransferManager?.cancelTask
  const hasWorkspaceTransferTaskSurface = !!workspaceTransferManager && (
    workspaceTransferManager.tasks.length > 0 ||
    !!workspaceTransferManager.downloadFile ||
    !!workspaceTransferManager.batchDownload ||
    !!workspaceTransferManager.uploadFile ||
    !!workspaceTransferManager.directTransfer ||
    !!workspaceTransferManager.createTransferTask ||
    !!workspaceTransferManager.addTask ||
    !!workspaceTransferManager.updateTask ||
    !!workspaceTransferManager.removeTask ||
    !!workspaceTransferManager.clearAll ||
    !!workspaceTransferManager.clearCompleted ||
    !!workspaceTransferManager.cancelTask ||
    !!workspaceTransferManager.cancelDirectTransfer
  )
  const showTransferTasks = (
    transferTasks !== undefined ||
    hasWorkspaceTransferTaskSurface ||
    !!backgroundTransferJobs?.length ||
    !!onCreateBackgroundUpload ||
    !!onCreateBackgroundDownload
  )
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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const backgroundFileInputRef = useRef<HTMLInputElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)
  const editingSessionLabelRef = useRef(false)

  const {
    isDragging,
    draggedFileName,
    dragOverFolder,
    clearDragOverFolder,
    handleFileUpload,
    handleNativeDragStart,
    handleNativeDragEnd,
    handleNativeDragOver,
    handleNativeDrop,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
  } = useSftpDragDropController({
    sessionId,
    currentPath,
    files,
    dropZoneRef,
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
    onBackgroundDownload: onCreateBackgroundDownload,
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

  // 清除已完成任务 - 使用外部传入的处理函数
  const handleClearCompleted = useCallback(() => {
    effectiveClearCompletedTransfers?.()
  }, [effectiveClearCompletedTransfers])

  const handleBackgroundUploadInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const inputFiles = event.target.files
    if (inputFiles && inputFiles.length > 0) {
      void onCreateBackgroundUpload?.(inputFiles)
    }
    event.target.value = ""
  }, [onCreateBackgroundUpload])

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
          className={cn(
            "flex min-w-0 w-full flex-col overflow-hidden rounded-none border-0 transition-colors",
            (surface !== "transparent" || isFullscreen) && "bg-background",
            shouldRenderBody ? "h-full" : "shrink-0",
            isFullscreen && "fixed inset-0 z-[9999]"
          )}
        >
      {shouldRenderWorkspaceToolbar && (
      <SftpWorkspaceToolbar
        displayPath={displayPath}
        pathInputValue={pathInputValue}
        pathSegments={pathSegments}
        isEditingPath={isEditingPath}
        isEditorOpen={editorState.isOpen}
        onPathInputValueChange={setPathInputValue}
        onEditingPathChange={setIsEditingPath}
        onNavigate={onNavigate}
        onNavigateBack={onNavigateBack}
        canNavigateBack={canNavigateBack}
        onNavigateForward={onNavigateForward}
        canNavigateForward={canNavigateForward}
        terminalPathActions={editorState.isOpen ? undefined : terminalPathActions}
        showTransferTasks={showTransferTasks}
        transferTasks={effectiveTransferTasks}
        backgroundTransferJobs={backgroundTransferJobs}
        onClearCompletedTransfers={handleClearCompleted}
        onCancelTransfer={effectiveCancelTransfer}
        onCreateBackgroundUpload={onCreateBackgroundUpload ? () => backgroundFileInputRef.current?.click() : undefined}
        onCancelBackgroundTransfer={onCancelBackgroundTransfer}
        onDeleteBackgroundTransfer={onDeleteBackgroundTransfer}
        onDownloadBackgroundArtifact={onDownloadBackgroundArtifact}
        isFullscreen={isFullscreen}
        onToggleFullscreen={onToggleFullscreen}
        onDisconnect={onDisconnect}
      />
      )}

      {/* 如果编辑器打开，只显示编辑器；否则显示搜索栏+文件列表 */}
      {shouldRenderBody && (editorState.isOpen ? (
        <SftpFileEditorPane
          fileName={editorState.fileName}
          filePath={editorState.filePath}
          fileContent={editorState.content}
          isOpen={editorState.isOpen}
          onClose={handleCloseEditor}
          onSave={handleSaveFile}
          onDownload={() => onDownload(editorState.fileName)}
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
            onRefresh={onRefresh}
          />
          )}

          <SftpFileBrowserPane
            viewMode={viewMode}
            filteredFiles={filteredFiles}
            selectedFiles={selectedFiles}
            sortBy={sortBy}
            sortOrder={sortOrder}
            isDragging={isDragging}
            isLoading={isLoading}
            searchTerm={searchTerm}
            creatingNew={creatingNew}
            editingFile={editingFile}
            editingFileName={editingFileName}
            draggedFileName={draggedFileName}
            dragOverFolder={dragOverFolder}
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
            onBackgroundUpload={onCreateBackgroundUpload ? () => backgroundFileInputRef.current?.click() : undefined}
            onRefresh={onRefresh}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onEditingFileNameChange={setEditingFileName}
            onFinishCreate={finishCreate}
            onCancelCreate={cancelCreate}
            onCreateBlur={handleCreateBlur}
            onFinishRename={finishRename}
            onCancelRename={cancelRename}
            onRenameBlur={handleRenameBlur}
            onNativeDragStart={handleNativeDragStart}
            onNativeDragEnd={handleNativeDragEnd}
            onNativeDragOver={handleNativeDragOver}
            onNativeDragLeave={clearDragOverFolder}
            onNativeDrop={handleNativeDrop}
            onFileSelect={handleFileMouseDown}
            onFileDoubleClick={handleFileDoubleClick}
            onOpenFileContextMenu={handleContextMenu}
            onSort={handleSort}
            enableBackgroundDownload={!!onCreateBackgroundDownload}
            onAction={handleFileAction}
            onContextAction={handleContextMenuAction}
            onInputChange={handleInputChange}
          />
        </>
      ))}

      {onCreateBackgroundUpload && (
      <input
        ref={backgroundFileInputRef}
        type="file"
        multiple
        className="hidden"
        tabIndex={-1}
        onChange={handleBackgroundUploadInputChange}
      />
      )}

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
