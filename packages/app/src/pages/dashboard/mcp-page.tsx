import { useEffect, useId, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { ChevronRight, CircleStop, ExternalLink, KeyRound, Loader2, Plus } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { PageHeader } from "@/components/page-header"
import { DashboardPageContent } from "@/components/dashboard-page-content"
import { CreateTokenDialog } from "@/components/automation/create-token-dialog"
import { MCPConnection } from "@/components/automation/mcp-connection"
import { MCPToolCatalog } from "@/components/automation/mcp-tool-catalog"
import { TokenEditDialog } from "@/components/automation/token-edit-dialog"
import { TokenPermissionsDialog } from "@/components/automation/token-permissions-dialog"
import { TokenSecretDialog, type ShownToken } from "@/components/automation/token-secret-dialog"
import { TokenTable } from "@/components/automation/token-table"
import type { TaskRunStatus, TaskRunSummary } from "@/components/task-center/task-center-contracts"
import { formatTaskTypeLabel } from "@/components/task-center/task-labels"
import { automationApi, type AccessToken } from "@/lib/api/automation"
import { subscribeRealtimeEvents } from "@/lib/api/realtime-events"
import { taskCenterApi } from "@/lib/api/task-center"
import { getErrorMessage } from "@/lib/error-utils"
import { queryKeys } from "@/lib/query-keys"
import { useRuntime } from "@/shell/runtime"
import { PageLoading } from "@/components/page-loading"

const MCP_TASKS_QUERY_KEY = ["automation", "mcp-recent-tasks"] as const

// Tokens are the credential and MCP is where they are used, so both live on one page.
export default function MCPPage() {
  const { t } = useTranslation("automation")
  const { t: tTask, i18n } = useTranslation("taskCenter")
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { runtime } = useRuntime()
  const web = runtime?.profile === "web"
  const [creating, setCreating] = useState(false)
  const [viewing, setViewing] = useState<AccessToken | null>(null)
  const [editing, setEditing] = useState<AccessToken | null>(null)
  const [shown, setShown] = useState<ShownToken | null>(null)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [cancelingId, setCancelingId] = useState<string | null>(null)
  const toolsContentId = useId()
  const tokens = useQuery({ queryKey: queryKeys.automation.tokens, queryFn: automationApi.listTokens, enabled: web })
  const recentTasks = useQuery({
    queryKey: MCP_TASKS_QUERY_KEY,
    queryFn: () => taskCenterApi.list({ trigger_type: ["api"], page: 1, page_size: 8 }),
    enabled: web,
    refetchInterval: 30_000,
  })

  useEffect(() => {
    if (!web) return
    let timer: number | null = null
    const unsubscribe = subscribeRealtimeEvents((event) => {
      if (!event.type.startsWith("task.")) return
      if (timer !== null) return
      timer = window.setTimeout(() => {
        timer = null
        void queryClient.invalidateQueries({ queryKey: MCP_TASKS_QUERY_KEY })
      }, 400)
    })
    return () => {
      unsubscribe()
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [queryClient, web])

  const handleCancelTask = async (run: TaskRunSummary) => {
    if (cancelingId) return
    setCancelingId(run.id)
    try {
      await taskCenterApi.cancel(run.id)
      toast.success(tTask("cancelRequested"))
      await queryClient.invalidateQueries({ queryKey: MCP_TASKS_QUERY_KEY })
    } catch (error) {
      toast.error(getErrorMessage(error, tTask("cancelFailed")))
    } finally {
      setCancelingId(null)
    }
  }

  if (!web) return <p className="p-4 text-sm text-muted-foreground">{t("webOnly")}</p>

  const mcpRuns = recentTasks.data?.runs ?? []

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
        {tokens.isPending && <PageLoading className="min-h-0 py-10" />}
        {tokens.isError && <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
          {t("loadFailed")}
          <Button variant="outline" size="sm" onClick={() => void tokens.refetch()}>{t("retry")}</Button>
        </div>}
        {tokens.data && (tokens.data.length
          ? <TokenTable tokens={tokens.data} onViewPermissions={setViewing} onEdit={setEditing} onShowToken={(token, value) => setShown({ token, value })} />
          : <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
            <KeyRound className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
            <Button size="sm" variant="outline" onClick={() => setCreating(true)}>{t("createToken")}</Button>
          </div>)}
      </section>

      <section className="shrink-0 space-y-3 rounded-lg border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">{t("recentTasksTitle")}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("recentTasksDescription")}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => navigate("/dashboard/tasks")}
          >
            {t("recentTasksViewAll")}
            <ExternalLink className="ml-1.5 size-3.5" />
          </Button>
        </div>

        {recentTasks.isPending ? (
          <PageLoading className="min-h-0 py-6" />
        ) : mcpRuns.length === 0 ? (
          <p className="rounded-md border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
            {t("recentTasksEmpty")}
          </p>
        ) : (
          <div className="divide-y rounded-md border">
            {mcpRuns.map((run) => {
              const active = run.status === "queued" || run.status === "running" || run.status === "canceling"
              const canCancel = run.cancelable && (run.status === "queued" || run.status === "running")
              return (
                <div key={run.id} className="flex items-center gap-3 px-3 py-2.5 text-xs transition-colors hover:bg-muted/40">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left outline-none"
                    onClick={() => navigate(`/dashboard/tasks?run=${encodeURIComponent(run.id)}`)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{run.title}</span>
                      <Badge variant={mcpStatusVariant(run.status)} className="shrink-0 text-[10px]">
                        {tTask(mcpStatusLabelKey(run.status))}
                      </Badge>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                      <span>{formatTaskTypeLabel(run.task_type, tTask)}</span>
                      {run.server_name ? <span>· {run.server_name}</span> : null}
                      <span className="tabular-nums">
                        · {new Intl.DateTimeFormat(i18n.language, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(run.created_at))}
                      </span>
                    </div>
                    {active ? <Progress value={run.progress} className="mt-1.5 h-1 max-w-xs" /> : null}
                  </button>
                  {canCancel ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={cancelingId === run.id}
                      title={tTask("cancelTask")}
                      aria-label={tTask("cancelTask")}
                      onClick={() => void handleCancelTask(run)}
                    >
                      {cancelingId === run.id ? <Loader2 className="size-3.5 animate-spin" /> : <CircleStop className="size-3.5" />}
                    </Button>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
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
    <TokenEditDialog token={editing} onClose={() => setEditing(null)} />
    <TokenSecretDialog shown={shown} onClose={() => setShown(null)} />
  </>
}

function mcpStatusVariant(status: TaskRunStatus): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "running":
      return "default"
    case "failed":
    case "timeout":
      return "destructive"
    case "succeeded":
    case "canceled":
      return "outline"
    default:
      return "secondary"
  }
}

function mcpStatusLabelKey(status: TaskRunStatus): string {
  const map: Record<TaskRunStatus, string> = {
    queued: "statusQueued",
    running: "statusRunning",
    succeeded: "statusSucceeded",
    failed: "statusFailed",
    partial_success: "statusPartial",
    canceling: "statusCanceling",
    canceled: "statusCanceled",
    timeout: "statusTimeout",
    unknown: "statusUnknown",
  }
  return map[status]
}
