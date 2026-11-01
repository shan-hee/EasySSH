import { useState } from "react"
import { RefreshCw } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { formatLogBytes } from "@/components/logs/log-table-parts"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { apiFetch } from "@/lib/api-client"
import { cn } from "@/lib/utils"
import type { components } from "@/generated/openapi"

export type OverviewInput = components["schemas"]["ActivityOverviewInput"]
export type OverviewData = Pick<
  components["schemas"]["ActivityOverview"],
  "coverage" | "result_events"
> & {
  volume: Pick<
    components["schemas"]["ActivityOverview"]["volume"],
    | "works"
    | "active"
    | "completed_bytes"
    | "servers"
    | "unresolved_failures"
  >
}
export const fetchActivityOverview = (
  input: OverviewInput,
): Promise<OverviewData> =>
  apiFetch(
    `/operation-records/overview?${new URLSearchParams(
      Object.entries(input)
        .filter(([, v]) => v !== undefined && v !== "")
        .map(([k, v]) => [k, String(v)]),
    )}`,
  )

type StatKey = "works" | "completed" | "unresolved_failures" | "active" | "completed_bytes" | "servers"

const STAT_KEYS: readonly StatKey[] = ["works", "completed", "unresolved_failures", "active", "completed_bytes", "servers"]

function statValue(value: OverviewData, key: StatKey) {
  return key === "completed" ? value.result_events.completed : value.volume[key]
}

/** 日志页顶部的统计概览：只展示汇总数字，明细由下方表格呈现；服务器范围跟随表格的服务器筛选。 */
export function ActivityOverview({
  load = fetchActivityOverview,
  scope = "owner",
  server = null,
}: {
  load?: (input: OverviewInput) => Promise<OverviewData>
  scope?: string
  server?: { id: string; name: string } | null
}) {
  const { t } = useTranslation("activityOverview")
  const [range, setRange] = useState("today")
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const query = useQuery({
    queryKey: ["activityOverview", scope, range, timezone, server?.id ?? ""],
    queryFn: () =>
      load({
        range,
        timezone,
        ...(server ? { server_id: server.id } : {}),
        page: 1,
        page_size: 10,
      }),
    refetchOnWindowFocus: true,
  })
  const value = query.data
  const unavailable = new Set(value?.coverage.unavailable_metrics ?? [])
  const display = (key: StatKey) => {
    if (!value || unavailable.has(key)) return "—"
    const number = Number(statValue(value, key))
    return key === "completed_bytes" ? formatLogBytes(number) : number.toLocaleString()
  }

  return (
    <section className="@container shrink-0 space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="shrink-0 font-medium">{t("title")}</h2>
          <span role="status" className="truncate text-xs text-muted-foreground">
            {server ? t("filteredServer", { name: server.name }) : t("all")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger size="sm" aria-label={t("range")} className="min-w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="today">{t("today")}</SelectItem>
              <SelectItem value="seven_days">{t("week")}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("refresh")}
            title={t("refresh")}
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw className={cn("size-4", query.isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>
      {query.isError && (
        <p role="alert" className="text-sm text-destructive">
          {query.error.message}
        </p>
      )}
      <dl className="grid grid-cols-2 gap-3 @md:grid-cols-3 @4xl:grid-cols-6">
        {STAT_KEYS.map((key) => {
          const alert = key === "unresolved_failures" && Boolean(value && statValue(value, key) > 0)
          return (
            <div key={key} className="min-w-0 rounded-lg bg-muted/40 px-3 py-2.5">
              <dt className="truncate text-xs text-muted-foreground">{t(key)}</dt>
              <dd className={cn("mt-1 truncate text-xl font-semibold tabular-nums", alert && "text-rose-600 dark:text-rose-400")}>
                {display(key)}
              </dd>
            </div>
          )
        })}
      </dl>
      {value && (!value.coverage.known || !value.coverage.complete_window) && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t("coverage", {
            date: value.coverage.available_from
              ? new Date(value.coverage.available_from).toLocaleString()
              : t("unknown"),
          })}
        </p>
      )}
    </section>
  )
}
