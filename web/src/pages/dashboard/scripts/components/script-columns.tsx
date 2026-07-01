import type { Column, ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Code2, ArrowUpDown, ArrowUp, ArrowDown, Play, Trash2 } from "lucide-react"
import { type Script } from "@/lib/api"
import { formatTimestamp } from "@/components/ui/data-table"
import type { DataTableColumnMeta } from "@/components/ui/column-meta"

interface Handlers {
  onExecute: (id: string) => void
  onDelete: (id: string) => void
  t: (key: string) => string
}

function SortableHeader<TValue>({
  column,
  label,
}: {
  column: Column<Script, TValue>
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

export function createScriptColumns({
  onExecute,
  onDelete,
  t,
}: Handlers): ColumnDef<Script>[] {
  const meta = (m: DataTableColumnMeta): DataTableColumnMeta => m

  const columns: ColumnDef<Script>[] = [
    {
      id: "name",
      accessorKey: "name",
      size: 360,
      minSize: 320,
      meta: meta({ align: "left" }),
      header: ({ column }) => <SortableHeader column={column} label={t("colName")} />,
      cell: ({ row }) => {
        const script = row.original
        const primaryTag = script.tags?.[0]
        return (
          <div className="flex w-full min-w-0 items-start gap-2 rounded-md px-1 py-0.5 text-left">
            <Code2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 space-y-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium">{script.name}</span>
                {primaryTag && (
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    {primaryTag}
                  </Badge>
                )}
              </div>
              {script.description && (
                <p className="line-clamp-1 text-xs text-muted-foreground">
                  {script.description}
                </p>
              )}
            </div>
          </div>
        )
      },
      filterFn: (row, id, value) => {
        const keyword = ((value as string) || "").toLowerCase()
        if (!keyword) return true
        const s = row.original
        return (
          s.name.toLowerCase().includes(keyword) ||
          (s.description || "").toLowerCase().includes(keyword)
        )
      },
    },
    {
      id: "description",
      accessorKey: "description",
      size: 260,
      minSize: 220,
      meta: meta({ align: "left" }),
      header: t("colDescription"),
      cell: ({ row }) => (
        <span className="line-clamp-2 max-w-[240px] text-xs text-muted-foreground">
          {row.original.description || "-"}
        </span>
      ),
      enableSorting: false,
    },
    {
      id: "content",
      accessorKey: "content",
      size: 340,
      minSize: 280,
      meta: meta({ align: "left" }),
      header: t("colContent"),
      cell: ({ row }) => (
        <div className="max-w-[320px] rounded-md bg-muted px-3 py-2">
          <pre className="line-clamp-2 whitespace-pre-wrap font-mono text-xs text-muted-foreground">
            {row.original.content}
          </pre>
        </div>
      ),
      enableSorting: false,
    },
    {
      id: "tags",
      accessorKey: "tags",
      size: 170,
      minSize: 140,
      meta: meta({ align: "left" }),
      header: t("colTags"),
      cell: ({ row }) => {
        const tags = row.original.tags || []
        return (
          <div className="flex w-full flex-wrap gap-1">
            {tags.length === 0 ? (
              <span className="text-sm text-muted-foreground">-</span>
            ) : (
              <>
                {tags.slice(0, 2).map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
                {tags.length > 2 && (
                  <Badge variant="outline" className="text-xs text-muted-foreground">
                    +{tags.length - 2}
                  </Badge>
                )}
              </>
            )}
          </div>
        )
      },
      filterFn: (row, id, value) => {
        const selected = (value as string[]) || []
        if (selected.length === 0) return true
        const tags = (row.getValue(id) as string[]) || []
        return selected.some((v) => tags.includes(v))
      },
    },
    {
      id: "author",
      accessorKey: "author",
      size: 170,
      minSize: 140,
      meta: meta({ align: "left" }),
      header: ({ column }) => <SortableHeader column={column} label={t("colAuthor")} />,
      cell: ({ row }) => (
        <span className="block truncate text-sm text-muted-foreground">{row.original.author || "-"}</span>
      ),
      filterFn: (row, id, value) => {
        const selected = (value as string[]) || []
        if (selected.length === 0) return true
        return selected.includes(row.getValue(id) as string)
      },
    },
    {
      id: "updated_at",
      accessorKey: "updated_at",
      size: 170,
      minSize: 150,
      meta: meta({ align: "left" }),
      header: ({ column }) => <SortableHeader column={column} label={t("colUpdatedAt")} />,
      cell: ({ row }) => {
        const ts = row.original.updated_at
        const { date, time } = formatTimestamp(ts)
        return (
          <div className="whitespace-nowrap text-sm text-muted-foreground">
            <div>{time}</div>
            <div className="text-xs">{date}</div>
          </div>
        )
      },
    },
    {
      id: "executions",
      accessorKey: "executions",
      size: 130,
      minSize: 110,
      meta: meta({ align: "center" }),
      header: ({ column }) => <SortableHeader column={column} label={t("colExecutions")} />,
      cell: ({ row }) => (
        <span className="block tabular-nums">{row.original.executions || 0}</span>
      ),
    },
    {
      id: "actions",
      size: 120,
      minSize: 100,
      meta: meta({ align: "right" }),
      header: () => t("colActions"),
      cell: ({ row }) => {
        const script = row.original
        return (
          <div className="flex w-full items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              title={t("actionExecuteTitle")}
              aria-label={t("actionExecuteTitle")}
              onClick={(event) => {
                event.stopPropagation()
                onExecute(script.id)
              }}
            >
              <Play className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-destructive hover:text-destructive"
              title={t("actionDelete")}
              aria-label={t("actionDelete")}
              onClick={(event) => {
                event.stopPropagation()
                onDelete(script.id)
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )
      },
      enableSorting: false,
    },
  ]

  return columns
}
