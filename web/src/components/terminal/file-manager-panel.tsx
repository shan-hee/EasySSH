
import { useState, useEffect, useRef, useCallback } from "react"
import { X, GripVertical } from "lucide-react"
import { cn } from "@/lib/utils"
import { TerminalSftpPanel } from "@/components/terminal/terminal-sftp-panel"
import { useOptionalSshWorkspace } from "@/components/ssh-workspace/ssh-workspace"
import { useWorkspaceSftpTranslator } from "@/components/ssh-workspace/use-workspace-translator"
import type { SshWorkspacePreferenceAdapter, WorkspaceTransferTask } from "@/lib/session/workspace"
import type { SftpFileItem } from "@/lib/sftp-file-utils"
import type { BatchDeleteResult } from "@/lib/session/sftp-operations"

const DEFAULT_PANEL_WIDTH = 600
const MIN_PANEL_WIDTH = 400
const MAX_PANEL_VIEWPORT_RATIO = 0.7
const FILE_MANAGER_PANEL_WIDTH_PREFERENCE_KEY = "file-manager-panel-width"

function readPanelWidthPreference(
  preferences: SshWorkspacePreferenceAdapter | undefined,
  key: string,
  fallback: number,
) {
  let rawValue: string | null | undefined
  try {
    rawValue = preferences?.getString(key)
  } catch {
    rawValue = null
  }

  const parsedValue = rawValue ? Number.parseInt(rawValue, 10) : Number.NaN

  return Number.isFinite(parsedValue)
    ? Math.max(MIN_PANEL_WIDTH, parsedValue)
    : fallback
}

export interface FileManagerPanelProps {
  isOpen: boolean
  onClose: () => void
  // SFTP Manager props
  serverId: string  // 修改为 string
  serverName: string
  host: string
  username: string
  isConnected: boolean
  currentPath: string
  files: SftpFileItem[]
  sessionId: string
  sessionLabel: string
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
  onInsertTerminalText?: (text: string) => void
  onExecuteTerminalCommand?: (command: string) => void
  // 传输任务管理
  transferTasks?: WorkspaceTransferTask[]
  onClearCompletedTransfers?: () => void
  onCancelTransfer?: (taskId: string) => void
  background: {
    color: string
    image?: string
    imageOpacity: number
  }
  widthPreferenceKey?: string
  defaultWidth?: number
}

export function FileManagerPanel({
  isOpen,
  onClose,
  transferTasks,
  onClearCompletedTransfers,
  onCancelTransfer,
  background,
  onInsertTerminalText,
  onExecuteTerminalCommand,
  widthPreferenceKey = FILE_MANAGER_PANEL_WIDTH_PREFERENCE_KEY,
  defaultWidth = DEFAULT_PANEL_WIDTH,
  ...sftpProps
}: FileManagerPanelProps) {
  const workspace = useOptionalSshWorkspace()
  const tSftp = useWorkspaceSftpTranslator()
  const preferences = workspace?.adapters.preferences
  const [width, setWidth] = useState(() => readPanelWidthPreference(
    preferences,
    widthPreferenceKey,
    defaultWidth,
  ))
  const [isResizing, setIsResizing] = useState(false)
  const resizeStartX = useRef(0)
  const resizeStartWidth = useRef(0)

  // 保存宽度到 Workspace preferences
  useEffect(() => {
    if (isResizing) {
      return
    }

    void preferences?.setString(widthPreferenceKey, width.toString())
  }, [isResizing, preferences, width, widthPreferenceKey])

  // 快捷键支持 (Ctrl/Cmd + E)
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
        e.preventDefault()
        onClose()
      }
      // Esc 关闭
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // 调整大小处理
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    resizeStartX.current = e.clientX
    resizeStartWidth.current = width
  }, [width])

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return

    const deltaX = resizeStartX.current - e.clientX
    const maxWidth = Math.max(MIN_PANEL_WIDTH, Math.floor(window.innerWidth * MAX_PANEL_VIEWPORT_RATIO))
    const newWidth = Math.min(
      Math.max(MIN_PANEL_WIDTH, resizeStartWidth.current + deltaX),
      maxWidth
    )
    setWidth(newWidth)
  }, [isResizing])

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false)
  }, [])

  useEffect(() => {
    if (!isResizing) {
      return
    }

    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    return () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
    }
  }, [isResizing])

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', handleResizeMove)
      window.addEventListener('mouseup', handleResizeEnd)
      return () => {
        window.removeEventListener('mousemove', handleResizeMove)
        window.removeEventListener('mouseup', handleResizeEnd)
      }
    }
  }, [isResizing, handleResizeMove, handleResizeEnd])

  return (
    <aside
      className={cn(
        "terminal-sftp-glass absolute inset-0 z-50 flex h-full min-h-0 w-full shrink-0 overflow-hidden text-foreground",
        "md:relative md:inset-auto md:translate-x-0",
        isResizing ? "transition-none" : "transition-[transform,width,max-width] duration-300 ease-out",
        isOpen
          ? "translate-x-0 md:w-[var(--terminal-sftp-panel-width)] md:max-w-[70vw]"
          : "translate-x-full md:w-0 md:max-w-0",
      )}
      style={{
        pointerEvents: isOpen ? "auto" : "none",
        "--terminal-sftp-panel-width": `${width}px`,
      } as React.CSSProperties}
      aria-hidden={!isOpen}
    >
      <div
        className={cn(
          "group absolute inset-y-0 left-0 z-10 hidden w-3 -translate-x-1 cursor-col-resize bg-transparent transition-colors hover:bg-blue-500/50 md:block",
          isResizing && "bg-blue-500/50",
        )}
        onMouseDown={handleResizeStart}
      >
        <div
          className={cn(
            "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100",
            isResizing && "opacity-100",
          )}
        >
          <GripVertical className="h-4 w-4" />
        </div>
      </div>

      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden text-foreground shadow-2xl md:shadow-none">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 md:hidden"
          style={{ backgroundColor: background.color }}
        />
        {background.image && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-0 bg-cover bg-center bg-no-repeat md:hidden"
            style={{
              backgroundImage: `url(${background.image})`,
              opacity: background.imageOpacity,
            }}
          />
        )}
        <div
          aria-hidden="true"
          className="terminal-sftp-glass-surface pointer-events-none absolute inset-0 z-0"
        />

        <div className="relative z-[1] min-w-0 flex-1 overflow-hidden">
          {sftpProps.isConnected ? (
            <TerminalSftpPanel
              {...sftpProps}
              keyboardShortcutsEnabled={isOpen}
              isFullscreen={false}
              onDisconnect={onClose}
              transferTasks={transferTasks}
              onClearCompletedTransfers={onClearCompletedTransfers}
              onCancelTransfer={onCancelTransfer}
              onInsertTerminalText={onInsertTerminalText}
              onExecuteTerminalCommand={onExecuteTerminalCommand}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <X className="h-8 w-8" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-foreground">
                  {tSftp("disconnectedTitle")}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {tSftp("disconnectedDescription")}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
