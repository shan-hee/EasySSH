import { useId, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { ChevronRight, KeyRound, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/page-header"
import { DashboardPageContent } from "@/components/dashboard-page-content"
import { CreateTokenDialog } from "@/components/automation/create-token-dialog"
import { MCPConnection } from "@/components/automation/mcp-connection"
import { MCPToolCatalog } from "@/components/automation/mcp-tool-catalog"
import { TokenPermissionsDialog } from "@/components/automation/token-permissions-dialog"
import { TokenTable } from "@/components/automation/token-table"
import { automationApi, type AccessToken } from "@/lib/api/automation"
import { queryKeys } from "@/lib/query-keys"
import { useRuntime } from "@/shell/runtime"

// Tokens are the credential and MCP is where they are used, so both live on one page.
export default function MCPPage() {
  const { t } = useTranslation("automation")
  const { runtime } = useRuntime()
  const web = runtime?.profile === "web"
  const [creating, setCreating] = useState(false)
  const [viewing, setViewing] = useState<AccessToken | null>(null)
  const [toolsOpen, setToolsOpen] = useState(false)
  const toolsContentId = useId()
  const tokens = useQuery({ queryKey: queryKeys.automation.tokens, queryFn: automationApi.listTokens, enabled: web })
  if (!web) return <p className="p-4 text-sm text-muted-foreground">{t("webOnly")}</p>

  return <>
    <PageHeader title={t("mcpTitle")} />
    <DashboardPageContent className="min-h-0 gap-6 overflow-y-auto">
      <section className="shrink-0 space-y-3 rounded-lg border bg-card p-4">
        <div>
          <h2 className="text-sm font-semibold">{t("connectionTitle")}</h2>
          <p className="text-xs text-muted-foreground">{t("connectionDescription")}</p>
        </div>
        <MCPConnection />
      </section>

      <section className="shrink-0 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">{t("tokensTitle")}</h2>
          <Button size="sm" onClick={() => setCreating(true)}><Plus className="size-4" />{t("createToken")}</Button>
        </div>
        {tokens.isPending && <p className="text-sm text-muted-foreground">{t("loading")}</p>}
        {tokens.isError && <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
          {t("loadFailed")}
          <Button variant="outline" size="sm" onClick={() => void tokens.refetch()}>{t("retry")}</Button>
        </div>}
        {tokens.data && (tokens.data.length
          ? <TokenTable tokens={tokens.data} onViewPermissions={setViewing} />
          : <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
            <KeyRound className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
            <Button size="sm" variant="outline" onClick={() => setCreating(true)}>{t("createToken")}</Button>
          </div>)}
      </section>

      <section className="shrink-0 rounded-lg border bg-card">
        <button type="button" aria-expanded={toolsOpen} aria-controls={toolsContentId}
          onClick={() => setToolsOpen(open => !open)}
          className="group flex w-full items-center gap-1.5 rounded-lg p-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-ring">
          <ChevronRight className="size-4 transition-transform duration-200 group-aria-expanded:rotate-90 motion-reduce:transition-none" />{t("toolsTitle")}
        </button>
        {/* Keep the catalog mounted to load before opening; animate intrinsic height, not a loading-state measurement. */}
        <div id={toolsContentId} inert={!toolsOpen} aria-hidden={!toolsOpen}
          className="grid transition-[grid-template-rows] duration-200 ease-in-out motion-reduce:transition-none"
          style={{ gridTemplateRows: toolsOpen ? "1fr" : "0fr" }}>
          <div className="min-h-0 overflow-hidden">
            <div className="space-y-3 px-4 pb-4">
              <p className="text-xs text-muted-foreground">{t("toolsPermissionHelp")}</p>
              <MCPToolCatalog />
            </div>
          </div>
        </div>
      </section>
    </DashboardPageContent>
    <CreateTokenDialog open={creating} onOpenChange={setCreating} />
    <TokenPermissionsDialog token={viewing} onClose={() => setViewing(null)} />
  </>
}
