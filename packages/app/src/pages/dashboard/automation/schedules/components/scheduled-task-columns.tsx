import type { Column, ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertTriangle,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Calendar,
  Play,
  Pause,
  Edit,
  History,
  Trash2,
  CheckCircle,
  XCircle,
  Zap,
  MoreHorizontal,
  Terminal,
  FileText,
  Upload,
  Download,
} from "lucide-react"
import { type ScheduledTask } from "@/lib/api"
import type { DataTableColumnMeta } from "@/components/ui/column-meta"

interface ScheduledTaskColumnsOptions {
  onToggle: (taskId: string, enabled: boolean) => void
  onTrigger: (taskId: string) => void
  onEdit: (task: ScheduledTask) => void
  onDelete: (taskId: string) => void
  onViewRuns?: (task: ScheduledTask) => void
  formatDate: (dateString: string | undefined) => string
}

type I18nValues = Record<string, string | number | Date>
type I18nT = (key: string, values?: I18nValues) => string

function SortableHeader<TValue>({
  column,
  label,
}: {
  column: Column<ScheduledTask, TValue>
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

function getTypeIcon(type: string) {
  switch (type) {
    case "command":
      return <Terminal className="h-4 w-4" />
    case "script":
      return <FileText className="h-4 w-4" />
    case "sftp_upload":
      return <Upload className="h-4 w-4" />
    case "sftp_download":
      return <Download className="h-4 w-4" />
    default:
      return <Calendar className="h-4 w-4" />
  }
}

function calculateSuccessRateNumber(task: ScheduledTask): number {
  if (task.run_count === 0) return -1
  const successCount = Math.max(0, task.run_count - task.failure_count)
  return (successCount / task.run_count) * 100
}

export function createScheduledTaskColumns(
  t: I18nT,
  options: ScheduledTaskColumnsOptions
): ColumnDef<ScheduledTask>[] {
  const { onToggle, onTrigger, onEdit, onDelete, onViewRuns, formatDate } = options

  const meta = (m: DataTableColumnMeta): DataTableColumnMeta => m

  return [
    {
      id: "task_name",
      accessorKey: "task_name",
      size: 280,
      minSize: 240,
      meta: meta({ align: "left" }),
      header: ({ column }) => <SortableHeader column={column} label={t("tableColTaskName")} />,
      cell: ({ row }) => {
        const task = row.original
        return (
          <div className="flex w-full min-w-0 flex-col py-0.5">
            <span className="truncate font-medium">{task.task_name}</span>
            {task.description && (
              <span className="truncate text-xs text-muted-foreground">
                {task.description}
              </span>
            )}
          </div>
        )
      },
    },

    {
      id: "task_type",
      accessorKey: "task_type",
      size: 140,
      minSize: 120,
      meta: meta({ align: "left" }),
      header: ({ column }) => <SortableHeader column={column} label={t("tableColType")} />,
      cell: ({ row }) => {
        const type = row.getValue("task_type") as string
        const typeLabels: Record<string, string> = {
          command: t("typeCommand"),
          script: t("typeScript"),
          sftp_upload: t("typeSftpUpload"),
          sftp_download: t("typeSftpDownload"),
        }
        return (
          <div className="flex w-full min-w-0 items-center gap-2">
            {getTypeIcon(type)}
            <span className="truncate text-sm">{typeLabels[type] || type}</span>
          </div>
        )
      },
      filterFn: (row, id, value) => {
        return value.includes(row.getValue(id))
      },
    },

    {
      id: "cron_expression",
      accessorKey: "cron_expression",
      size: 160,
      minSize: 140,
      meta: meta({ align: "left" }),
      header: t("tableColCron"),
      cell: ({ row }) => {
        const cron = row.getValue("cron_expression") as string
        return (
          <code className="text-xs bg-muted px-2 py-1 rounded">
            {cron}
          </code>
        )
      },
    },

    {
      id: "enabled",
      accessorKey: "enabled",
      size: 120,
      minSize: 100,
      meta: meta({ align: "left" }),
      header: ({ column }) => <SortableHeader column={column} label={t("tableColStatus")} />,
      cell: ({ row }) => {
        const task = row.original
        if (!task.enabled) {
          return <Badge variant="secondary">{t("statusDisabled")}</Badge>
        }
        if (task.last_status === "failed") {
          return <Badge variant="destructive">{t("statusFailed")}</Badge>
        }
        if (task.last_status === "unknown") {
          return <Badge variant="secondary">{t("lastStatusUnknown")}</Badge>
        }
        if (task.last_status === "success") {
          return <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">{t("statusEnabled")}</Badge>
        }
        return <Badge variant="outline">{t("statusPending")}</Badge>
      },
      filterFn: (row, id, value) => {
        const enabled = row.getValue(id) as boolean
        if (value.includes("enabled") && enabled) return true
        if (value.includes("disabled") && !enabled) return true
        return false
      },
    },

    {
      id: "last_run_at",
      accessorKey: "last_run_at",
      size: 200,
      minSize: 170,
      meta: meta({ align: "left" }),
      header: ({ column }) => <SortableHeader column={column} label={t("tableColLastRun")} />,
      cell: ({ row }) => {
        const task = row.original
        return (
          <div className="flex w-full min-w-0 flex-col py-0.5 text-sm">
            <span className="truncate tabular-nums">{formatDate(task.last_run_at)}</span>
            {task.last_status && (
              <div className="mt-1 flex items-center gap-1">
                {task.last_status === "success" ? (
                  <CheckCircle className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                ) : task.last_status === "canceled" || task.last_status === "unknown" ? (
                  <AlertTriangle className="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400" />
                ) : (
                  <XCircle className="h-3 w-3 shrink-0 text-destructive" />
                )}
                <span className="truncate text-xs text-muted-foreground">
                  {task.last_status === "success"
                    ? t("lastStatusSuccess")
                    : task.last_status === "canceled"
                      ? t("lastStatusCanceled")
                      : task.last_status === "unknown"
                        ? t("lastStatusUnknown")
                        : t("lastStatusFailed")}
                </span>
              </div>
            )}
          </div>
        )
      },
    },

    {
      id: "next_run_at",
      accessorKey: "next_run_at",
      size: 180,
      minSize: 150,
      meta: meta({ align: "left" }),
      header: ({ column }) => <SortableHeader column={column} label={t("tableColNextRun")} />,
      cell: ({ row }) => {
        const nextRun = row.getValue("next_run_at") as string
        return <span className="block truncate tabular-nums text-sm">{formatDate(nextRun)}</span>
      },
    },

    {
      id: "run_count",
      accessorKey: "run_count",
      size: 100,
      minSize: 80,
      meta: meta({ align: "center" }),
      header: ({ column }) => <SortableHeader column={column} label={t("tableColRunCount")} />,
      cell: ({ row }) => {
        const count = row.getValue("run_count") as number
        return <span className="block tabular-nums text-sm">{count}</span>
      },
    },

    {
      id: "success_rate",
      accessorFn: (row) => calculateSuccessRateNumber(row),
      size: 110,
      minSize: 90,
      meta: meta({ align: "center" }),
      header: ({ column }) => <SortableHeader column={column} label={t("tableColSuccessRate")} />,
      cell: ({ row }) => {
        const rate = calculateSuccessRateNumber(row.original)
        return (
          <span className="block tabular-nums text-sm text-muted-foreground">
            {rate < 0 ? "-" : `${rate.toFixed(1)}%`}
          </span>
        )
      },
    },

    {
      id: "actions",
      size: 96,
      minSize: 84,
      maxSize: 110,
      header: () => t("tableColActions"),
      cell: ({ row }) => {
        const task = row.original
        return (
          <div className="flex w-full items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onToggle(task.id, task.enabled)}
              className="h-8 w-8 p-0"
              title={task.enabled ? t("tooltipToggleDisable") : t("tooltipToggleEnable")}
            >
              {task.enabled ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onTrigger(task.id)}>
                  <Zap className="mr-2 h-4 w-4" />
                  {t("actionImmediateRun")}
                </DropdownMenuItem>
                {onViewRuns ? (
                  <DropdownMenuItem onClick={() => onViewRuns(task)}>
                    <History className="mr-2 h-4 w-4" />
                    {t("actionViewRuns")}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onClick={() => onEdit(task)}>
                  <Edit className="mr-2 h-4 w-4" />
                  {t("actionEdit")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onDelete(task.id)}
                  className="text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t("actionDelete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      },
    },
  ]
}
