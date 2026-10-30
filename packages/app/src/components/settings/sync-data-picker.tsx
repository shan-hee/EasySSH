import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Check, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SettingsSection } from "./settings-section"
import type { SyncCandidate } from "@/lib/sync/types"

const kinds = [
  { key: "server", label: "syncServerRecord" },
  { key: "script", label: "syncScriptRecord" },
  { key: "ai_session", label: "syncSessionRecord" },
] as const

export function SyncDataPicker({ candidates, spaceID, sessionsEnabled, disabled, paused, onEnroll }: {
  candidates: SyncCandidate[]
  spaceID: string
  sessionsEnabled: boolean
  disabled: boolean
  paused: boolean
  onEnroll: (keys: string[]) => Promise<boolean>
}) {
  const { t } = useTranslation("settingsManagementBackup")
  const [kind, setKind] = useState<string>("server")
  const [view, setView] = useState<"available" | "enrolled">("available")
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<string[]>([])
  const group = candidates.filter((item) => item.key.startsWith(`${kind}/`))
  const enrolled = group.filter((item) => item.space_id === spaceID)
  const available = group.filter((item) => item.space_id !== spaceID)
  const items = (view === "enrolled" ? enrolled : available).filter((item) =>
    `${item.name} ${item.account_name} ${item.server_url}`.toLowerCase().includes(query.trim().toLowerCase()),
  )
  const scopeDisabled = kind === "ai_session" && !sessionsEnabled
  const selectedKeys = scopeDisabled ? [] : items.filter((item) => selected.includes(item.key)).map((item) => item.key)
  const allSelected = items.length > 0 && selectedKeys.length === items.length
  const inSpace = candidates.filter((item) => item.space_id === spaceID).length

  return (
    <SettingsSection title={t("syncEnrollTitle")} description={t("syncEnrollHint")}
      className="rounded-xl border border-border bg-card/40 p-5"
      actions={<span className="text-xs text-muted-foreground">{t("syncEnrolledCount", { count: inSpace })}</span>}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1" role="group" aria-label={t("syncDataType")}>
          {kinds.map((item) => (
            <Button key={item.key} size="sm" variant={kind === item.key ? "secondary" : "ghost"}
              aria-pressed={kind === item.key} disabled={disabled}
              onClick={() => { setKind(item.key); setSelected([]); setQuery("") }}>
              {t(item.label)}
            </Button>
          ))}
        </div>
        <div className="relative w-full sm:w-56">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input className="h-9 pl-9" aria-label={t("syncSearchData")} placeholder={t("syncSearchData")}
            value={query} onChange={(event) => { setQuery(event.target.value); setSelected([]) }} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("syncDataMembership")}>
        <Button size="sm" variant={view === "available" ? "outline" : "ghost"} aria-pressed={view === "available"}
          onClick={() => { setView("available"); setSelected([]) }}>
          {t("syncAvailableCount", { count: available.length })}
        </Button>
        <Button size="sm" variant={view === "enrolled" ? "outline" : "ghost"} aria-pressed={view === "enrolled"}
          onClick={() => { setView("enrolled"); setSelected([]) }}>
          {t("syncEnrolledCount", { count: enrolled.length })}
        </Button>
      </div>
      {scopeDisabled && <p className="rounded-lg bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">{t("syncSessionsDisabledHint")}</p>}
      <div className="overflow-hidden rounded-lg border">
        {view === "available" && items.length > 0 && (
          <Label className="flex items-center gap-3 border-b bg-muted/30 px-4 py-3 text-xs">
            <Checkbox checked={allSelected ? true : selectedKeys.length ? "indeterminate" : false}
              disabled={disabled || scopeDisabled}
              onCheckedChange={(checked) => setSelected(checked === true ? items.map((item) => item.key) : [])} />
            {t("syncSelectVisible", { count: items.length })}
          </Label>
        )}
        <div className="max-h-72 divide-y overflow-y-auto">
          {items.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {query ? t("syncNoMatch") : view === "enrolled" ? t("syncNoEnrolled") : t("syncNoLocalRecords")}
            </p>
          ) : items.map((item) => (
            <div key={item.key} className="flex items-start gap-3 px-4 py-3">
              {view === "available" ? (
                <Checkbox id={`sync-data-${item.key}`} className="mt-0.5" checked={selectedKeys.includes(item.key)}
                  disabled={disabled || scopeDisabled}
                  onCheckedChange={(checked) => setSelected((current) => checked === true
                    ? [...current, item.key] : current.filter((key) => key !== item.key))} />
              ) : <Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
              <div className="min-w-0 flex-1 space-y-1">
                <Label htmlFor={view === "available" ? `sync-data-${item.key}` : undefined} className="break-words text-sm">
                  {item.name || item.key.split("/")[1]}
                </Label>
                <p className="break-all text-xs text-muted-foreground">
                  {view === "enrolled" ? t(paused || scopeDisabled ? "syncEnrolledPaused" : "syncInCurrentSpace")
                    : item.space_id ? t("syncOtherSpace", { account: item.account_name, url: item.server_url }) : t("syncLocalOnly")}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
      {view === "available" && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{t(paused ? "syncEnrollPausedHint" : "syncEnrollScheduleHint")}</p>
          <Button disabled={disabled || selectedKeys.length === 0} onClick={() => {
            void onEnroll(selectedKeys).then((saved) => { if (saved) setSelected([]) })
          }}>{t("syncEnrollAction", { count: selectedKeys.length })}</Button>
        </div>
      )}
    </SettingsSection>
  )
}
