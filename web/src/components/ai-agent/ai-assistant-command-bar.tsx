import type { ReactNode } from "react"
import { Bot, Circle, Server, Sparkles } from "lucide-react"

import type { AgentSessionStatus } from "@/lib/api/ai-agent"
import { cn } from "@/lib/utils"

function statusTone(status?: AgentSessionStatus) {
  if (status === "running") return "fill-primary text-primary"
  if (status === "waiting_confirmation") return "fill-amber-500 text-amber-500"
  if (status === "closed") return "fill-muted-foreground/40 text-muted-foreground/40"
  return "fill-emerald-500 text-emerald-500"
}

export function AIAssistantCommandBar({
  actions,
  className,
  compact = false,
  leading,
  model,
  permission,
  scope,
  status,
  statusLabel,
  title,
}: {
  actions?: ReactNode
  className?: string
  compact?: boolean
  leading?: ReactNode
  model?: ReactNode
  permission?: ReactNode
  scope?: string
  status?: AgentSessionStatus
  statusLabel?: string
  title: string
}) {
  return (
    <header
      className={cn(
        "ai-command-bar flex min-w-0 shrink-0 items-center gap-3 border-b border-border/55 px-4",
        compact ? "min-h-11" : "min-h-12 md:px-5",
        className,
      )}
    >
      {leading}
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {compact ? <Bot className="size-3.5" /> : <Sparkles className="size-3.5" />}
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold tracking-[-0.01em]">{title}</span>
            {statusLabel && (
              <span className="ai-command-bar__status inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                <Circle className={cn("size-2", statusTone(status))} />
                <span className="ai-command-bar__status-text hidden sm:inline">{statusLabel}</span>
              </span>
            )}
          </div>
          {(scope || model || permission) && (
            <div className="mt-0.5 flex min-w-0 items-center gap-2.5 overflow-hidden text-[11px] text-muted-foreground">
              {scope && (
                <span className="ai-command-bar__scope inline-flex min-w-0 items-center gap-1">
                  <Server className="size-3 shrink-0" />
                  <span className="truncate">{scope}</span>
                </span>
              )}
              {model && (
                <span className="ai-command-bar__model inline-flex min-w-0 items-center">{model}</span>
              )}
              {permission && (
                <span className="ai-command-bar__permission hidden min-w-0 items-center sm:inline-flex">{permission}</span>
              )}
            </div>
          )}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  )
}
