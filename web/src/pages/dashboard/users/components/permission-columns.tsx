
import type { Column, ColumnDef } from "@tanstack/react-table"
import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  MoreHorizontal,
  Edit,
  Trash2,
  Shield,
  Users,
  Eye,
  Server,
  FolderKey,
  Terminal,
  FileText,
  Settings,
} from "lucide-react"
import type { Permission } from "@/lib/api/permissions"
import type { DataTableColumnMeta } from "@/components/ui/column-meta"

function SortableHeader<TValue>({
  column,
  label,
}: {
  column: Column<Permission, TValue>
  label: string
}) {
  const Icon = column.getIsSorted() === "asc"
    ? ArrowUp
    : column.getIsSorted() === "desc"
      ? ArrowDown
      : ArrowUpDown
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      className="h-7 px-2 text-xs font-medium"
    >
      <span>{label}</span>
      <Icon className="ml-1.5 h-3.5 w-3.5" />
    </Button>
  )
}

// 静态权限数据
export const staticPermissions: Permission[] = [
  {
    id: "1",
    name: "服务器管理",
    code: "server:manage",
    description: "创建、编辑、删除服务器连接",
    module: "server",
    roles: ["admin"],
    created_at: "2024-01-01T00:00:00Z",
  },
  {
    id: "2",
    name: "服务器查看",
    code: "server:view",
    description: "查看服务器列表和详情",
    module: "server",
    roles: ["admin", "user", "viewer"],
    created_at: "2024-01-01T00:00:00Z",
  },
  {
    id: "3",
    name: "服务器连接",
    code: "server:connect",
    description: "连接到远程服务器",
    module: "server",
    roles: ["admin", "user"],
    created_at: "2024-01-01T00:00:00Z",
  },
  {
    id: "4",
    name: "文件管理",
    code: "file:manage",
    description: "上传、下载、删除文件",
    module: "file",
    roles: ["admin", "user"],
    created_at: "2024-01-01T00:00:00Z",
  },
  {
    id: "5",
    name: "文件查看",
    code: "file:view",
    description: "浏览文件列表",
    module: "file",
    roles: ["admin", "user", "viewer"],
    created_at: "2024-01-01T00:00:00Z",
  },
  {
    id: "6",
    name: "终端执行",
    code: "terminal:execute",
    description: "在终端中执行命令",
    module: "terminal",
    roles: ["admin", "user"],
    created_at: "2024-01-01T00:00:00Z",
  },
  {
    id: "7",
    name: "Docker 查看",
    code: "docker:view",
    description: "查看远程服务器 Docker 资源",
    module: "server",
    roles: ["admin", "user"],
    created_at: "2024-01-01T00:00:00Z",
  },
  {
    id: "8",
    name: "Docker 管理",
    code: "docker:manage",
    description: "启动、停止、重启或删除远程服务器 Docker 容器",
    module: "server",
    roles: ["admin"],
    created_at: "2024-01-01T00:00:00Z",
  },
  {
    id: "9",
    name: "审计日志查看",
    code: "audit:view",
    description: "查看系统审计日志",
    module: "audit",
    roles: ["admin"],
    created_at: "2024-01-01T00:00:00Z",
  },
  {
    id: "10",
    name: "系统设置",
    code: "system:settings",
    description: "修改系统配置",
    module: "system",
    roles: ["admin"],
    created_at: "2024-01-01T00:00:00Z",
  },
  {
    id: "11",
    name: "备份恢复",
    code: "backup:manage",
    description: "导出和恢复系统备份",
    module: "system",
    roles: ["admin"],
    created_at: "2024-01-01T00:00:00Z",
  },
  {
    id: "12",
    name: "用户管理",
    code: "user:manage",
    description: "创建、编辑、删除用户",
    module: "system",
    roles: ["admin"],
    created_at: "2024-01-01T00:00:00Z",
  },
]

interface PermissionColumnsOptions {
  onEdit?: (permission: Permission) => void
  onDelete?: (permissionId: string, name: string) => void
}

