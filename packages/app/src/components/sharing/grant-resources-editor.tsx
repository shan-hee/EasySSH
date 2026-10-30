import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Plus, Search, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
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
import { ScriptParameterRules } from "./script-parameter-rules"

type Resource = GrantInput["resources"][number]
const pageSize = 8
const actions: Action[] = [
  "terminal.connect",
  "files.list",
  "files.read",
  "files.download",
  "files.upload",
  "files.write",
  "files.delete",
  "monitor.read",
  "docker.read",
  "docker.manage",
  "scripts.execute",
  "ai.use",
  "activity.read",
]
const defaultActions = {
  terminal: "terminal.connect",
  files: "files.list",
  monitor: "monitor.read",
  docker: "docker.read",
} as const

/** Keep resource selection bounded; only the active resource mounts its permission form. */
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
  const [adding, setAdding] = useState(value.length === 0)
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState(value[0]?.server_id ?? "")
  const active = value.find((r) => r.server_id === selected) ?? value[0]
  const activeServer = servers.find((s) => s.id === active?.server_id)
  const candidates = servers.filter(
    (s) =>
      !value.some((r) => r.server_id === s.id) &&
      [s.name, s.host, s.username, s.group].some((text) =>
        text?.toLowerCase().includes(search.trim().toLowerCase()),
      ),
  )
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(candidates.length / pageSize) - 1),
  )
  const patch = (changes: Partial<Resource>) => {
    if (active)
      onChange(
        value.map((r) =>
          r.server_id === active.server_id ? { ...r, ...changes } : r,
        ),
      )
  }
  const name = (id: string) => {
    const server = servers.find((s) => s.id === id)
    return server?.name || server?.host || id
  }
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-3">
      <legend className="sr-only">{t("resources")}</legend>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {t("selectedResourceCount", { count: value.length })}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={adding}
          onClick={() => setAdding((open) => !open)}
        >
          <Plus className="size-4" />
          {adding ? t("finishSelection") : t("addResources")}
        </Button>
      </div>
      {adding && (
        <div className="space-y-2 rounded-lg border p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input
              className="pl-9"
              aria-label={t("searchResources")}
              placeholder={t("searchResources")}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(0)
              }}
            />
          </div>
          <div
            className="max-h-52 space-y-1 overflow-y-auto"
            aria-label={t("availableResources")}
          >
            {candidates
              .slice(currentPage * pageSize, (currentPage + 1) * pageSize)
              .map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{s.name || s.host}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {s.username}@{s.host}:{s.port}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t("addNamedResource", {
                      name: s.name || s.host,
                    })}
                    onClick={() => {
                      onChange([
                        ...value,
                        {
                          server_id: s.id,
                          actions: [
                            defaultActions[defaultContent ?? "terminal"],
                          ],
                          allow_interactive: false,
                        },
                      ])
                      setSelected(s.id)
                    }}
                  >
                    {t("addResource")}
                  </Button>
                </div>
              ))}
            {!candidates.length && (
              <p className="py-4 text-center text-xs text-muted-foreground">
                {loading ? t("loadingResources") : t("noMatchingResources")}
              </p>
            )}
          </div>
          {candidates.length > pageSize && (
            <div className="flex items-center justify-end gap-2">
              <span className="text-xs text-muted-foreground">
                {currentPage + 1} / {Math.ceil(candidates.length / pageSize)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                {t("previous")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={(currentPage + 1) * pageSize >= candidates.length}
                onClick={() => setPage(currentPage + 1)}
              >
                {t("next")}
              </Button>
            </div>
          )}
        </div>
      )}
      {!active ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t("selectResourceToConfigure")}
        </p>
      ) : (
        <div className="grid min-w-0 gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-2">
            <p className="text-xs text-muted-foreground">
              {t("selectedResources")}
            </p>
            <div
              className="flex max-h-40 gap-1 overflow-auto sm:max-h-72 sm:flex-col"
              role="group"
              aria-label={t("selectedResources")}
            >
              {value.map((r) => (
                <Button
                  key={r.server_id}
                  type="button"
                  size="sm"
                  variant={
                    r.server_id === active.server_id ? "secondary" : "ghost"
                  }
                  className="shrink-0 justify-start text-left sm:w-full"
                  aria-pressed={r.server_id === active.server_id}
                  title={name(r.server_id)}
                  onClick={() => setSelected(r.server_id)}
                >
                  <span className="truncate">{name(r.server_id)}</span>
                </Button>
              ))}
            </div>
          </div>
          <div className="min-w-0 space-y-3 sm:border-l sm:pl-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="break-words text-sm font-medium">
                  {name(active.server_id)}
                </h3>
                {activeServer ? (
                  <p className="break-all text-xs text-muted-foreground">
                    {activeServer.username}@{activeServer.host}:
                    {activeServer.port}
                  </p>
                ) : (
                  <p className="text-xs text-destructive">
                    {loading ? t("loadingResources") : t("resourceUnavailable")}
                  </p>
                )}
              </div>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={t("removeNamedResource", {
                  name: name(active.server_id),
                })}
                onClick={() =>
                  onChange(
                    value.filter((r) => r.server_id !== active.server_id),
                  )
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {actions.map((action) => (
                <label className="flex items-center gap-2 text-xs" key={action}>
                  <Checkbox
                    disabled={disabled}
                    checked={active.actions.includes(action)}
                    onCheckedChange={(checked) =>
                      patch({
                        actions:
                          checked === true
                            ? [...active.actions, action]
                            : active.actions.filter((a) => a !== action),
                        ...(action === "scripts.execute" && checked !== true
                          ? { scripts: [] }
                          : {}),
                      })
                    }
                  />
                  {t(`actions.${action}`)}
                </label>
              ))}
            </div>
            <label className="block space-y-1 text-xs">
              {t("interactive")}
              <Select
                required
                disabled={disabled}
                value={
                  active.allow_interactive === undefined
                    ? ""
                    : String(active.allow_interactive)
                }
                onValueChange={(value) =>
                  patch({ allow_interactive: value === "true" })
                }
              >
                <SelectTrigger className="w-full" aria-label={t("interactive")}>
                  <SelectValue placeholder={t("selectValue")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="false">{t("denyInteractive")}</SelectItem>
                  <SelectItem value="true">{t("allowInteractive")}</SelectItem>
                </SelectContent>
              </Select>
            </label>
            {active.actions.includes("scripts.execute") && (
              <div className="space-y-2 border-t pt-3">
                <p className="text-xs font-medium">{t("approvedScripts")}</p>
                <div className="max-h-32 space-y-2 overflow-y-auto">
                  {scripts.map((script) => (
                    <label
                      className="flex items-center gap-2 text-xs"
                      key={script.id}
                    >
                      <Checkbox
                        disabled={disabled}
                        checked={
                          active.scripts?.some(
                            (s) => s.script_id === script.id,
                          ) ?? false
                        }
                        onCheckedChange={(checked) =>
                          patch({
                            scripts:
                              checked === true
                                ? [
                                    ...(active.scripts ?? []),
                                    {
                                      script_id: script.id,
                                      version: script.version,
                                      parameters: {},
                                    },
                                  ]
                                : active.scripts?.filter(
                                    (s) => s.script_id !== script.id,
                                  ),
                          })
                        }
                      />
                      <span className="truncate">{script.name}</span>
                    </label>
                  ))}
                </div>
                {active.scripts?.map((allowed) => (
                  <div key={allowed.script_id} className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs">
                        {scripts.find((s) => s.id === allowed.script_id)
                          ?.name ?? allowed.script_id}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          patch({
                            scripts: active.scripts?.filter(
                              (s) => s.script_id !== allowed.script_id,
                            ),
                          })
                        }
                      >
                        {t("forget")}
                      </Button>
                    </div>
                    {scripts.some(
                      (s) =>
                        s.id === allowed.script_id &&
                        s.version !== allowed.version,
                    ) && (
                      <div className="space-y-1">
                        <p className="text-xs text-amber-600">
                          {t("scriptChanged")}
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            patch({
                              scripts: active.scripts?.map((s) =>
                                s.script_id === allowed.script_id
                                  ? {
                                      ...s,
                                      version: scripts.find(
                                        (script) => script.id === s.script_id,
                                      )!.version,
                                    }
                                  : s,
                              ),
                            })
                          }
                        >
                          {t("updateScriptVersion")}
                        </Button>
                      </div>
                    )}
                    <ScriptParameterRules
                      value={allowed.parameters ?? {}}
                      onChange={(parameters) =>
                        patch({
                          scripts: active.scripts?.map((s) =>
                            s.script_id === allowed.script_id
                              ? { ...s, parameters }
                              : s,
                          ),
                        })
                      }
                    />
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  {t("scriptVersions")}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </fieldset>
  )
}
