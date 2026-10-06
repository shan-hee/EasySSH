import { lazy, Suspense } from "react"
import { useTranslation } from "react-i18next"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { PageLoading } from "@/components/page-loading"
import { ResourceBoundary } from "@/components/resource-boundary"

const AccountSettingsDialog = lazy(() => import("./account-settings-dialog"))

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation("common")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <ResourceBoundary renderError={(recovery) => (
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>{t("accountSettings")}</DialogTitle>
            {recovery}
          </DialogContent>
        )}>
          <Suspense fallback={
            <DialogContent aria-describedby={undefined}>
              <DialogTitle>{t("accountSettings")}</DialogTitle>
              <PageLoading />
            </DialogContent>
          }>
            <AccountSettingsDialog open={open} setOpen={onOpenChange} />
          </Suspense>
        </ResourceBoundary>
      )}
    </Dialog>
  )
}
