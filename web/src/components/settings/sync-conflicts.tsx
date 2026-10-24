import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { SettingsSection } from "./settings-section"
import { Button } from "@/components/ui/button"
import type { SyncAdapter, SyncStatus } from "@/lib/sync/types"

export function SyncConflicts({ status, adapter, busy, action }: {
  status: SyncStatus
  adapter: SyncAdapter
  busy: boolean
  action: (fn: () => Promise<void>) => Promise<boolean>
}) {
  const { t } = useTranslation("settingsManagementBackup")
  return (
    <div id="sync-conflicts" className="scroll-mt-4">
      {!!status.conflicts.length && (
        <SettingsSection
          title={t("syncConflicts")}
          description={t("syncConflictHint")}
          className="rounded-xl border border-border bg-card/40 p-5"
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
