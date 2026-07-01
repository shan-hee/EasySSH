
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import {
  Check,
  ChevronDown,
  FileText,
  FolderOpen,
  Loader2,
  Server,
  ShieldAlert,
  Terminal,
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

import { AgentEmptyState, AgentNoticeCard } from "@/components/ai-agent/agent-notice"
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message"
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning"
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
} from "@/components/ai-elements/tool"
import { CodeBlock } from "@/components/ai-elements/code-block"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { type AssistantLoadingState, type TimelineTranslate } from "@/lib/ai-agent/timeline-utils"
import { cn } from "@/lib/utils"

type AgentToolPart = ToolUIPart | DynamicToolUIPart
type AgentMessagePart = UIMessage["parts"][number]
type ToolDecision = "confirm" | "reject"
type RenderableMessagePart = Exclude<AgentMessagePart, AgentToolPart>
type MessageRenderSegment =
  | { type: "part"; part: RenderableMessagePart; index: number }
  | { type: "tool-group"; parts: AgentToolPart[]; startIndex: number }

const MESSAGE_RENDER_BATCH = 50
const MESSAGE_RENDER_STEP = 50

interface AgentAIElementsTimelineProps {
  messages: UIMessage[]
  tText: TimelineTranslate
  onConfirmTask?: (taskId: string, decision: ToolDecision) => void | Promise<void>
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

function hasRenderableContent(message: UIMessage) {
  return message.parts.some((part) => {
    if (isTextUIPart(part)) {
      return part.text.trim() !== ""
    }
    if (isReasoningUIPart(part) || isToolUIPart(part)) {
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

function toolOutput(part: AgentToolPart) {
  return part.state === "output-available" ? part.output : undefined
}

function toolError(part: AgentToolPart) {
  return part.state === "output-error" ? part.errorText : undefined
}

function shouldToolBeOpen(state: AgentToolPart["state"]) {
  return state !== "output-available" && state !== "output-error" && state !== "output-denied"
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

function truncateMiddle(value: string, maxLength = 96) {
  if (value.length <= maxLength) {
    return value
  }

  const headLength = Math.ceil((maxLength - 3) * 0.62)
  const tailLength = maxLength - 3 - headLength
  return `${value.slice(0, headLength)}...${value.slice(-tailLength)}`
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

function getToolDescription(part: AgentToolPart) {
  const input = getToolInput(part)
  const command = getStringValue(input, "command")
  if (command) {
    return `$ ${truncateMiddle(command)}`
  }

  const path = getStringValue(input, "path")
  if (path) {
    return truncateMiddle(path)
  }

  const summary = asRecord(part.toolMetadata).summary
  if (typeof summary === "string" && summary.trim() && summary !== getToolName(part)) {
    return truncateMiddle(summary)
  }

  const serverId = getStringValue(input, "server_id")
  if (serverId) {
    return `server:${truncateMiddle(serverId, 52)}`
  }

  return ""
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

function tryParseJson(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
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
  const parsedJson = isJsonLike(toolName, content) ? tryParseJson(content) : null
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
        {parsedJson ? (
          <CodeBlock code={JSON.stringify(parsedJson, null, 2)} language="json" />
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

function ToolHeaderForPart({ part }: { part: AgentToolPart }) {
  const description = getToolDescription(part)
  if (part.type === "dynamic-tool") {
    return (
      <ToolHeader
        description={description}
        state={part.state}
        title={getToolDisplayName(part)}
        toolName={part.toolName}
        type={part.type}
      />
    )
  }

  return <ToolHeader description={description} state={part.state} title={getToolDisplayName(part)} type={part.type} />
}

function ToolPartView({
  part,
  tText,
  onConfirmTask,
  compact,
}: {
  part: AgentToolPart
  tText: TimelineTranslate
  onConfirmTask?: (taskId: string, decision: ToolDecision) => void | Promise<void>
  compact?: boolean
}) {
  const summary = part.toolMetadata && typeof part.toolMetadata.summary === "string"
    ? part.toolMetadata.summary
    : ""
  const defaultOpen = shouldToolBeOpen(part.state)
  const input = getToolInput(part)
  const approvalId = "approval" in part ? part.approval?.id : undefined
  const toolName = getToolName(part)
  const dangerous = asRecord(part.toolMetadata).dangerous === true
  const [pendingDecision, setPendingDecision] = useState<ToolDecision | null>(null)
  const approvalRef = useRef<HTMLDivElement>(null)
  const confirmButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (part.state !== "approval-requested" || !approvalId) {
      return
    }

    approvalRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
    const timer = window.setTimeout(() => confirmButtonRef.current?.focus(), 120)
    return () => window.clearTimeout(timer)
  }, [approvalId, part.state])

  const submitDecision = (decision: ToolDecision) => {
    if (!approvalId || !onConfirmTask || pendingDecision) {
      return
    }

    setPendingDecision(decision)
    try {
      void Promise.resolve(onConfirmTask(approvalId, decision)).finally(() => {
        setPendingDecision(null)
      })
    } catch {
      setPendingDecision(null)
    }
  }

  const handleApprovalKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (part.state !== "approval-requested") {
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      submitDecision("confirm")
    } else if (event.key === "Escape") {
      event.preventDefault()
      submitDecision("reject")
    }
  }

  return (
    <Tool key={part.state} defaultOpen={defaultOpen} className={cn("mb-0", compact && "text-xs")}>
      <ToolHeaderForPart part={part} />
      <ToolContent className={compact ? "space-y-3 p-3" : undefined}>
        {summary && (
          <div className="rounded-md border border-border/60 bg-muted/25 px-3 py-2 text-xs leading-5 text-foreground/85">
            {summary}
          </div>
        )}

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

        {part.state === "approval-requested" && approvalId && onConfirmTask && (
          <div
            ref={approvalRef}
            className="space-y-3 rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3"
            onKeyDown={handleApprovalKeyDown}
            tabIndex={-1}
          >
            <div className="flex items-start gap-2 text-xs leading-5 text-foreground/85">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-yellow-600" />
              <div className="min-w-0">
                <div className="font-medium">
                  {translateWithFallback(tText, "confirmationRequested", undefined, "Confirmation requested")}
                  {dangerous && (
                    <span className="ml-2 rounded-full border border-yellow-500/30 px-2 py-0.5 text-[11px] text-yellow-700 dark:text-yellow-300">
                      {tText("dangerousAction")}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-muted-foreground">
                  {translateWithFallback(
                    tText,
                    "approvalKeyboardHint",
                    undefined,
                    `Enter ${tText("confirmAction")} / Esc ${tText("rejectAction")}`
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                ref={confirmButtonRef}
                size="sm"
                className="h-8 gap-1.5"
                disabled={Boolean(pendingDecision)}
                onClick={() => submitDecision("confirm")}
              >
                {pendingDecision === "confirm" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Check className="size-3.5" />
                )}
                {tText("confirmAction")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={Boolean(pendingDecision)}
                onClick={() => submitDecision("reject")}
              >
                {pendingDecision === "reject" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <X className="size-3.5" />
                )}
                {tText("rejectAction")}
              </Button>
            </div>
          </div>
        )}
      </ToolContent>
    </Tool>
  )
}

function MessagePartView({
  part,
  tText,
  onConfirmTask,
  compact,
}: {
  part: AgentMessagePart
  tText: TimelineTranslate
  onConfirmTask?: (taskId: string, decision: ToolDecision) => void | Promise<void>
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
        onConfirmTask={onConfirmTask}
        compact={compact}
      />
    )
  }

  if (part.type === "data-tool-status") {
    const text = getDataMessage(part, "text")
    if (!text) {
      return null
    }
    return (
      <div className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground">
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
  onConfirmTask,
  parts,
  tText,
}: {
  compact?: boolean
  onConfirmTask?: (taskId: string, decision: ToolDecision) => void | Promise<void>
  parts: AgentToolPart[]
  tText: TimelineTranslate
}) {
  const defaultOpen = parts.some((part) => shouldToolBeOpen(part.state))
  const completedCount = parts.filter((part) => part.state === "output-available").length
  const pendingCount = parts.filter((part) => shouldToolBeOpen(part.state)).length
  const firstDescription = parts.map(getToolDescription).find(Boolean)

  if (parts.length === 1) {
    return (
      <ToolPartView
        part={parts[0]}
        tText={tText}
        onConfirmTask={onConfirmTask}
        compact={compact}
      />
    )
  }

  return (
    <Collapsible defaultOpen={defaultOpen} className="group rounded-md border border-border/70 bg-muted/15">
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 px-3 py-2 text-left">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">
              {tText("toolCallGroupTitle", { count: parts.length })}
            </span>
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
          {firstDescription && (
            <div className="mt-0.5 truncate font-mono text-muted-foreground text-xs">
              {firstDescription}
            </div>
          )}
        </div>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className={cn("flex flex-col gap-1.5 border-t border-border/60 p-2", compact && "gap-2 p-1.5")}>
        {parts.map((part) => (
          <ToolPartView
            key={`${part.toolCallId}:${part.state}`}
            part={part}
            tText={tText}
            onConfirmTask={onConfirmTask}
            compact={compact}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

function ChatMessage({
  message,
  tText,
  onConfirmTask,
  compact,
}: {
  message: UIMessage
  tText: TimelineTranslate
  onConfirmTask?: (taskId: string, decision: ToolDecision) => void | Promise<void>
  compact?: boolean
}) {
  if (!hasRenderableContent(message)) {
    return null
  }

  return (
    <Message from={message.role} className={compact ? "max-w-full" : "max-w-[90%]"}>
      <MessageContent
        className={cn(
          message.role === "user" && "whitespace-pre-wrap break-words leading-6",
          compact && "text-xs"
        )}
      >
        {createMessageRenderSegments(message).map((segment) => (
          segment.type === "tool-group" ? (
            <ToolGroupView
              key={`${message.id}:tools:${segment.startIndex}:${segment.parts.map((part) => `${part.toolCallId}:${part.state}`).join("|")}`}
              parts={segment.parts}
              tText={tText}
              onConfirmTask={onConfirmTask}
              compact={compact}
            />
          ) : (
            <MessagePartView
              key={getPartKey(message, segment.part, segment.index)}
              part={segment.part}
              tText={tText}
              onConfirmTask={onConfirmTask}
              compact={compact}
            />
          )
        ))}
      </MessageContent>
    </Message>
  )
}

export function AgentAIElementsTimeline({
  messages,
  tText,
  onConfirmTask,
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
          onConfirmTask={onConfirmTask}
          compact={compact}
        />
      ))}

      {shouldShowLoadingIndicator && (
        <Message from="assistant" className={compact ? "max-w-full" : "max-w-[90%]"}>
          <MessageContent>
            <div className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {assistantLoadingState === "thinking" && <span>{tText("panelThinking")}</span>}
            </div>
          </MessageContent>
        </Message>
      )}
    </div>
  )
}
