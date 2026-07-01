import type { ReactNode } from "react"
import { CloudUpload, FileText, FolderPlus, RefreshCw, Upload } from "lucide-react"

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
  enableBackgroundDownload?: boolean
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
  onBackgroundUpload?: () => void
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
  onBackgroundUpload,
  onRefresh,
}: Omit<SftpBlankContextMenuProps, "children" | "disabled" | "onOpenChange">) {
  const tSftp = useWorkspaceSftpTranslator()

  return (
    <ContextMenuContent
      className={cn(
        "min-w-[200px] rounded-lg border-border/60 bg-popover/95 text-popover-foreground backdrop-blur-xl"
      )}
    >
      <SftpContextMenuSelectedLabel count={selectedFilesCount} />

      <ContextMenuItem onSelect={onCreateFolder}>
        <FolderPlus className="h-4 w-4" />
        <span>{tSftp("contextNewFolder")}</span>
        <ContextMenuShortcut>⌘⇧N</ContextMenuShortcut>
      </ContextMenuItem>

      {onBackgroundUpload && (
        <ContextMenuItem onSelect={onBackgroundUpload}>
          <CloudUpload className="h-4 w-4" />
          <span>{tSftp("contextBackgroundUploadFile")}</span>
        </ContextMenuItem>
      )}

      <ContextMenuItem onSelect={onCreateFile}>
        <FileText className="h-4 w-4" />
        <span>{tSftp("contextNewFile")}</span>
        <ContextMenuShortcut>⌘N</ContextMenuShortcut>
      </ContextMenuItem>

      <ContextMenuItem onSelect={onUpload}>
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
  enableBackgroundDownload = false,
  onAction,
}: Pick<SftpFileContextMenuProps, "file" | "selectedFilesCount" | "enableBackgroundDownload" | "onAction">) {
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
        enableBackgroundDownload={enableBackgroundDownload}
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
  onBackgroundUpload,
  onRefresh,
  children,
}: SftpBlankContextMenuProps) {
  return (
    <ContextMenu onOpenChange={onOpenChange}>
      <ContextMenuTrigger asChild disabled={disabled}>
        {children}
      </ContextMenuTrigger>
      <SftpBlankContextMenuContent
        selectedFilesCount={selectedFilesCount}
        onCreateFolder={onCreateFolder}
        onCreateFile={onCreateFile}
        onUpload={onUpload}
        onBackgroundUpload={onBackgroundUpload}
        onRefresh={onRefresh}
      />
    </ContextMenu>
  )
}

export function SftpFileContextMenu({
  file,
  selectedFilesCount,
  enableBackgroundDownload = false,
  disabled = false,
  onOpen,
  onOpenChange,
  onAction,
  children,
}: SftpFileContextMenuProps) {
  return (
    <ContextMenu
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
        enableBackgroundDownload={enableBackgroundDownload}
        onAction={onAction}
      />
    </ContextMenu>
  )
}
