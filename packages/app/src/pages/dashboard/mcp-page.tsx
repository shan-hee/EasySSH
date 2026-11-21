import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import {
  Activity,
  CircleStop,
  ExternalLink,
  KeyRound,
  Loader2,
  Plug,
  Plus,
  Wrench,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageHeader } from "@/components/page-header"
import { DashboardPageContent } from "@/components/dashboard-page-content"
import { CreateTokenDialog } from "@/components/automation/create-token-dialog"
import { CopyButton, MCPConnection } from "@/components/automation/mcp-connection"
import { MCPToolCatalog } from "@/components/automation/mcp-tool-catalog"
import { TokenEditDialog } from "@/components/automation/token-edit-dialog"
import { TokenPermissionsDialog } from "@/components/automation/token-permissions-dialog"
import { TokenSecretDialog, type ShownToken } from "@/components/automation/token-secret-dialog"
import { TokenTable } from "@/components/automation/token-table"
import type { TaskRunSummary } from "@/components/task-center/task-center-contracts"
import { formatTaskTypeLabel } from "@/components/task-center/task-labels"
import {
  formatRunDuration,
  isTaskActive,
  TaskStatusPill,
  TaskTypeAvatar,
} from "@/components/task-center/task-visuals"
import { automationApi, type AccessToken } from "@/lib/api/automation"
import { getApiUrl } from "@/lib/api-client"
import { subscribeRealtimeEvents } from "@/lib/api/realtime-events"
import { taskCenterApi } from "@/lib/api/task-center"
import { getErrorMessage } from "@/lib/error-utils"
import { queryKeys } from "@/lib/query-keys"
import { useRuntime } from "@/shell/runtime"
import { PageLoading } from "@/components/page-loading"

const MCP_TASKS_QUERY_KEY = ["automation", "mcp-recent-tasks"] as const