export function usePermissionColumns(options?: PermissionColumnsOptions): ColumnDef<Permission, unknown>[] {
  const { t } = useTranslation("users")

  const ModuleBadge = ({ module }: { module: Permission["module"] }) => {
    const config = {
      server: { icon: Server, label: t("permModuleServer"), className: "bg-blue-100 text-blue-800 border-blue-200" },
      file: { icon: FolderKey, label: t("permModuleFile"), className: "bg-green-100 text-green-800 border-green-200" },
      terminal: { icon: Terminal, label: t("permModuleTerminal"), className: "bg-orange-100 text-orange-800 border-orange-200" },
      audit: { icon: FileText, label: t("permModuleAudit"), className: "bg-purple-100 text-purple-800 border-purple-200" },
      system: { icon: Settings, label: t("permModuleSystem"), className: "bg-gray-100 text-gray-800 border-gray-200" },
    }
    const { icon: Icon, label, className } = config[module]
    return (
      <Badge className={className}>
        <Icon className="mr-1 h-3 w-3" />
        {label}
      </Badge>
    )
  }

  const RoleBadges = ({ roles }: { roles: Permission["roles"] }) => {
    const roleConfig = {
      admin: { icon: Shield, label: t("filterRoleAdmin"), className: "bg-purple-100 text-purple-800 border-purple-200" },
      user: { icon: Users, label: t("filterRoleUser"), className: "bg-blue-100 text-blue-800 border-blue-200" },
      viewer: { icon: Eye, label: t("filterRoleViewer"), className: "bg-gray-100 text-gray-800 border-gray-200" },
    }
    return (
      <div className="flex flex-wrap gap-1">
        {roles.map((role) => {
          const { icon: Icon, label, className } = roleConfig[role]
          return (
            <Badge key={role} variant="outline" className={`${className} text-xs px-1.5 py-0`}>
              <Icon className="mr-1 h-3 w-3" />
              {label}
            </Badge>
          )
        })}
      </div>
    )
  }

  const meta = (m: DataTableColumnMeta): DataTableColumnMeta => m

  return [
    {
      id: "select",
      size: 44,
      minSize: 44,
      maxSize: 44,
      meta: meta({ align: "center" }),
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="select row"
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },

    {
      accessorKey: "name",
      size: 260,
      minSize: 220,
      meta: meta({ align: "left" }),
      header: ({ column }) => <SortableHeader column={column} label={t("permColName")} />,
      cell: ({ row }) => {
        const permission = row.original
        return (
          <div>
            <div className="font-medium">{permission.name}</div>
            <div className="text-xs text-muted-foreground font-mono">{permission.code}</div>
          </div>
        )
      },
      filterFn: (row, id, value) => {
        const permission = row.original
        const searchValue = value.toLowerCase()
        return (
          permission.name.toLowerCase().includes(searchValue) ||
          permission.code.toLowerCase().includes(searchValue)
        )
      },
    },

    {
      accessorKey: "description",
      size: 320,
      minSize: 260,
      meta: meta({ align: "left" }),
      header: () => t("permColDescription"),
      cell: ({ row }) => (
        <div className="text-sm text-muted-foreground max-w-[200px] truncate">
          {row.getValue("description")}
        </div>
      ),
    },

    {
      accessorKey: "module",
      size: 170,
      minSize: 150,
      meta: meta({ align: "left" }),
      header: ({ column }) => <SortableHeader column={column} label={t("permColModule")} />,
      cell: ({ row }) => <ModuleBadge module={row.getValue("module")} />,
      filterFn: (row, id, value) => {
        return value.includes(row.getValue(id))
      },
    },

    {
      accessorKey: "roles",
      size: 260,
      minSize: 220,
      meta: meta({ align: "left" }),
      header: () => t("permColRoles"),
      cell: ({ row }) => <RoleBadges roles={row.getValue("roles")} />,
    },

    {
      id: "actions",
      size: 72,
      minSize: 64,
      maxSize: 80,
      meta: meta({ align: "right" }),
      header: () => t("colActions"),
      cell: ({ row }) => {
        const permission = row.original

        return (
          <div className="flex w-full items-center justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => options?.onEdit?.(permission)}>
                  <Edit className="mr-2 h-4 w-4" />
                  {t("colActionEdit")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => options?.onDelete?.(permission.id, permission.name)}
                  className="text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t("colActionDelete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      },
      enableSorting: false,
      enableHiding: false,
    },
  ]
}
