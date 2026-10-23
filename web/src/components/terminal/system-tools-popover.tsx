import { useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Cpu, Network, Settings2, RefreshCw, Search, Loader2, Play, Square, RotateCw, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useOptionalSshWorkspace } from "@/components/ssh-workspace/ssh-workspace"
import { useConfirmDialog } from "@/hooks/use-confirm-dialog"
import { systemInfoApi } from "@/lib/api/system-info"
import type { SystemInfoKind } from "@/lib/system-info"
import { cn } from "@/lib/utils"
import { toast } from "@/components/ui/sonner"
import { quoteShellArgument } from "@/lib/shell-quote"

const definitions = {
  processes: { icon: Cpu, columns: ["pid", "user", "cpu", "memory", "state", "command"] },
  ports: { icon: Network, columns: ["protocol", "state", "local", "peer", "pid", "process"] },
  services: { icon: Settings2, columns: ["name", "load", "active", "state", "description"] },
} as const

function PortProcessAction({ row, disabled, onTerminate }: {
  row: Record<string, string>
  disabled: boolean
  onTerminate: (pid: string) => void
}) {
  const { t } = useTranslation("terminal")
  const pids = (row.pid ?? "").split(",").map((pid) => pid.trim()).filter((pid) => /^[1-9]\d*$/.test(pid))
  const label = t("systemAction_terminate")

  if (pids.length > 1) {
    return (
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7" disabled={disabled} title={t("systemPortChooseProcess")} aria-label={`${label} ${row.local}`}>
            <Square className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {pids.map((pid) => (
            <DropdownMenuItem key={pid} variant="destructive" onSelect={() => onTerminate(pid)}>
              <Square className="size-3.5" />
              {t("systemPortTerminatePid", { pid })}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button variant="ghost" size="icon" className="size-7" disabled={disabled || pids.length === 0} aria-label={`${label} ${row.local}`} onClick={() => onTerminate(pids[0])}>
            <Square className="size-3.5" />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{pids.length === 0 ? t("systemPortNoPid") : t("systemPortTerminatePid", { pid: pids[0] })}</TooltipContent>
    </Tooltip>
  )
}

interface SystemToolsPopoverProps {
  kind: SystemInfoKind
  serverId: string
  sessionLabel: string
  canExecute: boolean
  onExecute: (command: string) => boolean
  onFocusTerminal: () => void
}

export function SystemToolsPopover({ kind, serverId, sessionLabel, canExecute, onExecute, onFocusTerminal }: SystemToolsPopoverProps) {
  const { t } = useTranslation("terminal")
  const workspace = useOptionalSshWorkspace()
  const adapter = workspace?.adapters.apiClient?.systemInfo
  if (workspace?.layout === "desktop" && !adapter) throw new Error("Desktop system tools require a systemInfo adapter")
  const client = adapter ?? systemInfoApi
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const searchRef = useRef<HTMLInputElement>(null)
  const focusTerminal = useRef(false)
  const actionContext = useRef({ serverId, canExecute, onExecute, onFocusTerminal })
  actionContext.current = { serverId, canExecute, onExecute, onFocusTerminal }
  const { confirm, confirmDialog } = useConfirmDialog()
  const { icon: Icon, columns } = definitions[kind]
  const query = useQuery({
    queryKey: ["terminal-system-info", workspace?.layout ?? "web", serverId, kind],
    queryFn: () => client.snapshot(serverId, kind),
    enabled: open && canExecute && !!serverId,
    staleTime: 0,
    retry: false,
    refetchInterval: open && canExecute ? 5000 : false,
  })
  const filtered = (query.data?.rows ?? []).filter((row) => (
    Object.values(row).some((value) => value.toLowerCase().includes(search.trim().toLowerCase()))
  ))

  const runAction = async (row: Record<string, string>, action: "terminate" | "start" | "stop" | "restart", portPid?: string) => {
    const target = action === "terminate" ? (kind === "ports" ? portPid : row.pid) : row.name
    if (!canExecute || !target || (action === "terminate" && !/^[1-9]\d*$/.test(target))) return
    const command = action === "terminate"
      ? `kill -TERM -- ${target}`
      : `systemctl ${action} -- ${quoteShellArgument(target)}`
    if (!await confirm({
      title: t(`systemAction_${action}`),
      description: kind === "ports"
        ? t("systemPortTerminateConfirm", { pid: target, address: row.local, protocol: row.protocol, server: sessionLabel, command })
        : t("systemActionConfirm", { target, server: sessionLabel, command }),
      variant: action === "terminate" || action === "stop" ? "destructive" : "default",
    })) return
    const current = actionContext.current
    if (current.serverId !== serverId || !current.canExecute) return
    if (current.onExecute(command)) {
      focusTerminal.current = true
      setOpen(false)
      current.onFocusTerminal()
    }
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className={cn("h-7 w-7 rounded-md", open && "bg-accent text-accent-foreground")} title={t(`systemTool_${kind}`)} aria-label={t(`systemTool_${kind}`)}>
            <Icon className="size-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={8}
          className="flex w-[860px] max-w-[calc(100vw-24px)] max-h-[var(--radix-popover-content-available-height)] flex-col overflow-hidden p-0"
          aria-label={t(`systemTool_${kind}`)}
          onInteractOutside={(event) => { if (confirmDialog) event.preventDefault() }}
          onOpenAutoFocus={(event) => { event.preventDefault(); searchRef.current?.focus() }}
          onCloseAutoFocus={(event) => {
            if (!focusTerminal.current) return
            event.preventDefault()
            focusTerminal.current = false
            onFocusTerminal()
          }}
        >
          <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
            <Icon className="size-4" />
            <span className="flex-1 text-sm font-medium">{t(`systemTool_${kind}`)}</span>
            <Button variant="ghost" size="icon" className="size-7" disabled={!canExecute || query.isFetching} title={t("common:refresh")} aria-label={t("common:refresh")} onClick={async () => {
              const result = await query.refetch()
              if (result.isError) toast.error(t("systemLoadFailed"))
              else toast.success(t("systemRefreshed"))
            }}><RefreshCw className={cn("size-3.5", query.isFetching && "animate-spin")} /></Button>
            <Button variant="ghost" size="icon" className="size-7" aria-label={t("systemClose")} onClick={() => setOpen(false)}><X className="size-4" /></Button>
          </div>
          <div className="relative m-3 shrink-0">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input ref={searchRef} className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("systemSearch")} aria-label={t("systemSearch")} />
          </div>
          {!canExecute ? <p className="p-6 text-sm text-muted-foreground">{t("systemDisconnected")}</p>
            : query.isPending ? <div className="flex justify-center gap-2 p-8 text-sm" role="status"><Loader2 className="size-4 animate-spin" />{t("common:loading")}</div>
            : query.isError ? <div className="space-y-2 p-4 text-sm" role="alert"><p className="text-destructive">{t("systemLoadFailed")}</p><p className="text-muted-foreground">{t(`systemRequirement_${kind}`)}</p><pre className="whitespace-pre-wrap break-all text-xs">{String(query.error.message)}</pre></div>
            : <div className="min-h-0 max-h-[420px] overflow-auto border-t">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 z-10 bg-popover"><tr>{columns.map((column) => <th key={column} className="whitespace-nowrap border-b px-3 py-2 font-medium">{t(`systemColumn_${column}`)}</th>)}<th className="border-b px-3 py-2">{t("systemActions")}</th></tr></thead>
                <tbody>{filtered.map((row, index) => <tr key={kind === "processes" ? row.pid : kind === "services" ? row.name : index} className="border-b border-border/40 hover:bg-accent/50">
                  {columns.map((column) => <td key={column} className="max-w-[360px] truncate whitespace-nowrap px-3 py-2 font-mono" title={row[column]}>{row[column] || "—"}</td>)}
                  <td className="px-2 py-1">{kind === "ports" ? (
                    <PortProcessAction row={row} disabled={!canExecute} onTerminate={(pid) => void runAction(row, "terminate", pid)} />
                  ) : <div className="flex items-center gap-1">
                    {(kind === "processes" ? ["terminate"] as const : ["start", "stop", "restart"] as const).map((action) => {
                      const ActionIcon = action === "start" ? Play : action === "restart" ? RotateCw : Square
                      return <Button key={action} variant="ghost" size="icon" className="size-7" title={t(`systemAction_${action}`)} aria-label={`${t(`systemAction_${action}`)} ${row.pid ?? row.name}`} onClick={() => void runAction(row, action)}><ActionIcon className="size-3.5" /></Button>
                    })}
                  </div>}</td>
                </tr>)}</tbody>
              </table>
              {filtered.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">{t("systemEmpty")}</p>}
            </div>}
          <div className="shrink-0 space-y-1 border-t px-3 py-2 text-xs text-muted-foreground">
            <p className="truncate" title={sessionLabel}>{t("scriptLibraryTarget", { name: sessionLabel })}</p>
            <p>{t(kind === "ports" ? "systemPortsHint" : "systemRefreshHint")}</p>
            {query.data?.truncated && <p>{t("systemTruncated")}</p>}
          </div>
        </PopoverContent>
      </Popover>
      {confirmDialog}
    </>
  )
}
