import * as React from "react"
import { AlertTriangle, Bell, CheckCheck, CircleCheck, Eraser, Info, Trash2, XCircle } from "lucide-react"
import { useTranslation } from "react-i18next"

import { PageLoading } from "@/components/page-loading"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { toast } from "@/components/ui/sonner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export interface NotificationCenterItem {
  id: string
  event_type: string
  severity: "info" | "success" | "warning" | "error"
  title: string
  message: string
  source_type?: string
  source_id?: string
  read_at?: string
  created_at: string
}

/** 宿主提供的通知数据源；Web 走服务端接口，桌面走本机服务。 */
export interface NotificationCenterSource {
  list: () => Promise<{ notifications: NotificationCenterItem[]; unread_count: number }>
  markRead: (id: string) => Promise<unknown>
  markAllRead: () => Promise<unknown>
  remove: (id: string) => Promise<unknown>
  clearRead: () => Promise<unknown>
  /** 通知可能变化时回调，返回取消订阅函数。 */
  subscribe: (onChange: () => void) => () => void
}

interface NotificationCenterProps {
  source: NotificationCenterSource
  /** 打开任务中心；传入运行 ID 时定位到该次运行。 */
  onOpenTask: (runId?: string) => void
}

// 实时事件断开期间的补偿刷新。
const FALLBACK_REFRESH_MS = 60_000

const severityIcons = {
  info: Info,
  success: CircleCheck,
  warning: AlertTriangle,
  error: XCircle,
} as const

