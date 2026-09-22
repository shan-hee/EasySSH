import { createContext, memo, useContext, useEffect, useMemo, useState } from "react"
import { useAui, useAuiState, type ToolCallMessagePartProps, type TextMessagePartProps } from "@assistant-ui/react"
import { Thread, MessageEditComposer } from "@/components/assistant-ui/elements/thread.aui"
import { ToolFallback } from "@/components/assistant-ui/elements/tool-fallback.aui"
import { ThinkingIndicator } from "@/components/assistant-ui/elements/thinking-indicator"
import { ErrorState } from "@/components/assistant-ui/elements/error-state"
import { Timeline } from "@/components/assistant-ui/elements/timeline"
import { ServerReferencePicker } from "./server-reference-picker"
import { AgentComposerInput } from "./agent-composer"
import { parseServerReferenceText, readServerReferences, serializeServerReferenceText, splitServerReferenceText } from "@/lib/ai-agent/server-mentions"
import type { Server as ManagedServer } from "@/lib/api"
import type { AgentServerReference } from "@/lib/ai-agent-types"
import type { AgentSessionScope } from "@/lib/api/ai-agent"
import type { AssistantLoadingState, TimelineTranslate } from "@/lib/ai-agent/timeline-utils"

type ThreadOptions = {
  tText: TimelineTranslate
  compact?: boolean
  scope?: AgentSessionScope
  referenceServers?: ManagedServer[]
  referenceServersLoading?: boolean
  onUpdateUserMessage?: (id: string, text: string, references?: AgentServerReference[]) => boolean | Promise<boolean>
  onRegenerateUserMessage?: (id: string, text: string) => boolean | Promise<boolean>
  onDeleteUserMessage?: (id: string) => boolean | Promise<boolean>
  onContinueStoppedRun?: (id: string) => boolean | Promise<boolean>
}
const Context = createContext<Pick<ThreadOptions, "tText" | "scope" | "referenceServers" | "referenceServersLoading" | "onUpdateUserMessage"> | null>(null)
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

// Only EasySSH execution context is host-specific. The official fallback owns
// status, disclosure, parameters/results, duration and approval interactions.
function AgentTool(part: ToolCallMessagePartProps) {
  const { tText, scope } = useAgentThread()
  const running = useAuiState((s) => s.thread.isRunning)
  const metadata = asRecord(part.providerMetadata?.easyssh)
  const args = asRecord(part.args)
  const waiting =
    part.approval != null && part.approval.approved === undefined && !part.approval.resolution
  const target =
    text(args.server_name || args.server_id || args.host) || scope?.server_name || scope?.host
  const cwd = text(args.cwd || args.working_directory)
  return (
    <ToolFallback
      {...part}
      toolName={text(metadata.displayName) || part.toolName}
      disabled={running}
    >
      {waiting && (
        <div className="space-y-1 border-l-2 border-status-warning/40 pl-3 text-xs text-muted-foreground">
          {text(metadata.summary) && <p>{text(metadata.summary)}</p>}
          {target && (
            <p>
              {tText("approvalTarget")}: {target}
            </p>
          )}
          {cwd && (
            <p>
              {tText("approvalWorkingDirectory")}: {cwd}
            </p>
          )}
          <p>
            {tText(
              metadata.dangerous === true ? "approvalImpactDangerous" : "approvalImpactRoutine"
            )}
          </p>
        </div>
      )}
      <Timeline
        events={[
          ...(text(metadata.createdAt)
            ? [{ id: "created", time: text(metadata.createdAt), title: tText("auiToolCreated") }]
            : []),
          ...(text(metadata.updatedAt) && metadata.updatedAt !== metadata.createdAt
            ? [
                {
                  id: "updated",
                  time: text(metadata.updatedAt),
                  title: tText(
                    metadata.taskStatus === "succeeded"
                      ? "auiToolCompleted"
                      : metadata.taskStatus === "failed"
                        ? "auiToolFailed"
                        : metadata.taskStatus === "cancelled"
                          ? "auiCancelledTool"
                          : "auiToolUpdated"
                  ),
                  active: metadata.taskStatus === "running"
                }
              ]
            : [])
        ]}
      />
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
  scope,
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
}) {
  const context = useMemo(() => ({ tText, scope, referenceServers, referenceServersLoading, onUpdateUserMessage }), [tText, scope, referenceServers, referenceServersLoading, onUpdateUserMessage])
  const loadingText = assistantLoadingState
    ? tText(assistantLoadingState === "reconnecting" ? "auiReconnecting" : "auiThinking")
    : undefined
  return (
    <Context.Provider value={context}>
      <Thread {...props} onUpdateUserMessage={onUpdateUserMessage} components={components} loadingText={loadingText} />
    </Context.Provider>
  )
})
