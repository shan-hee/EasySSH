import { useTranslation } from "react-i18next"
import { useDelayedLoading } from "@/hooks/use-delayed-loading"
import { Spinner } from "@/components/ui/spinner"

/** Keep the application chrome visible while route code is pending. */
export function RoutePending() {
  const { t } = useTranslation("common", { useSuspense: false })
  const visible = useDelayedLoading(true, 200)
  return (
    <div className="flex min-h-0 w-full flex-1 items-center justify-center" role="status" aria-busy="true" aria-label={t("loading")}>
      {visible && (
        <div aria-hidden="true">
          <Spinner className="size-6 text-muted-foreground" />
        </div>
      )}
    </div>
  )
}
