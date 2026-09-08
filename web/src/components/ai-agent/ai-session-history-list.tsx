import type { TFunction } from "i18next"
import { useTranslation } from "react-i18next"
import { Loader2 } from "lucide-react"
import { ThreadList } from "@/components/assistant-ui/elements/thread-list"
import { ErrorState } from "@/components/assistant-ui/elements/error-state"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type { AISessionHistoryState } from "@/hooks/use-ai-session-history"

export function AISessionHistoryList({
  activeSessionId,
  history,
  onDelete,
  onRestore,
  t,
  className,
  compact = false,
}: {
  activeSessionId: string | null
  history: AISessionHistoryState
  onDelete: (id: string) => void | Promise<void>
  onRestore: (id: string) => void | Promise<void>
  t: TFunction<"aiAssistant">
  className?: string
  compact?: boolean
}) {
  const { t: tCommon } = useTranslation("common")
  return (
    <div
      className={cn("min-h-0 overflow-y-auto overscroll-contain scrollbar-custom", className)}
      aria-busy={history.loading || history.loadingMore}
    >
      {history.error && (
        <ErrorState
          detail={history.error}
          className="mb-2"
          action={
            <Button
              variant="ghost"
              size="sm"
              disabled={history.loading || history.loadingMore}
              onClick={() => void history.reload()}
            >
              {tCommon("retry")}
            </Button>
          }
        />
      )}
      {history.loading ? (
        <div role="status" aria-label={t("loading")} className="flex flex-col gap-3 px-3 py-2">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </div>
      ) : history.items.length === 0 ? (
        !history.error && (
          <div role="status" className="px-3 py-10 text-center text-sm text-muted-foreground">
            {t(history.search.trim() ? "sessionSearchEmpty" : "sessionListEmpty")}
          </div>
        )
      ) : (
        <ThreadList
          activeId={activeSessionId}
          busyId={history.actionLoadingId}
          compact={compact}
          threads={history.items.map((item) => ({
            id: item.id,
            title: item.title,
            updatedAt: item.updated_at,
            description: t("sidebarMessageCount", { count: item.message_count }),
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
            onCancel: history.cancelRename,
          }}
        />
      )}
      {!history.loading && history.hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="my-2 w-full"
          disabled={
            history.loadingMore || Boolean(history.actionLoadingId) || Boolean(history.renamingId)
          }
          onClick={() => void history.loadMore()}
        >
          {history.loadingMore && <Loader2 className="size-4 animate-spin" />}
          {t(history.loadingMore ? "loading" : "loadMoreSessions")}
        </Button>
      )}
    </div>
  )
}
