import { useState } from "react"
import { Check, Circle } from "lucide-react"
import { GrantManager } from "@/components/sharing/grant-manager"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { SettingsSection } from "./settings-section"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { SyncResolutionError, type SyncAdapter, type SyncAffectedGrant, type SyncChoice, type SyncConflict, type SyncStatus } from "@/lib/sync/types"
import { cn } from "@/lib/utils"

type Source = "desktop" | "server"

// Only versions whose origin is known and unique can be chosen in bulk.
function versionFrom(conflict: SyncConflict, source: Source) {
  const matches = conflict.values.filter((value) => conflict.previews?.[value]?.source === source)
  return matches.length === 1 ? matches[0] : undefined
}

export function SyncConflicts({ status, adapter, busy, action }: {
  status: SyncStatus
  adapter: SyncAdapter
  busy: boolean
  action: (fn: () => Promise<void>) => Promise<boolean>
}) {
  const [affected, setAffected] = useState<SyncAffectedGrant[]>([])
  const [selecting, setSelecting] = useState<SyncChoice | null>(null)
  const [batching, setBatching] = useState<Source | null>(null)
  const { t } = useTranslation("settingsManagementBackup")
  const working = busy || selecting !== null || batching !== null
  const batchable = status.conflicts.filter((conflict) => versionFrom(conflict, "desktop") && versionFrom(conflict, "server"))
  const rememberAffected = (items: SyncAffectedGrant[]) => setAffected((previous) => {
    const merged = new Map(previous.map((item) => [`${item.grant_id}:${item.server_id}`, item]))
    for (const item of items) merged.set(`${item.grant_id}:${item.server_id}`, item)
    return [...merged.values()]
  })
  const resolve = async (choices: SyncChoice[]) => {
    try {
      rememberAffected(await adapter.resolve(choices) || [])
    } catch (error) {
      if (error instanceof SyncResolutionError) rememberAffected(error.affected)
      throw error
    }
  }
  const resolveAll = (source: Source) => void action(async () => {
    setBatching(source)
    try {
      await resolve(batchable.map((conflict) => ({ key: conflict.key, field: conflict.field, value: versionFrom(conflict, source)! })))
    } finally {
      setBatching(null)
    }
  })
  if (!status.conflicts.length && !affected.length) return null
  return (
    <div id="sync-conflicts" className="scroll-mt-4">
      {affected.length > 0 && <section className="my-3 space-y-2 rounded border p-3"><p className="text-sm">{t("syncAffectedShares")}</p>{affected.map(item => <div key={`${item.grant_id}:${item.server_id}`} className="flex items-center justify-between gap-2 text-xs"><span>{item.grant_name} · {item.server_name} · {t(item.reason === "resource_deleted" ? "syncSharedResourceDeleted" : "syncSharedConnectionChanged")}</span><GrantManager grantId={item.grant_id} compact /></div>)}</section>}
      {!!status.conflicts.length && (
        <SettingsSection
          title={t("syncConflicts")}
          description={t("syncConflictHint")}
          className="rounded-xl border border-border bg-card/40 p-5"
          actions={batchable.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {(["desktop", "server"] as const).map((source) => (
                <Button key={source} size="sm" variant="outline" disabled={working} onClick={() => resolveAll(source)}>
                  {batching === source && <Spinner />}
                  {t(source === "desktop" ? "syncUseAllDesktop" : "syncUseAllServer", { count: batchable.length })}
                </Button>
              ))}
            </div>
          )}
        >
          {status.conflicts.map((conflict) => (
            <div key={`${conflict.key}/${conflict.field}`} className="space-y-2 border-t pt-4">
              <p className="break-all text-xs text-muted-foreground">
                {conflict.key} ·{" "}
                {conflict.field === "connection"
                  ? t("syncConnectionField")
                  : conflict.field === "ids"
                    ? t("syncServerOrderField")
                    : conflict.field === "ref"
                    ? t("syncVersionField")
                    : t("syncContentField")}
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {conflict.values.map((value, i) => {
                  const selected = selecting?.key === conflict.key && selecting.field === conflict.field && selecting.value === value
                  return (
                    <div key={value} className={cn(
                      "flex min-w-0 flex-col overflow-hidden rounded-lg border bg-muted/20 transition-colors",
                      selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border",
                    )}>
                      <button
                        type="button"
                        className="group flex w-full min-w-0 flex-1 cursor-pointer flex-col gap-3 p-4 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent"
                        disabled={working}
                        aria-label={t("syncUseVersion", { number: i + 1 })}
                        aria-busy={selected}
                        onClick={() => void action(async () => {
                          setSelecting({ key: conflict.key, field: conflict.field, value })
                          try {
                            await resolve([{ key: conflict.key, field: conflict.field, value }])
                          } finally {
                            setSelecting(null)
                          }
                        })}
                      >
                        <span className="flex w-full items-center justify-between gap-3 text-sm font-medium">
                          <span>{t("syncVersionNumber", { number: i + 1 })}</span>
                          {selected ? <Check className="size-4 shrink-0 text-primary" aria-hidden="true" /> : <Circle className="size-4 shrink-0 text-muted-foreground group-hover:text-primary" aria-hidden="true" />}
                        </span>
                        {conflict.previews?.[value] ? (
                          <span className="block w-full space-y-2 break-all text-sm">
                            <span className="block text-xs text-muted-foreground">
                              {t(
                                conflict.previews[value].source === "desktop"
                                  ? "syncVersionDesktop"
                                  : "syncVersionServer",
                              )}
                              {conflict.previews[value].updated_at &&
                                ` · ${new Date(conflict.previews[value].updated_at!).toLocaleString()}`}
                            </span>
                            {conflict.previews[value].deleted ? (
                              <span className="block">{t("syncVersionDeleted")}</span>
                            ) : (
                              <>
                                {conflict.key.startsWith("vault/ai_session/") && (
                                  <span className="block">
                                    {conflict.previews[value].title} ·{" "}
                                    {t("syncMessageCount", {
                                      count: conflict.previews[value].messages ?? 0,
                                    })}
                                    {conflict.previews[value].last_message_at &&
                                      ` · ${new Date(conflict.previews[value].last_message_at!).toLocaleString()}`}
                                  </span>
                                )}
                                {conflict.key.startsWith("vault/credential/") && (
                                  <span className="block">
                                    {t(
                                      conflict.previews[value].has_password
                                        ? "syncHasPassword"
                                        : "syncNoPassword",
                                    )}{" "}
                                    · {conflict.previews[value].fingerprint || t("syncNoPrivateKey")}
                                  </span>
                                )}
                                {conflict.key.startsWith("vault/ai_config/") && (
                                  <span className="block">
                                    {conflict.previews[value].provider} ·{" "}
                                    {t(
                                      conflict.previews[value].has_api_key
                                        ? "syncHasAPIKey"
                                        : "syncNoAPIKey",
                                    )}
                                  </span>
                                )}
                              </>
                            )}
                            <span className="block font-mono text-xs text-muted-foreground">{value}</span>
                          </span>
                        ) : (
                          <span className="block max-h-64 w-full overflow-auto whitespace-pre-wrap break-all font-mono text-xs">
                            {value}
                          </span>
                        )}
                        <span className="mt-auto flex items-center gap-2 pt-2 text-xs text-muted-foreground">
                          {selected && <Spinner className="size-3" />}
                          {t(selected ? "syncApplyingVersion" : "syncClickToUseVersion")}
                        </span>
                      </button>
                      {conflict.key.startsWith("vault/ai_session/") &&
                        !conflict.previews?.[value]?.deleted &&
                        adapter.forkSession && (
                          <Button
                            className="mx-4 mb-4 self-start"
                            size="sm"
                            variant="outline"
                            disabled={working}
                            onClick={() =>
                              void action(async () => {
                                await adapter.forkSession!(conflict.key, value)
                                toast.success(t("syncForkSaved"))
                              })
                            }
                          >
                            {t("syncForkSession")}
                          </Button>
                        )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </SettingsSection>
      )}
    </div>
  )
}
