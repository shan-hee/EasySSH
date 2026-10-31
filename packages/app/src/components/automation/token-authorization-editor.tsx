import { useId, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Check, Minus, Search, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { TokenApprovedScripts, TokenPermissionActions, useActionLabel } from "./token-permission-fields"
import {
  presetPermissions, tokenPresets, tokenResourceLimit,
  type TokenAuthorizationDraft, type TokenPermissions, type TokenPreset,
} from "@/lib/token-authorization"
import { cn } from "@/lib/utils"
import type { Server } from "@/lib/server-types"
import type { Script } from "@/lib/script-types"

const presets = (Object.keys(tokenPresets) as TokenPreset[]).filter(preset => preset !== "custom")

export function TokenAuthorizationEditor({ value, servers, scripts, disabled, loading, onChange }: {
  value: TokenAuthorizationDraft
  servers: Server[]
  scripts: Script[]
  disabled: boolean
  loading: boolean
  onChange: (draft: TokenAuthorizationDraft) => void
}) {
  const { t } = useTranslation("automation")
  const actionLabel = useActionLabel()
  const id = useId()
  const [customizing, setCustomizing] = useState(false)
  const { actions } = value.permissions
  const changePermissions = (permissions: TokenPermissions, preset: TokenPreset = "custom") => onChange({ ...value, preset, permissions })

  return <fieldset disabled={disabled} className="min-w-0 space-y-5">
    <legend className="sr-only">{t("authorization.title")}</legend>
    <section className="space-y-2" aria-labelledby={`${id}-purpose`}>
      <h3 id={`${id}-purpose`} className="text-sm font-medium">{t("authorization.purposeTitle")}</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {presets.map(preset => <label key={preset} className={cn("flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors", value.preset === preset ? "border-primary bg-primary/5" : "hover:bg-muted/50")}>
          <input type="radio" name={`${id}-purpose`} className="mt-1 accent-primary" value={preset} checked={value.preset === preset} disabled={disabled} onChange={() => changePermissions(presetPermissions(preset), preset)} />
          <span className="min-w-0">
            <span className="block text-sm font-medium">{t(`authorization.presets.${preset}.name`)}</span>
            <span className="block text-xs text-muted-foreground">{t(`authorization.presets.${preset}.description`)}</span>
          </span>
        </label>)}
      </div>
      <div className="flex flex-wrap items-center gap-1.5" aria-label={t("authorization.permissions")}>
        {actions.map(action => <Badge key={action} variant="secondary" className="font-normal">{actionLabel(action)}</Badge>)}
        {!actions.length && <span className="text-xs text-muted-foreground">{t("authorization.noPermissions")}</span>}
        <Button type="button" variant="link" size="sm" className="h-auto px-1 text-xs" aria-expanded={customizing} onClick={() => setCustomizing(open => !open)}>
          {customizing ? t("authorization.doneCustomizing") : t("authorization.customize")}
        </Button>
      </div>
      {customizing && <div className="rounded-lg border p-3"><TokenPermissionActions value={value.permissions} disabled={disabled} onChange={permissions => changePermissions(permissions)} /></div>}
      {actions.includes("scripts.execute") && <TokenApprovedScripts value={value.permissions.scripts} scripts={scripts} disabled={disabled} onChange={allowed => changePermissions({ ...value.permissions, scripts: allowed }, value.preset)} />}
    </section>

    <section className="space-y-2" aria-labelledby={`${id}-scope`}>
      <h3 id={`${id}-scope`} className="text-sm font-medium">{t("authorization.scopeTitle")}</h3>
      <ServerScopePicker servers={servers} value={value.serverIds} loading={loading} disabled={disabled} onChange={serverIds => onChange({ ...value, serverIds })} />
    </section>

    {actions.includes("terminal.connect") && <p className="text-xs text-amber-700 dark:text-amber-400">{t("commandWarning")}</p>}
    {actions.includes("scripts.execute") && <p className="text-xs text-amber-700 dark:text-amber-400">{t("authorization.scriptEffects")}</p>}
  </fieldset>
}

function ServerScopePicker({ servers, value, loading, disabled, onChange }: {
  servers: Server[]
  value: string[]
  loading: boolean
  disabled: boolean
  onChange: (serverIds: string[]) => void
}) {
  const { t } = useTranslation("automation")
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
    setLimitError(unique.length > tokenResourceLimit)
    if (unique.length <= tokenResourceLimit) onChange(unique)
  }
  const toggle = (ids: string[]) => apply(ids.every(serverId => selected.has(serverId))
    ? value.filter(serverId => !ids.includes(serverId))
    : [...value, ...ids])
  const serverName = (serverId: string) => {
    const server = byId.get(serverId)
    return server?.name || server?.host || serverId
  }

  return <div className="space-y-2">
    {/* Modal keeps wheel scrolling inside the list while nested in the sheet. */}
    <Popover modal>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled} className="w-full justify-start font-normal text-muted-foreground">
          <Search className="size-4" />
          {loading ? t("authorization.loading") : t("authorization.searchServers")}
          {value.length > 0 && <span className="ml-auto text-foreground">{t("authorization.selectedCount", { count: value.length })}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput placeholder={t("authorization.searchServers")} />
          <CommandList>
            <CommandEmpty>{t("authorization.noServers")}</CommandEmpty>
            {groups.length > 0 && <CommandGroup heading={t("authorization.groups")}>
              {groups.map(([key, group]) => {
                const count = group.ids.filter(serverId => selected.has(serverId)).length
                return <CommandItem key={key} className="gap-2" value={`group:${key}`} keywords={[group.label]} onSelect={() => toggle(group.ids)}>
                  <Mark state={count === group.ids.length ? "all" : count ? "some" : "none"} />
                  <span className="truncate">{group.label}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{t("authorization.groupCount", { count: group.ids.length })}</span>
                </CommandItem>
              })}
            </CommandGroup>}
            <CommandGroup heading={t("authorization.servers")}>
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
    {limitError && <p role="alert" className="text-xs text-destructive">{t("authorization.issues.tooManyServers")}</p>}
    {value.length > 0 && <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto" aria-label={t("authorization.selectedServers")}>
      {value.map(serverId => <Badge key={serverId} variant="secondary" className="max-w-full gap-1 pr-1 font-normal">
        <span className="truncate">{serverName(serverId)}</span>
        <button type="button" disabled={disabled} className="rounded-sm opacity-60 hover:opacity-100" aria-label={t("authorization.removeServer", { name: serverName(serverId) })} onClick={() => apply(value.filter(item => item !== serverId))}>
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
