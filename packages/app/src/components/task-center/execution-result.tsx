import { useMemo, useState } from "react"
import { Check, CheckCircle2, Copy, XCircle, AlertTriangle, Clock } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

interface ServerTargetResult {
  ServerID?: string
  ServerName?: string
  ServerHost?: string
  Status?: string
  ExitCode?: number | null
  Output?: string
  ErrorMessage?: string
  Duration?: number
}

function parseServerTargets(parsed: unknown): ServerTargetResult[] | null {
  if (!Array.isArray(parsed) || parsed.length === 0) return null
  const looksLikeTargets = parsed.every(
    (item) =>
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      ("ServerID" in item || "ServerName" in item || "Status" in item) &&
      ("Output" in item || "ErrorMessage" in item || "ExitCode" in item || "Duration" in item),
  )
  return looksLikeTargets ? (parsed as ServerTargetResult[]) : null
}

function formatDurationMs(ms?: number) {
  if (ms === undefined || ms === null || Number.isNaN(ms)) return ""
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const mins = Math.floor(ms / 60_000)
  const secs = Math.round((ms % 60_000) / 1000)
  return `${mins}m ${secs}s`
}

export function ExecutionResult({ raw }: { raw?: string }) {
  const { t } = useTranslation("taskCenter")
  const [targetFilter, setTargetFilter] = useState<"all" | "failed">("all")
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)

  const parsedResult = useMemo(() => {
    if (!raw) return { empty: true as const }
    try {
      return { empty: false as const, parsed: JSON.parse(raw) as unknown }
    } catch {
      return { empty: false as const, text: raw }
    }
  }, [raw])

  if (parsedResult.empty) return null
  if ("text" in parsedResult) {
    return (
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border bg-muted/40 p-3 font-mono text-xs">
        {parsedResult.text}
      </pre>
    )
  }

  const parsed = parsedResult.parsed
  const serverTargets = parseServerTargets(parsed)

  if (serverTargets) {
    const failedTargets = serverTargets.filter((item) => item.Status && item.Status !== "success" && item.Status !== "succeeded")
    const visibleTargets = targetFilter === "failed" ? failedTargets : serverTargets

    const handleCopy = (index: number, content: string) => {
      void navigator.clipboard?.writeText(content).then(() => {
        setCopiedIndex(index)
        window.setTimeout(() => setCopiedIndex((cur) => (cur === index ? null : cur)), 1500)
      })
    }

    return (
      <div className="space-y-2.5 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("serverResultsTitle", { defaultValue: "主机执行结果" })}
            </h3>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
              {serverTargets.length}
            </span>
          </div>
          {failedTargets.length > 0 && (
            <div className="inline-flex items-center rounded-lg bg-muted/70 p-0.5">
              <Button
                type="button"
                size="sm"
                variant={targetFilter === "all" ? "secondary" : "ghost"}
                className="h-6 px-2 text-[11px]"
                onClick={() => setTargetFilter("all")}
              >
                {t("filterAll")} ({serverTargets.length})
              </Button>
              <Button
                type="button"
                size="sm"
                variant={targetFilter === "failed" ? "secondary" : "ghost"}
                className="h-6 px-2 text-[11px] text-destructive"
                onClick={() => setTargetFilter("failed")}
              >
                {t("filterOnlyFailed", { defaultValue: "仅异常" })} ({failedTargets.length})
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-2">
          {visibleTargets.map((target, index) => {
            const isSuccess = target.Status === "success" || target.Status === "succeeded"
            const isWarning = target.Status === "canceled" || target.Status === "unknown"
            const outputText = target.Output || target.ErrorMessage || ""
            return (
              <details
                key={`${target.ServerID ?? index}`}
                open={!isSuccess || visibleTargets.length <= 2}
                className="overflow-hidden rounded-lg border bg-muted/15"
              >
                <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs select-none">
                  {isSuccess ? (
                    <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  ) : isWarning ? (
                    <AlertTriangle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  ) : (
                    <XCircle className="size-3.5 shrink-0 text-destructive" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {target.ServerName || target.ServerHost || target.ServerID || `#${index + 1}`}
                  </span>
                  {target.ServerHost && target.ServerName && (
                    <span className="hidden truncate font-mono text-[11px] text-muted-foreground sm:inline">
                      {target.ServerHost}
                    </span>
                  )}
                  {target.ExitCode !== undefined && target.ExitCode !== null && (
                    <Badge variant={target.ExitCode === 0 ? "outline" : "destructive"} className="h-5 px-1.5 font-mono text-[10px]">
                      exit {target.ExitCode}
                    </Badge>
                  )}
                  {target.Duration !== undefined && target.Duration > 0 && (
                    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-muted-foreground">
                      <Clock className="size-3" />
                      {formatDurationMs(target.Duration)}
                    </span>
                  )}
                </summary>
                <div className="border-t px-3 py-2.5 space-y-2">
                  {target.ErrorMessage && (
                    <div className="rounded border-l-2 border-destructive bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive">
                      {target.ErrorMessage}
                    </div>
                  )}
                  {target.Output ? (
                    <div className="relative">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="absolute right-1.5 top-1.5 size-6 bg-background/80"
                        title={t("copyOutput", { defaultValue: "复制输出" })}
                        onClick={() => handleCopy(index, outputText)}
                      >
                        {copiedIndex === index ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}
                      </Button>
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/60 p-3 pr-9 font-mono text-xs leading-5">
                        {target.Output}
                      </pre>
                    </div>
                  ) : !target.ErrorMessage ? (
                    <p className="text-xs text-muted-foreground">{t("emptyOutput", { defaultValue: "无输出内容" })}</p>
                  ) : null}
                </div>
              </details>
            )
          })}
        </div>

        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">{t("rawResultTitle", { defaultValue: "查看原始 JSON" })}</summary>
          <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 font-mono text-xs">
            {JSON.stringify(parsed, null, 2)}
          </pre>
        </details>
      </div>
    )
  }

  const root =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  const details =
    root.details && typeof root.details === "object"
      ? (root.details as Record<string, unknown>)
      : root
  const paths = [
    "success_paths",
    "failed_paths",
    "unresolved_paths",
    "effects",
  ] as const
  const structured =
    paths.some((k) => Array.isArray(details[k])) || !!details.effects
  return (
    <div className="space-y-3 text-sm">
      {structured && (
        <p className="text-muted-foreground">{t("partialEffectsHint")}</p>
      )}
      {paths.map((k) =>
        Array.isArray(details[k]) && (details[k] as unknown[]).length > 0 ? (
          <details key={k} open={k !== "effects"}>
            <summary className="cursor-pointer">
              {t(k)} · {(details[k] as unknown[]).length}
            </summary>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs">
              {JSON.stringify(details[k], null, 2)}
            </pre>
          </details>
        ) : null,
      )}
      {details.effects && !Array.isArray(details.effects) ? (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">
          {JSON.stringify(details.effects, null, 2)}
        </pre>
      ) : null}
      <details open={!structured}>
        <summary className="cursor-pointer">{t("resultTitle")}</summary>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs">
          {JSON.stringify(parsed, null, 2)}
        </pre>
      </details>
    </div>
  )
}
