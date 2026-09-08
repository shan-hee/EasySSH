import { createContext, memo, useContext, useMemo } from "react"
import { useAuiState, type ToolCallMessagePartProps } from "@assistant-ui/react"
import { Thread } from "@/components/assistant-ui/elements/thread.aui"
import { ToolFallback } from "@/components/assistant-ui/elements/tool-fallback.aui"
import { ThinkingIndicator } from "@/components/assistant-ui/elements/thinking-indicator"
import { ErrorState } from "@/components/assistant-ui/elements/error-state"
import { Timeline } from "@/components/assistant-ui/elements/timeline"
import type { AgentSessionScope } from "@/lib/api/ai-agent"
import type { AssistantLoadingState, TimelineTranslate } from "@/lib/ai-agent/timeline-utils"

type ThreadOptions = {
  tText: TimelineTranslate
  compact?: boolean
  scope?: AgentSessionScope
  onUpdateUserMessage?: (id: string, text: string) => boolean | Promise<boolean>
  onRegenerateUserMessage?: (id: string, text: string) => boolean | Promise<boolean>
  onDeleteUserMessage?: (id: string) => boolean | Promise<boolean>
  onContinueStoppedRun?: (id: string) => boolean | Promise<boolean>
}
const Context = createContext<Pick<ThreadOptions, "tText" | "scope"> | null>(null)
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
const components = { ToolFallback: AgentTool, Data: AgentData }

export const AgentThread = memo(function AgentThread({
  tText,
  scope,
  assistantLoadingState = false,
  ...props
}: ThreadOptions & {
  assistantLoadingState?: AssistantLoadingState
  emptyDescription?: string
  className?: string
  contentClassName?: string
}) {
  const context = useMemo(() => ({ tText, scope }), [tText, scope])
  const loadingText = assistantLoadingState ? tText("auiThinking") : undefined
  return (
    <Context.Provider value={context}>
      <Thread {...props} components={components} loadingText={loadingText} />
    </Context.Provider>
  )
})
