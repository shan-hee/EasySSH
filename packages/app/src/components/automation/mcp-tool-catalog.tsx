import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { automationApi } from "@/lib/api/automation"
import { queryKeys } from "@/lib/query-keys"
import { PageLoading } from "@/components/page-loading"

export function MCPToolCatalog() {
  const { t } = useTranslation("automation")
  const tools = useQuery({ queryKey: queryKeys.automation.tools, queryFn: automationApi.listTools, staleTime: Infinity })
  if (tools.isPending) return <PageLoading className="min-h-0 py-6" />
  if (tools.isError) return <p role="alert" className="text-sm text-destructive">{t("toolsFailed")}</p>
  return <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
    {tools.data.map(tool => <li key={tool.name} className="min-w-0">
      <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-medium">{t(`toolNames.${tool.name}`, { defaultValue: tool.name })}</span>
        <code className="text-xs text-muted-foreground">{tool.name}</code>
      </p>
      <p className="text-xs text-muted-foreground">{t(`toolDescriptions.${tool.name}`, { defaultValue: tool.description })}</p>
    </li>)}
  </ul>
}
