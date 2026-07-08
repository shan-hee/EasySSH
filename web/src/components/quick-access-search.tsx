
import * as React from "react"
import { Bot, CalendarClock, FileText, FolderOpen, Loader2, Search, Server as ServerIcon, Settings, Terminal } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { useClientAuth } from "@/components/client-auth-provider"
import { serversApi, type Server } from "@/lib/api"
import { cn } from "@/lib/utils"
import { hasAllCapabilities } from "@/shell/runtime/capabilities"
import { useRuntime } from "@/shell/runtime/runtime-provider"
import type { AppCapability, RuntimeProfile } from "@/shell/runtime/types"

const SEARCH_DEBOUNCE_MS = 180

type QuickCommand = {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  profiles?: RuntimeProfile[]
  requiredCapabilities?: AppCapability[]
  adminOnly?: boolean
}

function getServerLabel(server: Server) {
  return server.name || `${server.username}@${server.host}:${server.port}`
}

function getServerTarget(server: Server) {
  return `${server.username}@${server.host}:${server.port}`
}

export function QuickAccessSearch() {
  const navigate = useNavigate()
  const { t } = useTranslation("dashboard")
  const { runtime } = useRuntime()
  const { user } = useClientAuth()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [servers, setServers] = React.useState<Server[]>([])
  const [loading, setLoading] = React.useState(false)

  const commands = React.useMemo<QuickCommand[]>(() => [
    { label: t("quickAccessCommandTerminal"), href: "/dashboard/terminal", icon: Terminal, requiredCapabilities: ["servers", "terminal"] },
    { label: t("quickAccessCommandServers"), href: "/dashboard", icon: ServerIcon, profiles: ["web"], requiredCapabilities: ["servers"] },
    { label: t("quickAccessCommandSftp"), href: "/dashboard/terminal?sftpPicker=1", icon: FolderOpen, requiredCapabilities: ["servers", "terminal", "sftp"] },
    { label: t("quickAccessCommandAi"), href: "/dashboard/ai-assistant", icon: Bot, requiredCapabilities: ["ai"] },
    { label: t("quickAccessCommandScripts"), href: "/dashboard/scripts", icon: FileText, requiredCapabilities: ["scripts"] },
    { label: t("quickAccessCommandSchedules"), href: "/dashboard/automation/schedules", icon: CalendarClock, profiles: ["web"], requiredCapabilities: ["automation"] },
    { label: t("quickAccessCommandSettings"), href: "/dashboard/settings", icon: Settings, profiles: ["web"], requiredCapabilities: ["settings"], adminOnly: true },
  ], [t])

  const isAdmin = user?.role === "admin" || runtime?.principal.role === "owner"

  const visibleCommands = React.useMemo(() => commands.filter((command) => {
    if (command.adminOnly && !isAdmin) {
      return false
    }
    if (command.profiles && (!runtime || !command.profiles.includes(runtime.profile))) {
      return false
    }
    return hasAllCapabilities(runtime, command.requiredCapabilities)
  }), [commands, isAdmin, runtime])

  React.useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const response = await serversApi.list({
          page: 1,
          limit: 8,
          search: query.trim() || undefined,
        })
        if (!cancelled) {
          setServers(Array.isArray(response?.data) ? response.data : [])
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load quick access servers:", error)
          setServers([])
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }, query.trim() ? SEARCH_DEBOUNCE_MS : 0)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, query])

  const navigateTo = React.useCallback((href: string) => {
    setOpen(false)
    setQuery("")
    navigate(href)
  }, [navigate])

  const connectServer = React.useCallback((server: Server) => {
    navigateTo(`/dashboard/terminal?serverId=${encodeURIComponent(server.id)}`)
  }, [navigateTo])

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      setQuery("")
    }
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={() => handleOpenChange(true)}
        className={cn(
          "flex h-8 w-full items-center gap-2 rounded-md border border-input bg-background px-2 text-left text-sm text-muted-foreground shadow-xs outline-none transition-colors",
          "hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
        )}
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{t("quickAccessSearchPlaceholder")}</span>
      </button>

      <CommandDialog open={open} onOpenChange={handleOpenChange} title={t("quickAccessLabel")}>
        <CommandInput
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder={t("quickAccessSearchPlaceholder")}
        />
        <CommandList>
          <CommandEmpty>{loading ? t("quickAccessSearchLoading") : t("quickAccessSearchEmpty")}</CommandEmpty>

          <CommandGroup heading={t("quickAccessSearchServers")}>
            {servers.map((server) => (
              <CommandItem
                key={server.id}
                value={`${getServerLabel(server)} ${getServerTarget(server)} ${server.group ?? ""}`}
                onSelect={() => connectServer(server)}
                className="gap-2"
              >
                <ServerIcon className="h-4 w-4 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{getServerLabel(server)}</span>
                  <span className="block truncate text-xs text-muted-foreground">{getServerTarget(server)}</span>
                </span>
              </CommandItem>
            ))}
            {loading && servers.length === 0 ? (
              <div className="flex items-center gap-2 px-2 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{t("quickAccessSearchLoading")}</span>
              </div>
            ) : null}
          </CommandGroup>

          <CommandGroup heading={t("quickAccessSearchCommands")}>
            {visibleCommands.map((item) => {
              const Icon = item.icon
              return (
                <CommandItem
                  key={item.href}
                  value={`${item.label} ${item.href}`}
                  onSelect={() => navigateTo(item.href)}
                  className="gap-2"
                >
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate">{item.label}</span>
                </CommandItem>
              )
            })}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  )
}
