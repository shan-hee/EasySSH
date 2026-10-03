import type { TFunction } from "i18next"
import { useEffect, useRef } from "react"
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
  const scrollRef = useRef<HTMLDivElement>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const { hasMore, loading, loadingMore, error, actionLoadingId, renamingId, loadMore } = history

  useEffect(() => {
    const root = scrollRef.current
    const target = loadMoreRef.current
    if (!root || !target || !hasMore || loading || loadingMore || error || actionLoadingId || renamingId) return

    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && root.getClientRects().length > 0) {
        void loadMore()
      }
    }, { root, rootMargin: "0px 0px 120px 0px" })
    observer.observe(target)
    return () => observer.disconnect()
  }, [actionLoadingId, error, hasMore, loadMore, loading, loadingMore, renamingId])

  const errorState = history.error && (
    <ErrorState
      detail={history.error}
      className="my-2"
      action={
        <Button
          variant="ghost"
          size="sm"
          disabled={history.loading || history.loadingMore || Boolean(actionLoadingId) || Boolean(renamingId)}
          onClick={() => void history.retry()}
        >
          {tCommon("retry")}
        </Button>
      }
    />
  )

  return (
    <div
      ref={scrollRef}
      className={cn("min-h-0 overflow-y-auto overscroll-contain scrollbar-custom", className)}
      aria-busy={history.loading || history.loadingMore}
    >
      {history.items.length === 0 && errorState}
      {history.loading && history.items.length === 0 ? (
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
      {history.items.length > 0 && errorState}
      {history.hasMore && (
        <div ref={loadMoreRef} className="flex min-h-10 items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
          {history.loadingMore && (
            <span role="status" className="flex items-center gap-2">
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              {t("loading")}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
