import type { Column, ColumnDef } from "@tanstack/react-table"
import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ArrowUpDown, ArrowUp, ArrowDown, Clock, User, Server, Globe, AlertTriangle, CheckCircle } from "lucide-react"
import type { AuditLog } from "@/lib/log-types"
import {
  getActionColor,
  formatTimestamp,
} from "@/components/ui/data-table"
import type { DataTableColumnMeta } from "@/components/ui/column-meta"

type I18nValues = Record<string, string | number | Date>
type I18nT = (key: string, values?: I18nValues) => string

function SortableHeader<TValue>({
  column,
  label,
  icon,
}: {
  column: Column<AuditLog, TValue>
  label: string
  icon?: ReactNode
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
      {icon ? (
        <span className="mr-1.5 flex items-center gap-1">
          {icon}
          <span>{label}</span>
        </span>
      ) : (
        <span>{label}</span>
      )}
      <Icon className="ml-1.5 h-3.5 w-3.5" />
    </Button>
  )
}

/**
 * 根据传入的多语言函数创建操作日志表格列定义。
 * 将 `useTranslation("logsAudit")` 写在调用方组件中，再把 `t` 传进来。
 */
function getActionLabel(
  t: (key: string) => string,
  action: string,
): string {
  const labelMap: Record<string, string> = {
    login: t("actionLogin"),
    logout: t("actionLogout"),
    ssh_connect: t("actionConnect"),
    ssh_disconnect: t("actionDisconnect"),
    sftp_upload: t("actionUpload"),
    sftp_download: t("actionDownload"),
    sftp_transfer: t("actionTransfer"),
    sftp_delete: t("actionDelete"),
    sftp_rename: t("actionRename"),
    sftp_mkdir: t("actionMkdir"),
    sftp_chmod: t("actionChmod"),
    monitoring_query: t("actionMonitoringQuery"),
    server_create: t("actionServerCreate"),
    server_update: t("actionServerUpdate"),
    server_delete: t("actionServerDelete"),
    server_test: t("actionServerTest"),
    user_create: t("actionUserCreate"),
    user_update: t("actionUserUpdate"),
    user_delete: t("actionUserDelete"),
    connect: t("actionConnect"),
    disconnect: t("actionDisconnect"),
    upload: t("actionUpload"),
    download: t("actionDownload"),
    delete: t("actionDelete"),
    create: t("actionCreate"),
    update: t("actionUpdate"),
  }
  return labelMap[action] || action
}

function getResourceLabel(
  t: (key: string) => string,
  resource: string,
): string {
  const labelMap: Record<string, string> = {
    server: t("resourceServer"),
    file: t("resourceFile"),
    user: t("resourceUser"),
    system: t("resourceSystem"),
    session: t("resourceSession"),
  }
  return labelMap[resource] || resource
}

function formatDurationWithI18n(
  t: I18nT,
  milliseconds: number | undefined,
): string {
  if (!milliseconds) return "-"
  if (milliseconds < 1000) return t("durationMilliseconds", { milliseconds })
  const seconds = Math.round(milliseconds / 1000)
  if (seconds < 60) return t("durationSeconds", { seconds })
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return t("durationMinutesSeconds", {
    minutes,
    seconds: remainingSeconds,
  })
}

