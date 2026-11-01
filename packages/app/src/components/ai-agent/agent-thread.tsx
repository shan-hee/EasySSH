import { createContext, memo, useContext, useEffect, useMemo, useState } from "react"
import { useAui, useAuiState, type ToolCallMessagePartProps, type TextMessagePartProps } from "@assistant-ui/react"
import { Thread, MessageEditComposer } from "@/components/assistant-ui/elements/thread.aui"
import { ToolFallback } from "@/components/assistant-ui/elements/tool-fallback.aui"
import { ThinkingIndicator } from "@/components/assistant-ui/elements/thinking-indicator"
import { ErrorState } from "@/components/assistant-ui/elements/error-state"
import { ServerReferencePicker } from "./server-reference-picker"
import { AgentWorkspaceFileLink, useAgentWorkspace } from "./agent-workspace-panel"
import { AgentCommandCard } from "./agent-command-card"
import { AgentComposerInput } from "./agent-composer"
import { parseServerReferenceText, readServerReferences, serializeServerReferenceText, splitServerReferenceText } from "@/lib/ai-agent/server-mentions"
import type { Server as ManagedServer } from "@/lib/api"
import type { AgentServerReference } from "@/lib/ai-agent-types"
import type { AssistantLoadingState, TimelineTranslate } from "@/lib/ai-agent/timeline-utils"

type ThreadOptions = {
  tText: TimelineTranslate
  compact?: boolean
  referenceServers?: ManagedServer[]
  referenceServersLoading?: boolean
  onUpdateUserMessage?: (id: string, text: string, references?: AgentServerReference[]) => boolean | Promise<boolean>
  onRegenerateUserMessage?: (id: string, text: string) => boolean | Promise<boolean>
  onDeleteUserMessage?: (id: string) => boolean | Promise<boolean>
  onContinueStoppedRun?: (id: string) => boolean | Promise<boolean>
}
const Context = createContext<Pick<ThreadOptions, "tText" | "referenceServers" | "referenceServersLoading" | "onUpdateUserMessage"> | null>(null)
function useAgentThread() {
  const context = useContext(Context)
  if (!context) throw new Error("Agent tool must be rendered inside AgentThread")
  return context
}
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
function text(value: unknown) {
  return typeof value === "string" ? value : ""
}

// 命令使用专用卡片；其他工具沿用官方 fallback，只补充文件入口和审批目标。
function AgentTool(part: ToolCallMessagePartProps) {
  const { tText } = useAgentThread()
  const running = useAuiState((s) => s.thread.isRunning)
  const workspace = useAgentWorkspace()
  const metadata = asRecord(part.providerMetadata?.easyssh)
  const taskId = text(metadata.taskId)
  const task = workspace?.tasks.find((item) => item.id === taskId || item.tool_call_id === part.toolCallId)
  if (part.toolName === "execute_command" && task) return <AgentCommandCard task={task} part={part} disabled={running} />
  const waiting =
    part.approval != null && part.approval.approved === undefined && !part.approval.resolution
  const serverId = text(asRecord(part.args).server_id)
  const target = serverId && (workspace?.serverName(serverId) ?? serverId)
  return (
    <ToolFallback
      {...part}
      toolName={text(metadata.displayName) || part.toolName}
      disabled={running}
    >
      {waiting && (target || metadata.dangerous === true) && (
        <div className="space-y-1 border-l-2 border-status-warning/40 pl-3 text-xs text-muted-foreground">
          {target && <p>{tText("approvalTarget")}: {target}</p>}
          {metadata.dangerous === true && <p>{tText("approvalImpactDangerous")}</p>}
        </div>
      )}
      {task && <AgentWorkspaceFileLink task={task} />}
    </ToolFallback>
  )
}

function AgentData({ name, data }: { name: string; data: unknown }) {
  const active = useAuiState((s) => s.message.status?.type === "running")
  const value = asRecord(data)
  if (name === "error" && typeof value.message === "string")
    return <ErrorState detail={value.message} />
  if (name === "tool-status" && typeof value.text === "string")
    return <ThinkingIndicator label={value.text} active={active} className="px-2 py-1 text-xs" />
  return null
}
function ReferenceEditComposer() {
  const { referenceServers, referenceServersLoading, onUpdateUserMessage } = useAgentThread()
  const aui = useAui()
  const saved = useAuiState((s) => s.message.metadata.custom?.serverReferences)
  const [references, setReferences] = useState(() => readServerReferences(saved))
  const [initialDraft] = useState(() => serializeServerReferenceText(aui.composer.getState().text, readServerReferences(saved)))
  useEffect(() => { aui.composer.setText(initialDraft) }, [aui, initialDraft])
  return (
    <MessageEditComposer
      onSave={(id, text) => {
        const parsed = parseServerReferenceText(text, references)
        return onUpdateUserMessage?.(id, parsed.content, parsed.references) ?? false
      }}
      renderInput={(disabled) => <AgentComposerInput autoFocus disabled={disabled} />}
    >
      {(disabled) => (
        <>
          <ServerReferencePicker
            className="top-full bottom-auto mt-2 mb-0"
            servers={referenceServers ?? []}
            references={references}
            onChange={setReferences}
            loading={referenceServersLoading}
            disabled={disabled || !referenceServers}
          />
        </>
      )}
    </MessageEditComposer>
  )
}

function ReferenceMessageText({ text }: TextMessagePartProps) {
  const saved = useAuiState((s) => s.message.metadata.custom?.serverReferences)
  return <span className="whitespace-pre-wrap">{splitServerReferenceText(text, readServerReferences(saved)).map(({ text: part, reference }, index) => reference
    ? <span key={index} className="inline rounded bg-accent px-1 text-accent-foreground" title={`${reference.username}@${reference.host}:${reference.port}`} data-server-id={reference.server_id}>{part}</span>
    : part)}</span>
}

const components = { ToolFallback: AgentTool, Data: AgentData, UserText: ReferenceMessageText, EditComposer: ReferenceEditComposer }

export const AgentThread = memo(function AgentThread({
  tText,
  referenceServers,
  referenceServersLoading,
  onUpdateUserMessage,
  assistantLoadingState = false,
  ...props
}: ThreadOptions & {
  assistantLoadingState?: AssistantLoadingState
  emptyDescription?: string
  className?: string
  contentClassName?: string
  viewportClassName?: string
}) {
  const context = useMemo(() => ({ tText, referenceServers, referenceServersLoading, onUpdateUserMessage }), [tText, referenceServers, referenceServersLoading, onUpdateUserMessage])
  const loadingText = assistantLoadingState
    ? tText(assistantLoadingState === "reconnecting" ? "auiReconnecting" : "auiThinking")
    : undefined
  return (
    <Context.Provider value={context}>
      <Thread {...props} onUpdateUserMessage={onUpdateUserMessage} components={components} loadingText={loadingText} />
    </Context.Provider>
  )
})
