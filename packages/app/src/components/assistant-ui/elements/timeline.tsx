"use client"

import { useTranslation } from "react-i18next"

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
