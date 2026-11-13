import { useWorkspaceAction } from "@/components/ssh-workspace/use-workspace-action"

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type FocusEvent,
  type RefObject,
  type SetStateAction,
} from "react"
import type { FileAction } from "@/components/sftp/file-action-menu"
import {
  formatSftpDeleteOperationError,
  formatSftpOperationError,
  type BatchDeleteResult,
} from "@/lib/session/sftp-operations"
import type { SshWorkspaceNotifier } from "@/lib/session/workspace"
import { joinSftpRemotePath, resolveSftpNavigationPath, sftpRemoteBaseName, type SftpFileItem } from "@/lib/sftp-file-utils"
import { loadFileEditor } from "@/lib/file-editor-preload"

type SftpTranslator = (key: string, params?: Record<string, string | number>) => string

export type SftpFileActionItem = Pick<SftpFileItem, "name" | "type" | "size" | "modified" | "permissions">
export type SftpCreateEntryType = "file" | "folder"

export interface SftpEditorState {
  isOpen: boolean
  fileName: string
  filePath: string
  content: string
}

export interface SftpChmodDialogState {
  isOpen: boolean
  fileName: string
  filePath: string
  permissions: string
}

export interface SftpDeleteConfirmDialogState {
  isOpen: boolean
  fileName: string | null
  fileNames: string[]
  isDirectory: boolean
}

export interface SftpFileContextMenuState {
  fileName?: string
  fileType?: "file" | "directory"
  isBlank?: boolean
  key?: number
}

export interface UseSftpFileActionControllerOptions {
  keyboardShortcutsEnabled: boolean
  serverId: string
  currentPath: string
  filteredFiles: SftpFileActionItem[]
  selectedFiles: string[]
  setSelectedFiles: Dispatch<SetStateAction<string[]>>
  clearSelectedFiles: () => void
  onSelectAll: () => void
  editInputRef: RefObject<HTMLInputElement | null>
  fileInputRef: RefObject<HTMLInputElement | null>
  excludePatterns: string[]
  tSftp: SftpTranslator
  notifier?: SshWorkspaceNotifier
  chmodFile?: (serverId: string, path: string, mode: string) => Promise<unknown>
  editingSessionLabelRef?: { current: boolean }
  onNavigate: (path: string) => void
  onNavigateBack?: () => void | Promise<void>
  canNavigateBack?: boolean
  onInternalBackHandlerChange?: (
    handler: { handle: () => boolean | Promise<boolean> } | null
  ) => void
  onDownload: (fileName: string) => void
  onDelete: (fileName: string, isDirectory: boolean) => void
  onBatchDelete?: (fileNames: string[], hasDirectory: boolean) => Promise<BatchDeleteResult>
  onBatchDownload?: (fileNames: string[], excludePatterns?: string[]) => Promise<void>
  onCreateFolder: (name: string) => void
  onCreateFile?: (name: string) => void
  onRename: (oldName: string, newName: string) => void
  onRefresh: () => void
  onReadFile?: (fileName: string) => Promise<string>
  onSaveFile?: (fileName: string, content: string) => Promise<void>
  onUploadFiles: (files: FileList) => void | Promise<void>
}

const emptyEditorState: SftpEditorState = {
  isOpen: false,
  fileName: "",
  filePath: "",
  content: "",
}

const emptyChmodDialogState: SftpChmodDialogState = {
  isOpen: false,
  fileName: "",
  filePath: "",
  permissions: "",
}

const emptyDeleteConfirmDialogState: SftpDeleteConfirmDialogState = {
  isOpen: false,
  fileName: null,
  fileNames: [],
  isDirectory: false,
}

const defaultNotifier: SshWorkspaceNotifier = {
  success: () => undefined,
  error: () => undefined,
  promise: <T,>(promise: Promise<T>, messages: {
    loading: string
    success: string | ((data: T) => string)
    error: string | ((error: unknown) => string)
  }) => {
    void messages
    void promise.catch(() => undefined)
    return promise
  },
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.matches("input, textarea, select, [role='textbox']") ||
    target.isContentEditable ||
    target.closest("[contenteditable]:not([contenteditable='false']), [role='textbox'], [role='tree'], [role='dialog'], [role='alertdialog']") !== null
  )
}