export function NotificationCenter({ source, onOpenTask }: NotificationCenterProps) {
  const { t, i18n } = useTranslation("headerActions")
  const [open, setOpen] = React.useState(false)
  const [items, setItems] = React.useState<NotificationCenterItem[] | null>(null)
  const [unreadCount, setUnreadCount] = React.useState(0)
  const [loadFailed, setLoadFailed] = React.useState(false)
  const requestRef = React.useRef(0)

  const load = React.useCallback(async () => {
    const request = ++requestRef.current
    try {
      const result = await source.list()
      if (request !== requestRef.current) return
      setItems(result.notifications)
      setUnreadCount(result.unread_count)
      setLoadFailed(false)
    } catch (error) {
      if (request !== requestRef.current) return
      console.error("Failed to load notifications:", error)
      setLoadFailed(true)
    }
  }, [source])

  React.useEffect(() => {
    void load()
    let pending: number | null = null
    const unsubscribe = source.subscribe(() => {
      if (pending !== null) return
      pending = window.setTimeout(() => {
        pending = null
        void load()
      }, 200)
    })
    const interval = window.setInterval(() => void load(), FALLBACK_REFRESH_MS)
    return () => {
      unsubscribe()
      window.clearInterval(interval)
      if (pending !== null) window.clearTimeout(pending)
    }
  }, [load, source])

  // 先更新界面，失败时提示并以服务端状态为准。
  const commit = React.useCallback((request: Promise<unknown>, failedMessage: string) => {
    request.catch((error: unknown) => {
      console.error(failedMessage, error)
      toast.error(failedMessage)
      void load()
    })
  }, [load])

  const openItem = (item: NotificationCenterItem) => {
    if (item.source_type === "task_run" && item.source_id) {
      setOpen(false)
      onOpenTask(item.source_id)
    }
    if (item.read_at) return
    const readAt = new Date().toISOString()
    setItems((current) => current?.map((entry) => (entry.id === item.id ? { ...entry, read_at: readAt } : entry)) ?? current)
    setUnreadCount((count) => Math.max(0, count - 1))
    commit(source.markRead(item.id), t("notificationsMarkReadFailed"))
  }

  const markAllRead = () => {
    const readAt = new Date().toISOString()
    setItems((current) => current?.map((entry) => ({ ...entry, read_at: entry.read_at || readAt })) ?? current)
    setUnreadCount(0)
    commit(source.markAllRead(), t("notificationsMarkAllReadFailed"))
  }

  const clearRead = () => {
    setItems((current) => current?.filter((entry) => !entry.read_at) ?? current)
    commit(source.clearRead(), t("notificationsClearReadFailed"))
  }

  const remove = (item: NotificationCenterItem) => {
    setItems((current) => current?.filter((entry) => entry.id !== item.id) ?? current)
    if (!item.read_at) setUnreadCount((count) => Math.max(0, count - 1))
    commit(source.remove(item.id), t("notificationsDeleteFailed"))
  }

  const hasRead = items?.some((item) => item.read_at) ?? false

  return (
    <Popover open={open} onOpenChange={(next) => {
      setOpen(next)
      if (next) void load()
    }}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" className="relative" aria-label={t("notificationsTooltip")}>
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
      <PopoverContent align="end" sideOffset={8} className="w-[min(400px,calc(100vw-24px))] p-0 [--wails-draggable:no-drag]">
        <div className="flex h-11 items-center gap-0.5 border-b pl-3 pr-1.5">
          <span className="flex-1 text-sm font-semibold">{t("notificationsTitle")}</span>
          <Button variant="ghost" size="icon-sm" className="size-7" disabled={unreadCount === 0} onClick={markAllRead} title={t("notificationsMarkAllRead")} aria-label={t("notificationsMarkAllRead")}>
            <CheckCheck className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" className="size-7" disabled={!hasRead} onClick={clearRead} title={t("notificationsClearRead")} aria-label={t("notificationsClearRead")}>
            <Eraser className="size-4" />
          </Button>
        </div>
        <ScrollArea className="h-[min(480px,60vh)]">
          {items?.length ? (
            <div className="divide-y">
              {items.map((item) => {
                const Icon = severityIcons[item.severity] ?? Info
                const unread = !item.read_at
                return (
                  <div key={item.id} className="group relative flex gap-3 py-2.5 pl-4 pr-1.5 transition-colors hover:bg-muted/50">
                    {unread ? <span className="absolute left-1.5 top-[17px] size-1.5 rounded-full bg-primary" /> : null}
                    <Icon className={cn("mt-0.5 size-4 shrink-0", severityClassName(item.severity))} />
                    <button type="button" className="min-w-0 flex-1 text-left outline-none" onClick={() => openItem(item)}>
                      <span className="flex items-baseline gap-2">
                        <span className={cn("min-w-0 flex-1 truncate text-sm", unread ? "font-medium" : "text-muted-foreground")}>
                          {t(`notificationEvents.${item.event_type}`, { defaultValue: item.title })}
                        </span>
                        <time dateTime={item.created_at} className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                          {formatNotificationTime(item.created_at, i18n.language)}
                        </time>
                      </span>
                      {item.message ? <span className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.message}</span> : null}
                    </button>
                    <Button variant="ghost" size="icon-sm" className="size-7 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => remove(item)} title={t("notificationsDelete")} aria-label={t("notificationsDelete")}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )
              })}
            </div>
          ) : loadFailed ? (
            <div className="flex flex-col items-center gap-3 px-4 py-12 text-center text-sm text-muted-foreground">
              {t("notificationsLoadFailed")}
              <Button variant="outline" size="sm" onClick={() => void load()}>{t("notificationsRetry")}</Button>
            </div>
          ) : items === null ? (
            <PageLoading className="min-h-0 py-12" />
          ) : (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">{t("notificationsEmpty")}</div>
          )}
        </ScrollArea>
        <div className="border-t p-1">
          <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground" onClick={() => {
            setOpen(false)
            onOpenTask()
          }}>
            {t("notificationsViewAll")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function severityClassName(severity: NotificationCenterItem["severity"]) {
  if (severity === "success") return "text-emerald-600 dark:text-emerald-400"
  if (severity === "warning") return "text-amber-600 dark:text-amber-400"
  if (severity === "error") return "text-destructive"
  return "text-sky-600 dark:text-sky-400"
}

function formatNotificationTime(value: string, locale: string) {
  const date = new Date(value)
  const elapsedSeconds = Math.round((Date.now() - date.getTime()) / 1000)
  if (elapsedSeconds < 3600 * 24) {
    const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" })
    if (elapsedSeconds < 60) return relative.format(0, "second")
    if (elapsedSeconds < 3600) return relative.format(-Math.floor(elapsedSeconds / 60), "minute")
    return relative.format(-Math.floor(elapsedSeconds / 3600), "hour")
  }
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return new Intl.DateTimeFormat(locale, {
    ...(sameYear ? {} : { year: "numeric" }),
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}
