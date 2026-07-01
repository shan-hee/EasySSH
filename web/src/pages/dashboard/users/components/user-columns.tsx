
import type { Column, ColumnDef } from "@tanstack/react-table"
import { useTranslation } from "react-i18next"
import { UserDetail, UserRole } from "@/lib/api/users"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { SmartAvatar } from "@/components/ui/smart-avatar"
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
  Key,
  Shield,
  Users,
  Eye,
  Lock,
  Unlock,
} from "lucide-react"
import { useClientAuth } from "@/components/client-auth-provider"
import { useSystemConfig } from "@/hooks/use-system-config"
import { formatInTimezone, getEffectiveLocale, getEffectiveTimezone } from "@/utils/datetime"
import type { DataTableColumnMeta } from "@/components/ui/column-meta"

interface UserColumnsOptions {
  onEdit?: (user: UserDetail) => void
  onDelete?: (userId: string, username: string) => void
  onChangePassword?: (userId: string) => void
  onLock?: (userId: string, username: string) => void
  onUnlock?: (userId: string, username: string) => void
}

function SortableHeader<TValue>({
  column,
  label,
}: {
  column: Column<UserDetail, TValue>
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

export function useUserColumns(options?: UserColumnsOptions): ColumnDef<UserDetail, unknown>[] {
  const { user } = useClientAuth()
  const { data: systemConfig } = useSystemConfig()
  const { t } = useTranslation("users")
  const effectiveLocale = getEffectiveLocale(user, systemConfig || null)
  const effectiveTimezone = getEffectiveTimezone(user, systemConfig || null)

  const formatDate = (value: string) =>
    formatInTimezone(value, { second: undefined }, effectiveLocale, effectiveTimezone)

  const isUserLocked = (user: UserDetail) => {
    if (!user.locked_until) return false
    return new Date(user.locked_until) > new Date()
  }

  const RoleBadge = ({ role }: { role: UserRole }) => {
    switch (role) {
      case "admin":
        return (
          <Badge className="bg-purple-100 text-purple-800 border-purple-200">
            <Shield className="mr-1 h-3 w-3" />
            {t("filterRoleAdmin")}
          </Badge>
        )
      case "user":
        return (
          <Badge className="bg-blue-100 text-blue-800 border-blue-200">
            <Users className="mr-1 h-3 w-3" />
            {t("filterRoleUser")}
          </Badge>
        )
      case "viewer":
        return (
          <Badge className="bg-gray-100 text-gray-800 border-gray-200">
            <Eye className="mr-1 h-3 w-3" />
            {t("filterRoleViewer")}
          </Badge>
        )
    }
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
      accessorKey: "username",
      size: 360,
      minSize: 300,
      meta: meta({ align: "left" }),
      header: ({ column }) => <SortableHeader column={column} label={t("fieldUsername")} />,
      cell: ({ row }) => {
        const user = row.original
        const locked = isUserLocked(user)
        return (
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative shrink-0">
              <SmartAvatar
                className="h-10 w-10"
                src={user.avatar}
                username={user.username}
                email={user.email}
              />
              {locked && (
                <div className="absolute -bottom-1 -right-1 bg-destructive rounded-full p-0.5">
                  <Lock className="h-3 w-3 text-destructive-foreground" />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium">{user.username}</span>
                {locked && (
                  <Badge variant="destructive" className="text-xs px-1.5 py-0">
                    {t("statusLocked")}
                  </Badge>
                )}
              </div>
              <div className="truncate text-sm text-muted-foreground">{user.email}</div>
            </div>
          </div>
        )
      },
      filterFn: (row, id, value) => {
        const user = row.original
        const searchValue = value.toLowerCase()
        return (
          user.username.toLowerCase().includes(searchValue) ||
          user.email.toLowerCase().includes(searchValue)
        )
      },
    },

    {
      accessorKey: "role",
      size: 160,
      minSize: 140,
      meta: meta({ align: "left" }),
      header: ({ column }) => <SortableHeader column={column} label={t("fieldRole")} />,
      cell: ({ row }) => <RoleBadge role={row.getValue("role")} />,
      filterFn: (row, id, value) => {
        return value.includes(row.getValue(id))
      },
    },

    {
      accessorKey: "created_at",
      size: 220,
      minSize: 190,
      meta: meta({ align: "left" }),
      header: ({ column }) => <SortableHeader column={column} label="创建时间" />,
      cell: ({ row }) => {
        return <div className="text-sm">{formatDate(row.getValue("created_at"))}</div>
      },
    },

    {
      accessorKey: "last_login_at",
      size: 200,
      minSize: 160,
      meta: meta({ align: "left" }),
      header: ({ column }) => <SortableHeader column={column} label="最后登录" />,
      cell: ({ row }) => {
        const lastLogin = row.getValue("last_login_at") as string | undefined
        return (
          <div className="text-sm">
            {lastLogin ? formatDate(lastLogin) : "-"}
          </div>
        )
      },
    },

    {
      id: "actions",
      size: 72,
      minSize: 64,
      maxSize: 80,
      meta: meta({ align: "right" }),
      header: () => t("colActions"),
      cell: ({ row }) => {
        const user = row.original
        const locked = isUserLocked(user)

        return (
          <div className="flex w-full items-center justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => options?.onEdit?.(user)}>
                  <Edit className="mr-2 h-4 w-4" />
                  {t("colActionEdit")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => options?.onChangePassword?.(user.id)}>
                  <Key className="mr-2 h-4 w-4" />
                  {t("colActionChangePassword")}
                </DropdownMenuItem>
                {locked ? (
                  <DropdownMenuItem
                    onClick={() => options?.onUnlock?.(user.id, user.username)}
                    className="text-green-600"
                  >
                    <Unlock className="mr-2 h-4 w-4" />
                    {t("colActionUnlock")}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onClick={() => options?.onLock?.(user.id, user.username)}
                    className="text-orange-600"
                  >
                    <Lock className="mr-2 h-4 w-4" />
                    {t("colActionLock")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => options?.onDelete?.(user.id, user.username)}
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
