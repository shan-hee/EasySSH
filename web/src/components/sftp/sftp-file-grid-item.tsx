
import type { DragEvent, FocusEvent, KeyboardEvent, MouseEvent, RefObject } from "react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import Folder from "@/components/Folder"
import FileIcon from "@/components/File"
import { SftpFileContextMenu } from "@/components/sftp/sftp-context-menu"
import type { FileAction } from "@/components/sftp/file-action-menu"
import { getSftpFileTypeInfo } from "@/components/sftp/sftp-file-icons"
import type { SftpFileItem } from "@/lib/sftp-file-utils"

export type SftpFileGridItemFile = Pick<SftpFileItem, "name" | "type" | "size" | "modified" | "permissions">

export interface SftpFileGridItemProps {
  file: SftpFileGridItemFile
  isSelected: boolean
  isEditing: boolean
  isDraggedOver: boolean
  isDragged: boolean
  editingFileName: string
  editInputRef: RefObject<HTMLInputElement | null>
  folderLabel: string
  onEditingFileNameChange: (value: string) => void
  onFinishRename: () => void
  onCancelRename: () => void
  onRenameBlur: (event: FocusEvent<HTMLInputElement>) => void
  onDragStart: (event: DragEvent<HTMLDivElement>, fileName: string) => void
  onDragEnd: () => void
  onDragOver: (event: DragEvent<HTMLDivElement>, fileName: string, fileType: "file" | "directory") => void
  onDragLeave: () => void
  onDrop: (event: DragEvent<HTMLDivElement>, fileName: string, fileType: "file" | "directory") => void
  onClick: (fileName: string, event: MouseEvent<HTMLDivElement>) => void
  onDoubleClick: (fileName: string, fileType: "file" | "directory") => void
  onOpenContextMenu: (fileName: string, fileType: "file" | "directory") => void
  onCloseContextMenu: () => void
  selectedFilesCount: number
  enableBackgroundDownload?: boolean
  onContextAction: (action: FileAction) => void
}

export function SftpFileGridItem({
  file,
  isSelected,
  isEditing,
  isDraggedOver,
  isDragged,
  editingFileName,
  editInputRef,
  folderLabel,
  onEditingFileNameChange,
  onFinishRename,
  onCancelRename,
  onRenameBlur,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onClick,
  onDoubleClick,
  onOpenContextMenu,
  onCloseContextMenu,
  selectedFilesCount,
  enableBackgroundDownload = false,
  onContextAction,
}: SftpFileGridItemProps) {
  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      onFinishRename()
    } else if (event.key === "Escape") {
      onCancelRename()
    }
  }

  const fileTypeInfo = file.type === "file" ? getSftpFileTypeInfo(file.name) : null

  const gridItem = (
    <div
      draggable={!isEditing}
      onDragStart={(event) => onDragStart(event, file.name)}
      onDragEnd={onDragEnd}
      onDragOver={(event) => onDragOver(event, file.name, file.type)}
      onDragLeave={(event) => {
        event.preventDefault()
        onDragLeave()
      }}
      onDrop={(event) => onDrop(event, file.name, file.type)}
      onClick={(event) => {
        if (!isEditing) {
          onClick(file.name, event)
        }
      }}
      onDoubleClick={() => {
        if (!isEditing) {
          onDoubleClick(file.name, file.type)
        }
      }}
      className={cn(
        "group relative rounded-lg p-3 cursor-pointer select-none transition-all hover:bg-table-row-hover",
        (isSelected || (isDraggedOver && file.type === "directory")) && "bg-table-row-selected hover:bg-table-row-selected",
        isDragged && "opacity-50",
      )}
      title={file.name}
    >
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center justify-center h-16 w-16">
          {file.type === "directory" ? (
            <Folder color="var(--chart-1)" size={0.6} isFocused={isSelected} />
          ) : (
            <FileIcon
              color={fileTypeInfo?.color ?? "var(--muted-foreground)"}
              size={0.6}
              fileType={fileTypeInfo?.label ?? "FILE"}
              isFocused={isSelected}
            />
          )}
        </div>
        <div className="text-center w-full">
          {isEditing ? (
            <Input
              ref={editInputRef}
              value={editingFileName}
              onChange={(event) => onEditingFileNameChange(event.target.value)}
              onKeyDown={handleRenameKeyDown}
              onBlur={onRenameBlur}
              className={cn(
                "h-6 text-xs text-center px-1 bg-background text-foreground",
              )}
            />
          ) : (
            <div className={cn(
              "text-xs font-medium truncate text-foreground",
            )}>
              {file.name}
            </div>
          )}
          <div className="text-[10px] text-muted-foreground truncate">
            {file.type === "directory" ? folderLabel : file.size}
          </div>
        </div>
      </div>
    </div>
  )

  if (isEditing) {
    return gridItem
  }

  return (
    <SftpFileContextMenu
      file={file}
      selectedFilesCount={selectedFilesCount}
      enableBackgroundDownload={enableBackgroundDownload}
      onOpen={() => onOpenContextMenu(file.name, file.type)}
      onOpenChange={(open) => {
        if (!open) {
          onCloseContextMenu()
        }
      }}
      onAction={onContextAction}
    >
      {gridItem}
    </SftpFileContextMenu>
  )
}
