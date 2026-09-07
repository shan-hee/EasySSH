import type { ComponentProps } from "react"
import type { TFunction } from "i18next"
import { History } from "lucide-react"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button"
import { ThreadList } from "@/components/assistant-ui/elements/thread-list"
import { ThreadListSearch } from "@/components/assistant-ui/elements/thread-list-search"
import { ErrorState } from "@/components/assistant-ui/elements/error-state"
import type { SessionListItem } from "@/lib/api/ai-agent"
import { cn } from "@/lib/utils"

type Translate = TFunction<"aiAssistant">

export interface AISessionHistoryState {
  open: boolean
  setOpen: (open: boolean) => void
  search: string
  setSearch: (value: string) => void
  items: SessionListItem[]
  loading: boolean
  error: string
  renamingId: string | null
  renameDraft: string
  setRenameDraft: (value: string) => void
  actionLoadingId: string | null
  beginRename: (item: SessionListItem) => void
  cancelRename: () => void
  submitRename: (sessionId: string) => Promise<boolean>
}

export function AISessionHistoryPopover({
  activeSessionId,
  align = "end",
  className,
  history,
  onDelete,
  onRestore,
  t,
  triggerClassName
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
          className
        )}
      >
        <ThreadListSearch
          value={history.search}
          onValueChange={history.setSearch}
          aria-label={t("searchPlaceholder")}
          placeholder={t("searchPlaceholder")}
          disabled={Boolean(history.renamingId) || Boolean(history.actionLoadingId)}
        />
        <div className="mt-1 h-[360px] overflow-y-auto overscroll-contain" aria-busy={history.loading}>
          {history.error && <ErrorState detail={history.error} className="mb-2" />}
          {history.loading ? (
            <div role="status" aria-label={t("loading")} className="flex flex-col gap-3 px-3 py-2">
              {Array.from({ length: 5 }, (_, index) => (
                <Skeleton key={index} className="h-8 w-full" />
              ))}
            </div>
          ) : history.items.length === 0 ? (
            !history.error && (
              <div className="px-3 py-10 text-center text-sm text-muted-foreground">
                {t("sessionListEmpty")}
              </div>
            )
          ) : (
            <ThreadList
              activeId={activeSessionId}
              busyId={history.actionLoadingId}
              threads={history.items.map((item) => ({
                id: item.id,
                title: item.title,
                updatedAt: item.updated_at,
                description: t("sidebarMessageCount", { count: item.message_count })
              }))}
              onSelect={onRestore}
              onDelete={onDelete}
              onRename={(id) => {
                const item = history.items.find((item) => item.id === id)
                if (item) history.beginRename(item)
              }}
              editing={{
                id: history.renamingId,
                value: history.renameDraft,
                onValueChange: history.setRenameDraft,
                onSave: history.submitRename,
                onCancel: history.cancelRename
              }}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
