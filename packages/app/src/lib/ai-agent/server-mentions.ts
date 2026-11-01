import type { Unstable_DirectiveFormatter, Unstable_DirectiveSegment } from "@assistant-ui/core"
import type { AgentServerReference } from "@/lib/ai-agent-types"
import type { Server } from "@/lib/server-types"
import { getServerDisplayName } from "@/lib/server-utils"

// Only selecting a candidate creates an ID-bound reference. Emails and SSH
// targets stay ordinary text.
export function matchServerMentionTrigger(text: string, triggerChar: string, cursorPosition: number) {
  const beforeCursor = text.slice(0, cursorPosition)
  const offset = beforeCursor.lastIndexOf(triggerChar)
  if (offset < 0 || (offset > 0 && !/\s/u.test(beforeCursor[offset - 1]!))) return null
  const query = beforeCursor.slice(offset + triggerChar.length)
  if (/[\s@]/u.test(query)) return null
  return { query, offset, endOffset: cursorPosition }
}

const RECENT_SERVER_REFERENCES_KEY = "easyssh:ai:recent-server-references"
const MAX_RECENT_SERVER_REFERENCES = 8
const VISIBLE_RECENT_SERVER_REFERENCES = 5

/** 最近通过 @ 引用的服务器 ID，新的在前；只保存在当前设备。 */
export function readRecentServerReferences(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_SERVER_REFERENCES_KEY) || "[]")
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").slice(0, MAX_RECENT_SERVER_REFERENCES) : []
  } catch { return [] }
}

export function rememberServerReference(serverId: string) {
  const ids = [serverId, ...readRecentServerReferences().filter((id) => id !== serverId)].slice(0, MAX_RECENT_SERVER_REFERENCES)
  try {
    localStorage.setItem(RECENT_SERVER_REFERENCES_KEY, JSON.stringify(ids))
  } catch { /* Mentions still work when preferences cannot be stored. */ }
  return ids
}

export type ServerMentionSection = "recent" | "others" | "ungrouped" | `group:${string}`
export interface ServerMentionCandidate { server: Server; section?: ServerMentionSection; matchedTag?: string }

/**
 * 无查询时最近引用在前，其余按分组排列；有查询时按名称、地址、分组、标签的匹配程度排序，
 * 同等匹配下最近引用的优先。分组内保持传入顺序。
 */
export function rankServerMentionCandidates(servers: Server[], query: string, recentIds: string[]): ServerMentionCandidate[] {
  const recentRank = new Map(recentIds.map((id, index) => [id, index]))
  const byRecent = (left: Server, right: Server) => (recentRank.get(left.id) ?? recentIds.length) - (recentRank.get(right.id) ?? recentIds.length)
  const needle = query.trim().toLowerCase()
  if (!needle) {
    const recent = servers.filter((server) => recentRank.has(server.id)).sort(byRecent).slice(0, VISIBLE_RECENT_SERVER_REFERENCES)
    const shown = new Set(recent.map((server) => server.id))
    const rest = servers.filter((server) => !shown.has(server.id))
    const groups = [...new Set(rest.map((server) => server.group ?? ""))]
      .sort((left, right) => !left ? 1 : !right ? -1 : left.localeCompare(right))
    const grouped = groups.some(Boolean)
    if (!grouped && recent.length === 0) return rest.map((server) => ({ server }))
    return [
      ...recent.map((server) => ({ server, section: "recent" as const })),
      ...groups.flatMap((group) => rest
        .filter((server) => (server.group ?? "") === group)
        .map((server): ServerMentionCandidate => ({ server, section: group ? `group:${group}` : grouped ? "ungrouped" : "others" }))),
    ]
  }
  const matches: (ServerMentionCandidate & { score: number })[] = []
  for (const server of servers) {
    const name = getServerDisplayName(server).toLowerCase()
    const address = `${server.username}@${server.host}:${server.port}`.toLowerCase()
    const matchedTag = server.tags?.find((tag) => tag.toLowerCase().includes(needle))
    const score = name.startsWith(needle) ? 0
      : name.includes(needle) ? 1
      : server.host.toLowerCase().startsWith(needle) || address.startsWith(needle) ? 2
      : address.includes(needle) ? 3
      : server.group?.toLowerCase().includes(needle) ? 4
      : matchedTag ? 5
      : -1
    if (score >= 0) matches.push({ server, score, ...(score === 5 ? { matchedTag } : {}) })
  }
  return matches
    .sort((left, right) => left.score - right.score || byRecent(left.server, right.server))
    .map(({ server, matchedTag }) => (matchedTag ? { server, matchedTag } : { server }))
}

