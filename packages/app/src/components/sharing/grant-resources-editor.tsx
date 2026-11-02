import { useId, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { ServerScopePicker } from "@/components/servers/server-scope-picker"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { GrantInput, Action } from "@/lib/api/grants"
import type { Server } from "@/lib/server-types"
import type { Script } from "@/lib/script-types"
import { ApprovedScriptsField, GrantPermissionFields } from "./grant-permissions"

type Resource = GrantInput["resources"][number]

// A new server starts with what the grant's landing view needs.
const landingActions: Record<NonNullable<GrantInput["default_content"]>, Action[]> = {
  terminal: ["terminal.connect"],
  files: ["files.list", "files.read", "files.download"],
  monitor: ["monitor.read"],
  docker: ["docker.read"],
  vnc: ["vnc.connect"],
  rdp: ["rdp.connect"],
}

const permissionKey = (resource: Resource) => JSON.stringify([
  [...resource.actions].sort(),
  resource.allow_interactive,
  [...(resource.scripts ?? [])].sort((a, b) => a.script_id.localeCompare(b.script_id)),
])

/**
 * All servers share one permission set; per-server settings are opt-in, and an
 * existing grant whose servers already differ opens per server so nothing is lost.
 */
export function GrantResourcesEditor({
  servers,
  scripts,
  value,
  defaultContent,
  disabled,
  loading,
  onChange,
}: {
  servers: Server[]
  scripts: Script[]
  value: Resource[]
  defaultContent: GrantInput["default_content"]
  disabled: boolean
  loading: boolean
  onChange: (resources: Resource[]) => void
}) {
  const { t } = useTranslation("sharing")
  const interactiveId = useId()
  const [individual, setIndividual] = useState(() => new Set(value.map(permissionKey)).size > 1)
  const [selected, setSelected] = useState(value[0]?.server_id ?? "")
  const active = (individual && value.find((r) => r.server_id === selected)) || value[0]
  const name = (id: string) => {
    const server = servers.find((s) => s.id === id)
    return server?.name || server?.host || id
  }
  const missing = loading ? [] : value.filter((r) => !servers.some((s) => s.id === r.server_id))

  const changeSelection = (serverIds: string[]) => {
    const existing = new Map(value.map((resource) => [resource.server_id, resource]))
    const template: Omit<Resource, "server_id"> = value[0]
      ? { actions: value[0].actions, allow_interactive: value[0].allow_interactive, scripts: value[0].scripts }
      : { actions: landingActions[defaultContent ?? "terminal"], allow_interactive: false }
    onChange(serverIds.map((serverId) => existing.get(serverId) ?? { ...structuredClone(template), server_id: serverId }))
    const added = serverIds.find((id) => !existing.has(id))
    setSelected(added ?? (serverIds.includes(selected) ? selected : serverIds[0] ?? ""))
  }
  const patch = (changes: Partial<Resource>) => {
    if (!active) return
    onChange(value.map((r) => (!individual || r.server_id === active.server_id ? { ...r, ...structuredClone(changes) } : r)))
  }

  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-3">
      <legend className="sr-only">{t("resources")}</legend>
      <ServerScopePicker
        servers={servers}
        value={value.map((resource) => resource.server_id)}
        loading={loading}
        disabled={disabled}
        onChange={changeSelection}
      />
      {missing.length > 0 && (
        <p className="text-xs text-destructive">
          {t("resourceUnavailable")} {missing.map((r) => name(r.server_id)).join(", ")}
        </p>
      )}
      {!active ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t("selectResourceToConfigure")}
        </p>
      ) : (
        <div className="min-w-0 space-y-4 rounded-lg border p-3">
          {value.length > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 text-xs">
              {individual ? (
                <div className="flex min-w-0 flex-wrap gap-1" role="group" aria-label={t("selectedResources")}>
                  {value.map((r) => (
                    <Button
                      key={r.server_id}
                      type="button"
                      size="sm"
                      variant={r.server_id === active.server_id ? "secondary" : "ghost"}
                      aria-pressed={r.server_id === active.server_id}
                      onClick={() => setSelected(r.server_id)}
                    >
                      <span className="max-w-40 truncate">{name(r.server_id)}</span>
                    </Button>
                  ))}
                </div>
              ) : (
                <span className="text-muted-foreground">{t("sameForAll", { count: value.length })}</span>
              )}
              <Button
                type="button"
                size="sm"
                variant="link"
                className="h-auto px-0 text-xs"
                onClick={() => {
                  // Leaving per-server mode applies the server being edited to every server.
                  if (individual) onChange(value.map((r) => ({ ...structuredClone(active), server_id: r.server_id })))
                  setIndividual(!individual)
                }}
              >
                {individual ? t("applyToAll", { name: name(active.server_id) }) : t("setIndividually")}
              </Button>
            </div>
          )}
          <GrantPermissionFields
            value={active.actions}
            disabled={disabled}
            onChange={(actions) => patch({ actions, ...(actions.includes("scripts.execute") ? {} : { scripts: [] }) })}
          />
          {active.actions.includes("scripts.execute") && (
            <ApprovedScriptsField
              value={active.scripts ?? []}
              scripts={scripts}
              disabled={disabled}
              onChange={(allowed) => patch({ scripts: allowed })}
            />
          )}
          <div className="space-y-1 border-t pt-3 text-xs">
            <label htmlFor={interactiveId}>{t("interactive")}</label>
            <Select
              required
              disabled={disabled}
              value={active.allow_interactive === undefined ? "" : String(active.allow_interactive)}
              onValueChange={(choice) => patch({ allow_interactive: choice === "true" })}
            >
              <SelectTrigger id={interactiveId} className="w-full">
                <SelectValue placeholder={t("selectValue")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="false">{t("denyInteractive")}</SelectItem>
                <SelectItem value="true">{t("allowInteractive")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </fieldset>
  )
}
