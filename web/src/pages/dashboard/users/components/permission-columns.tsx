import type { Column, ColumnDef } from "@tanstack/react-table"
import { useTranslation } from "react-i18next"
import { ArrowDown, ArrowUp, ArrowUpDown, FileText, FolderKey, Server, Settings, Terminal } from "lucide-react"

import type { DataTableColumnMeta } from "@/components/ui/column-meta"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { Permission } from "@/lib/api/permissions"

function SortableHeader<TValue>({ column, label }: { column: Column<Permission, TValue>; label: string }) {
  const Icon = column.getIsSorted() === "asc" ? ArrowUp : column.getIsSorted() === "desc" ? ArrowDown : ArrowUpDown
  return (
    <Button type="button" variant="ghost" size="sm" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")} className="h-7 px-2 text-xs font-medium">
      <span>{label}</span>
      <Icon className="ml-1.5 h-3.5 w-3.5" />
    </Button>
  )
}

export function usePermissionColumns(): ColumnDef<Permission, unknown>[] {
  const { t } = useTranslation("users")
  const meta = (value: DataTableColumnMeta): DataTableColumnMeta => value

  const moduleConfig = {
    server: { icon: Server, label: t("permModuleServer") },
    file: { icon: FolderKey, label: t("permModuleFile") },
    terminal: { icon: Terminal, label: t("permModuleTerminal") },
    audit: { icon: FileText, label: t("permModuleAudit") },
    system: { icon: Settings, label: t("permModuleSystem") },
  }

  return [
    {
      accessorKey: "name",
      meta: meta({ align: "left" }),
      header: ({ column }) => <SortableHeader column={column} label={t("permColName")} />,
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.name}</div>
          <div className="font-mono text-xs text-muted-foreground">{row.original.code}</div>
        </div>
      ),
      filterFn: (row, _id, value: string) => {
        const query = value.toLowerCase()
        return row.original.name.toLowerCase().includes(query) || row.original.code.toLowerCase().includes(query)
      },
    },
    {
      accessorKey: "description",
      meta: meta({ align: "left" }),
      header: () => t("permColDescription"),
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.description}</span>,
    },
    {
      accessorKey: "module",
      meta: meta({ align: "left" }),
      header: ({ column }) => <SortableHeader column={column} label={t("permColModule")} />,
      cell: ({ row }) => {
        const config = moduleConfig[row.original.module]
        const Icon = config.icon
        return <Badge variant="outline"><Icon className="mr-1 h-3 w-3" />{config.label}</Badge>
      },
      filterFn: (row, id, value: string[]) => value.includes(row.getValue(id)),
    },
    {
      accessorKey: "resource",
      meta: meta({ align: "left" }),
      header: () => "Casbin Resource",
      cell: ({ row }) => <code className="text-xs">{row.original.resource}</code>,
    },
  ]
}
