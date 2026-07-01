import { useCallback, useEffect, useState } from "react"
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
  onSelect: (server: Server) => boolean
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
}: SftpServerPickerDialogProps) {
  const { t } = useTranslation("terminal")
  const [query, setQuery] = useState("")
  const [servers, setServers] = useState<Server[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !ready) {
      return
    }

    let cancelled = false
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const response = await serverApi.list({
          page: 1,
          limit: 20,
          search: query.trim() || undefined,
        })
        if (!cancelled) {
          setServers(normalizeServerList(response))
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load SFTP server picker list:", error)
          setServers([])
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
  }, [open, query, ready, serverApi])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    onOpenChange(nextOpen)
    if (!nextOpen) {
      setQuery("")
      setServers([])
      setLoading(false)
    }
  }, [onOpenChange])

  const handleSelect = useCallback((server: Server) => {
    if (onSelect(server)) {
      handleOpenChange(false)
    }
  }, [handleOpenChange, onSelect])

  return (
    <CommandDialog open={open} onOpenChange={handleOpenChange} title={t("sftpPickerTitle")}>
      <CommandInput
        autoFocus
        value={query}
        onValueChange={setQuery}
        placeholder={t("sftpPickerPlaceholder")}
      />
      <CommandList>
        <CommandEmpty>{loading ? t("sftpPickerLoading") : t("sftpPickerEmpty")}</CommandEmpty>

        <CommandGroup heading={t("sftpPickerServers")}>
          {servers.map((server) => (
            <CommandItem
              key={server.id}
              value={`${getServerDisplayName(server)} ${getServerTarget(server)} ${server.group ?? ""}`}
              onSelect={() => handleSelect(server)}
              className="gap-2"
            >
              <ServerIcon className="h-4 w-4 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{getServerDisplayName(server)}</span>
                <span className="block truncate font-mono text-xs text-muted-foreground">
                  {getServerTarget(server)}
                </span>
              </span>
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
