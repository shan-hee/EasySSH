
import { Suspense } from "react"
import { PageHeader } from "@/components/page-header"
import { useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { LogsClient } from "@/components/logs/logs-client"
import { logsApi } from "@/lib/api/logs"

export default function LogsPage() {
  const { t } = useTranslation("logsAudit")

  return (
    <>
      <PageHeader title={t("logsPageTitle")} />
      <Suspense fallback={<div className="flex min-h-0 flex-1" />}>
        <LogsPageContent />
      </Suspense>
    </>
  )
}

function LogsPageContent() {
  const [searchParams] = useSearchParams()
  const action = searchParams.get("action") || undefined

  return <LogsClient api={logsApi} defaultAction={action} />
}
