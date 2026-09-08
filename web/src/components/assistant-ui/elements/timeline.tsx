"use client"

import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"

export type TimelineEvent = {
  id: string
  time: string
  title: string
  detail?: string
  active?: boolean
}

// The official Elements timestamps presentation is exported as Timeline.
export function Timeline({ events }: { events: readonly TimelineEvent[] }) {
  const { i18n } = useTranslation()
  const validEvents = events.filter((event) => Number.isFinite(Date.parse(event.time)))
  if (!validEvents.length) return null
  return (
    <ol
      data-slot="timeline"
      className="flex min-w-0 flex-col rounded-xl border border-border bg-background p-3"
    >
      {validEvents.map((event, index) => (
        <li key={event.id} className="grid grid-cols-[auto_1rem_minmax(0,1fr)] gap-x-2">
          <time
            dateTime={event.time}
            title={new Date(event.time).toLocaleString(i18n.language)}
            className="pt-0.5 text-end font-mono text-xs tabular-nums text-muted-foreground"
          >
            {new Date(event.time).toLocaleTimeString(i18n.language, {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit"
            })}
          </time>
          <span aria-hidden className="flex flex-col items-center">
            <span
              className={cn(
                "mt-1.5 size-2 shrink-0 rounded-full",
                event.active ? "bg-primary ring-4 ring-primary/15" : "bg-muted-foreground/50"
              )}
            />
            {index < validEvents.length - 1 && <span className="w-px flex-1 bg-border" />}
          </span>
          <div className={cn("min-w-0", index < validEvents.length - 1 && "pb-3")}>
            <span className={cn("text-sm text-foreground", event.active && "font-medium")}>
              {event.title}
            </span>
            {event.detail && (
              <p className="break-words text-xs leading-relaxed text-muted-foreground">
                {event.detail}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

export function MessageTimestamp({ value }: { value?: string }) {
  const { i18n } = useTranslation()
  if (!value || !Number.isFinite(Date.parse(value))) return null
  return (
    <time
      data-slot="message-timestamp"
      dateTime={value}
      title={new Date(value).toLocaleString(i18n.language)}
      className="font-mono text-xs tabular-nums text-muted-foreground"
    >
      {new Date(value).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" })}
    </time>
  )
}
