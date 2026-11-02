import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Check, Minus, Search, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import type { Server } from "@/lib/server-types"

/**
 * Searchable multi-select of servers. Picking a group adds its current members
 * only; servers added to the group later are not included.
 */
export function ServerScopePicker({ servers, value, loading = false, disabled = false, limit = 100, onChange }: {
  servers: Server[]
  value: string[]
  loading?: boolean
  disabled?: boolean
  limit?: number
  onChange: (serverIds: string[]) => void
}) {
  const { t } = useTranslation("common")
  const [limitError, setLimitError] = useState(false)
  const selected = new Set(value)
  const byId = useMemo(() => new Map(servers.map(server => [server.id, server])), [servers])
  const groups = useMemo(() => {
    const result = new Map<string, { label: string; ids: string[] }>()
    for (const server of servers) {
      const key = server.group_id || server.group
      if (!key) continue
      const group = result.get(key) ?? { label: server.group || key, ids: [] }
      group.ids.push(server.id)
      result.set(key, group)
    }
    return [...result.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label))
  }, [servers])
  const apply = (ids: string[]) => {
    const unique = [...new Set(ids)]
    setLimitError(unique.length > limit)
    if (unique.length <= limit) onChange(unique)
  }
  const toggle = (ids: string[]) => apply(ids.every(serverId => selected.has(serverId))
    ? value.filter(serverId => !ids.includes(serverId))
    : [...value, ...ids])
  const serverName = (serverId: string) => {
    const server = byId.get(serverId)
    return server?.name || server?.host || serverId
  }

  return <div className="space-y-2">
    {/* Keep the list inside the dialog's focus/scroll boundary without a second modal lock. */}
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled} className="w-full justify-start font-normal text-muted-foreground">
          {loading ? <Spinner className="text-muted-foreground" /> : <Search className="size-4" />}
          {t("serverPicker.search")}
          {value.length > 0 && <span className="ml-auto text-foreground">{t("serverPicker.selectedCount", { count: value.length })}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent portalled={false} align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput placeholder={t("serverPicker.search")} />
          <CommandList>
            <CommandEmpty>{t("serverPicker.noMatch")}</CommandEmpty>
            {groups.length > 0 && <CommandGroup heading={t("serverPicker.groups")}>
              {groups.map(([key, group]) => {
                const count = group.ids.filter(serverId => selected.has(serverId)).length
                return <CommandItem key={key} className="gap-2" value={`group:${key}`} keywords={[group.label]} onSelect={() => toggle(group.ids)}>
                  <Mark state={count === group.ids.length ? "all" : count ? "some" : "none"} />
                  <span className="truncate">{group.label}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{t("serverPicker.groupCount", { count: group.ids.length })}</span>
                </CommandItem>
              })}
            </CommandGroup>}
            <CommandGroup heading={t("serverPicker.servers")}>
              {servers.map(server => <CommandItem key={server.id} className="gap-2" value={server.id} keywords={[server.name, server.host, server.username, server.group, ...(server.tags ?? [])].filter((text): text is string => !!text)} onSelect={() => toggle([server.id])}>
                <Mark state={selected.has(server.id) ? "all" : "none"} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{server.name || server.host}</span>
                  <span className="block truncate text-xs text-muted-foreground">{server.username}@{server.host}:{server.port}{server.group ? ` · ${server.group}` : ""}</span>
                </span>
              </CommandItem>)}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
    {limitError && <p role="alert" className="text-xs text-destructive">{t("serverPicker.tooMany", { count: limit })}</p>}
    {value.length > 0 && <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto" aria-label={t("serverPicker.selected")}>
      {value.map(serverId => <Badge key={serverId} variant="secondary" className="max-w-full gap-1 pr-1 font-normal">
        <span className="truncate">{serverName(serverId)}</span>
        <button type="button" disabled={disabled} className="rounded-sm opacity-60 hover:opacity-100" aria-label={t("serverPicker.remove", { name: serverName(serverId) })} onClick={() => apply(value.filter(item => item !== serverId))}>
          <X className="size-3" />
        </button>
      </Badge>)}
    </div>}
  </div>
}

function Mark({ state }: { state: "all" | "some" | "none" }) {
  return <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-sm border border-primary", state === "none" ? "opacity-50" : "bg-primary text-primary-foreground")}>
    {state === "all" && <Check className="size-3" />}
    {state === "some" && <Minus className="size-3" />}
  </span>
}
