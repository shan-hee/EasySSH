
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react"
import {
  Check,
  ChevronDown,
  Copy,
  FileText,
  FolderOpen,
  Loader2,
  Pencil,
  Server,
  ShieldAlert,
  Terminal,
  Trash2,
  X,
} from "lucide-react"
import {
  getToolName,
  isReasoningUIPart,
  isTextUIPart,
  isToolUIPart,
  type DynamicToolUIPart,
  type ToolUIPart,
  type UIMessage,
} from "ai"
import { useStickToBottomContext } from "use-stick-to-bottom"

import { AgentEmptyState, AgentNoticeCard } from "@/components/ai-agent/agent-notice"
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message"
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning"
import { ToolCodeBlock, ToolInput } from "@/components/ai-elements/tool"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { type AssistantLoadingState, type TimelineTranslate } from "@/lib/ai-agent/timeline-utils"
import { cn } from "@/lib/utils"

type AgentToolPart = ToolUIPart | DynamicToolUIPart
type AgentMessagePart = UIMessage["parts"][number]
type RenderableMessagePart = Exclude<AgentMessagePart, AgentToolPart>
type MessageRenderSegment =
  | { type: "part"; part: RenderableMessagePart; index: number }
  | { type: "tool-group"; parts: AgentToolPart[]; startIndex: number }

const MESSAGE_RENDER_BATCH = 50
const MESSAGE_RENDER_STEP = 50
const TOOL_COLLAPSIBLE_CONTENT_STYLE = {
  contain: "layout paint style",
  willChange: "height, opacity",
} satisfies CSSProperties

interface AgentAIElementsTimelineProps {
  messages: UIMessage[]
  tText: TimelineTranslate
  onUpdateUserMessage?: (messageId: string, content: string) => boolean | Promise<boolean>
  onDeleteUserMessage?: (messageId: string) => boolean | Promise<boolean>
  assistantLoadingState?: AssistantLoadingState
  emptyDescription?: string
  compact?: boolean
  className?: string
}

function getPartKey(message: UIMessage, part: AgentMessagePart, index: number) {
  if ("id" in part && typeof part.id === "string") {
    return `${message.id}:${part.type}:${part.id}`
  }
  if (isToolUIPart(part)) {
    return `${message.id}:${part.type}:${part.toolCallId}`
  }
  return `${message.id}:${part.type}:${index}`
}

function getDataMessage(part: AgentMessagePart, key: string) {
  if (!part.type.startsWith("data-") || !("data" in part)) {
    return ""
  }

  const data = part.data
  if (!data || typeof data !== "object") {
    return ""
  }

  const value = (data as Record<string, unknown>)[key]
  return typeof value === "string" ? value : ""
}

function getMessageText(message: UIMessage) {
  return message.parts
    .map((part) => (isTextUIPart(part) ? part.text : ""))
    .join("")
}

function hasRenderableContent(message: UIMessage) {
  return message.parts.some((part) => {
    if (isTextUIPart(part)) {
      return part.text.trim() !== ""
    }
    if (isReasoningUIPart(part) || isToolUIPart(part)) {
      return true
    }
    if (part.type === "file") {
      return true
    }
    if (part.type === "data-error") {
      return getDataMessage(part, "message").trim() !== ""
    }
    if (part.type === "data-tool-status") {
      return getDataMessage(part, "text").trim() !== ""
    }
    return false
  })
}

async function copyTextToClipboard(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Some desktop WebView/browser contexts expose clipboard but reject writes.
    }
  }

  if (typeof document === "undefined") {
    return
  }

  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.left = "-9999px"
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand("copy")
  document.body.removeChild(textarea)
}

function toolOutput(part: AgentToolPart) {
  return part.state === "output-available" ? part.output : undefined
}

function toolError(part: AgentToolPart) {
  return part.state === "output-error" ? part.errorText : undefined
}

function isToolPending(state: AgentToolPart["state"]) {
  return state !== "output-available" && state !== "output-error" && state !== "output-denied"
}

