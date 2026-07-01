
import {
  CloudDownload,
  Download,
  Trash2,
  Eye,
  Edit,
  FileText,
} from "lucide-react"
import type { ReactNode } from "react"
import { useWorkspaceSftpTranslator } from "@/components/ssh-workspace/use-workspace-translator"
import { cn } from "@/lib/utils"
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "@/components/ui/context-menu"

interface FileItem {
  name: string
  type: "file" | "directory"
  size: string
  modified: string
  permissions: string
}

export type FileAction =
  | "open"
  | "download"
  | "backgroundDownload"
  | "rename"
  | "chmod"
  | "delete"

interface FileActionMenuProps {
  file: FileItem
  mode: "dropdown" | "context"
  selectedFilesCount?: number
  enableBackgroundDownload?: boolean
  onAction: (action: FileAction) => void
}

type FileActionMenuItemProps = {
  mode: "dropdown" | "context"
  className: string
  variant?: "default" | "destructive"
  onClick: () => void
  children: ReactNode
}

function FileActionMenuItem({
  mode,
  className,
  variant = "default",
  onClick,
  children,
}: FileActionMenuItemProps) {
  return mode === "dropdown" ? (
    <DropdownMenuItem className={className} variant={variant} onClick={onClick}>
      {children}
    </DropdownMenuItem>
  ) : (
    <ContextMenuItem className={className} variant={variant} onSelect={onClick}>
      {children}
    </ContextMenuItem>
  )
}

function FileActionMenuSeparator({ mode, className }: { mode: "dropdown" | "context"; className: string }) {
  return mode === "dropdown" ? (
    <DropdownMenuSeparator className={className} />
  ) : (
    <ContextMenuSeparator className={className} />
  )
}

function KeyboardShortcut({ mode, children }: { mode: "dropdown" | "context"; children: string }) {
  if (mode === "context") {
    return <ContextMenuShortcut>{children}</ContextMenuShortcut>
  }

  return <span className="ml-auto text-xs tracking-widest text-muted-foreground">{children}</span>
}

/**
 * 统一的文件操作菜单组件
 * 支持两种渲染模式：dropdown（行操作列）和 context（右键菜单）
 */
export function FileActionMenu({
  file,
  mode,
  selectedFilesCount = 0,
  enableBackgroundDownload = false,
  onAction,
}: FileActionMenuProps) {
  const t = useWorkspaceSftpTranslator()
  const isMultiSelect = selectedFilesCount > 1
  const isSingleSelect = selectedFilesCount === 1

  // 通用样式
  const itemClassName = mode === "dropdown"
    ? cn("focus:bg-accent focus:text-accent-foreground")
    : cn("")

  const separatorClassName = mode === "dropdown"
    ? cn("bg-border")
    : cn("")

  const deleteClassName = mode === "dropdown"
    ? cn("")
    : cn("")

  return (
    <>
      {/* 打开/编辑 */}
      <FileActionMenuItem
        mode={mode}
        className={itemClassName}
        onClick={() => onAction("open")}
      >
        <Eye className="h-4 w-4 mr-2" />
        <span className="flex-1">
          {file.type === "directory" ? t("contextOpen") : t("contextEdit")}
        </span>
        <KeyboardShortcut mode={mode}>⏎</KeyboardShortcut>
      </FileActionMenuItem>

      {/* 下载：文件管理器只保留推荐下载路径，其他方案移动到传输任务页 */}
      {file.type === "file" || file.type === "directory" ? (
        <FileActionMenuItem
          mode={mode}
          className={itemClassName}
          onClick={() => onAction("download")}
        >
          <Download className="h-4 w-4 mr-2" />
          <span className="flex-1">{t("actionDownload")}</span>
          <KeyboardShortcut mode={mode}>⌘D</KeyboardShortcut>
        </FileActionMenuItem>
      ) : (
        null
      )}

      {enableBackgroundDownload && file.type === "file" && (
        <FileActionMenuItem
          mode={mode}
          className={itemClassName}
          onClick={() => onAction("backgroundDownload")}
        >
          <CloudDownload className="h-4 w-4 mr-2" />
          <span className="flex-1">{t("actionBackgroundDownload")}</span>
        </FileActionMenuItem>
      )}

      <FileActionMenuSeparator mode={mode} className={separatorClassName} />

      {/* 重命名 - 右键菜单仅单选时显示 */}
      {(mode === "dropdown" || isSingleSelect || selectedFilesCount === 0) && (
        <FileActionMenuItem
          mode={mode}
          className={itemClassName}
          onClick={() => onAction("rename")}
        >
          <Edit className="h-4 w-4 mr-2" />
          <span className="flex-1">{t("actionRename")}</span>
          <KeyboardShortcut mode={mode}>F2</KeyboardShortcut>
        </FileActionMenuItem>
      )}

      {/* 修改权限 - 右键菜单仅单选时显示 */}
      {(mode === "dropdown" || isSingleSelect || selectedFilesCount === 0) && (
        <FileActionMenuItem
          mode={mode}
          className={itemClassName}
          onClick={() => onAction("chmod")}
        >
          <FileText className="h-4 w-4 mr-2" />
          <span className="flex-1">{t("actionChangePermissions")}</span>
        </FileActionMenuItem>
      )}

      <FileActionMenuSeparator mode={mode} className={separatorClassName} />

      {/* 删除 */}
      <FileActionMenuItem
        mode={mode}
        className={deleteClassName}
        variant="destructive"
        onClick={() => onAction("delete")}
      >
        <Trash2 className="h-4 w-4 mr-2" />
        <span className="flex-1">
          {isMultiSelect
            ? t("actionDeleteMulti", { count: selectedFilesCount })
            : t("actionDeleteSingle")}
        </span>
        <KeyboardShortcut mode={mode}>⌫</KeyboardShortcut>
      </FileActionMenuItem>
    </>
  )
}
