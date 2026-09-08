import type { ComponentProps } from "react"
import type { TFunction } from "i18next"
import { History } from "lucide-react"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button"
import { ThreadListSearch } from "@/components/assistant-ui/elements/thread-list-search"
import type { AISessionHistoryState } from "@/hooks/use-ai-session-history"
import { AISessionHistoryList } from "./ai-session-history-list"
import { cn } from "@/lib/utils"

type Translate = TFunction<"aiAssistant">

export function AISessionHistoryPopover({
  activeSessionId,
  align = "end",
  className,
  history,
  onDelete,
  onRestore,
  t,
  triggerClassName,
}: {
  activeSessionId: string | null
  align?: ComponentProps<typeof PopoverContent>["align"]
  className?: string
  history: AISessionHistoryState
  onDelete: (sessionId: string) => void | Promise<void>
  onRestore: (sessionId: string) => void | Promise<void>
  t: Translate
  triggerClassName?: string
}) {
  return (
    <Popover
      open={history.open}
      onOpenChange={(open) => {
        history.setOpen(open)
        if (!open && !history.actionLoadingId) history.cancelRename()
      }}
    >
      <PopoverTrigger asChild>
        <TooltipIconButton type="button" tooltip={t("sidebarTitle")} className={triggerClassName}>
          <History className="size-4" />
        </TooltipIconButton>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={8}
        className={cn(
          "w-[350px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl p-2 shadow-2xl",
          className,
        )}
      >
        <ThreadListSearch
          value={history.search}
          onValueChange={history.setSearch}
          aria-label={t("searchPlaceholder")}
          placeholder={t("searchPlaceholder")}
          disabled={Boolean(history.renamingId) || Boolean(history.actionLoadingId)}
        />
        <AISessionHistoryList
          activeSessionId={activeSessionId}
          history={history}
          onDelete={onDelete}
          onRestore={onRestore}
          t={t}
          className="mt-1 h-[360px]"
        />
      </PopoverContent>
    </Popover>
  )
}
