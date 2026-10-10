import { lazy, Suspense } from "react"
import { useTranslation } from "react-i18next"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { PageLoading } from "@/components/page-loading"
import { ResourceBoundary } from "@/components/resource-boundary"

const AccountSettingsContent = lazy(() => import("./account-settings-content"))

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation("common")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent
          aria-describedby={undefined}
          className="flex h-[600px] max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 md:max-w-[700px] lg:max-w-[800px]"
        >
          <DialogTitle className="sr-only">{t("accountSettings")}</DialogTitle>
          <ResourceBoundary renderError={(recovery) => (
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">{recovery}</div>
          )}>
            <Suspense fallback={<PageLoading className="min-h-0" />}>
              <AccountSettingsContent open={open} setOpen={onOpenChange} />
            </Suspense>
          </ResourceBoundary>
        </DialogContent>
      )}
    </Dialog>
  )
}