export function useSftpFileActionController({
  keyboardShortcutsEnabled,
  serverId,
  currentPath,
  filteredFiles,
  selectedFiles,
  setSelectedFiles,
  clearSelectedFiles,
  onSelectAll,
  editInputRef,
  fileInputRef,
  excludePatterns,
  tSftp,
  notifier = defaultNotifier,
  chmodFile,
  editingSessionLabelRef,
  onNavigate: navigateDirectory,
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
  onUploadFiles,
}: UseSftpFileActionControllerOptions) {
  const can = useWorkspaceAction()
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [contextMenu, setContextMenu] = useState<SftpFileContextMenuState | null>(null)
  const [editingFile, setEditingFile] = useState<string | null>(null)
  const [editingFileName, setEditingFileName] = useState("")
  const [creatingNew, setCreatingNew] = useState<SftpCreateEntryType | null>(null)
  const [pendingFilePath, setPendingFilePath] = useState<string | null>(null)
  const fileRequestVersion = useRef(0)
  const [editorState, setEditorState] = useState<SftpEditorState>(emptyEditorState)
  const [chmodDialog, setChmodDialog] = useState<SftpChmodDialogState>(emptyChmodDialogState)
  const [deleteConfirmDialog, setDeleteConfirmDialog] = useState<SftpDeleteConfirmDialogState>(emptyDeleteConfirmDialogState)

  const draftRef = useRef("")
  const savingRef = useRef(false)
  const [isSavingEditor, setIsSavingEditor] = useState(false)
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null)
  const [leaveError, setLeaveError] = useState<string | null>(null)
  const handleDraftChange = useCallback((content: string) => { draftRef.current = content }, [])
  const requestLeave = useCallback((action: () => void) => {
    if (savingRef.current) return
    if (editorState.isOpen && draftRef.current !== editorState.content) {
      setLeaveError(null)
      setPendingLeave(() => action)
    } else action()
  }, [editorState.isOpen, editorState.content])

  const closeEditor = useCallback(() => {
    fileRequestVersion.current += 1
    setPendingFilePath(null)
    draftRef.current = ""
    setEditorState(emptyEditorState)
  }, [])
  const leaveEditor = useCallback((action: () => void) => requestLeave(() => {
    closeEditor()
    action()
  }), [requestLeave, closeEditor])
  const onNavigate = useCallback((path: string) => leaveEditor(() => navigateDirectory(path)), [leaveEditor, navigateDirectory])

  const openEditor = useCallback(async (fileName: string) => {
    if (!can("files.read")) return
    if (!onReadFile) {
      console.warn("onReadFile 回调未提供")
      return
    }

    const requestVersion = ++fileRequestVersion.current
    const fullPath = resolveSftpNavigationPath(fileName, currentPath)
    setPendingFilePath(fullPath)

    try {
      // 读取文件与加载编辑器并行；路径指示器持续到编辑器挂载完成。
      const [content] = await Promise.all([onReadFile(fullPath), loadFileEditor()])
      if (requestVersion !== fileRequestVersion.current) return
      draftRef.current = content
      setEditorState({
        isOpen: true,
        fileName: sftpRemoteBaseName(fullPath, fileName),
        filePath: fullPath,
        content,
      })
    } catch (error) {
      if (requestVersion === fileRequestVersion.current) setPendingFilePath(null)
      console.error("读取文件失败:", error)
    }
  }, [can, currentPath, onReadFile])

  const handleOpenEditor = useCallback((path: string) => {
    if (editorState.isOpen && resolveSftpNavigationPath(path, currentPath) === editorState.filePath) return
    requestLeave(() => { void openEditor(path) })
  }, [requestLeave, openEditor, currentPath, editorState.isOpen, editorState.filePath])

  useLayoutEffect(() => {
    setPendingFilePath(null)
    return () => { fileRequestVersion.current += 1 }
  }, [currentPath, serverId])

  useLayoutEffect(() => {
    closeEditor()
    setPendingLeave(null)
    setLeaveError(null)
  }, [serverId, closeEditor])

  const handleEditorReady = useCallback((filePath: string) => {
    setPendingFilePath((pending) => pending === filePath ? null : pending)
  }, [])

  const handleCloseEditor = useCallback(() => requestLeave(closeEditor), [requestLeave, closeEditor])

  const handleSaveFile = useCallback(async (content: string) => {
    if (!can("files.write")) throw new Error(tSftp("operationNotAllowed"))
    if (!onSaveFile) throw new Error(tSftp("toastServiceUnavailable"))
    if (savingRef.current) throw new Error(tSftp("editorActionSaveSaving"))
    const path = editorState.filePath
    savingRef.current = true
    setIsSavingEditor(true)
    try {
      await onSaveFile(path, content)
      setEditorState((previous) => previous.filePath === path ? { ...previous, content } : previous)
    } finally {
      savingRef.current = false
      setIsSavingEditor(false)
    }
  }, [can, editorState.filePath, onSaveFile, tSftp])

  const resolveLeave = useCallback(async (choice: "save" | "discard" | "cancel") => {
    if (savingRef.current) return
    if (choice === "cancel") { setPendingLeave(null); setLeaveError(null); return }
    try {
      if (choice === "save") await handleSaveFile(draftRef.current)
      setPendingLeave(null)
      setLeaveError(null)
      pendingLeave?.()
    } catch (error) {
      setLeaveError(formatSftpOperationError(error, tSftp, "toastSaveFileFailed", "toastSaveFileFailedWithMessage"))
    }
  }, [handleSaveFile, pendingLeave, tSftp])

  const handleFileDoubleClick = useCallback((fileName: string, fileType: "file" | "directory") => {
    if (fileType === "directory") {
      fileRequestVersion.current += 1
      setPendingFilePath(null)
      const next = joinSftpRemotePath(currentPath, fileName)
      onNavigate(next)
      return
    }

    void handleOpenEditor(fileName)
  }, [currentPath, handleOpenEditor, onNavigate])

  const openFileContextMenu = useCallback((fileName: string, fileType: "file" | "directory") => {
    setContextMenu({
      fileName,
      fileType,
      isBlank: false,
      key: Date.now(),
    })

    if (!selectedFiles.includes(fileName)) {
      setSelectedFiles([fileName])
    }
  }, [selectedFiles, setSelectedFiles])

  const openBlankContextMenu = useCallback(() => {
    setContextMenu({
      isBlank: true,
      key: Date.now(),
    })
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  const handleInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const inputFiles = event.target.files
    if (inputFiles) {
      void onUploadFiles(inputFiles)
    }
    event.target.value = ""
  }, [onUploadFiles])

  const startRename = useCallback((fileName: string) => {
    if (!can("files.write")) return
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current)
      blurTimeoutRef.current = null
    }

    setEditingFile(fileName)
    setEditingFileName(fileName)
  }, [can])

  const finishRename = useCallback(() => {
    if (editingFile && editingFileName.trim() && editingFileName !== editingFile) {
      onRename(editingFile, editingFileName.trim())
    }
    setEditingFile(null)
    setEditingFileName("")
  }, [editingFile, editingFileName, onRename])

  const cancelRename = useCallback(() => {
    setEditingFile(null)
    setEditingFileName("")
  }, [])

  const handleRenameBlur = useCallback((event: FocusEvent) => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current)
    }

    const relatedTarget = event.relatedTarget as HTMLElement | null
    if (relatedTarget && (
      relatedTarget.tagName === "BUTTON" ||
      relatedTarget.closest('[role="menuitem"]') ||
      relatedTarget.closest('[role="menu"]')
    )) {
      blurTimeoutRef.current = setTimeout(() => {
        if (editInputRef.current && !editInputRef.current.contains(document.activeElement)) {
          finishRename()
        }
      }, 150)
    } else {
      blurTimeoutRef.current = setTimeout(() => finishRename(), 50)
    }
  }, [editInputRef, finishRename])

  const finishCreate = useCallback(async () => {
    const nextName = editingFileName.trim()
    if (nextName) {
      if (creatingNew === "folder") {
        onCreateFolder(nextName)
      } else if (creatingNew === "file") {
        if (onCreateFile) {
          onCreateFile(nextName)
        } else if (onSaveFile) {
          try {
            await onSaveFile(nextName, "")
          } catch (error) {
            console.error("创建文件失败:", error)
          }
        }
      }
    }

    setCreatingNew(null)
    setEditingFileName("")
  }, [creatingNew, editingFileName, onCreateFile, onCreateFolder, onSaveFile])

  const handleCreateBlur = useCallback((event: FocusEvent) => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current)
    }

    const relatedTarget = event.relatedTarget as HTMLElement | null
    if (relatedTarget && (
      relatedTarget.tagName === "BUTTON" ||
      relatedTarget.closest('[role="menuitem"]') ||
      relatedTarget.closest('[role="menu"]')
    )) {
      blurTimeoutRef.current = setTimeout(() => {
        if (editInputRef.current && !editInputRef.current.contains(document.activeElement)) {
          void finishCreate()
        }
      }, 150)
    } else {
      blurTimeoutRef.current = setTimeout(() => {
        void finishCreate()
      }, 50)
    }
  }, [editInputRef, finishCreate])

  const startCreateNew = useCallback((type: SftpCreateEntryType) => {
    if (!can("files.write")) return
    setCreatingNew(type)
    setEditingFileName(type === "folder" ? tSftp("defaultNewFolderName") : tSftp("defaultNewFileName"))
  }, [can, tSftp])

  const cancelCreate = useCallback(() => {
    setCreatingNew(null)
    setEditingFileName("")
  }, [])

  const handleBatchDownload = useCallback(async (fileNames?: string[]) => {
    if (!can("files.download")) return
    const paths = fileNames && fileNames.length > 0
      ? fileNames
      : selectedFiles.length > 0
        ? selectedFiles
        : contextMenu?.fileName
          ? [contextMenu.fileName]
          : []

    if (paths.length === 0) return

    if (onBatchDownload) {
      try {
        await onBatchDownload(paths, excludePatterns)
        setSelectedFiles([])
      } catch (error: unknown) {
        console.error("[SftpManager] 批量下载失败:", error)
        notifier.error(formatSftpOperationError(
          error,
          tSftp,
          "toastBatchDownloadFailed",
          "toastBatchDownloadFailedWithMessage",
        ))
      }
    } else {
      paths.forEach((path) => onDownload(path))
      setSelectedFiles([])
    }
  }, [can, contextMenu, excludePatterns, notifier, onBatchDownload, onDownload, selectedFiles, setSelectedFiles, tSftp])

  const handleBatchDelete = useCallback(async () => {
    if (selectedFiles.length === 0) return

    if (onBatchDelete) {
      try {
        const hasDirectory = selectedFiles.some((name) => filteredFiles.find((item) => item.name === name)?.type === "directory")
        const result = await onBatchDelete(selectedFiles, hasDirectory)

        if (result.failed.length > 0) {
          const failedNames = result.failed
            .map((item) => sftpRemoteBaseName(item.path, item.path))
            .filter(Boolean)
            .join(", ")

          notifier.error(
            tSftp("toastBatchDeletePartialFailed", {
              count: result.failed.length,
              names: failedNames || "-",
            })
          )
        }

        setSelectedFiles([])
      } catch (error: unknown) {
        console.error("[SftpManager] 批量删除失败:", error)
        notifier.error(formatSftpDeleteOperationError(error, tSftp, true))
      }
    } else {
      selectedFiles.forEach((fileName) => onDelete(fileName, filteredFiles.find((item) => item.name === fileName)?.type === "directory"))
      setSelectedFiles([])
    }
  }, [filteredFiles, notifier, onBatchDelete, onDelete, selectedFiles, setSelectedFiles, tSftp])

  const requestDelete = useCallback((fileName: string) => {
    if (!can("files.delete")) return
    const file = filteredFiles.find((item) => item.name === fileName)
    setDeleteConfirmDialog({
      isOpen: true,
      fileName,
      fileNames: [],
      isDirectory: file?.type === "directory",
    })
  }, [can, filteredFiles])

  const requestBatchDelete = useCallback(() => {
    if (!can("files.delete")) return
    if (selectedFiles.length === 0) return

    const hasDirectory = selectedFiles.some((name) => (
      filteredFiles.find((item) => item.name === name)?.type === "directory"
    ))
    setDeleteConfirmDialog({
      isOpen: true,
      fileName: null,
      fileNames: [...selectedFiles],
      isDirectory: hasDirectory,
    })
  }, [can, filteredFiles, selectedFiles])

  const confirmDelete = useCallback(async () => {
    if (!can("files.delete")) return
    if (deleteConfirmDialog.fileNames.length > 0) {
      await handleBatchDelete()
    } else if (deleteConfirmDialog.fileName) {
      onDelete(deleteConfirmDialog.fileName, deleteConfirmDialog.isDirectory)
    }

    setDeleteConfirmDialog(emptyDeleteConfirmDialogState)
  }, [can, deleteConfirmDialog, handleBatchDelete, onDelete])

  const handleFileAction = useCallback((file: SftpFileActionItem, action: FileAction) => {
    switch (action) {
      case "open":
        if (file.type === "directory") {
          onNavigate(joinSftpRemotePath(currentPath, file.name))
        } else {
          void handleOpenEditor(file.name)
        }
        break
      case "download":
        if (!can("files.download")) return
        setSelectedFiles([file.name])
        if (file.type === "directory") {
          void handleBatchDownload([file.name])
        } else {
          onDownload(file.name)
        }
        break
      case "rename":
        setTimeout(() => startRename(file.name), 50)
        break
      case "chmod":
        if (!can("files.write")) return
        setChmodDialog({
          isOpen: true,
          fileName: file.name,
          filePath: joinSftpRemotePath(currentPath, file.name),
          permissions: file.permissions,
        })
        break
      case "delete":
        requestDelete(file.name)
        break
    }
  }, [can, currentPath, handleBatchDownload, handleOpenEditor, onDownload, onNavigate, requestDelete, setSelectedFiles, startRename])

  const contextMenuFile = useMemo<SftpFileActionItem | null>(() => {
    if (!contextMenu?.fileName || !contextMenu.fileType) {
      return null
    }

    const file = filteredFiles.find((item) => item.name === contextMenu.fileName)
    return {
      name: contextMenu.fileName,
      type: contextMenu.fileType,
      size: file?.size ?? "",
      modified: file?.modified ?? "",
      permissions: file?.permissions ?? "",
    }
  }, [contextMenu, filteredFiles])

  const handleContextMenuAction = useCallback((action: FileAction) => {
    if (!contextMenuFile) {
      return
    }

    if (action === "delete" && selectedFiles.length > 1) {
      requestBatchDelete()
      return
    }

    handleFileAction(contextMenuFile, action)
  }, [contextMenuFile, handleFileAction, requestBatchDelete, selectedFiles.length])

  const setChmodDialogOpen = useCallback((open: boolean) => {
    setChmodDialog((prev) => ({ ...prev, isOpen: open }))
  }, [])

  const setDeleteConfirmDialogOpen = useCallback((open: boolean) => {
    setDeleteConfirmDialog((prev) => ({ ...prev, isOpen: open }))
  }, [])

  const handleChmod = useCallback(async (mode: string) => {
    if (!can("files.write")) throw new Error(tSftp("operationNotAllowed"))
    const fileName = chmodDialog.fileName
    const filePath = chmodDialog.filePath
    const chmodPromise = (chmodFile
      ? chmodFile(serverId, filePath, mode)
      : Promise.reject(new Error("SFTP chmod adapter is not configured")))
      .then(() => {
        onRefresh()
      })

    notifier.promise(chmodPromise, {
      loading: tSftp("toastChmodLoading", { file: fileName }),
      success: tSftp("toastChmodSuccess", { file: fileName }),
      error: (error) => formatSftpOperationError(
        error,
        tSftp,
        "toastChmodFailedGeneric",
        "toastChmodFailed",
      ),
    })

    return chmodPromise
  }, [can, chmodDialog.fileName, chmodDialog.filePath, chmodFile, notifier, onRefresh, serverId, tSftp])

  const handleInternalBack = useCallback(async () => {
    if (editorState.isOpen) {
      handleCloseEditor()
      return true
    }

    if (canNavigateBack && onNavigateBack) {
      await onNavigateBack()
      return true
    }

    return false
  }, [canNavigateBack, editorState.isOpen, handleCloseEditor, onNavigateBack])

  useEffect(() => {
    const hasInternalBack = editorState.isOpen || !!canNavigateBack
    onInternalBackHandlerChange?.(hasInternalBack ? { handle: handleInternalBack } : null)

    return () => {
      onInternalBackHandlerChange?.(null)
    }
  }, [canNavigateBack, editorState.isOpen, handleInternalBack, onInternalBackHandlerChange])

  useEffect(() => {
    if (!keyboardShortcutsEnabled) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableKeyboardTarget(event.target)) {
        return
      }

      if (editorState.isOpen) {
        if (event.key === "Escape") {
          event.preventDefault()
          handleCloseEditor()
        }
        return
      }

      if (editingFile || creatingNew || editingSessionLabelRef?.current) return

      const isMac = navigator.platform.toUpperCase().includes("MAC")
      const cmdOrCtrl = isMac ? event.metaKey : event.ctrlKey

      if (cmdOrCtrl && event.key === "a") {
        event.preventDefault()
        onSelectAll()
      }

      if ((event.key === "Delete" || event.key === "Backspace") && selectedFiles.length > 0) {
        event.preventDefault()
        requestBatchDelete()
      }

      if (event.key === "F2" && selectedFiles.length === 1) {
        event.preventDefault()
        startRename(selectedFiles[0])
      }

      if (cmdOrCtrl && event.key === "d" && selectedFiles.length > 0) {
        event.preventDefault()
        void handleBatchDownload()
      }

      if (cmdOrCtrl && event.key === "r") {
        event.preventDefault()
        onRefresh()
      }

      if (cmdOrCtrl && event.shiftKey && event.key === "N") {
        event.preventDefault()
        startCreateNew("folder")
      }

      if (cmdOrCtrl && !event.shiftKey && event.key === "n") {
        event.preventDefault()
        startCreateNew("file")
      }

      if (can("files.upload") && cmdOrCtrl && event.key === "u") {
        event.preventDefault()
        fileInputRef.current?.click()
      }

      if (event.key === "Escape" && selectedFiles.length > 0) {
        clearSelectedFiles()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [
    can,
    clearSelectedFiles,
    creatingNew,
    editingSessionLabelRef,
    editingFile,
    editorState.isOpen,
    fileInputRef,
    handleBatchDownload,
    handleCloseEditor,
    keyboardShortcutsEnabled,
    onSelectAll,
    onRefresh,
    requestBatchDelete,
    selectedFiles,
    setSelectedFiles,
    startCreateNew,
    startRename,
  ])

  useLayoutEffect(() => {
    if (!editingFile && !creatingNew) {
      return
    }

    let focusTimeout: ReturnType<typeof setTimeout> | null = null
    const frame = requestAnimationFrame(() => {
      focusTimeout = setTimeout(() => {
        editInputRef.current?.focus()
        editInputRef.current?.select()
      }, 100)
    })

    return () => {
      cancelAnimationFrame(frame)
      if (focusTimeout) {
        clearTimeout(focusTimeout)
      }
    }
  }, [creatingNew, editInputRef, editingFile])

  useEffect(() => () => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current)
    }
  }, [])

  return {
    contextMenu,
    contextMenuFile,
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
    navigateWithGuard: onNavigate,
    chmodDialog,
    deleteConfirmDialog,
    setEditingFileName,
    setChmodDialogOpen,
    setDeleteConfirmDialogOpen,
    closeContextMenu,
    handleInputChange,
    handleFileDoubleClick,
    handleContextMenu: openFileContextMenu,
    handleBlankContextMenu: openBlankContextMenu,
    finishRename,
    cancelRename,
    handleRenameBlur,
    finishCreate,
    cancelCreate,
    handleCreateBlur,
    startCreateNew,
    handleCloseEditor,
    handleSaveFile,
    handleBatchDownload,
    requestBatchDelete,
    confirmDelete,
    handleFileAction,
    handleContextMenuAction,
    handleChmod,
  }
}
