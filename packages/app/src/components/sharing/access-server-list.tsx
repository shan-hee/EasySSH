import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Activity, Container, FolderOpen, Monitor, MoreHorizontal, Terminal, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { SERVER_GRID_CLASSNAME, getServerItemClassName, ServerConnectionSummary } from "@/components/servers/server-connection-item"
import { ServerConnectionToolbar, type ServerViewMode } from "@/components/servers/server-connection-toolbar"
import { ServerSystemIcon } from "@/components/servers/server-system-icon"
import type { AccessResource } from "@/lib/api/grants"
import { cn } from "@/lib/utils"
import { ApprovedScripts } from "./approved-scripts"

export const accessModeActions = {
  terminal: "terminal.connect", files: "files.list", monitor: "monitor.read",
  docker: "docker.read", vnc: "vnc.connect", rdp: "rdp.connect",
} as const
export type AccessResourceMode = keyof typeof accessModeActions
const modeIcons = { terminal: Terminal, files: FolderOpen, monitor: Activity, docker: Container, vnc: Monitor, rdp: Monitor }

/** Desktop server-list presentation, backed only by this grant's resources. */
export function AccessServerList({ resources, defaultContent, mode, opening, onClearMode, onOpen }: {
  resources: AccessResource[]
  defaultContent: string
  mode: AccessResourceMode | null
  opening: boolean
  onClearMode: () => void
  onOpen: (resource: AccessResource, mode: AccessResourceMode) => void
}) {
  const { t } = useTranslation("sharing")
  const [search, setSearch] = useState("")
  const [viewMode, setViewMode] = useState<ServerViewMode>("grid")
  const available = resources.filter(resource => !mode || resource.actions.includes(accessModeActions[mode]))
  const visible = available.filter(resource => [resource.name, resource.host, resource.username].some(value => value.toLowerCase().includes(search.trim().toLowerCase())))

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center bg-background px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className={cn("flex min-h-0 w-full flex-1 flex-col gap-3 transition-[max-width] duration-200", viewMode === "grid" ? "max-w-6xl" : "max-w-3xl")}>
        <ServerConnectionToolbar
          search={search}
          onSearchChange={setSearch}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          total={resources.length}
          onGroupChange={onClearMode}
          actions={mode && <Button variant="outline" size="sm" onClick={onClearMode}>{t(mode)}<X className="size-3.5" /></Button>}
        />
        <div className="min-h-0 flex-1 overflow-y-auto pr-1 scrollbar-custom">
          <div className={viewMode === "grid" ? SERVER_GRID_CLASSNAME : "space-y-2"}>
            {visible.map(resource => {
              const modes = (Object.keys(accessModeActions) as AccessResourceMode[])
                .filter(item => resource.actions.includes(accessModeActions[item]))
                .sort((a, b) => Number(b === (mode ?? defaultContent)) - Number(a === (mode ?? defaultContent)))
              const primary = modes[0]
              const Icon = primary ? modeIcons[primary] : Terminal
              return (
                <article key={resource.id} className={getServerItemClassName(viewMode, false)}>
                  <button
                    type="button"
                    className="col-span-2 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 sm:flex-1"
                    disabled={resource.paused || opening || !primary}
                    onDoubleClick={() => primary && onOpen(resource, primary)}
                    onClick={event => { if (event.detail === 0 && primary) onOpen(resource, primary) }}
                    aria-label={t("openResource", { name: resource.name || resource.host })}
                    title={resource.paused ? t("paused") : t("doubleClickResource")}
                  >
                    <ServerConnectionSummary server={resource} icon={<ServerSystemIcon server={resource} />} />
                  </button>
                  <div className={cn("flex shrink-0 items-center justify-end gap-1", viewMode === "list" && "col-start-2 sm:col-start-auto")}>
                    {resource.paused ? <span className="text-xs text-muted-foreground" title={t("paused")}>{t("resourcePaused")}</span> : <>
                      {primary && <Button variant="ghost" size="icon-sm" disabled={opening} onClick={() => onOpen(resource, primary)} title={t(primary)} aria-label={t("openResourceMode", { name: resource.name || resource.host, mode: t(primary) })}><Icon className="size-3.5" /></Button>}
                      {modes.length > 1 && <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" disabled={opening} title={t("resourceActions")} aria-label={t("resourceActions")}><MoreHorizontal className="size-3.5" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {modes.map(item => { const ModeIcon = modeIcons[item]; return <DropdownMenuItem key={item} onSelect={() => onOpen(resource, item)}><ModeIcon className="size-4" />{t(item)}</DropdownMenuItem> })}
                        </DropdownMenuContent>
                      </DropdownMenu>}
                      {resource.actions.includes("scripts.execute") && <ApprovedScripts serverId={resource.id} compact />}
                    </>}
                  </div>
                </article>
              )
            })}
          </div>
          {visible.length === 0 && <p className="py-12 text-center text-sm text-muted-foreground">{t("noResources")}</p>}
        </div>
      </div>
    </div>
  )
}
