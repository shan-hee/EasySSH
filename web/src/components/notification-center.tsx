import * as React from "react"
import { useNavigate } from "react-router-dom"
import { AlertTriangle, Bell, Check, CheckCheck, CircleCheck, Info, Trash2, XCircle } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { inboxNotificationsApi, type InboxNotification } from "@/lib/api/inbox-notifications"
import { subscribeRealtimeEvents } from "@/lib/api/realtime-events"

const severityIcons = {
  info: Info,
  success: CircleCheck,
  warning: AlertTriangle,
  error: XCircle,
} as const

export function NotificationCenter() {
  const { t, i18n } = useTranslation("headerActions")
  const navigate = useNavigate()
  const [open, setOpen] = React.useState(false)
  const [items, setItems] = React.useState<InboxNotification[]>([])
  const [unreadCount, setUnreadCount] = React.useState(0)
  const [loading, setLoading] = React.useState(false)

  const loadNotifications = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const result = await inboxNotificationsApi.list({ page: 1, page_size: 40 })
      setItems(result.notifications ?? [])
      setUnreadCount(result.unread_count ?? 0)
    } catch (error) {
      if (!silent) console.error("Failed to load notifications:", error)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void loadNotifications(true)
    let refreshTimer: number | null = null
    const unsubscribe = subscribeRealtimeEvents((event) => {
      if (!event.type.startsWith("notification.") || refreshTimer !== null) return
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null
        void loadNotifications(true)
      }, 200)
    })
    const timer = window.setInterval(() => void loadNotifications(true), 60000)
    return () => {
      unsubscribe()
      if (refreshTimer !== null) window.clearTimeout(refreshTimer)
      window.clearInterval(timer)
    }
  }, [loadNotifications])

  const markRead = React.useCallback(async (item: InboxNotification) => {
    if (!item.read_at) {
      await inboxNotificationsApi.markRead(item.id)
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, read_at: new Date().toISOString() } : entry))
      setUnreadCount((count) => Math.max(0, count - 1))
    }
    if (item.action_url) {
      setOpen(false)
      navigate(item.action_url)
    }
  }, [navigate])

  const markAllRead = React.useCallback(async () => {
    await inboxNotificationsApi.markAllRead()
    const readAt = new Date().toISOString()
    setItems((current) => current.map((item) => ({ ...item, read_at: item.read_at ?? readAt })))
    setUnreadCount(0)
  }, [])

  const remove = React.useCallback(async (id: string) => {
    const target = items.find((item) => item.id === id)
    await inboxNotificationsApi.remove(id)
    setItems((current) => current.filter((item) => item.id !== id))
    if (target && !target.read_at) setUnreadCount((count) => Math.max(0, count - 1))
  }, [items])

  return (
    <Popover open={open} onOpenChange={(next) => {
      setOpen(next)
      if (next) void loadNotifications()
    }}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="relative" aria-label={t("notificationsTooltip")}>
              <Bell />
              {unreadCount > 0 ? (
                <span className="absolute right-0.5 top-0.5 flex min-h-3.5 min-w-3.5 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-semibold leading-none text-destructive-foreground">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              ) : null}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("notificationsTooltip")}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" sideOffset={8} className="w-[min(420px,calc(100vw-24px))] p-0">
        <div className="flex h-12 items-center justify-between border-b px-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{t("notificationsTitle")}</span>
            {unreadCount > 0 ? <span className="text-xs tabular-nums text-muted-foreground">{unreadCount}</span> : null}
          </div>
          <Button variant="ghost" size="icon-sm" disabled={unreadCount === 0} onClick={() => void markAllRead()} title={t("notificationsMarkAllRead")}>
            <CheckCheck className="size-4" />
          </Button>
        </div>
        <ScrollArea className="h-[min(520px,65vh)]">
          {loading && items.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">{t("notificationsLoading")}</div>
          ) : items.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">{t("notificationsEmpty")}</div>
          ) : (
            <div className="divide-y">
              {items.map((item) => {
                const Icon = severityIcons[item.severity] ?? Info
                return (
                  <div key={item.id} className={cn("group flex gap-3 px-3 py-3", !item.read_at && "bg-accent/35")}>
                    <Icon className={cn("mt-0.5 size-4 shrink-0", severityClassName(item.severity))} />
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => void markRead(item)}>
                      <div className="flex items-start gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</span>
                        {!item.read_at ? <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" /> : <Check className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.message}</p>
                      <span className="mt-1.5 block text-[11px] text-muted-foreground">{formatNotificationTime(item.created_at, i18n.language)}</span>
                    </button>
                    <Button variant="ghost" size="icon-sm" className="size-7 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => void remove(item.id)} title={t("notificationsDelete")}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}

function severityClassName(severity: InboxNotification["severity"]) {
  if (severity === "success") return "text-emerald-600 dark:text-emerald-400"
  if (severity === "warning") return "text-amber-600 dark:text-amber-400"
  if (severity === "error") return "text-destructive"
  return "text-sky-600 dark:text-sky-400"
}

function formatNotificationTime(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value))
}
