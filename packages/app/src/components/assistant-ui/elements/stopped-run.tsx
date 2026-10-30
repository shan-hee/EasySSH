"use client"

import { ArrowRightIcon, SquareIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { MessageTimestamp } from "./timeline"

// Official StoppedRun actions. Partial content remains in the normal Markdown message above.
export function StoppedRun({
  stoppedAt,
  disabled,
  onContinue,
  onDiscard,
  error
}: {
  stoppedAt: string
  disabled: boolean
  onContinue: () => void
  onDiscard: () => void
  error?: string
}) {
  const { t } = useTranslation("aiAssistant")
  return (
    <div data-slot="stopped-run" className="flex w-full flex-col gap-2 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          role="status"
          className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground"
        >
          <SquareIcon aria-hidden className="size-2.5 fill-current" />
          {t("auiRunStopped")}
        </span>
        <MessageTimestamp value={stoppedAt} />
        <Button
          size="sm"
          variant="ghost"
          className="ms-auto h-7 rounded-full px-2.5 text-xs"
          disabled={disabled}
          onClick={onContinue}
        >
          {t("auiContinueRun")}
          <ArrowRightIcon className="size-3" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 rounded-full px-2.5 text-xs text-muted-foreground"
          disabled={disabled}
          onClick={onDiscard}
        >
          {t("auiDiscardRun")}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
