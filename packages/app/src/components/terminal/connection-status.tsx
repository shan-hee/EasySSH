import { useTranslation } from "react-i18next"
import type { LucideIcon } from "lucide-react"

interface ConnectionStatusProps {
  icon: LucideIcon
  message: string
  serverName?: string
}

export function ConnectionStatus({ icon: Icon, message, serverName }: ConnectionStatusProps) {
  const { t } = useTranslation("terminal")
  const displayServerName = serverName ?? t("connectionLoaderServerFallback")

  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-3 overflow-hidden px-5 text-foreground"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-busy="true"
      aria-label={`${message}: ${displayServerName}`}
    >
      <Icon className="size-16 shrink-0" aria-hidden="true" />
      <p className="max-w-full truncate text-sm font-medium">{message}</p>
      <p className="max-w-full truncate font-mono text-xs text-muted-foreground">{displayServerName}</p>
    </div>
  )
}
