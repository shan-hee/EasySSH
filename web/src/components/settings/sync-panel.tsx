import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { AlertCircle, CheckCircle2, Cloud, Laptop, Loader2, Pause, RefreshCw, Unplug } from "lucide-react"
import { toast } from "sonner"
import { scopeLabels } from "./sync-scopes"
import { SyncContentSettings } from "./sync-content-settings"
import { SyncDataPicker } from "./sync-data-picker"
import { SyncConflicts } from "./sync-conflicts"
import { SettingsSection } from "./settings-section"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useConfirmDialog } from "@/hooks/use-confirm-dialog"
import { emptySyncScopes, type SyncScopes, type SyncAdapter, type SyncStatus, type SyncLogin, type SyncCandidate } from "@/lib/sync/types"

export function SyncPanel({ adapter, desktopMode }: { adapter: SyncAdapter; desktopMode: boolean }) {
  const { t } = useTranslation("settingsManagementBackup")
  const { confirm, confirmDialog } = useConfirmDialog()
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [loadError, setLoadError] = useState("")
  const [actionError, setActionError] = useState("")
  const [failedSync, setFailedSync] = useState(false)
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState("")
  const [name, setName] = useState("")
  const [login, setLogin] = useState<SyncLogin | null>(null)
  const [candidates, setCandidates] = useState<SyncCandidate[]>([])
  const actionRunning = useRef(false)
  const refreshVersion = useRef(0)

  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current
    try {
      const next = await adapter.status()
      const items = next.connected && adapter.candidates ? await adapter.candidates() : []
      if (version !== refreshVersion.current) return
      setStatus(next)
      setCandidates(items)
      setLoadError("")
    } catch (error) {
      if (version === refreshVersion.current) setLoadError(error instanceof Error ? error.message : String(error))
    }
  }, [adapter])

  useEffect(() => {
    const update = () => { void refresh() }
    update()
    const timer = window.setInterval(update, 15000)
    window.addEventListener("easyssh:sync-status-changed", update)
    window.addEventListener("easyssh:sync-applied", update)
    return () => {
      ++refreshVersion.current
      window.clearInterval(timer)
      window.removeEventListener("easyssh:sync-status-changed", update)
      window.removeEventListener("easyssh:sync-applied", update)
    }
  }, [refresh])

  useEffect(() => () => { void adapter.cancelLogin?.().catch(() => {}) }, [adapter])
  useEffect(() => {
    // A later background retry can recover a manually initiated sync failure.
    if (failedSync && status && !status.syncing && !status.error && !loadError) {
      setActionError("")
      setFailedSync(false)
    }
  }, [failedSync, status, loadError])
  useEffect(() => {
    if (!login) return
    let cancelled = false
    let timer: number
    const poll = async () => {
      try {
        if (Date.now() >= new Date(login.expires_at).getTime()) throw new Error(t("syncLoginExpired"))
        const connected = await adapter.pollLogin!()
        if (cancelled) return
        if (connected) {
          setLogin(null)
          await refresh()
          // Connection succeeded; network exchange has its own status and retry.
          void adapter.sync().catch(() => {})
        } else {
          timer = window.setTimeout(() => void poll(), 3000)
        }
      } catch (error) {
        if (cancelled) return
        setLogin(null)
        await refresh()
        setActionError(error instanceof Error ? error.message : String(error))
      }
    }
    timer = window.setTimeout(() => void poll(), 3000)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [login, adapter, refresh, t])

  async function action(fn: () => Promise<void>, success?: string, isSync = false): Promise<boolean> {
    if (actionRunning.current) return false
    actionRunning.current = true
    setBusy(true)
    setActionError("")
    setFailedSync(false)
    try {
      await fn()
      await refresh()
      if (success) toast.success(success)
      return true
    } catch (error) {
      await refresh()
      const message = error instanceof Error ? error.message : String(error)
      setActionError(message)
      setFailedSync(isSync)
      if (!isSync) toast.error(message)
      return false
    } finally {
      actionRunning.current = false
      setBusy(false)
    }
  }

  const syncing = Boolean(status?.syncing)
  const disabled = busy || syncing || Boolean(loadError)
  const error = actionError || loadError || status?.error || ""
  const stateLabel = !status ? t("syncLoading") : !status.connected ? t("syncDisconnected")
    : syncing ? t("syncRunning") : status.can_sync === false ? t("syncPermissionRequired")
      : !status.enabled ? t("syncPaused") : error || status.conflicts.length ? t("syncNeedsAttention")
        : status.last_sync ? t("syncReady") : t("syncWaitingFirst")
  const StatusIcon = syncing ? Loader2 : error || status?.conflicts.length ? AlertCircle
    : status?.connected && !status.enabled ? Pause : status?.last_sync ? CheckCircle2 : Cloud

  async function syncNow() {
    await action(async () => {
      await adapter.sync()
      const next = await adapter.status()
      if (next.conflicts.length) toast.info(t("syncConflictSummary", { count: next.conflicts.length }))
      else if (next.connected && next.enabled) toast.success(t("syncComplete"))
    }, undefined, true)
  }

  return (
    <div className="space-y-5">
      {confirmDialog}
      <SettingsSection title={desktopMode ? t("syncDesktopTitle") : t("syncServerTitle")}
        description={desktopMode ? t("syncDesktopDescription") : t("syncServerDescription")}
        icon={<Cloud className="size-5" />}
        className="rounded-xl border border-border bg-card/40 p-5"
        actions={status?.connected && adapter.setEnabled && (
          <div className="flex items-center gap-2">
            <Label htmlFor="sync-enabled" className="text-xs text-muted-foreground">{t("syncToggleLabel")}</Label>
            <Switch id="sync-enabled" checked={status.enabled && status.can_sync !== false}
              disabled={disabled || status.can_sync === false}
              onCheckedChange={(enabled) => void action(() => adapter.setEnabled!(enabled))} />
          </div>
        )}>
        {desktopMode && status?.connected && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-muted/30 p-4">
              <div className="flex min-w-0 items-start gap-3" role="status" aria-live="polite">
                <StatusIcon className={`mt-0.5 size-5 shrink-0 ${syncing ? "animate-spin" : "text-muted-foreground"}`} />
                <div className="space-y-1">
                  <p className="text-sm font-medium">{stateLabel}</p>
                  <p className="text-xs text-muted-foreground">{t("syncLastCompletedTime")}: {status.last_sync ? new Date(status.last_sync).toLocaleString() : t("syncNever")}</p>
                </div>
              </div>
              <Button disabled={disabled || status.can_sync === false} onClick={() => {
                if (status.enabled) void syncNow()
                else void action(() => adapter.setEnabled!(true))
              }}>
                <RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} />
                {t(syncing ? "syncRunning" : status.enabled ? "syncNow" : "syncResume")}
              </Button>
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted-foreground">{t("syncAccount")}</dt><dd className="mt-1 break-all font-medium">{status.account_name}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("syncServerURL")}</dt><dd className="mt-1 break-all">{status.server_url}</dd></div>
            </dl>
            {!status.enabled && <p className="text-xs leading-5 text-muted-foreground">{t("syncPausedSettingsHint")}</p>}
          </>
        )}
        {!status && !error && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("syncLoading")}</p>}
        {error && (
          <div role="alert" className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="font-medium text-destructive">{t(actionError && !failedSync ? "syncActionFailed" : loadError ? "syncLoadFailed" : "syncExchangeFailed")}</p>
            <p className="whitespace-pre-wrap break-words text-muted-foreground">{error}</p>
            <div className="flex flex-wrap gap-2">
              {loadError ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>{t("syncRefreshStatus")}</Button>
                : (!actionError || failedSync) && desktopMode && status?.connected && status.enabled && (
                  <Button size="sm" variant="outline" disabled={disabled} onClick={() => void syncNow()}>{t("syncRetry")}</Button>
                )}
              {actionError && <Button size="sm" variant="ghost" onClick={() => setActionError("")}>{t("syncDismiss")}</Button>}
            </div>
          </div>
        )}
        {!desktopMode && <p className="text-sm leading-6 text-muted-foreground">{t(status?.can_sync === false ? "syncPermissionHint" : "syncWebLoginHint")}</p>}
        {desktopMode && status && !status.connected && !login && (
          <form className="space-y-4" onSubmit={(event) => {
            event.preventDefault()
            void action(async () => setLogin(await adapter.beginLogin!(url.trim(), name.trim())))
          }}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="sync-url">{t("syncServerURL")}</Label>
                <Input id="sync-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://ssh.example.com" required disabled={busy} />
              </div>
              <div className="space-y-2"><Label htmlFor="sync-name">{t("syncDeviceName")}</Label>
                <Input id="sync-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={t("syncDevicePlaceholder")} maxLength={100} required disabled={busy} />
              </div>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">{t("syncInitialHint")}</p>
            <Button type="submit" disabled={busy || !url.trim() || !name.trim()}>
              {busy && <Loader2 className="size-4 animate-spin" />}{t("syncConnect")}
            </Button>
          </form>
        )}
        {login && (
          <div className="space-y-3 rounded-lg border p-4">
            <p className="text-sm">{t("syncLoginWaiting")}</p>
            <p className="font-mono text-lg tracking-widest">{login.code}</p>
            <p className="text-xs text-muted-foreground">{t("syncLoginCodeHint")}</p>
            <Button variant="outline" disabled={busy} onClick={() => void action(async () => {
              setLogin(null)
              await adapter.cancelLogin!()
            })}>{t("syncCancelLogin")}</Button>
          </div>
        )}
      </SettingsSection>

      {!!status?.conflicts.length && <SyncConflicts status={status} adapter={adapter} busy={disabled || !status.enabled} action={action} />}

      {desktopMode && status?.connected && adapter.setScopes && (
        <SyncContentSettings key={`scopes-${status.space_id}`} scopes={status.scopes ?? emptySyncScopes}
          grants={status.grants ?? emptySyncScopes} disabled={disabled} paused={!status.enabled}
          onSave={(scopes) => action(() => adapter.setScopes!(scopes), t("syncScopesSaved"))}
          onCopyAIConfig={adapter.enrollAIConfig ? () => {
            void confirm({ description: t("syncCopyAIConfigConfirm") }).then((approved) => {
              if (approved) void action(() => adapter.enrollAIConfig!(status.space_id!), t("syncAIConfigCopied"))
            })
          } : undefined} />
      )}
      {desktopMode && status?.connected && adapter.enroll && adapter.candidates && (
        <SyncDataPicker key={`data-${status.space_id}`} candidates={candidates} spaceID={status.space_id!}
          sessionsEnabled={Boolean(status.scopes?.sessions)} disabled={disabled} paused={!status.enabled}
          onEnroll={async (keys) => {
            if (!(await confirm({ description: t("syncEnrollConfirm", { count: keys.length, account: status.account_name, url: status.server_url }) }))) return false
            return action(() => adapter.enroll!(status.space_id!, keys), t("syncDataEnrolled"))
          }} />
      )}

      {!desktopMode && status && (
        <SettingsSection title={t("syncDevices")} icon={<Laptop className="size-5" />} className="rounded-xl border border-border bg-card/40 p-5">
          {!status.devices?.length ? <p className="text-sm text-muted-foreground">{t("syncNoDevices")}</p> : (
            <ul className="divide-y">
              {status.devices.map((device) => (
                <li key={device.id} className="flex flex-wrap items-center gap-3 py-3">
                  <Laptop className="size-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{device.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{t("syncDeviceScopes")}: {(["credentials", "ai_config", "sessions"] as (keyof SyncScopes)[])
                      .filter((key) => device.scopes?.[key]).map((key) => t(scopeLabels[key])).join(" · ") || t("syncBasicScope")}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{t("syncLastTime")}: {device.last_used_at ? new Date(device.last_used_at).toLocaleString() : t("syncNever")} · {t("syncExpires")}: {new Date(device.expires_at).toLocaleDateString()}</p>
                  </div>
                  <Button variant="ghost" size="sm" disabled={disabled} onClick={() => void action(async () => {
                    if (await confirm({ description: t("syncRevokeConfirm"), variant: "destructive" })) await adapter.revokeDevice?.(device.id)
                  })}>{t("syncRevoke")}</Button>
                </li>
              ))}
            </ul>
          )}
        </SettingsSection>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4 px-1">
        <details className="min-w-0 flex-1 text-xs text-muted-foreground">
          <summary className="w-fit cursor-pointer rounded-sm py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("syncHowItWorks")}</summary>
          <div className="mt-2 space-y-2 leading-5">
            <p>{t("syncTimingHint")}</p><p>{t("syncScope")}</p><p>{t("syncCredentialsHint")}</p>
            <p>{t("syncDeleteHint")}</p><p>{t("syncVaultTrustHint")}</p>
          </div>
        </details>
        {desktopMode && status?.connected && adapter.disconnect && (
          <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={disabled} onClick={() => void action(async () => {
            if (await confirm({ description: t("syncDisconnectConfirm"), variant: "destructive" })) {
              const revoked = await adapter.disconnect!()
              if (!revoked) toast.warning(t("syncRevocationPending"))
            }
          })}><Unplug className="size-4" />{t("syncDisconnect")}</Button>
        )}
      </div>
    </div>
  )
}
