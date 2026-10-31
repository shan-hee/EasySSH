import { useId } from "react"
import { useTranslation } from "react-i18next"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { ScriptParameterRules } from "@/components/sharing/script-parameter-rules"
import { tokenActions, type TokenPermissions } from "@/lib/token-authorization"
import type { Action } from "@/lib/api/grants"
import type { Script } from "@/lib/script-types"

// Tokens name terminal access as command execution, which is what MCP exposes.
export function useActionLabel() {
  const { t } = useTranslation("automation")
  const { t: sharing } = useTranslation("sharing")
  return (action: Action) => action === "terminal.connect" ? t("authorization.commandPermission") : sharing(`actions.${action}`)
}

export function TokenPermissionActions({ value, onChange, disabled }: {
  value: TokenPermissions
  onChange: (value: TokenPermissions) => void
  disabled: boolean
}) {
  const { t } = useTranslation("automation")
  const actionLabel = useActionLabel()
  return <fieldset disabled={disabled} className="space-y-3">
    <legend className="sr-only">{t("authorization.permissions")}</legend>
    <div className="grid gap-3 sm:grid-cols-2">
      {tokenActions.map(action => <label key={action} className="flex items-center gap-2 text-sm">
        <Checkbox disabled={disabled} checked={value.actions.includes(action)} onCheckedChange={checked => onChange({
          ...value,
          actions: checked === true ? [...value.actions, action] : value.actions.filter(item => item !== action),
          scripts: action === "scripts.execute" && checked !== true ? [] : value.scripts,
        })} />
        {actionLabel(action)}
      </label>)}
    </div>
    <label className="flex items-center gap-2 border-t pt-3 text-sm">
      <Checkbox disabled={disabled} checked={value.allow_interactive} onCheckedChange={checked => onChange({ ...value, allow_interactive: checked === true })} />
      {t("authorization.allowInteractive")}
    </label>
    <p className="text-xs text-muted-foreground">{t("authorization.interactiveHelp")}</p>
  </fieldset>
}

export function TokenApprovedScripts({ value, scripts, onChange, disabled }: {
  value: TokenPermissions["scripts"]
  scripts: Script[]
  onChange: (value: TokenPermissions["scripts"]) => void
  disabled: boolean
}) {
  const { t } = useTranslation("automation")
  const { t: sharing } = useTranslation("sharing")
  const id = useId()
  return <fieldset disabled={disabled} className="min-w-0 space-y-3 rounded-lg border p-3" aria-labelledby={id}>
    <p id={id} className="text-sm font-medium">{t("authorization.approvedScripts")}</p>
    <div className="max-h-44 space-y-2 overflow-y-auto">
      {scripts.map(script => <label key={script.id} className="flex items-center gap-2 text-sm">
        <Checkbox disabled={disabled} checked={value.some(item => item.script_id === script.id)} onCheckedChange={checked => onChange(checked === true
          ? [...value, { script_id: script.id, version: script.version, parameters: {} }]
          : value.filter(item => item.script_id !== script.id))} />
        <span className="truncate" title={script.description}>{script.name}</span>
      </label>)}
      {!scripts.length && <p className="text-sm text-muted-foreground">{t("authorization.noScripts")}</p>}
    </div>
    {value.map(allowed => {
      const script = scripts.find(item => item.id === allowed.script_id)
      return <div key={allowed.script_id} className="space-y-2 border-t pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>{script?.name ?? allowed.script_id}</span>
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(value.filter(item => item.script_id !== allowed.script_id))}>{sharing("forget")}</Button>
        </div>
        {script?.version !== allowed.version && <div className="space-y-2 text-sm text-destructive">
          <p>{t("authorization.issues.scriptChanged")}</p>
          {script && <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onChange(value.map(item => item.script_id === script.id ? { ...item, version: script.version } : item))}>{sharing("updateScriptVersion")}</Button>}
        </div>}
        <details>
          <summary className="cursor-pointer text-sm">{t("authorization.scriptParameters")}</summary>
          <div className="mt-2"><ScriptParameterRules value={allowed.parameters ?? {}} onChange={parameters => onChange(value.map(item => item.script_id === allowed.script_id ? { ...item, parameters } : item))} /></div>
        </details>
      </div>
    })}
  </fieldset>
}
