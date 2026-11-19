import { useRef, useState, type KeyboardEvent } from "react"
import { useTranslation } from "react-i18next"
import { Textarea } from "@/components/ui/textarea"
import type { AgentServerReference } from "@/lib/ai-agent-types"
import type { Server } from "@/lib/server-types"
import { matchServerMentionTrigger, parseServerReferenceText, rankServerMentionCandidates, serializeServerReferenceText, splitServerReferenceText } from "@/lib/ai-agent/server-mentions"
import { getServerDisplayName } from "@/lib/server-utils"
import { cn } from "@/lib/utils"

const MAX_LENGTH = 4000
const MAX_CANDIDATES = 8

// Every "@label" of a picked server is a reference, wherever editing moved it.
function relink(content: string, references: AgentServerReference[]) {
  const linked: AgentServerReference[] = []
  const labels = [...new Map(references.map(ref => [ref.label!, ref])).values()].sort((a, b) => b.label!.length - a.label!.length)
  const taken: [number, number][] = []
  for (const ref of labels) {
    const token = `@${ref.label}`
    for (let offset = content.indexOf(token); offset >= 0; offset = content.indexOf(token, offset + 1)) {
      if (offset > 0 && !/\s/u.test(content[offset - 1]!)) continue
      if (taken.some(([start, end]) => offset < end && offset + token.length > start)) continue
      taken.push([offset, offset + token.length])
      linked.push({ ...ref, offset })
    }
  }
  return linked
}

/** Plain textarea whose "@" picks one of the given servers; the value uses the assistant's mention tokens. */
export function SystemPromptEditor({ id, value, servers, disabled, onChange }: {
  id: string
  value: string
  servers: Server[]
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const { t } = useTranslation("chatConnections")
  const textarea = useRef<HTMLTextAreaElement>(null)
  const [initial] = useState(() => parseServerReferenceText(value, []))
  const [content, setContent] = useState(initial.content)
  const [references, setReferences] = useState(initial.references)
  const [trigger, setTrigger] = useState<ReturnType<typeof matchServerMentionTrigger>>(null)
  const [active, setActive] = useState(0)
  const candidates = trigger ? rankServerMentionCandidates(servers, trigger.query, []).slice(0, MAX_CANDIDATES) : []
  const linked = relink(content, references)

  const update = (text: string, refs: AgentServerReference[], caret: number) => {
    setContent(text)
    setReferences(refs)
    setTrigger(matchServerMentionTrigger(text, "@", caret))
    setActive(0)
    onChange(serializeServerReferenceText(text, relink(text, refs)))
  }
  const pick = (server: Server) => {
    if (!trigger) return
    let label = getServerDisplayName(server)
    // Two servers may share a display name; the label must name exactly one.
    if (references.some(ref => ref.label === label && ref.server_id !== server.id)) label = `${label}(${server.host})`
    const inserted = `@${label} `
    const text = content.slice(0, trigger.offset) + inserted + content.slice(trigger.endOffset)
    const caret = trigger.offset + inserted.length
    const refs = [...references.filter(ref => ref.server_id !== server.id || ref.label !== label), { server_id: server.id, name: getServerDisplayName(server), host: server.host, port: server.port, username: server.username, label }]
    update(text, refs, caret)
    setTrigger(null)
    requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(caret, caret) })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!trigger) return
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setTrigger(null); return }
    if (!candidates.length) return
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      setActive(index => (index + (event.key === "ArrowDown" ? 1 : candidates.length - 1)) % candidates.length)
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault()
      pick(candidates[Math.min(active, candidates.length - 1)]!.server)
    }
  }
  const caretMoved = () => { const el = textarea.current; if (el) setTrigger(matchServerMentionTrigger(el.value, "@", el.selectionStart)) }

  // The backdrop repeats the text with references highlighted; both share one grid cell and metrics.
  const metrics = "min-h-28 whitespace-pre-wrap break-words px-3 py-2 text-base md:text-sm"
  return <div className="relative">
    <div className="grid rounded-md">
      <div aria-hidden className={cn(metrics, "pointer-events-none border border-transparent text-transparent [grid-area:1/1]")}>
        {splitServerReferenceText(content, linked).map(({ text, reference }, index) => reference
          ? <mark key={index} className="rounded-sm bg-primary/15 text-transparent">{text}</mark>
          : <span key={index}>{text}</span>)}
        {"​"}
      </div>
      <Textarea ref={textarea} id={id} value={content} disabled={disabled} placeholder={t("systemPromptPlaceholder")}
        className={cn(metrics, "resize-none bg-transparent dark:bg-transparent [grid-area:1/1]")}
        role="combobox" aria-expanded={!!trigger} aria-autocomplete="list" aria-controls={`${id}-servers`}
        onChange={event => update(event.target.value, references, event.target.selectionStart)}
        onKeyDown={onKeyDown} onClick={caretMoved} onKeyUp={event => { if (event.key.startsWith("Arrow") && !trigger) caretMoved() }}
        onBlur={() => setTrigger(null)} />
    </div>
    {trigger && <ul id={`${id}-servers`} role="listbox" className="absolute inset-x-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
      {candidates.length === 0 && <li className="px-2 py-1.5 text-sm text-muted-foreground">{t(servers.length ? "mentionNoMatch" : "mentionEmpty")}</li>}
      {candidates.map(({ server }, index) => <li key={server.id} role="option" aria-selected={index === active}
        className={cn("flex cursor-pointer items-baseline gap-2 rounded-sm px-2 py-1.5 text-sm", index === active && "bg-accent text-accent-foreground")}
        onMouseDown={event => { event.preventDefault(); pick(server) }} onMouseEnter={() => setActive(index)}>
        <span className="truncate font-medium">{getServerDisplayName(server)}</span>
        <span className="truncate font-mono text-xs text-muted-foreground">{server.username}@{server.host}:{server.port}</span>
      </li>)}
    </ul>}
    <p className="mt-1.5 flex justify-between gap-3 text-xs text-muted-foreground">
      <span>{t("systemPromptHelp")}</span>
      <span className={cn("shrink-0 tabular-nums", content.length > MAX_LENGTH && "text-destructive")}>{t("systemPromptCount", { count: content.length })}</span>
    </p>
  </div>
}

export function systemPromptValid(value: string, serverIds: string[]) {
  const { content, references } = parseServerReferenceText(value, [])
  return content.length <= MAX_LENGTH && references.every(ref => serverIds.includes(ref.server_id))
}
