
import { useEffect } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { TerminalSftpPanel } from "@/components/terminal/terminal-sftp-panel"
import { PanelPositionControl } from "./panel-position-control"
import type { TerminalPanelPosition } from "@/stores/tab-ui-store"
import { useWorkspaceSftpTranslator } from "@/components/ssh-workspace/use-workspace-translator"
import type { WorkspaceTransferTask } from "@/lib/session/workspace"
import type { SftpFileItem } from "@/lib/sftp-file-utils"
import type { BatchDeleteResult } from "@/lib/session/sftp-operations"

export interface FileManagerPanelProps {
  position: TerminalPanelPosition
  onPositionChange: (position: TerminalPanelPosition) => void
  layoutStyle?: React.CSSProperties
  keyboardActive?: boolean
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
  backgroundColor?: string
}

export function FileManagerPanel({
  position,
  onPositionChange,
  layoutStyle,
  keyboardActive = true,
  isOpen,
  onClose,
  transferTasks,
  onClearCompletedTransfers,
  onCancelTransfer,
  backgroundColor,
  onInsertTerminalText,
  onExecuteTerminalCommand,
  ...sftpProps
}: FileManagerPanelProps) {
  const tSftp = useWorkspaceSftpTranslator()

  // 快捷键支持 (Ctrl/Cmd + E)
  useEffect(() => {
    if (!isOpen || !keyboardActive) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (e.target instanceof Element && e.target.closest('[role="dialog"], [role="alertdialog"], .monaco-editor')) return
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
  }, [isOpen, keyboardActive, onClose])

  return (
    <aside
      className={cn(
        "terminal-sftp-glass absolute inset-0 z-50 flex h-full min-h-0 min-w-0 w-full shrink-0 overflow-hidden text-foreground",
        "md:relative md:inset-auto md:translate-x-0",
        "transition-transform duration-180 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        isOpen ? "translate-x-0" : "translate-x-full",
      )}
      style={{
        pointerEvents: isOpen ? "auto" : "none",
        ...layoutStyle,
      } as React.CSSProperties}
      data-terminal-panel
      aria-hidden={!isOpen}
      inert={!isOpen}
    >
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-foreground shadow-2xl md:shadow-none">
        {backgroundColor && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-0 md:hidden"
            style={{ backgroundColor }}
          />
        )}
        <div
          aria-hidden="true"
          className="terminal-sftp-glass-surface pointer-events-none absolute inset-0 z-0"
        />

        <div className="relative z-[1] min-h-0 min-w-0 flex-1 overflow-hidden">
          {sftpProps.isConnected ? (
            <TerminalSftpPanel
              {...sftpProps}
              toolbarActions={<div className="hidden md:block"><PanelPositionControl position={position} onChange={onPositionChange} /></div>}
              keyboardShortcutsEnabled={isOpen && keyboardActive}
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