export function mergeServerReferences(current: AgentServerReference[], added: AgentServerReference[]) {
  return Array.from(new Map([...current, ...added].map((ref) => [ref.server_id, ref])).values())
}

export function readServerReferences(value: unknown): AgentServerReference[] {
  if (!Array.isArray(value)) return []
  return value.filter((ref): ref is AgentServerReference => (
    ref != null && typeof ref === "object"
    && typeof ref.server_id === "string" && ref.server_id !== ""
    && typeof ref.name === "string" && typeof ref.host === "string"
    && typeof ref.port === "number" && typeof ref.username === "string"
  ))
}

// Encode delimiters so arbitrary server names cannot split or forge a token.
// The same formatter owns editor serialization and submission parsing.
export const serverReferenceFormatter: Unstable_DirectiveFormatter = {
  serialize: (item) => `:server[${encodeURIComponent(item.label)}]{name=${encodeURIComponent(item.id)}}`,
  parse: (text): readonly Unstable_DirectiveSegment[] => {
    const segments: Unstable_DirectiveSegment[] = []
    let last = 0
    for (const match of text.matchAll(/:server\[([^\]\n]+)\]\{name=([^}\n]+)\}/gu)) {
      let label: string, id: string
      try {
        label = decodeURIComponent(match[1]!)
        id = decodeURIComponent(match[2]!)
      } catch {
        // An incomplete escape typed or pasted by the user remains text.
        continue
      }
      if (match.index > last) segments.push({ kind: "text", text: text.slice(last, match.index) })
      segments.push({ kind: "mention", type: "server", label, id })
      last = match.index + match[0].length
    }
    if (last < text.length) segments.push({ kind: "text", text: text.slice(last) })
    return segments
  },
}

export function parseServerReferenceText(text: string, snapshots: AgentServerReference[]) {
  const references: AgentServerReference[] = []
  let content = ""
  for (const segment of serverReferenceFormatter.parse(text)) {
    if (segment.kind === "text") {
      content += segment.text
      continue
    }
    const snapshot = snapshots.find((ref) => ref.server_id === segment.id)
    references.push({
      // A copied token still carries identity. The backend resolves it or
      // rejects it; never silently downgrade an unavailable target to text.
      server_id: segment.id, name: segment.label, host: "", port: 0, username: "",
      ...snapshot, label: segment.label, offset: content.length,
    })
    content += `@${segment.label}`
  }
  return { content, references }
}

export function splitServerReferenceText(content: string, references: AgentServerReference[]) {
  const segments: { text: string; reference?: AgentServerReference }[] = []
  let last = 0
  for (const ref of [...references].sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0))) {
    const offset = ref.offset
    const text = `@${ref.label}`
    if (offset === undefined || !ref.label || offset < last || content.slice(offset, offset + text.length) !== text) continue
    if (offset > last) segments.push({ text: content.slice(last, offset) })
    segments.push({ text, reference: ref })
    last = offset + text.length
  }
  if (last < content.length) segments.push({ text: content.slice(last) })
  return segments
}

export function serializeServerReferenceText(content: string, references: AgentServerReference[]) {
  return splitServerReferenceText(content, references).map(({ text, reference }) => reference
    ? serverReferenceFormatter.serialize({ id: reference.server_id, type: "server", label: reference.label! })
    : text).join("")
}