export function createAuditLogColumns(
  t: I18nT,
): ColumnDef<AuditLog>[] {
  const meta = (m: DataTableColumnMeta): DataTableColumnMeta => m

  return [
  // 类别列
  {
    id: "category",
    accessorKey: "category",
    size: 110,
    minSize: 90,
    meta: meta({ align: "left" }),
    header: t("columnCategory"),
    cell: ({ row }) => {
      const category = row.getValue("category") as string
      return (
        <Badge variant="outline">
          {category === "activity" ? t("categoryActivity") : t("categoryAudit")}
        </Badge>
      )
    },
  },

  // 时间列
  {
    id: "created_at",
    accessorKey: "created_at",
    size: 180,
    minSize: 150,
    meta: meta({ align: "left" }),
    header: ({ column }) => (
      <SortableHeader column={column} label={t("columnTime")} icon={<Clock className="h-3.5 w-3.5" />} />
    ),
    cell: ({ row }) => {
      const timestamp = row.getValue("created_at") as string
      const { date, time } = formatTimestamp(timestamp)
      return (
        <div className="font-mono text-sm">
          <div className="flex items-center gap-2">
            <Clock className="h-3 w-3 text-muted-foreground" />
            <div>
              <div>{time}</div>
              <div className="text-xs text-muted-foreground">{date}</div>
            </div>
          </div>
        </div>
      )
    },
  },

  // 用户列
  {
    id: "username",
    accessorKey: "username",
    size: 160,
    minSize: 130,
    meta: meta({ align: "left" }),
    header: ({ column }) => (
      <SortableHeader column={column} label={t("columnUser")} icon={<User className="h-3.5 w-3.5" />} />
    ),
    cell: ({ row }) => {
      const username = row.getValue("username") as string
      return (
        <div className="font-medium">{username}</div>
      )
    },
  },

  // 操作列
  {
    id: "action",
    accessorKey: "action",
    size: 140,
    minSize: 110,
    meta: meta({ align: "left" }),
    header: ({ column }) => <SortableHeader column={column} label={t("columnAction")} />,
    cell: ({ row }) => {
      const action = row.getValue("action") as string
      return (
        <Badge className={getActionColor(action)}>
          {getActionLabel(t, action)}
        </Badge>
      )
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id))
    },
  },

  // 资源列
  {
    id: "resource",
    accessorKey: "resource",
    size: 120,
    minSize: 100,
    meta: meta({ align: "left" }),
    header: ({ column }) => <SortableHeader column={column} label={t("columnResource")} />,
    cell: ({ row }) => {
      const resource = row.getValue("resource") as string
      return (
        <Badge variant="outline">
          {getResourceLabel(t, resource)}
        </Badge>
      )
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id))
    },
  },

  // 状态列
  {
    id: "status",
    accessorKey: "status",
    size: 150,
    minSize: 120,
    meta: meta({ align: "left" }),
    header: ({ column }) => <SortableHeader column={column} label={t("columnStatus")} />,
    cell: ({ row }) => {
      const status = row.getValue("status") as string
      const isSuccess = status === "success"
      const isWarning = status === "warning"
      return (
        <div className="flex items-center gap-2">
          {isSuccess ? (
            <CheckCircle className="h-4 w-4 text-green-600" />
          ) : isWarning ? (
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-red-600" />
          )}
          <Badge
            className={
              isSuccess
                ? "bg-green-100 text-green-800 border-green-200"
                : isWarning
                  ? "bg-amber-100 text-amber-800 border-amber-200"
                : "bg-red-100 text-red-800 border-red-200"
            }
          >
            {isSuccess
              ? t("filterStatusSuccessLabel")
              : isWarning
                ? t("filterStatusWarningLabel")
                : t("filterStatusFailureLabel")}
          </Badge>
        </div>
      )
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id))
    },
  },

  // IP地址列
  {
    id: "ip",
    accessorKey: "ip",
    size: 150,
    minSize: 120,
    meta: meta({ align: "left" }),
    header: ({ column }) => (
      <SortableHeader column={column} label={t("columnIp")} icon={<Globe className="h-3.5 w-3.5" />} />
    ),
    cell: ({ row }) => {
      const ip = row.getValue("ip") as string
      return (
        <div className="font-mono text-sm">{ip}</div>
      )
    },
  },

  // 详情列
  {
    id: "details",
    accessorKey: "details",
    size: 280,
    minSize: 220,
    meta: meta({ align: "left" }),
    header: t("columnDetails"),
    cell: ({ row }) => {
      const log = row.original
      return (
        <div className="max-w-xs">
          <div
            className="text-sm truncate"
            title={log.details || log.error_msg}
          >
            {log.details || log.error_msg || "-"}
          </div>
          {log.user_agent && (
            <div
              className="text-xs text-muted-foreground truncate"
              title={log.user_agent}
            >
              {log.user_agent}
            </div>
          )}
        </div>
      )
    },
  },

  // 耗时列
  {
    id: "duration",
    accessorKey: "duration",
    size: 110,
    minSize: 90,
    meta: meta({ align: "left" }),
    header: ({ column }) => <SortableHeader column={column} label={t("columnDuration")} />,
    cell: ({ row }) => {
      const duration = row.getValue("duration") as number
      return (
        <div className="font-mono text-sm">
          {formatDurationWithI18n(t, duration)}
        </div>
      )
    },
  },

  // 服务器列（可选）
  {
    id: "server_id",
    accessorKey: "server_id",
    size: 150,
    minSize: 120,
    meta: meta({ align: "left" }),
    header: ({ column }) => (
      <SortableHeader column={column} label={t("columnServer")} icon={<Server className="h-3.5 w-3.5" />} />
    ),
    cell: ({ row }) => {
      const serverId = row.getValue("server_id") as string
      return (
        <div className="font-mono text-sm">
          {serverId || "-"}
        </div>
      )
    },
    enableHiding: true,
  },
]
}
