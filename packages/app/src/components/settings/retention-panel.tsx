import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Loader2, RotateCcw, Trash2 } from "lucide-react"
import { SettingsLoading } from "@/components/settings/settings-loading"
import { SettingsSection } from "@/components/settings/settings-section"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/components/ui/sonner"
import { getErrorMessage } from "@/lib/error-utils"

// Days a category is kept; 0 keeps it forever. Mirrors shared/retention.
export const retentionChoices = [7, 14, 30, 60, 90, 180, 365, 0] as const
export type RetentionDays = (typeof retentionChoices)[number]

export interface RetentionConfig {
  task_retention_days: RetentionDays
  log_retention_days: RetentionDays
  deleted_retention_days: RetentionDays
}

export interface RecycleBinEntry {
  id: string
  kind: "server" | "script" | "ai_session"
  resource_id: string
  name: string
  removed_at: string
}

// Each host keeps its own policy: the server in system settings, the desktop
// in its local preferences.
export interface RetentionAdapter {
  load(): Promise<RetentionConfig>
  save(config: RetentionConfig): Promise<void>
  run(): Promise<{ deleted_tasks: number; deleted_logs: number; deleted_entries: number }>
  listDeleted(): Promise<RecycleBinEntry[]>
  restoreDeleted(id: string): Promise<void>
  discardDeleted(id: string): Promise<void>
}

const retentionQueryKey = ["settings", "retention"] as const
const recycleQueryKey = ["settings", "recycle-bin"] as const

export function RetentionPanel({ adapter }: { adapter: RetentionAdapter }) {
  const { t } = useTranslation("settingsRetention")
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: retentionQueryKey,
    queryFn: () => adapter.load(),
    refetchOnMount: "always",
  })
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const deleted = useQuery({
    queryKey: recycleQueryKey,
    queryFn: () => adapter.listDeleted(),
    // Deletions happen outside settings; refresh on every visit, even while cached data is fresh.
    refetchOnMount: "always",
  })
  const [pendingEntry, setPendingEntry] = useState<string | null>(null)

  if (query.isError) {
    return <p className="p-4 text-sm text-destructive">{getErrorMessage(query.error, t("loadFailed"))}</p>
  }
  if (!query.isFetchedAfterMount || !query.data) {
    return <SettingsLoading />
  }
  const config = query.data

  const change = async (field: keyof RetentionConfig, value: string) => {
    const next = { ...config, [field]: Number(value) as RetentionDays }
    try {
      setSaving(true)
      await adapter.save(next)
      queryClient.setQueryData(retentionQueryKey, next)
      toast.success(t("saved"))
    } catch (error) {
      toast.error(getErrorMessage(error, t("saveFailed")))
    } finally {
      setSaving(false)
    }
  }

  const run = async () => {
    try {
      setRunning(true)
      const result = await adapter.run()
      if (result.deleted_tasks === 0 && result.deleted_logs === 0 && result.deleted_entries === 0) {
        toast.info(t("runNothing"))
      } else {
        toast.success(t("runSuccess", { tasks: result.deleted_tasks, logs: result.deleted_logs, entries: result.deleted_entries }))
        // Lists of the removed records may be on screen elsewhere.
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: recycleQueryKey }),
          queryClient.invalidateQueries({ predicate: (cached) => cached.queryKey[0] !== "settings" }),
        ])
      }
    } catch (error) {
      toast.error(getErrorMessage(error, t("runFailed")))
    } finally {
      setRunning(false)
    }
  }

  const actOnEntry = async (entry: RecycleBinEntry, action: "restore" | "discard") => {
    try {
      setPendingEntry(entry.id)
      if (action === "restore") {
        await adapter.restoreDeleted(entry.id)
        toast.success(t("restoreSuccess", { name: entry.name }))
      } else {
        await adapter.discardDeleted(entry.id)
        toast.success(t("discardSuccess", { name: entry.name }))
      }
      // A restored record belongs to lists outside this panel.
      await queryClient.invalidateQueries()
    } catch (error) {
      toast.error(getErrorMessage(error, t(action === "restore" ? "restoreFailed" : "discardFailed")))
    } finally {
      setPendingEntry(null)
    }
  }

  const fields = [
    { field: "task_retention_days", label: t("taskLabel"), description: t("taskDescription") },
    { field: "log_retention_days", label: t("logLabel"), description: t("logDescription") },
    { field: "deleted_retention_days", label: t("deletedLabel"), description: t("deletedDescription") },
  ] as const

  return (
    <div className="space-y-6 p-4">
      <SettingsSection title={t("title")} description={t("description")}>
        <div className="grid gap-6 sm:grid-cols-3">
          {fields.map(({ field, label, description }) => (
            <div key={field} className="grid max-w-sm gap-2">
              <Label htmlFor={`retention-${field}`}>{label}</Label>
              <Select value={String(config[field])} disabled={saving || running} onValueChange={(value) => void change(field, value)}>
                <SelectTrigger id={`retention-${field}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {retentionChoices.map((days) => (
                    <SelectItem key={days} value={String(days)}>
                      {days === 0 ? t("forever") : t("days", { count: days })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{description}</p>
            </div>
          ))}
        </div>
      </SettingsSection>

      <div className="border-t" />

      <SettingsSection title={t("recycleTitle")} description={t("recycleDescription")}>
        {deleted.isError ? (
          <p className="text-sm text-destructive">{getErrorMessage(deleted.error, t("recycleLoadFailed"))}</p>
        ) : !deleted.data?.length ? (
          <p className="text-sm text-muted-foreground">{deleted.isFetching || !deleted.data ? t("recycleLoading") : t("recycleEmpty")}</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {deleted.data.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{entry.name || entry.resource_id}</p>
                  <p className="text-xs text-muted-foreground">
                    {t(`kind_${entry.kind}`)} · {new Date(entry.removed_at).toLocaleString()}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="outline" size="sm" disabled={pendingEntry !== null} onClick={() => void actOnEntry(entry, "restore")}>
                    {pendingEntry === entry.id ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                    {t("restoreButton")}
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={pendingEntry !== null} onClick={() => void actOnEntry(entry, "discard")}>
                    <Trash2 className="size-4" />
                    {t("discardButton")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      <div className="border-t" />

      <SettingsSection title={t("runTitle")} description={t("runDescription")}>
        <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={saving || running} onClick={() => void run()}>
          {running ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          {running ? t("running") : t("runButton")}
        </Button>
      </SettingsSection>
    </div>
  )
}
