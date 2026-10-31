import { useId, useState } from "react"
import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ServerScopePicker } from "@/components/servers/server-scope-picker"
import { TokenApprovedScripts, TokenPermissionActions, useActionLabel } from "./token-permission-fields"
import {
  presetPermissions, tokenPresets, tokenResourceLimit,
  type TokenAuthorizationDraft, type TokenPermissions, type TokenPreset,
} from "@/lib/token-authorization"
import { cn } from "@/lib/utils"
import type { Server } from "@/lib/server-types"
import type { Script } from "@/lib/script-types"

const presets = (Object.keys(tokenPresets) as TokenPreset[]).filter(preset => preset !== "custom")

export function TokenAuthorizationEditor({ value, servers, scripts, disabled, loading, onChange }: {
  value: TokenAuthorizationDraft
  servers: Server[]
  scripts: Script[]
  disabled: boolean
  loading: boolean
  onChange: (draft: TokenAuthorizationDraft) => void
}) {
  const { t } = useTranslation("automation")
  const actionLabel = useActionLabel()
  const id = useId()
  const [customizing, setCustomizing] = useState(false)
  const { actions } = value.permissions
  const changePermissions = (permissions: TokenPermissions, preset: TokenPreset = "custom") => onChange({ ...value, preset, permissions })

  return <fieldset disabled={disabled} className="min-w-0 space-y-5">
    <legend className="sr-only">{t("authorization.title")}</legend>
    <section className="space-y-2" aria-labelledby={`${id}-purpose`}>
      <h3 id={`${id}-purpose`} className="text-sm font-medium">{t("authorization.purposeTitle")}</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {presets.map(preset => <label key={preset} className={cn("flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors", value.preset === preset ? "border-primary bg-primary/5" : "hover:bg-muted/50")}>
          <input type="radio" name={`${id}-purpose`} className="mt-1 accent-primary" value={preset} checked={value.preset === preset} disabled={disabled} onChange={() => changePermissions(presetPermissions(preset), preset)} />
          <span className="min-w-0">
            <span className="block text-sm font-medium">{t(`authorization.presets.${preset}.name`)}</span>
            <span className="block text-xs text-muted-foreground">{t(`authorization.presets.${preset}.description`)}</span>
          </span>
        </label>)}
      </div>
      <div className="flex flex-wrap items-center gap-1.5" aria-label={t("authorization.permissions")}>
        {actions.map(action => <Badge key={action} variant="secondary" className="font-normal">{actionLabel(action)}</Badge>)}
        {!actions.length && <span className="text-xs text-muted-foreground">{t("authorization.noPermissions")}</span>}
        <Button type="button" variant="link" size="sm" className="h-auto px-1 text-xs" aria-expanded={customizing} onClick={() => setCustomizing(open => !open)}>
          {customizing ? t("authorization.doneCustomizing") : t("authorization.customize")}
        </Button>
      </div>
      {customizing && <div className="rounded-lg border p-3"><TokenPermissionActions value={value.permissions} disabled={disabled} onChange={permissions => changePermissions(permissions)} /></div>}
      {actions.includes("scripts.execute") && <TokenApprovedScripts value={value.permissions.scripts} scripts={scripts} disabled={disabled} onChange={allowed => changePermissions({ ...value.permissions, scripts: allowed }, value.preset)} />}
    </section>

    <section className="space-y-2" aria-labelledby={`${id}-scope`}>
      <h3 id={`${id}-scope`} className="text-sm font-medium">{t("authorization.scopeTitle")}</h3>
      <ServerScopePicker servers={servers} value={value.serverIds} loading={loading} disabled={disabled} limit={tokenResourceLimit} onChange={serverIds => onChange({ ...value, serverIds })} />
    </section>

    {actions.includes("terminal.connect") && <p className="text-xs text-amber-700 dark:text-amber-400">{t("commandWarning")}</p>}
    {actions.includes("scripts.execute") && <p className="text-xs text-amber-700 dark:text-amber-400">{t("authorization.scriptEffects")}</p>}
  </fieldset>
}
