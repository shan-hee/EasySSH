import type { Unstable_DirectiveFormatter, Unstable_DirectiveSegment } from "@assistant-ui/core"
import type { AgentServerReference } from "@/lib/ai-agent-types"

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
