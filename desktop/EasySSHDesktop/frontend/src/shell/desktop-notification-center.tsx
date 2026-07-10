import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Bell, Check, CheckCheck, CircleCheck, Info, Trash2, TriangleAlert, XCircle } from "@easyssh/ssh-workspace/desktop"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { desktopNotificationsApi, type DesktopNotification } from "../adapters/desktop-notifications-api"
import { subscribeDesktopTaskEvents } from "../adapters/desktop-task-center-api"

const iconMap = { info: Info, success: CircleCheck, warning: TriangleAlert, error: XCircle } as const

export function DesktopNotificationCenter({ onOpenTask }: { onOpenTask: (taskID?: string) => void }) {
  const { t, i18n } = useTranslation("headerActions")
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<DesktopNotification[]>([])
  const [unread, setUnread] = useState(0)

  const load = useCallback(async () => {
    try {
      const result = await desktopNotificationsApi.list()
      setItems(result.notifications ?? [])
      setUnread(result.unread_count ?? 0)
    } catch (error) {
      console.error("Failed to load desktop notifications:", error)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 15000)
    const unsubscribe = subscribeDesktopTaskEvents((event) => {
      if (
        event.type === "task.completed" ||
        event.type === "task.cleanup.completed" ||
        event.type === "task.restore.completed"
      ) {
        void load()
      }
    })
    return () => {
      window.clearInterval(timer)
      unsubscribe()
    }
  }, [load])

  const markRead = useCallback(async (item: DesktopNotification) => {
    if (!item.read_at) {
      try {
        await desktopNotificationsApi.markRead(item.id)
        setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, read_at: new Date().toISOString() } : entry))
        setUnread((value) => Math.max(0, value - 1))
      } catch (error) {
        console.error("Failed to mark desktop notification as read:", error)
      }
    }
    const taskPrefix = "desktop://tasks/"
    if (item.action_url?.startsWith(taskPrefix)) {
      setOpen(false)
      onOpenTask(item.action_url.slice(taskPrefix.length) || undefined)
    }
  }, [onOpenTask])

  return <Popover open={open} onOpenChange={(value) => { setOpen(value); if (value) void load() }}>
    <Tooltip><TooltipTrigger asChild><PopoverTrigger asChild>
      <Button type="button" variant="ghost" size="icon-sm" className="relative" aria-label={t("notificationsTooltip")}>
        <Bell />
        {unread > 0 ? <span className="absolute right-0.5 top-0.5 flex min-h-3.5 min-w-3.5 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-semibold leading-none text-destructive-foreground">{unread > 99 ? "99+" : unread}</span> : null}
      </Button>
    </PopoverTrigger></TooltipTrigger><TooltipContent side="bottom">{t("notificationsTooltip")}</TooltipContent></Tooltip>
    <PopoverContent align="end" sideOffset={8} className="w-[min(420px,calc(100vw-24px))] p-0 [--wails-draggable:no-drag]">
      <div className="flex h-12 items-center justify-between border-b px-3"><span className="text-sm font-semibold">{t("notificationsTitle")}</span><Button variant="ghost" size="icon-sm" disabled={unread === 0} onClick={() => void desktopNotificationsApi.markAllRead().then(load)} title={t("notificationsMarkAllRead")}><CheckCheck className="size-4" /></Button></div>
      <ScrollArea className="h-[min(520px,65vh)]">
        {items.length === 0 ? <div className="px-4 py-12 text-center text-sm text-muted-foreground">{t("notificationsEmpty")}</div> : <div className="divide-y">{items.map((item) => {
          const Icon = iconMap[item.severity] ?? Info
          return <div key={item.id} className={cn("group flex gap-3 px-3 py-3", !item.read_at && "bg-accent/35")}>
            <Icon className={cn("mt-0.5 size-4 shrink-0", item.severity === "error" ? "text-destructive" : item.severity === "warning" ? "text-amber-600" : item.severity === "success" ? "text-emerald-600" : "text-sky-600")} />
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => void markRead(item)}><div className="flex gap-2"><span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</span>{item.read_at ? <Check className="size-3.5 text-muted-foreground" /> : <span className="mt-1.5 size-1.5 rounded-full bg-primary" />}</div><p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.message}</p><span className="mt-1.5 block text-[11px] text-muted-foreground">{new Intl.DateTimeFormat(i18n.language, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(item.created_at))}</span></button>
            <Button variant="ghost" size="icon-sm" className="size-7 opacity-0 group-hover:opacity-100" onClick={() => void desktopNotificationsApi.remove(item.id).then(load)} title={t("notificationsDelete")}><Trash2 className="size-3.5" /></Button>
          </div>
        })}</div>}
      </ScrollArea>
    </PopoverContent>
  </Popover>
}