export function getAgentToolActivity(messages: UIMessage[]) {
  let hasToolParts = false
  let hasActiveTools = false

  for (const message of messages) {
    for (const part of message.parts) {
      if (!isToolUIPart(part)) {
        continue
      }
      hasToolParts = true
      if (isToolPending(part.state)) {
        hasActiveTools = true
      }
    }
  }

  return { hasActiveTools, hasToolParts }
}

function translateWithFallback(
  tText: TimelineTranslate,
  key: string,
  values: Record<string, string | number | Date> | undefined,
  fallback: string
) {
  const translated = tText(key, values)
  return translated && translated !== key ? translated : fallback
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function getStringValue(input: unknown, key: string) {
  const value = asRecord(input)[key]
  return typeof value === "string" ? value : ""
}

function getToolDisplayName(part: AgentToolPart) {
  const metadata = asRecord(part.toolMetadata)
  const displayName = metadata.displayName
  if (typeof displayName === "string" && displayName.trim()) {
    return displayName
  }
  if (typeof part.title === "string" && part.title.trim()) {
    return part.title
  }
  return getToolName(part)
}

function getToolInput(part: AgentToolPart) {
  return "input" in part ? part.input : {}
}

function stringifyOutput(output: unknown) {
  if (output === undefined || output === null) {
    return ""
  }
  if (typeof output === "string") {
    return output
  }
  try {
    return JSON.stringify(output, null, 2)
  } catch {
    return String(output)
  }
}

function extractFirstCodeFence(value: string) {
  const match = value.match(/```[^\n`]*\n([\s\S]*?)```/)
  return match ? match[1].trimEnd() : ""
}

function stripKnownToolPrefixes(toolName: string, value: string, input: unknown) {
  const fenced = extractFirstCodeFence(value)
  if (fenced) {
    return fenced
  }

  if (toolName === "execute_command") {
    return value
      .replace(/^\u547d\u4ee4\u6267\u884c\u6210\u529f:\s*/u, "")
      .replace(/^Command executed successfully:\s*/u, "")
      .trim()
  }

  if (toolName === "read_file") {
    const path = getStringValue(input, "path")
    const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return value
      .replace(new RegExp(`^\\u6587\\u4ef6\\u5185\\u5bb9 \\(${escapedPath}\\):\\s*`, "u"), "")
      .replace(/^\u6587\u4ef6\u5185\u5bb9 \([^)]+\):\s*/u, "")
      .replace(/^File content \([^)]+\):\s*/u, "")
      .trim()
  }

  return value.trim()
}

function getToolTone(toolName: string) {
  if (toolName === "execute_command") {
    return {
      icon: Terminal,
      labelKey: "toolKindShell",
      fallbackLabel: "Shell",
      className: "border-sky-500/20 bg-sky-500/5",
      iconClassName: "text-sky-500",
    }
  }
  if (toolName === "list_directory" || toolName === "create_directory") {
    return {
      icon: FolderOpen,
      labelKey: "toolKindDirectory",
      fallbackLabel: "Directory",
      className: "border-amber-500/20 bg-amber-500/5",
      iconClassName: "text-amber-500",
    }
  }
  if (toolName === "read_file" || toolName === "write_file" || toolName === "delete_file") {
    return {
      icon: FileText,
      labelKey: "toolKindFile",
      fallbackLabel: "File",
      className: "border-emerald-500/20 bg-emerald-500/5",
      iconClassName: "text-emerald-500",
    }
  }
  if (toolName === "list_servers" || toolName === "get_server_info" || toolName === "get_system_info") {
    return {
      icon: Server,
      labelKey: "toolKindServer",
      fallbackLabel: "Server",
      className: "border-violet-500/20 bg-violet-500/5",
      iconClassName: "text-violet-500",
    }
  }
  return {
    icon: Terminal,
    labelKey: "toolKindOutput",
    fallbackLabel: "Output",
    className: "border-border/60 bg-muted/30",
    iconClassName: "text-muted-foreground",
  }
}

function isJsonLike(toolName: string, text: string) {
  const trimmed = text.trim()
  return toolName === "get_server_info" ||
    trimmed.startsWith("{") ||
    trimmed.startsWith("[")
}

function ToolSemanticOutput({
  compact,
  errorText,
  input,
  output,
  tText,
  toolName,
}: {
  compact?: boolean
  errorText?: string
  input: unknown
  output: unknown
  tText: TimelineTranslate
  toolName: string
}) {
  const rawText = errorText || stringifyOutput(output)
  if (!rawText) {
    return null
  }

  const tone = getToolTone(toolName)
  const ToneIcon = tone.icon
  const content = stripKnownToolPrefixes(toolName, rawText, input)
  const isJsonOutput = isJsonLike(toolName, content)
  const title = errorText
    ? translateWithFallback(tText, "eventErrorTitle", undefined, "Error")
    : translateWithFallback(tText, "taskResult", undefined, "Result")
  const label = translateWithFallback(tText, tone.labelKey, undefined, tone.fallbackLabel)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-muted-foreground text-xs uppercase tracking-wide">
        <ToneIcon className={cn("size-3.5", tone.iconClassName)} />
        <span className="font-medium">{title}</span>
        {!errorText && <span className="normal-case tracking-normal text-muted-foreground/70">{label}</span>}
      </div>
      <div
        className={cn(
          "overflow-hidden rounded-md border text-xs",
          errorText ? "border-destructive/25 bg-destructive/10 text-destructive" : tone.className
        )}
      >
        {isJsonOutput ? (
          <ToolCodeBlock
            code={content}
            language="json"
          />
        ) : (
          <pre className={cn(
            "max-h-96 overflow-auto whitespace-pre-wrap break-words p-3 font-mono leading-5",
            compact && "max-h-72 text-[11px] leading-4"
          )}>
            {content}
          </pre>
        )}
      </div>
    </div>
  )
}

function ToolStateIndicator({
  state,
  tText,
}: {
  state: AgentToolPart["state"]
  tText: TimelineTranslate
}) {
  if (state === "output-available") {
    const label = tText("taskStatusSucceeded")
    return (
      <span className="shrink-0 text-emerald-600" title={label} aria-label={label}>
        <Check className="size-3.5" />
      </span>
    )
  }
  if (state === "output-error") {
    const label = tText("taskStatusFailed")
    return (
      <span className="shrink-0 text-destructive" title={label} aria-label={label}>
        <X className="size-3.5" />
      </span>
    )
  }
  if (state === "output-denied") {
    const label = tText("taskStatusCancelled")
    return (
      <span className="shrink-0 text-amber-600" title={label} aria-label={label}>
        <X className="size-3.5" />
      </span>
    )
  }
  if (state === "approval-requested") {
    const label = tText("taskStatusWaitingConfirm")
    return (
      <span className="shrink-0 text-amber-600" title={label} aria-label={label}>
        <ShieldAlert className="size-3.5" />
      </span>
    )
  }
  if (state === "approval-responded") {
    const label = tText("confirmationResolved")
    return (
      <span className="shrink-0 text-blue-600" title={label} aria-label={label}>
        <Check className="size-3.5" />
      </span>
    )
  }

  const label = state === "input-streaming" ? tText("taskStatusQueued") : tText("taskStatusRunning")
  return (
    <span className="shrink-0 text-muted-foreground" title={label} aria-label={label}>
      <Loader2 className="size-3.5 animate-spin" />
    </span>
  )
}

function ToolCollapsibleContent({
  children,
  contentClassName,
}: {
  children: ReactNode
  contentClassName?: string
}) {
  return (
    <CollapsibleContent
      className="min-w-0 max-w-full w-full overflow-hidden"
      style={TOOL_COLLAPSIBLE_CONTENT_STYLE}
    >
      <div className={contentClassName}>{children}</div>
    </CollapsibleContent>
  )
}

function ToolPartView({
  part,
  tText,
  compact,
  grouped = false,
  open,
  onOpenChange,
}: {
  part: AgentToolPart
  tText: TimelineTranslate
  compact?: boolean
  grouped?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const { stopScroll } = useStickToBottomContext()
  const input = getToolInput(part)
  const toolName = getToolName(part)
  const tone = getToolTone(toolName)
  const ToolIcon = tone.icon

  return (
    <Collapsible
      defaultOpen={false}
      open={open}
      onOpenChange={(nextOpen) => {
        stopScroll()
        onOpenChange?.(nextOpen)
      }}
      className={cn(
        "group/tool not-prose min-w-0 max-w-full w-full",
        grouped && "pl-1",
        compact && "text-xs"
      )}
    >
      <CollapsibleTrigger className="flex min-w-0 w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left transition-[background-color,color,box-shadow] duration-150 hover:bg-muted/75 hover:ring-1 hover:ring-inset hover:ring-border/70 focus-visible:bg-muted/75 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/60 dark:hover:bg-muted/60">
        <ToolIcon className={cn("size-3.5 shrink-0", tone.iconClassName)} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="truncate font-medium text-sm leading-5">
              {getToolDisplayName(part)}
            </div>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/tool:rotate-180" />
            <ToolStateIndicator state={part.state} tText={tText} />
          </div>
        </div>
      </CollapsibleTrigger>
      <ToolCollapsibleContent
        contentClassName={cn("space-y-3 px-3 pb-3 pt-1", compact && "pb-2.5")}
      >
        <ToolInput input={input ?? {}} />
        <ToolSemanticOutput
          compact={compact}
          errorText={toolError(part)}
          input={input}
          output={toolOutput(part)}
          tText={tText}
          toolName={toolName}
        />

        {part.state === "output-denied" && (
          <AgentNoticeCard tone="warning" size="sm">
            {"approval" in part && part.approval?.reason
              ? part.approval.reason
              : tText("rejectAction")}
          </AgentNoticeCard>
        )}
      </ToolCollapsibleContent>
    </Collapsible>
  )
}

function MessagePartView({
  part,
  tText,
  compact,
}: {
  part: AgentMessagePart
  tText: TimelineTranslate
  compact?: boolean
}) {
  if (isTextUIPart(part)) {
    if (!part.text.trim()) {
      return null
    }
    return (
      <MessageResponse className={cn("text-sm leading-6 break-words", compact && "text-xs leading-5")}>
        {part.text}
      </MessageResponse>
    )
  }

  if (isReasoningUIPart(part)) {
    return (
      <Reasoning isStreaming={part.state === "streaming"} defaultOpen={part.state === "streaming"}>
        <ReasoningTrigger
          getThinkingMessage={(isStreaming) => (
            isStreaming ? tText("thinkingLabel") : tText("thinkingProcess")
          )}
        />
        <ReasoningContent>{part.text}</ReasoningContent>
      </Reasoning>
    )
  }

  if (isToolUIPart(part)) {
    return (
      <ToolPartView
        part={part}
        tText={tText}
        compact={compact}
      />
    )
  }

  if (part.type === "file") {
    if (part.mediaType.startsWith("image/")) {
      return (
        <figure className="terminal-ai-glass-card max-w-md overflow-hidden rounded-lg border border-border/70 bg-muted/20">
          <img
            src={part.url}
            alt={part.filename || tText("attachedImage")}
            className="max-h-[28rem] w-full object-contain"
          />
          {part.filename && (
            <figcaption className="border-t border-border/60 px-3 py-1.5 text-xs text-muted-foreground">
              {part.filename}
            </figcaption>
          )}
        </figure>
      )
    }
    return (
      <a
        href={part.url}
        download={part.filename}
        className="terminal-ai-glass-card inline-flex items-center gap-2 rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-xs hover:bg-muted/60"
      >
        <FileText className="size-4" />
        <span>{part.filename || tText("attachedFile")}</span>
      </a>
    )
  }

  if (part.type === "data-tool-status") {
    const text = getDataMessage(part, "text")
    if (!text) {
      return null
    }
    return (
      <div className="terminal-ai-glass-card inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        <span>{text}</span>
      </div>
    )
  }

  if (part.type === "data-error") {
    const message = getDataMessage(part, "message")
    if (!message) {
      return null
    }
    return (
      <AgentNoticeCard tone="error" size={compact ? "sm" : "md"}>
        {message}
      </AgentNoticeCard>
    )
  }

  return null
}

function createMessageRenderSegments(message: UIMessage): MessageRenderSegment[] {
  const segments: MessageRenderSegment[] = []
  let currentTools: AgentToolPart[] = []
  let toolStartIndex = -1

  const flushTools = () => {
    if (currentTools.length === 0) {
      return
    }
    segments.push({
      type: "tool-group",
      parts: currentTools,
      startIndex: toolStartIndex,
    })
    currentTools = []
    toolStartIndex = -1
  }

  message.parts.forEach((part, index) => {
    if (part.type === "step-start") {
      return
    }

    if (isToolUIPart(part)) {
      if (currentTools.length === 0) {
        toolStartIndex = index
      }
      currentTools.push(part)
      return
    }

    flushTools()
    segments.push({ type: "part", part: part as RenderableMessagePart, index })
  })

  flushTools()
  return segments
}

function ToolGroupView({
  compact,
  parts,
  tText,
}: {
  compact?: boolean
  parts: AgentToolPart[]
  tText: TimelineTranslate
}) {
  const { stopScroll } = useStickToBottomContext()
  const [groupOpen, setGroupOpen] = useState(false)
  const [openToolIds, setOpenToolIds] = useState<Set<string>>(() => new Set())
  const completedCount = parts.filter((part) => part.state === "output-available").length
  const pendingCount = parts.filter((part) => isToolPending(part.state)).length

  const setToolOpen = (toolCallId: string, open: boolean) => {
    setOpenToolIds((current) => {
      const next = new Set(current)
      if (open) {
        next.add(toolCallId)
      } else {
        next.delete(toolCallId)
      }
      return next
    })
  }

  if (parts.length === 1) {
    const part = parts[0]
    return (
      <ToolPartView
        part={part}
        tText={tText}
        compact={compact}
        open={openToolIds.has(part.toolCallId)}
        onOpenChange={(open) => {
          setToolOpen(part.toolCallId, open)
          // Keep the user's state when a later tool turns this into a group.
          setGroupOpen(open)
        }}
      />
    )
  }

  return (
    <Collapsible
      open={groupOpen}
      onOpenChange={(nextOpen) => {
        stopScroll()
        setGroupOpen(nextOpen)
      }}
      className="group/tool-group not-prose min-w-0 max-w-full w-full"
    >
      <CollapsibleTrigger className="flex min-w-0 w-full items-center gap-3 rounded-sm px-2.5 py-2 text-left transition-[background-color,color,box-shadow] duration-150 hover:bg-muted/75 hover:ring-1 hover:ring-inset hover:ring-border/70 focus-visible:bg-muted/75 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/60 dark:hover:bg-muted/60">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">
              {tText("toolCallGroupTitle", { count: parts.length })}
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/tool-group:rotate-180" />
            {pendingCount > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-yellow-500/30 px-2 py-0.5 text-[11px] text-yellow-700 dark:text-yellow-300">
                <Loader2 className="size-3 animate-spin" />
                {pendingCount}
              </span>
            ) : (
              <span className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                {completedCount}/{parts.length}
              </span>
            )}
          </div>
        </div>
      </CollapsibleTrigger>
      <ToolCollapsibleContent contentClassName="space-y-0.5 pl-2 pt-0.5">
        {parts.map((part) => (
          <ToolPartView
            key={part.toolCallId}
            part={part}
            tText={tText}
            compact={compact}
            grouped
            open={openToolIds.has(part.toolCallId)}
            onOpenChange={(open) => setToolOpen(part.toolCallId, open)}
          />
        ))}
      </ToolCollapsibleContent>
    </Collapsible>
  )
}

function ChatMessage({
  message,
  tText,
  onUpdateUserMessage,
  onDeleteUserMessage,
  compact,
}: {
  message: UIMessage
  tText: TimelineTranslate
  onUpdateUserMessage?: (messageId: string, content: string) => boolean | Promise<boolean>
  onDeleteUserMessage?: (messageId: string) => boolean | Promise<boolean>
  compact?: boolean
}) {
  const messageText = getMessageText(message)
  const isUserMessage = message.role === "user"
  const hasToolParts = message.parts.some(isToolUIPart)
  const [isEditing, setIsEditing] = useState(false)
  const [editDraft, setEditDraft] = useState(messageText)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!isEditing) {
      setEditDraft(messageText)
    }
  }, [isEditing, messageText])

  useEffect(() => {
    if (!copied) {
      return
    }

    const timer = window.setTimeout(() => setCopied(false), 1400)
    return () => window.clearTimeout(timer)
  }, [copied])

  if (!hasRenderableContent(message)) {
    return null
  }

  const actionDisabled = isSaving || isDeleting
  const canEdit = isUserMessage && Boolean(onUpdateUserMessage)
  const canDelete = isUserMessage && Boolean(onDeleteUserMessage)

  const startEditing = () => {
    if (!canEdit || actionDisabled) {
      return
    }
    setEditDraft(messageText)
    setIsEditing(true)
  }

  const cancelEditing = () => {
    if (actionDisabled) {
      return
    }
    setEditDraft(messageText)
    setIsEditing(false)
  }

  const submitEditing = async () => {
    if (!onUpdateUserMessage || actionDisabled) {
      return
    }

    const nextContent = editDraft.trim()
    if (!nextContent) {
      return
    }

    setIsSaving(true)
    try {
      const updated = await onUpdateUserMessage(message.id, nextContent)
      if (updated) {
        setIsEditing(false)
      }
    } finally {
      setIsSaving(false)
    }
  }

  const handleEditKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault()
      cancelEditing()
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault()
      void submitEditing()
    }
  }

  const copyMessage = async () => {
    if (!messageText.trim() || actionDisabled) {
      return
    }

    await copyTextToClipboard(messageText)
    setCopied(true)
  }

  const deleteMessage = async () => {
    if (!onDeleteUserMessage || actionDisabled) {
      return
    }

    setIsDeleting(true)
    try {
      await onDeleteUserMessage(message.id)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Message from={message.role} className={compact ? "max-w-full" : "max-w-[90%]"}>
      <MessageContent
        className={cn(
          message.role === "user" && "whitespace-pre-wrap break-words leading-6",
          hasToolParts && "w-full",
          compact && "text-xs"
        )}
      >
        {isEditing ? (
          <textarea
            autoFocus
            value={editDraft}
            onChange={(event) => setEditDraft(event.target.value)}
            onKeyDown={handleEditKeyDown}
            wrap="soft"
            className={cn(
              "terminal-ai-glass-editor min-h-24 min-w-0 w-[34rem] max-w-full resize-y rounded-md border border-border/70 bg-background/85 px-3 py-2 text-sm leading-6 break-words whitespace-pre-wrap text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/30",
              compact && "min-h-20 text-xs leading-5"
            )}
            disabled={actionDisabled}
          />
        ) : (
          createMessageRenderSegments(message).map((segment) => (
            segment.type === "tool-group" ? (
              <ToolGroupView
                key={`${message.id}:tools:${segment.parts[0]?.toolCallId ?? segment.startIndex}`}
                parts={segment.parts}
                tText={tText}
                compact={compact}
              />
            ) : (
              <MessagePartView
                key={getPartKey(message, segment.part, segment.index)}
                part={segment.part}
                tText={tText}
                compact={compact}
              />
            )
          ))
        )}
      </MessageContent>
      {isUserMessage && (
        <MessageActions className="ml-auto pr-1 text-muted-foreground">
          {isEditing ? (
            <>
              <MessageAction
                tooltip={tText("save")}
                label={tText("save")}
                disabled={actionDisabled || !editDraft.trim()}
                onClick={() => void submitEditing()}
                className="size-8 text-muted-foreground hover:text-foreground"
              >
                {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              </MessageAction>
              <MessageAction
                tooltip={tText("cancel")}
                label={tText("cancel")}
                disabled={actionDisabled}
                onClick={cancelEditing}
                className="size-8 text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </MessageAction>
            </>
          ) : (
            <>
              {canEdit && (
                <MessageAction
                  tooltip={tText("edit")}
                  label={tText("edit")}
                  disabled={actionDisabled}
                  onClick={startEditing}
                  className="size-8 text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="size-4" />
                </MessageAction>
              )}
              <MessageAction
                tooltip={copied ? tText("copied") : tText("copy")}
                label={copied ? tText("copied") : tText("copy")}
                disabled={actionDisabled || !messageText.trim()}
                onClick={() => void copyMessage()}
                className="size-8 text-muted-foreground hover:text-foreground"
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </MessageAction>
              {canDelete && (
                <MessageAction
                  tooltip={tText("delete")}
                  label={tText("delete")}
                  disabled={actionDisabled}
                  onClick={() => void deleteMessage()}
                  className="size-8 text-muted-foreground hover:text-destructive"
                >
                  {isDeleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                </MessageAction>
              )}
            </>
          )}
        </MessageActions>
      )}
    </Message>
  )
}

export function AgentAIElementsTimeline({
  messages,
  tText,
  onUpdateUserMessage,
  onDeleteUserMessage,
  assistantLoadingState = false,
  emptyDescription,
  compact = false,
  className,
}: AgentAIElementsTimelineProps) {
  const [renderedTailCount, setRenderedTailCount] = useState(MESSAGE_RENDER_BATCH)
  const renderableMessages = messages.filter(hasRenderableContent)
  const shouldShowLoadingIndicator = assistantLoadingState !== false
  const hiddenMessageCount = Math.max(0, renderableMessages.length - renderedTailCount)
  const displayedMessages = useMemo(
    () => hiddenMessageCount > 0
      ? renderableMessages.slice(-renderedTailCount)
      : renderableMessages,
    [hiddenMessageCount, renderableMessages, renderedTailCount]
  )

  useEffect(() => {
    setRenderedTailCount(MESSAGE_RENDER_BATCH)
  }, [messages.length])

  if (renderableMessages.length === 0 && !shouldShowLoadingIndicator) {
    return (
      <AgentEmptyState className={cn("min-h-[120px] justify-start border-none bg-transparent px-1 py-2", compact && "text-xs", className)}>
        {emptyDescription || tText("emptyDescriptionIntro")}
      </AgentEmptyState>
    )
  }

  return (
    <div className={cn("flex flex-col gap-4", compact && "gap-3", className)}>
      {hiddenMessageCount > 0 && (
        <button
          type="button"
          className="mx-auto rounded-md px-3 py-1.5 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground"
          onClick={() => setRenderedTailCount((count) => count + MESSAGE_RENDER_STEP)}
        >
          {translateWithFallback(
            tText,
            "loadEarlierMessages",
            { count: hiddenMessageCount },
            `Load ${hiddenMessageCount} earlier messages`
          )}
        </button>
      )}

      {displayedMessages.map((message) => (
        <ChatMessage
          key={message.id}
          message={message}
          tText={tText}
          onUpdateUserMessage={onUpdateUserMessage}
          onDeleteUserMessage={onDeleteUserMessage}
          compact={compact}
        />
      ))}

      {shouldShowLoadingIndicator && (
        <Message from="assistant" className={compact ? "max-w-full" : "max-w-[90%]"}>
          <MessageContent>
            <div className="terminal-ai-glass-status inline-flex min-h-9 items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {assistantLoadingState === "thinking" && <span>{tText("panelThinking")}</span>}
            </div>
          </MessageContent>
        </Message>
      )}
    </div>
  )
}
