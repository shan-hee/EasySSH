import { useTranslation } from "react-i18next"
import { Skeleton } from "@/components/ui/skeleton"

export function SettingsLoading() {
  const { t } = useTranslation("common")

  return (
    <div className="min-h-52 space-y-5 p-4" role="status" aria-busy="true">
      <span className="sr-only">{t("loading")}</span>
      <div className="space-y-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-2/3 max-w-md" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full sm:col-span-2" />
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-9 w-24" />
      </div>
    </div>
  )
}
