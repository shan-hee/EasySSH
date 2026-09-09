import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { readSftpConnectionHistory } from "@/lib/sftp-connection-history"
import { Loader2, Server as ServerIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import type { Server, ServerListResponse } from "@/lib/server-types"
import { getServerDisplayName } from "@/lib/server-utils"

const SFTP_SERVER_SEARCH_DEBOUNCE_MS = 180

export interface SftpServerPickerApi {
  list: (params?: {
    page?: number
    limit?: number
    group?: string
    search?: string
  }) => Promise<ServerListResponse | Server[]>
}

export interface SftpServerPickerDialogProps {
  open: boolean
  ready: boolean
  serverApi: SftpServerPickerApi
  onOpenChange: (open: boolean) => void
  onSelect: (server: Server, initialPath: string) => boolean
  currentServerId?: string
  openedServerIds?: string[]
}

const getServerTarget = (server: Server) => (
  `${server.username}@${server.host}:${server.port}`
)

function normalizeServerList(response: ServerListResponse | Server[]) {
  return Array.isArray(response) ? response : response.data
}

export function SftpServerPickerDialog({
  open,
  ready,
  serverApi,
  onOpenChange,
  onSelect,
  currentServerId,
  openedServerIds = [],
}: SftpServerPickerDialogProps) {
  const { t } = useTranslation("terminal")
  const [query, setQuery] = useState("")
  const [servers, setServers] = useState<Server[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const [history, setHistory] = useState(readSftpConnectionHistory)
  const [directoryMode, setDirectoryMode] = useState("last")
  const [customPath, setCustomPath] = useState("/")
  useEffect(() => { if (open) setHistory(readSftpConnectionHistory()) }, [open])
  const orderedServers = useMemo(() => [...servers].sort((a, b) => {
    const rank = (id: string) => id === currentServerId ? -1 : history.findIndex(item => item.serverId === id)
    const aRank = rank(String(a.id)), bRank = rank(String(b.id))
    if (String(a.id) === currentServerId) return -1
    if (String(b.id) === currentServerId) return 1
    return (aRank < 0 ? Infinity : aRank) - (bRank < 0 ? Infinity : bRank)
  }), [servers, currentServerId, history])

  useEffect(() => {
    if (!open || !ready) {
      return
    }

    setLoading(true)
    setFailed(false)
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const response = await serverApi.list({
          page: 1,
          limit: 100,
          search: query.trim() || undefined,
        })
        if (!cancelled) {
          setServers(normalizeServerList(response))
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load SFTP server picker list:", error)
          setServers([])
          setFailed(true)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }, query.trim() ? SFTP_SERVER_SEARCH_DEBOUNCE_MS : 0)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, query, ready, serverApi, retry])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    onOpenChange(nextOpen)
    if (!nextOpen) {
      setQuery("")
      setServers([])
      setLoading(false)
    }
  }, [onOpenChange])

  const handleSelect = useCallback((server: Server) => {
    const initialPath = directoryMode === "home" ? "~" : directoryMode === "custom" ? customPath.trim() : history.find(item => item.serverId === String(server.id))?.path ?? "~"
    if (!initialPath.startsWith("/") && initialPath !== "~") return
    if (onSelect(server, initialPath)) {
      handleOpenChange(false)
    }
  }, [handleOpenChange, onSelect, customPath, directoryMode, history])

  return (
    <CommandDialog open={open} onOpenChange={handleOpenChange} title={t("sftpPickerTitle")} dismissOnEscape showTitle shouldFilter={false}>
      <CommandInput
        autoFocus
        value={query}
        onValueChange={setQuery}
        placeholder={t("sftpPickerPlaceholder")}
      />
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs">
        <label htmlFor="sftp-start-directory">{t("sftpStartDirectory")}</label>
        <select id="sftp-start-directory" className="rounded border bg-popover px-2 py-1" value={directoryMode} onChange={event => setDirectoryMode(event.target.value)}>
          <option value="last">{t("sftpLastDirectory")}</option>
          <option value="home">{t("sftpHomeDirectory")}</option>
          <option value="custom">{t("sftpCustomDirectory")}</option>
        </select>
        {directoryMode === "custom" && <Input aria-label={t("sftpCustomDirectory")} className="h-7 min-w-0 flex-1 font-mono" value={customPath} onChange={event => setCustomPath(event.target.value)} />}
        {directoryMode === "custom" && !customPath.trim().startsWith("/") && <span role="alert" className="text-destructive">{t("sftpAbsolutePathRequired")}</span>}
      </div>
      {failed && <div role="alert" className="flex items-center justify-between gap-2 p-4 text-sm"><span>{t("sftpPickerFailed")}</span><Button variant="outline" size="sm" onClick={() => setRetry(value => value + 1)}>{t("sftpPickerRetry")}</Button></div>}
      <CommandList>
        {!failed && <CommandEmpty>{loading ? t("sftpPickerLoading") : t("sftpPickerEmpty")}</CommandEmpty>}

        <CommandGroup heading={t("sftpPickerServers")}>
          {orderedServers.map((server) => (
            <CommandItem
              key={server.id}
              value={`${getServerDisplayName(server)} ${getServerTarget(server)} ${server.group ?? ""}`}
              disabled={loading || (directoryMode === "custom" && !customPath.trim().startsWith("/"))}
              onSelect={() => handleSelect(server)}
              className="gap-2"
            >
              <ServerIcon className="h-4 w-4 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{getServerDisplayName(server)}</span>
                <span className="block truncate font-mono text-xs text-muted-foreground">
                  {getServerTarget(server)}{server.group ? ` · ${server.group}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{String(server.id) === currentServerId ? t("sftpCurrentServer") : openedServerIds.includes(String(server.id)) ? t("sftpAlreadyOpen") : history.some(item => item.serverId === String(server.id)) ? t("sftpRecentlyUsed") : ""}</span>
            </CommandItem>
          ))}
          {loading && servers.length === 0 ? (
            <div className="flex items-center gap-2 px-2 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{t("sftpPickerLoading")}</span>
            </div>
          ) : null}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
