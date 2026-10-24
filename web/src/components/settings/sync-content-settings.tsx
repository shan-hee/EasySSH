import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Check, KeyRound, MessageSquare, Server, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { SettingsSection } from "./settings-section"
import { scopeLabels } from "./sync-scopes"
import type { SyncScopes } from "@/lib/sync/types"

const options = [
  { key: "credentials", icon: KeyRound, hint: "syncScopeCredentialsHint" },
  { key: "ai_config", icon: Sparkles, hint: "syncScopeAIConfigHint" },
  { key: "sessions", icon: MessageSquare, hint: "syncSessionsSummary" },
] as const

export function SyncContentSettings({ scopes, grants, disabled, paused, onSave, onCopyAIConfig }: {
  scopes: SyncScopes
  grants: SyncScopes
  disabled: boolean
  paused: boolean
  onSave: (scopes: SyncScopes) => Promise<boolean>
  onCopyAIConfig?: () => void
}) {
  const { t } = useTranslation("settingsManagementBackup")
  const [draft, setDraft] = useState(scopes)
  useEffect(() => {
    setDraft({ credentials: scopes.credentials, ai_config: scopes.ai_config, sessions: scopes.sessions })
  }, [scopes.credentials, scopes.ai_config, scopes.sessions])
  const dirty = options.some(({ key }) => draft[key] !== scopes[key])

  return (
    <SettingsSection title={t("syncAdditionalScopes")} description={t("syncContentHint")}
      className="rounded-xl border border-border bg-card/40 p-5">
      <div className="divide-y rounded-lg border">
        <div className="flex items-start gap-3 p-4">
          <Server className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-medium">{t("syncBaseTitle")}</p>
            <p className="text-xs leading-5 text-muted-foreground">{t("syncBaseHint")}</p>
          </div>
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <Check className="size-3.5" />{t("syncIncluded")}
          </span>
        </div>
        {options.map(({ key, icon: Icon, hint }) => (
          <div key={key} className="p-4">
            <div className="flex items-start gap-3">
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1 space-y-1">
                <Label htmlFor={`sync-scope-${key}`} className="text-sm font-medium">{t(scopeLabels[key])}</Label>
                <p id={`sync-scope-${key}-hint`} className="text-xs leading-5 text-muted-foreground">{t(hint)}</p>
                {!grants[key] && <p className="text-xs text-muted-foreground">{t("syncScopeNeedsGrant")}</p>}
              </div>
              <Switch id={`sync-scope-${key}`} aria-describedby={`sync-scope-${key}-hint`}
                checked={draft[key]} disabled={disabled || !grants[key]}
                onCheckedChange={(value) => setDraft((current) => ({ ...current, [key]: value }))} />
            </div>
            {key === "ai_config" && scopes.ai_config && onCopyAIConfig && (
              <details className="ml-7 mt-3 text-xs text-muted-foreground">
                <summary className="w-fit cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("syncLocalAIConfig")}</summary>
                <p className="mt-2 leading-5">{t("syncLocalAIConfigHint")}</p>
                <Button variant="outline" size="sm" className="mt-2" disabled={disabled || dirty}
                  onClick={onCopyAIConfig}>{t("syncCopyAIConfig")}</Button>
              </details>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs leading-5 text-muted-foreground">
          {dirty ? t("syncUnsavedScopes") : paused ? t("syncPausedSettingsHint") : t("syncScopeDisableHint")}
        </p>
        {dirty && (
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setDraft(scopes)}>{t("syncDiscard")}</Button>
            <Button size="sm" disabled={disabled} onClick={() => void onSave(draft)}>{t("syncSaveScopes")}</Button>
          </div>
        )}
      </div>
    </SettingsSection>
  )
}