// Developer-console style MCP hub: quick-connect hero on top, focused 3-tab capability stage below.
export default function MCPPage() {
  const { t } = useTranslation("automation")
  const { t: tTask, i18n } = useTranslation("taskCenter")
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { runtime } = useRuntime()
  const web = runtime?.profile === "web"

  const [activeTab, setActiveTab] = useState<"tokens" | "tools" | "runs">("tokens")
  const [creating, setCreating] = useState(false)
  const [viewing, setViewing] = useState<AccessToken | null>(null)
  const [editing, setEditing] = useState<AccessToken | null>(null)
  const [shown, setShown] = useState<ShownToken | null>(null)
  const [cancelingId, setCancelingId] = useState<string | null>(null)

  const endpoint = useMemo(
    () => (typeof window === "undefined" ? "/api/v1/mcp" : new URL(getApiUrl("/mcp"), window.location.href).href),
    [],
  )

  const tokens = useQuery({
    queryKey: queryKeys.automation.tokens,
    queryFn: automationApi.listTokens,
    enabled: web,
  })
  const toolsQuery = useQuery({
    queryKey: queryKeys.automation.tools,
    queryFn: automationApi.listTools,
    enabled: web,
    staleTime: Infinity,
  })
  const recentTasks = useQuery({
    queryKey: MCP_TASKS_QUERY_KEY,
    queryFn: () => taskCenterApi.list({ trigger_type: ["api"], page: 1, page_size: 15 }),
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

  const activeTokenCount = (tokens.data ?? []).filter((item) => item.active).length
  const toolsCount = toolsQuery.data?.length ?? 0
  const mcpRuns = recentTasks.data?.runs ?? []
  const runningMcpCount = mcpRuns.filter((run) => isTaskActive(run.status)).length

  return (
    <>
      <PageHeader title={t("mcpTitle")} />
      <DashboardPageContent className="min-h-0 gap-5 overflow-y-auto">
        {/* 顶部开发者快速接入 Hero：左协议身份与端点，右深色终端风格客户端配置块 */}
        <section className="relative shrink-0 overflow-hidden rounded-2xl border bg-card">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,color-mix(in_oklab,var(--primary)_7%,transparent),transparent_52%)]"
          />
          <div className="relative grid gap-6 p-5 sm:p-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.15fr)] xl:items-center">
            <div className="min-w-0 space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                <Plug className="size-3.5 text-primary" />
                <span>{t("protocolBadge")}</span>
              </div>

              <div className="space-y-1.5">
                <h2 className="text-lg font-semibold tracking-tight text-foreground">
                  {t("connectionTitle")}
                </h2>
                <p className="max-w-xl text-xs leading-5 text-muted-foreground sm:text-sm">
                  {t("connectionDescription")}
                </p>
              </div>

              <div className="space-y-1.5">
                <span className="text-[11px] font-medium text-muted-foreground">
                  {t("endpointLabel")}
                </span>
                <div className="flex items-center gap-2 rounded-xl border bg-muted/40 py-1.5 pl-3 pr-1.5">
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
                    HTTP
                  </span>
                  <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground sm:text-sm">
                    {endpoint}
                  </code>
                  <CopyButton value={endpoint} label={t("copyEndpoint")} />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button size="sm" onClick={() => setCreating(true)}>
                  <Plus className="mr-1.5 size-4" />
                  {t("createToken")}
                </Button>
                <span className="inline-flex items-center gap-1.5 rounded-full border bg-background/70 px-2.5 py-1 text-xs text-muted-foreground tabular-nums">
                  <KeyRound className="size-3.5" />
                  {t("activeTokensSummary", { count: activeTokenCount })}
                </span>
                {toolsCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setActiveTab("tools")}
                    className="inline-flex items-center gap-1.5 rounded-full border bg-background/70 px-2.5 py-1 text-xs text-muted-foreground tabular-nums transition-colors hover:border-foreground/20 hover:text-foreground"
                  >
                    <Wrench className="size-3.5" />
                    {t("toolsCountSummary", { count: toolsCount })}
                  </button>
                ) : null}
                {runningMcpCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setActiveTab("runs")}
                    className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/25 bg-sky-500/10 px-2.5 py-1 text-xs font-medium text-sky-700 tabular-nums transition-colors hover:bg-sky-500/15 dark:text-sky-300"
                  >
                    <Loader2 className="size-3 animate-spin" />
                    {t("runningTasksSummary", { count: runningMcpCount })}
                  </button>
                ) : null}
              </div>
            </div>

            <div className="min-w-0">
              <MCPConnection variant="hero" />
            </div>
          </div>
        </section>

        {/* 下方三标签焦点舞台：访问令牌凭证墙 / 分组工具能力目录 / 实时调用流 */}
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as "tokens" | "tools" | "runs")}
          className="flex shrink-0 flex-col gap-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
            <TabsList>
              <TabsTrigger value="tokens" className="gap-1.5">
                <KeyRound className="size-3.5" />
                <span>{t("tabs.tokens")}</span>
                <span className="rounded-full bg-muted px-1.5 py-0.25 text-[10px] font-medium tabular-nums text-muted-foreground">
                  {activeTokenCount}
                </span>
              </TabsTrigger>
              <TabsTrigger value="tools" className="gap-1.5">
                <Wrench className="size-3.5" />
                <span>{t("tabs.tools")}</span>
                {toolsCount > 0 ? (
                  <span className="rounded-full bg-muted px-1.5 py-0.25 text-[10px] font-medium tabular-nums text-muted-foreground">
                    {toolsCount}
                  </span>
                ) : null}
              </TabsTrigger>
              <TabsTrigger value="runs" className="gap-1.5">
                <Activity className="size-3.5" />
                <span>{t("tabs.runs")}</span>
                {runningMcpCount > 0 ? (
                  <span className="rounded-full bg-sky-500/15 px-1.5 py-0.25 text-[10px] font-semibold tabular-nums text-sky-700 dark:text-sky-300">
                    {runningMcpCount}
                  </span>
                ) : mcpRuns.length > 0 ? (
                  <span className="rounded-full bg-muted px-1.5 py-0.25 text-[10px] font-medium tabular-nums text-muted-foreground">
                    {mcpRuns.length}
                  </span>
                ) : null}
              </TabsTrigger>
            </TabsList>

            {activeTab === "runs" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => navigate("/dashboard/tasks")}
              >
                {t("recentTasksViewAll")}
                <ExternalLink className="ml-1.5 size-3.5" />
              </Button>
            ) : null}
          </div>

          <TabsContent value="tokens" className="mt-0">
            {tokens.isPending && <PageLoading className="min-h-0 py-10" />}
            {tokens.isError && (
              <div role="alert" className="flex items-center gap-3 rounded-xl border p-4 text-sm text-destructive">
                {t("loadFailed")}
                <Button variant="outline" size="sm" onClick={() => void tokens.refetch()}>
                  {t("retry")}
                </Button>
              </div>
            )}
            {tokens.data &&
              (tokens.data.length > 0 ? (
                <TokenTable
                  tokens={tokens.data}
                  onViewPermissions={setViewing}
                  onEdit={setEditing}
                  onShowToken={(token, value) => setShown({ token, value })}
                />
              ) : (
                <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-muted/15 px-6 py-12 text-center">
                  <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <KeyRound className="size-5" />
                  </div>
                  <p className="text-sm font-medium text-foreground">{t("empty")}</p>
                  <Button size="sm" onClick={() => setCreating(true)}>
                    <Plus className="mr-1.5 size-4" />
                    {t("createToken")}
                  </Button>
                </div>
              ))}
          </TabsContent>

          <TabsContent value="tools" className="mt-0">
            <MCPToolCatalog />
          </TabsContent>

          <TabsContent value="runs" className="mt-0 space-y-3">
            <p className="text-xs text-muted-foreground">{t("recentTasksDescription")}</p>
            {recentTasks.isPending ? (
              <PageLoading className="min-h-0 py-10" />
            ) : mcpRuns.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed bg-muted/15 px-6 py-12 text-center">
                <div className="flex size-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                  <Activity className="size-5" />
                </div>
                <p className="text-sm font-medium text-foreground">{t("recentTasksEmpty")}</p>
                <p className="max-w-md text-xs text-muted-foreground">{t("recentTasksEmptyHint")}</p>
              </div>
            ) : (
              <div className="divide-y overflow-hidden rounded-xl border bg-card">
                {mcpRuns.map((run) => {
                  const active = isTaskActive(run.status)
                  const canCancel = run.cancelable && (run.status === "queued" || run.status === "running")
                  const duration = formatRunDuration(run.started_at, run.finished_at)
                  return (
                    <div
                      key={run.id}
                      className="flex items-center gap-3.5 px-4 py-3 text-xs transition-colors hover:bg-muted/35"
                    >
                      <TaskTypeAvatar taskType={run.task_type} active={active} size="md" />
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left outline-none"
                        onClick={() => navigate(`/dashboard/tasks?run=${encodeURIComponent(run.id)}`)}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-mono text-[13px] font-medium text-foreground">
                            {run.title}
                          </span>
                          <TaskStatusPill status={run.status} t={tTask} compact />
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                          <span>{formatTaskTypeLabel(run.task_type, tTask)}</span>
                          {run.server_name ? <span>· {run.server_name}</span> : null}
                          {duration ? <span className="tabular-nums">· {duration}</span> : null}
                          <span className="tabular-nums">
                            ·{" "}
                            {new Intl.DateTimeFormat(i18n.language, {
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            }).format(new Date(run.created_at))}
                          </span>
                        </div>
                        {active ? (
                          <div className="mt-1.5 flex max-w-sm items-center gap-2">
                            <Progress value={run.progress} className="h-1 flex-1" />
                            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                              {run.progress}%
                            </span>
                          </div>
                        ) : run.error_message ? (
                          <p className="mt-1 truncate text-[11px] text-destructive" title={run.error_message}>
                            {run.error_message}
                          </p>
                        ) : null}
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        {canCancel ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="size-7 text-muted-foreground hover:text-destructive"
                            disabled={cancelingId === run.id}
                            title={tTask("cancelTask")}
                            aria-label={tTask("cancelTask")}
                            onClick={() => void handleCancelTask(run)}
                          >
                            {cancelingId === run.id ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <CircleStop className="size-3.5" />
                            )}
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="size-7 text-muted-foreground hover:text-foreground"
                          title={tTask("viewDetails")}
                          aria-label={tTask("viewDetails")}
                          onClick={() => navigate(`/dashboard/tasks?run=${encodeURIComponent(run.id)}`)}
                        >
                          <ExternalLink className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DashboardPageContent>

      <CreateTokenDialog open={creating} onOpenChange={setCreating} />
      <TokenPermissionsDialog token={viewing} onClose={() => setViewing(null)} onEdit={setEditing} />
      <TokenEditDialog token={editing} onClose={() => setEditing(null)} />
      <TokenSecretDialog shown={shown} onClose={() => setShown(null)} />
    </>
  )
}
