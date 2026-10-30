import { useState } from "react"
import { ArrowLeft } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { apiFetch } from "@/lib/api-client"
import type { components } from "@/generated/openapi"

export type OverviewInput = components["schemas"]["ActivityOverviewInput"]
export type OverviewData = Pick<
  components["schemas"]["ActivityOverview"],
  | "coverage"
  | "result_events"
  | "servers"
  | "timeline"
  | "as_of"
  | "timezone"
  | "connection_duration_ms"
  | "connection_duration_is_lower_bound"
  | "carry_over"
> & {
  volume: Pick<
    components["schemas"]["ActivityOverview"]["volume"],
    | "works"
    | "executions"
    | "transfers"
    | "successful_files"
    | "completed_bytes"
    | "servers"
    | "configuration_changes"
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
export function ActivityOverview({
  load = fetchActivityOverview,
  scope = "owner",
}: {
  load?: (input: OverviewInput) => Promise<OverviewData>
  scope?: string
}) {
  const { t } = useTranslation("activityOverview")
  const [range, setRange] = useState("today")
  const [server, setServer] = useState<{ id: string; name: string } | null>(
    null,
  )
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
  const metric = (key: keyof OverviewData["volume"]) =>
    !value || unavailable.has(key)
      ? "—"
      : Number(value.volume[key]).toLocaleString()
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="font-medium">{t("title")}</h2>
          {server && (
            <Button size="sm" variant="outline" onClick={() => setServer(null)}>
              <ArrowLeft className="size-4" />
              {t("backToAll")}
            </Button>
          )}
          <span role="status" className="text-xs text-muted-foreground">
            {server ? t("filteredServer", { name: server.name }) : t("all")}
          </span>
        </div>
        <div className="flex gap-2">
          <select
            aria-label={t("range")}
            className="rounded border bg-background p-1 text-sm"
            value={range}
            onChange={(e) => setRange(e.target.value)}
          >
            <option value="today">{t("today")}</option>
            <option value="seven_days">{t("week")}</option>
          </select>
          <Button
            size="sm"
            variant="ghost"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t("refresh")}
          </Button>
        </div>
      </div>
      {query.isError && (
        <p role="alert" className="text-sm text-destructive">
          {query.error.message}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            "works",
            "executions",
            "transfers",
            "successful_files",
            "completed_bytes",
            "servers",
            "configuration_changes",
            "unresolved_failures",
          ] as const
        ).map((k) => (
          <div key={k} className="rounded bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">{t(k)}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {metric(k)}
            </p>
          </div>
        ))}
      </div>
      {value && (
        <>
          <p className="text-xs text-muted-foreground">
            {t("results", {
              completed: value.result_events.completed,
              failed: value.result_events.failed,
              partial: value.result_events.partial,
              canceled: value.result_events.canceled,
              unknown: value.result_events.unknown,
              carry: value.carry_over,
            })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("duration", {
              value: Math.round(value.connection_duration_ms / 60000),
              bound: value.connection_duration_is_lower_bound
                ? t("atLeast")
                : "",
            })}{" "}
            · {timezone}
          </p>
          {(!value.coverage.known || !value.coverage.complete_window) && (
            <p className="rounded border border-amber-500/40 p-2 text-xs">
              {t("coverage", {
                date: value.coverage.available_from
                  ? new Date(value.coverage.available_from).toLocaleString()
                  : t("unknown"),
              })}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {value.servers.map((s) => (
              <Button
                key={s.server_id}
                variant={server?.id === s.server_id ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={server?.id === s.server_id}
                aria-label={
                  server?.id === s.server_id
                    ? t("backToAll")
                    : t("viewServer", { name: s.name })
                }
                onClick={() =>
                  setServer((current) =>
                    current?.id === s.server_id
                      ? null
                      : { id: s.server_id, name: s.name || s.server_id },
                  )
                }
              >
                {s.name} · {s.works}
              </Button>
            ))}
          </div>
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">
              {t("timeline")}
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {value.timeline.map((b) => (
                <div key={b.start} className="border-l-2 px-2 text-xs">
                  <div>{b.label}</div>
                  <div>
                    {t("bucket", {
                      started: b.started,
                      completed: b.results.completed,
                    })}
                  </div>
                </div>
              ))}
            </div>
          </details>
        </>
      )}
    </section>
  )
}
