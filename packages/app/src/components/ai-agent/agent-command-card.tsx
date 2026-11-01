import { useToolCallElapsed, type ToolCallMessagePartProps } from "@assistant-ui/react"
import { ChevronRight, PanelRight, Server, SquareTerminal, TriangleAlert } from "lucide-react"
import { useTranslation } from "react-i18next"
import { formatToolDuration, ToolFallbackApproval } from "@/components/assistant-ui/elements/tool-fallback.aui"
import { useToolExpansion } from "@/components/assistant-ui/elements/tool-timeline"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import type { TaskView } from "@/lib/ai-agent-types"
import { cn } from "@/lib/utils"
import { CommandOutput, CopyIconButton, TaskStatusBadge, commandResult, taskServerId, useAgentWorkspace } from "./agent-workspace-panel"

/**
 * 消息流中的命令执行：命令、目标服务器、审批、实时输出、退出码与耗时。
 * 数据来自会话任务，输出随增量实时更新；执行记录面板只是同一任务的完整视图。
 */
export function AgentCommandCard({ task, part, disabled }: { task: TaskView; part: ToolCallMessagePartProps; disabled?: boolean }) {
  const { t } = useTranslation("aiAssistant")
  const workspace = useAgentWorkspace()
  const elapsed = useToolCallElapsed()
  const waiting = task.status === "waiting_confirm"
  const { open, onOpenChange } = useToolExpansion()
  const command = String(task.arguments?.command ?? "")
  const server = workspace?.serverName(taskServerId(task)) ?? ""
  const result = commandResult(task)
  const duration = result.durationMs ?? (task.status === "running" ? elapsed : undefined)
  return (
    <Collapsible
      data-slot="agent-command"
      data-status={task.status}
      open={open}
      onOpenChange={onOpenChange}
      className={cn("my-1 w-full min-w-0 overflow-hidden rounded-xl border bg-background", waiting && "border-status-warning/60")}
    >
      <CollapsibleTrigger className="group/command flex w-full min-w-0 items-center gap-2.5 px-3 py-2 text-start transition-colors hover:bg-accent/50 focus-visible:outline-ring">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <SquareTerminal className="size-3.5" />
        </span>
        <code title={command} className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{command}</code>
        {server && <span title={server} className="hidden max-w-36 shrink-0 truncate text-xs text-muted-foreground @min-[28rem]:inline">{server}</span>}
        {duration !== undefined && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatToolDuration(duration)}</span>}
        <TaskStatusBadge task={task} />
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/command:rotate-90 motion-reduce:transition-none" />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up motion-reduce:animate-none">
        <div className="flex items-start gap-2 border-t px-3 py-2">
          <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-xs leading-5"><span className="select-none text-muted-foreground">$ </span>{command}</pre>
          <CopyIconButton value={command} tooltip={t("commandCopy")} className="-my-1" />
        </div>
        {!waiting && <CommandOutput task={task} className="border-t" viewportClassName="max-h-72" />}
        {result.note && <p role="alert" className="break-words border-t px-3 py-2 text-xs text-destructive">{result.note}</p>}
        {waiting ? (
          <div className="space-y-2 border-t bg-status-warning/5 px-3 py-2.5">
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <TriangleAlert className="mt-px size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>{server ? t("commandApprovalTarget", { server }) : t("commandApprovalHint")}</span>
            </p>
            <ToolFallbackApproval
              disabled={disabled}
              addResult={part.addResult}
              resume={part.resume}
              interrupt={part.interrupt}
              approval={part.approval}
              respondToApproval={part.respondToApproval}
              status={part.status}
            />
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-1 border-t ps-3 pe-1.5 py-1 text-xs text-muted-foreground">
            {server && <span className="inline-flex min-w-0 items-center gap-1"><Server className="size-3 shrink-0" /><span className="truncate">{server}</span></span>}
            <span className="flex-1" />
            {result.output && <CopyIconButton value={result.output} tooltip={t("commandCopyOutput")} />}
            {workspace && <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-muted-foreground" onClick={() => workspace.select(task.id)}>
              <PanelRight className="size-3.5" />{t("commandOpenRecord")}
            </Button>}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
