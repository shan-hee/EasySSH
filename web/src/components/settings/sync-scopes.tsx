import { useId } from "react"
import { useTranslation } from "react-i18next"
import { KeyRound, MessageSquare, Sparkles } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import type { SyncScopes } from "@/lib/sync/types"
import { cn } from "@/lib/utils"

export const scopeLabels = {
  credentials: "syncScopeCredentials",
  ai_config: "syncScopeAIConfig",
  sessions: "syncScopeSessions",
} as const

const authorizationOptions = [
  { key: "credentials", icon: KeyRound, hint: "syncAuthorizeCredentialsHint" },
  { key: "ai_config", icon: Sparkles, hint: "syncAuthorizeAIConfigHint" },
  { key: "sessions", icon: MessageSquare, hint: "syncAuthorizeSessionsHint" },
] as const

export function SyncScopeOptions({
  value,
  disabled,
  onChange,
}: {
  value: SyncScopes
  disabled?: boolean
  onChange: (value: SyncScopes) => void
}) {
  const { t } = useTranslation("settingsManagementBackup")
  const id = useId()
  return (
    <div className="space-y-2">
      {authorizationOptions.map(({ key, icon: Icon, hint }) => (
        <Label key={key} htmlFor={`${id}-${key}`}
          className={cn("flex items-start gap-3 rounded-lg border p-4 transition-colors", value[key] && "border-primary/40 bg-primary/5", disabled ? "cursor-default opacity-60" : "cursor-pointer hover:bg-muted/30")}>
          <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 space-y-1">
            <span className="block text-sm font-medium">{t(scopeLabels[key])}</span>
            <span id={`${id}-${key}-hint`} className="block text-xs font-normal leading-5 text-muted-foreground">{t(hint)}</span>
          </span>
          <Checkbox
            id={`${id}-${key}`}
            aria-describedby={`${id}-${key}-hint`}
            className="mt-0.5"
            checked={value[key]}
            disabled={disabled}
            onCheckedChange={(checked) => onChange({ ...value, [key]: checked === true })}
          />
        </Label>
      ))}
    </div>
  )
}
