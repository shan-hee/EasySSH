import type { ComponentProps } from "react"
import type { TFunction } from "i18next"
import { Check, Circle, History, Loader2, Pencil, Search, Trash2, X } from "lucide-react"

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

function statusClass(status: SessionListItem["status"]) {
  if (status === "running") return "fill-primary text-primary"
  if (status === "waiting_confirmation") return "fill-amber-500 text-amber-500"
  if (status === "closed") return "fill-muted-foreground/40 text-muted-foreground/40"
  return "fill-emerald-500 text-emerald-500"
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
        className={cn("ai-command-popover w-[340px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl p-0", className)}
      >
        <div className="border-b border-border/60 p-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={history.search}
              onChange={(event) => history.setSearch(event.target.value)}
              placeholder={t("searchPlaceholder")}
              className="h-9 border-transparent bg-muted/45 pl-8 pr-8 text-sm shadow-none focus-visible:ring-1"
            />
            {history.search && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 size-7 -translate-y-1/2 text-muted-foreground hover:bg-transparent hover:text-foreground"
                onClick={() => history.setSearch("")}
                aria-label={t("cancel")}
              >
                <X className="size-3.5" />
              </Button>
            )}
          </div>
        </div>

        <ScrollArea className="h-[380px]">
          <div className="p-2">
            {history.loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                <span>{t("loading")}</span>
              </div>
            ) : history.error ? (
              <div className="px-3 py-12 text-center text-sm text-destructive">{history.error}</div>
            ) : history.items.length === 0 ? (
              <div className="px-3 py-12 text-center text-sm text-muted-foreground">{t("sessionListEmpty")}</div>
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
                        "group/session grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-lg px-2.5 py-2.5 text-left outline-none transition-colors",
                        active ? "bg-accent text-foreground" : "hover:bg-muted/65 focus-visible:bg-muted/65",
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
                          <div className="flex min-w-0 items-center gap-2">
                            <Circle className={cn("size-2 shrink-0", statusClass(item.status))} />
                            <span className="truncate text-sm font-medium">{item.title}</span>
                          </div>
                        )}
                        {!renaming && (
                          <div className="mt-1.5 flex items-center gap-2 pl-4 text-[11px] text-muted-foreground">
                            {item.scope?.server_name && (
                              <>
                                <span className="max-w-24 truncate">{item.scope.server_name}</span>
                                <span aria-hidden="true">·</span>
                              </>
                            )}
                            <span>{item.model}</span>
                            <span aria-hidden="true">·</span>
                            <span>{t("sidebarMessageCount", { count: item.message_count })}</span>
                            <span className="ml-auto shrink-0">{formatSessionTime(item.updated_at)}</span>
                          </div>
                        )}
                      </div>

                      {!renaming && (
                        <div
                          className="flex shrink-0 items-start gap-0.5 opacity-0 transition-opacity group-hover/session:opacity-100 group-focus-within/session:opacity-100"
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
