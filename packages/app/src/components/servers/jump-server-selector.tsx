import { useEffect, useId, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Check, ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { serversApi } from "@/lib/api/servers"
import type { Server } from "@/lib/server-types"
import { getErrorMessage } from "@/lib/error-utils"
import { cn } from "@/lib/utils"

export type JumpServerApi = Pick<typeof serversApi, "list">

export function JumpServerSelector({ api, value, onChange, serverId }: {
  api: JumpServerApi
  value: string
  onChange: (value: string) => void
  serverId?: string
}) {
  const { t } = useTranslation("servers")
  const id = useId()
  const [open, setOpen] = useState(false)
  const [servers, setServers] = useState<Server[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError("")
    // Load from the current instance independently of the main list's filters
    // and pagination, otherwise valid jump hosts disappear on another page.
    const load = async () => {
      const items: Server[] = []
      for (let page = 1; active; page++) {
        const result = await api.list({ page, limit: 100 })
        items.push(...result.data)
        if (!result.data.length || items.length >= result.total) break
      }
      if (active) setServers(items)
    }
    void load().catch(err => {
      if (active) setError(getErrorMessage(err, t("jumpServerLoadFailed")))
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [api, reload, t])

  const candidates = useMemo(() => {
    const byId = new Map(servers.map(server => [server.id, server]))
    return servers.filter(server => {
      const seen = new Set<string>()
      let next: Server | undefined = server
      while (next) {
        if (next.id === serverId || seen.has(next.id)) return false
        seen.add(next.id)
        next = next.jump_server_id ? byId.get(next.jump_server_id) : undefined
      }
      return true
    })
  }, [servers, serverId])
  const selected = candidates.find(server => server.id === value)
  const select = (next: string) => {
    onChange(next)
    setOpen(false)
  }

  return <div className="space-y-2">
    <Label htmlFor={id}>{t("quickFormJumpServerLabel")}</Label>
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" aria-expanded={open} disabled={loading} className="w-full justify-between font-normal">
          <span className="min-w-0 truncate">
            {selected
              ? `${selected.name || selected.host} (${selected.username}@${selected.host}:${selected.port})`
              : value ? t("jumpServerUnavailable", { id: value }) : t("quickFormJumpServerNone")}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput placeholder={t("jumpServerSearchPlaceholder")} aria-label={t("jumpServerSearchPlaceholder")} />
          <CommandList>
            <CommandEmpty>{t("jumpServerNoMatch")}</CommandEmpty>
            <CommandGroup>
              <CommandItem value="none" keywords={[t("quickFormJumpServerNone")]} onSelect={() => select("")}>
                <Check className={cn("size-4 shrink-0", value ? "opacity-0" : "opacity-100")} />
                {t("quickFormJumpServerNone")}
              </CommandItem>
              {candidates.map(server => <CommandItem key={server.id} value={server.id} keywords={[server.name, server.host, server.username, String(server.port)].filter((text): text is string => !!text)} onSelect={() => select(server.id)}>
                <Check className={cn("size-4 shrink-0", value === server.id ? "opacity-100" : "opacity-0")} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{server.name || server.host}</span>
                  <span className="block truncate text-xs text-muted-foreground">{server.username}@{server.host}:{server.port}</span>
                </span>
              </CommandItem>)}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
    <p className="text-xs text-muted-foreground">{loading ? t("jumpServerLoading") : t("jumpServerHint")}</p>
    {!loading && !error && candidates.length === 0 && <p className="text-xs text-muted-foreground">{t("jumpServerEmpty")}</p>}
    {error && <div role="alert" className="text-sm text-destructive">
      {error}<Button type="button" variant="link" disabled={loading} onClick={() => setReload(n => n + 1)}>{t("retryLoad")}</Button>
    </div>}
  </div>
}
