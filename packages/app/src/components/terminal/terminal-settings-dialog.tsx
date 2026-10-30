import { lazy, Suspense, useRef } from "react"
import { useTranslation } from "react-i18next"
import { Settings } from "lucide-react"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { PageLoading } from "@/components/page-loading"
import { ResourceBoundary } from "@/components/resource-boundary"
import type { TerminalSettingsContentProps } from "./terminal-settings-content"

const TerminalSettingsContent = lazy(() => import("./terminal-settings-content").then(
  (module) => ({ default: module.TerminalSettingsContent }),
))

export function TerminalSettingsDialog(props: TerminalSettingsContentProps) {
  const { t } = useTranslation("terminal")
  const { t: tCommon } = useTranslation("common")
  const titleRef = useRef<HTMLHeadingElement>(null)

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        dismissOnEscape
        className="flex h-[720px] max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden p-0 sm:max-w-3xl"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          titleRef.current?.focus()
        }}
      >
        <DialogHeader className="shrink-0 px-6 pt-6">
          <DialogTitle ref={titleRef} tabIndex={-1} className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            {t("ariaSettings")}
          </DialogTitle>
        </DialogHeader>
        <ResourceBoundary renderError={(recovery) => (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
            <DialogDescription asChild>{recovery}</DialogDescription>
          </div>
        )}>
          <Suspense fallback={
            <>
              <DialogDescription className="sr-only">{tCommon("loading")}</DialogDescription>
              <PageLoading className="min-h-0" />
            </>
          }>
            <TerminalSettingsContent {...props} />
          </Suspense>
        </ResourceBoundary>
      </DialogContent>
    </Dialog>
  )
}
