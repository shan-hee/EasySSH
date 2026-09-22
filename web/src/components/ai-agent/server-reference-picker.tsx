import { useMemo } from "react"
import { Server as ServerIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { Unstable_TriggerAdapter } from "@assistant-ui/core"
import { ComposerTriggerPopover } from "@/components/assistant-ui/elements/composer-trigger-popover.aui"
import type { Server as ManagedServer } from "@/lib/api"
import type { AgentServerReference } from "@/lib/ai-agent-types"
import { getServerDisplayName } from "@/lib/server-utils"
import { matchServerMentionTrigger, mergeServerReferences, serverReferenceFormatter } from "@/lib/ai-agent/server-mentions"

export function ServerReferencePicker({ servers, references, onChange, loading = false, disabled = false, className }: {
  servers: ManagedServer[]
  references: AgentServerReference[]
  onChange: (references: AgentServerReference[]) => void
  loading?: boolean
  disabled?: boolean
  className?: string
}) {
  const { t } = useTranslation("aiAssistant")
  const adapter = useMemo<Unstable_TriggerAdapter>(() => ({
    categories: () => [],
    categoryItems: () => [],
    search: (query) => servers.filter((server) => (
      [getServerDisplayName(server), server.host, server.username, server.group, `${server.username}@${server.host}:${server.port}`, ...(server.tags ?? [])]
        .filter(Boolean).join(" ").toLowerCase().includes(query.trim().toLowerCase())
    )).map((server) => ({
      id: server.id,
      type: "server",
      label: getServerDisplayName(server),
      description: `${server.username}@${server.host}:${server.port} · ${t(server.status === "online" ? "statusOnline" : "statusOffline")}`,
    })),
  }), [servers, t])
  if (disabled) return null
  return <ComposerTriggerPopover
    className={className}
    char="@"
    matcher={matchServerMentionTrigger}
    adapter={adapter}
    isLoading={loading}
    directive={{ formatter: serverReferenceFormatter, onInserted: (item) => {
      const server = servers.find((entry) => entry.id === item.id)
      if (!server) return
      onChange(mergeServerReferences(references, [{ server_id: server.id, name: getServerDisplayName(server), host: server.host, port: server.port, username: server.username }]))
    }}}
    fallbackIcon={ServerIcon}
    aria-label={t("referenceServer")}
    label={t("referenceServer")}
    navigationHint={t("referenceServerNavigationHint")}
    emptyItemsLabel={t("referenceServerNoMatch")}
    emptyCategoriesLabel={t("referenceServerEmpty")}
    loadingLabel={t("referenceServerLoading")}
    backLabel={t("auiBack")}
  />
}
