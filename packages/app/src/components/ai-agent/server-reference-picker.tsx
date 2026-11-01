import { useCallback, useMemo, useState } from "react"
import { Check } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { Unstable_TriggerAdapter, Unstable_TriggerItem } from "@assistant-ui/core"
import { ComposerTriggerPopover, TriggerHighlight } from "@/components/assistant-ui/elements/composer-trigger-popover.aui"
import { Kbd } from "@/components/ui/kbd"
import type { Server as ManagedServer } from "@/lib/api"
import type { AgentServerReference } from "@/lib/ai-agent-types"
import { getServerDisplayName } from "@/lib/server-utils"
import { cn } from "@/lib/utils"
import {
  matchServerMentionTrigger,
  mergeServerReferences,
  rankServerMentionCandidates,
  readRecentServerReferences,
  rememberServerReference,
  serverReferenceFormatter,
  type ServerMentionSection,
} from "@/lib/ai-agent/server-mentions"

export function ServerReferencePicker({ servers, references, onChange, loading = false, disabled = false, className }: {
  servers: ManagedServer[]
  references: AgentServerReference[]
  onChange: (references: AgentServerReference[]) => void
  loading?: boolean
  disabled?: boolean
  className?: string
}) {
  const { t } = useTranslation("aiAssistant")
  const [recentIds, setRecentIds] = useState(readRecentServerReferences)
  const sectionLabel = useCallback((section: ServerMentionSection) => section.startsWith("group:")
    ? section.slice("group:".length)
    : t(section === "recent" ? "referenceServerRecent" : section === "ungrouped" ? "referenceServerUngrouped" : "referenceServerOthers"), [t])
  const adapter = useMemo<Unstable_TriggerAdapter>(() => {
    const referenced = new Set(references.map((reference) => reference.server_id))
    return {
      categories: () => [],
      categoryItems: () => [],
      search: (query) => rankServerMentionCandidates(servers, query, recentIds).map(({ server, section, matchedTag }) => ({
        id: server.id,
        type: "server",
        label: getServerDisplayName(server),
        description: `${server.username}@${server.host}:${server.port}`,
        metadata: {
          ...(section ? { section: sectionLabel(section) } : {}),
          // 分组标题已经说明分组时，条目不再重复显示。
          group: section?.startsWith("group:") ? "" : server.group ?? "",
          tag: matchedTag ?? "",
          online: server.status === "online",
          referenced: referenced.has(server.id),
        },
      })),
    }
  }, [recentIds, references, sectionLabel, servers])
  const renderItem = useCallback((item: Unstable_TriggerItem, query: string) => {
    const metadata = item.metadata ?? {}
    const group = typeof metadata.group === "string" ? metadata.group : ""
    const tag = typeof metadata.tag === "string" ? metadata.tag : ""
    const status = t(metadata.online ? "statusOnline" : "statusOffline")
    return <>
      <span title={status} className={cn("size-2 shrink-0 rounded-full", metadata.online ? "bg-status-connected" : "bg-muted-foreground/40")}>
        <span className="sr-only">{status}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium" title={item.label}><TriggerHighlight text={item.label} query={query} /></span>
          {group && <span className="max-w-32 shrink-0 truncate rounded bg-muted px-1.5 text-[11px] leading-4 text-muted-foreground" title={group}><TriggerHighlight text={group} query={query} /></span>}
          {tag && <span className="max-w-32 shrink-0 truncate rounded border px-1.5 text-[11px] leading-4 text-muted-foreground" title={tag}>#<TriggerHighlight text={tag} query={query} /></span>}
        </span>
        <span className="mt-0.5 block truncate font-mono text-xs leading-4 text-muted-foreground" title={item.description}>
          <TriggerHighlight text={item.description ?? ""} query={query} />
        </span>
      </span>
      {metadata.referenced === true && <span title={t("referenceServerReferenced")} className="shrink-0 text-primary"><Check aria-hidden className="size-3.5" /><span className="sr-only">{t("referenceServerReferenced")}</span></span>}
    </>
  }, [t])
  if (disabled) return null
  return <ComposerTriggerPopover
    className={cn("w-96", className)}
    char="@"
    matcher={matchServerMentionTrigger}
    adapter={adapter}
    isLoading={loading}
    directive={{ formatter: serverReferenceFormatter, onInserted: (item) => {
      const server = servers.find((entry) => entry.id === item.id)
      if (!server) return
      setRecentIds(rememberServerReference(server.id))
      onChange(mergeServerReferences(references, [{ server_id: server.id, name: getServerDisplayName(server), host: server.host, port: server.port, username: server.username }]))
    }}}
    renderItem={renderItem}
    aria-label={t("referenceServer")}
    label={t("referenceServer")}
    navigationHint={<span className="flex items-center gap-3">
      <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd>{t("referenceServerHintMove")}</span>
      <span className="flex items-center gap-1"><Kbd>Enter</Kbd>{t("referenceServerHintPick")}</span>
      <span className="flex items-center gap-1"><Kbd>Esc</Kbd>{t("referenceServerHintClose")}</span>
    </span>}
    emptyItemsLabel={t(servers.length ? "referenceServerNoMatch" : "referenceServerEmpty")}
    loadingLabel={t("referenceServerLoading")}
    backLabel={t("auiBack")}
  />
}
