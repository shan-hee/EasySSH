"use client"

import { createContext, useContext, useState, type ComponentProps } from "react"
import { ChevronRightIcon, Loader2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

const ToolTimelineExpansionContext = createContext<(() => void) | undefined>(undefined)

// 默认收起，仅由用户切换；展开内部详情时让外层分组一起保持展开。
export function useToolExpansion() {
  const expandParent = useContext(ToolTimelineExpansionContext)
  const [open, setOpen] = useState(false)
  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) expandParent?.()
  }
  return { open, onOpenChange }
}

// Official elements-tool-timeline surface, composed with actual tool-call children.
export function ToolTimeline({
  count,
  active,
  onChildExpand,
  children,
  className,
  ...props
}: ComponentProps<typeof Collapsible> & {
  count: number
  active: boolean
  onChildExpand?: () => void
}) {
  const { t } = useTranslation("aiAssistant")
  return (
    <Collapsible data-slot="tool-timeline" className={cn("w-full min-w-0", className)} {...props}>
      <CollapsibleTrigger className="group/timeline flex items-center gap-2 rounded-md py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-ring">
        <ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-data-[state=open]/timeline:rotate-90 motion-reduce:transition-none" />
        <span className={cn(active && "shimmer motion-reduce:animate-none")}>
          {t(active ? "auiToolsRunning" : "toolCallGroupTitle", { count })}
        </span>
        {active && (
          <Loader2Icon aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up motion-reduce:animate-none">
        <div className="ms-1.5 flex min-w-0 flex-col gap-2 border-s border-border ps-3 pt-2 pb-1">
          <ToolTimelineExpansionContext.Provider value={onChildExpand}>
            {children}
          </ToolTimelineExpansionContext.Provider>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
