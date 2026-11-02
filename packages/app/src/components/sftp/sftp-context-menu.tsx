import { useWorkspaceAction } from "@/components/ssh-workspace/use-workspace-action"
import { useRef, type ReactNode } from "react"
import { FileText, FolderPlus, RefreshCw, Upload } from "lucide-react"

import { FileActionMenu, type FileAction } from "@/components/sftp/file-action-menu"
import { useWorkspaceSftpTranslator } from "@/components/ssh-workspace/use-workspace-translator"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { cn } from "@/lib/utils"
import type { SftpFileItem } from "@/lib/sftp-file-utils"

export interface SftpContextMenuState {
  fileName?: string
  fileType?: "file" | "directory"
  isBlank?: boolean
  key?: number
}

export type SftpContextMenuFile = Pick<SftpFileItem, "name" | "type" | "size" | "modified" | "permissions">

export interface SftpFileContextMenuProps {
  file: SftpContextMenuFile
  selectedFilesCount: number
  disabled?: boolean
  onOpen?: () => void
  onOpenChange?: (open: boolean) => void
  onAction: (action: FileAction) => void
  children: ReactNode
}

export interface SftpBlankContextMenuProps {
  selectedFilesCount: number
  disabled?: boolean
  onOpenChange?: (open: boolean) => void
  onCreateFolder: () => void
  onCreateFile: () => void
  onUpload: () => void
  onRefresh: () => void
  children: ReactNode
}

function SftpContextMenuSelectedLabel({ count }: { count: number }) {
  const tSftp = useWorkspaceSftpTranslator()

  if (count <= 1) {
    return null
  }

  return (
    <>
      <ContextMenuLabel className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
        {tSftp("contextSelectedTitle", { count })}
      </ContextMenuLabel>
      <ContextMenuSeparator />
    </>
  )
}

export function SftpBlankContextMenuContent({
  selectedFilesCount,
  onCreateFolder,
  onCreateFile,
  onUpload,
  onRefresh,
}: Omit<SftpBlankContextMenuProps, "children" | "disabled" | "onOpenChange">) {
  const tSftp = useWorkspaceSftpTranslator()
  const can = useWorkspaceAction()
  const pendingCreateActionRef = useRef<(() => void) | null>(null)

  const handleCreateAction = (action: () => void) => {
    pendingCreateActionRef.current = action
  }

  return (
    <ContextMenuContent
      onCloseAutoFocus={(event) => {
        const pendingCreateAction = pendingCreateActionRef.current
        if (!pendingCreateAction) {
          return
        }

        event.preventDefault()
        pendingCreateActionRef.current = null
        pendingCreateAction()
      }}
      className={cn(
        "min-w-[200px] rounded-lg border-border/60 bg-popover/95 text-popover-foreground backdrop-blur-xl"
      )}
    >
      <SftpContextMenuSelectedLabel count={selectedFilesCount} />

      <ContextMenuItem disabled={!can("files.write")} onSelect={() => handleCreateAction(onCreateFolder)}>
        <FolderPlus className="h-4 w-4" />
        <span>{tSftp("contextNewFolder")}</span>
        <ContextMenuShortcut>⌘⇧N</ContextMenuShortcut>
      </ContextMenuItem>

      <ContextMenuItem disabled={!can("files.write")} onSelect={() => handleCreateAction(onCreateFile)}>
        <FileText className="h-4 w-4" />
        <span>{tSftp("contextNewFile")}</span>
        <ContextMenuShortcut>⌘N</ContextMenuShortcut>
      </ContextMenuItem>

      <ContextMenuItem disabled={!can("files.upload")} onSelect={onUpload}>
        <Upload className="h-4 w-4" />
        <span>{tSftp("contextUploadFile")}</span>
        <ContextMenuShortcut>⌘U</ContextMenuShortcut>
      </ContextMenuItem>

      <ContextMenuItem onSelect={onRefresh}>
        <RefreshCw className="h-4 w-4" />
        <span>{tSftp("contextRefresh")}</span>
        <ContextMenuShortcut>⌘R</ContextMenuShortcut>
      </ContextMenuItem>
    </ContextMenuContent>
  )
}

export function SftpFileContextMenuContent({
  file,
  selectedFilesCount,
  onAction,
}: Pick<SftpFileContextMenuProps, "file" | "selectedFilesCount" | "onAction">) {
  return (
    <ContextMenuContent
      className={cn(
        "min-w-[200px] rounded-lg border-border/60 bg-popover/95 text-popover-foreground backdrop-blur-xl"
      )}
    >
      <SftpContextMenuSelectedLabel count={selectedFilesCount} />
      <FileActionMenu
        file={file}
        mode="context"
        selectedFilesCount={selectedFilesCount}
        onAction={onAction}
      />
    </ContextMenuContent>
  )
}

export function SftpBlankContextMenu({
  selectedFilesCount,
  disabled = false,
  onOpenChange,
  onCreateFolder,
  onCreateFile,
  onUpload,
  onRefresh,
  children,
}: SftpBlankContextMenuProps) {
  return (
    <ContextMenu modal={false} onOpenChange={onOpenChange}>
      <ContextMenuTrigger asChild disabled={disabled}>
        {children}
      </ContextMenuTrigger>
      <SftpBlankContextMenuContent
        selectedFilesCount={selectedFilesCount}
        onCreateFolder={onCreateFolder}
        onCreateFile={onCreateFile}
        onUpload={onUpload}
        onRefresh={onRefresh}
      />
    </ContextMenu>
  )
}

export function SftpFileContextMenu({
  file,
  selectedFilesCount,
  disabled = false,
  onOpen,
  onOpenChange,
  onAction,
  children,
}: SftpFileContextMenuProps) {
  return (
    <ContextMenu
      modal={false}
      onOpenChange={(open) => {
        if (open) {
          onOpen?.()
        }
        onOpenChange?.(open)
      }}
    >
      <ContextMenuTrigger
        asChild
        disabled={disabled}
        onContextMenu={(event) => {
          event.stopPropagation()
        }}
      >
        {children}
      </ContextMenuTrigger>
      <SftpFileContextMenuContent
        file={file}
        selectedFilesCount={selectedFilesCount}
        onAction={onAction}
      />
    </ContextMenu>
  )
}
