"use client"

// Official Elements controlled ThreadList; row actions are wired to the host's persistence.
import { Fragment, useEffect, useRef, type ComponentProps } from "react"
import {
  CheckIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import { SidebarGroupLabel } from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TooltipIconButton } from "./tooltip-icon-button"
import { field, mono } from "./surfaces"
import { cn } from "@/lib/utils"

export interface ThreadItem {
  id: string
  title: string
  updatedAt: string
  description?: string
}

interface ThreadListEditing {
  id: string | null
  value: string
  onValueChange: (value: string) => void
  onSave: (id: string) => void | Promise<unknown>
  onCancel: () => void
}

export function ThreadList({
  threads,
  activeId,
  busyId,
  editing,
  onSelect,
  onRename,
  onDelete,
  className,
  compact = false,
  ...props
}: Omit<ComponentProps<"div">, "onSelect"> & {
  threads: readonly ThreadItem[]
  activeId: string | null
  busyId: string | null
  compact?: boolean
  editing: ThreadListEditing
  onSelect: (id: string) => void | Promise<void>
  onRename: (id: string) => void
  onDelete: (id: string) => void | Promise<void>
}) {
  const { t, i18n } = useTranslation("aiAssistant")
  const listRef = useRef<HTMLDivElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const previousEditingIdRef = useRef<string | null>(null)
  useEffect(() => {
    const previousId = previousEditingIdRef.current
    previousEditingIdRef.current = editing.id
    if (editing.id && !busyId) {
      renameInputRef.current?.focus()
    } else if (previousId && !editing.id) {
      const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("[data-thread-id]")
      Array.from(buttons ?? [])
        .find((button) => button.dataset.threadId === previousId)
        ?.focus()
    }
  }, [editing.id, busyId])
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const sortedThreads = [...threads].sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  )
  const groups = [
    {
      label: t("auiToday"),
      items: sortedThreads.filter((item) => new Date(item.updatedAt) >= today),
    },
    {
      label: t("auiYesterday"),
      items: sortedThreads.filter(
        (item) => new Date(item.updatedAt) >= yesterday && new Date(item.updatedAt) < today,
      ),
    },
    {
      label: t("auiEarlier"),
      items: sortedThreads.filter((item) => new Date(item.updatedAt) < yesterday),
    },
  ]

  return (
    <div
      data-slot="thread-list"
      className={cn("flex w-full flex-col gap-0.5", className)}
      {...props}
      ref={listRef}
    >
      {groups
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <Fragment key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            {group.items.map((thread) => {
              const active = thread.id === activeId
              const renaming = editing.id === thread.id
              const busy = Boolean(busyId)
              return (
                <div
                  key={thread.id}
                  data-active={active || undefined}
                  className={cn(
                    "group flex w-full items-center gap-1 rounded-xl px-2 py-1 transition-colors",
                    active ? field : "hover:bg-foreground/[0.03]",
                  )}
                >
                  {renaming ? (
                    <form
                      className="flex min-w-0 flex-1 items-center gap-1"
                      onSubmit={(event) => {
                        event.preventDefault()
                        if (!busy) void editing.onSave(thread.id)
                      }}
                    >
                      <Input
                        ref={renameInputRef}
                        autoFocus
                        value={editing.value}
                        onChange={(event) => editing.onValueChange(event.target.value)}
                        aria-label={t("rename")}
                        disabled={busy}
                        className="h-7 min-w-0 flex-1 text-sm"
                        onKeyDown={(event) => {
                          if (event.nativeEvent.isComposing || event.keyCode === 229) {
                            if (event.key === "Enter") event.preventDefault()
                            return
                          }
                          if (event.key === "Escape") {
                            event.preventDefault()
                            event.stopPropagation()
                            editing.onCancel()
                          }
                        }}
                      />
                      <TooltipIconButton
                        type="submit"
                        tooltip={t("saveSessionTitle")}
                        disabled={busy || !editing.value.trim()}
                      >
                        {busy ? (
                          <Loader2Icon className="size-3.5 animate-spin" />
                        ) : (
                          <CheckIcon className="size-3.5" />
                        )}
                      </TooltipIconButton>
                      <TooltipIconButton
                        type="button"
                        tooltip={t("cancel")}
                        disabled={busy}
                        onClick={editing.onCancel}
                      >
                        <XIcon className="size-3.5" />
                      </TooltipIconButton>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        data-thread-id={thread.id}
                        title={thread.title}
                        aria-current={active || undefined}
                        disabled={busy || Boolean(editing.id)}
                        onClick={() => void onSelect(thread.id)}
                        className="min-w-0 flex-1 rounded-lg px-1 py-1 text-start text-[13.5px] outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                      >
                        <span className="block truncate">{thread.title}</span>
                        <span
                          className={cn(
                            mono,
                            "mt-0.5 flex items-center justify-between gap-2 text-muted-foreground",
                          )}
                        >
                          <span className="truncate">{thread.description}</span>
                          <time dateTime={thread.updatedAt} className="shrink-0">
                            {new Date(thread.updatedAt).toLocaleString(i18n.language, {
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </time>
                        </span>
                      </button>
                      {compact ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <TooltipIconButton
                              tooltip={t("moreActions")}
                              disabled={busy || Boolean(editing.id)}
                              className="size-7 shrink-0"
                            >
                              {busyId === thread.id ? (
                                <Loader2Icon className="size-3.5 animate-spin" />
                              ) : (
                                <MoreHorizontalIcon className="size-4" />
                              )}
                            </TooltipIconButton>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent side="right" align="start">
                            <DropdownMenuItem onSelect={() => onRename(thread.id)}>
                              <PencilIcon className="size-4" />
                              {t("rename")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => void onDelete(thread.id)}
                            >
                              <Trash2Icon className="size-4" />
                              {t("delete")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <div className="flex shrink-0 items-center gap-0.5">
                          <TooltipIconButton
                            type="button"
                            tooltip={t("rename")}
                            disabled={busy || Boolean(editing.id)}
                            onClick={() => onRename(thread.id)}
                          >
                            <PencilIcon className="size-3" />
                          </TooltipIconButton>
                          <TooltipIconButton
                            type="button"
                            tooltip={t("delete")}
                            disabled={busy || Boolean(editing.id)}
                            onClick={() => void onDelete(thread.id)}
                            className="hover:text-destructive"
                          >
                            {busyId === thread.id ? (
                              <Loader2Icon className="size-3 animate-spin" />
                            ) : (
                              <Trash2Icon className="size-3" />
                            )}
                          </TooltipIconButton>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </Fragment>
        ))}
    </div>
  )
}
