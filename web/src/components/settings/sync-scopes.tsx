import { useTranslation } from "react-i18next"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { emptySyncScopes, type SyncScopes } from "@/lib/sync/types"

export const scopeLabels = {
  credentials: "syncScopeCredentials",
  ai_config: "syncScopeAIConfig",
  sessions: "syncScopeSessions",
} as const

export function SyncScopeOptions({
  value,
  grants,
  disabled,
  onChange,
}: {
  value: SyncScopes
  grants?: SyncScopes
  disabled?: boolean
  onChange: (value: SyncScopes) => void
}) {
  const { t } = useTranslation("settingsManagementBackup")
  return (
    <div className="space-y-4">
      {(Object.keys(scopeLabels) as (keyof SyncScopes)[]).map((key) => (
        <Label key={key} className="flex items-start gap-3">
          <Checkbox
            checked={value[key] ?? emptySyncScopes[key]}
            disabled={disabled || (grants && !grants[key])}
            onCheckedChange={(checked) => onChange({ ...value, [key]: checked === true })}
          />
          <span className="space-y-1">
            <span className="block text-sm">{t(scopeLabels[key])}</span>
            <span className="block text-xs font-normal text-muted-foreground leading-5">
              {t(`${scopeLabels[key]}Hint`)}
            </span>
            {grants && !grants[key] && (
              <span className="block text-xs font-normal text-muted-foreground">
                {t("syncScopeNeedsGrant")}
              </span>
            )}
          </span>
        </Label>
      ))}
    </div>
  )
}
