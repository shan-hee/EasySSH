import type { ComponentProps } from "react"
import type { TFunction } from "i18next"
import { Check, History, Loader2, Pencil, Search, Trash2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
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

function formatSessionTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

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
    <Popover open={history.open} onOpenChange={history.setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={triggerClassName}
          aria-label={t("sidebarTitle")}
          title={t("sidebarTitle")}
        >
          <History className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={8}
        className={cn("w-[330px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg p-0 shadow-2xl", className)}
      >
        <div className="border-b border-border/60 p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={history.search}
              onChange={(event) => history.setSearch(event.target.value)}
              placeholder={t("searchPlaceholder")}
              className="h-8 border-transparent bg-muted/50 pl-8 pr-8 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            {history.search && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 size-6 -translate-y-1/2 text-muted-foreground hover:bg-transparent hover:text-foreground"
                onClick={() => history.setSearch("")}
                aria-label={t("cancel")}
              >
                <X className="size-3.5" />
              </Button>
            )}
          </div>
        </div>

        <ScrollArea className="h-[360px]">
          <div className="p-2">
            {history.loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                <span>{t("loading")}</span>
              </div>
            ) : history.error ? (
              <div className="px-3 py-10 text-center text-sm text-destructive">{history.error}</div>
            ) : history.items.length === 0 ? (
              <div className="px-3 py-10 text-center text-sm text-muted-foreground">{t("sessionListEmpty")}</div>
            ) : (
              <div className="space-y-1">
                {history.items.map((item) => {
                  const active = item.id === activeSessionId
                  const renaming = history.renamingId === item.id
                  const actionLoading = history.actionLoadingId === item.id
                  return (
                    <div
                      key={item.id}
                      className={cn(
                        "grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-md px-2 py-2 text-left outline-none transition-colors",
                        active ? "bg-accent text-foreground" : "hover:bg-accent focus-visible:bg-accent",
                      )}
                      onClick={() => void onRestore(item.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (!renaming && (event.key === "Enter" || event.key === " ")) {
                          event.preventDefault()
                          void onRestore(item.id)
                        }
                      }}
                    >
                      <div className="min-w-0">
                        {renaming ? (
                          <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                            <Input
                              autoFocus
                              value={history.renameDraft}
                              onChange={(event) => history.setRenameDraft(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault()
                                  void history.submitRename(item.id)
                                } else if (event.key === "Escape") {
                                  event.preventDefault()
                                  history.cancelRename()
                                }
                              }}
                              className="h-7 min-w-0 text-xs"
                              disabled={actionLoading}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-7 shrink-0"
                              disabled={actionLoading}
                              onClick={(event) => {
                                event.stopPropagation()
                                void history.submitRename(item.id)
                              }}
                              aria-label={t("saveSessionTitle")}
                            >
                              {actionLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-7 shrink-0"
                              disabled={actionLoading}
                              onClick={(event) => {
                                event.stopPropagation()
                                history.cancelRename()
                              }}
                              aria-label={t("cancel")}
                            >
                              <X className="size-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <div className="truncate text-sm font-medium">{item.title}</div>
                        )}
                        {!renaming && (
                          <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                            <span>{t("sidebarMessageCount", { count: item.message_count })}</span>
                            <span className="shrink-0">{formatSessionTime(item.updated_at)}</span>
                          </div>
                        )}
                      </div>

                      {!renaming && (
                        <div
                          className="flex shrink-0 items-start gap-0.5 opacity-100"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground hover:text-foreground"
                            disabled={Boolean(history.actionLoadingId)}
                            onClick={() => history.beginRename(item)}
                            aria-label={t("rename")}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground hover:text-destructive"
                            disabled={Boolean(history.actionLoadingId)}
                            onClick={() => void onDelete(item.id)}
                            aria-label={t("delete")}
                          >
                            {actionLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                          </Button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
