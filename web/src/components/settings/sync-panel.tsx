import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Laptop, Loader2, RefreshCw, Unplug } from "lucide-react"
import { toast } from "sonner"
import { SyncScopeOptions, scopeLabels } from "@/components/settings/sync-scopes"
import { emptySyncScopes, type SyncScopes } from "@/lib/sync/types"
import { SettingsSection } from "@/components/settings/settings-section"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { useConfirmDialog } from "@/hooks/use-confirm-dialog"
import type { SyncAdapter, SyncStatus, SyncLogin, SyncCandidate } from "@/lib/sync/types"

export function SyncPanel({
  adapter,
  desktopMode,
}: {
  adapter: SyncAdapter
  desktopMode: boolean
}) {
  const { t } = useTranslation("settingsManagementBackup")
  const { confirm, confirmDialog } = useConfirmDialog()
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState("")
  const [name, setName] = useState("")
  const [login, setLogin] = useState<SyncLogin | null>(null)
  const [candidates, setCandidates] = useState<SyncCandidate[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const refresh = useCallback(async () => {
    try {
      const next = await adapter.status()
      setStatus(next)
      setError(next.error || "")
      if (adapter.candidates) {
        const items = await adapter.candidates()
        setCandidates(items)
        setSelected((current) =>
          current.filter((key) =>
            items.some((item) => item.key === key && item.space_id !== next.space_id),
          ),
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [adapter])
  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 15000)
    return () => window.clearInterval(timer)
  }, [refresh])
  useEffect(() => {
    setSelected([])
  }, [status?.space_id])
  useEffect(
    () => () => {
      void adapter.cancelLogin?.().catch(() => {})
    },
    [adapter],
  )
  useEffect(() => {
    if (!login) return
    let cancelled = false
    let timer: number
    const poll = async () => {
      try {
        if (Date.now() >= new Date(login.expires_at).getTime())
          throw new Error(t("syncLoginExpired"))
        const connected = await adapter.pollLogin!()
        if (cancelled) return
        if (connected) {
          setLogin(null)
          await refresh()
          await adapter.sync()
          await refresh()
        } else {
          timer = window.setTimeout(() => void poll(), 3000)
        }
      } catch (e) {
        if (cancelled) return
        setLogin(null)
        await refresh()
        setError(e instanceof Error ? e.message : String(e))
      }
    }
    timer = window.setTimeout(() => void poll(), 3000)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [login, adapter, refresh, t])
  async function action(fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
      await refresh()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      await refresh()
      setError(message)
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }
  const available = candidates.filter(
    (item) =>
      (item.space_id !== status?.space_id || !item.space_id) &&
      (!item.key.startsWith("ai_session/") || status?.scopes?.sessions),
  )
  return (
    <div className="space-y-6">
      {confirmDialog}
      <SettingsSection
        title={desktopMode ? t("syncDesktopTitle") : t("syncServerTitle")}
        description={desktopMode ? t("syncDesktopDescription") : t("syncServerDescription")}
        icon={<RefreshCw className="h-5 w-5" />}
        actions={
          status && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {status.can_sync === false
                  ? t("syncPermissionRequired")
                  : !status.connected
                    ? t("syncDisconnected")
                    : status.enabled
                      ? t("syncEnabled")
                      : t("syncPaused")}
              </span>
              <Switch
                aria-label={t("syncToggleLabel")}
                checked={status.connected && status.can_sync !== false && status.enabled}
                disabled={
                  busy || !status.connected || status.can_sync === false || !adapter.setEnabled
                }
                onCheckedChange={(enabled) => void action(() => adapter.setEnabled!(enabled))}
              />
            </div>
          )
        }
      >
        <div className="space-y-1 rounded-lg bg-muted/40 p-3 text-sm leading-6">
          <p>{t("syncScope")}</p>
          <p className="text-muted-foreground">{t("syncCredentialsHint")}</p>
          <p className="text-muted-foreground">{t("syncDeleteHint")}</p>
        </div>
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive break-words"
          >
            {error}
            <Button variant="link" size="sm" onClick={() => void refresh()}>
              {t("syncRetry")}
            </Button>
          </div>
        )}
        {!status && !error && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
        {!desktopMode && (
          <p className="text-sm text-muted-foreground">
            {t(status?.can_sync === false ? "syncPermissionHint" : "syncWebLoginHint")}
          </p>
        )}
        {desktopMode && status && !status.connected && !login && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              void action(async () => setLogin(await adapter.beginLogin!(url, name)))
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="sync-url">{t("syncServerURL")}</Label>
              <Input
                id="sync-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://ssh.example.com"
                required
                disabled={busy}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sync-name">{t("syncDeviceName")}</Label>
              <Input
                id="sync-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("syncDevicePlaceholder")}
                maxLength={100}
                required
                disabled={busy}
              />
            </div>
            <p className="text-sm text-muted-foreground">{t("syncInitialHint")}</p>
            <Button type="submit" disabled={busy || !url.trim() || !name.trim()}>
              {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
              {t("syncConnect")}
            </Button>
          </form>
        )}
        {login && (
          <div className="space-y-3 rounded-lg border p-4">
            <p className="text-sm">{t("syncLoginWaiting")}</p>
            <p className="font-mono text-lg tracking-widest">{login.code}</p>
            <p className="text-xs text-muted-foreground">{t("syncLoginCodeHint")}</p>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  setLogin(null)
                  await adapter.cancelLogin!()
                })
              }
            >
              {t("syncCancelLogin")}
            </Button>
          </div>
        )}
        {desktopMode && status?.connected && (
          <>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">{t("syncAccount")}</dt>
                <dd className="mt-1 break-all">{status.account_name}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("syncServerURL")}</dt>
                <dd className="mt-1 break-all">{status.server_url}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("syncLastTime")}</dt>
                <dd className="mt-1">
                  {status.last_sync ? new Date(status.last_sync).toLocaleString() : t("syncNever")}
                </dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy || !status.enabled}
                onClick={() => void action(() => adapter.sync())}
              >
                <RefreshCw className={`mr-2 size-4 ${busy ? "animate-spin" : ""}`} />
                {t("syncNow")}
              </Button>

              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    if (
                      await confirm({
                        description: t("syncDisconnectConfirm"),
                        variant: "destructive",
                      })
                    ) {
                      const revoked = await adapter.disconnect!()
                      if (!revoked) toast.warning(t("syncRevocationPending"))
                    }
                  })
                }
              >
                <Unplug className="mr-2 size-4" />
                {t("syncDisconnect")}
              </Button>
            </div>
          </>
        )}
      </SettingsSection>
      {desktopMode && status?.connected && adapter.setScopes && (
        <SettingsSection
          title={t("syncAdditionalScopes")}
          description={t("syncVaultTrustHint")}
          className="rounded-none border-0 border-t border-solid pt-6"
        >
          <SyncScopeOptions
            value={status.scopes ?? emptySyncScopes}
            grants={status.grants ?? emptySyncScopes}
            disabled={busy || !status.enabled}
            onChange={(scopes) => void action(() => adapter.setScopes!(scopes))}
          />
          <p className="text-xs text-muted-foreground">{t("syncScopeDisableHint")}</p>
          {status.scopes?.ai_config && adapter.enrollAIConfig && (
            <Button
              variant="outline"
              disabled={busy || !status.enabled}
              onClick={() =>
                void action(async () => {
                  if (await confirm({ description: t("syncCopyAIConfigConfirm") }))
                    await adapter.enrollAIConfig!(status.space_id!)
                })
              }
            >
              {t("syncCopyAIConfig")}
            </Button>
          )}
        </SettingsSection>
      )}
      {desktopMode && status?.connected && (
        <SettingsSection
          title={t("syncEnrollTitle")}
          description={t("syncEnrollHint")}
          className="rounded-none border-0 border-t border-solid pt-6"
        >
          {available.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("syncNoLocalRecords")}</p>
          ) : (
            <>
              <div className="max-h-72 overflow-y-auto rounded-lg border divide-y">
                {available.map((item) => (
                  <Label key={item.key} className="flex cursor-pointer items-start gap-3 p-3">
                    <Checkbox
                      checked={selected.includes(item.key)}
                      disabled={busy}
                      onCheckedChange={(checked) =>
                        setSelected((current) =>
                          checked === true
                            ? [...current, item.key]
                            : current.filter((key) => key !== item.key),
                        )
                      }
                    />
                    <span className="min-w-0 space-y-1">
                      <span className="block break-words text-sm">
                        {item.name} ·{" "}
                        {t(
                          item.key.startsWith("server/")
                            ? "syncServerRecord"
                            : item.key.startsWith("ai_session/")
                              ? "syncSessionRecord"
                              : "syncScriptRecord",
                        )}
                      </span>
                      <span className="block break-all text-xs font-normal text-muted-foreground">
                        {item.space_id
                          ? t("syncOtherSpace", {
                              account: item.account_name,
                              url: item.server_url,
                            })
                          : t("syncLocalOnly")}
                      </span>
                    </span>
                  </Label>
                ))}
              </div>
              <Button
                disabled={busy || selected.length === 0}
                onClick={() =>
                  void action(async () => {
                    if (
                      !(await confirm({
                        description: t("syncEnrollConfirm", {
                          count: selected.length,
                          account: status.account_name,
                          url: status.server_url,
                        }),
                      }))
                    )
                      return
                    await adapter.enroll!(status.space_id!, selected)
                    setSelected([])
                  })
                }
              >
                {t("syncEnrollAction", { count: selected.length })}
              </Button>
            </>
          )}
        </SettingsSection>
      )}
      {!desktopMode && status && (
        <SettingsSection
          title={t("syncDevices")}
          icon={<Laptop className="h-5 w-5" />}
          className="rounded-none border-0 border-t border-solid pt-6"
        >
          {!status.devices?.length ? (
            <p className="text-sm text-muted-foreground">{t("syncNoDevices")}</p>
          ) : (
            <ul className="divide-y">
              {status.devices.map((device) => (
                <li key={device.id} className="flex flex-wrap items-center gap-3 py-3">
                  <Laptop className="size-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{device.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("syncDeviceScopes")}:{" "}
                      {(["credentials", "ai_config", "sessions"] as (keyof SyncScopes)[])
                        .filter((key) => device.scopes?.[key])
                        .map((key) => t(scopeLabels[key]))
                        .join(" · ") || t("syncBasicScope")}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("syncLastTime")}:{" "}
                      {device.last_used_at
                        ? new Date(device.last_used_at).toLocaleString()
                        : t("syncNever")}{" "}
                      · {t("syncExpires")}: {new Date(device.expires_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        if (
                          await confirm({
                            description: t("syncRevokeConfirm"),
                            variant: "destructive",
                          })
                        )
                          await adapter.revokeDevice?.(device.id)
                      })
                    }
                  >
                    {t("syncRevoke")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </SettingsSection>
      )}
      {!!status?.conflicts.length && (
        <SettingsSection
          title={t("syncConflicts")}
          description={t("syncConflictHint")}
          className="rounded-none border-0 border-t border-solid pt-6"
        >
          {status.conflicts.map((conflict) => (
            <div key={`${conflict.key}/${conflict.field}`} className="space-y-2 border-t pt-4">
              <p className="break-all text-xs text-muted-foreground">
                {conflict.key} ·{" "}
                {conflict.field === "connection"
                  ? t("syncConnectionField")
                  : conflict.field === "ref"
                    ? t("syncVersionField")
                    : t("syncContentField")}
              </p>
              {conflict.values.map((value, i) => (
                <div key={i} className="space-y-2 rounded-lg bg-muted/40 p-3">
                  {conflict.previews?.[value] ? (
                    <div className="space-y-1 text-sm">
                      <p className="text-xs text-muted-foreground">
                        {t(
                          conflict.previews[value].source === "desktop"
                            ? "syncVersionDesktop"
                            : "syncVersionServer",
                        )}
                        {conflict.previews[value].updated_at &&
                          ` · ${new Date(conflict.previews[value].updated_at!).toLocaleString()}`}
                      </p>
                      {conflict.previews[value].deleted ? (
                        <p>{t("syncVersionDeleted")}</p>
                      ) : (
                        <>
                          {conflict.key.startsWith("vault/ai_session/") && (
                            <p>
                              {conflict.previews[value].title} ·{" "}
                              {t("syncMessageCount", {
                                count: conflict.previews[value].messages ?? 0,
                              })}
                              {conflict.previews[value].last_message_at &&
                                ` · ${new Date(conflict.previews[value].last_message_at!).toLocaleString()}`}
                            </p>
                          )}
                          {conflict.key.startsWith("vault/credential/") && (
                            <p>
                              {t(
                                conflict.previews[value].has_password
                                  ? "syncHasPassword"
                                  : "syncNoPassword",
                              )}{" "}
                              · {conflict.previews[value].fingerprint || t("syncNoPrivateKey")}
                            </p>
                          )}
                          {conflict.key.startsWith("vault/ai_config/") && (
                            <p>
                              {conflict.previews[value].provider} ·{" "}
                              {t(
                                conflict.previews[value].has_api_key
                                  ? "syncHasAPIKey"
                                  : "syncNoAPIKey",
                              )}
                            </p>
                          )}
                        </>
                      )}
                      <p className="break-all font-mono text-xs text-muted-foreground">{value}</p>
                    </div>
                  ) : (
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs">
                      {value}
                    </pre>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void action(() => adapter.resolve(conflict.key, conflict.field, value))
                    }
                  >
                    {t("syncUseVersion", { number: i + 1 })}
                  </Button>
                  {conflict.key.startsWith("vault/ai_session/") &&
                    !conflict.previews?.[value]?.deleted &&
                    adapter.forkSession && (
                      <Button
                        className="ml-2"
                        size="sm"
                        variant="outline"
                        disabled={busy}
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
              ))}
            </div>
          ))}
        </SettingsSection>
      )}
    </div>
  )
}
