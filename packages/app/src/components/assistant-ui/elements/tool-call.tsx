"use client"

import type { ReactNode } from "react"
import {
  CheckIcon,
  ChevronRightIcon,
  CirclePauseIcon,
  Loader2Icon,
  XCircleIcon
} from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

// Official elements-tool-call disclosure with real runtime status and approval slots.
export function ToolCall({
  label,
  query,
  state,
  open,
  onOpenChange,
  timing,
  children
}: {
  label: string
  query?: string
  state: "running" | "complete" | "error" | "cancelled" | "approval"
  open: boolean
  onOpenChange: (open: boolean) => void
  timing?: ReactNode
  children: ReactNode
}) {
  const Icon =
    state === "running"
      ? Loader2Icon
      : state === "complete"
        ? CheckIcon
        : state === "approval"
          ? CirclePauseIcon
          : XCircleIcon
  return (
    <Collapsible
      data-slot="tool-call"
      data-status={state}
      open={open}
      onOpenChange={onOpenChange}
      className="w-full min-w-0"
    >
      <CollapsibleTrigger className="group/call flex w-full min-w-0 items-center gap-2 rounded-md py-1.5 text-start text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-ring">
        <ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-data-[state=open]/call:rotate-90 motion-reduce:transition-none" />
        <span
          className={cn("shrink-0", state === "running" && "shimmer motion-reduce:animate-none")}
        >
          {label}
        </span>
        {query && (
          <span
            title={query}
            className="min-w-0 truncate rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground"
          >
            {query}
          </span>
        )}
        <span className="ms-auto flex shrink-0 items-center gap-2">
          {timing}
          <Icon
            aria-hidden
            className={cn(
              "size-3.5",
              state === "running" && "animate-spin motion-reduce:animate-none",
              state === "complete" && "text-status-connected",
              state === "error" && "text-destructive",
              state === "approval" && "text-status-warning"
            )}
          />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up motion-reduce:animate-none">
        <div className="mt-2 flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-muted/40 p-3 text-sm">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
